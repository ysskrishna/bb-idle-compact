// Reads Thread Inbox's shelf rows through its `listLifecycle` RPC. Thread Inbox
// is optional: when it is not installed, not enabled, or broken, nothing
// counts as filed and compaction works as before. When it is starting or
// running but does not answer, a thread counts as filed: skipping one
// background compaction is cheaper than reopening a thread the user filed.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { filedInInbox, INBOX_PLUGIN_ID, type InboxRow } from "./inbox.js";

const RPC_TIMEOUT_MS = 5_000;
/** Deeper trees than this are not walked; BB nests delegated threads a few levels at most. */
const MAX_DEPTH = 20;
/** Plugin states in which Thread Inbox should answer soon. Others will not answer until the user acts. */
const ANSWERING = new Set(["starting", "running", "degraded"]);

const lifecycleSchema = z
  .object({
    rows: z.array(
      z
        .object({
          threadId: z.string(),
          settledAt: z.number().nullable(),
          settledOverride: z.enum(["active", "settled"]).nullable().optional(),
          parkedAt: z.number().nullable().optional(),
          snoozedUntil: z.number().nullable(),
          snoozedAt: z.number().nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export function createInboxReader(bb: BbPluginApi) {
  // The pill asks on every refresh; say each thing once per load.
  const reported = new Set<string>();
  function reportOnce(level: "info" | "warn", message: string) {
    if (reported.has(level)) return;
    reported.add(level);
    bb.log[level](message);
  }

  async function inboxInUse(): Promise<boolean> {
    const { plugins } = await bb.sdk.plugins.list();
    return plugins.some((plugin) => plugin.id === INBOX_PLUGIN_ID && plugin.enabled && ANSWERING.has(plugin.status));
  }

  /** Thread Inbox's rows by thread, or null when Thread Inbox is not in use. Throws when it cannot tell. */
  async function readRows(): Promise<Map<string, InboxRow> | null> {
    try {
      const { rows } = await bb.sdk.plugins.callRpc({
        pluginId: INBOX_PLUGIN_ID,
        method: "listLifecycle",
        input: {},
        outputSchema: lifecycleSchema,
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
      return new Map(rows.map((row) => [row.threadId, row]));
    } catch (error) {
      if (!(await inboxInUse())) {
        reportOnce("info", "Thread Inbox is not running; background compaction does not check its shelves");
        return null;
      }
      throw error;
    }
  }

  return {
    /**
     * Whether Thread Inbox shows this thread, or a thread above it, as settled,
     * parked, or snoozed. Thread Inbox shows a child on its root's shelf and
     * wakes the ancestors when the child starts a turn, so a filed ancestor
     * keeps the whole tree quiet.
     */
    async isFiled(threadId: string): Promise<boolean> {
      let rows: Map<string, InboxRow> | null;
      try {
        rows = await readRows();
      } catch (error) {
        reportOnce("warn", `could not read Thread Inbox shelves, skipping background compaction: ${String(error)}`);
        return true;
      }
      if (rows === null) return false;
      const now = Date.now();
      const seen = new Set<string>();
      let id: string | null = threadId;
      while (id !== null && !seen.has(id) && seen.size < MAX_DEPTH) {
        seen.add(id);
        let thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>;
        try {
          thread = await bb.sdk.threads.get({ threadId: id });
        } catch {
          // Thread Inbox also stops at an ancestor it cannot load.
          return false;
        }
        // Thread Inbox stops waking at an archived or deleted ancestor.
        if (id !== threadId && (thread.archivedAt !== null || thread.deletedAt !== null)) return false;
        if (filedInInbox(rows.get(id), thread.latestAttentionAt, now)) return true;
        id = thread.parentThreadId;
      }
      return false;
    },
  };
}
