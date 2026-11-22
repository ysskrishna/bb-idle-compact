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
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          status: thread.status,
          archivedAt: thread.archivedAt,
          providerId: "codex",
        }),
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
  return { bb, rpc, thread, emit, send, rechecks, kv };
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
