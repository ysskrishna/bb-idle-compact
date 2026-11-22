// Idle Compact: compacts large idle Claude Code and Codex threads around
// prompt cache expiry, so a returning question does not re-read the whole
// context at full price.
import type { BbPluginApi, MessageDispatchHookDecision } from "@get-bb/plugin-sdk";
import { rpcContract, SETTINGS_CHANGED, STATUS_CHANGED, type ThreadStatus } from "./contract.js";
import { lastCompactedAt, loadFacts, MAX_EVENT_PAGE, tokenUsage } from "./server-facts.js";
import { formatTokens } from "./format.js";
import {
  addEntry,
  awaitingReturn,
  type CompactionKind,
  fillReturnUsage,
  type LogEntry,
  markReturned,
  stats,
} from "./log.js";
import { evaluate, type Provider, providerOf, type Settings, warmDelayMs } from "./policy.js";
import { createSettingsStore } from "./server-settings.js";
import { threadStatus } from "./status.js";
import { addObservation, estimateTtl, type Observation, observe, summarize } from "./ttl.js";

const PROCEED: MessageDispatchHookDecision = { action: "proceed" };
const IDLE_KEY = "idle";
const OBS_KEY = "observations:codex";
const LOG_KEY = "log";
/** Forget idle records older than this; their caches are long gone. */
const IDLE_RETENTION_MS = 24 * 60 * 60_000;

type IdleRecords = Record<string, { at: number; providerId: string }>;

interface Running {
  kind: CompactionKind;
  provider: Provider;
  tokensBefore: number;
  startedAt: number;
}

