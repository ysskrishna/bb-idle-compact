// Thread-log events that fail a scratch seed. Agent output (item/*) or a turn
// (turn/*) means the fixture ran a provider turn, and other provider events are
// errors. Two provider events are not: warnings, and notifications BB does not
// map (provider/unhandled), which newer Codex CLIs add over time.
const TOLERATED_PROVIDER_EVENTS = new Set(["provider/warning", "provider/unhandled"]);

export function unexpectedSeedEvents(events) {
  return events.filter(({ type }) => {
    if (type.startsWith("item/") || type.startsWith("turn/")) return true;
    return type.startsWith("provider/") && !TOLERATED_PROVIDER_EVENTS.has(type);
  });
}
