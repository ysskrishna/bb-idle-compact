// RPC contract shared by the server and app. The app imports its type only.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const threadStatusSchema = z.object({
  /** Show the composer button: the cache expired and the context qualifies. */
  show: z.boolean(),
  usedPct: z.number(),
  usedTokens: z.number(),
  thresholdPct: z.number(),
  /** When the cache expires (or expired), epoch ms; null when unknown. */
  expiresAt: z.number().nullable(),
  compacting: z.boolean(),
});
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const rpcContract = defineRpcContract({
  thread_status: {
    input: z.object({ threadId: z.string() }),
    output: threadStatusSchema,
  },
  compact_now: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },
});

/** Realtime channel: a thread's status may have changed; payload { threadId }. */
export const STATUS_CHANGED = "status-changed";
