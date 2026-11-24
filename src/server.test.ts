import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import plugin from "./server.js";

const MIN = 60_000;

interface Row {
  type: string;
  createdAt: number;
  data?: unknown;
}

/** Just enough of BB for the server: storage, events, RPC, and one Codex thread. */
function fakeBb() {
  const kv = new Map<string, unknown>();
  const handlers = new Map<string, (payload: unknown) => unknown>();
  const rpc: Record<string, (input: unknown) => Promise<unknown>> = {};
  const hooks = new Map<string, (ctx: unknown) => Promise<unknown>>();
  const rechecks: string[] = [];
  const thread = {
    status: "idle",
    archivedAt: null as number | null,
    /** Delay for event reads, to make concurrent work overlap. */
    listDelayMs: 0,
    usage: null as { usedTokens: number; modelContextWindow: number } | null,
    rows: [] as Row[],
    compacted: [] as string[],
    /** Every compaction request, including ones BB would reject. */
    attempts: 0,
    parentThreadId: null as string | null,
    latestAttentionAt: 0,
  };
  /** Threads above t1, by ID. */
  const ancestors = new Map<
    string,
    { parentThreadId: string | null; archivedAt: number | null; latestAttentionAt: number }
  >();
  /** Thread Inbox's shelf rows, and whether it is installed and answering. */
  const inbox = {
    rows: [] as Record<string, unknown>[],
    state: "ok" as "ok" | "missing" | "unreachable" | "broken",
  };
  const bb = {
    storage: {
      kv: {
        get: async (key: string) => structuredClone(kv.get(key)),
        set: async (key: string, value: unknown) => {
          kv.set(key, structuredClone(value));
        },
      },
    },
    realtime: { publish: () => {} },
    log: { info: () => {}, warn: () => {} },
    experimental_hooks: {
      on: (name: string, fn: (ctx: unknown) => Promise<unknown>) => hooks.set(name, fn),
      recheck: async (name: string) => {
        rechecks.push(name);
      },
    },
    events: { on: (name: string, fn: (payload: unknown) => unknown) => handlers.set(name, fn) },
    rpc: { register: (_contract: unknown, fns: typeof rpc) => Object.assign(rpc, fns) },
    onDispose: () => {},
    sdk: {
      plugins: {
        callRpc: async ({
          pluginId,
          method,
          outputSchema,
        }: {
          pluginId: string;
          method: string;
          outputSchema: { parse: (value: unknown) => unknown };
        }) => {
          if (pluginId !== "bb-thread-inbox" || method !== "listLifecycle" || inbox.state !== "ok") {
            throw new Error(
              inbox.state === "unreachable" ? "HTTP 503: plugin not ready" : "HTTP 404: plugin not found",
            );
          }
          return outputSchema.parse({ rows: inbox.rows });
        },
        list: async () => ({
          plugins:
            inbox.state === "missing"
              ? []
              : [
                  {
                    id: "bb-thread-inbox",
                    enabled: true,
                    status: inbox.state === "broken" ? "incompatible" : "running",
                  },
                ],
        }),
      },
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          const ancestor = ancestors.get(threadId);
          if (ancestor !== undefined) return { id: threadId, status: "idle", deletedAt: null, ...ancestor };
          if (threadId !== "t1") throw new Error("HTTP 404: Thread not found");
          return {
            id: threadId,
            status: thread.status,
            archivedAt: thread.archivedAt,
            deletedAt: null,
            providerId: "codex",
            parentThreadId: thread.parentThreadId,
            latestAttentionAt: thread.latestAttentionAt,
          };
        },
        context: async () => ({ usage: thread.usage }),
        compact: async ({ threadId }: { threadId: string }) => {
          thread.attempts++;
          // BB only compacts an idle thread.
          if (thread.status !== "idle") throw new Error("HTTP 409: thread is not idle");
          thread.compacted.push(threadId);
          thread.status = "active";
        },
        events: {
          list: async ({ types }: { types: string[] }) => {
            if (thread.listDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, thread.listDelayMs));
            return thread.rows.filter((row) => types.includes(row.type)).sort((a, b) => b.createdAt - a.createdAt);
          },
        },
      },
    },
  } as unknown as BbPluginApi;
  const emit = async (name: string) => {
    await handlers.get(name)?.({ thread: { id: "t1", providerId: "codex", status: thread.status }, error: null });
  };
  const send = () =>
    hooks.get("message.dispatch")?.({
      initiator: "user",
      attempt: "start-turn",
      thread: { id: "t1", status: thread.status, providerId: "codex" },
    });
  return { bb, rpc, thread, ancestors, inbox, emit, send, rechecks, kv };
}

