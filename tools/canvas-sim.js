#!/usr/bin/env node
/* Tartarus Simulator: the Frozen Canvas lab.
 * Plays canvases with the trainer's strategy (js/canvas-solver.js) and
 * measures the two goals: a Lv7 Treasure Chest on canvases that have one,
 * and rainbow (Lv7) paints on canvases that don't.
 *
 *   node tools/canvas-sim.js eval [--games 100000] [--seed WORD] [--solver path]
 *
 * 100,000 canvases keep the margins near the lab's ±0.01 target. --solver
 * plays another version of the strategy, to compare. */
'use strict';

const path = require('path');
const C = require('../js/canvas-engine.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const mode = args[0] && !args[0].startsWith('--') ? args[0] : 'eval';
const games = Number(opt('games', 100000));
const seed = opt('seed', 'LAB');
global.TartarusCanvas = C;
const S = require(opt('solver', null) ? path.resolve(opt('solver')) : '../js/canvas-solver.js');

const margin = (p, n) => 1.96 * Math.sqrt((p * (1 - p)) / n);

function evaluate() {
  const t0 = Date.now();
  const chest = { n: 0, lv7: 0, levels: 0, rainbows: 0, forced: 0, hist: [0, 0, 0, 0, 0, 0, 0, 0] };
  const none = { n: 0, rainbows: 0, sq: 0, forced: 0, chestFound: 0, hist: {} };
  for (let g = 0; g < games; g++) {
    const st = C.newCanvas({ seed: `${seed}-${g}` });
    const had = st.inventory.some(C.isChest);
    S.playout(st);
    const r = C.rainbows(st);
    if (had) {
      const lv = C.bestChest(st);
      chest.n += 1;
      chest.hist[lv] += 1;
      chest.levels += lv;
      chest.rainbows += r;
      chest.forced += st.stats.forced;
      if (lv >= C.MAX_LEVEL) chest.lv7 += 1;
    } else {
      none.n += 1;
      none.rainbows += r;
      none.sq += r * r;
      none.forced += st.stats.forced;
      none.hist[r] = (none.hist[r] || 0) + 1;
      if (C.chests(st).length) none.chestFound += 1;
    }
  }
  const p = chest.lv7 / chest.n;
  const mean = none.rainbows / none.n;
  const sd = Math.sqrt(none.sq / none.n - mean * mean);
  console.log(`${games.toLocaleString()} canvases in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`With a chest (${chest.n.toLocaleString()}): Lv7 chest ${(100 * p).toFixed(1)}% ± ${(100 * margin(p, chest.n)).toFixed(1)}, average chest Lv${(chest.levels / chest.n).toFixed(2)}, ${(chest.rainbows / chest.n).toFixed(2)} other rainbows, ${(chest.forced / chest.n).toFixed(2)} forced`);
  console.log(`  Final chest levels 1-7: ${chest.hist.slice(1).map((n) => `${((100 * n) / chest.n).toFixed(1)}%`).join('  ')}`);
  console.log(`Without a chest (${none.n.toLocaleString()}): ${mean.toFixed(3)} ± ${(1.96 * sd / Math.sqrt(none.n)).toFixed(3)} rainbow paints, ${(none.forced / none.n).toFixed(2)} forced, a chest re-rolled in on ${((100 * none.chestFound) / none.n).toFixed(1)}%`);
  console.log(`  Rainbows per canvas: ${Object.keys(none.hist).map(Number).sort((a, b) => a - b).map((k) => `${k}: ${((100 * none.hist[k]) / none.n).toFixed(1)}%`).join('  ')}`);
}

// Starting over until the chest is Lv7, the way players do it: what a Lv7
// chest costs in Colored Snow, with the strategy playing every attempt.
// --games counts canvases with a chest here; --cap stops a canvas that
// never gets there.
function resets() {
  const t0 = Date.now();
  const cap = Number(opt('cap', 100));
  const R = C.DEFAULT_PARAMS.redrawCost;
  let canvases = 0;
  let attempts = 0;
  let wins = 0;
  let snow = 0;
  let sq = 0;
  let forcedSnow = 0;
  const costs = [];
  for (let g = 0; canvases < games; g++) {
    const st = C.newCanvas({ seed: `${seed}-${g}` });
    if (!st.inventory.some(C.isChest)) continue;
    canvases += 1;
    let won = false;
    let n = 0;
    while (n < cap) {
      n += 1;
      S.playout(st);
      if (C.bestChest(st) >= C.MAX_LEVEL) {
        won = true;
        break;
      }
      if (n < cap) C.reset(st);
    }
    attempts += n;
    snow += st.snow;
    sq += st.snow * st.snow;
    forcedSnow += st.snow - R * st.resets;
    if (won) wins += 1;
    costs.push(won ? st.snow : Infinity);
  }
  costs.sort((a, b) => a - b);
  const at = (q) => costs[Math.min(costs.length - 1, Math.floor(q * costs.length))];
  const mean = snow / canvases;
  const sd = Math.sqrt(sq / canvases - mean * mean);
  const show = (x) => (x === Infinity ? 'never' : String(x));
  console.log(`${canvases.toLocaleString()} canvases with a chest, started over until Lv7 (at most ${cap} attempts), in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`Lv7 per attempt ${((100 * wins) / attempts).toFixed(1)}%, ${(attempts / Math.max(1, wins)).toFixed(2)} attempts per Lv7 chest`);
  console.log(`Colored Snow per Lv7 chest: ${(snow / Math.max(1, wins)).toFixed(1)} (${R} per start over; ${((100 * forcedSnow) / Math.max(1, snow)).toFixed(0)}% of it on forcing). Per canvas ${mean.toFixed(1)} ± ${((1.96 * sd) / Math.sqrt(canvases)).toFixed(1)}`);
  console.log(`  Per canvas: median ${show(at(0.5))}, 75th ${show(at(0.75))}, 90th ${show(at(0.9))} Snow; ${(((canvases - wins) * 100) / canvases).toFixed(1)}% never got there in ${cap} attempts`);
}

if (mode === 'eval') evaluate();
else if (mode === 'resets') resets();
else {
  console.error('Usage: node tools/canvas-sim.js eval|resets [--games 100000] [--seed WORD] [--solver path] [--cap 100]');
  process.exit(2);
}
