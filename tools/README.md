# Strategy lab

`strategy-sim.js` plays huge numbers of simulated drills to find out which strategy vaults the most Rainbows. It uses the game's own rules engine (`js/engine.js`) and the rules-based strategy in `js/solver.js`. There is no AI: every choice comes from scoring rules, and the lab tunes their weights by trying each value and keeping whichever vaults more Rainbows.

Games run in parallel on every CPU core. Game *i* always uses the seed `LAB-i`, so every strategy faces the same prisons and the same door rolls until their choices differ. On a 32-thread desktop it plays roughly 25,000 to 40,000 full 20-day runs a second.

## Running it

Needs Node 18 or newer. From the project folder:

```
node tools/strategy-sim.js eval   --games 1000000            # random play vs a simple player vs the solver strategy
node tools/strategy-sim.js tune   --games 40000 --rounds 3   # coordinate search over the strategy's weights
node tools/strategy-sim.js tools  --games 200000             # each tool held from day 1
node tools/strategy-sim.js gifts  --games 200000             # Warden's Cache choices
node tools/strategy-sim.js chains --games 200000             # chain odds by beasts per tier
node tools/strategy-sim.js report --games 1000000            # the whole study, saved to tools/results/
node tools/strategy-sim.js train  --games 150000 --final 1000000   # fine-tunes every profile the Trainer uses
```

Options:
- `--rewards on`: the first Supreme earns a tool and each Rainbow opens the Warden's Cache. The default is no tools.
- `--loop`: the hard mode loop food chain.
- `--params file.json`: start from saved weights.
- `--threads N`: how many threads to use.
- `--seed WORD`: a different set of prisons.

## What the strategy decides

At every decision the strategy scores each legal move from what the player can see:

- **Patrol.** It scores each destination. A locked door is worth what a new inmate is worth, plus what it could do today from the warden's cell, plus any event behind the door. A known inmate is worth its best devour or swap. A small bonus per step favors walking further.
- **Devour.** It takes the first meal with the highest expected value. That value comes from an exact calculation of the random chain that follows, including tools.
- **Swap.** It swaps the warden's inmate when it's at or below a tier threshold. It swaps first if the new inmate's chance to devour is worth more than today's devour.
- **Events.** It accepts Chain reactions. It accepts an Execution when the executioner gains more than it removes.
- **Tools and gifts.** Tools follow a ranking measured by the lab. Gifts are scored on the spot.

The in-game Trainer shows this strategy's pick right away. It then plays each candidate move out hundreds of times with the strategy, re-rolling everything the player can't see each time. It keeps the strategy's pick unless the playouts find a clearly better move. Each move the player makes is graded against those playouts.

The strategy has four tuned profiles, chosen by the run's settings: drills with rewards on (the default), drills with no tools, and the same two with the hard mode loop chain. `train` refines all four on a finer grid around their current weights. It then scores the old and new weights on a separate set of 1,000,000 fresh prisons, so the before/after comparison is fair.

## The strategy guide's data

`strategy.html` reads `js/guide-data.js`, which the `guide` mode generates. The data is based on the **single-meal food chain** (Mammoth eats Lion, Lion eats Wolf, Wolf eats Rat, Rat eats Mammoth), since that's what the live game appears to use, and it's the simulator's default. `guide` tunes the strategy for the chain (unless `--no-tune`), ranks tools and gifts, measures each habit, and plays the headline. 100,000 runs per measurement keep every margin under ±0.01 Rainbows, which is the target:

```
node tools/strategy-sim.js guide --chain single --no-tune --games 100000 --side 100000 --habit-games 100000 --compare 100000
```

The latest run (2026-10-13) took 3,800,000 runs in 3.7 minutes. Its full numbers are in `results/guide-data-single.json`.

**Two-meal chain data, kept separately.** If live turns out to use the Chinese sim's two-meal chain, its data is ready:
- `results/guide-data-two.json`: the same measurements, from `guide --chain two`.
- `results/two-meal/`: the original million-run study, the training report, and the strategy guide page as it was built on that chain.

To switch the page's data to it, run `guide --chain two --no-tune --publish`. Then update the few sentences in `strategy.html` that name the food chain.

## The contract challenge

Three modes play full 12-day contract challenges, split evenly across the three starts:

