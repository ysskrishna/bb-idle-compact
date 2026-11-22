## Why

<!-- What was wrong or missing, and who it affects. Link the issue: "Fixes #123". -->

## What changed

<!-- The changes a reviewer needs to know, in a few bullets. -->

## Screenshots

<!--
Required when the PR changes anything a user can see: composer pills,
tooltips, labels, settings, colours, spacing or motion.
Otherwise delete this section.

- Show the current interface using disposable fixture data.
- Changed colours or tones: include light and dark.
- Changed layout: include a narrow window if it is affected.
- Changed motion: attach a short recording, or say how it behaves.
- Drag the images into this description; GitHub hosts them for you.
- No bb at hand? `npm run e2e:serve` starts an isolated scratch bb
  (see docs/development.md).
-->

<!-- Add current screenshots here. -->

## How I verified

<!--
- `npm run check` result, and any e2e you ran.
- New or changed tests, and whether they fail without the change.
- What you checked by hand, in which bb version.
-->

## Merge Danger

**Door:** <!-- two-way: a revert fully undoes it (UI, labels, glyphs).
one-way: a revert can't fully undo it (migrations, settings or storage formats,
storage keys, minimum bb/SDK version, removed features). -->

**Blast Radius:** <!-- small: one component or rare path. medium: a common path
(the composer pill, settings, the send hook). large: every user, every time (every message send,
server start, install). Say why. -->

## Checklist

- [ ] `npm run check` passes
- [ ] CHANGELOG describes the current project version, for user-visible changes
- [ ] Screenshots for visual changes, or this PR changes nothing a user can see
- [ ] No AI tool, model or agent credited as an author or co-author
