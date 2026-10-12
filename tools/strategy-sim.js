#!/usr/bin/env node
/* Tartarus Simulator: strategy lab.
 * Plays huge numbers of simulated drills with the rules-based strategy in
 * js/solver.js (no AI) to compare strategies, tune the strategy's weights,
 * rank tools and gifts, and measure devour chains. Games run in parallel on
 * every CPU core. Game i always uses seed "<seed>-i", so each strategy faces
 * the same prisons and the comparisons are fair.
 *
 *   node tools/strategy-sim.js tune   [--games 40000] [--rounds 3] [--rewards off|on] [--loop]
 *   node tools/strategy-sim.js eval   [--games 1000000] [--rewards off|on] [--loop] [--params file.json] [--only solver]
 *   node tools/strategy-sim.js tools  [--games 200000]
 *   node tools/strategy-sim.js gifts  [--games 200000]
 *   node tools/strategy-sim.js chains [--games 200000]
 *   node tools/strategy-sim.js report [--games 1000000]   (everything, written to tools/results)
 *   node tools/strategy-sim.js train  [--games 150000] [--final 1000000]   (fine-tunes every profile the solver uses)
 *
 *   Options: --threads N (default: cores - 1), --seed WORD, --params file.json
 */
'use strict';

const { Worker, isMainThread, parentPort } = require('worker_threads');
const os = require('os');
const fs = require('fs');
const path = require('path');
const T = require('../js/engine.js');
const S = require('../js/solver.js');

// ---------- Playing games (runs inside workers) ----------

function emptyStats() {
  return {
    games: 0, rainbows: 0, rainbowsSq: 0, dist: [0, 0, 0, 0, 0, 0],
    devours: 0, bites: 0, chainHist: [0, 0, 0, 0, 0, 0, 0],
    fromChain: 0, fromDevour: 0, fromOther: 0, bestTier: [0, 0, 0, 0, 0, 0],
    swaps: 0, executions: 0, opened: 0, firstDay: 0, firstCount: 0,
    stairs: {},
  };
}

function merge(a, b) {
  for (const k of Object.keys(b)) {
    if (k === 'stairs') {
      for (const [key, v] of Object.entries(b.stairs)) {
        const t = a.stairs[key] || (a.stairs[key] = { n: 0, rainbow: 0, bites: 0 });
        t.n += v.n;
        t.rainbow += v.rainbow;
        t.bites += v.bites;
      }
    } else if (Array.isArray(b[k])) b[k].forEach((v, i) => (a[k][i] = (a[k][i] || 0) + v));
    else a[k] += b[k];
  }
  return a;
}

// Simple strategies to compare against.
const BASELINES = {
  // Random legal moves: any destination, any target, swap half the time.
  random(st, random) {
    if (st.pending.length) return { type: 'choose', id: st.pending[0].options[Math.floor(random() * st.pending[0].options.length)] };
    if (st.phase === 'event') return { type: 'event', accept: random() < 0.5 };
    if (st.phase === 'patrol') return { type: 'patrol', cell: st.destinations[Math.floor(random() * st.destinations.length)] };
    const options = T.startOptions(st);
    if (options.length && random() < 0.7) return { type: 'devour', to: options[Math.floor(random() * options.length)].cell };
    const here = st.cells[st.position];
    if (st.used.swap < 1 && here.inmate && !here.sealed && random() < 0.3) return { type: 'swap' };
    return { type: 'end' };
  },
  // A sensible player without the math: devour whenever possible, swap
  // Normals, walk to an inmate that can eat, otherwise open a door.
  simple(st, random) {
    if (st.pending.length) return { type: 'choose', id: st.pending[0].options[0] };
    if (st.phase === 'event') return { type: 'event', accept: true };
    if (st.phase === 'patrol') {
      const hungry = st.destinations.find((n) => !st.cells[n].sealed && st.cells[n].inmate && T.devourOptions(st, n).length);
      const door = st.destinations.find((n) => st.cells[n].sealed && !st.cells[n].nest);
      return { type: 'patrol', cell: hungry !== undefined ? hungry : door !== undefined ? door : st.destinations[0] };
    }
    const options = T.startOptions(st);
    if (options.length) return { type: 'devour', to: options[Math.floor(random() * options.length)].cell };
    const here = st.cells[st.position];
    if (st.used.swap < 1 && here.inmate && !here.sealed && here.inmate.tier === 0) return { type: 'swap' };
    return { type: 'end' };
  },
};