```
node tools/strategy-sim.js challenge --games 300000 --variants ";reserve=1;keep1=0,keep2=0"   # compare habits against the challenge profile
node tools/strategy-sim.js ctune     --games 100000 --rounds 2    # tune the challenge profile (--chain two for the two-meal chain)
node tools/strategy-sim.js cguide    --games 2000000              # the strategy guide's challenge data
```

The challenge is scored on **passing first, then contract points**. A pass counts as 1,000 points, so 1% of pass chance is worth 10 points. `--variants` takes `;`-separated lists of `key=value` changes, plus `toolFirst=id` and `toolRank=a|b|c`.

How the strategy plays the challenge (`js/solver.js`, profiles `loop-challenge` and `challenge`):
- **Convoys.** It searches every way to load the open contract. Inmates are grouped by tier and beast, so the search is exact and takes about 0.02 ms. On the first two contracts, a convoy's points are weighed against what its inmates are worth kept on the block (`keep1`, `keep2`). A heavy escort is only allowed if 3 vouchers would remain (`reserve`), and it never spends the heavy contract's last voucher. When contract 1 was missed, contract 2 becomes a must and any escort that leaves a voucher will do. The heavy contract ends the run, so it takes the most points.
- **Getting ready.** In the last `needDays` days before a delivery window, moves are also scored by how close they bring the block to meeting that contract (`wNeed`). The weight is higher when the contract is a must (`needCrit`).
- **Everything else** uses the same scoring as drills, with weights tuned for the challenge.

The in-game Trainer compares the strategy's convoy with the most points, the most points by light escort, the cheapest qualifying cargo, skipping, and whatever convoy the player is loading.

### Challenge results (2026-10-12, single-meal chain)

The tuning ran `ctune` at 100,000 runs per test for 2 rounds: 16.3 million runs in 21.7 minutes. A refit tool order and the cargo setting were then checked on fresh seeds. The guide data comes from `cguide`: 6.5 million runs in 9.7 minutes on the seed `CGUIDE`, with 2,000,000 runs for the trained strategy and 300,000 for each variant (margins about ±0.1% of pass rate).

| Habit | Pass | Points per run |
| --- | --- | --- |
| **The trained strategy** | **94.45%** | **52.3** |
| Sending the most points every time, even the heavy contract's last voucher | 19.8% | 60.5 |
| Sending the most points, keeping 1 voucher | 69.8% | 60.4 |
| The most points, by light escort only | 88.2% | 63.7 |
| Sending some Rares on the first two | 90.8% | 64.2 |
| Cheap cargo, but heavy escorts allowed on the first two | 92.6% | 52.8 |
| Ignoring the next contract while playing | 92.1% | 51.0 |
| Playing with the drill weights (convoys unchanged) | 92.7% | 50.6 |
| Shipping the heavy contract as soon as it qualifies | 94.5% | 51.2 |
| Shipping the heavy contract early once its escort is full | 94.5% | 52.3 |

- **Starts.** Supply 96.5% (52.5 points), Lean 90.1% (50.0) and Rat-breeding 96.8% (54.2).
- **Contracts most often missed.** Elite muster (delivered 61.9%), Work gang (80.6%) and Kin escort (85.2%). The heavy contract ships in 95.8% of runs, for 37.5 points on average.
- **Runs that still fail.** 4.2% never reach a Supreme or Rainbow by day 12, and 1.3% ship the heavy contract but miss both early ones.
- **Refit tools.** Putting Hangman's Noose first was clearly best: 94.4% against 93.5% with the drill's order, 300,000 runs each. The final order was Rope, Skewer, Burning Stake, Avenger's Casket, Ring of Keys, Iron Box, Muzzle, Saw (measured before the Stake became the Searing Branding Iron).
- **Cargo.** Sending what qualifies plus spare Normals (`keep` 1) matched the tuner's strict minimum (1.5) on pass rate and added 1.1 points, on 1,000,000 fresh runs.

The two-meal chain's challenge profile had a one-round tune (5.2 million runs, 7.5 minutes). It passes 97.2% with 59.3 points on fresh prisons. On that chain, richer cargo on contract 2 pays (`keep2` 0.25).

## Results

### Instruments, re-measured (2026-10-13)

After the instruments took their live names, the Burning Stake became the Searing Branding Iron with the card's rule, and five live instruments were added (Sorting Hook, Iron Pestle, Warden's Scales, Iron Tongs of Lust, Fanged Guillotine). `guide --no-tune` re-measured both chains at **100,000 runs per measurement**, which keeps every margin under ±0.01 Rainbows (here ±0.002 to ±0.006): 3,800,000 runs in about 4 minutes per chain.

