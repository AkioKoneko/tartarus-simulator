# Enhanced overlay fork

This fork keeps the upstream simulator alongside additional desktop assistance:

- Capture ordering, reward counter recovery and remembered observed board data.
- Verified click targets for actions, meals, Hunt, instruments and Treasure.
- Safe action previews and consume routes, stopping at unknown outcomes.
- A transparent movable icon, independent panel position and idle fading.
- Visible recognized instruments and a choice for uncertain instrument combinations.
- Consume cancellation/resumption continuity and explicit recommendation labels.
- Wrong-advice marks in the existing local run record, with verified frame links and review navigation.
- Optional early-Rainbow preference for near ties, measured in the same playouts and disabled by default.

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

## Advice review and experimental preference

Use Report > Wrong advice to mark a settled recommendation in an active recorded run. The mark stays local and does not send a report or interact with the game. Review the record shows the mark and its linked picture when the recording association is known; manual/unlinked pictures are labelled explicitly. Recording must be enabled in the tray.

The Analyzer offers "Prefer earlier Rainbows in near ties" (off by default). It measures new Rainbows today and over the next three days using the existing full playouts. It can choose another move only within 0.05 expected final Rainbows of the leader and with at least 150 paired samples supporting an early advantage above 1.96 paired standard errors. Terminal Rainbow estimates remain unchanged. Cancel/end and short-walk safeguards retain priority. This is experimental: a bounded first-move comparison did not demonstrate an advantage; it is not a live-game improvement claim.

## Upstream 0.2.23 integration

The existing hints window remains the only target renderer, including observed button targets and chain steps. The upstream tray toggle and game-log click notifications control that same window. Captured timestamps are carried through reader option objects without losing request cancellation. Targets wait 300 ms for stability and stay hidden during a newer read, calculation, uncertainty or stale frame.

Adaptive per-trigger capture waits and one failed-share recovery preserve latest-frame ownership and bounded Treasure retries. Partially faded decision rows request a settled retake; geometry alone does not invent an unseen action or verified click target. The local 200 ms log poll remains.

The hidden Analyzer retains the configured page priority and disables Windows execution-speed throttling on its own renderer processes. Worker count and game-first preference are unchanged. Upstream performance claims are workload-specific; this update does not promise a fixed live speed multiplier.
