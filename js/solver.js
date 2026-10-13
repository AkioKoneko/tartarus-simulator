/* Tartarus Simulator: solver.
 * Rules-based play with no AI, in three parts that work on the game state:
 *  - Chain math: the exact expected outcome of a devour, including the random
 *    chain after it.
 *  - A strategy: it scores every legal move from what the player can see and
 *    plays the best one. tools/strategy-sim.js tunes its weights by running
 *    millions of simulated games.
 *  - A Monte Carlo solver: it plays each candidate move out many times from
 *    the current position, with the strategy making every later choice, and
 *    ranks the moves by Rainbows vaulted. Each playout re-rolls everything
 *    the player can't see, so the solver never peeks behind a door.
 * Runs in the page (in a Web Worker when it can) and under Node. */
(function (root) {
  'use strict';

  const T = root.Tartarus || (typeof require === 'function' ? require('./engine.js') : null);
  const { BEASTS, RAINBOW } = T;
  const RAT = BEASTS.indexOf('rat');

  // Strategy weights. Values are in "tier value" units, where an inmate of
  // tier t is worth tierBase^t. tools/strategy-sim.js tuned these by
  // coordinate search over simulated runs (see tools/README.md).
  const DEFAULTS = {
    tierBase: 3, // how much one tier is worth over the tier below
    rainbowMult: 2, // a vaulted Rainbow, as a multiple of tierBase^5
    wOpen: 1, // patrol: value of adding a new inmate by opening a door
    wNow: 1, // patrol: what the new or visited inmate can do today
    wWalk: 1, // patrol: walking to a known inmate
    wStep: 0, // patrol: per step walked (negative keeps the warden slow)
    wNest: -6, // patrol: opening a rat nest before it hatches
    wChain: 4, // patrol: a door that hides a Chain reaction
    wStair: 0, // keeping a spread of beasts at each tier, so chains can go on
    minDevour: 0, // skip devours worth less than this (-1e9: never skip)
    swapMaxTier: 0, // swap the warden's inmate only at or below this tier
    execMargin: 0, // accept an Execution worth more than this
    acceptChain: true, // accept Chain reactions
    toolRank: ['rope', 'revenge', 'skewer', 'fire', 'saw', 'keys', 'muzzle', 'ironbox'], // measured: each tool held from day 1
    giftRank: null, // null scores the gifts on the spot; or a fixed order
    // Contract challenge: convoys for the first two contracts weigh their
    // points against what the inmates sent would be worth kept on the block.
    keep1: 0, // contract 1: an inmate kept is worth this share of its tier value, in points (0: send the most points)
    keep2: 0, // contract 2: the same
    reserve: 1, // vouchers to hold back for the heavy contract while delivering the first two
    earlyPoints: 1e9, // from day 9, ship the heavy contract early once it scores this many points (-1: once the escort is full)
    stuckRainbow: 1, // a Rainbow the heavy contract can't afford to ship, as a share of its usual worth
    minLeft: 1, // vouchers the first two contracts always leave for the heavy one (0 only to measure the old habit)
    wNeed: 0, // moves that bring the block closer to meeting the next contract, per inmate short
    needDays: 3, // ...counted only in the last few days before its deadline
    needCrit: 2, // ...and weighted this much more when the contract is a must (the other early one was missed)
  };

  // Tuned weights for each kind of run: tool rewards on or off, on the
  // two-meal chain or the default single-meal loop. The solver picks by the
  // run's settings. From tools/results/ (train-report.json for the two-meal
  // chain, guide-data-single.json for the single-meal one).
  const PROFILES = {
    rewards: { tierBase: 3, rainbowMult: 1, wOpen: 2.5, wNow: 1.5, wWalk: 1, wStep: 1, wChain: 8, wStair: 0.5, swapMaxTier: 2, minDevour: 0, execMargin: 10, acceptChain: true, toolRank: ['rope', 'revenge', 'skewer', 'fire', 'saw', 'keys', 'muzzle', 'ironbox'] },
    notools: { tierBase: 2.5, rainbowMult: 2, wOpen: 1.875, wNow: 1, wWalk: 1, wStep: 1, wChain: 16, wStair: 0.25, swapMaxTier: 1, minDevour: 0, execMargin: 0, acceptChain: true, toolRank: ['rope', 'revenge', 'skewer', 'fire', 'saw', 'keys', 'muzzle', 'ironbox'] },
    'loop-rewards': { tierBase: 2.75, rainbowMult: 1, wOpen: 2, wNow: 1.125, wWalk: 1, wStep: 1, wChain: 4, wStair: 0.5, swapMaxTier: 2, minDevour: 0, execMargin: 0, acceptChain: true, toolRank: ['skewer', 'revenge', 'rope', 'fire', 'saw', 'keys', 'muzzle', 'ironbox'] },
    'loop-notools': { tierBase: 2.5, rainbowMult: 8, wOpen: 3, wNow: 0.5, wWalk: 1.5, wStep: 1, wChain: 16, wStair: 0.25, swapMaxTier: 1, minDevour: 0, execMargin: 5, acceptChain: true, toolRank: ['skewer', 'revenge', 'rope', 'fire', 'saw', 'keys', 'muzzle', 'ironbox'] },
    // The contract challenge, tuned on passing first and then points.
    challenge: { tierBase: 2.25, rainbowMult: 0.5, wOpen: 1.5, wNow: 0.75, wWalk: 1, wStep: 0.5, wChain: 16, wStair: 0.25, swapMaxTier: 3, minDevour: 0, execMargin: 20, acceptChain: true, toolRank: ['rope', 'skewer', 'fire', 'revenge', 'keys', 'ironbox', 'muzzle', 'saw'], keep1: 1, keep2: 0.25, reserve: 3, earlyPoints: -1, wNeed: 160, needDays: 2, needCrit: 4 },
    'loop-challenge': { tierBase: 2.25, rainbowMult: 1, wOpen: 2, wNow: 0.75, wWalk: 1, wStep: 0.5, wChain: 8, wStair: 0.5, swapMaxTier: 3, minDevour: -2, execMargin: 5, acceptChain: true, toolRank: ['rope', 'skewer', 'fire', 'revenge', 'keys', 'ironbox', 'muzzle', 'saw'], keep1: 1, keep2: 1, reserve: 3, earlyPoints: 1e9, wNeed: 40, needDays: 2, needCrit: 4 },
  };
  const paramsFor = (st) => {
    const base = st.mode === 'challenge' ? 'challenge' : st.params.rewards ? 'rewards' : 'notools';
    return (st.params.loopChain && PROFILES[`loop-${base}`]) || PROFILES[base];
  };

  const withDefaults = (p) => Object.assign({}, DEFAULTS, p || {});

  // ---------- Small helpers ----------

  // mulberry32, for the solver's own dice (never the game's).
  function rng32(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const beastIndex = (b) => BEASTS.indexOf(b);
  const has = (st, id) => st.tools.includes(id);

  // Counts of open inmates by tier and beast (index tier * 4 + beast),
  // leaving out one cell, plus how many are on the block in all.
  function composition(st, exclude) {
    const comp = new Array(24).fill(0);
    let crowd = 0;
    for (const c of st.cells) {
      if (c.sealed || !c.inmate) continue;
      crowd += 1;
      if (c.n === exclude || c.inmate.tier >= RAINBOW) continue;
      comp[c.inmate.tier * 4 + beastIndex(c.inmate.beast)] += 1;
    }
    return { comp, crowd };
  }

  function normalize(weights) {
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0) || 1;
    return weights.map((w) => Math.max(0, w) / total);
  }

  // ---------- Chain math ----------

  // Everything a decision needs, computed once per position.
  function context(st, params) {
    const P = withDefaults(params);
    const chain = T.FOOD_CHAINS[st.params.loopChain ? 'loop' : 'standard'];
    const eats = BEASTS.map((b) => chain[b].map(beastIndex));
    const skewer = has(st, 'skewer');
    if (skewer) eats[RAT] = eats[RAT].concat(RAT);
    const v = [0, 1, 2, 3, 4, 5].map((t) => P.tierBase ** t);
    const openDist = normalize(st.params.tierWeights);
    return {
      st,
      P,
      eats,
      v,
      R: v[RAINBOW] * P.rainbowMult * (rainbowStuck(st) ? P.stuckRainbow : 1),
      saw: has(st, 'saw'),
      muzzle: has(st, 'muzzle'),
      skewer,
      revenge: has(st, 'revenge') && st.cells.some((c) => c.sealed),
      scratchExtra: 1 + (st.params.scratchStacksBase ? 1 : 0),
      openDist,
      openValue: openDist.reduce((sum, p, t) => sum + p * v[t], 0),
      need: contractNeed(st, P),
      memo: new Map(),
    };
  }

  // Tier odds for a swapped-in inmate, after Hangman's Rope and Burning Stake.
  function swapDist(ctx, oldTier) {
    const w = ctx.st.params.tierWeights.slice();
    if (has(ctx.st, 'rope')) w[0] = w[1] = 0;
    let dist = normalize(w);
    if (has(ctx.st, 'fire') && oldTier < 3) {
      dist = dist.map((p) => p * 0.6);
      dist[3] += 0.4;
    }
    return dist;
  }

  // Value from here on for an eater that just reached tier t: its beast
  // re-rolls, then it chains into a random valid meal if it has one.
  function rise(ctx, t, comp, crowd) {
    if (t >= RAINBOW) return ctx.R;
    let sum = 0;
    for (let b = 0; b < 4; b++) {
      if (ctx.revenge) {
        // Avenger's Box: 30% of the time a meal for the new form appears.
        const foods = ctx.eats[b];
        let spawned = 0;
        for (const f of foods) {
          comp[t * 4 + f] += 1;
          spawned += ctx.v[t] + feed(ctx, t, b, comp, crowd + 1);
          comp[t * 4 + f] -= 1;
        }
        sum += (0.3 * spawned) / foods.length + 0.7 * feed(ctx, t, b, comp, crowd);
      } else {
        sum += feed(ctx, t, b, comp, crowd);
      }
    }
    return sum / 4;
  }

  // An eater of beast b at tier t takes a random valid meal; with none, the
  // chain ends and it keeps its tier.
  function feed(ctx, t, b, comp, crowd) {
    let key = `${t}${b}${ctx.muzzle ? `m${Math.min(crowd, 4)}` : ''}`;
    for (let i = t * 4; i < 20; i++) key += String.fromCharCode(48 + comp[i]);
    const hit = ctx.memo.get(key);
    if (hit !== undefined) return hit;
    let total = 0;
    for (const f of ctx.eats[b]) total += comp[t * 4 + f];
    let out = ctx.v[t];
    if (total) {
      let sum = 0;
      for (const f of ctx.eats[b]) {
        const k = comp[t * 4 + f];
        if (!k) continue;
        comp[t * 4 + f] -= 1;
        sum += k * bite(ctx, t, b, comp, crowd, 0);
        comp[t * 4 + f] += 1;
      }
      out = sum / total;
    }
    ctx.memo.set(key, out);
    return out;
  }

  // One bite at tier t: the meal is gone and the eater rises.
  function bite(ctx, t, b, comp, crowd, extra) {
    let gain = 1 + extra;
    if (ctx.muzzle && crowd <= 3) gain += 2;
    if (ctx.skewer && b === RAT) gain += 1;
    const after = (g) => rise(ctx, Math.min(RAINBOW, t + g), comp, crowd - 1);
    return -ctx.v[t] + (ctx.saw ? 0.75 * after(gain) + 0.25 * after(gain + 1) : after(gain));
  }

  // Expected change in value from a devour: the chosen first meal, then the
  // random chain. `comp` leaves out the eater and still holds the meal.
  function devourDelta(ctx, tier, beast, meal, scratch, comp, crowd) {
    const i = tier * 4 + meal;
    if (!scratch) comp[i] -= 1;
    const value = bite(ctx, tier, beast, comp, crowd, scratch ? ctx.scratchExtra : 0) - ctx.v[tier];
    if (!scratch) comp[i] += 1;
    return value;
  }

  // The best first meal for an eater of this tier and beast, by expected value.
  function bestMeal(ctx, tier, beast, comp, crowd) {
    let best = { value: -Infinity, meal: -1 };
    for (const f of ctx.eats[beast]) {
      if (!comp[tier * 4 + f]) continue;
      const value = devourDelta(ctx, tier, beast, f, false, comp, crowd);
      if (value > best.value) best = { value, meal: f };
    }
    return best;
  }

  // Exact odds that a devour's chain reaches Rainbow, and its expected bites,
  // for the explanation lines. Uses the same rules as `rise`, without tools.
  function chainOdds(st, from, to) {
    const ctx = context(st, { tierBase: 1, rainbowMult: 1 });
    const eater = st.cells[from].inmate;
    const target = st.cells[to];
    const meal = target.sealed ? target.hidden : target.inmate;
    if (!eater || !meal) return { rainbow: 0, bites: 0 };
    const { comp } = composition(st, from);
    if (!target.sealed) comp[meal.tier * 4 + beastIndex(meal.beast)] -= 1;
    const memo = new Map();
    // Returns [P(reach Rainbow), expected further bites] from tier t, beast re-rolling.
    const fromTier = (t) => {
      if (t >= RAINBOW) return [1, 0];
      let p = 0;
      let n = 0;
      for (let b = 0; b < 4; b++) {
        const [pb, nb] = eat(t, b);
        p += pb / 4;
        n += nb / 4;
      }
      return [p, n];
    };
    const eat = (t, b) => {
      let key = `${t}${b}`;
      for (let i = t * 4; i < 20; i++) key += String.fromCharCode(48 + comp[i]);
      if (memo.has(key)) return memo.get(key);
      let total = 0;
      for (const f of ctx.eats[b]) total += comp[t * 4 + f];
      let out = [0, 0];
      if (total) {
        let p = 0;
        let n = 0;
        for (const f of ctx.eats[b]) {
          const k = comp[t * 4 + f];
          if (!k) continue;
          comp[t * 4 + f] -= 1;
          const [pf, nf] = fromTier(t + 1);
          comp[t * 4 + f] += 1;
          p += (k * pf) / total;
          n += (k * (nf + 1)) / total;
        }
        out = [p, n];
      }
      memo.set(key, out);
      return out;
    };
    const gain = target.sealed && target.scratch ? 1 + ctx.scratchExtra : 1;
    const [p, n] = fromTier(Math.min(RAINBOW, eater.tier + gain));
    return { rainbow: p, bites: 1 + n };
  }

  // ---------- Valuing positions and moves ----------

  // How ready the block is for chains: at each tier, the share of beasts an
  // eater could re-roll into and still find a meal there, weighted by tier.
  function stair(ctx, comp) {
    let value = 0;
    for (let t = 0; t < RAINBOW; t++) {
      let fed = 0;
      for (let b = 0; b < 4; b++) if (ctx.eats[b].some((f) => comp[t * 4 + f] > 0)) fed += 1;
      value += (fed / 4) * ctx.v[t];
    }
    return value;
  }

  // Change in readiness from adding (+1) or removing (-1) one inmate.
  function stairDelta(ctx, comp, tier, beast, sign) {
    if (!ctx.P.wStair || tier >= RAINBOW) return 0;
    const before = stair(ctx, comp);
    comp[tier * 4 + beast] += sign;
    const after = stair(ctx, comp);
    comp[tier * 4 + beast] -= sign;
    return ctx.P.wStair * (after - before);
  }

  // Expected readiness change from a new inmate with tier odds `dist`.
  function stairFresh(ctx, dist, comp) {
    if (!ctx.P.wStair) return 0;
    let sum = 0;
    for (let t = 0; t < dist.length; t++) for (let b = 0; b < 4; b++) if (dist[t]) sum += (dist[t] / 4) * stairDelta(ctx, comp, t, b, 1);
    return sum;
  }

  // What swapping an inmate of this tier is worth, on average.
  function swapValue(ctx, tier) {
    return swapDist(ctx, tier).reduce((sum, p, t) => sum + p * ctx.v[t], 0) - ctx.v[tier];
  }

  // What an inmate can do once the warden stands with it: its best devour or
  // a swap, whichever is worth more, and never below zero (it can just wait).
  function activation(ctx, tier, beast, comp, crowd, swapLeft) {
    let value = 0;
    if (tier < RAINBOW) value = Math.max(value, bestMeal(ctx, tier, beast, comp, crowd).value);
    if (swapLeft && tier <= ctx.P.swapMaxTier) value = Math.max(value, swapValue(ctx, tier));
    return value;
  }

  // What a brand-new inmate (tier odds `dist`) could do today, on average.
  function freshActivation(ctx, dist, comp, crowd, swapLeft) {
    let sum = 0;
    for (let t = 0; t < dist.length; t++) {
      if (!dist[t]) continue;
      for (let b = 0; b < 4; b++) sum += (dist[t] / 4) * activation(ctx, t, b, comp, crowd, swapLeft);
    }
    return sum;
  }

  // Expected value of a new inmate behind a door: its own worth plus what it
  // could do today from the warden's cell.
  function freshValue(ctx, dist, comp, crowd, swapLeft) {
    const worth = dist.reduce((sum, p, t) => sum + p * ctx.v[t], 0);
    return ctx.P.wOpen * worth + ctx.P.wNow * freshActivation(ctx, dist, comp, crowd, swapLeft) + stairFresh(ctx, dist, comp);
  }

  // Value of an Execution by an inmate of this tier and beast.
  function executionValue(ctx, tier, beast, comp) {
    const same = ctx.st.params.executionSameTier;
    const prey = T.FOOD_CHAINS[ctx.st.params.loopChain ? 'loop' : 'standard'][BEASTS[beast]].map(beastIndex);
    let count = 0;
    let lost = 0;
    for (let t = 0; t <= (same ? tier : tier - 1); t++) {
      if (same && t !== tier) continue;
      for (const f of prey) {
        count += comp[t * 4 + f];
        lost += comp[t * 4 + f] * ctx.v[t];
      }
    }
    if (!count) return 0;
    const to = Math.min(RAINBOW, tier + count);
    return (to >= RAINBOW ? ctx.R : ctx.v[to]) - ctx.v[tier] - lost;
  }

  // Scores today's destinations. Returns [{ cell, score, why }], best first.
  function patrolScores(st, ctx) {
    const P = ctx.P;
    const board = composition(st, -1);
    const swapLeft = st.used.swap < st.params.swapsPerDay;
    let fresh = null;
    const freshNow = () => (fresh === null ? (fresh = freshValue(ctx, ctx.openDist, board.comp, board.crowd + 1, swapLeft)) : fresh);
    const out = [];
    for (const n of T.patrolOptions(st)) {
      const c = st.cells[n];
      const steps = T.stepsBetween(st.position, n);
      let score = P.wStep * steps;
      let why;
      if (st.chain) {
        const path = T.clockwisePath(st, n);
        const sealed = path.filter((k) => st.cells[k].sealed).length;
        score += P.wOpen * (sealed - (c.sealed ? 1 : 0)) * ctx.openValue + (c.sealed ? freshNow() : c.inmate ? P.wWalk * known(c) : 0);
        why = `the chain opens ${T.plural(sealed, 'door')} on the way`;
      } else if (c.sealed && c.nest) {
        score += P.wNest;
        why = `it destroys the rat nest due on day ${c.nest.due}`;
      } else if (c.sealed) {
        const need = needValue(ctx, board.comp, [], ctx.openDist);
        score += freshNow() + need;
        why = need > 0 ? `a new inmate, who may help meet "${ctx.need.contract.name}"` : 'a new inmate, who may devour today';
        if (c.event === 'execution') {
          let exec = 0;
          for (let t = 0; t < ctx.openDist.length; t++) {
            for (let b = 0; b < 4; b++) exec += (ctx.openDist[t] / 4) * Math.max(0, executionValue(ctx, t, b, board.comp) - P.execMargin);
          }
          score += exec;
          why = 'an Execution waits behind the door';
        } else if (c.event === 'chain') {
          score += P.wChain;
          why = 'a Chain reaction waits behind the door';
        }
      } else if (c.inmate) {
        score += P.wWalk * known(c);
        why = `its ${T.describe(c.inmate)} can act today`;
      } else {
        why = 'an empty cell';
      }
      out.push({ cell: n, score, why });
    }
    return out.sort((a, b) => b.score - a.score);

    function known(cell) {
      const { comp, crowd } = composition(st, cell.n);
      return activation(ctx, cell.inmate.tier, beastIndex(cell.inmate.beast), comp, crowd, swapLeft);
    }
  }

  // What a prey mark still promises: both inmates rise a tier each morning.
  function linkValue(st, ctx, link) {
    let value = 0;
    for (const id of [link.lion, link.prey]) {
      const cell = T.cellOf(st, id);
      if (!cell || !cell.inmate) continue;
      const t = cell.inmate.tier;
      const to = Math.min(RAINBOW, t + link.rounds);
      value += (to >= RAINBOW ? ctx.R : ctx.v[to]) - ctx.v[t];
    }
    return value;
  }

  // The prey mark an action would end, valued (0 if none).
  function linkLoss(st, ctx, inmate, certain) {
    const link = inmate && T.linkOf(st, inmate.id);
    if (!link) return 0;
    // A Lion that devours re-rolls its beast; 1 in 4 times it stays a Lion.
    return linkValue(st, ctx, link) * (certain || link.prey === inmate.id ? 1 : 0.75);
  }

  // Today's devour options for the warden's inmate, valued. Best first.
  function devourScores(st, ctx) {
    const here = st.cells[st.position];
    if (!here || here.sealed || !here.inmate) return [];
    const { comp, crowd } = composition(st, st.position);
    const tier = here.inmate.tier;
    const beast = beastIndex(here.inmate.beast);
    const own = linkLoss(st, ctx, here.inmate, false);
    const whole = ctx.need ? composition(st, -1).comp : null;
    return T.startOptions(st)
      .map((o) => {
        const target = st.cells[o.cell];
        const meal = o.scratch ? target.hidden : target.inmate;
        const mealLink = o.scratch ? 0 : linkLoss(st, ctx, meal, true);
        const sameLink = own && mealLink && T.linkOf(st, here.inmate.id) === T.linkOf(st, meal.id);
        const loss = sameLink ? Math.max(own, mealLink) : own + mealLink;
        const stairLoss = o.scratch ? 0 : stairDelta(ctx, comp, meal.tier, beastIndex(meal.beast), -1);
        // The next contract: the meal leaves the block, and the eater rises
        // as a random beast (the chain after the first bite isn't counted).
        let need = 0;
        if (whole) {
          const removes = [[tier, beast]];
          if (!o.scratch) removes.push([meal.tier, beastIndex(meal.beast)]);
          const to = Math.min(RAINBOW, tier + T.gainFor(st, st.position, o).gain);
          need = needValue(ctx, whole, removes, [0, 1, 2, 3, 4, 5].map((t) => (t === to ? 1 : 0)));
        }
        return { cell: o.cell, score: devourDelta(ctx, tier, beast, beastIndex(meal.beast), !!o.scratch, comp, crowd) - loss + stairLoss + need };
      })
      .sort((a, b) => b.score - a.score);
  }

  // A swap in the warden's cell: the new inmate's worth over the old one,
  // less any prey mark it ends, plus the Ivory bonus if the cell has one.
  function swapGainHere(st, ctx) {
    const here = st.cells[st.position];
    if (!here || here.sealed || !here.inmate || st.used.swap >= st.params.swapsPerDay) return -Infinity;
    let gain = swapValue(ctx, here.inmate.tier) - linkLoss(st, ctx, here.inmate, true);
    if (ctx.need) gain += needValue(ctx, composition(st, -1).comp, [[here.inmate.tier, beastIndex(here.inmate.beast)]], swapDist(ctx, here.inmate.tier));
    if (here.ivory) {
      const board = st.cells.filter((c) => !c.sealed && c.inmate && c.inmate.tier < RAINBOW);
      const lift = board.reduce((sum, c) => sum + ctx.v[c.inmate.tier + 1] - ctx.v[c.inmate.tier], 0) / Math.max(1, board.length);
      gain += Math.min(st.params.ivoryCount, board.length) * lift;
      return gain;
    }
    return here.inmate.tier <= ctx.P.swapMaxTier ? gain : -Infinity;
  }

  // Board value for comparing gifts: tier values plus vaulted Rainbows, with
  // a bonus for inmates that have something to eat.
  function boardValue(st, ctx) {
    let value = st.vault.length * ctx.R;
    for (const c of st.cells) {
      if (c.sealed || !c.inmate) continue;
      value += ctx.v[c.inmate.tier] * (T.devourOptions(st, c.n).length ? 1.25 : 1);
    }
    return value;
  }

  function pickGift(st, ctx, options, random) {
    const P = ctx.P;
    if (P.giftRank) return P.giftRank.find((id) => options.includes(id)) || options[0];
    let best = null;
    for (const id of options) {
      let value = 0;
      const samples = id === 'ring' || id === 'horn' ? 3 : 1;
      for (let i = 0; i < samples; i++) {
        const trial = clone(st);
        trial.rng = (random() * 4294967296) >>> 0;
        if (!T.choose(trial, id).ok) continue;
        value += boardValue(trial, context(trial, P));
      }
      value /= samples;
      if (!best || value > best.value) best = { id, value };
    }
    return best ? best.id : options[0];
  }

  // ---------- Contract challenge ----------

  // True while a new Rainbow couldn't ship: the heavy contract is still to
  // come and too few vouchers are left for the heavy escort a Rainbow needs.
  function rainbowStuck(st) {
    const ch = st.challenge;
    return !!ch && !ch.result && ch.deliveries.length < 3 && ch.vouchers < T.ESCORTS.heavy.cost;
  }

  // The contract the block should get ready for: the next of the first two,
  // in its last `needDays` days. Null otherwise; the heavy contract only
  // needs a high tier, which the rest of the strategy already values.
  function contractNeed(st, P) {
    const ch = st.challenge;
    if (!ch || ch.window || !P.wNeed) return null;
    const slot = ch.deliveries.length;
    if (slot >= 2) return null;
    const contract = ch.contracts[slot];
    if (contract.deadline - st.day >= P.needDays) return null;
    const must = slot === 1 && !ch.deliveries[0].success;
    return { contract, weight: P.wNeed * (must ? P.needCrit : 1) };
  }

  // How many inmates the block is short of meeting a contract, from its
  // composition (tier * 4 + beast counts).
  function contractGap(contract, comp) {
    let size = 0;
    let elite = 0;
    let low = 0;
    let beasts = 0;
    let kin = 2;
    for (let b = 0; b < 4; b++) {
      let any = 0;
      let below = 0;
      for (let t = 0; t < RAINBOW; t++) {
        const k = comp[t * 4 + b];
        if (!k) continue;
        any += k;
        if (t === 2 || t === 3) elite += k;
        if (t <= 1) low += k;
        if (t < 3) below += k;
      }
      size += any;
      if (any) beasts += 1;
      // Kin escort: a Legendary and a lower inmate of its beast.
      const leg = comp[12 + b];
      if (leg && below) kin = 0;
      else if (leg && kin) kin = 1;
    }
    switch (contract.id) {
      case 'mixed': return Math.max(0, 3 - size) + Math.max(0, 2 - beasts);
      case 'cohort': return Math.max(0, 4 - size);
      case 'veteran': return Math.max(0, 1 - elite) + Math.max(0, 2 - low);
      case 'elite': return Math.max(0, 2 - elite) + Math.max(0, 2 - beasts);
      case 'kin': return kin;
      case 'muster': return Math.max(0, 3 - elite);
      default: return 0;
    }
  }

  // The value of a move for the next contract: how much closer it brings the
  // block, on average. `removes` lists [tier, beast] pairs leaving the block;
  // `addDist` gives tier odds for one inmate joining it, of a random beast.
  function needValue(ctx, comp, removes, addDist) {
    const need = ctx.need;
    if (!need) return 0;
    const before = contractGap(need.contract, comp);
    for (const [t, b] of removes) comp[t * 4 + b] -= 1;
    let after = 0;
    if (addDist) {
      for (let t = 0; t < addDist.length; t++) {
        if (!addDist[t] || t >= RAINBOW) continue;
        for (let b = 0; b < 4; b++) {
          comp[t * 4 + b] += 1;
          after += (addDist[t] / 4) * contractGap(need.contract, comp);
          comp[t * 4 + b] -= 1;
        }
      }
      // A Rainbow leaves for the vault, so it adds nobody to the block.
      if (addDist[RAINBOW]) after += addDist[RAINBOW] * contractGap(need.contract, comp);
    } else after = contractGap(need.contract, comp);
    for (const [t, b] of removes) comp[t * 4 + b] += 1;
    return need.weight * (before - after);
  }

  // The inmates that could ship, grouped by tier and beast: inmates in a group
  // are interchangeable for every contract. Within a group, cells with a prey
  // mark or Ivory go last, since they're worth more on the block.
  function cargoGroups(st) {
    const byKey = new Map();
    const add = (tier, beast, ref, last) => {
      const key = tier * 4 + beastIndex(beast);
      let g = byKey.get(key);
      if (!g) byKey.set(key, (g = { tier, beast: beastIndex(beast), refs: [] }));
      g.refs.push({ ref, last });
    };
    for (const c of st.cells) {
      if (c.sealed || !c.inmate) continue;
      add(c.inmate.tier, c.inmate.beast, { cell: c.n }, c.ivory || T.linkOf(st, c.inmate.id) ? 1 : 0);
    }
    for (const v of st.vault) add(RAINBOW, v.beast, { vault: v.id }, 0);
    const groups = [...byKey.values()];
    for (const g of groups) g.refs.sort((a, b) => a.last - b.last);
    return groups;
  }

  // The same tests as the engine's contract check, on counts.
  function fitsContract(contract, a) {
    let beasts = 0;
    for (let b = 0; b < 4; b++) if (a.mask & (1 << b)) beasts += 1;
    switch (contract.id) {
      case 'mixed': return a.size >= 3 && beasts >= 2;
      case 'cohort': return a.size >= 4;
      case 'veteran': return a.elite >= 1 && a.low >= 2;
      case 'elite': return a.elite >= 2 && beasts >= 2;
      case 'kin': return a.leg.some((n, b) => n >= 1 && a.below[b] >= 1);
      case 'muster': return a.elite >= 3;
      default: return a.top >= 1;
    }
  }

  // The best convoy for the open contract by `rate(plan)`, searching how many
  // of each group to send. A plan has the escort, its cost, points, pressure
  // and `kept`: what the inmates sent are worth on the block in tier values.
  // `rate` returns -Infinity to rule a plan out. Returns the best plan with
  // its cells and vault Rainbows, or null when nothing qualifies.
  function planCargo(st, ctx, rate) {
    const ch = st.challenge;
    const contract = T.currentContract(st);
    if (!ch || !contract || ch.vouchers < T.ESCORTS.light.cost) return null;
    const groups = cargoGroups(st);
    const counts = new Array(groups.length).fill(0);
    const escorts = Object.entries(T.ESCORTS).filter(([, e]) => ch.vouchers >= e.cost);
    const cap = Math.max(...escorts.map(([, e]) => e.cap));
    const bounty = contract.bounty ? beastIndex(contract.bounty) : -1;
    let best = null;
    const leaf = () => {
      const a = { size: 0, mask: 0, elite: 0, low: 0, top: 0, leg: [0, 0, 0, 0], below: [0, 0, 0, 0] };
      let points = 0;
      let pressure = 0;
      let kept = 0;
      for (let i = 0; i < groups.length; i++) {
        const k = counts[i];
        if (!k) continue;
        const g = groups[i];
        a.size += k;
        a.mask |= 1 << g.beast;
        if (g.tier === 2 || g.tier === 3) a.elite += k;
        if (g.tier <= 1) a.low += k;
        if (g.tier >= T.SUPREME) a.top += k;
        if (g.tier === 3) a.leg[g.beast] += k;
        else if (g.tier < 3) a.below[g.beast] += k;
        points += k * (2 ** g.tier + (g.tier >= T.SUPREME && g.beast === bounty ? 8 : 0));
        pressure += k * T.PRESSURE[g.tier];
        kept += k * (g.tier >= RAINBOW ? ctx.R : ctx.v[g.tier]);
      }
      if (!a.size || !fitsContract(contract, a)) return;
      for (const [escort, e] of escorts) {
        if (pressure > e.cap) continue;
        const plan = { escort, cost: e.cost, points, pressure, kept, size: a.size };
        const score = rate(plan);
        if (score > -Infinity && (!best || score > best.score)) best = Object.assign(plan, { score, counts: counts.slice() });
      }
    };
    const walk = (i, pressure) => {
      if (i === groups.length) return leaf();
      const g = groups[i];
      for (let k = 0; k <= g.refs.length && pressure + k * T.PRESSURE[g.tier] <= cap; k++) {
        counts[i] = k;
        walk(i + 1, pressure + k * T.PRESSURE[g.tier]);
      }
      counts[i] = 0;
    };
    walk(0, 0);
    if (!best) return null;
    best.cells = [];
    best.vaultIds = [];
    groups.forEach((g, i) => {
      for (const { ref } of g.refs.slice(0, best.counts[i])) {
        if (ref.vault !== undefined) best.vaultIds.push(ref.vault);
        else best.cells.push(ref.cell);
      }
    });
    return best;
  }

  // Ranks plans for the heavy contract, which ends the run: the most points,
  // then the cheaper escort.
  const mostPoints = (plan) => plan.points - 0.01 * plan.cost;

  // The strategy's convoy for the open window. The heavy contract takes the
  // most points. The first two weigh points against what the inmates sent
  // would be worth kept, and hold vouchers back for the heavy contract.
  function convoyPlan(st, ctx) {
    const ch = st.challenge;
    const slot = ch.deliveries.length;
    if (slot >= 2) return planCargo(st, ctx, mostPoints);
    const P = ctx.P;
    const keep = slot === 0 ? P.keep1 : P.keep2;
    // Vouchers to keep after this delivery: the reserve, plus one for
    // contract 2 when this is contract 1. Never fewer than one, or the
    // heavy contract can't ship at all. Contract 2 is a must when contract 1
    // was missed, so then any escort that leaves one voucher will do.
    const must = slot === 1 && !ch.deliveries[0].success;
    const need = must ? P.minLeft : Math.max(P.minLeft, P.reserve + (slot === 0 ? 1 : 0));
    return planCargo(st, ctx, (plan) => {
      const left = ch.vouchers - plan.cost;
      if (left < P.minLeft || (plan.escort !== 'light' && left < need)) return -Infinity;
      return plan.points - keep * plan.kept + 0.001 * plan.points - 0.01 * plan.cost;
    });
  }

  // From day 9, once the first two contracts are settled: ship the heavy
  // contract at the end of the day when its convoy is good enough.
  function wantsEarly(st, ctx) {
    if (!T.canOpenEarly(st) || st.day >= T.CHALLENGE_DAYS || ctx.P.earlyPoints >= 1e9) return false;
    const plan = planCargo(st, ctx, mostPoints);
    if (!plan) return false;
    if (ctx.P.earlyPoints >= 0) return plan.points >= ctx.P.earlyPoints;
    // -1: once nothing more fits in the best escort you can afford.
    const cap = st.challenge.vouchers >= T.ESCORTS.heavy.cost ? T.ESCORTS.heavy.cap : T.ESCORTS.light.cap;
    return cap - plan.pressure < T.PRESSURE[0];
  }

  // ---------- The strategy ----------

  // The move the strategy would play now, as an action object.
  function decide(st, params, random) {
    const ctx = context(st, params || paramsFor(st));
    const P = ctx.P;
    const roll = random || Math.random;
    if (st.phase === 'ended') return null;
    if (st.pending.length) {
      const choice = st.pending[0];
      if (choice.kind === 'gift') return { type: 'choose', id: pickGift(st, ctx, choice.options, roll) };
      return { type: 'choose', id: P.toolRank.find((id) => choice.options.includes(id)) || choice.options[0] };
    }
    if (st.challenge && st.challenge.window) {
      const plan = convoyPlan(st, ctx);
      if (plan) return { type: 'deliver', cells: plan.cells, vaultIds: plan.vaultIds, escort: plan.escort };
      return st.challenge.window.early ? { type: 'close' } : { type: 'skip' };
    }
    if (st.phase === 'event' && st.event) {
      if (st.event.kind === 'chain') return { type: 'event', accept: !!P.acceptChain };
      const exec = st.cells[st.event.cell].inmate;
      const { comp } = composition(st, st.event.cell);
      return { type: 'event', accept: executionValue(ctx, exec.tier, beastIndex(exec.beast), comp) > P.execMargin };
    }
    if (st.phase === 'patrol') {
      const scores = patrolScores(st, ctx);
      return scores.length ? { type: 'patrol', cell: scores[0].cell } : { type: 'end' };
    }
    // Manage: devour, swap or end the day. Both act on the warden's cell.
    const here = st.cells[st.position];
    const swapGain = swapGainHere(st, ctx);
    if (T.canDevourNow(st)) {
      const devours = devourScores(st, ctx);
      if (devours.length && devours[0].score >= P.minDevour) {
        // A swap first can be worth more than a weak devour: the new inmate
        // may still devour today.
        if (swapGain > -Infinity) {
          const { comp, crowd } = composition(st, st.position);
          const swapFirst = swapGain + P.wNow * freshActivation(ctx, swapDist(ctx, here.inmate.tier), comp, crowd, false);
          if (swapFirst > devours[0].score) return { type: 'swap' };
        }
        return { type: 'devour', to: devours[0].cell };
      }
    }
    if (swapGain > 0) return { type: 'swap' };
    if (st.challenge && wantsEarly(st, ctx)) return { type: 'early' };
    return { type: 'end' };
  }

  function apply(st, action) {
    switch (action.type) {
      case 'choose': return T.choose(st, action.id);
      case 'event': return T.resolveEvent(st, action.accept);
      case 'patrol': return T.patrol(st, action.cell);
      case 'devour': return T.devour(st, st.position, action.to);
      case 'swap': return T.swap(st, st.position);
      case 'end': return T.endDay(st);
      case 'deliver': return T.deliver(st, action.cells, action.vaultIds, action.escort);
      case 'skip': return T.skipDelivery(st);
      case 'close': return T.cancelEarlyDelivery(st);
      case 'early': return T.openEarlyDelivery(st);
      default: return { ok: false, reason: 'Unknown move.' };
    }
  }

  // Plays a run to the end with the strategy. `onMove` sees each move.
  function playout(st, params, random, onMove) {
    const roll = random || Math.random;
    for (let guard = 0; st.phase !== 'ended' && guard < 2000; guard++) {
      const action = decide(st, params, roll);
      if (!action) break;
      const result = apply(st, action);
      if (onMove) onMove(action, result, st);
      if (!result.ok && !(action.type !== 'end' && apply(st, { type: 'end' }).ok)) break;
    }
    return st;
  }

  // ---------- Monte Carlo solver ----------

  // A copy without the log, which playouts don't need.
  function clone(st) {
    const log = st.log;
    st.log = [];
    const copy = JSON.parse(JSON.stringify(st));
    st.log = log;
    return copy;
  }

  // Re-rolls everything the player can't see: the game's dice, and any
  // occupant behind a door that hasn't been fully revealed.
  function hideFuture(st, seed) {
    const random = rng32(seed);
    st.rng = (random() * 4294967296) >>> 0;
    for (const c of st.cells) {
      if (!c.sealed || !c.hidden || c.known >= 2) continue;
      if (c.known === 1) c.hidden.beast = BEASTS[Math.floor(random() * 4)];
      else c.hidden = null;
    }
  }

  // The moves worth comparing at this point of the run, with labels.
  function candidates(st) {
    const out = [];
    if (st.phase === 'ended') return out;
    if (st.pending.length) {
      for (const id of st.pending[0].options) out.push({ action: { type: 'choose', id }, label: `Take ${T.toolName(id)}` });
      return out;
    }
    if (st.challenge && st.challenge.window) {
      out.push(...convoyOptions(st));
      if (st.challenge.window.early) out.push({ action: { type: 'close' }, label: 'Close the early window' });
      else out.push({ action: { type: 'skip' }, label: 'Skip this contract' });
      return out;
    }
    if (st.phase === 'event' && st.event) {
      const name = st.event.kind === 'chain' ? 'Chain reaction' : 'Execution';
      out.push({ action: { type: 'event', accept: true }, label: `Accept the ${name}` });
      out.push({ action: { type: 'event', accept: false }, label: `Skip the ${name}` });
      return out;
    }
    if (st.phase === 'patrol') {
      if (T.canOpenEarly(st)) out.push({ action: { type: 'early' }, label: 'Deliver the heavy contract early' });
      for (const n of T.patrolOptions(st)) {
        const c = st.cells[n];
        const opens = st.chain ? T.clockwisePath(st, n).filter((k) => st.cells[k].sealed).length : 0;
        const what = st.chain ? `the chain opens ${T.plural(opens, 'door')}` : c.sealed ? (c.nest ? 'the rat nest' : c.event ? 'a locked door with an event' : 'a locked door') : c.inmate ? `the ${T.describe(c.inmate)}` : 'an empty cell';
        out.push({ action: { type: 'patrol', cell: n }, label: `Go to cell ${T.cellLabel(n)} (${what})` });
      }
      return out;
    }
    const here = st.cells[st.position];
    for (const o of T.startOptions(st)) {
      const target = st.cells[o.cell];
      const meal = o.scratch ? `the scratched door` : `the ${T.describe(target.inmate)}`;
      out.push({ action: { type: 'devour', to: o.cell }, label: `Devour ${meal} in ${T.cellLabel(o.cell)}` });
    }
    if (st.used.swap < st.params.swapsPerDay && here && !here.sealed && here.inmate) {
      out.push({ action: { type: 'swap' }, label: `Swap the ${T.describe(here.inmate)} in ${T.cellLabel(here.n)}` });
    }
    if (T.canOpenEarly(st)) out.push({ action: { type: 'early' }, label: 'Deliver the heavy contract early' });
    out.push({ action: { type: 'end' }, label: st.mode === 'drill' && st.day >= st.maxDays ? 'Finish the run' : 'End the day' });
    return out;
  }

  const sameSet = (a, b) => (a || []).length === (b || []).length && (a || []).every((x) => (b || []).includes(x));
  const sameAction = (a, b) => !!a && !!b && a.type === b.type && a.cell === b.cell && a.to === b.to && a.id === b.id && a.accept === b.accept
    && (a.type !== 'deliver' || (a.escort === b.escort && sameSet(a.cells, b.cells) && sameSet(a.vaultIds, b.vaultIds)));

  // Names a convoy: its inmates with their cells, the escort and the points.
  function cargoLabel(st, action, points) {
    const names = [...action.cells.map((n) => `${T.describe(st.cells[n].inmate)} ${T.cellLabel(n)}`), ...action.vaultIds.map(() => 'a vault Rainbow')];
    return `Send ${names.join(', ')} by ${action.escort} escort (${T.plural(points, 'point')})`;
  }

  // Convoys worth comparing in the open window: the strategy's pick, the most
  // points, the most points by light escort, and the cheapest cargo that
  // meets the contract. While the heavy contract is still to come, each one
  // keeps a voucher for it. The heavy contract ends the run, so for it the
  // strategy's pick (the most points) is the only convoy.
  function convoyOptions(st, params) {
    const ctx = context(st, params || paramsFor(st));
    const ch = st.challenge;
    const heavyNext = ch.deliveries.length < 2;
    const ok = (plan) => !heavyNext || ch.vouchers - plan.cost >= 1;
    const plans = [['pick', convoyPlan(st, ctx)]];
    if (heavyNext) {
      plans.push(
        ['most', planCargo(st, ctx, (p) => (ok(p) ? mostPoints(p) : -Infinity))],
        ['light', planCargo(st, ctx, (p) => (ok(p) && p.escort === 'light' ? mostPoints(p) : -Infinity))],
        ['least', planCargo(st, ctx, (p) => (ok(p) && p.escort === 'light' ? 0.001 * p.points - p.kept : -Infinity))],
      );
    }
    const out = [];
    for (const [kind, plan] of plans) {
      if (!plan) continue;
      const action = { type: 'deliver', cells: plan.cells.slice().sort((a, b) => a - b), vaultIds: plan.vaultIds.slice(), escort: plan.escort };
      if (out.some((c) => sameAction(c.action, action))) continue;
      out.push({ action, label: cargoLabel(st, action, plan.points), kind, points: plan.points });
    }
    return out;
  }

  // A finished playout's value. Drills count Rainbows vaulted. The challenge
  // counts passing first, then points: a pass is worth PASS_WEIGHT points,
  // so 1% of pass chance is worth 10 points.
  const PASS_WEIGHT = 1000;

  // The standard error of the mean difference between two options' values on
  // the same dice (rounds an option couldn't play are NaN and skipped).
  function pairedSe(a, b) {
    let n = 0;
    let sum = 0;
    let sq = 0;
    for (let i = 0; i < a.length && i < b.length; i++) {
      const d = a[i] - b[i];
      if (Number.isNaN(d)) continue;
      n += 1;
      sum += d;
      sq += d * d;
    }
    if (n < 2) return Infinity;
    const m = sum / n;
    return Math.sqrt(Math.max(0, sq / n - m * m) / n);
  }

  // Plays every candidate out `rollouts` times and ranks them by value. Each
  // round of playouts shares its dice across candidates (common random
  // numbers), so the differences between moves are measured, not the luck;
  // `gapSe` is each option's paired margin against the leader. `extra` adds
  // candidates, such as a convoy the player is putting together.
  // Returns a stepper: call step(budgetMs) until it reports done.
  function solve(st, opts) {
    const o = Object.assign({ rollouts: 400, seed: 1, params: null, extra: null }, opts || {});
    const base = clone(st);
    const list = candidates(base);
    for (const e of o.extra || []) if (!list.some((c) => sameAction(c.action, e.action))) list.push(Object.assign({ extra: true }, e));
    const random = rng32(o.seed);
    const pick = list.length ? decide(clone(base), o.params, rng32(o.seed ^ 0x5bd1e995)) : null;
    const goal = base.mode === 'challenge' ? 'contract' : 'rainbows';
    const rows = list.map((c) => ({ label: c.label, action: c.action, kind: c.kind || null, extra: !!c.extra, vals: [], pass: 0, points: 0, best: 0, policy: sameAction(c.action, pick) }));
    let round = 0;
    const result = () => {
      const ranked = rows
        .map((r) => {
          let n = 0;
          let sum = 0;
          let sq = 0;
          for (const x of r.vals) {
            if (Number.isNaN(x)) continue;
            n += 1;
            sum += x;
            sq += x * x;
          }
          const mean = n ? sum / n : 0;
          const sd = n > 1 ? Math.sqrt(Math.max(0, sq / n - mean * mean)) : 0;
          return { row: r, mean, se: n > 1 ? sd / Math.sqrt(n) : 0, n };
        })
        .sort((a, b) => b.mean - a.mean || b.row.best - a.row.best);
      const top = ranked[0];
      const options = ranked.map(({ row, mean, se, n }) => ({
        label: row.label,
        action: row.action,
        kind: row.kind,
        mean,
        se,
        gapSe: row === top.row ? 0 : pairedSe(top.row.vals, row.vals),
        n,
        pass: n ? row.pass / n : 0,
        points: n ? row.points / n : 0,
        best: n ? row.best / n : 0,
        policy: row.policy,
        extra: row.extra,
      }));
      return { done: round >= o.rollouts || rows.length <= 1, rounds: round, goal, options };
    };
    return {
      step(budgetMs) {
        const stop = Date.now() + (budgetMs || 50);
        while (round < o.rollouts && rows.length > 1 && Date.now() < stop) {
          const seed = (random() * 4294967296) >>> 0;
          for (const row of rows) {
            const trial = clone(base);
            hideFuture(trial, seed);
            if (!apply(trial, row.action).ok) {
              row.vals.push(NaN);
              continue;
            }
            const roll = rng32(seed ^ 0x9e3779b9);
            playout(trial, o.params, roll);
            if (goal === 'contract') {
              const res = trial.challenge.result;
              const passed = !!(res && res.passed);
              row.pass += passed ? 1 : 0;
              row.points += trial.challenge.score;
              row.vals.push((passed ? PASS_WEIGHT : 0) + trial.challenge.score);
            } else {
              row.vals.push(trial.vault.length);
              // Second measure: the best rarity reached.
              row.best += Math.max(0, ...trial.cells.filter((c) => !c.sealed && c.inmate).map((c) => c.inmate.tier), trial.vault.length ? RAINBOW : 0);
            }
          }
          round += 1;
        }
        return result();
      },
    };
  }

  // ---------- Trainer helpers ----------

  // The strategy's own pick with a short reason. Instant: no playouts.
  function instant(st, params) {
    const P = params || paramsFor(st);
    const action = decide(st, P, rng32(1));
    if (!action) return null;
    const match = candidates(st).find((c) => sameAction(c.action, action));
    return { action, label: match ? match.label : action.type, why: reason(st, action, P) };
  }

  function reason(st, action, params) {
    const ctx = context(st, params);
    const here = st.cells[st.position];
    switch (action.type) {
      case 'patrol': {
        const s = patrolScores(st, ctx).find((x) => x.cell === action.cell);
        return s ? `${s.why[0].toUpperCase()}${s.why.slice(1)}.` : '';
      }
      case 'devour': {
        const odds = chainOdds(st, st.position, action.to);
        return `The best first meal: its chain averages ${odds.bites.toFixed(1)} bites, with ${(100 * odds.rainbow).toFixed(0)}% to reach Rainbow.`;
      }
      case 'swap':
        if (here.ivory) return 'An Ivory cell: swapping it raises other inmates a tier.';
        return `A ${T.tierName(here.inmate.tier)} inmate is worth less than a fresh roll on average.`;
      case 'end':
        return T.canDevourNow(st) && T.startOptions(st).length ? 'No devour here gains anything today.' : 'Nothing left today is worth doing.';
      case 'event': {
        if (st.event.kind === 'chain') return action.accept ? 'Your next walk opens every sealed door on the way.' : 'More inmates would hurt this block today.';
        const exec = st.cells[st.event.cell].inmate;
        const victims = T.executionVictims(st, st.event.cell).length;
        return action.accept ? `The ${T.describe(exec)} removes ${T.plural(victims, 'inmate')} and rises as many tiers: it gains more than it removes.` : 'It would remove more than it gains.';
      }
      case 'choose': {
        if (st.pending[0].kind === 'gift') return 'Worth the most on this board right now.';
        const rank = ctx.P.toolRank.indexOf(action.id);
        return rank >= 0 ? `Ranked #${rank + 1} of ${ctx.P.toolRank.length} tools in training.` : '';
      }
      case 'deliver': return convoyWhy(st, action, params);
      case 'skip': return 'Nothing on the block meets this contract.';
      case 'close': return 'Nothing meets the heavy contract yet.';
      case 'early': return ctx.P.earlyPoints < 0
        ? 'The heavy convoy is as full as your escort allows, so waiting can’t add points. Shipping now locks in the pass.'
        : ctx.P.earlyPoints < 1e9
          ? `The heavy convoy scores at least ${ctx.P.earlyPoints} points now. Shipping locks in the pass.`
          : 'The heavy contract can be met now. Shipping it ends the run.';
      default: return '';
    }
  }

  // Why the strategy loads this convoy: what it keeps, and the vouchers left.
  function convoyWhy(st, action, params) {
    const ch = st.challenge;
    if (!action.cells) return '';
    const slot = ch.deliveries.length;
    if (slot >= 2) return 'The heavy contract ends the run, so it takes the most points your vouchers can escort.';
    const P = withDefaults(params || paramsFor(st));
    const keep = slot === 0 ? P.keep1 : P.keep2;
    const sent = new Set(action.cells);
    const kept = st.cells
      .filter((c) => !c.sealed && c.inmate && !sent.has(c.n))
      .sort((a, b) => b.inmate.tier - a.inmate.tier)
      .slice(0, 2)
      .map((c) => `${T.describe(c.inmate)} ${T.cellLabel(c.n)}`);
    const left = ch.vouchers - T.ESCORTS[action.escort].cost;
    const next = slot === 0 ? 'the next contracts' : 'the heavy contract';
    const keepText = kept.length ? ` Your ${kept.join(' and ')} stay for ${next}.` : '';
    const voucherText = left >= T.ESCORTS.heavy.cost
      ? ` It leaves ${T.plural(left, 'voucher')}, so the heavy contract can still go by heavy escort.`
      : ` It leaves ${T.plural(left, 'voucher')}.`;
    const lead = keep >= 1 ? 'Meets the contract with the inmates worth least to you.' : keep > 0 ? 'Meets the contract with the most points it can spare.' : 'Meets the contract for the most points.';
    return `${lead}${keepText}${voucherText}`;
  }

  // The move that turned `before` into `after`, as an action, or null if it
  // wasn't a game move (a Lab edit, say).
  function moveBetween(before, after) {
    if (!before || !after || before.phase === 'ended') return null;
    // The log entries the move added. The log only grows, though it drops its
    // oldest lines, so find where the last few lines it had before now sit.
    const n = before.log.length;
    const tail = Math.min(5, n);
    const same = (a, b) => a && b && a.d === b.d && a.k === b.k && a.t === b.t;
    const fits = (p) => {
      for (let k = 1; k <= tail; k++) if (!same(after.log[p - k], before.log[n - k])) return false;
      return true;
    };
    let from = 0;
    for (let p = Math.min(after.log.length, n); p >= tail; p--) {
      if (fits(p)) {
        from = p;
        break;
      }
    }
    const added = after.log.slice(from);
    const recent = (types) => {
      for (const e of added) if (e.x && types.includes(e.x.type)) return e.x;
      return null;
    };
    // While a choice is pending, nothing but the choice can be made.
    if (before.pending.length) {
      const x = recent(['tool', 'gift']);
      return x ? { type: 'choose', id: x.id } : null;
    }
    const ch0 = before.challenge;
    const ch1 = after.challenge;
    if (ch0 && ch0.window) {
      if (ch1.deliveries.length > ch0.deliveries.length) {
        if (!ch1.deliveries[ch1.deliveries.length - 1].success) return { type: 'skip' };
        const x = recent(['deliver']);
        return x && x.cells ? { type: 'deliver', cells: x.cells, vaultIds: x.vault || [], escort: x.escort } : { type: 'deliver' };
      }
      return ch1.window ? null : { type: 'close' };
    }
    if (ch1 && ch1.window && ch1.window.early && !(ch0 && ch0.window)) return { type: 'early' };
    if (before.phase === 'event') {
      if (after.phase === 'event') return null;
      const x = recent(['skipped', 'armed', 'execution']);
      return x ? { type: 'event', accept: x.type !== 'skipped' } : null;
    }
    if (before.phase === 'patrol') return after.stats.patrols > before.stats.patrols ? { type: 'patrol', cell: after.position } : null;
    if (after.used.devour > before.used.devour) {
      const x = recent(['devour']);
      return x ? { type: 'devour', to: x.bites[0].cell } : null;
    }
    if (after.used.swap > before.used.swap) return { type: 'swap' };
    if (after.day > before.day || after.phase === 'ended' || (ch1 && ch1.window && !(ch0 && ch0.window))) return { type: 'end' };
    return null;
  }

  const api = { DEFAULTS, PROFILES, PASS_WEIGHT, paramsFor, instant, moveBetween, sameAction, decide, apply, playout, candidates, solve, chainOdds, patrolScores, devourScores, context, composition, clone, hideFuture, rng32, executionValue, planCargo, mostPoints, convoyPlan, convoyOptions, cargoLabel };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusSolver = api;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
