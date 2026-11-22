// Cache Compact: compacts large idle Claude Code and Codex threads around
// prompt cache expiry, so a returning question does not re-read the whole
// context at full price.
import type { BbPluginApi, MessageDispatchHookDecision } from "@get-bb/plugin-sdk";
import { rpcContract, STATUS_CHANGED, type ThreadStatus } from "./contract.js";
import { loadFacts, tokenUsage } from "./facts.js";
import { evaluate, providerOf, type Settings, warmDelayMs } from "./policy.js";
import { defineSettings } from "./settings.js";
import { addObservation, estimateTtl, type Observation, observe } from "./ttl.js";

const PROCEED: MessageDispatchHookDecision = { action: "proceed" };
const IDLE_KEY = "idle";
const OBS_KEY = "observations:codex";
/** Forget idle records older than this; their caches are long gone. */
const IDLE_RETENTION_MS = 24 * 60 * 60_000;

type IdleRecords = Record<string, { at: number; providerId: string }>;

export default async function plugin(bb: BbPluginApi) {
  const settings = defineSettings(bb);
  const kv = bb.storage.kv;
  /** Threads with a compaction this plugin started and has not seen finish. */
  const compacting = new Set<string>();
  /** Cold-return gate per thread: waiting on our compaction, or released. */
  const gate = new Map<string, "compacting" | "done">();
  const warmTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const learnedTtl = async () =>
    estimateTtl((await kv.get<Observation[]>(OBS_KEY)) ?? []);

  function changed(threadId: string) {
    bb.realtime.publish(STATUS_CHANGED, { threadId });
  }

  async function startCompaction(threadId: string, why: "warm" | "cold" | "manual") {
    compacting.add(threadId);
    changed(threadId);
    try {
      await bb.sdk.threads.compact({ threadId });
      bb.log.info(`compacting ${threadId} (${why})`);
    } catch (error) {
      bb.log.warn(`compaction of ${threadId} failed to start: ${String(error)}`);
      compacting.delete(threadId);
      if (gate.get(threadId) === "compacting") gate.set(threadId, "done");
      changed(threadId);
      await bb.experimental_hooks.recheck("message.dispatch");
      throw error;
    }
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
    if (!s.enabled || !s.coldReturn || s.mode !== "auto") return PROCEED;
    if (ctx.thread.status !== "idle" || providerOf(ctx.thread.providerId) === null) {
      return PROCEED;
    }
    try {
      const loaded = await loadFacts(bb, id, ctx.thread.providerId, s, await learnedTtl());
      if (loaded === null) return PROCEED;
      // BB's own experiment already compacts Claude Code threads on return.
      if (loaded.facts.provider === "claude" && loaded.builtinOffer) return PROCEED;
      const verdict = evaluate(loaded.facts, s, Date.now());
      if (!verdict.qualifies || !verdict.expired) return PROCEED;
      gate.set(id, "compacting");
      // Start outside the hook pass: compaction needs the dispatch lock released.
      setTimeout(() => {
        startCompaction(id, "cold").catch(() => {});
      }, 0);
      return {
        action: "wait",
        reason: `Compacting ${Math.round(verdict.usedPct)}% of context first: its prompt cache expired`,
      };
    } catch (error) {
      bb.log.warn(`cold-return check failed for ${id}: ${String(error)}`);
      return PROCEED;
    }
  });

  async function recordCodexObservation(threadId: string, previousIdleAt: number) {
    const rows = await tokenUsage(bb, threadId, 200);
    const first = rows.filter((r) => r.createdAt > previousIdleAt).at(-1);
    if (first === undefined) return;
    const next = observe(
      first.createdAt - previousIdleAt,
      first.inputTokens,
      first.cachedInputTokens,
      Date.now(),
    );
    if (next === null) return;
    await kv.set(OBS_KEY, addObservation((await kv.get<Observation[]>(OBS_KEY)) ?? [], next));
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
    const timer = setTimeout(() => {
      warmTimers.delete(threadId);
      warmFire(threadId, providerId, idleAt).catch((error) =>
        bb.log.warn(`warm compaction of ${threadId} failed: ${String(error)}`),
      );
    }, Math.max(0, dueAt - Date.now()));
    warmTimers.set(threadId, timer);
  }

  async function warmFire(threadId: string, providerId: string, idleAt: number) {
    const idle = (await kv.get<IdleRecords>(IDLE_KEY)) ?? {};
    if (idle[threadId]?.at !== idleAt) return; // newer activity since
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.status !== "idle" || compacting.has(threadId)) return;
    const s = await settings.get();
    if (!s.enabled || !s.warmIdle) return;
    const loaded = await loadFacts(bb, threadId, providerId, s, await learnedTtl());
    if (loaded === null) return;
    const verdict = evaluate(loaded.facts, s, Date.now());
    if (!verdict.qualifies || verdict.expired) return;
    await startCompaction(threadId, "warm");
  }

  bb.events.on("thread.active", ({ thread }) => {
    cancelWarm(thread.id);
    changed(thread.id);
  });

  bb.events.on("thread.idle", async ({ thread }) => {
    const id = thread.id;
    const ours = compacting.delete(id);
    if (gate.get(id) === "compacting") gate.set(id, "done");
    if (providerOf(thread.providerId) === null) return;
    const idle = (await kv.get<IdleRecords>(IDLE_KEY)) ?? {};
    const now = Date.now();
    const previous = idle[id]?.at;
    idle[id] = { at: now, providerId: thread.providerId };
    for (const [key, value] of Object.entries(idle)) {
      if (now - value.at > IDLE_RETENTION_MS) delete idle[key];
    }
    await kv.set(IDLE_KEY, idle);
    changed(id);
    if (ours) {
      await bb.experimental_hooks.recheck("message.dispatch");
      return;
    }
    if (providerOf(thread.providerId) === "codex" && previous !== undefined) {
      await recordCodexObservation(id, previous);
    }
    await armWarm(id, thread.providerId, now, await settings.get());
  });

  bb.rpc.register(rpcContract, {
    thread_status: async ({ threadId }): Promise<ThreadStatus> => {
      const s = await settings.get();
      const thread = await bb.sdk.threads.get({ threadId });
      const loaded = await loadFacts(bb, threadId, thread.providerId, s, await learnedTtl());
      if (loaded === null) {
        return { show: false, usedPct: 0, usedTokens: 0, thresholdPct: 0, expiresAt: null, compacting: false };
      }
      const verdict = evaluate(loaded.facts, s, Date.now());
      const busy = compacting.has(threadId);
      return {
        show: s.enabled && verdict.qualifies && verdict.expired && !busy && thread.status === "idle",
        usedPct: verdict.usedPct,
        usedTokens: loaded.facts.usedTokens,
        thresholdPct: verdict.thresholdPct,
        expiresAt: verdict.expiresAt,
        compacting: busy,
      };
    },
    compact_now: async ({ threadId }) => {
      try {
        await startCompaction(threadId, "manual");
        return { ok: true, message: null };
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  // Re-arm warm timers for threads that went idle before a reload. Events are
  // not replayed while the plugin is unloaded.
  void (async () => {
    const s = await settings.get();
    const idle = (await kv.get<IdleRecords>(IDLE_KEY)) ?? {};
    for (const [threadId, { at, providerId }] of Object.entries(idle)) {
      await armWarm(threadId, providerId, at, s).catch(() => {});
    }
  })();

  bb.onDispose(() => {
    for (const timer of warmTimers.values()) clearTimeout(timer);
    warmTimers.clear();
  });
}
