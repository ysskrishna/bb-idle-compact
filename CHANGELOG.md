# Changelog

## [Unreleased]

## [0.1.0]

### Added

- Compact qualifying Claude Code and Codex threads a few minutes before their prompt cache expires, while compaction still reads cached tokens.
- Hold a message sent after the cache expired until compaction finishes, then send it.
- Composer pills: "Auto-compacts in Nm" while the cache is warm, "Compact" in red once it expired, "Compacting" while it runs, and "Compacted" with the before and after size until the next message.
- A settings page with both automatic switches, a percentage threshold with a 100K-token floor, per-provider thresholds, the Codex cache lifetime, and the margin before expiry.
- Learn Codex's cache lifetime from cache hits after idle gaps, starting at 30 minutes.
- A 90-day compaction log and 30-day stats: compactions, tokens not re-read, and compactions before expiry versus on return.
- Defer Claude Code threads to BB's own offer on return when the `compactExpiredCache` experiment is on.
