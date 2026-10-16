# Tartarus Simulator

A free, fan-made English practice simulator for the Tartarus prison season (SS14) of *Torchlight: Infinite*. It began as a translation of the Chinese fan simulator [塔羅斯监狱 (Talos Prison)](https://torchlightskill.com/talos/), but its rules have since been updated to match the video reveal, so it now differs heavily from the Chinese sim. You walk the ring of fifteen cells around the warden's office: patrol a door each morning, let beasts devour same-rarity rivals, and raise inmates from Normal to Rainbow before the handoff.

Made by **CoffeeBns**: [twitch.tv/coffeebns](https://twitch.tv/coffeebns) and [youtube.com/@CoffeeBns](https://youtube.com/@CoffeeBns).

## Play it

**Online:** https://blahdot3h.github.io/tartarus-simulator/

**Locally:** open `index.html` in a browser. There is no build step and no server to start. Fonts load from Google Fonts; without a connection the page falls back to system fonts.

## How it plays

The board layout follows the original Chinese tool. The rules follow the video reveal wherever it shows them, and practice values fill the gaps:

- **The ring.** 16 cells sit around a 6×4 board, numbered clockwise from the top-left corner. Cell 01 is the warden's office: every run starts there and nothing is ever held in it, so 15 cells hold prisoners. The decision panel sits in the courtyard in the middle, and a lantern marks the warden's cell.
- **Patrols.** Each morning offers 3 destination cells from the next 6 clockwise from the warden. They appear as cards under the ring and glow on it. A destination can be a locked cell, which opens when the warden arrives, a cell with an inmate you already know, or the warden's office, where you choose Instigate (special events appear behind 2 locked doors) or Bestow (1 random inmate rises a tier). You can't see inside a locked cell until it opens. Devoured and delivered inmates leave their cells sealed again.
- **Swaps.** Once a day, the inmate in the warden's cell can be swapped for a brand-new random one. No other cell can be swapped. A day has a swap or a devour, not both: either one uses up the other, as in the live game.
- **Consumes.** One consume a day, and only the inmate in the warden's cell can start it: double-click a target, or click once to preview and again to confirm. The eater then goes on eating while it has a valid target: after each bite you pick its next meal, even when there's only one, or stop the chain, as the game's Cancel button does. The Lab can make chains go on by themselves instead. The log shows every bite as beast icons.
- **Day recap.** Each morning a strip under the destination cards shows what happened the day before: the door you opened, devour chains, swaps, events and Rainbows. After the patrol it follows the current day.
- **Special events.** Chain reaction: the next patrol opens every sealed door on the clockwise walk. Execution: wipes out lower-rarity prey for one tier each. Behind Closed Doors: the inmate behind the door becomes a Supreme of the scarcest beast on the block. Ravenous Appetite: a lowest-rarity inmate gets 5 tries at +1 tier, 50% each. High-Risk Convict: a random locked cell opens on a Legendary or better. Crow Whispers: the next 4 locked cells show their inmates' rarity. Taste of Freedom: 3 random locked cells open. Usurpation I: a random inmate rises a tier, then Usurpation II (2 inmates rise a tier) takes its place in the pool and appears behind a locked cell; II brings Usurpation III (2 random inmates rise 2 tiers), and III brings Usurpation IV (every inmate rises 2 tiers), the last. Sewer Ratway: the warden moves to any cell but the office, and a locked door there opens as on a patrol (the move adds no tiles). "Treasure" Hunt: every locked cell holding a Normal or Magic shows its rarity, so the doors left dark hold Rare or better (its card has only Confirm). Each is equally likely, and each but the Hunt can be accepted or skipped. Events hide behind about 5% of locked cells and show only once the warden walks past. An event can also sit in an open cell beside its inmate (a "!" by the cell; its popup says "Can trigger Prison Incident"), and walking in sets it off. The analyzer and the screenshot reader take such cells; simulated runs don't make them yet, since how they come about isn't known.
- **Markers.** Tusk, Prey, Scratch and Rat nest each have a focused drill, and can be placed with the Lab's scene editor.
- **Food chain.** Each beast has one meal: Mammoth eats Lion, Lion eats Wolf, Wolf eats Rat and Rat eats Mammoth. From Legendary up, Mammoths also eat Wolves and Lions also eat Rats, as live screenshots showed three times (the Chinese sim had these second meals at every rarity, which the live game doesn't). The Lab sets the rarity where they start.
- **Objectives, tools and the Warden's Treasure.** Every drill starts with a pick of three random tools, as the live game does. Each run draws a random objective, King of the Caged (an inmate reaches Supreme) or Prison Walk (move 18 tiles), and meeting it earns a tool (pick one of three). So a Supreme earns a tool only when the objective is King of the Caged. The live game has more objectives, and what they pay isn't known yet, so every objective here pays a tool. The analyzer also knows Survival of the Fittest and Undercurrents. Besides its objective, a run can start with a card: Cage Fight (an inmate can consume the beasts it counters at its own rarity or lower, Mammoths and Lions eat both their meals at any rarity, and consuming never changes the eater's beast) Iron Law (the run lasts 30 days) or Tyranny (each stop at the office also triggers Instigate and Bestow 3 more times each). The analyzer sets them under Start of run; simulated runs don't draw them yet. In the contract challenge, the starting kit takes the place of the starting pick. Each Rainbow opens the Warden's Treasure for a gift. The Lab sets how many tools a drill starts with, or switches rewards off for pure rules practice.
- **Contract challenge.** 12 days and 6 dispatch vouchers. Contracts fall due at the end of days 4, 8 and 12, each with a delivery window. Vouchers pay for escorts and refit refreshes. Light/heavy escorts carry pressure limits, the heavy contract can be delivered early from day 9, and you earn refit tools, the objective's tool and Warden's Treasure gifts.
- **Trainer.** An optional sidebar, toggled from the top bar, that works in every situation:
  - **Recommended move:** the trained strategy's pick appears at once, with its reason and the matching lesson from training. The recommended cell, card or button is marked on the board.
  - **Live check:** every option is played out hundreds of times from the current position, with everything you can't see re-rolled each time. Options are ranked by Rainbows vaulted, or in the contract challenge by the chance to pass first and then contract points.
  - **Convoys:** when a delivery window opens, the trainer recommends a convoy inside the window, stars the inmates to send, and compares it with the most points, the most points by light escort, the cheapest cargo and skipping. It also checks the convoy you're loading before you send it.
  - **Grades:** each move you make is graded against that check (best, close, or what it cost), with a tally for the run.
  - **Where it runs:** in a Web Worker, or on the page itself when opened from disk.
- **Strategy guide.** [strategy.html](https://blahdot3h.github.io/tartarus-simulator/strategy.html) is a rough strategy to learn before playing, built from the lab's data: how to vault Rainbows in drills, and how to pass the contract challenge and score its convoys. It's linked from the title screen and the menu.
- **Board analyzer.** [analyze.html](https://blahdot3h.github.io/tartarus-simulator/analyze.html) takes the board from your live game and tells you what to do next. Enter each cell (sealed, an inmate's beast and rarity, a rat nest, an event), the warden, today's doors, your tools, Rainbows and objective (King of the Caged, Prison Walk with its tiles, or another one, for which no tool is assumed), and in the contract challenge your vouchers and contracts. Every option is ranked by the same live check as the Trainer. **Do it here** plays the move with the simulator's dice and marks the cells to check against your game. It's linked from the title screen and the menu.
- **Screenshot reader.** On the analyzer, paste, drop or choose a screenshot of the prison screen to fill the board in. It reads which cells are locked, each inmate's beast and rarity, rat nests, events, the jaws markers, the warden, today's door cards, the days until the riot, the torture instruments held and the Chromatic prisoners captured, at any UI scale. Anything it's unsure of is marked Check. Objectives aren't read yet, so the objective panel is shown beside the reading. The reader runs in the browser, and the screenshot never leaves it. See [tools/README.md](tools/README.md#screenshot-reader) for how it works and how accurate it is.
- **Strategy lab.** `tools/strategy-sim.js` plays millions of simulated runs on every CPU core to tune that strategy and rank tools, gifts and chain setups. No AI: every choice comes from scoring rules. See [tools/README.md](tools/README.md).
- **Everything else.** Seeds, undo, autosave, export/import, a Lab (scene editor and adjustable practice values) and a handbook.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup and dialogs |
| `css/style.css` | All styles, including the board backdrop |
| `js/engine.js` | Rules and game state. No DOM, so it also runs under Node (`require('./js/engine.js')`) |
| `js/sound.js` | Web Audio sound effects |
| `js/solver.js` | The strategy, the chain math and the Monte Carlo solver. No DOM, so it also runs under Node |
| `js/solver-worker.js` | Runs the solver off the page's main thread |
| `tools/strategy-sim.js` | The strategy lab: millions of simulated runs, tuning and reports |
| `js/ui.js` | Rendering, input, saves and preferences |
| `js/board.js` | The board's artwork (beast portraits, lantern, office), shared by every page |
| `analyze.html`, `js/analyze.js` | The board analyzer, and the screenshot reader's page |
| `js/report.js` | The analyzer's Report something new dialog: an event, instrument or gift the simulator doesn't have yet, with a cropped screenshot |
| `js/capture.js`, `js/auto.js`, `follow.html` | Auto Screenshot Mode (beta; called Follow my game until 2026-10-16): the analyzer follows the game log and reads pictures of the shared game window. It's set up on `follow.html`, which the analyzer's header links to; the page explains it with its code, and nothing runs until the player agrees there |
| `tools/serve.js` | A local copy of the site for testing before a push (VS Code: Run and Debug, Local site) |
| `js/scan.js` | The screenshot reader. Pure functions on pixels, so it also runs under Node |
| `js/scan-data.js` | The reader's reference data, made by `tools/scan-build.js` |
| `js/scan-worker.js` | Runs the reader off the page's main thread |
| `tools/scan-build.js`, `tools/scan-test.js` | Build the reader's reference data from labeled screenshots, and score the reader |
| `js/live.js` | Shares the boards players ask about in the analyzer, in runs of two or more in a row, to measure live's odds |
| `worker/` | The collector those boards go to: a Cloudflare Worker with a D1 database (see `worker/README.md`) |
| `tools/live-data.js`, `beta/data/` | Pulls the shared boards into the repo and measures the live odds against the simulator's (`beta/data/rates.json`) |
| `canvas.html`, `css/canvas.css`, `js/canvas-ui.js` | The Frozen Canvas trainer: practice canvases, or your own canvas set up by hand, with move advice. Hidden for now: no page links to it |
| `js/canvas-engine.js` | The Frozen Canvas rules (6×6 canvas, paints, objectives, brushstrokes). No DOM, so it also runs under Node |
| `js/canvas-solver.js` | The canvas strategy and its Monte Carlo check, aiming for a Lv7 Treasure Chest |
| `tools/canvas-sim.js` | The canvas lab: plays canvases with the strategy and measures the Lv7 chest rate |
| `.github/workflows/live-data.yml` | Runs `tools/live-data.js pull` every 6 hours and commits what's new |

## Credits

This English version is made by **CoffeeBns** ([Twitch](https://twitch.tv/coffeebns), [YouTube](https://youtube.com/@CoffeeBns)).

This began as an English translation of the Chinese fan simulator [塔羅斯监狱 (Talos Prison)](https://torchlightskill.com/talos/) by 爱玩游戏的吉吉罗 ([Douyin](https://v.douyin.com/okD24Xnc6wo/), also 二零后游戏荒 on [Bilibili](https://space.bilibili.com/39881994)). The board layout follows the original, but the rules have since been updated to match the video reveal, so this version now differs heavily from the Chinese sim. The original author is not involved in this version. This English version is an independent re-implementation with its own code and artwork: the beast portraits and the courtyard backdrop were drawn for this project. No code, images or audio were copied from that tool.

Unofficial. Not affiliated with or endorsed by the developers or publishers of *Torchlight: Infinite*. The odds of who's behind a door and who a Replace brings in are measured from players' boards (1,011 doors and 261 Replaces, 2026-10-16); daily limits and the contract challenge are practice values and may differ from the live game.
