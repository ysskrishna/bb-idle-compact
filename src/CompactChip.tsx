// The composer pill: "Auto-compacts in 23m", "Compact 412K", "Compacting
// 412K...", or "Compacted 412K -> 68K, 1h ago". Nothing shows below the
// threshold or on unsupported providers.
import { useComposer, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Icon } from "../components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import type { rpcContract, ThreadStatus } from "./contract";
import { formatAgo, formatDuration, formatTokens, minutesUntil, pluralMinutes } from "./format";
import "./chip.css";

const STATUS_CHANGED = "status-changed";

function useThreadStatus(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<ThreadStatus | null>(null);
  // Replies can arrive out of order; only the latest request may set the state.
  const latest = useRef(0);
  const refetch = useCallback(() => {
    const request = ++latest.current;
    if (threadId === null) {
      setStatus(null);
      return;
    }
    rpc.call("thread_status", { threadId }).then(
      (next) => {
        if (request === latest.current) setStatus(next);
      },
      () => {
        if (request === latest.current) setStatus(null);
      },
    );
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  useRealtime(STATUS_CHANGED, (payload: unknown) => {
    const changed = (payload as { threadId?: string } | null)?.threadId;
    if (changed === undefined || changed === threadId) refetch();
  });
  // Re-check right after the cache expires, so the pill turns red on time.
  const expiresAt = status?.state === "scheduled" ? status.expiresAt : null;
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setTimeout(refetch, Math.max(0, expiresAt - Date.now()) + 1000);
    return () => clearTimeout(timer);
  }, [expiresAt, refetch]);
  return { rpc, status, refetch };
}

/** The current time, updated every `ms`, for countdowns and "ago" labels. */
function useNow(ms: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

function errorDetail(error: unknown): string | undefined {
  return (error instanceof Error && error.message.replace(/^HTTP \d+: /, "").trim()) || undefined;
}

export function CompactChip() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const { rpc, status, refetch } = useThreadStatus(threadId);
  const now = useNow(30_000);
  const [pending, setPending] = useState(false);
  if (threadId === null || status === null || status.state === "none") return null;

  if (status.state === "compacting" || (pending && (status.state === "scheduled" || status.state === "expired"))) {
    return (
      <span role="status" className="idle-compact-pill idle-compact-busy" aria-disabled="true">
        <span aria-hidden="true" className="idle-compact-spinner" />
        Compacting {formatTokens(status.usedTokens)}...
      </span>
    );
  }
  if (status.state === "compacted") {
    const label = `Compacted ${formatTokens(status.tokensBefore)} → ${formatTokens(status.tokensAfter)}, ${formatAgo(status.at, now)}`;
    return (
      <span role="status" className="idle-compact-pill idle-compact-done">
        <Icon name="Check" aria-hidden className="size-3.5" />
        {label}
      </span>
    );
  }
  if (composer.isRunning) return null;

  const compact = () => {
    setPending(true);
    rpc
      .call("compact_now", { threadId })
      .then(
        (result) => {
          if (!result.ok) toast.error("Could not compact this thread", { description: result.message ?? undefined });
        },
        (error) => toast.error("Could not compact this thread", { description: errorDetail(error) }),
      )
      .finally(() => {
        setPending(false);
        refetch();
      });
  };

  const tokens = formatTokens(status.usedTokens);
  if (status.state === "scheduled") {
    const warmFor = minutesUntil(status.expiresAt, now);
    const margin = Math.max(0, Math.round((status.expiresAt - status.warmAt) / 60_000));
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button" className="idle-compact-pill idle-compact-scheduled" onClick={compact}>
            <Icon name="Clock" aria-hidden className="size-3.5" />
            Auto-compacts in {formatDuration(minutesUntil(status.warmAt, now))}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          <p className="font-medium">
            Prompt cache warm for {warmFor} more {warmFor === 1 ? "minute" : "minutes"}.
          </p>
          <p>
            If you stay away, this thread is compacted {pluralMinutes(margin)} before the cache expires, while the
            compaction can still read cached tokens. Click to compact {tokens} now.
          </p>
        </TooltipContent>
      </Tooltip>
    );
  }
  const expiredAgo = Math.max(0, Math.floor((now - status.expiresAt) / 60_000));
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="idle-compact-pill idle-compact-alert" onClick={compact}>
          <Icon name="Archive" aria-hidden className="size-3.5" />
          Compact {tokens}
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">
          Prompt cache expired {expiredAgo < 1 ? "just now" : `${pluralMinutes(expiredAgo)} ago`}.
        </p>
        <p>
          Your next message re-reads all {tokens} tokens without the cache. Compact first to send a much smaller
          context.
        </p>
      </TooltipContent>
    </Tooltip>
  );
}
