// Pure decisions: which threads qualify, when their prompt cache expires, and
// when to compact. No BB APIs here, so every rule is unit-tested directly.

/** Below this many tokens, compacting costs about as much as it saves. */
const MIN_TOKENS = 100_000;
/** Claude Code reports its cache lifetime; this is the fallback when it has not yet. */
export const CLAUDE_FALLBACK_TTL_MS = 5 * 60_000;
/** Codex does not report a cache lifetime; GPT-6.x defaults to 30 minutes. */
export const CODEX_DEFAULT_TTL_MS = 30 * 60_000;

export type Provider = "claude" | "codex";

export interface Settings {
  enabled: boolean;
  threshold: number;
  warmIdle: boolean;
  coldReturn: boolean;
  claudeThreshold: number;
  codexThreshold: number;
  codexTtlMinutes: number;
  idleMarginMinutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  threshold: 20,
  warmIdle: true,
  coldReturn: true,
  claudeThreshold: 0,
  codexThreshold: 0,
  codexTtlMinutes: 0,
  idleMarginMinutes: 5,
};

/** Providers whose threads BB can compact on request. Others are ignored. */
export function providerOf(providerId: string): Provider | null {
  if (providerId === "claude-code") return "claude";
  if (providerId === "codex") return "codex";
  return null;
}

/** The provider override when set (1-100), otherwise the global threshold. */
export function thresholdFor(settings: Settings, provider: Provider): number {
  const override = provider === "claude" ? settings.claudeThreshold : settings.codexThreshold;
  return override > 0 ? override : settings.threshold;
}

/**
 * The cache lifetime to assume. Claude: what the provider reported. Codex:
 * the user's setting, else the learned estimate, else the 30 minute default.
 */
export function ttlFor(
  provider: Provider,
  settings: Settings,
  reportedTtlMs: number | null,
  learnedTtlMs: number | null,
): number {
  if (provider === "claude") return reportedTtlMs ?? CLAUDE_FALLBACK_TTL_MS;
  if (settings.codexTtlMinutes > 0) return settings.codexTtlMinutes * 60_000;
  return learnedTtlMs ?? CODEX_DEFAULT_TTL_MS;
}

export interface ThreadFacts {
  provider: Provider;
  usedTokens: number;
  contextWindow: number;
  /** When the provider last reported token usage: the last cache write or read. */
  lastUsageAt: number | null;
  ttlMs: number;
}

interface Verdict {
  usedPct: number;
  thresholdPct: number;
  /** Large enough, by the threshold and the 100K floor, to be worth compacting. */
  qualifies: boolean;
  /** When the cache expires, or null without any recorded usage. */
  expiresAt: number | null;
  expired: boolean;
}

export function evaluate(facts: ThreadFacts, settings: Settings, now: number): Verdict {
  const usedPct = facts.contextWindow > 0 ? (facts.usedTokens / facts.contextWindow) * 100 : 0;
  const thresholdPct = thresholdFor(settings, facts.provider);
  const qualifies = facts.usedTokens >= MIN_TOKENS && usedPct >= thresholdPct;
  const expiresAt = facts.lastUsageAt === null ? null : facts.lastUsageAt + facts.ttlMs;
  return {
    usedPct,
    thresholdPct,
    qualifies,
    expiresAt,
    expired: expiresAt !== null && now >= expiresAt,
  };
}

/**
 * How long after the cache's last use to compact while it is still warm, or
 * null when the margin leaves no time before expiry.
 */
export function warmDelayMs(ttlMs: number, settings: Settings): number | null {
  const delay = ttlMs - settings.idleMarginMinutes * 60_000;
  return delay > 0 ? delay : null;
}
