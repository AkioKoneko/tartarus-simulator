/* Tartarus Simulator: board analyzer.
 * The player sets up their board by hand: every cell, the warden, today's
 * doors, tools, vault and contracts. The page turns that into an engine state
 * and asks js/solver.js for the best move: the trained strategy's pick right
 * away, then a live check that plays every option out many times. "Do it here"
 * plays the move with the simulator's dice, so the player only has to fix what
 * came out differently in their game. Each board the player asks about is
 * handed to js/live.js, which shares runs of them to measure live's odds. */
(function () {
  'use strict';

  const T = window.Tartarus;
  const S = window.TartarusSolver;
  const B = window.TartarusBoard;
  const SHARE = window.TartarusLive || null;
  // The event kinds and steps the live collector (worker/) accepts.
  const COLLECTOR_EVENTS = ['unknown', 'chain', 'execution'];
  const COLLECTOR_STEPS = ['patrol', 'manage', 'event', 'choice', 'window'];
  const $ = (id) => document.getElementById(id);
  const L = (n) => T.cellLabel(n);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const toInt = (v, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? n : fallback;
  };
  // This script's version tag, so the solver worker loads matching files.
  const SCRIPT_QUERY = (() => {
    const src = document.currentScript ? document.currentScript.src : '';
    const q = src.indexOf('?');
    return q >= 0 ? src.slice(q) : '';
  })();

  const KEY = 'tartarus-sim:analyzer:v1';
  const SAVE_KEY = 'tartarus-sim:save:v2';
  const PLAYOUT_BUDGET = 9600; // playouts per check, shared across the options
  const LIVE_MIN = 150; // playouts per option before the live check can lead
  const STEPS = ['patrol', 'manage', 'office', 'chain', 'event', 'choice', 'window'];
  const STEP_NAMES = { patrol: 'Which door to patrol', manage: 'After the patrol', office: 'Instigate or Bestow', chain: 'A meal to pick', event: 'A special event', choice: 'A tool or gift', window: 'A delivery' };
  const BEAST_KEYS = { m: 'mammoth', l: 'lion', w: 'wolf', r: 'rat' };
  const TOP_TIER = T.SUPREME; // Rainbows leave for the vault, so cells hold Normal to Supreme

  const store = {
    get(key) {
      try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return null;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  // ---------- The board model ----------
  // What the player entered, in their terms. buildState() turns it into an
  // engine state, and modelFrom() turns an engine state back into a model.

  const officeCell = () => ({ kind: 'office' });
  const sealedCell = () => ({ kind: 'sealed', event: null });

  // What a cell holds, ignoring leftover fields and their order, so cells
  // from the reader or older edits compare equal when they hold the same.
  function cellSig(c) {
    switch (c.kind) {
      case 'inmate': return ['inmate', c.beast, toInt(c.tier, 0), !!c.ivory, c.prey ? [c.prey.cell, c.prey.rounds] : null].join('|');
      case 'scratch': return ['scratch', toInt(c.tier, 0), c.event || ''].join('|');
      case 'revealed': return ['revealed', toInt(c.tier, 0), c.event || ''].join('|');
      case 'scouted': return ['scouted', c.beast, toInt(c.tier, 0), c.event || ''].join('|');
      case 'sealed': return ['sealed', c.event || ''].join('|');
      case 'nest': return ['nest', toInt(c.due, 0)].join('|');
      default: return c.kind;
    }
  }

  function blankModel() {
    return {
      v: 1,
      mode: 'drill',
      // The game has one food chain. Shared boards still say which.
      chain: 'single',
      rewards: true,
      day: 1,
      maxDays: T.DEFAULT_PARAMS.drillDays,
      step: 'patrol',
      warden: T.OFFICE,
      dest: [],
      devourUsed: false,
      swapUsed: false,
      eventKind: 'chain',
      choice: { kind: 'tool', options: [] },
      windowKind: 'due',
      chainArmed: false,
      // Until the player sets it, no objective's tool is assumed.
      objective: 'other',
      walkTiles: 0,
      milestone: false,
      tools: [],
      vault: [],
      cells: Array.from({ length: T.CELL_COUNT }, (_, n) => (n === T.OFFICE ? officeCell() : sealedCell())),
      ch: { vouchers: T.START_VOUCHERS, contracts: ['mixed', 'elite', 'heavy'], bounty: 'wolf', status: ['pending', 'pending'], points: [0, 0] },
    };
  }

  // Fills in anything a saved model lacks, so older saves keep working.
  function normalize(m) {
    const base = blankModel();
    if (!m || typeof m !== 'object' || !Array.isArray(m.cells) || m.cells.length !== T.CELL_COUNT) return base;
    const out = Object.assign(base, m);
    out.ch = Object.assign(blankModel().ch, m.ch || {});
    out.choice = Object.assign(blankModel().choice, m.choice || {});
    out.cells = m.cells.map((c, n) => (n === T.OFFICE ? officeCell() : Object.assign(sealedCell(), c)));
    out.dest = Array.isArray(m.dest) ? m.dest.filter((n) => Number.isInteger(n) && n >= 0 && n < T.CELL_COUNT) : [];
    if (!STEPS.includes(out.step)) out.step = 'patrol';
    if (!T.OBJECTIVES[out.objective]) out.objective = 'other';
    out.walkTiles = clamp(toInt(out.walkTiles, 0), 0, T.OBJECTIVES.walk.need);
    out.chain = 'single';
    return out;
  }

  function makeContract(slot, id, bounty) {
    const def = T.CONTRACT_SLOTS[slot];
    const v = def.variants.find((x) => x.id === id) || def.variants[0];
    const contract = { slot, id: v.id, name: v.name, needs: v.needs.slice(), deadline: def.deadline, heavy: !!def.heavy };
    if (v.id === 'bounty') {
      contract.bounty = T.BEASTS.includes(bounty) ? bounty : 'wolf';
      contract.needs = ['At least 1 Supreme or Rainbow', `+8 points per Supreme or Rainbow ${T.beastName(contract.bounty)}`];
    }
    return contract;
  }

  // The engine state for a model, and anything that stops it from being
  // analyzed. Events the player can't name get a kind the solver re-rolls.
  function buildState(m) {
    const problems = [];
    const challenge = m.mode === 'challenge';
    const params = challenge ? {} : { rewards: !!m.rewards, drillDays: clamp(toInt(m.maxDays, 20), 5, 60) };
    const st = T.newGame({ mode: challenge ? 'challenge' : 'drill', params, seed: 'ANALYZER', loadout: 'supply' });
    st.rng = (Math.random() * 4294967296) >>> 0;
    st.log = [];
    st.day = clamp(toInt(m.day, 1), 1, st.maxDays);
    st.nextId = 1;
    const make = (beast, tier) => ({ id: st.nextId++, beast: T.BEASTS.includes(beast) ? beast : 'mammoth', tier: clamp(toInt(tier, 0), 0, TOP_TIER) });
    st.cells = m.cells.map((c, n) => {
      const cell = { n, sealed: n !== T.OFFICE, inmate: null, hidden: null, known: 0, scratch: false, nest: null, event: null, ivory: false };
      if (n === T.OFFICE) return cell;
      // Doors marked with an event ("!") have been passed; the rest may still
      // hide one the player can't see.
      const setEvent = () => {
        cell.seen = !!c.event;
        if (!c.event) return;
        cell.event = T.EVENTS[c.event] ? c.event : 'chain';
        if (c.event === 'unknown') cell.eventKnown = false;
      };
      if (c.kind === 'empty') cell.sealed = false;
      else if (c.kind === 'inmate') {
        cell.sealed = false;
        cell.inmate = make(c.beast, c.tier);
        cell.ivory = !!c.ivory;
      } else if (c.kind === 'nest') {
        // A nest due today hatched this morning, so a sealed one is due later.
        cell.nest = { due: Math.max(st.day + 1, toInt(c.due, st.day + 1)) };
      } else if (c.kind === 'scouted') {
        cell.known = 2;
        cell.hidden = make(c.beast, c.tier);
        setEvent();
      } else if (c.kind === 'scratch' || c.kind === 'revealed') {
        // The rarity shows; the beast stays hidden (re-rolled by the solver).
        cell.scratch = c.kind === 'scratch';
        cell.known = 1;
        cell.hidden = make(T.BEASTS[Math.floor(Math.random() * 4)], c.tier);
        setEvent();
      } else setEvent();
      return cell;
    });

    // Prey marks: a Lion and the same-rarity meal it marked.
    st.prey = [];
    m.cells.forEach((c, n) => {
      if (c.kind !== 'inmate' || c.beast !== 'lion' || !c.prey) return;
      const lion = st.cells[n].inmate;
      const target = st.cells[c.prey.cell];
      if (!target || !target.inmate || !T.canEat(st, lion, target.inmate)) {
        problems.push(`The prey mark from cell ${L(n)} needs a same-rarity meal for the Lion in cell ${L(c.prey.cell)}.`);
        return;
      }
      if (st.prey.some((l) => [l.lion, l.prey].includes(target.inmate.id) || [l.lion, l.prey].includes(lion.id))) {
        problems.push(`Cell ${L(c.prey.cell)} already has a prey mark.`);
        return;
      }
      st.prey.push({ lion: lion.id, prey: target.inmate.id, preyBeast: target.inmate.beast, rounds: clamp(toInt(c.prey.rounds, 1), 1, 9), next: st.day + 1 });
    });

    st.vault = m.vault.filter((b) => T.BEASTS.includes(b)).map((beast) => ({ id: st.nextId++, beast, day: 1 }));
    st.cache = st.vault.length;
    st.tools = T.TOOL_IDS.filter((id) => m.tools.includes(id));
    st.position = clamp(toInt(m.warden, 0), 0, T.CELL_COUNT - 1);
    st.chain = !!m.chainArmed;
    st.objective = { id: m.objective, progress: m.objective === 'walk' ? clamp(toInt(m.walkTiles, 0), 0, T.OBJECTIVES.walk.need) : 0 };
    st.milestone = !!m.milestone || (st.objective.id === 'walk' && st.objective.progress >= T.OBJECTIVES.walk.need);
    st.stats.best = Math.max(0, ...st.cells.filter((c) => c.inmate).map((c) => c.inmate.tier), st.vault.length ? T.RAINBOW : 0);
    st.used = { swap: 0, devour: 0 };
    st.destinations = [];
    st.event = null;
    st.pending = [];
    st.phase = 'manage';

    if (challenge) {
      const ch = st.challenge;
      ch.vouchers = clamp(toInt(m.ch.vouchers, T.START_VOUCHERS), 0, T.START_VOUCHERS);
      ch.contracts = [0, 1, 2].map((slot) => makeContract(slot, m.ch.contracts[slot], m.ch.bounty));
      ch.deliveries = [];
      ch.score = 0;
      for (let slot = 0; slot < 2; slot++) {
        const status = m.ch.status[slot];
        if (status !== 'delivered' && status !== 'skipped') break;
        const points = status === 'delivered' ? clamp(toInt(m.ch.points[slot], 0), 0, 999) : 0;
        ch.deliveries.push({ slot, day: ch.contracts[slot].deadline, success: status === 'delivered', points, cost: 0, pressure: 0, escort: status === 'delivered' ? 'light' : null, names: [], early: false });
        ch.score += points;
      }
      if (m.ch.status[0] === 'pending' && m.ch.status[1] !== 'pending') problems.push('Contract 2 can only be settled after contract 1.');
      const next = ch.contracts[ch.deliveries.length];
      if (next && !next.heavy && st.day > next.deadline) problems.push(`"${next.name}" was due at the end of day ${next.deadline}. Mark it delivered or skipped.`);
      ch.window = null;
    }

    const usedToday = () => {
      st.used = { swap: m.swapUsed ? 1 : 0, devour: m.devourUsed ? 1 : 0 };
    };
    switch (m.step) {
      case 'patrol': {
        st.phase = 'patrol';
        st.destinations = [...new Set(m.dest)]
          .filter((n) => Number.isInteger(n) && n >= 0 && n < T.CELL_COUNT && n !== st.position)
          .sort((a, b) => T.stepsBetween(st.position, a) - T.stepsBetween(st.position, b));
        if (!st.destinations.length) problems.push("Mark today's doors: tick them under “Which door to patrol”, or select a cell and press Today's door.");
        // Doors are always among the cells just ahead of the warden, clockwise.
        // One outside them means the warden (or the door) is in the wrong
        // cell, and the advice would send the warden most of the way round.
        const range = st.params.patrolRange;
        const reach = (w, n) => T.stepsBetween(w, n) >= 1 && T.stepsBetween(w, n) <= range;
        const doors = [...new Set(m.dest)].filter((n) => Number.isInteger(n) && n >= 0 && n < T.CELL_COUNT);
        const outside = doors.filter((n) => !reach(st.position, n));
        if (outside.length) {
          const fits = [];
          for (let w = 0; w < T.CELL_COUNT; w++) if (doors.every((n) => reach(w, n))) fits.push(L(w));
          const where = fits.length > 1 ? `${fits.slice(0, -1).join(', ')} or ${fits[fits.length - 1]}` : fits[0];
          problems.push(`Doors are always among the ${range} cells clockwise ahead of the warden, and ${outside.length === 1 ? `cell ${L(outside[0])} isn't` : `cells ${outside.map(L).join(' and ')} aren't`}: the warden is set in cell ${L(st.position)}. ${fits.length ? `Check the warden's cell: with these doors it's in cell ${where}.` : "No single cell has all these doors in reach, so check the doors too."}`);
        }
        break;
      }
      case 'event': {
        const here = st.cells[st.position];
        if (!here || here.sealed || !here.inmate) problems.push("An event needs the inmate that came out of the door in the warden's cell: put the warden there and set its inmate.");
        st.phase = 'event';
        st.event = { kind: T.EVENTS[m.eventKind] ? m.eventKind : 'chain', cell: st.position };
        break;
      }
      case 'choice': {
        usedToday();
        const kind = ['tool', 'refit', 'gift'].includes(m.choice.kind) ? m.choice.kind : 'tool';
        const options = kind === 'gift' ? T.GIFT_IDS.slice() : [...new Set(m.choice.options)].filter((id) => T.TOOLS[id] && !st.tools.includes(id));
        if (!options.length) problems.push('Pick the tools on offer.');
        if (kind === 'refit' && !challenge) problems.push('Refits only follow contract deliveries. Pick the contract challenge, or another kind of offer.');
        st.pending = [{ kind, options, slot: challenge ? Math.max(0, st.challenge.deliveries.length - 1) : 0, refreshed: false }];
        break;
      }
      case 'window': {
        if (!challenge) {
          problems.push('Deliveries are part of the contract challenge. Switch the goal to Contract challenge.');
          break;
        }
        const ch = st.challenge;
        const early = m.windowKind === 'early';
        const next = ch.contracts[ch.deliveries.length];
        if (!next) problems.push('Every contract is already settled.');
        else if (early && !next.heavy) problems.push('The early window is only for the heavy contract, once the first two are settled.');
        else if (early && st.day < 9) problems.push('The heavy contract can be delivered early from day 9.');
        ch.window = { early };
        break;
      }
      case 'chain': {
        // The warden's inmate has eaten and must eat again; the game asks
        // which meal when there's more than one.
        usedToday();
        st.used.devour = 1;
        const here = st.cells[st.position];
        if (!here || here.sealed || !here.inmate) {
          problems.push("A chain needs its eater in the warden's cell: put the warden there and set the inmate as it is now.");
          break;
        }
        st.chaining = { eater: here.inmate.id, at: 0, bites: [] };
        if (T.chainOptions(st).length < 2) problems.push("Your game asks for a meal only when the chaining inmate has 2 or more to choose from. Check the board: it can't find 2 meals for it.");
        break;
      }
      case 'office': {
        // Only when the game shows the Instigate and Bestow buttons. Standing
        // in the office isn't enough: the run starts there without them, and
        // they're gone once one is taken.
        usedToday();
        if (st.position !== T.OFFICE) problems.push('Instigate and Bestow come with the warden in the office: put the warden in cell 01.');
        st.phase = 'office';
        break;
      }
      default:
        usedToday();
    }
    return { st, problems };
  }

  // A model for an engine state: a saved simulator run, or the state after
  // "Do it here". `prev` keeps what the player knew about event kinds.
  function modelFrom(st, prev) {
    const m = blankModel();
    m.mode = st.mode === 'challenge' ? 'challenge' : 'drill';
    m.rewards = !!st.params.rewards;
    m.day = st.day;
    m.maxDays = st.mode === 'challenge' ? (prev ? prev.maxDays : T.DEFAULT_PARAMS.drillDays) : st.maxDays;
    m.warden = st.position;
    m.chainArmed = !!st.chain;
    m.objective = st.objective ? st.objective.id : 'other';
    m.walkTiles = st.objective ? st.objective.progress : 0;
    m.milestone = !!st.milestone;
    m.tools = st.tools.slice();
    m.vault = st.vault.map((v) => v.beast);
    m.cells = st.cells.map((c) => {
      if (c.n === T.OFFICE) return officeCell();
      const before = prev ? prev.cells[c.n] : null;
      // The simulator only shows that a door hides an event, not which kind.
      let event = null;
      if (c.event && c.seen !== false) event = c.eventKnown === false || !before || !before.event ? 'unknown' : before.event;
      if (c.sealed) {
        if (c.nest) return { kind: 'nest', due: c.nest.due };
        if (c.scratch && c.hidden && c.known) return { kind: 'scratch', tier: Math.min(TOP_TIER, c.hidden.tier), event };
        if (c.hidden && c.known === 1) return { kind: 'revealed', tier: Math.min(TOP_TIER, c.hidden.tier), event };
        if (c.hidden && c.known >= 2) return { kind: 'scouted', beast: c.hidden.beast, tier: Math.min(TOP_TIER, c.hidden.tier), event };
        return { kind: 'sealed', event };
      }
      if (!c.inmate) return { kind: 'empty' };
      const link = T.linkOf(st, c.inmate.id);
      const preyCell = link && link.lion === c.inmate.id ? T.cellOf(st, link.prey) : null;
      return { kind: 'inmate', beast: c.inmate.beast, tier: Math.min(TOP_TIER, c.inmate.tier), ivory: !!c.ivory, prey: preyCell ? { cell: preyCell.n, rounds: link.rounds } : null };
    });
    const ch = st.challenge;
    if (st.pending.length) {
      m.step = 'choice';
      m.choice = { kind: st.pending[0].kind, options: st.pending[0].options.slice() };
    } else if (ch && ch.window) {
      m.step = 'window';
      m.windowKind = ch.window.early ? 'early' : 'due';
    } else if (st.phase === 'event' && st.event) {
      m.step = 'event';
      m.eventKind = st.event.kind;
    } else if (st.chaining) m.step = 'chain';
    // The simulator offers Instigate or Bestow on walking into the office, but
    // the analyzer waits for the player (or a screenshot) to say the game does.
    else m.step = st.phase === 'patrol' ? 'patrol' : 'manage';
    m.dest = st.phase === 'patrol' ? st.destinations.slice() : [];
    m.devourUsed = st.used.devour > 0;
    m.swapUsed = st.used.swap > 0;
    if (ch) {
      m.ch.vouchers = ch.vouchers;
      m.ch.contracts = ch.contracts.map((c) => c.id);
      const bounty = ch.contracts.find((c) => c.bounty);
      if (bounty) m.ch.bounty = bounty.bounty;
      m.ch.status = [0, 1].map((slot) => (!ch.deliveries[slot] ? 'pending' : ch.deliveries[slot].success ? 'delivered' : 'skipped'));
      m.ch.points = [0, 1].map((slot) => (ch.deliveries[slot] && ch.deliveries[slot].success ? ch.deliveries[slot].points : 0));
    }
    m.ended = st.phase === 'ended';
    return m;
  }

  // ---------- Page state ----------

  const saved = store.get(KEY);
  let model = normalize(saved && saved.model);
  let selected = saved && Number.isInteger(saved.selected) ? clamp(saved.selected, 0, T.CELL_COUNT - 1) : 1;
  let flags = new Set(); // cells the simulator's dice decided, for the player to check
  let applied = null; // what "Do it here" just played
  // How the board got here since the last one asked about: a move played
  // here, or a screenshot. `filled` lists what the dice or the reader decided
  // (cells as c<n>, plus dest, event and choice), `touched` what the player
  // has since set or confirmed against their game. It's saved with the board,
  // so a reload can't pass the dice's guesses off as the player's.
  let via = saved && saved.via && Array.isArray(saved.via.filled) ? Object.assign({}, saved.via, { touched: new Set(saved.via.touched || []) }) : null;
  // Cells still to check survive a reload too.
  if (via) flags = new Set(via.filled.filter((k) => /^c\d+$/.test(k) && !via.touched.has(k)).map((k) => Number(k.slice(1))));
  const undo = [];
  const modelKey = () => JSON.stringify(model);

  function save() {
    store.set(KEY, { model, selected, via: via && Object.assign({}, via, { touched: [...via.touched] }) });
  }

  function changed() {
    save();
    render();
  }

  function notice(text) {
    $('az-notice').textContent = text;
  }

  // ---------- Analysis ----------

  const solver = { worker: null, failed: false, id: 0, st: null, key: '', instant: null, result: null };

  function ask(quiet) {
    const { st, problems } = buildState(model);
    showProblems(problems);
    if (problems.length) return;
    if (SHARE) {
      // The collector rejects what it doesn't know yet: the newer event
      // kinds, the office as a door, a chain's pick and doors that show a
      // rarity without a scratch. Until it learns
      // them, such a board isn't shared, and the next board starts a new
      // run, so no shared step spans it.
      const kinds = [...model.cells.map((c) => c.event).filter(Boolean), ...(model.step === 'event' ? [model.eventKind] : [])];
      const known = kinds.every((k) => COLLECTOR_EVENTS.includes(k)) && !model.dest.includes(T.OFFICE) && COLLECTOR_STEPS.includes(model.step) && !model.cells.some((c) => c.kind === 'revealed');
      if (known) SHARE.record(model, via && Object.assign({}, via, { touched: [...via.touched] }));
      else SHARE.reset('manual');
    }
    via = null;
    flags = new Set();
    applied = null;
    solver.id += 1;
    solver.st = st;
    solver.key = modelKey();
    solver.result = null;
    try {
      solver.instant = S.instant(st);
    } catch (e) {
      solver.instant = null;
    }
    const options = S.candidates(st).length;
    const rollouts = clamp(Math.round(PLAYOUT_BUDGET / Math.max(1, options)), 400, 1600);
    startCheck(solver.id, st, rollouts);
    render();
    if (quiet !== true) $('az-results').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function startCheck(id, st, rollouts) {
    const state = JSON.parse(JSON.stringify(st));
    if (!solver.worker && !solver.failed) {
      try {
        solver.worker = new Worker(`js/solver-worker.js${SCRIPT_QUERY}`);
        solver.worker.onmessage = (e) => {
          if (e.data.id !== solver.id) return;
          solver.result = e.data.result;
          renderResults();
          renderBoard();
          renderCourt();
        };
        solver.worker.onerror = () => {
          // Fall back to this page's thread, and redo the check.
          solver.failed = true;
          solver.worker = null;
          if (solver.st) startCheck(solver.id, solver.st, Math.min(rollouts, 300));
        };
      } catch (e) {
        solver.failed = true;
        solver.worker = null;
      }
    }
    if (solver.worker) {
      solver.worker.postMessage({ id, state, rollouts });
      return;
    }
    const job = S.solve(state, { rollouts: Math.min(rollouts, 300), seed: (id * 7919 + 1) >>> 0 });
    const tick = () => {
      if (id !== solver.id) return;
      solver.result = job.step(12);
      renderResults();
      renderBoard();
      renderCourt();
      if (!solver.result.done) setTimeout(tick, 16);
    };
    setTimeout(tick, 0);
  }

  const fresh = () => !!solver.st && solver.key === modelKey();

  // The strategy's instant pick, unless the live check finds a clearly better
  // move (by more than its paired margin), so the advice doesn't flicker.
  function recommendation() {
    if (!solver.st) return null;
    const pick = solver.instant;
    const r = solver.result;
    const ranked = r ? r.options : [];
    const live = r && ranked.length > 1 && (r.done || r.rounds >= LIVE_MIN) ? ranked[0] : null;
    const mine = pick && ranked.find((o) => S.sameAction(o.action, pick.action));
    if (!live) return pick ? Object.assign({ live: false }, pick, { option: mine || null }) : ranked.length === 1 ? { action: ranked[0].action, label: ranked[0].label, why: 'It’s the only move here.', live: true, option: ranked[0] } : null;
    if (mine && (mine === live || live.mean - mine.mean <= 1.96 * mine.gapSe)) {
      const why = mine === live ? pick.why : `${pick.why} The live check rates it about equal to the best.`;
      return Object.assign({ live: true, rounds: r.rounds }, pick, { label: mine.label, why, option: mine });
    }
    return { action: live.action, label: live.label, why: `The playouts found a better move than the strategy’s pick${pick ? ` (${pick.label})` : ''}.`, live: true, rounds: r.rounds, option: live };
  }

  function fmtOption(goal, o, st) {
    if (goal === 'contract') return `${Math.round(100 * o.pass)}% pass · ${o.points.toFixed(0)} pts`;
    return `${o.mean.toFixed(2)}${o.n > 1 ? ` ±${(1.96 * o.se).toFixed(2)}` : ''}`;
  }

  function expectText(goal, o, st) {
    if (!o) return '';
    if (goal === 'contract') return `Expected: ${Math.round(100 * o.pass)}% chance to pass, ${o.points.toFixed(0)} contract points.`;
    return `Expected: ${o.mean.toFixed(2)} Rainbows in the vault by the end of day ${st.maxDays}.`;
  }

  // ---------- Playing a move here ----------

  // Plays a move with the simulator's dice. The cells it changes are marked
  // for the player to set to what their game shows. With toNextDay, the
  // strategy then plays the rest of the day the same way, as if the player
  // followed the advice, and stops at the next day's patrol: the player then
  // pastes a screenshot of their new day, or fixes the marked cells.
  function doMove(action, toNextDay) {
    const { st, problems } = buildState(model);
    if (problems.length) {
      showProblems(problems);
      return;
    }
    for (const c of st.cells) {
      if (c.sealed && c.event && c.eventKnown === false) c.event = T.EVENT_POOL[Math.floor(Math.random() * T.EVENT_POOL.length)];
      // A door not marked with an event may hide one nobody has seen.
      if (c.sealed && c.seen === false && !c.nest && Math.random() * 100 < st.params.eventChance) c.event = T.EVENT_POOL[Math.floor(Math.random() * T.EVENT_POOL.length)];
    }
    const before = JSON.parse(JSON.stringify(model));
    const label = labelFor(action);
    let result;
    try {
      result = S.apply(st, action);
    } catch (e) {
      result = { ok: false, reason: 'That move hit an error and was not played.' };
    }
    if (!result || !result.ok) {
      showProblems([result ? result.reason : 'That move could not be played.']);
      return;
    }
    let more = 0;
    const startDay = st.day;
    if (toNextDay) {
      const nextPatrol = () => st.day > startDay && st.phase === 'patrol' && !st.pending.length && !(st.challenge && st.challenge.window);
      for (let i = 0; i < 80 && st.phase !== 'ended' && !nextPatrol(); i++) {
        let next = null;
        try {
          next = S.decide(st, S.paramsFor(st), Math.random);
          if (next && !(S.apply(st, next) || {}).ok) next = null;
        } catch (e) {
          next = null;
        }
        if (!next) break;
        more += 1;
      }
    }
    undo.push({ model: before, selected });
    if (undo.length > 30) undo.shift();
    model = modelFrom(st, before);
    flags = new Set(model.cells.map((c, n) => (cellSig(c) !== cellSig(before.cells[n]) ? n : -1)).filter((n) => n >= 0));
    applied = { label, changed: [...flags], newDay: model.day !== before.day, doors: model.step === 'patrol' ? model.dest.slice() : [], ended: !!model.ended, step: model.step, office: st.phase === 'office', more, toNextDay: !!toNextDay };
    const filled = [...flags].map((n) => `c${n}`);
    if (applied.newDay && model.step === 'patrol') filled.push('dest');
    if (model.step === 'event') filled.push('event');
    if (model.step === 'choice' && model.choice.kind !== 'gift') filled.push('choice');
    via = { action, label: toNextDay ? `${label}, then the rest of day ${startDay} by the strategy`.slice(0, 120) : label, filled, touched: new Set() };
    solver.st = null;
    solver.id += 1;
    showProblems([]);
    changed();
    $('az-applied').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (toNextDay && !model.ended) toast(`Day ${model.day}. Paste a screenshot of your new day (Ctrl+V) to load it, or fix the cells marked Check.`, 'ok', [{ id: 'pick', label: 'Choose a screenshot', primary: true }]);
  }

  function labelFor(action) {
    const r = solver.result;
    const option = r && r.options.find((o) => S.sameAction(o.action, action));
    if (option) return option.label;
    const match = solver.st && S.candidates(solver.st).find((c) => S.sameAction(c.action, action));
    return match ? match.label : action.type;
  }

  function undoMove() {
    const last = undo.pop();
    if (!last) return;
    model = last.model;
    selected = last.selected;
    flags = new Set();
    applied = null;
    via = null;
    changed();
  }

  // The player set or confirmed part of the board the dice or the reader
  // filled in, so it's known to match their game.
  function touch(key) {
    if (via) via.touched.add(key);
  }

  // ---------- Rendering ----------

  const cellEls = [];

  function buildBoard() {
    const board = $('az-board');
    for (let n = 0; n < T.CELL_COUNT; n++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cell';
      b.style.gridRow = B.RING[n][0];
      b.style.gridColumn = B.RING[n][1];
      b.innerHTML = B.CELL_HTML;
      b.children[2].textContent = L(n);
      b.addEventListener('click', () => {
        const open = !$('az-pick').hidden && $('az-pick').dataset.cell === String(n);
        select(n);
        if (open) closePick(true);
        else openPick(n);
      });
      board.appendChild(b);
      cellEls[n] = { btn: b, body: b.children[0], hint: b.children[3], badges: b.children[4], tag: b.children[5], warden: b.children[6] };
    }
    // What's in a cell, picked from icons that open right on the cell.
    const pick = document.createElement('div');
    pick.id = 'az-pick';
    pick.className = 'az-pick';
    pick.hidden = true;
    pick.setAttribute('role', 'dialog');
    pick.setAttribute('aria-label', "What's in this cell");
    pick.innerHTML = pickHTML();
    board.appendChild(pick);
  }

  // Every inmate by rarity, then the doors and marks a cell can have.
  function pickHTML() {
    const tiers = T.TIERS.slice(0, TOP_TIER + 1);
    const btn = (value, label, art, cls) => `<button type="button" class="az-ico${cls ? ` ${cls}` : ''}" data-pick="${value}" title="${esc(label)}" aria-label="${esc(label)}">${art}</button>`;
    const row = (label, cls, items) => `<div class="az-pick-row"><span class="az-pick-label${cls ? ` ${cls}` : ''}">${esc(label)}</span>${items.join('')}</div>`;
    return [
      ...tiers.map((name, t) => row(name, `t${t}`, T.BEASTS.map((b) => btn(`inmate:${b}:${t}`, `${name} ${T.beastName(b)}`, B.PORTRAITS[b], `t${t}`)))),
      row('Locked', '', [
        btn('sealed', 'Locked door', B.MARKS.sealed),
        btn('sealed:unknown', 'Locked door with an event (kind unknown)', B.MARKS.event),
        btn('sealed:chain', 'Locked door with a Chain reaction', B.MARKS.chain),
        btn('sealed:execution', 'Locked door with an Execution', B.MARKS.execution),
        btn('sealed:trickster', 'Locked door with Behind Closed Doors', B.MARKS.trickster),
        btn('sealed:appetite', 'Locked door with Ravenous Appetite', B.MARKS.appetite),
        btn('sealed:convict', 'Locked door with High-Risk Convict', B.MARKS.convict),
        btn('sealed:crow', 'Locked door with Crow Whispers', B.MARKS.crow),
        btn('sealed:freedom', 'Locked door with Taste of Freedom', B.MARKS.freedom),
        btn('sealed:usurp1', 'Locked door with Usurpation I', B.MARKS.usurp1),
        btn('sealed:usurp2', 'Locked door with Usurpation II', B.MARKS.usurp2),
        btn('scouted', "Scouted door (Warden's Scales): set its beast and rarity in the panel below", B.MARKS.scouted),
      ]),
      row('Other', '', [btn('nest', 'Rat nest', B.MARKS.nest), btn('empty', 'Empty cell', B.MARKS.empty), btn('ivory', 'Tusk mark: toggles on the inmate here', B.MARKS.ivory)]),
      row('Scratched', '', tiers.map((name, t) => btn(`scratch:${t}`, `Scratched door showing ${name}`, B.MARKS.scratch, `t${t}`))),
      row('Rarity shown', '', tiers.map((name, t) => btn(`revealed:${t}`, `Locked door showing a ${name} inside, beast unknown (a "?" portrait)`, B.MARKS.revealed, `t${t}`))),
    ].join('');
  }

  // The picker's choice for what a cell holds.
  function pickValue(c) {
    const tier = clamp(toInt(c.tier, 0), 0, TOP_TIER);
    if (c.kind === 'inmate') return `inmate:${c.beast}:${tier}`;
    if (c.kind === 'scratch') return `scratch:${tier}`;
    if (c.kind === 'revealed') return `revealed:${tier}`;
    if (c.kind === 'scouted') return 'scouted';
    if (c.kind === 'sealed') return c.event ? `sealed:${c.event}` : 'sealed';
    return c.kind;
  }

  function setHTML(el, html) {
    if (el.__html !== html) {
      el.innerHTML = html;
      el.__html = html;
    }
  }

  function renderBoard() {
    const { st } = buildState(model);
    const rec = fresh() ? recommendation() : null;
    const a = rec ? rec.action : null;
    const best = new Set();
    if (a && a.type === 'patrol') best.add(a.cell);
    if (a && a.type === 'devour') best.add(a.to);
    if (a && a.type === 'swap') best.add(st.position);
    if (a && a.type === 'deliver') a.cells.forEach((n) => best.add(n));
    const doors = model.step === 'patrol' ? new Set(model.dest) : new Set();
    $('az-board').classList.toggle('is-patrolling', doors.size > 0);
    for (const cell of st.cells) {
      const el = cellEls[cell.n];
      const p = B.cellParts(cell, st);
      const mc = model.cells[cell.n];
      // Name the event's kind when the player knows it.
      let badges = p.badges;
      if (mc.event === 'chain') badges = badges.replace('>Event<', '>Chain<');
      else if (mc.event === 'execution') badges = badges.replace('>Event<', '>Execution<');
      else if (mc.event === 'trickster') badges = badges.replace('>Event<', '>Closed Doors<');
      else if (mc.event === 'appetite') badges = badges.replace('>Event<', '>Appetite<');
      else if (mc.event === 'convict') badges = badges.replace('>Event<', '>Convict<');
      else if (mc.event === 'crow') badges = badges.replace('>Event<', '>Crow<');
      else if (mc.event === 'freedom') badges = badges.replace('>Event<', '>Freedom<');
      else if (mc.event === 'usurp1') badges = badges.replace('>Event<', '>Usurp. I<');
      else if (mc.event === 'usurp2') badges = badges.replace('>Event<', '>Usurp. II<');
      if (cell.n === selected) p.cls.push('is-selected');
      if (doors.has(cell.n)) p.cls.push('is-dest');
      if (flags.has(cell.n)) p.cls.push('is-check');
      if (best.has(cell.n)) p.cls.push('is-hint');
      el.btn.className = p.cls.join(' ');
      setHTML(el.body, p.body);
      setHTML(el.hint, p.hint);
      setHTML(el.badges, badges);
      setHTML(el.warden, p.warden ? B.LANTERN : '');
      const tag = best.has(cell.n) ? (a.type === 'deliver' ? 'Send' : a.type === 'swap' ? 'Swap' : a.type === 'devour' ? 'Eat' : 'Go') : flags.has(cell.n) ? 'Check' : doors.has(cell.n) ? 'Door' : '';
      el.tag.textContent = tag;
      el.btn.setAttribute('aria-label', `${p.label}${doors.has(cell.n) ? ". One of today's doors" : ''}${tag === 'Check' ? '. Changed by the simulator: check it against your game' : ''}`);
      el.btn.setAttribute('aria-pressed', String(cell.n === selected));
    }
  }

  function renderCourt() {
    const rec = fresh() ? recommendation() : null;
    let title;
    let detail;
    if (rec) {
      title = rec.label;
      detail = rec.option ? expectText(solver.result.goal, rec.option, solver.st) : 'Checking with playouts…';
    } else {
      const day = model.mode === 'challenge' ? `Day ${model.day} of ${T.CHALLENGE_DAYS}` : `Day ${model.day} of ${model.maxDays}`;
      title = 'Your board';
      detail = `${day} · ${STEP_NAMES[model.step]} · warden ${model.warden === T.OFFICE ? 'in the office' : `at cell ${L(model.warden)}`}`;
    }
    setHTML($('az-court'), `<div class="decision${rec ? ' az-court-rec' : ''}"><div class="decision-text"><p class="decision-title">${rec ? '<span class="az-court-eyebrow">Do this</span>' : ''}${esc(title)}</p><p class="decision-detail">${esc(detail)}</p></div></div>`);
  }

  function pressGroup(id, value) {
    for (const b of $(id).querySelectorAll('button[data-v]')) b.setAttribute('aria-pressed', String(b.dataset.v === value));
  }

  function renderEditor() {
    const n = selected;
    const c = model.cells[n];
    const office = n === T.OFFICE;
    $('az-cell-title').textContent = office ? 'Cell 01 · the office' : `Cell ${L(n)}`;
    $('az-warden').setAttribute('aria-pressed', String(model.warden === n));
    $('az-door').hidden = n === model.warden || model.step !== 'patrol';
    $('az-door').setAttribute('aria-pressed', String(model.dest.includes(n)));
    $('az-match').hidden = office || !flags.has(n);
    $('az-office-note').hidden = !office;
    $('az-cell-fields').hidden = office;
    if (office) return;
    pressGroup('az-kind', c.kind);
    const inmate = c.kind === 'inmate';
    const scouted = c.kind === 'scouted';
    const tiered = inmate || scouted || c.kind === 'scratch' || c.kind === 'revealed';
    $('az-beast-field').hidden = !(inmate || scouted);
    $('az-tier-field').hidden = !tiered;
    $('az-tier-legend').textContent = inmate ? 'Rarity' : scouted ? 'Rarity the scales showed' : 'Rarity you can see on the door';
    const tier = tiered ? clamp(toInt(c.tier, 0), 0, TOP_TIER) : 0;
    for (const b of $('az-beasts').querySelectorAll('button')) {
      b.className = `az-beast t${tier}`;
      b.setAttribute('aria-pressed', String((inmate || scouted) && b.dataset.v === c.beast));
    }
    for (const b of $('az-tiers').querySelectorAll('button')) b.setAttribute('aria-pressed', String(tiered && Number(b.dataset.v) === tier));
    $('az-inmate-extra').hidden = !inmate;
    if (inmate) {
      $('az-ivory').checked = !!c.ivory;
      const { st } = buildState(model);
      const lion = c.beast === 'lion';
      $('az-prey-field').hidden = !lion;
      if (lion) {
        const meals = st.cells.filter((o) => o.n !== n && !o.sealed && o.inmate && T.canEat(st, st.cells[n].inmate, o.inmate));
        const current = c.prey ? c.prey.cell : null;
        $('az-prey').innerHTML = `<option value="">No prey mark</option>${meals.map((o) => `<option value="${o.n}"${o.n === current ? ' selected' : ''}>Cell ${L(o.n)}: ${esc(T.describe(o.inmate))}</option>`).join('')}`;
        $('az-prey-rounds').value = String(c.prey ? c.prey.rounds : T.DEFAULT_PARAMS.preyRounds);
        $('az-prey-rounds').closest('.field').hidden = !c.prey;
      }
      const hunter = model.cells.findIndex((o) => o.kind === 'inmate' && o.beast === 'lion' && o.prey && o.prey.cell === n);
      $('az-prey-of').hidden = hunter < 0;
      if (hunter >= 0) $('az-prey-of').textContent = `Marked as prey by the Lion in cell ${L(hunter)}: both rise a tier each morning for ${T.plural(model.cells[hunter].prey.rounds, 'more morning')}.`;
    }
    $('az-event-field').hidden = !(c.kind === 'sealed' || c.kind === 'scratch' || c.kind === 'revealed' || scouted);
    pressGroup('az-event', c.event || 'none');
    $('az-nest-field').hidden = c.kind !== 'nest';
    if (c.kind === 'nest') $('az-nest-due').value = String(toInt(c.due, model.day + 2));
  }

  function renderSettings() {
    const challenge = model.mode === 'challenge';
    pressGroup('az-mode', model.mode);
    const maxDays = challenge ? T.CHALLENGE_DAYS : clamp(toInt(model.maxDays, 20), 5, 60);
    // The game counts down: "N day(s) until Riot" on day maxDays - N.
    const riot = $('az-riot');
    riot.max = String(maxDays - 1);
    if (document.activeElement !== riot) riot.value = String(maxDays - clamp(toInt(model.day, 1), 1, maxDays));
    $('az-dayof').textContent = `Day ${model.day} of ${maxDays}`;
    $('az-days').value = String(maxDays);
    $('az-days-wrap').hidden = challenge;
    $('az-days-fixed').hidden = !challenge;
    $('az-step-window').hidden = !challenge;
    pressGroup('az-step', model.step);
    for (const box of document.querySelectorAll('.az-stepbox')) {
      const steps = box.dataset.step.split(' ');
      box.hidden = !steps.includes(model.step);
    }
    // Today's doors: the cells within reach of the warden, plus any ticked.
    const ahead = [];
    for (let i = 1; i < T.CELL_COUNT && ahead.length < T.DEFAULT_PARAMS.patrolRange; i++) {
      ahead.push((model.warden + i) % T.CELL_COUNT);
    }
    const doors = [...new Set([...ahead, ...model.dest])];
    setHTML($('az-doors'), doors
      .map((n) => `<button type="button" class="az-doorcard" data-door="${n}" aria-pressed="${model.dest.includes(n)}"><span class="az-doorcard-arch" aria-hidden="true"></span><span class="az-doorcard-go">Go to Cell ${n + 1}</span><small>${esc(cellShort(model.cells[n]))}</small></button>`)
      .join(''));
    $('az-devoured').checked = !!model.devourUsed;
    $('az-swapped').checked = !!model.swapUsed;
    pressGroup('az-event-kind', model.eventKind);
    pressGroup('az-choice-kind', model.choice.kind);
    renderOffer();
    pressGroup('az-window-kind', model.windowKind);
    const next = challenge ? nextContract() : null;
    $('az-window-note').textContent = !next ? '' : model.windowKind === 'early' ? 'From day 9, once the first two contracts are settled. Delivering it ends the run.' : `"${next.name}": ${next.needs.join(', ').toLowerCase()}.`;
    $('az-armed').checked = !!model.chainArmed;
    for (const b of $('az-tools').querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(model.tools.includes(b.dataset.tool)));
    $('az-rewards-wrap').hidden = challenge;
    $('az-rewards').checked = challenge || !!model.rewards;
    const goal = model.objective;
    $('az-objective').value = goal;
    $('az-objective-text').textContent = T.OBJECTIVES[goal].text;
    $('az-walk-wrap').hidden = goal !== 'walk';
    if (document.activeElement !== $('az-walk')) $('az-walk').value = String(model.walkTiles);
    $('az-milestone').checked = !!model.milestone || (goal === 'walk' && model.walkTiles >= T.OBJECTIVES.walk.need);
    // Ten slots like the game's, more if the vault holds more.
    const slots = Math.max(10, model.vault.length + (model.vault.length % 2));
    setHTML($('az-vault'), Array.from({ length: slots }, (_, i) => {
      const beast = model.vault[i];
      return beast
        ? `<button type="button" class="az-hex is-filled t5" data-unvault="${i}" title="Chromatic ${esc(T.beastName(beast))}: click to remove">${B.PORTRAITS[beast]}</button>`
        : '<span class="az-hex" aria-hidden="true"></span>';
    }).join(''));
    $('az-challenge').hidden = !challenge;
    if (challenge) renderContracts();
  }

  function cellShort(c) {
    if (!c) return '';
    if (c.kind === 'inmate') return `${T.tierName(c.tier).slice(0, 3)} ${T.beastName(c.beast)}`;
    if (c.kind === 'scratch') return `${T.tierName(c.tier).slice(0, 3)} door`;
    if (c.kind === 'revealed') return `${T.tierName(c.tier).slice(0, 3)} inside`;
    if (c.kind === 'scouted') return `Scouted ${T.tierName(c.tier).slice(0, 3)} ${T.beastName(c.beast)}`;
    if (c.kind === 'nest') return 'Nest';
    if (c.kind === 'empty') return 'Empty';
    if (c.kind === 'office') return 'Office';
    return c.event ? 'Event' : 'Sealed';
  }

  function renderOffer() {
    const kind = model.choice.kind;
    if (kind === 'gift') {
      $('az-offer').innerHTML = `<p class="field-note">The Warden's Treasure always offers all four gifts: ${T.GIFT_IDS.map((id) => esc(T.toolName(id))).join(', ')}.</p>`;
      return;
    }
    const free = T.TOOL_IDS.filter((id) => !model.tools.includes(id));
    const picks = [0, 1, 2].map((i) => model.choice.options[i] || '');
    $('az-offer').innerHTML = picks
      .map((value, i) => `<label class="field"><span class="field-label">Option ${i + 1}</span><select data-offer="${i}"><option value="">None</option>${free.map((id) => `<option value="${id}"${id === value ? ' selected' : ''}>${esc(T.toolName(id))}</option>`).join('')}</select></label>`)
      .join('');
  }

  function nextContract() {
    const slot = model.ch.status[0] === 'pending' ? 0 : model.ch.status[1] === 'pending' ? 1 : 2;
    return makeContract(slot, model.ch.contracts[slot], model.ch.bounty);
  }

  function renderContracts() {
    $('az-vouchers').value = String(model.ch.vouchers);
    $('az-contracts').innerHTML = [0, 1, 2]
      .map((slot) => {
        const def = T.CONTRACT_SLOTS[slot];
        const id = model.ch.contracts[slot];
        const variants = def.variants.map((v) => `<option value="${v.id}"${v.id === id ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
        const contract = makeContract(slot, id, model.ch.bounty);
        let extra = '';
        if (slot < 2) {
          const status = model.ch.status[slot];
          const locked = slot === 1 && model.ch.status[0] === 'pending';
          extra = `<div class="az-seg az-status" data-status="${slot}">${['pending', 'delivered', 'skipped']
            .map((s) => `<button type="button" data-v="${s}" aria-pressed="${status === s}"${locked && s !== 'pending' ? ' disabled' : ''}>${s === 'pending' ? 'Still to come' : s === 'delivered' ? 'Delivered' : 'Skipped'}</button>`)
            .join('')}</div>${status === 'delivered' ? `<label class="field az-points"><span class="field-label">Points it scored</span><input type="number" min="0" max="999" step="1" data-points="${slot}" value="${toInt(model.ch.points[slot], 0)}"></label>` : ''}`;
        } else if (id === 'bounty') {
          extra = `<label class="field"><span class="field-label">Bounty beast</span><select id="az-bounty">${T.BEASTS.map((b) => `<option value="${b}"${b === model.ch.bounty ? ' selected' : ''}>${esc(T.beastName(b))}</option>`).join('')}</select></label>`;
        }
        return `<div class="az-contract"><label class="field"><span class="field-label">Due day ${def.deadline}${def.heavy ? ' · heavy' : ''}</span><select data-contract="${slot}">${variants}</select></label><p class="az-needs">${esc(contract.needs.join(' · '))}</p>${extra}</div>`;
      })
      .join('');
  }

  // Updates a list in place, keeping rows by key, so a button under the
  // pointer survives the refreshes of a live check.
  function syncRows(list, items, keyOf, make, fill) {
    const old = new Map();
    for (const li of list.children) old.set(li.dataset.key, li);
    const keep = new Set();
    items.forEach((item, i) => {
      const key = keyOf(item);
      let li = old.get(key);
      if (!li) {
        li = make(item);
        li.dataset.key = key;
      }
      fill(li, item);
      keep.add(key);
      if (list.children[i] !== li) list.insertBefore(li, list.children[i] || null);
    });
    for (const [key, li] of old) if (!keep.has(key)) li.remove();
  }

  const actionKey = (a) => [a.type, a.cell, a.to, a.id, a.accept, a.choice, (a.cells || []).slice().sort((x, y) => x - y).join('.'), (a.vaultIds || []).slice().sort((x, y) => x - y).join('.'), a.escort].join('|');

  function renderResults() {
    const box = $('az-results');
    box.hidden = !solver.st;
    if (!solver.st) return;
    const st = solver.st;
    const stale = !fresh();
    box.classList.toggle('is-stale', stale);
    const rec = recommendation();
    const r = solver.result;
    const goal = r ? r.goal : st.mode === 'challenge' ? 'contract' : 'rainbows';
    $('az-res-move').textContent = rec ? rec.label : 'Nothing to decide here.';
    $('az-do').hidden = !rec || stale;
    $('az-do').textContent = rec && rec.action.type === 'end' ? 'End the day here' : 'Do it here';
    $('az-next').hidden = !rec || stale;
    $('az-undo').hidden = !undo.length;
    let body = '';
    if (stale) body += '<p class="trainer-verdict">The board changed since this check. Ask again for advice on the new board.</p>';
    if (rec) {
      body += `<p class="trainer-source">${esc(rec.live ? `Checked by ${rec.rounds.toLocaleString()} playouts per option` : 'Instant pick from training · checking…')}</p>`;
      if (rec.why) body += `<p class="trainer-why">${esc(rec.why)}</p>`;
      if (rec.option) body += `<p class="trainer-why">${esc(expectText(goal, rec.option, st))}</p>`;
      if (rec.action.type === 'devour') {
        const odds = S.chainOdds(st, st.position, rec.action.to);
        body += `<p class="trainer-lesson">After this first bite the chain runs by itself: ${odds.bites.toFixed(1)} bites on average, ${(100 * odds.rainbow).toFixed(0)}% to reach Rainbow.</p>`;
      }
      body += `<p class="trainer-lesson">${esc(afterText(rec.action))}</p>`;
    }
    setHTML($('az-res-body'), body);
    const options = r ? r.options : [];
    const status = $('az-res-status');
    if (!r) status.textContent = 'Live check: starting…';
    else if (options.length <= 1) status.textContent = options.length ? 'Only one move here.' : 'Nothing to decide right now.';
    else status.textContent = r.done ? `Live check: ${r.rounds.toLocaleString()} playouts per option` : `Live check: ${r.rounds.toLocaleString()} playouts per option so far…`;
    const max = Math.max(0.01, ...options.map((o) => o.mean));
    const shown = options.length > 1 ? options : [];
    syncRows(
      $('az-res-list'),
      shown,
      (o) => actionKey(o.action),
      () => {
        const li = document.createElement('li');
        li.className = 'solver-row';
        li.innerHTML = '<span class="solver-label"><span class="solver-text"></span><span class="solver-tag" hidden>strategy</span></span><span class="solver-value"></span><span class="solver-meter"><span></span></span><span class="solver-sub" hidden></span>';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn';
        btn.textContent = 'Do this here';
        btn.addEventListener('click', () => li.option && doMove(li.option.action));
        li.appendChild(btn);
        li.btn = btn;
        return li;
      },
      (li, o) => {
        li.option = o;
        const chosen = rec ? S.sameAction(o.action, rec.action) : o === options[0];
        li.classList.toggle('is-best', chosen);
        li.querySelector('.solver-text').textContent = o.label;
        li.querySelector('.solver-tag').hidden = !o.policy;
        const value = li.querySelector('.solver-value');
        value.textContent = fmtOption(goal, o, st);
        value.title = goal === 'contract' ? 'Chance to pass the challenge, and contract points on average' : 'Expected Rainbows in the vault by the end of the run, with a 95% margin';
        const width = goal === 'contract' ? 100 * o.pass : (100 * o.mean) / max;
        li.querySelector('.solver-meter span').style.width = `${Math.max(2, width).toFixed(1)}%`;
        const sub = li.querySelector('.solver-sub');
        let subText = '';
        if (o.action.type === 'devour') {
          const odds = S.chainOdds(st, st.position, o.action.to);
          subText = `chain: ${odds.bites.toFixed(1)} bites on average, ${(100 * odds.rainbow).toFixed(0)}% to Rainbow`;
        }
        sub.hidden = !subText;
        sub.textContent = subText;
        li.btn.hidden = chosen || stale;
      },
    );
    const top = options[0];
    const second = options[1];
    const close = top && second && top.mean - second.mean < 1.96 * second.gapSe;
    $('az-res-note').textContent = shown.length < 2
      ? ''
      : close
        ? 'The top moves are within the margin of error: either is fine.'
        : goal === 'contract'
          ? 'Each option is played out from your board with everything you can’t see re-rolled, and the trained strategy making every later choice. Ranked by the chance to pass the challenge, then by contract points.'
          : 'Each option is played out from your board with everything you can’t see re-rolled, and the trained strategy making every later choice. Scores are Rainbows in the vault by the end of the run.';
  }

  // What the player does after following the advice in their game.
  function afterText(action) {
    switch (action.type) {
      case 'patrol': return 'In your game, walk there. Then set the cell to what the door reveals (or press Do it here and fix it), and ask again.';
      case 'devour': return 'In your game, start the devour on that target. Then update the cells the chain changed, and ask again.';
      case 'swap': return 'In your game, swap the warden’s inmate. Then set the warden’s cell to what came in, and ask again.';
      case 'end': return 'In your game, end the day. Then mark the new day’s doors, and ask again.';
      case 'event': return 'Then update what changed, and ask again.';
      case 'office': return 'In your game, press it. Then paste a screenshot of what changed (or set it here under Make Your Decision), and ask again.';
      case 'choose': return 'Take it in your game, then ask again.';
      case 'deliver': return 'Load exactly these inmates in your game’s delivery window, with that escort.';
      default: return 'Then update the board, and ask again.';
    }
  }

  function renderApplied() {
    const box = $('az-applied');
    box.hidden = !applied;
    if (!applied) return;
    let html = `<p class="trainer-eyebrow">Played here with the simulator's dice</p><p class="az-applied-move">${esc(applied.label)}</p>`;
    if (applied.toNextDay && !applied.ended) html += `<p class="trainer-why">${applied.more ? `Then the strategy played the rest of the day (${applied.more} more ${applied.more === 1 ? 'move' : 'moves'}), as if you followed its advice. ` : ''}What really happened in your game will differ: paste a screenshot of your new day (Ctrl+V) to load it, or fix the cells marked Check.</p>`;
    if (applied.ended) html += '<p class="trainer-why">That ended the run. Load another board, or play a new run in the simulator.</p>';
    else {
      if (applied.changed.length) html += `<p class="trainer-why">${applied.changed.length === 1 ? 'Cell' : 'Cells'} ${applied.changed.map(L).join(', ')} changed, marked Check. Set ${applied.changed.length === 1 ? 'it' : 'them'} to what your game shows.</p>`;
      if (applied.newDay && applied.step === 'patrol') html += `<p class="trainer-why">It's now day ${model.day}. The simulator rolled today's doors (${applied.doors.map(L).join(', ') || 'none'}); tick the ones your game offers.</p>`;
      if (applied.step === 'window') html += '<p class="trainer-why">A delivery window opened: the contract is due.</p>';
      if (applied.step === 'choice') html += '<p class="trainer-why">A tool or gift is on offer: set the options your game shows.</p>';
      if (applied.step === 'event') html += "<p class=\"trainer-why\">The door held a special event: check its kind in your game.</p>";
      if (applied.office) html += '<p class="trainer-why">The warden is in the office. If your game shows the Instigate and Bestow buttons, pick “Instigate or Bestow” above, or paste a screenshot of them. Otherwise carry on with “Make Your Decision”.</p>';
      html += '<p class="trainer-lesson">Then press “What should I do?” for the next move.</p>';
    }
    const unchecked = via && !applied.ended ? via.filled.filter((k) => !via.touched.has(k)).length : 0;
    if (via && via.filled.length && !unchecked && !applied.ended) html += '<p class="trainer-why">Checked against your game.</p>';
    html += `<div class="az-res-actions">${unchecked ? '<button type="button" class="btn" data-match>Everything here matches my game</button>' : ''}<button type="button" class="btn" data-undo>Undo</button></div>`;
    setHTML(box, html);
  }

  // The line under the ask button: whether boards are shared, and the switch.
  function renderShare() {
    const box = $('az-share');
    if (!SHARE) {
      box.hidden = true;
      return;
    }
    const seen = SHARE.shared ? ' · <button type="button" class="link" data-share="see">See what’s been shared</button>' : '';
    setHTML(box, SHARE.sharing
      ? `Boards you ask about in a row are shared anonymously, to measure the live game's odds. <button type="button" class="link" data-share="off">Turn off</button>${seen}`
      : `Sharing is off, so nothing leaves this browser. <button type="button" class="link" data-share="on">Share boards to help measure live's odds</button>${seen}`);
  }

  function showProblems(problems) {
    const list = $('az-problems');
    list.hidden = !problems.length;
    list.innerHTML = problems.map((p) => `<li>${esc(p)}</li>`).join('');
  }

  function render() {
    renderBoard();
    renderCourt();
    renderEditor();
    renderSettings();
    renderResults();
    renderApplied();
    renderShare();
  }

  // ---------- Editing ----------

  function select(n) {
    selected = clamp(n, 0, T.CELL_COUNT - 1);
    save();
    renderBoard();
    renderEditor();
  }

  // Opens the picker by cell n, below it if it fits on the board, else above.
  function openPick(n) {
    const pick = $('az-pick');
    if (n === T.OFFICE) {
      closePick(false);
      return;
    }
    const c = model.cells[n];
    const current = pickValue(c);
    pick.dataset.cell = String(n);
    for (const b of pick.querySelectorAll('[data-pick]')) {
      const ivory = b.dataset.pick === 'ivory';
      b.setAttribute('aria-pressed', String(ivory ? c.kind === 'inmate' && !!c.ivory : b.dataset.pick === current));
      if (ivory) b.disabled = c.kind !== 'inmate';
    }
    pick.hidden = false;
    const cell = cellEls[n].btn;
    const board = $('az-board');
    const w = pick.offsetWidth;
    const h = pick.offsetHeight;
    const below = cell.offsetTop + cell.offsetHeight + 6;
    const above = cell.offsetTop - h - 6;
    pick.style.left = `${clamp(cell.offsetLeft + (cell.offsetWidth - w) / 2, 0, Math.max(0, board.clientWidth - w))}px`;
    pick.style.top = `${below + h <= board.clientHeight || above < 0 ? below : above}px`;
    (pick.querySelector('[aria-pressed="true"]:not([data-pick="ivory"])') || pick.querySelector('[data-pick]')).focus();
  }

  function closePick(refocus) {
    const pick = $('az-pick');
    if (pick.hidden) return;
    pick.hidden = true;
    const n = Number(pick.dataset.cell);
    if (refocus && cellEls[n]) cellEls[n].btn.focus();
  }

  function pickCell(n, value) {
    if (value === 'ivory') {
      if (model.cells[n].kind === 'inmate') setCell(n, { ivory: !model.cells[n].ivory });
      return;
    }
    if (value === 'scouted') {
      const c = model.cells[n];
      setCell(n, { kind: 'scouted', beast: c.beast || 'mammoth', tier: toInt(c.tier, 0) });
      return;
    }
    const [kind, a, b] = value.split(':');
    if (kind === 'inmate') setCell(n, { kind, beast: a, tier: Number(b) });
    else if (kind === 'scratch' || kind === 'revealed') setCell(n, { kind, tier: Number(a) });
    else if (kind === 'sealed') setCell(n, { kind, event: a || null });
    else setCell(n, { kind });
  }

  // Ends prey marks that no longer point at a meal the Lion can eat.
  function cleanPrey() {
    const { st } = buildState(Object.assign({}, model, { step: 'manage' }));
    model.cells.forEach((c, n) => {
      if (!c.prey) return;
      const lion = st.cells[n];
      const target = st.cells[c.prey.cell];
      const ok = c.kind === 'inmate' && c.beast === 'lion' && target && target.inmate && T.canEat(st, lion.inmate, target.inmate);
      if (!ok) model.cells[n] = Object.assign({}, c, { prey: null });
    });
  }

  function setCell(n, patch) {
    if (n === T.OFFICE) return;
    const prev = model.cells[n];
    const c = Object.assign({}, prev, patch);
    if (c.kind === 'inmate') {
      c.beast = T.BEASTS.includes(c.beast) ? c.beast : 'mammoth';
      c.tier = clamp(toInt(c.tier, 0), 0, TOP_TIER);
      c.event = null;
    } else {
      c.prey = null;
      c.ivory = false;
    }
    if (c.kind === 'scratch' || c.kind === 'revealed') c.tier = clamp(toInt(c.tier, 1), 0, TOP_TIER);
    if (c.kind === 'scouted') {
      c.beast = T.BEASTS.includes(c.beast) ? c.beast : 'mammoth';
      c.tier = clamp(toInt(c.tier, 0), 0, TOP_TIER);
    }
    if (c.kind === 'nest') {
      c.due = toInt(c.due, model.day + 2);
      c.event = null;
    }
    if (c.kind === 'empty') c.event = null;
    if (c.beast !== 'lion') c.prey = null;
    model.cells[n] = c;
    cleanPrey();
    flags.delete(n);
    touch(`c${n}`);
    changed();
  }

  // The selected cell, marked Check, is already right.
  function confirmCell(n) {
    flags.delete(n);
    touch(`c${n}`);
    save();
    renderBoard();
    renderEditor();
    renderApplied();
  }

  // Everything the dice filled in after "Do it here" is right.
  function confirmAll() {
    if (via) for (const key of via.filled) via.touched.add(key);
    flags = new Set();
    save();
    renderBoard();
    renderEditor();
    renderApplied();
  }

  function setKind(kind) {
    const c = model.cells[selected];
    if (kind === c.kind) return;
    setCell(selected, { kind });
  }

  function toggleDoor(n) {
    if (n === model.warden) return;
    const has = model.dest.includes(n);
    model.dest = has ? model.dest.filter((x) => x !== n) : [...model.dest, n];
    if (!has && model.step !== 'patrol') model.step = 'patrol';
    touch('dest');
    changed();
  }

  function setWarden(n) {
    model.warden = n;
    changed();
  }

  // ---------- Examples and loading ----------

  function exampleModel() {
    const m = blankModel();
    const put = (n, beast, tier, extra) => {
      m.cells[n] = Object.assign({ kind: 'inmate', beast, tier, ivory: false, prey: null }, extra || {});
    };
    m.day = 6;
    m.warden = 4;
    m.step = 'patrol';
    m.dest = [5, 6, 8];
    m.milestone = false;
    put(1, 'wolf', 1);
    put(3, 'lion', 2);
    put(4, 'rat', 0);
    put(6, 'mammoth', 2);
    put(9, 'rat', 1);
    m.cells[10] = { kind: 'empty' };
    m.cells[11] = { kind: 'scratch', tier: 2, event: null };
    put(12, 'wolf', 3);
    m.cells[14] = { kind: 'nest', due: 7 };
    put(15, 'wolf', 2);
    m.cells[5] = { kind: 'sealed', event: 'unknown' };
    m.tools = ['rope'];
    return m;
  }

  function loadRun() {
    const data = store.get(SAVE_KEY);
    if (!data) {
      notice('No simulator run is saved in this browser yet. Play one first, or set up your board here.');
      return;
    }
    try {
      const st = T.deserialize(data);
      model = modelFrom(st, null);
      flags = new Set();
      applied = null;
      via = null;
      // A simulator run isn't live, so its boards are never shared.
      if (SHARE) SHARE.reset('sim');
      undo.length = 0;
      solver.st = null;
      changed();
      notice(model.ended ? 'Loaded your simulator run. It has ended, so set up a new position.' : `Loaded your simulator run: day ${model.day}.`);
    } catch (e) {
      notice(e.message);
    }
  }

  // Opens the position in the simulator, replacing its saved run.
  let openArmed = 0;
  function openInSimulator() {
    const { st, problems } = buildState(model);
    if (problems.length) {
      showProblems(problems);
      return;
    }
    const existing = store.get(SAVE_KEY);
    if (existing && Date.now() > openArmed) {
      openArmed = Date.now() + 6000;
      $('az-open-sim').textContent = 'This replaces your saved simulator run. Click again to confirm.';
      setTimeout(() => {
        $('az-open-sim').textContent = 'Play this position in the simulator';
      }, 6000);
      return;
    }
    st.log = [{ d: st.day, k: 'lab', t: 'Board analyzer: this position was set up by hand.' }];
    if (!store.set(SAVE_KEY, { app: 'tartarus-sim', v: T.VERSION, state: st })) {
      notice('This browser blocked saving, so the position could not be sent to the simulator.');
      return;
    }
    window.location.href = './';
  }

  // ---------- Reading a screenshot ----------

  const reader = { worker: null, failed: false, id: 0, pending: null, image: null, result: null, reading: null, ms: 0 };
  const SHORT_TIER = ['Normal', 'Magic', 'Rare', 'Legend.', 'Supreme'];

  // A notice pinned to the window while a screenshot is read, so a paste
  // shows it's working wherever the page is scrolled. kind: busy, ok or bad.
  // A sticky one stays until it's answered.
  let toastTimer = 0;
  function toast(text, kind, actions, sticky) {
    const box = $('az-toast');
    clearTimeout(toastTimer);
    box.className = `az-toast is-${kind}`;
    $('az-toast-text').textContent = text;
    $('az-toast-actions').innerHTML = (actions || []).map((a) => `<button type="button" class="btn${a.primary ? ' btn-primary' : ''}" data-toast="${a.id}">${esc(a.label)}</button>`).join('');
    box.hidden = false;
    if (kind !== 'busy' && !sticky) toastTimer = setTimeout(() => (box.hidden = true), actions && actions.length ? 15000 : 6000);
  }

  // Follow my game asks before a reading becomes the board: what's run when
  // the player uses it (from the prompt or the reading's own button), or
  // skips it.
  let accepted = null;
  let skipped = null;

  // What a reading would change on the board, in a line, for that prompt.
  function readingChanges(rd) {
    const m = rd.model;
    const parts = [m.day !== model.day ? `day ${model.day} → ${m.day}` : `day ${m.day}`];
    if (m.warden !== model.warden) parts.push(`warden to ${m.warden === T.OFFICE ? 'the office' : L(m.warden)}`);
    const changed = m.cells.map((c, n) => (cellSig(c) !== cellSig(model.cells[n]) ? n : -1)).filter((n) => n >= 0);
    parts.push(changed.length ? `${T.plural(changed.length, 'cell')} changed: ${changed.slice(0, 6).map((n) => `${L(n)} ${cellShort(m.cells[n])}`).join(', ')}${changed.length > 6 ? '…' : ''}` : 'no cells changed');
    if (m.step === 'patrol' && m.dest.length) parts.push(`doors ${m.dest.map(L).join(', ')}`);
    const tools = m.tools.filter((t) => !model.tools.includes(t));
    if (tools.length) parts.push(`new instrument${tools.length === 1 ? '' : 's'}: ${tools.map((t) => T.toolName(t)).join(', ')}`);
    if (m.vault.length !== model.vault.length) parts.push(T.plural(m.vault.length, 'Chromatic prisoner'));
    if (rd.checks.size) parts.push(`${rd.checks.size} to check`);
    return parts.join(' · ');
  }

  function offerReading(onUse, onSkip) {
    const rd = reader.reading;
    if (!rd) return false;
    accepted = onUse || null;
    skipped = onSkip || null;
    toast(`From your game: ${readingChanges(rd)}. Use it as your board?`, 'ok', [{ id: 'use', label: 'Use this board', primary: true }, { id: 'review', label: 'Review it first' }, { id: 'skip', label: 'Skip' }], true);
    return true;
  }

  function skipReading(why) {
    const s = skipped;
    accepted = null;
    skipped = null;
    if (s) s(why || 'skipped');
  }

  function scanStatus(text, bad) {
    const el = $('az-scan-status');
    el.textContent = text;
    el.classList.toggle('is-bad', !!bad);
  }

  async function readImageFile(file) {
    if (!file || !/^image\//.test(file.type)) {
      scanStatus('That isn’t an image. Paste, drop or choose a screenshot (PNG or JPG).', true);
      toast('That isn’t an image. Copy a screenshot of the prison screen, then paste it here.', 'bad');
      return;
    }
    scanStatus('Reading your screenshot…');
    toast('Reading your screenshot to load the board…', 'busy');
    let source;
    try {
      source = await createImageBitmap(file);
    } catch (e) {
      scanStatus('This browser couldn’t open that image.', true);
      toast('This browser couldn’t open that image.', 'bad');
      return;
    }
    readBitmap(source);
  }

  // Reads a picture of the game (a pasted screenshot, or a frame from Follow
  // my game). opts.quiet skips the prompts; opts.onRead hears how it went.
  function readBitmap(source, opts) {
    // Very large screenshots are scaled down; the reader works at any size.
    const scale = Math.min(1, 2600 / source.width);
    const w = Math.round(source.width * scale);
    const h = Math.round(source.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, w, h);
    reader.image = canvas;
    runScan(ctx.getImageData(0, 0, w, h), opts);
  }

  function runScan(imageData, opts) {
    const o = opts || {};
    // A newer reading replaces one still waiting for an answer.
    if (accepted || skipped) skipReading('replaced');
    reader.id += 1;
    const id = reader.id;
    const t0 = performance.now();
    const done = (result, error) => {
      if (id !== reader.id) {
        if (o.onRead) o.onRead({ ok: false, skipped: true, reason: 'a newer picture came in' });
        return;
      }
      reader.ms = Math.round(performance.now() - t0);
      if (error || !result) {
        reader.result = null;
        scanStatus(`The reader hit a problem: ${error || 'no result'}.`, true);
        if (!o.quiet) toast(`The reader hit a problem: ${error || 'no result'}.`, 'bad');
        renderScan();
        if (o.onRead) o.onRead({ ok: false, reason: error || 'no result', ms: reader.ms });
        return;
      }
      reader.result = result;
      reader.reading = result.ok ? scanToModel(result, model) : null;
      scanStatus(result.ok ? `Read in ${(reader.ms / 1000).toFixed(1)} s. Check it below, then use it.` : `${result.reason} Try a screenshot of the prison screen, with the whole board in view.`, !result.ok);
      if (o.onRead) o.onRead(result.ok ? { ok: true, day: reader.reading.model.day, unsure: reader.reading.checks.size, ms: reader.ms } : { ok: false, reason: result.reason, ms: reader.ms });
      if (o.quiet) {
        renderScan();
        return;
      }
      if (!result.ok) toast(`${result.reason} Try a screenshot of the prison screen, with the whole board in view.`, 'bad');
      else {
        const m = reader.reading.model;
        const max = m.mode === 'challenge' ? T.CHALLENGE_DAYS : m.maxDays;
        const unsure = reader.reading.checks.size;
        toast(`Read your board: day ${m.day} of ${max}${unsure ? `, ${T.plural(unsure, 'cell')} to check` : ''}. Load it as your new board?`, 'ok', [{ id: 'use', label: 'Use this board', primary: true }, { id: 'review', label: 'Review it first' }]);
      }
      renderScan();
    };
    // The worker outlives this call, so it answers whichever reading is newest.
    reader.pending = { imageData, id, done };
    if (!reader.worker && !reader.failed) {
      try {
        reader.worker = new Worker(`js/scan-worker.js${SCRIPT_QUERY}`);
        reader.worker.onmessage = (e) => {
          const p = reader.pending;
          if (p && e.data.id === p.id) p.done(e.data.result, e.data.error);
        };
        reader.worker.onerror = () => {
          reader.failed = true;
          reader.worker = null;
          const p = reader.pending;
          if (p) scanHere(p.imageData, p.id, p.done);
        };
      } catch (e) {
        reader.failed = true;
        reader.worker = null;
      }
    }
    if (reader.worker) {
      const copy = imageData.data.slice().buffer;
      reader.worker.postMessage({ id, width: imageData.width, height: imageData.height, buffer: copy }, [copy]);
    } else scanHere(imageData, id, done);
  }

  // Without workers (a page opened from disk), reads on the page itself,
  // loading the reader the first time.
  function scanHere(imageData, id, done) {
    const load = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = `${src}${SCRIPT_QUERY}`;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    const ready = window.TartarusScan && window.TARTARUS_SCAN ? Promise.resolve() : load('js/scan.js').then(() => load('js/scan-data.js'));
    ready
      .then(() => {
        setTimeout(() => {
          try {
            const result = window.TartarusScan.scan(imageData, window.TARTARUS_SCAN);
            if (result.tools && result.tools.tools) for (const t of result.tools.tools) Object.assign(t, window.TARTARUS_SCAN.toolNames[t.id] || {});
            done(result);
          } catch (e) {
            done(null, e.message);
          }
        }, 30);
      })
      .catch(() => done(null, 'the screenshot reader could not load'));
  }

  // The board the reading describes, built on the current settings (goal,
  // food chain, run length, contracts), plus the cells to check.
  // A devour's meal pick ("Select an Inmate to Consume"). The game darkens
  // all but the eater and its meals there, so rarities can't be read: the
  // board is the turn before (the one loaded here), with what this picture
  // does show. The eater in the warden's cell as it is now, the cells eaten
  // so far (they lock again), and the meals on offer, which share the
  // eater's rarity. With nothing eaten yet and the eater unchanged, it's the
  // day's devour being aimed, not a chain.
  function chainToModel(r, base) {
    const m = JSON.parse(JSON.stringify(base));
    const checks = new Set();
    const notes = [];
    const warden = r.warden ? r.warden.cell : base.warden;
    // The turn before: the same warden after the patrol, or the patrol that
    // brought the warden here.
    const after = base.warden === warden && (base.step === 'manage' || base.step === 'chain');
    const walked = base.step === 'patrol' && (base.dest || []).includes(warden);
    if (!after && !walked) {
      // Nothing to build on: the board as read, its darkened rarities marked.
      r.cells.forEach((c, n) => {
        if (n === T.OFFICE || n === warden) return;
        if (c.kind === 'locked') m.cells[n] = { kind: 'sealed', event: null };
        else if (c.kind === 'inmate') m.cells[n] = { kind: 'inmate', beast: c.beast, tier: clamp(c.tier, 0, TOP_TIER), ivory: false, prey: null };
        else m.cells[n] = { kind: 'empty' };
        if (c.kind !== 'locked') checks.add(n);
      });
      notes.push('A devour’s meal pick darkens the board, so its rarities were guessed: check the marked cells, or load the board from before the devour first.');
    }
    m.warden = warden;
    const was = base.cells[warden];
    const eater = r.cells[warden];
    if (eater && eater.kind === 'inmate') m.cells[warden] = { kind: 'inmate', beast: eater.beast, tier: clamp(eater.tier, 0, TOP_TIER), ivory: !!(was && was.ivory), prey: was && was.kind === 'inmate' ? was.prey : null };
    else {
      checks.add(warden);
      notes.push('The eater in the warden’s cell wasn’t read: set it as it is now.');
    }
    const tier = m.cells[warden].kind === 'inmate' ? m.cells[warden].tier : 0;
    // Cells the chain has eaten show a padlock again.
    let eaten = 0;
    if (after || walked) {
      r.cells.forEach((c, n) => {
        if (n === T.OFFICE || n === warden || c.kind !== 'locked' || m.cells[n].kind !== 'inmate') return;
        m.cells[n] = { kind: 'sealed', event: null };
        eaten += 1;
      });
    }
    // The meals on offer: the board before keeps its inmate when it fits;
    // otherwise the beast read here, at the eater's rarity. A scratched door
    // stays a door.
    for (const n of r.chain.targets) {
      const c = m.cells[n];
      if (c.kind === 'scratch') continue;
      if (c.kind === 'inmate' && c.tier <= tier && (!r.cells[n].beast || c.beast === r.cells[n].beast)) continue;
      m.cells[n] = { kind: 'inmate', beast: r.cells[n].beast || (c.kind === 'inmate' ? c.beast : 'mammoth'), tier, ivory: c.kind === 'inmate' ? !!c.ivory : false, prey: null };
      checks.add(n);
    }
    const unchanged = walked || (was && was.kind === 'inmate' && eater && eater.kind === 'inmate' && was.beast === eater.beast && was.tier === eater.tier);
    m.step = eaten === 0 && unchanged ? 'manage' : 'chain';
    m.devourUsed = m.step === 'chain';
    if (m.step === 'manage') m.swapUsed = false;
    m.dest = [];
    m.chainArmed = false;
    const tools = (m.tools || []).map((id) => ({ id, sim: id, name: T.toolName(id), conf: 1 }));
    return { model: m, checks, notes, chromatic: (m.vault || []).length, tools, unsim: [], chain: r.chain.targets };
  }

  function scanToModel(r, base) {
    if (r.chain) return chainToModel(r, base);
    const m = JSON.parse(JSON.stringify(base));
    const checks = new Set();
    const notes = [];
    // Days until the riot set how much of the run is left.
    if (r.days) {
      const left = r.days.days;
      if (m.mode === 'challenge') m.day = clamp(T.CHALLENGE_DAYS - left, 1, T.CHALLENGE_DAYS);
      else {
        if (left >= m.maxDays) m.maxDays = Math.min(60, left + 1);
        m.day = Math.max(1, m.maxDays - left);
      }
    } else notes.push('The days until the riot weren’t read: check the day.');
    r.cells.forEach((c, n) => {
      if (n === T.OFFICE) return;
      if (c.kind === 'locked') {
        if (c.nest) {
          m.cells[n] = { kind: 'nest', due: m.day + 2 };
          checks.add(n);
        } else m.cells[n] = { kind: 'sealed', event: c.event ? 'unknown' : null };
        if (c.conf < 0.6) checks.add(n);
      } else if (c.kind === 'inmate') {
        m.cells[n] = { kind: 'inmate', beast: c.beast, tier: clamp(c.tier, 0, TOP_TIER), ivory: false, prey: null };
        if (c.conf < 0.6 || c.ghost) checks.add(n);
      } else {
        m.cells[n] = { kind: 'empty' };
        checks.add(n);
      }
    });
    if (r.warden) {
      m.warden = r.warden.cell;
      if (r.warden.conf < 0.6) checks.add(r.warden.cell);
    } else notes.push('The warden’s arrow wasn’t found: set the warden.');
    if (r.doors && r.doors.cells.length) {
      m.step = 'patrol';
      m.dest = r.doors.cells.filter((n) => n !== m.warden);
      if (r.doors.conf < 0.6) notes.push('Today’s doors were hard to read: check them.');
    } else {
      m.step = 'manage';
      m.dest = [];
      m.devourUsed = false;
      m.swapUsed = false;
    }
    m.chainArmed = false;
    const tools = r.tools && r.tools.tools ? r.tools.tools : [];
    m.tools = [...new Set(tools.map((t) => t.sim).filter(Boolean))];
    const unsim = tools.filter((t) => !t.sim);
    if (unsim.length) notes.push(`Not in the simulator yet, so left out: ${unsim.map((t) => t.name).join(', ')}.`);
    if (tools.some((t) => t.conf < 0.5)) notes.push('Some instruments were hard to tell apart: check them under Tools.');
    const chromatic = r.chromatic ? r.chromatic.count : 0;
    // Their beasts don't show in the slots; they only matter for a bounty.
    m.vault = new Array(chromatic).fill('wolf');
    const highest = Math.max(0, ...m.cells.filter((c) => c.kind === 'inmate').map((c) => c.tier));
    // King of the Caged is met once a Supreme or Chromatic shows. Prison
    // Walk's tiles aren't read, so they keep what was set.
    if (m.objective === 'king') m.milestone = highest >= T.SUPREME || chromatic > 0;
    // The jaws marker shows on every inmate with something to eat. Cells that
    // disagree were probably misread. A washed-out portrait takes the beast
    // that makes the jaws fit.
    const hasTarget = (state, n) => !state.cells[n].sealed && state.cells[n].inmate && T.devourOptions(state, n).length > 0;
    r.cells.forEach((c, n) => {
      if (!c.ghost || m.cells[n].kind !== 'inmate') return;
      let best = null;
      for (const beast of T.BEASTS) {
        const trial = JSON.parse(JSON.stringify(m));
        trial.cells[n].beast = beast;
        const s2 = buildState(Object.assign({}, trial, { step: 'manage' })).st;
        const fit = r.cells.filter((d, k) => d.kind === 'inmate' && hasTarget(s2, k) === !!d.jaws).length;
        if (!best || fit > best.fit) best = { beast, fit };
      }
      m.cells[n].beast = best.beast;
    });
    const { st: final } = buildState(Object.assign({}, m, { step: 'manage' }));
    let odd = 0;
    r.cells.forEach((c, n) => {
      if (c.kind !== 'inmate' || m.cells[n].kind !== 'inmate') return;
      if (hasTarget(final, n) !== !!c.jaws) {
        checks.add(n);
        odd += 1;
      }
    });
    if (odd) notes.push(`${T.plural(odd, 'inmate')}’s jaws marker doesn’t fit what was read: check ${odd === 1 ? 'it' : 'them'} and the inmates around.`);
    return { model: m, checks, notes, chromatic, tools, unsim };
  }

  function renderScan() {
    const box = $('az-scan-result');
    const r = reader.result;
    box.hidden = !r || !reader.image;
    if (box.hidden) return;
    drawScan();
    const rd = reader.reading;
    const list = [];
    if (r.ok && rd) {
      const m = rd.model;
      const inmates = m.cells.filter((c) => c.kind === 'inmate').length;
      const locked = m.cells.filter((c) => c.kind === 'sealed' || c.kind === 'nest').length;
      const events = m.cells.filter((c) => c.event).length;
      const nests = m.cells.filter((c) => c.kind === 'nest').length;
      list.push(`<li><b>Board</b> ${T.plural(inmates, 'inmate')}, ${T.plural(locked, 'locked cell')}${events ? `, ${T.plural(events, 'event')}` : ''}${nests ? `, ${T.plural(nests, 'rat nest')}` : ''}</li>`);
      list.push(`<li><b>Warden</b> ${r.warden ? (r.warden.cell === T.OFFICE ? 'in the office' : `cell ${L(r.warden.cell)}`) : 'not found'}</li>`);
      list.push(`<li><b>Today</b> ${rd.chain ? `${m.step === 'chain' ? 'a devour chain picks its next meal' : 'the day’s devour picks its meal'}: cell ${rd.chain.map(L).join(' or ')}` : m.step === 'patrol' ? `choose a door: ${m.dest.map(L).join(', ')}` : 'no door cards, so after the patrol'}</li>`);
      list.push(`<li><b>Riot</b> ${r.days ? `${T.plural(r.days.days, 'day')} away, so day ${m.day} of ${m.mode === 'challenge' ? T.CHALLENGE_DAYS : m.maxDays}` : 'not read'}</li>`);
      list.push(`<li><b>Instruments</b> ${rd.tools.length ? rd.tools.map((t) => esc(t.name || t.id) + (t.sim ? '' : ' (not simulated)')).join(', ') : 'none'}</li>`);
      list.push(`<li><b>Chromatic</b> ${T.plural(rd.chromatic, 'prisoner')}${r.chromatic ? '' : ' (panel not found)'}</li>`);
      if (rd.checks.size) list.push(`<li class="is-check"><b>Check</b> ${[...rd.checks].sort((a, b) => a - b).map(L).join(', ')}: unsure, marked Check on the board</li>`);
      for (const note of rd.notes) list.push(`<li class="is-note">${esc(note)}</li>`);
    }
    $('az-scan-summary').innerHTML = list.join('');
    $('az-scan-use').hidden = !r.ok;
    // The objective, cut from the screenshot.
    const obj = r.ok && r.objective ? r.objective : null;
    $('az-scan-objective').hidden = !obj;
    if (obj) {
      const c = $('az-scan-objective-canvas');
      const [x0, y0, x1, y1] = obj;
      const w = x1 - x0;
      const h = y1 - y0;
      const scale = Math.min(1.6, 320 / w);
      c.width = Math.round(w * scale);
      c.height = Math.round(h * scale);
      c.getContext('2d').drawImage(reader.image, x0, y0, w, h, 0, 0, c.width, c.height);
    }
  }

  // The screenshot with what was read drawn over it.
  function drawScan() {
    const r = reader.result;
    const img = reader.image;
    const canvas = $('az-scan-canvas');
    const dpr = window.devicePixelRatio || 1;
    const maxW = Math.min(900, canvas.parentElement.clientWidth || 640);
    const scale = Math.min(1, maxW / img.width) * dpr;
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.style.width = `${Math.round(canvas.width / dpr)}px`;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    if (!r.ok || !reader.reading) return;
    const checks = reader.reading.checks;
    const doors = new Set(reader.reading.model.step === 'patrol' ? reader.reading.model.dest : []);
    const font = (px) => `600 ${px}px "IBM Plex Mono", ui-monospace, monospace`;
    // The warden: a ring on the arrow's cell, under the labels.
    if (r.warden) {
      const c = r.cells[r.warden.cell];
      ctx.strokeStyle = '#f28c36';
      ctx.lineWidth = 3 * dpr;
      ctx.beginPath();
      ctx.arc(c.x * scale, (c.y - 40 * c.k) * scale, 30 * c.k * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of r.cells) {
      if (c.n === T.OFFICE) continue;
      const x = c.x * scale;
      const y = (c.y - 40 * c.k) * scale;
      const w = 92 * c.k * scale;
      const h = 82 * c.k * scale;
      const check = checks.has(c.n);
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = check ? '#f1cd48' : doors.has(c.n) ? '#5fc4b8' : 'rgba(234, 223, 197, 0.55)';
      ctx.setLineDash(check ? [5, 4] : []);
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      // Beast over rarity, shrunk to fit inside the cell's box.
      const cell = reader.reading.model.cells[c.n];
      const lines = c.kind === 'locked' ? [c.nest ? 'nest' : c.event ? 'locked !' : 'locked'] : c.kind === 'inmate' ? [T.beastName(cell.beast), SHORT_TIER[cell.tier]] : ['empty?'];
      let px = Math.round(11 * dpr);
      ctx.font = font(px);
      const widest = Math.max(...lines.map((t) => ctx.measureText(t).width));
      if (widest + 6 * dpr > w) {
        px = Math.max(Math.round(8 * dpr), Math.floor((px * (w - 6 * dpr)) / widest));
        ctx.font = font(px);
      }
      const lh = Math.round(px * 1.25);
      const tw = Math.min(w, Math.max(...lines.map((t) => ctx.measureText(t).width)) + 8 * dpr);
      const th = lh * lines.length + 2 * dpr;
      const top = y + h / 2 - th;
      ctx.fillStyle = check ? 'rgba(241, 205, 72, 0.92)' : 'rgba(15, 18, 22, 0.86)';
      ctx.fillRect(x - tw / 2, top, tw, th);
      ctx.fillStyle = check ? '#1c1913' : '#e3e6eb';
      lines.forEach((t, i) => ctx.fillText(t, x, top + dpr + lh * (i + 0.5)));
    }
    ctx.setLineDash([]);
  }

  function useScan(quiet) {
    const rd = reader.reading;
    if (!rd) return;
    undo.push({ model: JSON.parse(JSON.stringify(model)), selected });
    model = normalize(rd.model);
    flags = new Set(rd.checks);
    applied = null;
    via = { scan: true, filled: [...rd.checks].map((n) => `c${n}`), touched: new Set() };
    if (SHARE) SHARE.markManual();
    solver.st = null;
    selected = rd.checks.size ? Math.min(...rd.checks) : model.warden;
    reader.result = null;
    renderScan();
    changed();
    scanStatus(rd.checks.size ? `Board filled in. Check the ${T.plural(rd.checks.size, 'cell')} marked Check, then ask what to do.` : 'Board filled in. Look it over, then ask what to do.');
    const after = accepted;
    accepted = null;
    skipped = null;
    if (after) after();
    if (quiet === true) return;
    toast(rd.checks.size ? `Loaded day ${model.day}. Check the ${T.plural(rd.checks.size, 'cell')} marked Check, then ask what to do.` : `Loaded day ${model.day}. Ask what to do when it looks right.`, 'ok');
    $('az-board').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ---------- Wiring ----------

  function segment(id, apply) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if (!b || b.disabled) return;
      apply(b.dataset.v, b);
    });
  }

  function bind() {
    // Beast and rarity pickers, built once.
    $('az-beasts').innerHTML = T.BEASTS.map((b) => `<button type="button" class="az-beast" data-v="${b}">${B.PORTRAITS[b]}<span>${esc(T.beastName(b))}</span></button>`).join('');
    $('az-tiers').innerHTML = T.TIERS.slice(0, TOP_TIER + 1).map((name, t) => `<button type="button" class="az-tier t${t}" data-v="${t}">${esc(name)}</button>`).join('');
    // The instruments: every one the simulator knows, clicked on and off.
    $('az-tools').innerHTML = T.TOOL_IDS.map((id) => `<button type="button" class="az-instrument" data-tool="${id}" aria-pressed="false" title="${esc(`${T.toolName(id)}: ${T.toolText(id)}`)}">${B.INSTRUMENTS[id] || ''}<span>${esc(T.toolName(id))}</span></button>`).join('');
    $('az-vault-add').innerHTML = `<span class="field-label">Add</span>${T.BEASTS.map((b) => `<button type="button" class="az-ico t5" data-vault-add="${b}" title="Add a Chromatic ${esc(T.beastName(b))}" aria-label="Add a Chromatic ${esc(T.beastName(b))}">${B.PORTRAITS[b]}</button>`).join('')}`;

    segment('az-kind', (v) => setKind(v));
    segment('az-beasts', (v) => setCell(selected, { kind: model.cells[selected].kind === 'scouted' ? 'scouted' : 'inmate', beast: v }));
    segment('az-tiers', (v) => {
      const c = model.cells[selected];
      setCell(selected, { kind: ['scratch', 'scouted', 'revealed'].includes(c.kind) ? c.kind : 'inmate', tier: Number(v) });
    });
    segment('az-event', (v) => setCell(selected, { event: v === 'none' ? null : v }));
    $('az-ivory').addEventListener('change', (e) => setCell(selected, { ivory: e.target.checked }));
    $('az-prey').addEventListener('change', (e) => {
      const value = e.target.value;
      setCell(selected, { prey: value === '' ? null : { cell: Number(value), rounds: toInt($('az-prey-rounds').value, T.DEFAULT_PARAMS.preyRounds) } });
    });
    $('az-prey-rounds').addEventListener('change', (e) => {
      const c = model.cells[selected];
      if (c.prey) setCell(selected, { prey: { cell: c.prey.cell, rounds: clamp(toInt(e.target.value, 1), 1, 9) } });
    });
    $('az-nest-due').addEventListener('change', (e) => setCell(selected, { due: clamp(toInt(e.target.value, model.day + 2), 1, 60) }));
    $('az-warden').addEventListener('click', () => setWarden(selected));
    $('az-door').addEventListener('click', () => toggleDoor(selected));

    segment('az-mode', (v) => {
      model.mode = v;
      if (v === 'challenge') model.day = Math.min(model.day, T.CHALLENGE_DAYS);
      if (v !== 'challenge' && model.step === 'window') model.step = 'manage';
      changed();
    });
    $('az-riot').addEventListener('change', (e) => {
      const max = model.mode === 'challenge' ? T.CHALLENGE_DAYS : clamp(toInt(model.maxDays, 20), 5, 60);
      model.day = clamp(max - toInt(e.target.value, max - model.day), 1, max);
      changed();
    });
    $('az-days').addEventListener('change', (e) => {
      model.maxDays = clamp(toInt(e.target.value, 20), 5, 60);
      model.day = Math.min(model.day, model.maxDays);
      changed();
    });
    segment('az-step', (v) => {
      model.step = v;
      // The buttons only show with the warden in the office.
      if (v === 'office') model.warden = T.OFFICE;
      changed();
    });
    $('az-doors').addEventListener('click', (e) => {
      const b = e.target.closest('[data-door]');
      if (b) toggleDoor(Number(b.dataset.door));
    });
    $('az-devoured').addEventListener('change', (e) => {
      model.devourUsed = e.target.checked;
      changed();
    });
    $('az-swapped').addEventListener('change', (e) => {
      model.swapUsed = e.target.checked;
      changed();
    });
    segment('az-event-kind', (v) => {
      model.eventKind = v;
      touch('event');
      changed();
    });
    segment('az-choice-kind', (v) => {
      model.choice = { kind: v, options: model.choice.options };
      touch('choice');
      changed();
    });
    $('az-offer').addEventListener('change', (e) => {
      const sel = e.target.closest('[data-offer]');
      if (!sel) return;
      const options = [0, 1, 2].map((i) => model.choice.options[i] || '');
      options[Number(sel.dataset.offer)] = sel.value;
      touch('choice');
      model.choice = { kind: model.choice.kind, options: options.filter(Boolean) };
      changed();
    });
    segment('az-window-kind', (v) => {
      model.windowKind = v;
      changed();
    });
    $('az-armed').addEventListener('change', (e) => {
      model.chainArmed = e.target.checked;
      changed();
    });
    $('az-tools').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tool]');
      if (!b) return;
      const id = b.dataset.tool;
      model.tools = model.tools.includes(id) ? model.tools.filter((t) => t !== id) : [...model.tools, id];
      model.choice = { kind: model.choice.kind, options: model.choice.options.filter((t) => !model.tools.includes(t)) };
      changed();
    });
    $('az-rewards').addEventListener('change', (e) => {
      model.rewards = e.target.checked;
      changed();
    });
    $('az-milestone').addEventListener('change', (e) => {
      model.milestone = e.target.checked;
      if (!model.milestone && model.objective === 'walk') model.walkTiles = Math.min(model.walkTiles, T.OBJECTIVES.walk.need - 1);
      changed();
    });
    $('az-objective').addEventListener('change', (e) => {
      model.objective = T.OBJECTIVES[e.target.value] ? e.target.value : 'king';
      changed();
    });
    $('az-walk').addEventListener('change', (e) => {
      model.walkTiles = clamp(toInt(e.target.value, 0), 0, T.OBJECTIVES.walk.need);
      if (model.walkTiles >= T.OBJECTIVES.walk.need) model.milestone = true;
      changed();
    });
    $('az-vault-add').addEventListener('click', (e) => {
      const b = e.target.closest('[data-vault-add]');
      if (!b) return;
      model.vault = [...model.vault, b.dataset.vaultAdd];
      changed();
    });
    $('az-vault').addEventListener('click', (e) => {
      const b = e.target.closest('[data-unvault]');
      if (!b) return;
      model.vault = model.vault.filter((_, i) => i !== Number(b.dataset.unvault));
      changed();
    });
    $('az-vouchers').addEventListener('change', (e) => {
      model.ch.vouchers = clamp(toInt(e.target.value, T.START_VOUCHERS), 0, T.START_VOUCHERS);
      changed();
    });
    $('az-contracts').addEventListener('change', (e) => {
      const c = e.target.closest('[data-contract]');
      if (c) model.ch.contracts[Number(c.dataset.contract)] = c.value;
      const p = e.target.closest('[data-points]');
      if (p) model.ch.points[Number(p.dataset.points)] = clamp(toInt(p.value, 0), 0, 999);
      if (e.target.id === 'az-bounty') model.ch.bounty = e.target.value;
      changed();
    });
    $('az-contracts').addEventListener('click', (e) => {
      const b = e.target.closest('[data-status] button[data-v]');
      if (!b || b.disabled) return;
      const slot = Number(b.closest('[data-status]').dataset.status);
      model.ch.status[slot] = b.dataset.v;
      // Contracts settle in order.
      if (slot === 0 && b.dataset.v === 'pending') model.ch.status[1] = 'pending';
      changed();
    });

    $('az-go').addEventListener('click', () => ask());
    $('az-do').addEventListener('click', () => {
      const rec = fresh() ? recommendation() : null;
      if (rec) doMove(rec.action);
    });
    $('az-next').addEventListener('click', () => {
      const rec = fresh() ? recommendation() : null;
      if (rec) doMove(rec.action, true);
    });
    $('az-undo').addEventListener('click', undoMove);
    $('az-applied').addEventListener('click', (e) => {
      if (e.target.closest('[data-undo]')) undoMove();
      if (e.target.closest('[data-match]')) confirmAll();
    });
    $('az-match').addEventListener('click', () => confirmCell(selected));
    $('az-pick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b || b.disabled) return;
      const n = Number($('az-pick').dataset.cell);
      closePick(true);
      pickCell(n, b.dataset.pick);
    });
    // Arrows move around the picker's grid; Escape closes it.
    $('az-pick').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closePick(true);
        return;
      }
      const d = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
      if (!d) return;
      e.preventDefault();
      const rows = [...$('az-pick').querySelectorAll('.az-pick-row')].map((r) => [...r.querySelectorAll('[data-pick]:not(:disabled)')]);
      let r = rows.findIndex((row) => row.includes(document.activeElement));
      if (r < 0) return;
      let c = rows[r].indexOf(document.activeElement);
      r = clamp(r + d[0], 0, rows.length - 1);
      c = clamp(c + d[1], 0, rows[r].length - 1);
      rows[r][c].focus();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!$('az-pick').hidden && !e.target.closest('#az-pick, #az-board .cell')) closePick(false);
    });
    $('az-pick').addEventListener('focusout', (e) => {
      const to = e.relatedTarget;
      if (to && !$('az-pick').contains(to) && !to.closest('#az-board .cell')) closePick(false);
    });
    $('az-share').addEventListener('click', (e) => {
      const b = e.target.closest('[data-share]');
      if (!b) return;
      if (b.dataset.share === 'see') SHARE.download();
      else SHARE.setSharing(b.dataset.share === 'on');
    });
    if (SHARE) SHARE.onChange(renderShare);
    $('az-load-run').addEventListener('click', loadRun);
    $('az-example').addEventListener('click', () => {
      model = exampleModel();
      selected = 4;
      flags = new Set();
      applied = null;
      via = null;
      if (SHARE) SHARE.reset('example');
      solver.st = null;
      changed();
      notice('Loaded an example: day 6, the warden at cell 05, with three doors to choose from.');
    });
    let clearArmed = 0;
    $('az-clear').addEventListener('click', () => {
      if (Date.now() > clearArmed) {
        clearArmed = Date.now() + 5000;
        $('az-clear').textContent = 'Click again to clear';
        setTimeout(() => {
          $('az-clear').textContent = 'Clear the board';
        }, 5000);
        return;
      }
      clearArmed = 0;
      $('az-clear').textContent = 'Clear the board';
      model = blankModel();
      selected = 1;
      flags = new Set();
      applied = null;
      via = null;
      if (SHARE) SHARE.reset('manual');
      solver.st = null;
      changed();
      notice('Cleared: day 1, every cell sealed, the warden in the office.');
    });
    $('az-open-sim').addEventListener('click', openInSimulator);

    // Screenshots: choose a file, paste anywhere, or drop anywhere.
    $('az-scan-file').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) readImageFile(file);
      e.target.value = '';
    });
    // While the report dialog is open, pastes and drops are its screenshot.
    const reporting = () => !!window.TartarusReport && TartarusReport.isOpen();
    document.addEventListener('paste', (e) => {
      if (reporting()) return;
      const items = e.clipboardData ? [...e.clipboardData.items] : [];
      const item = items.find((i) => i.kind === 'file' && /^image\//.test(i.type));
      if (!item) return;
      e.preventDefault();
      readImageFile(item.getAsFile());
      $('az-scan').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    const hasFiles = (e) => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    document.addEventListener('dragover', (e) => {
      if (!hasFiles(e) || reporting()) return;
      e.preventDefault();
      $('az-scan').classList.add('is-drop');
    });
    document.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) $('az-scan').classList.remove('is-drop');
    });
    document.addEventListener('drop', (e) => {
      if (!hasFiles(e) || reporting()) return;
      e.preventDefault();
      $('az-scan').classList.remove('is-drop');
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) readImageFile(file);
    });
    $('az-scan-use').addEventListener('click', () => useScan());
    // Follow my game (js/auto.js, beta): read frames of the game, load
    // them, and ask, without the prompts a pasted screenshot gets.
    window.TartarusAnalyzer = {
      readFrame: (bitmap) => new Promise((resolve) => readBitmap(bitmap, { quiet: true, onRead: resolve })),
      useReading: () => useScan(true),
      offerReading,
      ask: () => ask(true),
      recommendation: () => (fresh() ? recommendation() : null),
      day: () => model.day,
      toast,
    };
    // Reports of something new carry where the player was, nothing more.
    if (window.TartarusReport) {
      TartarusReport.setup({
        app: 'analyze-20261014a',
        context: () => ({ page: 'analyze', day: model.day, step: model.step }),
      });
    }
    $('az-toast-actions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-toast]');
      if (!b) return;
      $('az-toast').hidden = true;
      if (b.dataset.toast === 'use') useScan();
      else if (b.dataset.toast === 'skip') skipReading();
      else if (b.dataset.toast === 'pick') $('az-scan-file').click();
      else $('az-scan').scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
    $('az-scan-discard').addEventListener('click', () => {
      if (accepted || skipped) {
        // Discarding a reading Follow my game asked about skips it.
        $('az-toast').hidden = true;
        skipReading();
      }
      reader.result = null;
      reader.reading = null;
      renderScan();
      scanStatus('');
    });
    let resizeTimer = 0;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (reader.result && reader.image) drawScan();
      }, 150);
    });

    // Keyboard entry on the board.
    $('az-board').addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('#az-pick')) return;
      const key = e.key.toLowerCase();
      const move = { arrowright: 1, arrowdown: 1, arrowleft: -1, arrowup: -1 }[key];
      if (move) {
        e.preventDefault();
        select((selected + move + T.CELL_COUNT) % T.CELL_COUNT);
        cellEls[selected].btn.focus();
        return;
      }
      if (selected === T.OFFICE && key !== 'h') return;
      const c = model.cells[selected];
      let handled = true;
      if (BEAST_KEYS[key]) setCell(selected, { kind: 'inmate', beast: BEAST_KEYS[key] });
      else if (key >= '1' && key <= '5') setCell(selected, { kind: ['scratch', 'scouted', 'revealed'].includes(c.kind) ? c.kind : 'inmate', tier: Number(key) - 1 });
      else if (key === 's' || key === 'delete' || key === 'backspace') setCell(selected, { kind: 'sealed' });
      else if (key === 'x') setCell(selected, { kind: 'scratch' });
      else if (key === 'n') setCell(selected, { kind: 'nest' });
      else if (key === 'e') setCell(selected, { kind: 'empty' });
      else if (key === 'i' && c.kind === 'inmate') setCell(selected, { ivory: !c.ivory });
      else if (key === 'd') toggleDoor(selected);
      else if (key === 'h') setWarden(selected);
      else handled = false;
      if (handled) {
        e.preventDefault();
        cellEls[selected].btn.focus();
      }
    });
  }

  buildBoard();
  bind();
  render();
})();
