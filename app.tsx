// Cache Compact frontend: a Compact button in the thread composer, with a red
// dot, shown when the thread's prompt cache expired and its context qualifies.
import { useCallback, useEffect, useState } from "react";
import {
  definePluginApp,
  useComposer,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract, ThreadStatus } from "./src/contract";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const STATUS_CHANGED = "status-changed";

function formatTokens(tokens: number): string {
  return tokens >= 1_000_000
    ? `${(tokens / 1_000_000).toFixed(1)}M`
    : `${Math.round(tokens / 1000)}K`;
}

function useThreadStatus(threadId: string | null) {
  const rpc = useRpc<typeof rpcContract>();
  const [status, setStatus] = useState<ThreadStatus | null>(null);
  const refetch = useCallback(() => {
    if (threadId === null) return;
    rpc.call("thread_status", { threadId }).then(setStatus, () => setStatus(null));
  }, [rpc, threadId]);
  useEffect(refetch, [refetch]);
  useRealtime(STATUS_CHANGED, (payload: unknown) => {
    const changed = (payload as { threadId?: string } | null)?.threadId;
    if (changed === undefined || changed === threadId) refetch();
  });
  // Re-check right after the cache expires, so the button appears on time.
  const expiresAt = status?.expiresAt ?? null;
  useEffect(() => {
    if (expiresAt === null || expiresAt <= Date.now()) return;
    const timer = setTimeout(refetch, expiresAt - Date.now() + 1000);
    return () => clearTimeout(timer);
  }, [expiresAt, refetch]);
  return { rpc, status, refetch };
}

function CompactAction() {
  const composer = useComposer();
  const threadId = composer.scope.kind === "thread" ? composer.scope.threadId : null;
  const { rpc, status, refetch } = useThreadStatus(threadId);
  const [pending, setPending] = useState(false);
  if (threadId === null || status === null || !status.show || composer.isRunning) {
    return null;
  }
  const label = `Prompt cache expired. Compact ${formatTokens(status.usedTokens)} tokens (${Math.round(status.usedPct)}% of the window) before your next message`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative size-8 text-muted-foreground hover:text-foreground"
          aria-label={label}
          disabled={pending}
          onClick={() => {
            setPending(true);
            rpc.call("compact_now", { threadId }).finally(() => {
              setPending(false);
              refetch();
            });
          }}
        >
          <Icon name="Archive" className="size-4" />
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 size-2 rounded-full bg-destructive ring-2 ring-background"
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "cache-compact",
    scopes: ["thread"],
    actions: [{ id: "compact", component: CompactAction }],
  });
});
