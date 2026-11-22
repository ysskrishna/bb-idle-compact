// Short labels shared by the server's messages and the composer pills.

/** 412K, 1.2M; small counts as they are. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(tokens / 1000)}K`;
}

/** Whole minutes until `at`, never below zero. */
export function minutesUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 60_000));
}

/** "23m", "1h 5m", "under 1m". */
export function formatDuration(minutes: number): string {
  if (minutes < 1) return "under 1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "just now", "5m ago", "1h ago", "2d ago". */
export function formatAgo(at: number, now: number): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** "1 minute", "12 minutes". */
export function pluralMinutes(minutes: number): string {
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
