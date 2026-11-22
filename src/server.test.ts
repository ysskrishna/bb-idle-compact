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
  const thread = {
    status: "idle",
    usage: null as { usedTokens: number; modelContextWindow: number } | null,
    rows: [] as Row[],
    compacted: [] as string[],
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
    experimental_hooks: { on: () => {}, recheck: async () => {} },
    events: { on: (name: string, fn: (payload: unknown) => unknown) => handlers.set(name, fn) },
    rpc: { register: (_contract: unknown, fns: typeof rpc) => Object.assign(rpc, fns) },
    onDispose: () => {},
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          status: thread.status,
          providerId: "codex",
        }),
        context: async () => ({ usage: thread.usage }),
        compact: async ({ threadId }: { threadId: string }) => {
          thread.compacted.push(threadId);
          thread.status = "active";
        },
        events: {
          list: async ({ types }: { types: string[] }) =>
            thread.rows.filter((row) => types.includes(row.type)).sort((a, b) => b.createdAt - a.createdAt),
        },
      },
    },
  } as unknown as BbPluginApi;
  const emit = async (name: string) => {
    await handlers.get(name)?.({ thread: { id: "t1", providerId: "codex", status: thread.status } });
  };
  return { bb, rpc, thread, emit };
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
});
