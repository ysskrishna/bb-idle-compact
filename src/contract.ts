// RPC contract shared by the server and app. The app imports its types only,
// so zod stays out of the browser bundle.
import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const percent = z.number().int().min(0).max(100);

export const settingsSchema = z.object({
  enabled: z.boolean(),
  warmIdle: z.boolean(),
  coldReturn: z.boolean(),
  /** Percent of the model's context window, 1-100. */
  threshold: percent.min(1),
  /** 0 uses the global threshold. */
  claudeThreshold: percent,
  codexThreshold: percent,
  /** 0 learns the lifetime, starting at 30 minutes. */
  codexTtlMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  idleMarginMinutes: z.number().int().min(1).max(30),
});

export const threadStatusSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("none") }),
  /** Cache warm; the plugin compacts at `warmAt` if the thread stays idle. */
  z.object({ state: z.literal("scheduled"), usedTokens: z.number(), warmAt: z.number(), expiresAt: z.number() }),
  /** Cache expired and nothing compacted the thread yet. */
  z.object({ state: z.literal("expired"), usedTokens: z.number(), expiresAt: z.number() }),
  z.object({ state: z.literal("compacting"), usedTokens: z.number() }),
  /** Compacted by this plugin; nobody has sent a message since. */
  z.object({ state: z.literal("compacted"), tokensBefore: z.number(), tokensAfter: z.number(), at: z.number() }),
]);
export type ThreadStatus = z.infer<typeof threadStatusSchema>;

export const statsSchema = z.object({
  compactions: z.number(),
  tokensNotReRead: z.number(),
  beforeExpiry: z.number(),
  onReturn: z.number(),
  manual: z.number(),
  codexTtl: z.object({
    /** The learned lifetime, or null while the 30-minute default applies. */
    learnedMinutes: z.number().nullable(),
    /** Cache hits seen after gaps longer than 30 minutes. */
    longGapHits: z.number(),
    longGapHitsNeeded: z.number(),
  }),
});
export type Stats = z.infer<typeof statsSchema>;

export const rpcContract = defineRpcContract({
  thread_status: {
    input: z.object({ threadId: z.string() }),
    output: threadStatusSchema,
  },
  compact_now: {
    input: z.object({ threadId: z.string() }),
    output: z.object({ ok: z.boolean(), message: z.string().nullable() }),
  },
  get_settings: {
    input: z.object({}),
    output: settingsSchema,
  },
  update_settings: {
    input: settingsSchema.partial(),
    output: settingsSchema,
  },
  stats: {
    input: z.object({}),
    output: statsSchema,
  },
});

/** Realtime channel: a thread's status may have changed; payload { threadId } or {} for all. */
export const STATUS_CHANGED = "status-changed";
/** Realtime channel: settings or stats changed; payload {}. */
export const SETTINGS_CHANGED = "settings-changed";
