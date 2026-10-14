#!/usr/bin/env node
/* Tartarus Simulator: the Frozen Canvas lab.
 * Plays canvases with the trainer's strategy (js/canvas-solver.js) and
 * measures how often the Treasure Chest reaches Lv7.
 *
 *   node tools/canvas-sim.js eval [--games 100000] [--seed WORD]
 *
 * 100,000 canvases keep the Lv7 rate's margin near ±0.5 points (the lab's
 * ±0.01 target). Only canvases with a chest count toward the rate. */
'use strict';

const C = require('../js/canvas-engine.js');
const S = require('../js/canvas-solver.js');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const mode = args[0] && !args[0].startsWith('--') ? args[0] : 'eval';
const games = Number(opt('games', 100000));
const seed = opt('seed', 'LAB');

function evaluate() {
  const t0 = Date.now();
  let withChest = 0;
  let lv7 = 0;
  let levels = 0;
  let forced = 0;
  let snow = 0;
  let objectives = 0;
  const hist = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let g = 0; g < games; g++) {
    const st = C.newCanvas({ seed: `${seed}-${g}` });
    if (!st.inventory.some(C.isChest)) continue;
    S.playout(st);
    withChest += 1;
    const lv = C.bestChest(st);
    hist[lv] += 1;
    levels += lv;
    if (lv >= C.MAX_LEVEL) lv7 += 1;
    forced += st.stats.forced;
    snow += st.snow;
    objectives += st.stats.objectives;
  }
  const p = lv7 / withChest;
  const margin = 1.96 * Math.sqrt((p * (1 - p)) / withChest);
  console.log(`${games.toLocaleString()} canvases, ${withChest.toLocaleString()} with a Treasure Chest (${((100 * withChest) / games).toFixed(1)}%), in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`Lv7 chest: ${(100 * p).toFixed(1)}% ± ${(100 * margin).toFixed(1)} of chest canvases`);
  console.log(`Average final chest level: ${(levels / withChest).toFixed(2)}`);
  console.log(`Final levels 1-7: ${hist.slice(1).map((n) => `${((100 * n) / withChest).toFixed(1)}%`).join('  ')}`);
  console.log(`Per chest canvas: ${(objectives / withChest).toFixed(1)} objectives met, ${(forced / withChest).toFixed(2)} forced (${(snow / withChest).toFixed(1)} Colored Snow)`);
}

if (mode === 'eval') evaluate();
else {
  console.error('Usage: node tools/canvas-sim.js eval [--games 100000] [--seed WORD]');
  process.exit(2);
}