function newDrill(game, i, seedWord) {
  const params = { rewards: !!game.rewards, loopChain: !!game.loop };
  const st = T.newGame({ mode: 'drill', scenario: game.scenario || 'empty', seed: `${seedWord}-${i}`, params });
  if (game.tool) {
    st.tools = [game.tool];
    if (game.tool === 'fire') st.destinations = st.destinations.slice(0, 2);
  }
  return st;
}

// The tiers above the eater, as "how many beasts could still eat there".
function stairKey(st, eaterCell) {
  const eater = st.cells[eaterCell].inmate;
  const { comp } = S.composition(st, eaterCell);
  const chain = T.FOOD_CHAINS[st.params.loopChain ? 'loop' : 'standard'];
  const eats = T.BEASTS.map((b) => chain[b].map((x) => T.BEASTS.indexOf(x)));
  let key = `${eater.tier}:`;
  for (let t = eater.tier + 1; t < T.RAINBOW; t++) {
    let fed = 0;
    for (let b = 0; b < 4; b++) if (eats[b].some((f) => comp[t * 4 + f] > 0)) fed += 1;
    key += fed;
  }
  return key;
}

function playGames(job) {
  const stats = emptyStats();
  for (let i = job.from; i < job.to; i++) {
    const st = newDrill(job.game, i, job.seed);
    const random = S.rng32(i * 2654435761 + 7);
    const decide = job.policy === 'solver' ? (s) => S.decide(s, job.params, random) : (s) => BASELINES[job.policy](s, random);
    let firstDay = 0;
    for (let guard = 0; st.phase !== 'ended' && guard < 2000; guard++) {
      const action = decide(st);
      const vaultBefore = st.vault.length;
      const key = job.stairs && action.type === 'devour' ? stairKey(st, st.position) : null;
      const result = S.apply(st, action);
      if (!result.ok) {
        if (!S.apply(st, { type: 'end' }).ok) break;
        continue;
      }
      const gained = st.vault.length - vaultBefore;
      if (action.type === 'devour') {
        let bites = 1;
        for (let k = st.log.length - 1; k >= 0; k--) {
          const x = st.log[k].x;
          if (x && x.type === 'devour') {
            bites = x.bites.length;
            break;
          }
        }
        stats.devours += 1;
        stats.bites += bites;
        stats.chainHist[Math.min(6, bites)] += 1;
        if (gained) stats[bites > 1 ? 'fromChain' : 'fromDevour'] += gained;
        if (key) {
          const t = stats.stairs[key] || (stats.stairs[key] = { n: 0, rainbow: 0, bites: 0 });
          t.n += 1;
          t.bites += bites;
          if (gained) t.rainbow += 1;
        }
      } else if (gained) stats.fromOther += gained;
      if (gained && !firstDay) firstDay = st.day;
    }
    const r = st.vault.length;
    stats.games += 1;
    stats.rainbows += r;
    stats.rainbowsSq += r * r;
    stats.dist[Math.min(5, r)] += 1;
    const best = Math.max(st.stats.best, r ? T.RAINBOW : 0);
    stats.bestTier[best] += 1;
    stats.swaps += st.stats.swaps;
    stats.executions += st.stats.executions;
    stats.opened += st.stats.opened;
    if (firstDay) {
      stats.firstDay += firstDay;
      stats.firstCount += 1;
    }
  }
  return stats;
}

if (!isMainThread) {
  parentPort.on('message', ({ id, job }) => parentPort.postMessage({ id, stats: playGames(job) }));
  return;
}

// ---------- Running jobs on every core ----------

const args = process.argv.slice(2);
const mode = args[0] && !args[0].startsWith('--') ? args[0] : 'eval';
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};
const THREADS = Number(opt('threads', Math.max(1, os.cpus().length - 1)));
const SEED = String(opt('seed', 'LAB'));
const RESULTS = path.join(__dirname, 'results');

const pool = [];
const waiting = new Map();
let nextId = 1;
let GAMES_PLAYED = 0;
for (let i = 0; i < THREADS; i++) {
  const w = new Worker(__filename);
  w.on('message', ({ id, stats }) => {
    waiting.get(id)(stats);
    waiting.delete(id);
  });
  w.on('error', (e) => {
    console.error(e);
    process.exit(1);
  });
  pool.push({ w, busy: false, queue: [] });
}