describe("server", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("compacts before expiry even when BB reports the context size after the thread goes idle", async () => {
    vi.useFakeTimers({ now: 0 });
    const { bb, thread, emit } = fakeBb();
    await plugin(bb);
    thread.rows.push({ type: "turn/completed", createdAt: 0 });
    // At the idle moment BB has not reported the new context size yet.
    await emit("thread.idle");
    thread.usage = { usedTokens: 200_000, modelContextWindow: 475_000 };
    await vi.advanceTimersByTimeAsync(25 * MIN - 1_000);
    expect(thread.compacted).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(thread.compacted).toEqual(["t1"]);
  });

  it("logs a compaction once BB reports the smaller size", async () => {
    vi.useFakeTimers({ now: 0 });
    const { bb, rpc, thread, emit } = fakeBb();
    await plugin(bb);
    thread.rows.push({ type: "turn/completed", createdAt: 0 });
    thread.usage = { usedTokens: 200_000, modelContextWindow: 475_000 };
    await vi.advanceTimersByTimeAsync(MIN);
    expect(await rpc.compact_now?.({ threadId: "t1" })).toEqual({ ok: true, message: null });
    await emit("thread.active");
    // The compaction turn ends before BB knows the new size.
    thread.status = "idle";
    thread.usage = null;
    thread.rows.push({ type: "thread/compacted", createdAt: Date.now() });
    await emit("thread.idle");
    await vi.advanceTimersByTimeAsync(2_000);
    thread.usage = { usedTokens: 30_000, modelContextWindow: 475_000 };
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await rpc.thread_status?.({ threadId: "t1" })).toMatchObject({
      state: "compacted",
      tokensBefore: 200_000,
      tokensAfter: 30_000,
    });
    expect(await rpc.stats?.({})).toMatchObject({ compactions: 1, manual: 1 });
  });

  it("releases a held message when the compaction fails", async () => {
    vi.useFakeTimers({ now: 0 });
    const { bb, rpc, thread, emit, send, rechecks } = fakeBb();
    await plugin(bb);
    thread.rows.push({ type: "turn/completed", createdAt: 0 });
    thread.usage = { usedTokens: 200_000, modelContextWindow: 475_000 };
    await vi.advanceTimersByTimeAsync(31 * MIN);
    expect(await send()).toMatchObject({ action: "wait" });
    await vi.advanceTimersByTimeAsync(10);
    expect(thread.compacted).toEqual(["t1"]);
    thread.status = "error";
    await emit("thread.failed");
    expect(rechecks).toContain("message.dispatch");
    expect(await send()).toEqual({ action: "proceed" });
    expect(await rpc.thread_status?.({ threadId: "t1" })).toEqual({ state: "none" });
  });

  it("keeps one warm timer when arming overlaps", async () => {
    vi.useFakeTimers({ now: 0 });
    const { bb, rpc, thread, emit } = fakeBb();
    await plugin(bb);
    thread.rows.push({ type: "turn/completed", createdAt: 0 });
    thread.usage = { usedTokens: 200_000, modelContextWindow: 475_000 };
    await emit("thread.idle");
    // Two settings saves re-arm every idle thread at the same time.
    thread.listDelayMs = 50;
    const saves = Promise.all([rpc.update_settings?.({ threshold: 20 }), rpc.update_settings?.({ threshold: 20 })]);
    await vi.advanceTimersByTimeAsync(1_000);
    await saves;
    // One pending timer: the warm compaction. A leaked second timer would race it.
    expect(vi.getTimerCount()).toBe(1);
    thread.listDelayMs = 0;
    await vi.advanceTimersByTimeAsync(25 * MIN + 1_000);
    expect(thread.attempts).toBe(1);
    expect(await rpc.thread_status?.({ threadId: "t1" })).toMatchObject({ state: "compacting" });
  });

  it("does not compact an archived thread", async () => {
    vi.useFakeTimers({ now: 0 });
    const { bb, thread, emit } = fakeBb();
    await plugin(bb);
    thread.rows.push({ type: "turn/completed", createdAt: 0 });
    thread.usage = { usedTokens: 200_000, modelContextWindow: 475_000 };
    await emit("thread.idle");
    thread.archivedAt = MIN;
    await vi.advanceTimersByTimeAsync(26 * MIN);
    expect(thread.compacted).toEqual([]);
  });

  describe("Thread Inbox shelves", () => {
    const SETTLED = { threadId: "t1", settledAt: 1, settledOverride: null, snoozedUntil: null, snoozedAt: null };
    type Fake = ReturnType<typeof fakeBb>;

    /** A large Codex thread goes idle at 0; its warm compaction is due at 25 minutes. */
    async function idleThread(setup: (fake: Fake) => void) {
      // Restart the clock: some tests idle more than one thread.
      vi.useRealTimers();
      vi.useFakeTimers({ now: 0 });
      const fake = fakeBb();
      setup(fake);
      await plugin(fake.bb);
      fake.thread.rows.push({ type: "turn/completed", createdAt: 0 });
      fake.thread.usage = { usedTokens: 200_000, modelContextWindow: 475_000 };
      await fake.emit("thread.idle");
      return fake;
    }
    async function warmIdle(setup: (fake: Fake) => void) {
      const fake = await idleThread(setup);
      await vi.advanceTimersByTimeAsync(26 * MIN);
      return fake;
    }
    const withRows =
      (...rows: Record<string, unknown>[]) =>
      (fake: Fake) => {
        fake.inbox.rows = rows;
      };

    it("does not compact a settled thread in the background", async () => {
      const { thread } = await warmIdle(withRows(SETTLED));
      expect(thread.attempts).toBe(0);
    });

    it("does not compact a parked or snoozed thread in the background", async () => {
      const parked = await warmIdle(withRows({ ...SETTLED, settledAt: null, parkedAt: 1 }));
      expect(parked.thread.attempts).toBe(0);
      const snoozed = await warmIdle(withRows({ ...SETTLED, settledAt: null, snoozedUntil: 60 * MIN, snoozedAt: 1 }));
      expect(snoozed.thread.attempts).toBe(0);
    });

    it("does not compact a child of a filed thread, which would wake its parent", async () => {
      const { thread } = await warmIdle((fake) => {
        fake.thread.parentThreadId = "child-of-root";
        fake.ancestors.set("child-of-root", { parentThreadId: "root", archivedAt: null, latestAttentionAt: 0 });
        fake.ancestors.set("root", { parentThreadId: null, archivedAt: null, latestAttentionAt: 0 });
        fake.inbox.rows = [{ ...SETTLED, threadId: "root", settledAt: null, parkedAt: 1 }];
      });
      expect(thread.attempts).toBe(0);
    });

    it("compacts a thread Thread Inbox shows as Active", async () => {
      const cases: Array<(fake: Fake) => void> = [
        withRows(),
        withRows({ ...SETTLED, threadId: "other" }),
        withRows({ ...SETTLED, settledAt: null, settledOverride: "active" }),
        // The snooze ran out, or newer attention woke or un-settled the thread.
        withRows({ ...SETTLED, settledAt: null, snoozedUntil: 10 * MIN, snoozedAt: 1 }),
        (fake) => {
          fake.inbox.rows = [{ ...SETTLED, settledAt: null, snoozedUntil: 60 * MIN, snoozedAt: 1 }];
          fake.thread.latestAttentionAt = 2;
        },
        (fake) => {
          fake.inbox.rows = [SETTLED];
          fake.thread.latestAttentionAt = 2;
        },
        // Thread Inbox stops waking at an archived ancestor.
        (fake) => {
          fake.thread.parentThreadId = "root";
          fake.ancestors.set("root", { parentThreadId: null, archivedAt: 1, latestAttentionAt: 0 });
          fake.inbox.rows = [{ ...SETTLED, threadId: "root" }];
        },
      ];
      for (const setup of cases) {
        const { thread } = await warmIdle(setup);
        expect(thread.compacted).toEqual(["t1"]);
      }
    });

    it("compacts as before without a working Thread Inbox", async () => {
      for (const state of ["missing", "broken"] as const) {
        const { thread } = await warmIdle((fake) => {
          fake.inbox.state = state;
        });
        expect(thread.compacted).toEqual(["t1"]);
      }
    });

    it("skips the background compaction while an enabled Thread Inbox does not answer", async () => {
      const { thread } = await warmIdle((fake) => {
        fake.inbox.state = "unreachable";
      });
      expect(thread.attempts).toBe(0);
    });

    it("does not promise a background compaction for a filed thread", async () => {
      const filed = await idleThread(withRows(SETTLED));
      await vi.advanceTimersByTimeAsync(MIN);
      expect(await filed.rpc.thread_status?.({ threadId: "t1" })).toEqual({ state: "none" });
      const active = await idleThread(withRows());
      await vi.advanceTimersByTimeAsync(MIN);
      expect(await active.rpc.thread_status?.({ threadId: "t1" })).toMatchObject({ state: "scheduled" });
    });

    it("still compacts a settled thread first when the user comes back after expiry", async () => {
      const { thread, send } = await warmIdle(withRows(SETTLED));
      expect(thread.attempts).toBe(0);
      await vi.advanceTimersByTimeAsync(5 * MIN);
      expect(await send()).toMatchObject({ action: "wait" });
      await vi.advanceTimersByTimeAsync(10);
      expect(thread.compacted).toEqual(["t1"]);
    });
  });

  it("learns nothing about the cache lifetime from the first turn after a compaction", async () => {
    vi.useFakeTimers({ now: 0 });
    const { bb, rpc, thread, emit, kv } = fakeBb();
    await plugin(bb);
    thread.rows.push({ type: "turn/completed", createdAt: 0 });
    thread.usage = { usedTokens: 200_000, modelContextWindow: 475_000 };
    await rpc.compact_now?.({ threadId: "t1" });
    thread.status = "idle";
    thread.usage = { usedTokens: 30_000, modelContextWindow: 475_000 };
    await emit("thread.idle");
    await vi.advanceTimersByTimeAsync(40 * MIN);
    // The next turn re-reads the new, short context: a cache miss by design.
    thread.status = "active";
    await emit("thread.active");
    thread.rows.push({
      type: "thread/tokenUsage/updated",
      createdAt: Date.now(),
      data: { tokenUsage: { last: { inputTokens: 30_000, cachedInputTokens: 0 }, promptCacheTtlMs: null } },
    });
    thread.status = "idle";
    await emit("thread.idle");
    expect(kv.get("observations:codex")).toBeUndefined();
  });
});
