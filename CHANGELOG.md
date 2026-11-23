# Changelog

## [Unreleased]

### Changed

- CI installs the latest Codex CLI for the scratch e2e and BB compat runs instead of a pinned version, and the e2e error text no longer names a version.

## [0.1.1]

### Added

- A "BB compat" workflow that runs the type check and scratch smoke test daily against the latest stable BB and reports a failure in a `bb-compat` issue.

### Fixed

- Made the scratch e2e smoke pass on GitHub's Linux runners: the fixture thread is now spawned scheduled, so it never starts a Codex turn, the Codex version in the e2e error text now matches the workflow pin (0.169.0), and the e2e workflow runs on pull requests that touch it.

### Changed

- `engines.bb` is now open-ended (`>=0.50.1`), so BB releases after 0.50 no longer block installs and updates. The daily BB compat run against the latest stable BB reports a release that breaks the plugin.
- Moved the GitHub release install into a collapsed "Install a specific release from GitHub" section in the README.
- Added the live BB Marketplace badge and installation command, and updated the listing documentation.

## [0.1.0]

### Added

- Compact qualifying Claude Code and Codex threads a few minutes before their prompt cache expires, while compaction still reads cached tokens.
- Hold a message sent after the cache expired until compaction finishes, then send it.
- Composer pills: "Auto-compacts in Nm" while the cache is warm, "Compact" in red once it expired, "Compacting" while it runs, and "Compacted" with the before and after size until the next message.
- A settings page with both automatic switches, a percentage threshold with a 100K-token floor, per-provider thresholds, the Codex cache lifetime, and the margin before expiry.
- Learn Codex's cache lifetime from cache hits after idle gaps, starting at 30 minutes.
- A 90-day compaction log and 30-day stats: compactions, tokens not re-read, and compactions before expiry versus on return.
- Defer Claude Code threads to BB's own offer on return when the `compactExpiredCache` experiment is on.
