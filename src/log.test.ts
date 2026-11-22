import { describe, expect, it } from "vitest";
import {
  addEntry,
  awaitingReturn,
  fillReturnUsage,
  LOG_RETENTION_MS,
  type LogEntry,
  MAX_ENTRIES,
  markReturned,
  STATS_WINDOW_MS,
  stats,
} from "./log.js";

const DAY = 24 * 60 * 60_000;
const entry = (over: Partial<LogEntry> = {}): LogEntry => ({
  threadId: "t1",
  provider: "codex",
  kind: "warm",
  tokensBefore: 400_000,
  tokensAfter: 60_000,
  at: 1_000,
  returnedAt: null,
  returnInputTokens: null,
  returnCachedInputTokens: null,
  ...over,
});

describe("addEntry", () => {
  it("drops entries older than 90 days and caps the list", () => {
    const now = 100 * DAY;
    const old = entry({ at: now - LOG_RETENTION_MS - 1 });
    const kept = entry({ at: now - LOG_RETENTION_MS });
    expect(addEntry([old, kept], entry({ at: now }), now)).toHaveLength(2);
    const many = Array.from({ length: MAX_ENTRIES }, (_, i) => entry({ at: now - i }));
    const next = addEntry(many, entry({ at: now, threadId: "last" }), now);
    expect(next).toHaveLength(MAX_ENTRIES);
    expect(next.at(-1)?.threadId).toBe("last");
  });
});

describe("awaitingReturn and markReturned", () => {
  it("tracks only the thread's latest compaction until the next turn", () => {
    const log = [entry({ at: 1 }), entry({ threadId: "t2", at: 2 }), entry({ at: 3 })];
    expect(awaitingReturn(log, "t1")?.at).toBe(3);
    const returned = markReturned(log, "t1", 50);
    expect(returned?.[2]?.returnedAt).toBe(50);
    expect(returned?.[0]?.returnedAt).toBeNull();
    expect(awaitingReturn(returned ?? [], "t1")).toBeNull();
    expect(markReturned(returned ?? [], "t1", 60)).toBeNull();
    expect(awaitingReturn(log, "unknown")).toBeNull();
  });
});

describe("fillReturnUsage", () => {
  it("records the first request after returning", () => {
    const log = [entry({ returnedAt: 100 })];
    const rows = [
      { createdAt: 300, inputTokens: 70_000, cachedInputTokens: 65_000 },
      { createdAt: 200, inputTokens: 62_000, cachedInputTokens: 0 },
      { createdAt: 50, inputTokens: 400_000, cachedInputTokens: 390_000 },
    ];
    const next = fillReturnUsage(log, "t1", rows);
    expect(next?.[0]?.returnInputTokens).toBe(62_000);
    expect(next?.[0]?.returnCachedInputTokens).toBe(0);
    expect(fillReturnUsage(next ?? [], "t1", rows)).toBeNull();
  });
  it("waits for a return and for a report after it", () => {
    expect(fillReturnUsage([entry()], "t1", [{ createdAt: 5_000, inputTokens: 1, cachedInputTokens: 0 }])).toBeNull();
    expect(fillReturnUsage([entry({ returnedAt: 100 })], "t1", [])).toBeNull();
  });
});

describe("stats", () => {
  it("counts the last 30 days and only returned compactions as tokens not re-read", () => {
    const now = 40 * DAY;
    const log = [
      entry({ at: now - STATS_WINDOW_MS - 1, returnedAt: 1 }),
      entry({ at: now - DAY, returnedAt: now }),
      entry({ at: now - DAY, kind: "cold", tokensBefore: 200_000, tokensAfter: 50_000, returnedAt: now }),
      entry({ at: now - DAY, kind: "manual" }),
    ];
    expect(stats(log, now)).toEqual({
      compactions: 3,
      tokensNotReRead: 340_000 + 150_000,
      beforeExpiry: 1,
      onReturn: 1,
      manual: 1,
    });
    expect(stats([], now).compactions).toBe(0);
  });
});