// Splits `games` games into chunks across the pool; resolves merged stats.
function run(policy, params, game, games, extra) {
  const chunks = Math.max(THREADS, Math.ceil(games / 2500));
  const size = Math.ceil(games / chunks);
  const jobs = [];
  for (let from = 0; from < games; from += size) {
    jobs.push({ policy, params, game, from, to: Math.min(games, from + size), seed: (extra && extra.seed) || SEED, stairs: !!(extra && extra.stairs) });
  }
  let next = 0;
  const total = emptyStats();
  return new Promise((resolveRun) => {
    let active = 0;
    let finished = false;
    const resolve = (stats) => {
      if (finished) return;
      finished = true;
      GAMES_PLAYED += stats.games;
      resolveRun(stats);
    };
    const launch = (worker) => {
      if (next >= jobs.length) {
        if (!active) resolve(total);
        return;
      }
      const job = jobs[next++];
      const id = nextId++;
      active += 1;
      waiting.set(id, (stats) => {
        merge(total, stats);
        active -= 1;
        launch(worker);
        if (next >= jobs.length && !active) resolve(total);
      });
      worker.w.postMessage({ id, job });
    };
    pool.forEach(launch);
  });
}

const mean = (s) => s.rainbows / s.games;
const se = (s) => Math.sqrt(Math.max(0, s.rainbowsSq / s.games - mean(s) ** 2) / s.games);
const pct = (x) => `${(100 * x).toFixed(1)}%`;
const fmt = (s) => `${mean(s).toFixed(4)} ± ${(1.96 * se(s)).toFixed(4)} Rainbows/run`;

function describe(s) {
  return {
    games: s.games,
    rainbowsPerRun: +mean(s).toFixed(4),
    ci95: +(1.96 * se(s)).toFixed(4),
    runsWithRainbow: +(1 - s.dist[0] / s.games).toFixed(4),
    rainbowCounts: s.dist.map((n) => +(n / s.games).toFixed(4)),
    devoursPerRun: +(s.devours / s.games).toFixed(2),
    bitesPerDevour: +(s.bites / Math.max(1, s.devours)).toFixed(3),
    chainLengths: s.chainHist.slice(1).map((n) => +(n / Math.max(1, s.devours)).toFixed(4)),
    rainbowSources: { chain: s.fromChain, singleDevour: s.fromDevour, other: s.fromOther },
    firstRainbowDay: s.firstCount ? +(s.firstDay / s.firstCount).toFixed(2) : null,
    swapsPerRun: +(s.swaps / s.games).toFixed(2),
    executionsPerRun: +(s.executions / s.games).toFixed(3),
    doorsPerRun: +(s.opened / s.games).toFixed(2),
  };
}

