# BB Community listing

The public registry is [get-bb/marketplace](https://github.com/get-bb/marketplace#submit-a-plugin).
A reviewed pull request adds the plugin to BB Community. Version 0.1.0 is the
first release submitted for listing. It is listed before a gains audit of the
plugin's own compaction log; that audit can follow from real use.

## Submitting

1. Merge and verify the plugin PR.
2. Publish a stable version using [tag-based releases](../AGENTS.md#tag-based-releases).
3. Verify a fresh install from that exact public tag on a compatible BB version.
   Recheck current marketplace requirements and SDK/host dependency placement.
4. In a fork of `get-bb/marketplace`, add `entries/bb-idle-compact.json` (below).
5. Copy `PLUGIN_OVERVIEW.md` to `overview/bb-idle-compact.md`. It must be plain
   supported Markdown, under 4,000 characters, with absolute HTTPS links.
6. Copy `docs/screenshots/marketplace-overview.png` to
   `screenshots/bb-idle-compact/overview.png`. Current community rules require
   PNG/JPEG/WebP images at least 1,200 px wide and no larger than 2 MiB; up to six.
7. In the registry checkout run `npm ci`, `npm run build`, `npm test`,
   `npm run gate:v1`, and `npm run check`. The last check validates the remote source.
8. Open a registry PR and address maintainer review. Verify the live listing
   after the PR is merged.

A `range` source discovers stable version tags, so later compatible releases do
not require editing the registry entry. Source, name, and branding changes do.

## Registry entry

The package, runtime, and marketplace share the `bb-idle-compact` identity.
The `^0.1.0` range permits later 0.1.x releases; bump it in a registry PR when
moving to 0.2.0.

```json
{
  "id": "bb-idle-compact",
  "displayName": "Idle Compact",
  "description": "Compacts large idle Claude Code and Codex threads before their prompt cache expires, so coming back does not re-read the whole context without the cache.",
  "icon": "Archive",
  "tags": ["compact", "compaction", "prompt-cache", "tokens", "usage", "context", "claude-code", "codex"],
  "author": {
    "name": "Y. Siva Sai Krishna",
    "github": "ysskrishna",
    "url": "https://ysskrishna.space"
  },
  "category": "token-usage-and-limits",
  "overview": "./overview/bb-idle-compact.md",
  "screenshots": ["./screenshots/bb-idle-compact/overview.png"],
  "source": {
    "git": {
      "url": "https://github.com/ysskrishna/bb-idle-compact.git",
      "range": "^0.1.0"
    }
  }
}
```
