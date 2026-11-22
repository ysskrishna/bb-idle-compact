// Reads what the policy needs about one thread from BB.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { providerOf, type Settings, type ThreadFacts, ttlFor } from "./policy.js";

export interface TokenUsageRow {
  createdAt: number;
  inputTokens: number;
  cachedInputTokens: number;
  promptCacheTtlMs: number | null;
}

/** Token usage rows, newest first. */
export async function tokenUsage(
  bb: BbPluginApi,
  threadId: string,
  limit: number,
): Promise<TokenUsageRow[]> {
  const rows = await bb.sdk.threads.events.list({
    threadId,
    types: ["thread/tokenUsage/updated"],
    order: "desc",
    limit: String(limit),
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

export interface LoadedFacts {
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
  const provider = providerOf(providerId);
  if (provider === null) return null;
  const [context, usage] = await Promise.all([
    bb.sdk.threads.context({ threadId }),
    tokenUsage(bb, threadId, 1),
  ]);
  if (context.usage === null) return null;
  const last = usage[0] ?? null;
  return {
    facts: {
      provider,
      usedTokens: context.usage.usedTokens,
      contextWindow: context.usage.modelContextWindow,
      lastUsageAt: last?.createdAt ?? null,
      ttlMs: ttlFor(
        provider,
        settings,
        last?.promptCacheTtlMs ?? null,
        learnedTtlMs,
      ),
    },
    builtinOffer: context.usage.compactionOfferAt !== undefined,
  };
}
