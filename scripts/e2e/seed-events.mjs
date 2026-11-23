// Thread-log events that fail a scratch seed. Agent output (item/*) or a turn
// (turn/*) means the fixture ran a provider turn, and other provider events are
// errors. Two provider events are not: warnings, and notifications BB does not
// map (provider/unhandled), which newer Codex CLIs add over time.
// An unmapped notification that reports agent activity (item/* or output
// deltas) still fails.
const TOLERATED_PROVIDER_EVENTS = new Set(["provider/warning", "provider/unhandled"]);
const agentActivity = (rawType = "") => rawType.startsWith("item/") || rawType.endsWith("/outputDelta");

export function unexpectedSeedEvents(events) {
  return events.filter(({ type, data }) => {
    if (type.startsWith("item/") || type.startsWith("turn/")) return true;
    if (type === "provider/unhandled" && agentActivity(data?.rawType)) return true;
    return type.startsWith("provider/") && !TOLERATED_PROVIDER_EVENTS.has(type);
  });
}
