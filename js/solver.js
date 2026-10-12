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
    toolRank: ['muzzle', 'saw', 'revenge', 'skewer', 'keys', 'rope', 'ironbox', 'fire'],
    giftRank: null, // null scores the gifts on the spot; or a fixed order
  };

  // Tuned weights for drills with and without tool rewards; the solver
  // picks by the run's settings. From tools/results/tuned-*.json.
  const PROFILES = {
    notools: { tierBase: 2.5, rainbowMult: 2, wOpen: 1.5, wNow: 1, wWalk: 1, wStep: 1, wChain: 16, wStair: 0.25, swapMaxTier: 1, minDevour: 0, execMargin: 0, acceptChain: true },
    rewards: { tierBase: 2.5, rainbowMult: 2, wOpen: 1.5, wNow: 1, wWalk: 1, wStep: 1, wChain: 16, wStair: 0.25, swapMaxTier: 1, minDevour: 0, execMargin: 0, acceptChain: true },
  };
  const paramsFor = (st) => PROFILES[st.params.rewards ? 'rewards' : 'notools'];

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
      R: v[RAINBOW] * P.rainbowMult,
      saw: has(st, 'saw'),
      muzzle: has(st, 'muzzle'),
      skewer,
      revenge: has(st, 'revenge') && st.cells.some((c) => c.sealed),
      scratchExtra: 1 + (st.params.scratchStacksBase ? 1 : 0),
      openDist,
      openValue: openDist.reduce((sum, p, t) => sum + p * v[t], 0),
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
        score += freshNow();
        why = 'a new inmate, who may devour today';
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
    return T.startOptions(st)
      .map((o) => {
        const target = st.cells[o.cell];
        const meal = o.scratch ? target.hidden : target.inmate;
        const mealLink = o.scratch ? 0 : linkLoss(st, ctx, meal, true);
        const sameLink = own && mealLink && T.linkOf(st, here.inmate.id) === T.linkOf(st, meal.id);
        const loss = sameLink ? Math.max(own, mealLink) : own + mealLink;
        const stairLoss = o.scratch ? 0 : stairDelta(ctx, comp, meal.tier, beastIndex(meal.beast), -1);
        return { cell: o.cell, score: devourDelta(ctx, tier, beast, beastIndex(meal.beast), !!o.scratch, comp, crowd) - loss + stairLoss };
      })
      .sort((a, b) => b.score - a.score);
  }

  // A swap in the warden's cell: the new inmate's worth over the old one,
  // less any prey mark it ends, plus the Ivory bonus if the cell has one.
  function swapGainHere(st, ctx) {
    const here = st.cells[st.position];
    if (!here || here.sealed || !here.inmate || st.used.swap >= st.params.swapsPerDay) return -Infinity;
    let gain = swapValue(ctx, here.inmate.tier) - linkLoss(st, ctx, here.inmate, true);
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
      const best = T.bestCargo(st);
      if (best) return { type: 'deliver', cells: best.cells, vaultIds: best.vaultIds, escort: best.escort };
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
    if (st.challenge && st.challenge.window) return out;
    if (st.phase === 'event' && st.event) {
      const name = st.event.kind === 'chain' ? 'Chain reaction' : 'Execution';
      out.push({ action: { type: 'event', accept: true }, label: `Accept the ${name}` });
      out.push({ action: { type: 'event', accept: false }, label: `Skip the ${name}` });
      return out;
    }
    if (st.phase === 'patrol') {
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
    out.push({ action: { type: 'end' }, label: st.mode === 'drill' && st.day >= st.maxDays ? 'Finish the run' : 'End the day' });
    return out;
  }

  const sameAction = (a, b) => a && b && a.type === b.type && a.cell === b.cell && a.to === b.to && a.id === b.id && a.accept === b.accept;

  // Plays every candidate out `rollouts` times and ranks them by Rainbows.
  // Each round of playouts shares its dice across candidates (common random
  // numbers), so the differences between moves are measured, not the luck.
  // Returns a stepper: call step(budgetMs) until it reports done.
  function solve(st, opts) {
    const o = Object.assign({ rollouts: 400, seed: 1, params: null }, opts || {});
    const base = clone(st);
    const list = candidates(base);
    const random = rng32(o.seed);
    const pick = list.length ? decide(clone(base), o.params, rng32(o.seed ^ 0x5bd1e995)) : null;
    const rows = list.map((c) => ({ label: c.label, action: c.action, n: 0, sum: 0, sq: 0, best: 0, policy: sameAction(c.action, pick) }));
    let round = 0;
    const result = () => {
      const ranked = rows
        .map((r) => {
          const mean = r.n ? r.sum / r.n : 0;
          const sd = r.n > 1 ? Math.sqrt(Math.max(0, r.sq / r.n - mean * mean)) : 0;
          return { label: r.label, action: r.action, mean, se: r.n > 1 ? sd / Math.sqrt(r.n) : 0, n: r.n, best: r.n ? r.best / r.n : 0, policy: r.policy };
        })
        .sort((a, b) => b.mean - a.mean || b.best - a.best);
      return { done: round >= o.rollouts || rows.length <= 1, rounds: round, options: ranked };
    };
    return {
      step(budgetMs) {
        const stop = Date.now() + (budgetMs || 50);
        while (round < o.rollouts && rows.length > 1 && Date.now() < stop) {
          const seed = (random() * 4294967296) >>> 0;
          for (const row of rows) {
            const trial = clone(base);
            hideFuture(trial, seed);
            if (!apply(trial, row.action).ok) continue;
            const roll = rng32(seed ^ 0x9e3779b9);
            playout(trial, o.params, roll);
            const score = trial.vault.length;
            row.n += 1;
            row.sum += score;
            row.sq += score * score;
            row.best += Math.max(0, ...trial.cells.filter((c) => !c.sealed && c.inmate).map((c) => c.inmate.tier), trial.vault.length ? RAINBOW : 0);
          }
          round += 1;
        }
        return result();
      },
    };
  }

  const api = { DEFAULTS, PROFILES, paramsFor, decide, apply, playout, candidates, solve, chainOdds, patrolScores, devourScores, context, composition, clone, hideFuture, rng32, executionValue };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusSolver = api;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
