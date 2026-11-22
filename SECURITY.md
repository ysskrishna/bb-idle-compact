# Security policy

## Supported versions

Security fixes target the latest published stable release and `main`. Older
releases and unmerged branches are not maintained separately.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/ysskrishna/bb-idle-compact/security/advisories/new).
Include the affected version or commit, reproduction steps, and likely impact.
Do not post credentials, private conversations, or exploit details in public issues.

The maintainer will review the report and coordinate a fix and disclosure. There
is no guaranteed response time or bug bounty program.

## Plugin access

Idle Compact reads BB thread status, context usage, and token usage events for
Claude Code and Codex threads. It asks BB to compact a thread through BB's own
compaction, and it can hold a message you send until that compaction finishes.
It stores its settings, a 90-day compaction log (thread IDs and token counts,
no message text), and cache timing observations in BB plugin storage. From
thread events it uses only timestamps and token counts. It makes no network
requests of its own.
