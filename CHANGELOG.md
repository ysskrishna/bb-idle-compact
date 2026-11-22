# Changelog

## [Unreleased]

### Added

- Compact qualifying Claude Code and Codex threads shortly before their prompt cache expires.
- Hold a message sent after the cache expired until compaction finishes.
- Composer Compact button with a red dot when the cache expired and the thread qualifies.
- Global percentage threshold with per-provider overrides and a 100K-token floor.
- Learn Codex's cache lifetime from cache hits after idle gaps.
