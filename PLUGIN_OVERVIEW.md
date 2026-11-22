Compacts large idle Claude Code and Codex threads around prompt cache expiry, so returning to a thread hours later does not re-read its whole context at full price.

## What you get

- **Compact before expiry**: an idle thread above your threshold is compacted shortly before its prompt cache expires, while reading the context is still cheap.
- **Compact first, then send**: when the cache has already expired, your next message waits until compaction finishes.
- **A Compact button** with a red dot next to send whenever the cache has expired and the thread qualifies.
- A global percentage threshold with per-provider overrides, and a fixed 100K-token floor.

## How it works

Claude Code reports its cache lifetime. Codex does not, so the plugin starts at 30 minutes and learns a longer lifetime from cache hits after idle gaps. Compaction uses BB's own `/compact`. Cursor and other ACP agents are not supported, because BB cannot trigger their compaction.
