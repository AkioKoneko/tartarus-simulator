# Enhanced overlay fork

This fork keeps the upstream simulator alongside additional desktop assistance:

- Capture ordering, reward counter recovery and remembered observed board data.
- Verified click targets for actions, meals, Hunt, instruments and Treasure.
- Safe action previews and consume routes, stopping at unknown outcomes.
- A transparent movable icon, independent panel position and idle fading.
- Visible recognized instruments and a choice for uncertain instrument combinations.
- Consume cancellation/resumption continuity and explicit recommendation labels.

## Updating from upstream

Use a separate integration branch based on the enhanced version, then merge
`upstream/main`. Preserve the merge history; replacing the enhanced branch with
upstream files removes the additions. In page conflicts, retain `local-assist.js`
and `follow-state.js` in their existing load order and refresh cache tags.

Run this portable gate before activating an update:

```sh
node tools/check-enhanced.js
```

The gate checks the real page script composition, JavaScript syntax and all
portable enhancement regressions. It covers rules, action plans, target hints,
capture ordering, instrument recovery, overlay layout and consume continuity.
The tests use local fixtures constructed in code; they do not need game logs,
screenshots, credentials or a running game.
GitHub Actions also runs this gate on pushes and pull requests to
`enhanced-overlay`, without game data or repository secrets.

Also check `git diff --check`, review the merge against both parents, and verify
the actual Analyzer, desktop adapter and native overlay with an isolated profile.
Recorded-screen or live-game checks remain necessary for recognition and new
game behavior; portable checks do not prove those. Keep a known working commit
until the update has passed these checks.

Restart only after the active run is finished. Reuse the existing profile,
origin, settings and game-log association. Keep profiles, recordings, screenshots,
local instructions and private QA reports out of Git.

Upstream: [blahdot3h/tartarus-simulator](https://github.com/blahdot3h/tartarus-simulator).
The integration gate and enhancement tests are maintained in this fork and
should be updated when either the upstream contracts or local features change.
