# Development

```sh
npm ci
npm run check   # lint, format, Knip, types, unit tests, script tests, build, bundle check
```

Install your working copy into BB with `bb plugin install /path/to/bb-idle-compact`.
That is your real BB: the plugin acts on your real threads. Use the scratch
server below for anything you want to try without that.

## Isolated scratch BB

`scripts/e2e/server.mjs` starts a disposable BB from the pinned `bb-app`
devDependency, adapted from Thread Inbox's launcher:

- its own data directory under the system temp directory, two free loopback
  ports, and a Git repository for the project;
- a scratch `HOME`, `XDG_*`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `TMPDIR`,
  and on macOS a throwaway keychain;
- an empty loopback marketplace, so the catalog is never fetched;
- a guard that samples the scratch process tree and fails the run if any of
  them opens a file under the real `~/.codex`, `~/.claude`, `~/.cursor`,
  `~/.config` or `~/.bb`. Evidence goes to `e2e-artifacts/isolation.jsonl`.

It refuses BB's usual port 38886 and deletes all scratch data when it stops.
It needs the Codex CLI on `PATH`.

```sh
# RPC smoke test: settings, stats, status and compact_now. No credentials.
env -i PATH="$PATH" HOME="$HOME" npm run e2e:smoke
```

CI runs the same smoke test from the manual "Scratch e2e" workflow.

## README media

`npm run e2e:serve` keeps a scratch BB running (120 minutes by default) and
writes its URL and environment to `e2e-artifacts/serve.json` and
`e2e-artifacts/serve.env`. With `--openai-key-file <dotenv>`, the scratch Codex
logs in with the `OPENAI_API_KEY` from that file over stdin, inside the scratch
`CODEX_HOME`; your own Codex sign-in is not touched.

```sh
env -i PATH="$PATH" HOME="$HOME" npm run e2e:serve -- --openai-key-file /path/to/openai.env
```

A demo needs one Codex thread above the threshold (over 100K tokens). Set a short
Codex cache lifetime and margin for capture through the settings RPC, for
example `{"codexTtlMinutes": 2, "idleMarginMinutes": 1}`. Capture with a
browser against the scratch URL. The provenance of the published media is in
[screenshots/README.md](screenshots/README.md).
