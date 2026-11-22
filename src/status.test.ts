import { describe, expect, it } from "vitest";
import type { LogEntry } from "./log.js";
import { DEFAULT_SETTINGS, type Settings, type ThreadFacts } from "./policy.js";
import { type StatusInput, threadStatus } from "./status.js";

const MIN = 60_000;
const facts: ThreadFacts = {
  provider: "codex",
  usedTokens: 412_000,
  contextWindow: 475_000,
  lastUsageAt: 0,
  ttlMs: 30 * MIN,
};
const input = (over: Partial<StatusInput> = {}, settings: Partial<Settings> = {}): StatusInput => ({
  settings: { ...DEFAULT_SETTINGS, ...settings },
  idle: true,
  compactingTokens: null,
  awaiting: null,
  facts,
  builtinOffer: false,
  now: 2 * MIN,
  ...over,
});
const compacted: LogEntry = {
  threadId: "t1",
  provider: "codex",
  kind: "warm",
  tokensBefore: 412_000,
  tokensAfter: 68_000,
  at: 5,
  returnedAt: null,
  returnInputTokens: null,
  returnCachedInputTokens: null,
};

describe("threadStatus", () => {
  it("A: schedules a warm compaction the margin before expiry", () => {
    expect(threadStatus(input())).toEqual({
      state: "scheduled",
      usedTokens: 412_000,
      warmAt: 25 * MIN,
      expiresAt: 30 * MIN,
    });
  });
  it("shows no countdown when compacting before expiry is off or impossible", () => {
    expect(threadStatus(input({}, { warmIdle: false }))).toEqual({ state: "none" });
    expect(threadStatus(input({}, { idleMarginMinutes: 30 }))).toEqual({ state: "none" });
  });
  it("B: offers to compact once the cache expired", () => {
    expect(threadStatus(input({ now: 31 * MIN }))).toEqual({
      state: "expired",
      usedTokens: 412_000,
      expiresAt: 30 * MIN,
    });
    expect(threadStatus(input({ now: 31 * MIN }, { warmIdle: false, coldReturn: false })).state).toBe("expired");
  });
  it("leaves expired Claude Code threads to BB's own offer", () => {
    const claude = { ...facts, provider: "claude" as const, contextWindow: 1_000_000 };
    expect(threadStatus(input({ facts: claude, now: 31 * MIN, builtinOffer: true }))).toEqual({ state: "none" });
    expect(threadStatus(input({ facts: claude, now: 31 * MIN })).state).toBe("expired");
  });
  it("C and D: compacting, then compacted until the next message", () => {
    expect(threadStatus(input({ compactingTokens: 412_000, idle: false }))).toEqual({
      state: "compacting",
      usedTokens: 412_000,
    });
    expect(threadStatus(input({ awaiting: compacted }))).toEqual({
      state: "compacted",
      tokensBefore: 412_000,
      tokensAfter: 68_000,
      at: 5,
    });
  });
  it("shows nothing when off, running, small, unsupported, or never used", () => {
    expect(threadStatus(input({}, { enabled: false }))).toEqual({ state: "none" });
    expect(threadStatus(input({ idle: false }))).toEqual({ state: "none" });
    expect(threadStatus(input({ facts: { ...facts, usedTokens: 90_000 } }))).toEqual({ state: "none" });
    expect(threadStatus(input({}, { threshold: 90 }))).toEqual({ state: "none" });
    expect(threadStatus(input({ facts: null }))).toEqual({ state: "none" });
    expect(threadStatus(input({ facts: { ...facts, lastUsageAt: null } }))).toEqual({ state: "none" });
  });
});
