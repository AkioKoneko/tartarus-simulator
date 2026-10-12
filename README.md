# Tartarus Simulator

A free, fan-made English translation of [塔羅斯监狱 (Talos Prison)](https://torchlightskill.com/talos/), the Chinese practice simulator for the Tartarus prison season (SS14) of *Torchlight: Infinite*. You walk the ring of fifteen cells around the warden's office: patrol a door each morning, let beasts devour same-rarity rivals, and raise inmates from Normal to Rainbow before the handoff.

## Play it

**Online:** https://blahdot3h.github.io/tartarus-simulator/

**Locally:** open `index.html` in a browser. There is no build step and no server to start. Fonts load from Google Fonts; without a connection the page falls back to system fonts.

## How it plays

The rules and board layout follow the original Chinese tool, so the mechanics behave the same way:

- **The ring.** 16 cells sit around a 6×4 board, numbered clockwise from the top-left corner. Cell 01 is the warden's office: every run starts there and nothing is ever held in it, so 15 cells hold prisoners. The decision panel sits in the courtyard in the middle, and a lantern marks the warden's cell.
- **Patrols.** Each morning offers 3 destination cells from the next 5 clockwise from the warden, or 2 while you hold the Burning Stake. The office counts as one of the 5 steps but is never offered. They appear as cards under the ring and glow on it. A destination can be a locked cell, which opens when the warden arrives, or a cell with an inmate you already know. You can't see inside a locked cell until it opens. Devoured, swapped and delivered inmates leave their cells sealed again.
- **Devours.** One devour a day, and only the inmate in the warden's cell can start it. If the eater then has another valid target, a chain devour starts and you pick its next meal, or stop the chain.
- **Special events.** Chain reaction: the next patrol opens every sealed door on the clockwise walk. Execution: wipes out lower-rarity prey for one tier each. Both can be accepted or skipped.
- **Markers.** Ivory, Prey, Scratch and Rat nest each have a focused drill, and can be placed with the Lab's scene editor.
- **Hard mode.** An optional harder food chain on the New Run screen and in the Lab, off by default: a simple loop where Mammoth eats Lion, Lion eats Wolf, Wolf eats Rat and Rat eats Mammoth. It's uncertain which food chain live uses, so you can practice either version.
- **Tools and the Warden's Cache.** In drills and the challenge alike, your first Supreme earns a tool (pick one of three), and each Rainbow opens the Warden's Cache for a gift. The Lab can start drills with random tools, or switch rewards off for pure rules practice.
- **Contract challenge.** 12 days and 6 dispatch vouchers. Contracts fall due at the end of days 4, 8 and 12, each with a delivery window. Vouchers pay for escorts and refit refreshes. Light/heavy escorts carry pressure limits, the heavy contract can be delivered early from day 9, and you earn refit tools, a Supreme milestone tool and Warden's Cache gifts.
- **Everything else.** Seeds, undo, autosave, export/import, a move advisor, a Lab (scene editor and adjustable practice values) and a handbook.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page markup and dialogs |
| `css/style.css` | All styles, including the board backdrop |
| `js/engine.js` | Rules and game state. No DOM, so it also runs under Node (`require('./js/engine.js')`) |
| `js/sound.js` | Web Audio sound effects |
| `js/ui.js` | Rendering, input, saves, preferences and the beast portraits |

## Credits

This is an English translation of the Chinese fan simulator [塔羅斯监狱 (Talos Prison)](https://torchlightskill.com/talos/) by 爱玩游戏的吉吉罗 ([Douyin](https://v.douyin.com/okD24Xnc6wo/), also 二零后游戏荒 on [Bilibili](https://space.bilibili.com/39881994)). Its rules and board layout follow the original, and the original author is not involved in this version. This English version is an independent re-implementation with its own code and artwork: the beast portraits and the courtyard backdrop were drawn for this project. No code, images or audio were copied from that tool.

Unofficial. Not affiliated with or endorsed by the developers or publishers of *Torchlight: Infinite*. Odds, daily limits and the contract challenge are practice values and may differ from the live game.
