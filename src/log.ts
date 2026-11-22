// The compaction log: one entry per compaction this plugin ran. It feeds the
// "Compacted" pill, the settings page's 30-day stats, and the gains audit.
// Pure functions only; the server stores the list in plugin storage.
import type { Provider } from "./policy.js";

export type CompactionKind = "warm" | "cold" | "manual";

export interface LogEntry {
  threadId: string;
  provider: Provider;
  kind: CompactionKind;
  tokensBefore: number;
  tokensAfter: number;
  /** When the compaction finished. */
  at: number;
  /** When the next turn after the compaction started; null until then. */
  returnedAt: number | null;
  /** The first request after returning: its input and how much of it was cached. */
  returnInputTokens: number | null;
  returnCachedInputTokens: number | null;
}

export const LOG_RETENTION_MS = 90 * 24 * 60 * 60_000;
export const STATS_WINDOW_MS = 30 * 24 * 60 * 60_000;
/** Keeps the stored list well under BB's 256 KB limit per storage value. */
export const MAX_ENTRIES = 600;

function prune(entries: readonly LogEntry[], now: number): LogEntry[] {
  return entries.filter((entry) => now - entry.at <= LOG_RETENTION_MS).slice(-MAX_ENTRIES);
}

export function addEntry(entries: readonly LogEntry[], entry: LogEntry, now: number): LogEntry[] {
  return prune([...entries, entry], now);
}

function latestIndex(entries: readonly LogEntry[], threadId: string): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]?.threadId === threadId) return i;
  }
  return -1;
}

/** The thread's latest compaction while nobody has sent a message since. */
export function awaitingReturn(entries: readonly LogEntry[], threadId: string): LogEntry | null {
  const entry = entries[latestIndex(entries, threadId)];
  return entry !== undefined && entry.returnedAt === null ? entry : null;
}

/** A new turn started: the thread's latest compaction is no longer news. */
export function markReturned(entries: readonly LogEntry[], threadId: string, now: number): LogEntry[] | null {
  const index = latestIndex(entries, threadId);
  const entry = entries[index];
  if (entry === undefined || entry.returnedAt !== null) return null;
  return entries.map((e, i) => (i === index ? { ...e, returnedAt: now } : e));
}

interface UsageRow {
  createdAt: number;
  inputTokens: number;
  cachedInputTokens: number;
}

/**
 * Record what the first request after returning read. `rows` are the
 * thread's token usage reports, newest first.
 */
export function fillReturnUsage(
  entries: readonly LogEntry[],
  threadId: string,
  rows: readonly UsageRow[],
): LogEntry[] | null {
  const index = latestIndex(entries, threadId);
  const entry = entries[index];
  if (entry === undefined || entry.returnedAt === null || entry.returnInputTokens !== null) return null;
  const returnedAt = entry.returnedAt;
  const first = rows.filter((row) => row.createdAt >= returnedAt).at(-1);
  if (first === undefined) return null;
  return entries.map((e, i) =>
    i === index ? { ...e, returnInputTokens: first.inputTokens, returnCachedInputTokens: first.cachedInputTokens } : e,
  );
}

interface LogStats {
  compactions: number;
  /** Context tokens the next message did not have to read, over compactions someone returned to. */
  tokensNotReRead: number;
  beforeExpiry: number;
  onReturn: number;
  manual: number;
}

export function stats(entries: readonly LogEntry[], now: number): LogStats {
  const recent = entries.filter((entry) => now - entry.at <= STATS_WINDOW_MS);
  return {
    compactions: recent.length,
    tokensNotReRead: recent
      .filter((entry) => entry.returnedAt !== null)
      .reduce((sum, entry) => sum + Math.max(0, entry.tokensBefore - entry.tokensAfter), 0),
    beforeExpiry: recent.filter((entry) => entry.kind === "warm").length,
    onReturn: recent.filter((entry) => entry.kind === "cold").length,
    manual: recent.filter((entry) => entry.kind === "manual").length,
  };
}