function loadParams() {
  const file = opt('params', null);
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// ---------- Tuning ----------

const GRID = {
  tierBase: [2.25, 2.5, 2.75, 3, 3.5],
  rainbowMult: [0.5, 1, 2, 4, 8],
  wOpen: [0, 0.5, 1, 1.5, 2, 3],
  wNow: [0, 0.5, 1, 1.5, 2, 3],
  wWalk: [0.5, 1, 1.5, 2, 3],
  wStep: [-1, 0, 0.3, 1, 2, 3, 5],
  wChain: [0, 4, 8, 16, 32],
  wStair: [0, 0.25, 0.5, 1, 2],
  swapMaxTier: [-1, 0, 1, 2],
  minDevour: [-1e9, -2, 0, 2, 5],
  execMargin: [-1e9, -5, 0, 5, 20, 1e9],
  acceptChain: [true, false],
};

async function tune(game, games, rounds, start, grid) {
  let best = Object.assign({}, S.DEFAULTS, start || {});
  let bestStats = await run('solver', best, game, games);
  console.log(`start: ${fmt(bestStats)}`);
  for (let round = 1; round <= rounds; round++) {
    let changed = false;
    for (const [key, values] of Object.entries(grid || GRID)) {
      const tried = [];
      for (const value of values) {
        if (value === best[key]) {
          tried.push([value, bestStats]);
          continue;
        }
        const stats = await run('solver', Object.assign({}, best, { [key]: value }), game, games);
        tried.push([value, stats]);
      }
      tried.sort((a, b) => mean(b[1]) - mean(a[1]));
      const [value, stats] = tried[0];
      const line = tried.map(([v, s]) => `${v}: ${mean(s).toFixed(4)}`).join('  ');
      if (value !== best[key] && mean(stats) > mean(bestStats)) {
        best = Object.assign({}, best, { [key]: value });
        bestStats = stats;
        changed = true;
        console.log(`round ${round} ${key} -> ${value}   (${line})`);
      } else console.log(`round ${round} ${key} stays ${best[key]}   (${line})`);
    }
    console.log(`after round ${round}: ${fmt(bestStats)}`);
    if (!changed) break;
  }
  return { params: best, stats: bestStats };
}

// A finer grid around a set of weights, for training on top of a tuning.
function fineGrid(p) {
  const scale = (v, factors) => [...new Set(factors.map((f) => +(v * f).toFixed(3)))];
  return {
    tierBase: [p.tierBase - 0.25, p.tierBase, p.tierBase + 0.25],
    rainbowMult: scale(p.rainbowMult, [0.75, 1, 1.5]),
    wOpen: scale(p.wOpen, [0.75, 1, 1.25]),
    wNow: scale(p.wNow, [0.75, 1, 1.25]),
    wWalk: scale(p.wWalk, [0.75, 1, 1.25]),
    wStep: [p.wStep - 0.5, p.wStep, p.wStep + 0.5, p.wStep + 1],
    wChain: scale(p.wChain, [0.5, 1, 1.5]),
    wStair: scale(p.wStair, [0.5, 1, 1.5]),
    swapMaxTier: [p.swapMaxTier - 1, p.swapMaxTier, p.swapMaxTier + 1].filter((v) => v >= -1 && v <= 4),
    minDevour: [-1, 0, 1],
    execMargin: [-5, 0, 5, 10],
    acceptChain: [true, false],
  };
}

// Training: fine-tunes every profile the solver uses, then scores the old
// and new weights on a fresh set of prisons, so the comparison is fair.
async function train(games) {
  const t0 = Date.now();
  const finalGames = Number(opt('final', 1000000));
  const variants = [
    { name: 'rewards', profile: 'rewards', game: { rewards: true }, games, rounds: 2 },
    { name: 'notools', profile: 'notools', game: { rewards: false }, games, rounds: 2 },
    { name: 'loop-rewards', profile: 'rewards', game: { rewards: true, loop: true }, games: Math.round(games / 3), rounds: 1 },
    { name: 'loop-notools', profile: 'notools', game: { rewards: false, loop: true }, games: Math.round(games / 3), rounds: 1 },
  ];
  const out = { when: new Date().toISOString(), threads: THREADS, gamesPerTest: games, finalGames, variants: {} };
  for (const v of variants) {
    console.log(`
== ${v.name}: fine-tune on ${v.games.toLocaleString()} runs per test ==`);
    const start = Object.assign({}, S.DEFAULTS, S.PROFILES[v.profile]);
    const tuned = await tune(v.game, v.games, v.rounds, start, fineGrid(start));
    save(`tuned-${v.name}.json`, tuned.params);
    const before = await run('solver', start, v.game, finalGames, { seed: 'FINAL' });
    const after = await run('solver', tuned.params, v.game, finalGames, { seed: 'FINAL' });
    out.variants[v.name] = { params: tuned.params, before: describe(before), after: describe(after) };
    console.log(`${v.name} on fresh prisons: before ${fmt(before)}, after ${fmt(after)}`);
  }
  out.totalGames = GAMES_PLAYED;
  out.seconds = +((Date.now() - t0) / 1000).toFixed(1);
  save('train-report.json', out);
  console.log(`
trained on ${GAMES_PLAYED.toLocaleString()} simulated runs in ${(out.seconds / 60).toFixed(1)} minutes; saved tools/results/train-report.json`);
}

// ---------- Chain math (exact, no simulation) ----------

function coverageTable(loop) {
  const chain = T.FOOD_CHAINS[loop ? 'loop' : 'standard'];
  const rows = [];
  for (let mask = 1; mask < 16; mask++) {
    const present = T.BEASTS.filter((_, i) => mask & (1 << i));
    const fed = T.BEASTS.filter((b) => chain[b].some((f) => present.includes(f)));
    rows.push({ beasts: present.map(T.beastName).join(' + '), size: present.length, continues: fed.length / 4, eatersFed: fed.map(T.beastName).join(', ') || 'none' });
  }
  return rows.sort((a, b) => a.size - b.size || b.continues - a.continues);
}

// ---------- Modes ----------

function save(name, data) {
  fs.mkdirSync(RESULTS, { recursive: true });
  fs.writeFileSync(path.join(RESULTS, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function main() {
  const t0 = Date.now();
  const games = Number(opt('games', mode === 'tune' ? 40000 : 200000));
  const game = { rewards: opt('rewards', 'off') === 'on', loop: !!opt('loop', false) };
  console.log(`${mode}: ${games.toLocaleString()} games per test on ${THREADS} threads, seed ${SEED}${game.rewards ? ', rewards on' : ', no tools'}${game.loop ? ', loop chain' : ''}`);

  if (mode === 'tune') {
    const { params, stats } = await tune(game, games, Number(opt('rounds', 3)), loadParams());
    const name = `tuned-${game.rewards ? 'rewards' : 'notools'}${game.loop ? '-loop' : ''}.json`;
    save(name, params);
    console.log(`\nbest: ${fmt(stats)}\n${JSON.stringify(params)}\nsaved tools/results/${name}`);
  } else if (mode === 'eval') {
    const params = loadParams();
    const only = opt('only', null);
    for (const policy of only ? String(only).split(',') : ['random', 'simple', 'solver']) {
      const start = Date.now();
      const stats = await run(policy, params, game, games);
      const secs = (Date.now() - start) / 1000;
      console.log(`${policy.padEnd(7)} ${fmt(stats)}  ${stats.games.toLocaleString()} runs in ${secs.toFixed(1)}s (${Math.round(stats.games / secs).toLocaleString()} runs/s)`);
      console.log(`        ${JSON.stringify(describe(stats))}`);
    }
  } else if (mode === 'tools') {
    const params = loadParams();
    const base = await run('solver', params, game, games);
    console.log(`no tool        ${fmt(base)}`);
    for (const tool of T.TOOL_IDS) {
      const stats = await run('solver', params, Object.assign({}, game, { tool }), games);
      console.log(`${T.TOOLS[tool].name.padEnd(18)} ${fmt(stats)}  (${(mean(stats) - mean(base) >= 0 ? '+' : '')}${(mean(stats) - mean(base)).toFixed(4)})`);
    }
  } else if (mode === 'gifts') {
    const params = loadParams();
    const rewards = Object.assign({}, game, { rewards: true });
    const scored = await run('solver', params, rewards, games);
    console.log(`scored on the spot  ${fmt(scored)}`);
    for (const id of T.GIFT_IDS) {
      const order = [id, ...T.GIFT_IDS.filter((g) => g !== id)];
      const stats = await run('solver', Object.assign({}, params || {}, { giftRank: order }), rewards, games);
      console.log(`always ${T.GIFTS[id].name.padEnd(18)} ${fmt(stats)}`);
    }
  } else if (mode === 'chains') {
    console.log('\nChance a chain finds its next meal, by the beasts waiting at that tier:');
    for (const loop of [false, true]) {
      console.log(loop ? '\nLoop food chain (hard mode):' : '\nStandard food chain:');
      for (const r of coverageTable(loop)) console.log(`  ${pct(r.continues).padStart(6)}  ${r.beasts}`);
    }
    const stats = await run('solver', loadParams(), game, games, { stairs: true });
    console.log(`\nSimulated with the strategy: ${fmt(stats)}`);
    console.log(JSON.stringify(describe(stats)));
    const rows = Object.entries(stats.stairs)
      .filter(([, v]) => v.n >= 200)
      .map(([k, v]) => ({ key: k, n: v.n, rainbow: v.rainbow / v.n, bites: v.bites / v.n }))
      .sort((a, b) => b.rainbow - a.rainbow);
    console.log('\nDevours by eater tier and beasts fed at each higher tier (top 25 by Rainbow rate):');
    for (const r of rows.slice(0, 25)) console.log(`  ${r.key.padEnd(8)} n=${String(r.n).padStart(8)}  Rainbow ${pct(r.rainbow).padStart(6)}  bites ${r.bites.toFixed(2)}`);
  } else if (mode === 'report') {
    await report(games);
  } else if (mode === 'train') {
    await train(games);
  }
  console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  pool.forEach((p) => p.w.terminate());
}

// The full study: no tools, then tools and the Warden's Cache, then chains.
async function report(games) {
  const out = { games, seed: SEED, threads: THREADS, when: new Date().toISOString() };
  const tuneGames = Number(opt('tune-games', 40000));
  const notools = { rewards: false };
  const rewards = { rewards: true };

  // --params starts the tuning from saved weights instead of the defaults.
  console.log('\n== 1. No tools: tune the strategy ==');
  const tuned = await tune(notools, tuneGames, Number(opt('rounds', 3)), loadParams());
  save('tuned-notools.json', tuned.params);
  out.params = tuned.params;

  console.log('\n== 2. No tools: compare strategies ==');
  out.notools = {};
  for (const policy of ['random', 'simple']) out.notools[policy] = describe(await run(policy, null, notools, games));
  out.notools.default = describe(await run('solver', S.DEFAULTS, notools, games));
  out.notools.tuned = describe(await run('solver', tuned.params, notools, games));
  for (const [k, v] of Object.entries(out.notools)) console.log(`${k.padEnd(8)} ${v.rainbowsPerRun} ± ${v.ci95}`);

  console.log('\n== 3. One tool held from day 1 ==');
  out.tools = {};
  for (const tool of T.TOOL_IDS) {
    out.tools[tool] = describe(await run('solver', tuned.params, Object.assign({}, notools, { tool }), games));
    console.log(`${T.TOOLS[tool].name.padEnd(18)} ${out.tools[tool].rainbowsPerRun} (${(out.tools[tool].rainbowsPerRun - out.notools.tuned.rainbowsPerRun).toFixed(4)})`);
  }
  const toolRank = T.TOOL_IDS.slice().sort((a, b) => out.tools[b].rainbowsPerRun - out.tools[a].rainbowsPerRun);
  const withRank = Object.assign({}, tuned.params, { toolRank });

  console.log('\n== 4. Rewards on: tool at the first Supreme, Cache gift per Rainbow ==');
  out.rewards = {};
  for (const policy of ['random', 'simple']) out.rewards[policy] = describe(await run(policy, null, rewards, games));
  out.rewards.tuned = describe(await run('solver', withRank, rewards, games));
  for (const id of T.GIFT_IDS) {
    const order = [id, ...T.GIFT_IDS.filter((g) => g !== id)];
    out.rewards[`always-${id}`] = describe(await run('solver', Object.assign({}, withRank, { giftRank: order }), rewards, games));
  }
  for (const [k, v] of Object.entries(out.rewards)) console.log(`${k.padEnd(14)} ${v.rainbowsPerRun} ± ${v.ci95}`);
  // Keep a fixed gift order only if it clearly beats scoring gifts on the spot.
  const bestGift = T.GIFT_IDS.slice().sort((a, b) => out.rewards[`always-${b}`].rainbowsPerRun - out.rewards[`always-${a}`].rainbowsPerRun)[0];
  if (out.rewards[`always-${bestGift}`].rainbowsPerRun > out.rewards.tuned.rainbowsPerRun + out.rewards.tuned.ci95) {
    withRank.giftRank = [bestGift, ...T.GIFT_IDS.filter((g) => g !== bestGift).sort((a, b) => out.rewards[`always-${b}`].rainbowsPerRun - out.rewards[`always-${a}`].rainbowsPerRun)];
    console.log(`gift order: ${withRank.giftRank.join(', ')}`);
  }

  console.log('\n== 5. Retune with rewards on ==');
  const tunedRewards = await tune(rewards, tuneGames, Number(opt('rounds', 3)), withRank);
  save('tuned-rewards.json', tunedRewards.params);
  out.paramsRewards = tunedRewards.params;
  out.rewards.retuned = describe(await run('solver', tunedRewards.params, rewards, games));
  console.log(`retuned ${out.rewards.retuned.rainbowsPerRun} ± ${out.rewards.retuned.ci95}`);

  console.log('\n== 6. Chains ==');
  out.coverage = { standard: coverageTable(false), loop: coverageTable(true) };
  const chainStats = await run('solver', tunedRewards.params, rewards, games, { stairs: true });
  out.chains = describe(chainStats);
  out.stairs = Object.entries(chainStats.stairs)
    .filter(([, v]) => v.n >= 500)
    .map(([k, v]) => ({ key: k, n: v.n, rainbow: +(v.rainbow / v.n).toFixed(4), bites: +(v.bites / v.n).toFixed(3) }))
    .sort((a, b) => b.rainbow - a.rainbow);

  console.log('\n== 7. Hard mode loop chain ==');
  out.loop = {
    notools: describe(await run('solver', tuned.params, { rewards: false, loop: true }, games)),
    rewards: describe(await run('solver', tunedRewards.params, { rewards: true, loop: true }, games)),
  };
  console.log(`loop, no tools ${out.loop.notools.rainbowsPerRun}; rewards ${out.loop.rewards.rainbowsPerRun}`);

  save('report.json', out);
  console.log('\nsaved tools/results/report.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
