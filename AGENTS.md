# Working in Idle Compact

## Scope

Idle Compact decides when to compact large idle Claude Code and Codex threads
around prompt cache expiry, and shows that decision in the thread composer.
BB owns compaction itself (`bb.sdk.threads.compact`, the same `/compact` as the
composer), message queueing, providers, and thread lifecycle. Reuse those; do
not add keep-warm pings, thread handoff, dollar estimates, per-thread opt-out,
or Cursor support (BB cannot compact Cursor threads or read their usage).

Warm compaction skips threads filed in Thread Inbox, or inside a filed thread
(`bb-thread-inbox`'s `listLifecycle` RPC, read in `src/server-inbox.ts`): its
turn would reopen the thread tree and notify. Thread Inbox is optional: when it
is not installed, not enabled, or in a broken state nothing counts as filed;
when it is starting or running but does not answer, the warm compaction is
skipped.

Copy speaks in tokens, never dollars: subscription users do not pay per token.

## Architecture

- Browser entry: `app.tsx` (composer pill and settings page). Server entry:
  `src/server.ts`. Pure shared modules: `src/policy.ts`, `src/status.ts`,
  `src/log.ts`, `src/ttl.ts`, `src/format.ts`, `src/contract.ts`,
  `src/inbox.ts`. Server-only
  modules are named `src/server-*.ts`. `biome.json` enforces the boundaries.
- Decisions are pure functions with unit tests. The server only gathers facts
  from BB and applies the verdict.
- `src/contract.ts` holds the RPC schemas. The app imports its types only, so
  zod stays out of the browser bundle (`scripts/check-app-bundle.mjs`).
- Settings, the compaction log, idle records, and Codex cache observations live
  in plugin storage (`bb.storage.kv`). The log keeps 90 days and at most 600
  entries. Changing a stored shape needs a parse that accepts the old one.
- The `message.dispatch` hook must answer quickly (BB times it out after 10 s):
  it returns `wait`, starts compaction outside the hook, and rechecks when the
  compaction turn ends. It only handles user messages that start a turn.
- When BB's `compactExpiredCache` experiment is on, BB handles Claude Code
  threads on return; the plugin leaves those alone and still compacts before
  expiry.
- Every hook and UI surface used is `experimental_`. Keep `engines.bb`
  open-ended (`>=` the oldest tested BB) and the SDK pinned exactly. The daily
  BB compat run against the latest stable BB reports a release that breaks the
  plugin; fix forward.
- The display name is Idle Compact. The package, runtime, and marketplace ID
  are `bb-idle-compact`. BB stores plugin data by ID; an identity change needs
  an explicit data transfer.

## Checks and changes

- Keep changes focused. Commit verified slices on a task branch. Follow the PR
  template; do not merge without the user's request. No AI authors or
  attribution trailers.
- Run `npm ci` in a fresh checkout to install the hooks. Run `npm run check`
  before and after source changes: lint, formatting, Knip, types, unit tests,
  script tests, build, and the bundle check.
- Remove unused imports and exports; do not add Knip exceptions for dead code.
  Production files and scripts stay within 500 lines, tests within 1,000.
- Prove a regression test fails before its fix.
- Run anything that starts BB only through the isolated scratch launcher, never
  against the live host. See [docs/development.md](docs/development.md).
  Public captures use disposable threads and are labeled in
  `docs/screenshots/README.md`. Watch the entire encoded GIF, including its loop.
- Keep machine configuration, credentials, private notes, and live
  conversation screenshots out of this public repository.

## Tag-based releases

- A package version is manifest metadata, not proof of publication. Keep
  unreleased work on the planned stable X.Y.Z version and tie the README
  release badge to GitHub Releases. Only stable vX.Y.Z tags are supported.
- Prepare a release on a branch: `npm version X.Y.Z --no-git-tag-version`, put
  the shipped notes under a nonempty `## [X.Y.Z]` section in `CHANGELOG.md`,
  and review through a PR. Verify both lockfile version fields match.
- Only after the release preparation is merged and publication is authorized,
  tag that commit with `git tag -a vX.Y.Z -m 'Release vX.Y.Z'` and push the tag.
- `.github/workflows/release.yml` accepts stable `vX.Y.Z` tags included in
  `main`, checks the manifest versions and the plugin, then uses the pinned
  `ysskrishna/changelog-release-action` to publish the matching changelog
  notes. No tag is created by CI and no release by a normal push or PR.
- Release automation does not submit marketplace entries. Follow
  `docs/marketplace.md`. Never retag an existing release to repair it.
