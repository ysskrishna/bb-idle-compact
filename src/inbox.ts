// Thread Inbox (bb-thread-inbox) lets the user file a thread away: settle,
// park, or snooze it. A background compaction runs as a turn, which would
// bring such a thread back to Active and notify, so warm compaction skips it.

export const INBOX_PLUGIN_ID = "bb-thread-inbox";

/** The fields of a Thread Inbox `listLifecycle` row that decide its shelf. */
export interface InboxRow {
  threadId: string;
  settledAt: number | null;
  settledOverride?: "active" | "settled" | null;
  parkedAt?: number | null;
  snoozedUntil: number | null;
  snoozedAt?: number | null;
}

/**
 * Whether Thread Inbox shows this row's thread as settled, parked, or snoozed.
 * Mirrors its shelf rule: attention newer than the filing brings a thread back
 * to Active, and a snooze ends at its wake time.
 */
export function filedInInbox(row: InboxRow | undefined, latestAttentionAt: number, now: number): boolean {
  if (row === undefined) return false;
  // A snooze decides on its own: once woken or past its time, the thread is Active.
  if (row.snoozedUntil !== null) {
    const woke = row.snoozedAt != null && latestAttentionAt > row.snoozedAt;
    return !woke && row.snoozedUntil > now;
  }
  if (row.parkedAt != null) return latestAttentionAt <= row.parkedAt;
  if (row.settledAt !== null && row.settledOverride !== "active") return latestAttentionAt <= row.settledAt;
  return false;
}
