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

## Results

From the full study on 2026-10-12: 1,000,000 runs per test, standard food chain, default drill values. The ± figures are 95% margins.

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
| Hangman's Rope | 1.749 | +1.087 |
| Avenger's Box | 1.655 | +0.994 |
| Rat-Head Skewer | 1.408 | +0.746 |
| Burning Stake | 1.402 | +0.741 |
| Rusty Saw | 1.258 | +0.596 |
| Lost Key Ring | 1.033 | +0.372 |
| Agony Muzzle | 0.902 | +0.240 |
| Writhing Iron Box | 0.490 | **−0.172** |

**Warden's Cache.** Scoring the gifts on the spot (1.336) beats always taking the same one. In order: Crimson Wine 1.302, Three-Headed Ring 1.260, Brand of Sin 1.181, Bronze War Horn 1.176.

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

- **Devour every day you can.** Waiting for a bigger staircase never paid off. A devour threshold of +2 dropped results from 0.66 to 0.57, and +5 dropped them to 0.38.
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