export default async function plugin(bb: BbPluginApi) {
  const settings = createSettingsStore(bb);
  const kv = bb.storage.kv;
  /** Compactions this plugin started and has not seen finish. */
  const running = new Map<string, Running>();
  /** Cold-return gate per thread: waiting on our compaction, or released. */
  const gate = new Map<string, "compacting" | "done">();
  const warmTimers = new Map<string, ReturnType<typeof setTimeout>>();

  // Storage writes are read-modify-write; run them one at a time.
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }
  const readLog = async () => (await kv.get<LogEntry[]>(LOG_KEY)) ?? [];
  const readObservations = async () => (await kv.get<Observation[]>(OBS_KEY)) ?? [];
  const learnedTtl = async () => estimateTtl(await readObservations());

  function changed(threadId?: string) {
    bb.realtime.publish(STATUS_CHANGED, threadId === undefined ? {} : { threadId });
  }

  async function startCompaction(threadId: string, kind: CompactionKind, provider: Provider, tokensBefore: number) {
    running.set(threadId, { kind, provider, tokensBefore, startedAt: Date.now() });
    cancelWarm(threadId);
    changed(threadId);
    try {
      await bb.sdk.threads.compact({ threadId });
      bb.log.info(`compacting ${threadId} (${kind}, ${tokensBefore} tokens)`);
    } catch (error) {
      bb.log.warn(`compaction of ${threadId} failed to start: ${String(error)}`);
      running.delete(threadId);
      if (gate.get(threadId) === "compacting") gate.set(threadId, "done");
      changed(threadId);
      await bb.experimental_hooks.recheck("message.dispatch");
      throw error;
    }
  }

  /** Our compaction turn ended: log it if the context really was compacted. */
  async function finishCompaction(threadId: string, run: Running) {
    const [context, compactedAt] = await Promise.all([
      bb.sdk.threads.context({ threadId }),
      lastCompactedAt(bb, threadId),
    ]);
    const after = context.usage?.usedTokens ?? null;
    const compacted =
      (compactedAt !== null && compactedAt >= run.startedAt) || (after !== null && after < run.tokensBefore);
    if (!compacted || after === null) {
      bb.log.warn(`compaction of ${threadId} ended without a smaller context`);
      return;
    }
    const now = Date.now();
    const entry: LogEntry = {
      threadId,
      provider: run.provider,
      kind: run.kind,
      tokensBefore: run.tokensBefore,
      tokensAfter: after,
      at: now,
      returnedAt: null,
      returnInputTokens: null,
      returnCachedInputTokens: null,
    };
    await serial(async () => kv.set(LOG_KEY, addEntry(await readLog(), entry, now)));
    bb.realtime.publish(SETTINGS_CHANGED, {});
  }

  // Cold return: hold the user's message, compact, then let it through.
  bb.experimental_hooks.on("message.dispatch", async (ctx) => {
    if (ctx.initiator !== "user" || ctx.attempt !== "start-turn") return PROCEED;
    const id = ctx.thread.id;
    const state = gate.get(id);
    if (state === "done") {
      gate.delete(id);
      return PROCEED;
    }
    if (state === "compacting") {
      return { action: "wait", reason: "Compacting the expired context first" };
    }
    const s = await settings.get();
    if (!s.enabled || !s.coldReturn) return PROCEED;
    if (ctx.thread.status !== "idle" || providerOf(ctx.thread.providerId) === null) return PROCEED;
    try {
      const loaded = await loadFacts(bb, id, ctx.thread.providerId, s, await learnedTtl());
      if (loaded === null) return PROCEED;
      // BB's own experiment already compacts Claude Code threads on return.
      if (loaded.facts.provider === "claude" && loaded.builtinOffer) return PROCEED;
      const verdict = evaluate(loaded.facts, s, Date.now());
      if (!verdict.qualifies || !verdict.expired) return PROCEED;
      gate.set(id, "compacting");
      const { provider, usedTokens } = loaded.facts;
      // Start outside the hook pass: compaction needs the dispatch lock released.
      setTimeout(() => {
        startCompaction(id, "cold", provider, usedTokens).catch(() => {});
      }, 0);
      return {
        action: "wait",
        reason: `Compacting ${formatTokens(usedTokens)} tokens first: the prompt cache expired`,
      };
    } catch (error) {
      bb.log.warn(`cold-return check failed for ${id}: ${String(error)}`);
      return PROCEED;
    }
  });

  async function recordCodexObservation(threadId: string, previousIdleAt: number) {
    const rows = await tokenUsage(bb, threadId, MAX_EVENT_PAGE);
    const first = rows.filter((r) => r.createdAt > previousIdleAt).at(-1);
    if (first === undefined) return;
    const next = observe(first.createdAt - previousIdleAt, first.inputTokens, first.cachedInputTokens, Date.now());
    if (next === null) return;
    await serial(async () => kv.set(OBS_KEY, addObservation(await readObservations(), next)));
  }

  async function recordReturnUsage(threadId: string) {
    const log = await readLog();
    const entry = [...log].reverse().find((e) => e.threadId === threadId);
    if (entry === undefined || entry.returnedAt === null || entry.returnInputTokens !== null) return;
    const rows = await tokenUsage(bb, threadId, MAX_EVENT_PAGE);
    await serial(async () => {
      const next = fillReturnUsage(await readLog(), threadId, rows);
      if (next !== null) await kv.set(LOG_KEY, next);
    });
  }

  function cancelWarm(threadId: string) {
    const timer = warmTimers.get(threadId);
    if (timer !== undefined) clearTimeout(timer);
    warmTimers.delete(threadId);
  }

  async function armWarm(threadId: string, providerId: string, idleAt: number, s: Settings) {
    cancelWarm(threadId);
    if (!s.enabled || !s.warmIdle) return;
    const loaded = await loadFacts(bb, threadId, providerId, s, await learnedTtl());
    if (loaded === null) return;
    const verdict = evaluate(loaded.facts, s, Date.now());
    const delay = warmDelayMs(loaded.facts.ttlMs, s);
    if (!verdict.qualifies || verdict.expired || delay === null) return;
    const dueAt = (loaded.facts.lastUsageAt ?? idleAt) + delay;
    const timer = setTimeout(
      () => {
        warmTimers.delete(threadId);
        warmFire(threadId, providerId, idleAt).catch((error) =>
          bb.log.warn(`warm compaction of ${threadId} failed: ${String(error)}`),
        );
      },
      Math.max(0, dueAt - Date.now()),
    );
    warmTimers.set(threadId, timer);
  }

  async function warmFire(threadId: string, providerId: string, idleAt: number) {
    const idle = (await kv.get<IdleRecords>(IDLE_KEY)) ?? {};
    if (idle[threadId]?.at !== idleAt) return; // newer activity since
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.status !== "idle" || running.has(threadId)) return;
    const s = await settings.get();
    if (!s.enabled || !s.warmIdle) return;
    const loaded = await loadFacts(bb, threadId, providerId, s, await learnedTtl());
    if (loaded === null) return;
    const verdict = evaluate(loaded.facts, s, Date.now());
    if (!verdict.qualifies || verdict.expired) return;
    await startCompaction(threadId, "warm", loaded.facts.provider, loaded.facts.usedTokens);
  }

  async function rearmAll() {
    const s = await settings.get();
    const idle = (await kv.get<IdleRecords>(IDLE_KEY)) ?? {};
    for (const [threadId, { at, providerId }] of Object.entries(idle)) {
      await armWarm(threadId, providerId, at, s).catch(() => {});
    }
  }

  bb.events.on("thread.active", async ({ thread }) => {
    cancelWarm(thread.id);
    if (!running.has(thread.id)) {
      // A new turn after our compaction: the "Compacted" pill has done its job.
      await serial(async () => {
        const next = markReturned(await readLog(), thread.id, Date.now());
        if (next !== null) await kv.set(LOG_KEY, next);
      });
    }
    changed(thread.id);
  });

  bb.events.on("thread.idle", async ({ thread }) => {
    const id = thread.id;
    const run = running.get(id);
    running.delete(id);
    if (gate.get(id) === "compacting") gate.set(id, "done");
    if (providerOf(thread.providerId) === null) return;
    const now = Date.now();
    const previous = await serial(async () => {
      const idle = (await kv.get<IdleRecords>(IDLE_KEY)) ?? {};
      const before = idle[id]?.at;
      idle[id] = { at: now, providerId: thread.providerId };
      for (const [key, value] of Object.entries(idle)) {
        if (now - value.at > IDLE_RETENTION_MS) delete idle[key];
      }
      await kv.set(IDLE_KEY, idle);
      return before;
    });
    if (run !== undefined) {
      await finishCompaction(id, run).catch((error) =>
        bb.log.warn(`could not log compaction of ${id}: ${String(error)}`),
      );
      changed(id);
      await bb.experimental_hooks.recheck("message.dispatch");
      return;
    }
    await recordReturnUsage(id).catch((error) => bb.log.warn(`could not read return usage of ${id}: ${String(error)}`));
    if (providerOf(thread.providerId) === "codex" && previous !== undefined) {
      await recordCodexObservation(id, previous);
    }
    await armWarm(id, thread.providerId, now, await settings.get());
    changed(id);
  });

  async function statusOf(threadId: string): Promise<ThreadStatus> {
    const s = await settings.get();
    const thread = await bb.sdk.threads.get({ threadId });
    const run = running.get(threadId);
    const awaiting = awaitingReturn(await readLog(), threadId);
    const loaded =
      s.enabled && run === undefined && awaiting === null
        ? await loadFacts(bb, threadId, thread.providerId, s, await learnedTtl())
        : null;
    return threadStatus({
      settings: s,
      idle: thread.status === "idle",
      compactingTokens: run?.tokensBefore ?? null,
      awaiting,
      facts: loaded?.facts ?? null,
      builtinOffer: loaded?.builtinOffer ?? false,
      now: Date.now(),
    });
  }

  bb.rpc.register(rpcContract, {
    thread_status: ({ threadId }) => statusOf(threadId),
    compact_now: async ({ threadId }) => {
      try {
        if (running.has(threadId)) return { ok: true, message: null };
        const s = await settings.get();
        const thread = await bb.sdk.threads.get({ threadId });
        const loaded = await loadFacts(bb, threadId, thread.providerId, s, await learnedTtl());
        if (loaded === null) {
          return { ok: false, message: "This thread's provider or context size is not known yet." };
        }
        await startCompaction(threadId, "manual", loaded.facts.provider, loaded.facts.usedTokens);
        return { ok: true, message: null };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
    get_settings: () => settings.get(),
    update_settings: async (patch) => {
      const next = await settings.update(patch);
      bb.realtime.publish(SETTINGS_CHANGED, {});
      await rearmAll();
      changed();
      return next;
    },
    stats: async () => ({
      ...stats(await readLog(), Date.now()),
      codexTtl: summarize(await readObservations()),
    }),
  });

  // Re-arm warm timers for threads that went idle before a reload. Events are
  // not replayed while the plugin is unloaded.
  void rearmAll();

  bb.onDispose(() => {
    for (const timer of warmTimers.values()) clearTimeout(timer);
    warmTimers.clear();
  });
}