**Each instrument held from day 1** (no other rewards), sorted by the single-meal chain. Baselines with no instrument: 0.269 single-meal, 0.664 two-meal.

| Instrument | Single-meal | Change | Two-meal | Change |
| --- | --- | --- | --- | --- |
| Skewered Rat Heads | 1.106 | +0.837 | 1.413 | +0.749 |
| Avenger's Casket | 1.082 | +0.813 | 1.659 | +0.996 |
| Hangman's Noose | 1.056 | +0.787 | 1.751 | +1.087 |
| Rusty Saw | 0.707 | +0.438 | 1.262 | +0.598 |
| Fanged Guillotine | 0.578 | +0.309 | 0.939 | +0.275 |
| Sorting Hook | 0.559 | +0.290 | 1.101 | +0.437 |
| Iron Tongs of Lust | 0.557 | +0.288 | 0.944 | +0.280 |
| Lost Ring of Keys | 0.435 | +0.166 | 1.037 | +0.373 |
| Raging Beast's Agonizing Muzzle | 0.366 | +0.097 | 0.904 | +0.240 |
| Searing Branding Iron | 0.319 | +0.050 | 0.788 | +0.124 |
| Warden's Scales | 0.271 | +0.002 | 0.663 | **−0.001** |
| Iron Pestle | 0.259 | **−0.010** | 0.654 | **−0.010** |
| Squirming Iron Box | 0.122 | **−0.148** | 0.493 | **−0.171** |

**Rewards on** (an instrument at the first Supreme, a gift per Rainbow): 0.648 single-meal (was 0.744 with the 8 old tools), 1.261 two-meal. The drop comes from the first Supreme's offer: 3 of 13 instruments instead of 3 of 8, so a top-three one is on offer 58% of the time instead of 82%, and the strong Burning Stake is gone.

**Warden's Cache**, always the same gift: single-meal Crimson Vintage 0.635, Three-Headed Thumb Ring 0.610, Brand of Original Sin 0.609, Brass Horn of Strife 0.580; two-meal Crimson Vintage 1.232, Three-Headed Thumb Ring 1.180, Brand of Original Sin 1.106, Brass Horn of Strife 1.104. Judging each gift on the spot beats all of them on both chains.

The solver's instrument rankings (`toolRank` in PROFILES) now follow these orders. The challenge profiles keep their measured order for the seven unchanged instruments, with the rest appended, until `ctune` re-measures them.

### The first full study (2026-10-12)

From the full study on 2026-10-12, run on the two-meal food chain (the default at the time): 1,000,000 runs per test, default drill values. "Hard mode loop chain" below is the single-meal chain that is now the default. The ± figures are 95% margins.

**Speed.** 1,000,000 runs take about 61 seconds with no tools (16,300 runs/s) and 77 seconds with tool and Cache rewards on (12,900 runs/s), on 31 threads of an i9-14900K.

**No tools** (Rainbows vaulted per 20-day run):

| Strategy | Rainbows/run | Runs with a Rainbow |
| --- | --- | --- |
| Random legal moves | 0.047 | 5% |
| Simple: devour when possible, swap Normals, open doors | 0.411 | 40% |
| Solver strategy, starting weights | 0.577 | 55% |
| Solver strategy, tuned | **0.662 ± 0.001** | 62% |

