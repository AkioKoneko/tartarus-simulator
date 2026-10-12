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

The in-game Solver panel plays each candidate move out hundreds of times with this strategy. Everything the player can't see is re-rolled each time, and the moves are ranked by Rainbows at the end of the run.

## Results

See `results/report.json` for the latest full study. The tuned weights are in `results/tuned-notools.json` and `results/tuned-rewards.json`.
