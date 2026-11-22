// Learns Codex's real prompt cache lifetime from what the first request after
// an idle gap reports: a large cached share means the cache survived the gap.

import { CODEX_DEFAULT_TTL_MS } from "./policy.js";

export interface Observation {
  gapMs: number;
  hit: boolean;
  at: number;
}

/** Gaps shorter than this say nothing about the lifetime. */
export const MIN_GAP_MS = 5 * 60_000;
/** Hits needed beyond the default before trusting a longer lifetime. */
export const MIN_HITS_BEYOND_DEFAULT = 3;
export const MAX_OBSERVATIONS = 50;
/** Below this many input tokens, providers do not cache at all. */
const MIN_INPUT_TOKENS = 1024;

/** A request counts as a cache hit when at least half its input was cached. */
export function observe(
  gapMs: number,
  inputTokens: number,
  cachedInputTokens: number,
  at: number,
): Observation | null {
  if (gapMs < MIN_GAP_MS || inputTokens < MIN_INPUT_TOKENS) return null;
  return { gapMs, hit: cachedInputTokens / inputTokens >= 0.5, at };
}

export function addObservation(
  list: readonly Observation[],
  next: Observation,
): Observation[] {
  return [...list, next].slice(-MAX_OBSERVATIONS);
}

/**
 * The longest gap that still hit, ignoring hits at or beyond the shortest
 * miss. Only moves above the default after enough hits beyond it; returns
 * null to keep the default.
 */
export function estimateTtl(list: readonly Observation[]): number | null {
  const shortestMiss = Math.min(
    ...list.filter((o) => !o.hit).map((o) => o.gapMs),
    Number.POSITIVE_INFINITY,
  );
  const hits = list.filter((o) => o.hit && o.gapMs < shortestMiss);
  const beyond = hits.filter((o) => o.gapMs > CODEX_DEFAULT_TTL_MS);
  if (beyond.length < MIN_HITS_BEYOND_DEFAULT) return null;
  return Math.max(...beyond.map((o) => o.gapMs));
}

/** Counts shown in settings next to the learned value. */
export function summarize(list: readonly Observation[]): {
  hits: number;
  misses: number;
  estimateMs: number | null;
} {
  return {
    hits: list.filter((o) => o.hit).length,
    misses: list.filter((o) => !o.hit).length,
    estimateMs: estimateTtl(list),
  };
}