**Rewards on** (a tool at the first Supreme, a Warden's Cache gift per Rainbow):

| Strategy | Rainbows/run |
| --- | --- |
| Random | 0.088 |
| Simple | 0.648 |
| Tuned for no tools, measured tool ranking | 1.336 |
| Retuned with rewards on | **1.390 ± 0.002** (82% of runs vault one or more) |

**Each tool held from day 1** (no other rewards; the baseline with no tool is 0.662):

| Tool | Rainbows/run | Change |
| --- | --- | --- |
| Hangman's Noose | 1.749 | +1.087 |
| Avenger's Casket | 1.655 | +0.994 |
| Skewered Rat Heads | 1.408 | +0.746 |
| Burning Stake | 1.402 | +0.741 |
| Rusty Saw | 1.258 | +0.596 |
| Lost Ring of Keys | 1.033 | +0.372 |
| Agonizing Muzzle | 0.902 | +0.240 |
| Squirming Iron Box | 0.490 | **−0.172** |

**Warden's Cache.** Scoring the gifts on the spot (1.336) beats always taking the same one. In order: Crimson Vintage 1.302, Three-Headed Thumb Ring 1.260, Brand of Original Sin 1.181, Brass Horn of Strife 1.176.

**Hard mode loop chain:** 0.269 with no tools, 0.706 with rewards. Each beast has only one meal, so chains break far more often.

### Training run (25.9 million runs)

`train` refined all four profiles the Trainer uses: 150,000 runs per test for the two standard profiles, 50,000 for hard mode, then 1,000,000 fresh prisons each to score the old and new weights. It played **25,900,000 simulated runs in 29.8 minutes** on 31 threads.

| Profile | Before | After | Runs with a Rainbow |
| --- | --- | --- | --- |
| Rewards on (default drill) | 1.3904 | **1.3925** ± 0.0019 | 82% |
| No tools | 0.6615 | **0.6618** ± 0.0011 | 62% |
| Hard mode, rewards on | 0.7061 | **0.7112** ± 0.0017 | 50% |
| Hard mode, no tools | 0.2674 | 0.2672 ± 0.0009 (kept the old weights) | 26% |

The gains are small. The strategy was already close to the best these scoring rules can do, and the extra runs mostly confirmed it. New weights were kept only where they scored at least as well on the fresh prisons.

### What wins

- **Devour every day you can, unless it breaks a prey mark.** The strategy devours whenever the best devour scores at least zero (`minDevour` 0). Two inmates of one rarity becoming one a tier higher is always a gain at the tuned tier values, so a devour scores below zero only when it ends a prey mark (the mark's free tiers each morning are lost), when it removes a beast the spread needs, or, in the challenge, when it eats what the next contract needs. Waiting for a bigger staircase never paid off. A devour threshold of +2 dropped results from 0.66 to 0.57, and +5 dropped them to 0.38.
- **Swap the warden's low-tier inmates.** With no tools, swapping Normal and Magic is best. Never swapping halves the result (0.36), and swapping only Normals gives 0.61. With rewards on, swapping Rares too is best (1.38 vs 1.36).
- **Accept Chain reactions** (0.66 vs 0.53 when skipped).
- **Accept an Execution only when it gains more than it removes.** Always accepting gives 0.64, and never accepting 0.61.
- **Walk further.** A bonus per step walked beat preferring short steps (0.66 vs 0.64).
- **Open doors.** A new inmate is worth more than walking to a known one that has no meal.

### Chains and how many beasts you need

A chain re-rolls the eater's beast after every bite, so the next bite depends only on which beasts wait at the next tier. These are the exact odds that the chain finds its next meal:

| Beasts waiting at the next tier | Standard chain | Loop chain |
| --- | --- | --- |
| Rat or Wolf | 50% | 25% |
| Lion or Mammoth | 25% | 25% |
| Rat + Mammoth, Rat + Lion, Rat + Wolf, Wolf + Mammoth | 75% | 50% |
| Lion + Wolf, Lion + Mammoth | 50% | 50% |
| **Rat + Mammoth + Lion, or Rat + Mammoth + Wolf** | **100%** | 75% |
| Lion + Wolf + Rat, or Mammoth + Lion + Wolf | 75% | 75% |
| All four | 100% | 100% |

The chance a chain reaches Rainbow is the product over the tiers it still has to climb. For example, a Rare eater needs food at Legendary and at Supreme, so best pairs at both give 75% × 75% = 56%. The simulation agrees. A Legendary eater reached Rainbow in a chain 77% of the time with 3 beasts fed at Supreme, 55% with 2 and 31% with 1. A Rare eater with 2 fed at both Legendary and Supreme reached it 31% of the time. Extra copies of a beast don't help a single chain, since each chain eats one inmate per tier. They only keep the staircase ready for the next one.

Chains produced 68% of all Rainbows. With rewards on, 64% of devours were a single bite, 26% two bites, 8% three, 1.8% four and 0.4% five.

The full numbers are in `results/report.json`. The tuned weights are in `results/tuned-notools.json` and `results/tuned-rewards.json`, and `js/solver.js` uses them.

# Screenshot reader

`js/scan.js` reads a screenshot of the live game's prison screen for the board analyzer. There's no AI and no OCR service. It compares the screenshot with reference data taken from labeled screenshots, all inside the player's browser, in about a second.

- **The board** is part of the game's scene, so it keeps its shape at any UI scale. The reader finds it by matching about 1,000 points on its fixed frame, at any size and position, which places every cell.
- **Cells.** A padlock means a locked cell; an orange rat head on it marks a rat nest, and a "!" an event. An inmate's beast comes from its face, matched against labeled portraits, and its rarity from its frame's color. The red jaws marker shows on every inmate with something to eat. The analyzer checks the reading against the markers, and a washed-out portrait takes whichever beast makes them fit.
- **The warden** is the gold arrow.
- **Panels** are UI, which players can scale apart from the scene, so each panel is found by its own text and measured from it: the door cards ("Go to Cell N"), the "N days until Riot" counter, the Torture Instruments panel and the Chromatic Prisoners panel. Digits are matched against digit shapes from the screenshots.
- **Instruments** are matched against the panel icons and the art on the instrument reward cards.

## Rebuilding it

The labeled screenshots go in `trainingdata/`, which isn't in the repo (see `.gitignore`), and their labels in `tools/scan-truth.json`. Then:

```
node tools/scan-build.js           # makes js/scan-data.js
node tools/scan-test.js            # scores the reader against the labels
node tools/scan-test.js --quick    # the screenshots as captured only
```

## Accuracy (2026-10-13)

Five labeled board screenshots, also resized to stand in for other resolutions and UI scales, and cropped to the board:

| Screenshots | Cells | Beasts | Rarity | Warden | Doors | Days | Instruments | Events, nests, jaws |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| As captured | 100% | 100% | 100% | 100% | 100% | 100% | 80% | 100% |
| Scaled 1.45× and 2× | 100% | 100% | 100% | 100% | 100% | 100% | 80% | 100% |
| Cropped to the board | 100% | 100% | 100% | 100% | 100% | 100% | (cropped out) | 100% |
| Scaled 0.8× | 100% | 100% | 100% | 100% | 80% | 80% | 80% | 100% |
| Scaled 0.6× | 97% | 100% | 100% | 100% | 20% | 40% | 80% | 98% |

- **Instruments.** The 80% is one screenshot where a tooltip covers the panel. Only three instruments have panel icons so far (Squirming Iron Box, Raging Beast's Agonizing Muzzle and Lost Ring of Keys). The others are matched against their reward-card art, which hasn't been tested on the panel yet.
- **Small screenshots.** At 0.6× the door and day digits are only a few pixels tall, so they're often misread there.
- **Chromatic prisoners.** No labeled screenshot has one yet, so the slot count is untested beyond reading 0.
- **Objectives** aren't read yet.

# Live data

The board analyzer shares the boards players ask about (see `worker/README.md`). Two boards in a row from the same game are a confirmed step of a live game, such as a patrol and what the door held, a swap and who came in, or a night and the next morning's doors. `live-data.js` pulls those boards into `beta/data/` and measures what the steps show, next to the simulator's values in `js/engine.js` (`DEFAULT_PARAMS`):

```
node tools/live-data.js pull     # new boards from the collector (the workflow does this every 6 hours)
node tools/live-data.js rates    # the report, also saved as beta/data/rates.json
node tools/live-data.js rates --all   # also count guesses nobody confirmed
node tools/live-data.js reports  # new reports of unknown events, instruments and gifts, into trainingdata/reports/
node tools/live-data.js reports --watch   # keep checking every minute; one NEW REPORT line each
```

It measures:
- door rarities and beasts (`tierWeights`, `beastWeights`),
- swaps,
- Ring of Keys side doors,
- scratched doors,
- the day-1 event rate (`eventChance`) and the Chain/Execution split,
- doors per morning (`fewerDoorsChance`) and how far ahead they are, which settles whether the office counts as a patrol step,
- devours and tool offers.

Each rate has a 95% range. A rate is judged once it has 30 observations, and rarities and beasts also get a chi-square test against the simulator's odds.

**What counts.** After "Do it here", the simulator's dice fill in what happened, and the screenshot reader fills in what it couldn't read for sure. Those parts count only once the player changes them or confirms them with "Matches my game", so the simulator's own odds don't leak into the measurements. A board the player entered by hand counts as is.

**Checked on simulated games.** Turning 3,000 simulated runs into analyzer boards (181,566 boards) gave back the simulator's own odds:
- door and swap rarities 52/27/15/6,
- beasts at 25% each,
- 18.1% of day-1 doors with an event,
- 80.4% Ring of Keys openings,
- no doors more than 5 steps ahead.

The one gap was Chain reactions at 53% instead of 50%. In the simulator, the strategy can see an event's kind and favors Chain reactions; live players can't see it.

**Caveat on events.** A door with no event marker might just be a marker nobody entered. Boards from the screenshot reader read event markers reliably.

# The Frozen Canvas lab

`canvas-sim.js` plays Frozen Canvases with the trainer's strategy (`js/canvas-solver.js`) and measures how often the Treasure Chest ends at Lv7, the only result that pays:

```
node tools/canvas-sim.js eval --games 400000
```

**Rules.** The rules come from the research in October 2026:
- Sources: the game's texts and tooltips seen in SS7 and SS13 gameplay videos, the SS6 and SS7 patch notes and hotfixes, and the tlidb wiki.
- The canvas has been a core Netherrealm mechanic since SS7 and is still in SS14.
- Confirmed:
  - a 6×6 canvas of blank, ice and void cells,
  - monster (round) and gameplay (diamond) paints, Lv1–7,
  - objectives with a range (Horizontal, Vertical, Diagonal, Adjacent) and a target type, where paints already in range count,
  - meeting an objective raises every matching paint in range,
  - the three brushstroke directions (Reimagine, Spread, Layer): 2 are offered, then 2 effects from the chosen one,
  - Forced Color Mixing at 5 and then 10 Colored Snow, 3 a canvas. It breaks 1 random paint on the canvas.
- **Practice values**, in `DEFAULT_PARAMS` and editable on the page, cover everything the game hides:
  - how often a canvas has a chest,
  - the inventory's levels,
  - Coloring Paint levels, ranges and targets,
  - the brushstroke pools,
  - ice and void counts.

**Two goals.** On a canvas with a Treasure Chest, the goal is a Lv7 chest. Without one, it's as many rainbow (Lv7) paints as possible. Their eggs can drop skills too. The score is the chest's worth by level (Lv7 = 100), plus 4 for each other rainbow paint.

**Result with the practice values** (100,000 canvases, about 15 seconds):

| | Lv7 chest, on chest canvases | Rainbow paints, on canvases without a chest |
| --- | --- | --- |
| Before forcing broke a paint, with Global objectives | 71.3% ± 0.4 | 0.31 ± 0.005 |
| Forcing breaks a paint, with Global objectives (40,000 canvases) | 55.2% ± 1.1 | 0.29 ± 0.011 |
| **Forcing breaks a paint, no Global objectives** | **42.1% ± 0.7** (average chest level 4.80) | **0.091 ± 0.003** |
| All rules confirmed by the player (2026-10-13) | 37.8% ± 0.6 (average chest level 4.69; 21% of chests are lost to forcing) | 0.102 ± 0.003 |
| **Look-ahead strategy (below)** | **37.6% ± 0.6** (average chest level 5.38; forcing 0.4 times a canvas, about 4% of chests lost) | **0.787 ± 0.009** |

Two rule changes on 2026-10-13 moved these numbers:
- **Forcing breaks a paint.** About 1 chest in 6 is lost to a break, even with the risk check below.
- **No Global objectives.** The player knows four ranges, so Global isn't dealt. Whole-canvas objectives made most of the rainbows on chest-less canvases.

An earlier fix in the strategy still holds. Once its chest reached Lv7, it went fishing for another chest with Layer's re-roll effect, and sometimes re-rolled its own finished chest. A Lv7 chest only changes through an effect like that, so the strategy never takes re-roll while a chest is on the canvas.

Live rules the user confirmed:
- The ranges are Horizontal, Vertical, Diagonal and Adjacent.
- An objective raises each matching paint in range by +1, and only Layer effects add more.
- Spread's ice effects turn an ice cell into a blank cell that takes paints.
- A Coloring Paint placed on a void cell isn't a paint: the cell stays void, and only its objective works from there.
- Forced Color Mixing meets the objective, but 1 random placed paint breaks (it can be the chest): it's gone, and nothing can go on that cell until a Spread effect repairs it. Another Spread effect lets the Coloring Paint go on a broken cell.
- Diagonal is the full X to the canvas edges. Adjacent is the 4 cells sharing an edge. A Coloring Paint doesn't count for its own objective, and the objective doesn't raise it.
- A Coloring Paint placed on a painted cell overwrites the paint there.
- Layer's random +1 can hit any paint in range, whatever the objective's type.
- A chest is never on the grid at the start. About 1 canvas in 4 or 5 has one among the paints, usually at Lv2 (practice values 22% and mostly Lv2).
- The canvas ends when every cell is filled, and there are always enough paints to fill it.
- An objective fails only when its range has no blank cell left and it is still short. A paint that doesn't match can go in range without failing it, but it doesn't rise. After a fail no new Coloring Paints come, but the failed objective can still be forced.
- A repair fixes 1 broken cell.
- Brushstroke refreshes are 0 to 2 a canvas, by the level of the pet.
- Every Coloring Paint seen live came at Lv3 and needs 3. The player says they can come up to Lv4, so the practice value is 70% Lv3, with some Lv1, Lv2 and Lv4.
- An objective completes the moment it is met, even right as its Coloring Paint is placed. The next Coloring Paint comes with a random range and 2 of the 3 brushstroke directions.
- The void count (11–15) comes from a live screenshot.

**Starting over.** For Colored Snow (practice value 5) a canvas starts over with the same canvas and paints, and the Coloring Paints and brushstrokes to come are rolled again. Players with a chest start over when the luck goes bad, and rarely force. `resets` measures that: it plays each chest canvas again and again until the chest is Lv7, and counts the Snow.

```
node tools/canvas-sim.js resets --games 20000 [--cap 100]
```

| 20,000 chest canvases | Lv7 per attempt | Colored Snow per Lv7 chest | Never got there in 100 attempts |
| --- | --- | --- | --- |
| Old strategy, forcing | 23.5% | 85.5 (81% of it on forcing) | 0.2% |
| Old strategy, never forcing | 0.6% | 809 | 60.6% |
| **Look-ahead, forcing** (5,000 canvases) | 17.0% | **49.0 ± 3.9** (50% on forcing; median 10) | 0.7% |
| **Look-ahead, never forcing** (5,000 canvases) | 8.7% | **52.5 ± 3.2** (median 10) | 4.9% |

The old strategy disagreed with live play, where players reach Lv7 by starting over and rarely force. Three fixes closed the gap:
- The starting Coloring Paint now always lands where its objective can be met. Random placement had left 55% of practice canvases dead from the start.
- An objective that can't be met is never chosen, even to reach the chest.
- Brushstrokes are chosen by look-ahead.

Without forcing, a chest canvas now completes 6.8 objectives instead of 1.7, and 38% of Coloring Paints complete the moment they land. Forcing and never forcing now cost about the same Colored Snow per Lv7 chest; never forcing just takes about twice the attempts. The per-attempt rates are pooled over attempts, so the hard canvases that take many attempts weigh most. Played once, a chest canvas reaches Lv7 30.6% of the time without forcing.

**The strategy:**
- **Placing the chest:** it goes first, on the cell whose row, column, diagonals and neighbors have the most open cells.
- **Objectives that reach the chest:** fill their ranges with matching paint.
- **Objectives that don't:** finish them quickly, off the chest's lines.
- **Brushstrokes, by look-ahead:** each effect is worth the best cell score the Coloring Paint would get after it. Random effects (a new range, a new Coloring Paint) are averaged over what they could give. A direction is worth the better of the 2 effects it would deal, on average. If nothing on offer can be met, refresh.
- **Where the Coloring Paint goes:** never where its objective can't be met. Best is a cell where it completes the moment it lands, and where it reaches the chest (more with Layer +1). Void, ice and broken cells score a cell's worth, because they save a blank one.
- **Never** take the re-roll effect while a chest is on the canvas.
- **Without a chest:** aim each objective at the highest paints (Layer's +1 is best), and force a stuck one when it pushes paints toward Lv7 by more than the break costs on average. Never force with a Lv7 chest on the canvas.
- **Forcing:** when an objective is stuck, force it if it feeds the chest, or to get a new Coloring Paint while the chest has room. Only with at least 6 paints on the canvas, so the break hits the chest 1 time in 6 or less. Thresholds from 4 to 8 score within 2 points of each other. Splitting the rule (forcing for the chest sooner, for a new Coloring Paint later) or capping forces scored 2 to 8 points worse.
