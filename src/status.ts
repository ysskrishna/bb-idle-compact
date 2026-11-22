// What the composer shows for one thread. Pure, so every state is unit-tested.
import type { ThreadStatus } from "./contract.js";
import type { LogEntry } from "./log.js";
import { evaluate, type Settings, type ThreadFacts, warmDelayMs } from "./policy.js";

export interface StatusInput {
  settings: Settings;
  /** The thread is idle (not running a turn). */
  idle: boolean;
  /** Context size when this plugin started a compaction that is still running; else null. */
  compactingTokens: number | null;
  /** The thread's latest compaction, if nobody has sent a message since. */
  awaiting: LogEntry | null;
  /** Null for unsupported providers or threads without usage. */
  facts: ThreadFacts | null;
  /** BB's own compactExpiredCache experiment offers compaction for this thread. */
  builtinOffer: boolean;
  now: number;
}

export function threadStatus(input: StatusInput): ThreadStatus {
  const { settings, facts } = input;
  if (input.compactingTokens !== null) return { state: "compacting", usedTokens: input.compactingTokens };
  if (input.awaiting !== null) {
    return {
      state: "compacted",
      tokensBefore: input.awaiting.tokensBefore,
      tokensAfter: input.awaiting.tokensAfter,
      at: input.awaiting.at,
    };
  }
  if (!input.idle || facts === null) return { state: "none" };
  const verdict = evaluate(facts, settings, input.now);
  if (!verdict.qualifies || verdict.expiresAt === null) return { state: "none" };
  if (verdict.expired) {
    // BB's own chip already offers to compact Claude Code threads on return.
    if (facts.provider === "claude" && input.builtinOffer) return { state: "none" };
    return { state: "expired", usedTokens: facts.usedTokens, expiresAt: verdict.expiresAt };
  }
  const delay = warmDelayMs(facts.ttlMs, settings);
  if (!settings.warmIdle || delay === null || facts.lastUsageAt === null) return { state: "none" };
  return {
    state: "scheduled",
    usedTokens: facts.usedTokens,
    warmAt: facts.lastUsageAt + delay,
    expiresAt: verdict.expiresAt,
  };
}
