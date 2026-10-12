# Tartarus Simulator

A free, fan-made English practice simulator for the Tartarus prison season (SS14) of *Torchlight: Infinite*. It began as a translation of the Chinese fan simulator [塔羅斯监狱 (Talos Prison)](https://torchlightskill.com/talos/), but its rules have since been updated to match the video reveal, so it now differs heavily from the Chinese sim. You walk the ring of fifteen cells around the warden's office: patrol a door each morning, let beasts devour same-rarity rivals, and raise inmates from Normal to Rainbow before the handoff.

## Play it

**Online:** https://blahdot3h.github.io/tartarus-simulator/

**Locally:** open `index.html` in a browser. There is no build step and no server to start. Fonts load from Google Fonts; without a connection the page falls back to system fonts.

## How it plays

The board layout follows the original Chinese tool. The rules follow the video reveal wherever it shows them, and practice values fill the gaps:

- **The ring.** 16 cells sit around a 6×4 board, numbered clockwise from the top-left corner. Cell 01 is the warden's office: every run starts there and nothing is ever held in it, so 15 cells hold prisoners. The decision panel sits in the courtyard in the middle, and a lantern marks the warden's cell.
- **Patrols.** Each morning offers 3 destination cells from the next 5 clockwise from the warden, or 2 while you hold the Burning Stake. The office counts as one of the 5 steps but is never offered. They appear as cards under the ring and glow on it. A destination can be a locked cell, which opens when the warden arrives, or a cell with an inmate you already know. You can't see inside a locked cell until it opens. Devoured and delivered inmates leave their cells sealed again.
- **Swaps.** Once a day, the inmate in the warden's cell can be swapped for a brand-new random one. No other cell can be swapped.
- **Devours.** One devour a day, and only the inmate in the warden's cell can start it: double-click a target, or click once to preview and again to confirm. If the eater then has another valid target, it chains on by itself into random valid targets until none is left, and the chain can't be stopped. The log shows every bite as beast icons.
- **Day recap.** Each morning a strip under the destination cards shows what happened the day before: the door you opened, devour chains, swaps, events and Rainbows. After the patrol it follows the current day.
- **Special events.** Chain reaction: the next patrol opens every sealed door on the clockwise walk. Execution: wipes out lower-rarity prey for one tier each. Both can be accepted or skipped.
- **Markers.** Ivory, Prey, Scratch and Rat nest each have a focused drill, and can be placed with the Lab's scene editor.
- **Food chain.** The default is the single-meal chain the live game appears to use: Mammoth eats Lion, Lion eats Wolf, Wolf eats Rat and Rat eats Mammoth. The New Run screen and the Lab can switch to the Chinese sim's two-meal chain, where Mammoth also eats Wolf and Lion also eats Rat.
- **Tools and the Warden's Cache.** In drills and the challenge alike, your first Supreme earns a tool (pick one of three), and each Rainbow opens the Warden's Cache for a gift. The Lab can start drills with random tools, or switch rewards off for pure rules practice.
- **Contract challenge.** 12 days and 6 dispatch vouchers. Contracts fall due at the end of days 4, 8 and 12, each with a delivery window. Vouchers pay for escorts and refit refreshes. Light/heavy escorts carry pressure limits, the heavy contract can be delivered early from day 9, and you earn refit tools, a Supreme milestone tool and Warden's Cache gifts.
- **Trainer.** An optional sidebar, toggled from the top bar, that works in every situation:
  - **Recommended move:** the trained strategy's pick appears at once, with its reason and the matching lesson from training. The recommended cell, card or button is marked on the board.
  - **Live check:** every option is played out hundreds of times from the current position, with everything you can't see re-rolled each time. Options are ranked by Rainbows vaulted, or by the chance to pass in the contract challenge.
  - **Grades:** each move you make is graded against that check (best, close, or what it cost), with a tally for the run.
  - **Where it runs:** in a Web Worker, or on the page itself when opened from disk.
- **Strategy guide.** [strategy.html](https://blahdot3h.github.io/tartarus-simulator/strategy.html) is a rough strategy to learn before playing, built from the lab's data. It's linked from the title screen and the menu.
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
| `js/ui.js` | Rendering, input, saves, preferences and the beast portraits |

## Credits

This began as an English translation of the Chinese fan simulator [塔羅斯监狱 (Talos Prison)](https://torchlightskill.com/talos/) by 爱玩游戏的吉吉罗 ([Douyin](https://v.douyin.com/okD24Xnc6wo/), also 二零后游戏荒 on [Bilibili](https://space.bilibili.com/39881994)). The board layout follows the original, but the rules have since been updated to match the video reveal, so this version now differs heavily from the Chinese sim. The original author is not involved in this version. This English version is an independent re-implementation with its own code and artwork: the beast portraits and the courtyard backdrop were drawn for this project. No code, images or audio were copied from that tool.

Unofficial. Not affiliated with or endorsed by the developers or publishers of *Torchlight: Infinite*. Odds, daily limits and the contract challenge are practice values and may differ from the live game.
