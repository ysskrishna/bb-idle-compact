# Cache Compact

[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

A [BB](https://getbb.app) plugin that compacts large idle Claude Code and Codex threads around prompt cache expiry, so a question you ask hours later does not re-read the whole context at full price.

## Why

Agent providers cache the conversation prefix for a limited time: Claude Code reports 5 minutes or 1 hour, and Codex defaults to 30 minutes for GPT-6.x. When you return after the cache expires, your next message re-reads the entire context uncached. For a thread holding several hundred thousand tokens, one short question can cost dollars, or a large share of a plan's usage.

## What it does

| Behavior | When | Default |
| --- | --- | --- |
| **Compact before expiry** | A qualifying thread has been idle until shortly before its cache expires. Compacting then reads the context at the cheap cached rate. | On, 5 minutes before expiry |
| **Compact first, then send** | You send a message to a qualifying thread whose cache already expired. The message waits (shown above the composer) until compaction finishes. | On |
| **Compact button** | The cache expired and the thread qualifies. A button with a red dot appears next to send; click it to compact now. | Always shown when it applies |

A thread qualifies when its context is at least the threshold percentage of the model's window **and** at least 100K tokens. Below 100K tokens, compacting costs about as much as it saves.

Compaction uses BB's own `/compact`, the same as the composer command, so it shows in the thread timeline. Compaction drops detail: the agent keeps a summary, not the full history.

## Settings

Settings → Installed plugins → Cache Compact, or `bb plugin config bb-cache-compact`.

| Setting | Default | Meaning |
| --- | --- | --- |
| Enabled | On | Turns the plugin off without uninstalling it. |
| When you return after the cache expired | Compact first, then send | Or only show the Compact button. |
| Context threshold | 20% | Of the model's context window, with a fixed 100K-token floor. |
| Advanced: per-provider thresholds | 0 (use global) | Separate thresholds for Claude Code and Codex. |
| Advanced: Codex cache lifetime | 0 (learn) | Codex does not report its cache lifetime. The plugin starts at 30 minutes and learns a longer one after three cache hits beyond 30 minutes. |
| Advanced: compact before expiry / compact before sending | On / On | Turn either behavior off. |
| Advanced: minutes before expiry | 5 | How early to compact an idle thread. |

## Providers

- **Claude Code**: the cache lifetime comes from what Claude Code reports. If BB's own `compactExpiredCache` experiment is on, BB handles "compact before sending" for Claude Code and this plugin leaves it alone.
- **Codex**: uses the configured or learned lifetime.
- **Cursor and other ACP agents**: not supported. BB cannot trigger their compaction.

## Install

```sh
bb plugin install git:https://github.com/ysskrishna/bb-cache-compact.git
```

Requires BB 0.50.1.

## Development

```sh
npm install
npm run check   # typecheck, unit tests, bb plugin build
bb plugin install .
```

## License

[MIT](LICENSE)
