// Reads what the policy needs about one thread from BB.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { type Provider, providerOf, type Settings, type ThreadFacts, ttlFor } from "./policy.js";

interface TokenUsageRow {
  createdAt: number;
  inputTokens: number;
  cachedInputTokens: number;
  promptCacheTtlMs: number | null;
}

/** BB rejects event pages larger than this. */
export const MAX_EVENT_PAGE = 100;

/** Token usage rows, newest first, at most MAX_EVENT_PAGE. */
export async function tokenUsage(bb: BbPluginApi, threadId: string, limit: number): Promise<TokenUsageRow[]> {
  const rows = await bb.sdk.threads.events.list({
    threadId,
    types: ["thread/tokenUsage/updated"],
    order: "desc",
    limit: String(Math.min(limit, MAX_EVENT_PAGE)),
  });
  return rows.flatMap((row) =>
    row.type === "thread/tokenUsage/updated"
      ? [
          {
            createdAt: row.createdAt,
            inputTokens: row.data.tokenUsage.last.inputTokens,
            cachedInputTokens: row.data.tokenUsage.last.cachedInputTokens,
            promptCacheTtlMs: row.data.tokenUsage.promptCacheTtlMs ?? null,
          },
        ]
      : [],
  );
}

/** When the thread last reported a compaction, or null. */
export async function lastCompactedAt(bb: BbPluginApi, threadId: string): Promise<number | null> {
  const rows = await bb.sdk.threads.events.list({
    threadId,
    types: ["thread/compacted"],
    order: "desc",
    limit: "1",
  });
  return rows[0]?.createdAt ?? null;
}

async function lastTurnCompletedAt(bb: BbPluginApi, threadId: string): Promise<number | null> {
  const rows = await bb.sdk.threads.events.list({
    threadId,
    types: ["turn/completed"],
    order: "desc",
    limit: "1",
  });
  return rows[0]?.createdAt ?? null;
}

/** When the thread's prompt cache was last used, and how long it lives. */
interface Timing {
  provider: Provider;
  lastUsageAt: number | null;
  ttlMs: number;
}

/**
 * Cache timing only. It does not depend on the context size, which BB reports
 * a moment after a turn ends, so it is safe to read when the thread goes idle.
 */
export async function loadTiming(
  bb: BbPluginApi,
  threadId: string,
  providerId: string,
  settings: Settings,
  learnedTtlMs: number | null,
): Promise<Timing | null> {
  const provider = providerOf(providerId);
  if (provider === null) return null;
  const [usage, lastTurnAt] = await Promise.all([tokenUsage(bb, threadId, 1), lastTurnCompletedAt(bb, threadId)]);
  const last = usage[0] ?? null;
  // A turn's usage can be reported late or not at all, so the cache's last
  // use is the newer of the last usage report and the last finished turn.
  const times = [last?.createdAt, lastTurnAt].filter((t): t is number => typeof t === "number");
  return {
    provider,
    lastUsageAt: times.length > 0 ? Math.max(...times) : null,
    ttlMs: ttlFor(provider, settings, last?.promptCacheTtlMs ?? null, learnedTtlMs),
  };
}

interface LoadedFacts {
  facts: ThreadFacts;
  /** BB's own compactExpiredCache experiment is handling this thread's cold return. */
  builtinOffer: boolean;
}

export async function loadFacts(
  bb: BbPluginApi,
  threadId: string,
  providerId: string,
  settings: Settings,
  learnedTtlMs: number | null,
): Promise<LoadedFacts | null> {
  const [context, timing] = await Promise.all([
    bb.sdk.threads.context({ threadId }),
    loadTiming(bb, threadId, providerId, settings, learnedTtlMs),
  ]);
  if (timing === null || context.usage === null) return null;
  return {
    facts: {
      ...timing,
      usedTokens: context.usage.usedTokens,
      contextWindow: context.usage.modelContextWindow,
    },
    builtinOffer: context.usage.compactionOfferAt !== undefined,
  };
}
