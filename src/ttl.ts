// Learns Codex's real prompt cache lifetime from what the first request after
// an idle gap reports: a large cached share means the cache survived the gap.

import { CODEX_DEFAULT_TTL_MS } from "./policy.js";

export interface Observation {
  gapMs: number;
  hit: boolean;
  at: number;
}

/** Gaps shorter than this say nothing about the lifetime. */
const MIN_GAP_MS = 5 * 60_000;
/** Hits needed beyond the default before trusting a longer lifetime. */
const MIN_HITS_BEYOND_DEFAULT = 3;
export const MAX_OBSERVATIONS = 50;
/** Below this many input tokens, providers do not cache at all. */
const MIN_INPUT_TOKENS = 1024;

/** A request counts as a cache hit when at least half its input was cached. */
export function observe(gapMs: number, inputTokens: number, cachedInputTokens: number, at: number): Observation | null {
  if (gapMs < MIN_GAP_MS || inputTokens < MIN_INPUT_TOKENS) return null;
  return { gapMs, hit: cachedInputTokens / inputTokens >= 0.5, at };
}

export function addObservation(list: readonly Observation[], next: Observation): Observation[] {
  return [...list, next].slice(-MAX_OBSERVATIONS);
}

/** Hits after gaps beyond the default, ignoring hits at or beyond the shortest miss. */
function longGapHits(list: readonly Observation[]): Observation[] {
  const shortestMiss = Math.min(...list.filter((o) => !o.hit).map((o) => o.gapMs), Number.POSITIVE_INFINITY);
  return list.filter((o) => o.hit && o.gapMs < shortestMiss && o.gapMs > CODEX_DEFAULT_TTL_MS);
}

/**
 * The longest gap that still hit, once enough long-gap hits are seen;
 * null keeps the default.
 */
export function estimateTtl(list: readonly Observation[]): number | null {
  const beyond = longGapHits(list);
  if (beyond.length < MIN_HITS_BEYOND_DEFAULT) return null;
  return Math.max(...beyond.map((o) => o.gapMs));
}

/** What the settings page shows next to the Codex cache lifetime. */
export function summarize(list: readonly Observation[]): {
  learnedMinutes: number | null;
  longGapHits: number;
  longGapHitsNeeded: number;
} {
  const estimate = estimateTtl(list);
  return {
    learnedMinutes: estimate === null ? null : Math.round(estimate / 60_000),
    longGapHits: longGapHits(list).length,
    longGapHitsNeeded: MIN_HITS_BEYOND_DEFAULT,
  };
}
