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
- Optional source-guarded Rust/WASM calculations and pixel primitives, retaining the existing UI, JS rules reference and launcher.

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

## Interchangeable acceleration

The existing solver worker can run an independently authored Rust/WASM port of
this fork's rules and strategy. The Analyzer still owns state construction,
ranking, near-tie preferences, recommendations, uncertainty and rendering. The
worker protocol keeps IDs, streams, cumulative rarity scores, raw samples and
the optional early-Rainbow samples. A failed native slice replays the same JS
random stream before resuming, so partial results are neither lost nor counted
twice. Cancellation invalidates asynchronous initialization as well as slices.

The reader retains its references, recognition logic, thresholds and connected
glyph/word grouping. Optional WASM accelerates grayscale, blur, board matching
and text-mask preparation. A runtime failure retries that frame with the
reference reader. Disabled instances are removed from the loader cache; their
memory is no longer retained by a fulfilled initialization promise.

`js/acceleration-manifest.json` seals reference JS, native sources and compiled
assets. At runtime, changed reference JS or damaged/incompatible WASM uses JS.
This protects an upstream integration from silently combining different rule
versions. It does not automatically port new rules: review both the JS change
and its Rust equivalent, refresh constants when needed, then rebuild and run
parity before enabling the revised asset. Normal launching needs no Rust tools
or background service. The desktop's existing local protocol serves the assets
at the same origin, preserving profile storage.

With Rust 1.95.0 and its `wasm32-unknown-unknown` target available:

```sh
node tools/snapshot-acceleration-data.js --check
node tools/build-acceleration.js
node tools/check-enhanced.js
```

When a reviewed reference change requires a new seal, regenerate the data with
`node tools/snapshot-acceleration-data.js` and explicitly rebuild with
`node tools/build-acceleration.js --accept-reference`. The flag records a
reviewed reference; it does not prove compatibility. The portable gate compares
complete policy trajectories, engine states, raw Monte Carlo samples, special
observed restrictions, early horizons and the incremental adapter against JS.
It also checks pixel/text grouping parity and loader integrity/discard behavior.
GitHub Actions checks the shipped assets and separately builds the Rust sources
and repeats parity. Recorded-frame and isolated native application QA remain
necessary. These are offline guarantees, not a live-game latency or FPS claim.
