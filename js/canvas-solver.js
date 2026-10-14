/* Tartarus Simulator: the Frozen Canvas solver.
 * Rules-based play with no AI, for the only goal that pays: a Lv7 Treasure
 * Chest. Two parts:
 *  - A strategy that makes every choice from what the player can see: where
 *    the chest goes (the cell with the most room on its lines), which paint
 *    goes where, which brushstroke to take, where each Coloring Paint lands,
 *    and when to force an objective.
 *  - A Monte Carlo check: each candidate move is played out many times from
 *    the current canvas, with the strategy making every later choice and
 *    everything random re-rolled (Coloring Paints, brushstrokes, re-rolled
 *    paints). Moves are ranked by the chest's worth at the end.
 * Runs in the page and under Node. */
(function (root) {
  'use strict';

  const C = root.TartarusCanvas || (typeof require === 'function' ? require('./canvas-engine.js') : null);
  const { rangeCells, isChest, matches, MAX_LEVEL } = C;
  const LINES = ['row', 'col', 'diag', 'adj'];

  // ---------- What the strategy looks at ----------

  const blank = (st, n) => st.cells[n].kind === 'blank' && !st.cells[n].paint;
  const open = (st, cells) => cells.filter((n) => blank(st, n)).length;

  // The chest that matters: the highest one on the canvas below Lv7.
  function chestCell(st) {
    let best = -1;
    for (const n of C.chests(st)) if (best < 0 || st.cells[n].paint.level > st.cells[best].paint.level) best = n;
    return best;
  }

  const chestInHand = (st) => st.inventory.findIndex((p) => isChest(p));

  // Room around a cell: blank cells on each of its lines, capped where more
  // stops helping, so a cell with room in every direction wins.
  function room(st, n, skip) {
    let sum = 0;
    for (const line of LINES) {
      const free = rangeCells(n, line).filter((m) => m !== skip && blank(st, m)).length;
      sum += Math.min(free, line === 'adj' ? 3 : 4) + (free > 0 ? 1 : 0);
    }
    return sum;
  }

  // Cells on the chest's lines: placing filler there costs it room.
  function chestLines(st, c) {
    const set = new Set();
    if (c < 0) return set;
    for (const line of LINES) for (const n of rangeCells(c, line)) set.add(n);
    return set;
  }

  // Would an objective with this shape at `at` raise the chest at `c`?
  const reaches = (st, at, o, c) => c >= 0 && at !== c && matches(st.cells[c].paint, o.target) && rangeCells(at, o.range).includes(c);

  // Whether the objective can still be met by placing paints: progress so far
  // plus the blank cells left in range, against what it needs.
  function feasible(st, o, at, extraBlankUsed) {
    const cells = rangeCells(at, o.range);
    const have = cells.filter((n) => matches(st.cells[n].paint, o.target)).length;
    const free = cells.filter((n) => n !== extraBlankUsed && blank(st, n)).length;
    return { have, free, slack: have + free - o.need };
  }

  // The paint to spend: the lowest one of the wanted kind, never the chest.
  function spare(st, target) {
    let best = -1;
    st.inventory.forEach((p, i) => {
      if (isChest(p) || (target && !matches(p, target))) return;
      if (best < 0 || p.level < st.inventory[best].level) best = i;
    });
    return best;
  }

  // ---------- The strategy ----------

  function decide(st) {
    if (st.phase === 'done') return null;
    if (st.phase === 'offer') return decideOffer(st);
    return decidePaint(st);
  }

  function decidePaint(st) {
    const blanks = C.blankCells(st);
    if (!blanks.length || !st.inventory.length) return null;
    const c = chestCell(st);
    const o = st.active;
    // A chest in hand goes on the board first: in the objective's range if
    // that raises it, otherwise where it has the most room.
    const hand = chestInHand(st);
    if (hand >= 0) {
      let cell = -1;
      let best = -Infinity;
      for (const n of blanks) {
        let s = room(st, n, -1);
        if (o && rangeCells(o.cell, o.range).includes(n) && matches(st.inventory[hand], o.target)) s += 6;
        if (s > best) {
          best = s;
          cell = n;
        }
      }
      return { type: 'place', inv: hand, cell };
    }
    const lines = chestLines(st, c);
    const chestLive = c >= 0 && st.cells[c].paint.level < MAX_LEVEL;
    if (o) {
      const inRange = rangeCells(o.cell, o.range).filter((n) => blank(st, n));
      const left = o.need - C.progress(st);
      const helps = chestLive && reaches(st, o.cell, o, c);
      if (inRange.length >= left && left > 0) {
        // Meet it: matching paints in range, off the chest's lines when the
        // objective doesn't feed the chest.
        const inv = spare(st, o.target);
        if (inv >= 0) {
          const cells = helps ? inRange : inRange.slice().sort((a, b) => lines.has(a) - lines.has(b));
          return { type: 'place', inv, cell: cells[0] };
        }
      } else if (left > 0 && chestLive && st.forced < st.params.forcedMax) {
        // Stuck: force it when it would feed the chest, or to get a new
        // Coloring Paint while the chest still has room to grow.
        if (helps || open(st, [...lines]) >= 3) return { type: 'force' };
      }
    }
    // Filler: away from the chest's lines, and off the active range so it
    // doesn't eat cells the objective needs.
    const active = o ? new Set(rangeCells(o.cell, o.range)) : new Set();
    const cells = blanks.slice().sort((a, b) => (lines.has(a) - lines.has(b)) || (active.has(a) - active.has(b)));
    const inv = spare(st, o ? (o.target === 'monster' ? 'gameplay' : o.target === 'gameplay' ? 'monster' : null) : null);
    return { type: 'place', inv: inv >= 0 ? inv : spare(st, null) >= 0 ? spare(st, null) : 0, cell: cells[0] };
  }

  // Brushstrokes and where the new Coloring Paint goes.
  function decideOffer(st) {
    const f = st.offer;
    const c = chestCell(st);
    const chestLive = c >= 0 && st.cells[c].paint.level < MAX_LEVEL;
    const o = f.coloring;
    if (f.stage === 'direction') {
      const rank = (dir) => directionValue(st, dir, o, c, chestLive);
      const best = f.directions.slice().sort((a, b) => rank(b) - rank(a))[0];
      if (rank(best) < 2 && st.refreshes > 0 && chestLive) return { type: 'refresh' };
      return { type: 'direction', dir: best };
    }
    if (f.stage === 'effect') {
      const rank = (id) => effectValue(st, id, o, c, chestLive);
      const best = f.effects.slice().sort((a, b) => rank(b) - rank(a))[0];
      if (rank(best) < 2 && st.refreshes > 0 && chestLive) return { type: 'refresh' };
      return { type: 'effect', id: best };
    }
    return { type: 'coloring', cell: placeColoringCell(st, o, c, chestLive) };
  }

  // Can this Coloring Paint be placed to raise the chest, with room to finish?
  function canFeedChest(st, o, c) {
    if (c < 0 || !matches(st.cells[c].paint, o.target)) return false;
    return C.placeTargets(st).some((at) => reaches(st, at, o, c) && feasible(st, o, at, at).slack >= 0);
  }

  function directionValue(st, dir, o, c, chestLive) {
    if (!chestLive) return dir === 'stack' ? 3 : 1; // fishing for a chest with re-rolled paints
    const feeds = o.target !== 'monster' && canFeedChest(st, o, c);
    if (dir === 'stack') return feeds ? 5 : 1;
    if (dir === 'turn') return o.target === 'monster' ? 4 : feeds ? 2 : 3;
    return feeds ? 2.5 : 3.5; // spread: room, or a way onto painted cells
  }

  function effectValue(st, id, o, c, chestLive) {
    if (!chestLive) return id === 'reroll' ? 5 : id === 'onPainted' ? 2 : 1;
    const feeds = o.target !== 'monster' && canFeedChest(st, o, c);
    switch (id) {
      case 'plusOne': return feeds ? 6 : 1;
      case 'randomOne': return feeds ? 4 : 1;
      case 'sameContent': return o.paint && isChest(o.paint) ? 6 : 1;
      case 'reroll': return 0; // could turn the chest into something else
      case 'flip': return o.target === 'monster' ? 6 : 0;
      case 'needDown': return 3.5;
      case 'reRange': return feeds ? 1 : 3;
      case 'renew': return o.target === 'monster' ? 3 : 1;
      case 'relevel': return 1;
      case 'onPainted': return 4;
      case 'iceRow':
      case 'iceCol':
      case 'voidNear': return 3;
      case 'onVoid': return 2.5;
      default: return 1;
    }
  }

  function placeColoringCell(st, o, c, chestLive) {
    const targets = C.placeTargets(st);
    const lines = chestLines(st, c);
    let best = targets[0];
    let bestScore = -Infinity;
    for (const at of targets) {
      const fz = feasible(st, o, at, at);
      let s = Math.min(fz.slack, 3) * 2 + (fz.slack >= 0 ? 10 : -10);
      const hitsChest = c >= 0 && rangeCells(at, o.range).includes(c);
      if (chestLive && reaches(st, at, o, c)) s += 100;
      if (o.extras.includes('reroll')) {
        if (hitsChest) s -= 1000;
        if (!chestLive) s += rangeCells(at, o.range).filter((n) => st.cells[n].paint && !st.cells[n].anchor).length * 3;
      }
      if (lines.has(at) && !st.cells[at].paint) s -= 3; // it takes a cell the chest could use
      if (s > bestScore) {
        bestScore = s;
        best = at;
      }
    }
    return best;
  }

  // ---------- Playing ----------

  function apply(st, a) {
    switch (a.type) {
      case 'place': return C.place(st, a.inv, a.cell);
      case 'force': return C.force(st);
      case 'refresh': return C.refresh(st);
      case 'direction': return C.chooseDirection(st, a.dir);
      case 'effect': return C.chooseEffect(st, a.id);
      case 'coloring': return C.placeColoring(st, a.cell);
      default: return { ok: false, reason: 'Unknown move.' };
    }
  }

  // Plays a canvas to the end with the strategy.
  function playout(st, limit) {
    for (let i = 0; i < (limit || 400) && st.phase !== 'done'; i++) {
      const a = decide(st);
      if (!a) {
        C.finish(st);
        break;
      }
      const r = apply(st, a);
      if (!r.ok) {
        C.finish(st);
        break;
      }
    }
    return st;
  }

  // ---------- The Monte Carlo check ----------

  const sameAction = (a, b) => !!a && !!b && a.type === b.type && a.inv === b.inv && a.cell === b.cell && a.dir === b.dir && a.id === b.id;

  // The moves worth comparing, with labels.
  function candidates(st) {
    const out = [];
    if (st.phase === 'done') return out;
    const label = (n) => C.cellLabel(n);
    if (st.phase === 'offer') {
      const f = st.offer;
      if (f.stage === 'direction') {
        for (const dir of f.directions) out.push({ action: { type: 'direction', dir }, label: `Take ${C.DIRECTIONS[dir].name}` });
        if (st.refreshes > 0) out.push({ action: { type: 'refresh' }, label: 'Refresh the directions' });
      } else if (f.stage === 'effect') {
        for (const id of f.effects) out.push({ action: { type: 'effect', id }, label: C.EFFECTS[id].text });
        if (st.refreshes > 0) out.push({ action: { type: 'refresh' }, label: 'Refresh the effects' });
      } else {
        for (const n of C.placeTargets(st)) out.push({ action: { type: 'coloring', cell: n }, label: `Place the Coloring Paint on ${label(n)}` });
      }
      return out;
    }
    const blanks = C.blankCells(st);
    const hand = chestInHand(st);
    if (hand >= 0) {
      for (const n of blanks) out.push({ action: { type: 'place', inv: hand, cell: n }, label: `Treasure Chest on ${label(n)}` });
      return out;
    }
    // One paint of each class, the lowest: other paints' levels don't matter.
    const kinds = ['gameplay', 'monster'].map((cls) => ({ cls, inv: spare(st, cls) })).filter((k) => k.inv >= 0);
    for (const k of kinds) for (const n of blanks) out.push({ action: { type: 'place', inv: k.inv, cell: n }, label: `${k.cls === 'gameplay' ? 'Gameplay' : 'Monster'} paint on ${label(n)}` });
    if (st.active && st.forced < st.params.forcedMax) out.push({ action: { type: 'force' }, label: `Force the objective (${st.params.forcedCost[Math.min(st.forced, st.params.forcedCost.length - 1)]} Colored Snow)` });
    return out;
  }

  // A seeded generator for playouts.
  function rng32(seed) {
    let s = seed >>> 0 || 1;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = Math.imul(s ^ (s >>> 15), s | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Plays every candidate out `rollouts` times. Returns a job that advances a
  // few rounds per step, so a page can show it as it goes.
  function solve(st, opts) {
    const o = opts || {};
    const rollouts = o.rollouts || 300;
    const random = rng32(o.seed || 1);
    const base = C.clone(st);
    const pick = decide(base);
    const options = candidates(base).map((c) => ({ ...c, policy: sameAction(c.action, pick), n: 0, sum: 0, sum2: 0, lv7: 0, levels: 0 }));
    let rounds = 0;
    return {
      step(batch) {
        for (let b = 0; b < (batch || 10) && rounds < rollouts; b++, rounds++) {
          const seed = (random() * 4294967296) >>> 0;
          for (const opt of options) {
            const s = C.clone(base);
            s.rng = seed; // same future for every option: a fair comparison
            const r = apply(s, opt.action);
            if (!r.ok) continue;
            playout(s);
            const v = C.score(s);
            const lv = C.bestChest(s);
            opt.n += 1;
            opt.sum += v;
            opt.sum2 += v * v;
            opt.levels += lv;
            if (lv >= MAX_LEVEL) opt.lv7 += 1;
          }
        }
        return result();
      },
    };
    function result() {
      const ranked = options.filter((x) => x.n).map((x) => {
        const mean = x.sum / x.n;
        const sd = Math.sqrt(Math.max(0, x.sum2 / x.n - mean * mean));
        return { action: x.action, label: x.label, policy: x.policy, n: x.n, mean, se: sd / Math.sqrt(x.n), lv7: x.lv7 / x.n, level: x.levels / x.n };
      }).sort((a, b) => b.mean - a.mean || b.lv7 - a.lv7);
      return { options: ranked, rounds, done: rounds >= rollouts, pick };
    }
  }

  // Why the strategy picks a move, in a sentence.
  function reason(st, a) {
    if (!a) return '';
    const c = chestCell(st);
    switch (a.type) {
      case 'place': {
        const p = st.inventory[a.inv];
        if (isChest(p)) return 'Put the Treasure Chest where its row, column, diagonals and neighbors have the most open cells, so later objectives can reach it.';
        if (st.active && rangeCells(st.active.cell, st.active.range).includes(a.cell) && matches(p, st.active.target)) {
          return c >= 0 && reaches(st, st.active.cell, st.active, c) ? 'This objective raises the chest: fill its range with matching paint.' : 'Finish this objective quickly, off the chest’s lines, to get the next Coloring Paint.';
        }
        return 'Filler, away from the chest’s lines so they stay open for objectives that can raise it.';
      }
      case 'force': return 'The objective is stuck: forcing it costs Colored Snow but moves the chest along.';
      case 'refresh': return 'Neither option helps the chest: re-roll them.';
      case 'direction':
        return a.dir === 'stack' ? 'Layer adds to the next objective’s effect: worth it when that objective can reach the chest.' : a.dir === 'turn' ? 'Reimagine can fix the objective: switch a monster target to gameplay, or change its range.' : 'Spread opens room: ice or void cells turn blank, or the paint can go on a painted cell.';
      case 'effect': return C.EFFECTS[a.id].text + '.';
      case 'coloring': return c >= 0 && reaches(st, a.cell, st.offer.coloring, c) ? 'From here its objective reaches the chest, with room to finish it.' : 'Here it can be finished fast without crowding the chest.';
      default: return '';
    }
  }

  const api = { decide, apply, playout, candidates, solve, reason, sameAction, chestCell, room };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.TartarusCanvasSolver = api;
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
