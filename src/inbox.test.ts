import { describe, expect, it } from "vitest";
import { filedInInbox, type InboxRow } from "./inbox.js";

const NOW = 1_000_000;
const FILED = NOW - 100;
const BEFORE = FILED - 1;
const row = (fields: Partial<InboxRow>): InboxRow => ({
  threadId: "t1",
  settledAt: null,
  snoozedUntil: null,
  ...fields,
});

describe("filedInInbox", () => {
  it("is false without a row", () => {
    expect(filedInInbox(undefined, BEFORE, NOW)).toBe(false);
  });

  it("is true for a settled thread with nothing new since", () => {
    expect(filedInInbox(row({ settledAt: FILED }), BEFORE, NOW)).toBe(true);
    expect(filedInInbox(row({ settledAt: FILED }), FILED, NOW)).toBe(true);
    expect(filedInInbox(row({ settledAt: FILED, settledOverride: "settled" }), BEFORE, NOW)).toBe(true);
  });

  it("is false when the user kept the thread active", () => {
    expect(filedInInbox(row({ settledOverride: "active" }), BEFORE, NOW)).toBe(false);
    expect(filedInInbox(row({ settledAt: FILED, settledOverride: "active" }), BEFORE, NOW)).toBe(false);
  });

  it("is true for a parked thread with nothing new since", () => {
    expect(filedInInbox(row({ parkedAt: FILED }), BEFORE, NOW)).toBe(true);
  });

  it("is false once newer attention un-settled or un-parked the thread", () => {
    expect(filedInInbox(row({ settledAt: FILED }), FILED + 1, NOW)).toBe(false);
    expect(filedInInbox(row({ parkedAt: FILED }), FILED + 1, NOW)).toBe(false);
  });

  it("is true only while a snooze lasts and has not woken", () => {
    expect(filedInInbox(row({ snoozedUntil: NOW + 1, snoozedAt: FILED }), BEFORE, NOW)).toBe(true);
    expect(filedInInbox(row({ snoozedUntil: NOW, snoozedAt: FILED }), BEFORE, NOW)).toBe(false);
    expect(filedInInbox(row({ snoozedUntil: NOW + 1, snoozedAt: FILED }), FILED + 1, NOW)).toBe(false);
  });

  it("lets a snooze decide over an older settle, as Thread Inbox does", () => {
    expect(filedInInbox(row({ settledAt: FILED, snoozedUntil: NOW, snoozedAt: FILED }), BEFORE, NOW)).toBe(false);
  });
});
