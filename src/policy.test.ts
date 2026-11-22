import { describe, expect, it } from "vitest";
import {
  CLAUDE_FALLBACK_TTL_MS,
  CODEX_DEFAULT_TTL_MS,
  DEFAULT_SETTINGS,
  evaluate,
  providerOf,
  type Settings,
  thresholdFor,
  ttlFor,
  warmDueAt,
} from "./policy.js";

const MIN = 60_000;
const s = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...over });

describe("providerOf", () => {
  it("supports Claude Code and Codex only", () => {
    expect(providerOf("claude-code")).toBe("claude");
    expect(providerOf("codex")).toBe("codex");
    expect(providerOf("acp-cursor")).toBeNull();
  });
});

describe("thresholdFor", () => {
  it("uses the global threshold unless a provider override is set", () => {
    expect(thresholdFor(s({ threshold: 30 }), "claude")).toBe(30);
    expect(thresholdFor(s({ threshold: 30, codexThreshold: 60 }), "codex")).toBe(60);
    expect(thresholdFor(s({ threshold: 30, codexThreshold: 60 }), "claude")).toBe(30);
  });
});

describe("ttlFor", () => {
  it("trusts Claude's reported lifetime and falls back to 5 minutes", () => {
    expect(ttlFor("claude", s(), 60 * MIN, null)).toBe(60 * MIN);
    expect(ttlFor("claude", s(), null, 12 * 60 * MIN)).toBe(CLAUDE_FALLBACK_TTL_MS);
  });
  it("prefers the Codex setting, then the learned value, then 30 minutes", () => {
    expect(ttlFor("codex", s({ codexTtlMinutes: 10 }), null, 12 * 60 * MIN)).toBe(10 * MIN);
    expect(ttlFor("codex", s(), null, 12 * 60 * MIN)).toBe(12 * 60 * MIN);
    expect(ttlFor("codex", s(), null, null)).toBe(CODEX_DEFAULT_TTL_MS);
  });
});

describe("evaluate", () => {
  const base = {
    provider: "codex" as const,
    usedTokens: 200_000,
    contextWindow: 475_000,
    lastUsageAt: 1_000_000,
    ttlMs: 30 * MIN,
  };
  it("qualifies at or above the threshold and the 100K floor", () => {
    expect(evaluate(base, s({ threshold: 40 }), 0).qualifies).toBe(true);
    expect(evaluate(base, s({ threshold: 50 }), 0).qualifies).toBe(false);
    const small = { ...base, usedTokens: 99_000, contextWindow: 200_000 };
    expect(evaluate(small, s({ threshold: 20 }), 0).qualifies).toBe(false);
  });
  it("reports expiry from the last usage plus the lifetime", () => {
    const v = evaluate(base, s(), base.lastUsageAt + 30 * MIN - 1);
    expect(v.expiresAt).toBe(base.lastUsageAt + 30 * MIN);
    expect(v.expired).toBe(false);
    expect(evaluate(base, s(), base.lastUsageAt + 30 * MIN).expired).toBe(true);
  });
  it("never reports expiry without recorded usage", () => {
    const v = evaluate({ ...base, lastUsageAt: null }, s(), Number.MAX_SAFE_INTEGER);
    expect(v.expiresAt).toBeNull();
    expect(v.expired).toBe(false);
  });
});

describe("warmDueAt", () => {
  it("compacts the margin before expiry, or not at all when there is no room", () => {
    expect(warmDueAt(0, 60 * MIN, s({ idleMarginMinutes: 5 }), 0)).toBe(55 * MIN);
    expect(warmDueAt(0, 5 * MIN, s({ idleMarginMinutes: 5 }), 0)).toBeNull();
  });
  it("needs a known last use, the switch on, and a cache that has not expired", () => {
    expect(warmDueAt(null, 60 * MIN, s(), 0)).toBeNull();
    expect(warmDueAt(0, 60 * MIN, s({ warmIdle: false }), 0)).toBeNull();
    expect(warmDueAt(0, 60 * MIN, s(), 60 * MIN)).toBeNull();
    expect(warmDueAt(0, 60 * MIN, s(), 57 * MIN)).toBe(55 * MIN);
  });
});
