/* Tartarus Simulator: rules engine.
 * Game state and rules only, with no DOM access, so the same file runs in the
 * page and under Node for tests. Every random roll draws from a seeded stream,
 * which makes a run replayable from its seed. Public actions validate first and
 * only then change the state, and return { ok, events } or { ok: false, reason }.
 *
 * The block is a ring of 16 cells numbered clockwise. The warden stands on one
 * cell; each morning offers a few patrol destinations, and a chain reaction
 * opens every sealed cell on the clockwise walk to the next destination. */
(function (root) {
  'use strict';

  const VERSION = 2;
  const CELL_COUNT = 16;
  const SUPREME = 4;
  const RAINBOW = 5;
  const LOG_LIMIT = 400;
  const CHALLENGE_DAYS = 12;
  const START_VOUCHERS = 6;

  const TIERS = ['Normal', 'Magic', 'Rare', 'Legendary', 'Supreme', 'Rainbow'];

  const BEASTS = ['mammoth', 'lion', 'wolf', 'rat'];
  const BEAST_INFO = {
    mammoth: { name: 'Mammoth', eats: ['lion', 'wolf'] },
    lion: { name: 'Lion', eats: ['wolf', 'rat'] },
    wolf: { name: 'Wolf', eats: ['rat'] },
    rat: { name: 'Rat', eats: ['mammoth'] },
  };

  // Convoy pressure each inmate adds to an escort, by tier.
  const PRESSURE = [2, 4, 8, 16, 32, 65];
  const ESCORTS = {
    light: { name: 'Light escort', cap: 36, cost: 1 },
    heavy: { name: 'Heavy escort', cap: 72, cost: 3 },
  };

  // Relative worth of one inmate per tier; the advisor ranks moves with it.
  const WORTH = [1, 3, 9, 27, 81, 400];

  const DEFAULT_PARAMS = {
    drillDays: 20,
    destinations: 3,
    scoutsPerDay: 1,
    swapsPerDay: 1,
    reusableCells: true,
    tierWeights: [52, 27, 15, 6, 0],
    beastWeights: [25, 25, 25, 25],
    eventChance: 18,
    executionSameTier: false,
    executionRerolls: false,
    ivoryCount: 4,
    ivoryIncludesSwapped: true,
    preyRounds: 3,
    scratchStacksBase: true,
    nestDays: 2,
    nestTier: 2,
    circularNeighbors: true,
  };

  // The contract challenge always plays with these values.
  const CHALLENGE_PARAMS = Object.assign({}, DEFAULT_PARAMS, { executionSameTier: true, executionRerolls: true });

  // Field definitions for the Lab form; normalizeParams clamps to these.
  const PARAM_FIELDS = [
    { key: 'drillDays', group: 'Pace', label: 'Drill length in days', type: 'int', min: 5, max: 60 },
    { key: 'destinations', group: 'Pace', label: 'Patrol destinations offered each morning', type: 'int', min: 1, max: 16 },
    { key: 'scoutsPerDay', group: 'Pace', label: 'Scouts per day', type: 'int', min: 0, max: 16 },
    { key: 'swapsPerDay', group: 'Pace', label: 'Swaps per day', type: 'int', min: 0, max: 16 },
    { key: 'reusableCells', group: 'Pace', label: 'Emptied cells seal again and can be reopened', type: 'bool' },
    { key: 'tierWeights', group: 'Odds', label: 'Rarity weights for new inmates', type: 'list', names: TIERS.slice(0, 5) },
    { key: 'beastWeights', group: 'Odds', label: 'Beast weights for new inmates', type: 'list', names: ['Mammoth', 'Lion', 'Wolf', 'Rat'] },
    { key: 'eventChance', group: 'Special events', label: 'Chance a sealed cell hides a special event (%)', type: 'int', min: 0, max: 100 },
    { key: 'executionSameTier', group: 'Special events', label: 'Execution takes same-rarity prey (off: lower rarity only)', type: 'bool' },
    { key: 'executionRerolls', group: 'Special events', label: "Execution re-rolls the executioner's beast", type: 'bool' },
    { key: 'ivoryCount', group: 'Markers', label: 'Inmates raised when an Ivory cell is swapped', type: 'int', min: 1, max: 15 },
    { key: 'ivoryIncludesSwapped', group: 'Markers', label: 'Ivory can raise the swapped-in inmate', type: 'bool' },
    { key: 'preyRounds', group: 'Markers', label: 'Mornings a prey mark lasts', type: 'int', min: 1, max: 10 },
    { key: 'scratchStacksBase', group: 'Markers', label: 'Scratch bonus (+2) adds to the base +1', type: 'bool' },
    { key: 'nestDays', group: 'Markers', label: 'Days before a rat nest hatches', type: 'int', min: 1, max: 10 },
    { key: 'nestTier', group: 'Markers', label: 'Rarity of a hatched Rat', type: 'tier' },
    { key: 'circularNeighbors', group: 'Tools', label: 'Cells 16 and 01 count as neighbors', type: 'bool' },
  ];

  const TOOLS = {
    revenge: { name: "Avenger's Box", text: 'After a devour, 30% chance to open a sealed cell holding a meal for the eater at its new rarity. That door triggers nothing else.' },
    muzzle: { name: 'Agony Muzzle', text: 'When 3 or fewer inmates are on the block before the meal, a devour gains +2 extra tiers.' },
    saw: { name: 'Rusty Saw', text: 'After a devour, 25% chance of +1 extra tier.' },
    keys: { name: 'Lost Key Ring', text: 'When a patrol opens a door, 80% chance to also open the cells on both sides. Those doors trigger nothing else.' },
    rope: { name: "Hangman's Rope", text: 'Swapped-in inmates are never Normal or Magic.' },
    fire: { name: 'Burning Stake', text: 'One fewer patrol destination each day. Swapping out an inmate below Legendary has a 40% chance to bring in a Legendary.' },
    ironbox: { name: 'Writhing Iron Box', text: 'Each morning a sealed cell becomes a rat nest. It hatches a Rare Rat two days later.' },
    skewer: { name: 'Rat-Head Skewer', text: "Rats can devour Rats of the same rarity, and a Rat's devour gains +1 extra tier." },
  };
  const TOOL_IDS = Object.keys(TOOLS);

  const GIFTS = {
    ring: { name: 'Three-Headed Ring', text: 'Open up to 3 random sealed cells. They trigger nothing else.' },
    horn: { name: 'Bronze War Horn', text: 'Every inmate with a target devours one at random, in turn.' },
    wine: { name: 'Crimson Wine', text: 'Every inmate below Legendary rises one tier.' },
    brand: { name: 'Brand of Sin', text: 'Up to 4 inmates with no meal change beast so they have a same-rarity target.' },
  };
  const GIFT_IDS = Object.keys(GIFTS);

  const START_CELLS = [0, 1, 4, 5, 9, 10];
  const LOADOUTS = {
    supply: { name: 'Supply start', level: 'Standard', text: 'Six inmates and the Lost Key Ring. Build numbers for the mixed convoys.', inmates: [['mammoth', 0], ['lion', 0], ['wolf', 1], ['rat', 1], ['rat', 2], ['mammoth', 2]], tools: ['keys'] },
    lean: { name: 'Lean start', level: 'Advanced', text: 'Three inmates and the Agony Muzzle. Keep the block small for big tier jumps.', inmates: [['mammoth', 0], ['lion', 0], ['wolf', 3]], tools: ['muzzle'] },
    rats: { name: 'Rat-breeding start', level: 'Easier', text: 'Three inmates, the Writhing Iron Box and the Rat-Head Skewer. Breed Rats and pair them.', inmates: [['rat', 2], ['rat', 2], ['mammoth', 3]], tools: ['ironbox', 'skewer'] },
  };

  const SCENARIOS = {
    empty: { name: 'Empty prison', text: 'Day 1 with all 16 doors sealed. Recommended for a first run.' },
    events: { name: 'Special events drill', text: 'Two doors on today’s route hide a Chain reaction and an Execution.' },
    ivory: { name: 'Ivory drill', text: 'Swap the inmate in an Ivory cell and four inmates rise a tier.' },
    prey: { name: 'Prey drill', text: 'A Lion and its marked prey both rise each morning for three days.' },
    scratch: { name: 'Scratch drill', text: 'Wolves devour through scratched doors for +3.' },
    nest: { name: 'Rat nest drill', text: 'Leave a nest sealed for two days to hatch a Rare Rat.' },
  };

  // Each challenge slot draws one variant from the seed. Deadlines fall at the
  // end of days 4, 8 and 12; the last slot is the heavy contract.
  const CONTRACT_SLOTS = [
    {
      deadline: 4,
      variants: [
        { id: 'mixed', name: 'Mixed convoy', needs: ['At least 3 inmates', 'At least 2 different beasts'] },
        { id: 'cohort', name: 'Work gang', needs: ['At least 4 inmates', 'Any beast or rarity'] },
        { id: 'veteran', name: 'Veteran-led crew', needs: ['At least 1 Rare or Legendary', 'At least 2 Normal or Magic'] },
      ],
    },
    {
      deadline: 8,
      variants: [
        { id: 'elite', name: 'Elite convoy', needs: ['At least 2 Rare or Legendary', 'At least 2 different beasts'] },
        { id: 'kin', name: 'Kin escort', needs: ['At least 1 Legendary', 'Plus 1 of the same beast below Legendary'] },
        { id: 'muster', name: 'Elite muster', needs: ['At least 3 Rare or Legendary', 'Any beast'] },
      ],
    },
    {
      deadline: 12,
      heavy: true,
      variants: [
        { id: 'heavy', name: 'Heavy convoy', needs: ['At least 1 Supreme or Rainbow', 'Vault Rainbows count'] },
        { id: 'bounty', name: 'Heavy bounty', needs: ['At least 1 Supreme or Rainbow', 'Vault Rainbows count'] },
      ],
    },
  ];

  const SEED_WORDS = ['ASH', 'BONE', 'IRON', 'SALT', 'EMBER', 'CHAIN', 'GATE', 'WARD', 'HOWL', 'TUSK', 'FANG', 'MANE', 'CINDER', 'SHACKLE'];

  // ---------- Small helpers ----------

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const tierName = (t) => TIERS[clamp(t, 0, RAINBOW)];
  const beastName = (b) => (BEAST_INFO[b] ? BEAST_INFO[b].name : 'Unknown');
  const cellLabel = (n) => String(n + 1).padStart(2, '0');
  const describe = (inmate) => `${tierName(inmate.tier)} ${beastName(inmate.beast)}`;
  const ok = (events) => ({ ok: true, events: events || [] });
  const fail = (reason) => ({ ok: false, reason });
  const has = (state, tool) => state.tools.includes(tool);
  const freshDay = () => ({ scout: 0, swap: 0 });
  // Steps clockwise from a to b, so 0 means the same cell.
  const stepsBetween = (a, b) => (b - a + CELL_COUNT) % CELL_COUNT;

  // ---------- Seeded randomness ----------

  function hashSeed(text) {
    let h = 2166136261;
    for (const ch of String(text)) {
      h ^= ch.codePointAt(0);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  // mulberry32: small, fast, and its whole state fits in one saved number.
  function rand(stream) {
    stream.rng = (stream.rng + 0x6d2b79f5) >>> 0;
    let t = stream.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function pickIndex(stream, weights) {
    const total = weights.reduce((sum, w) => sum + Math.max(0, w), 0);
    if (total <= 0) return 0;
    let r = rand(stream) * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }

  const pickOne = (stream, list) => list[Math.floor(rand(stream) * list.length)];

  function shuffle(stream, list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rand(stream) * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // A side stream for public draws (contracts, refits), so showing them never
  // shifts the dice that decide what is behind the doors.
  const sideStream = (state, label) => ({ rng: hashSeed(`${state.seed}|${label}`) });

  function randomSeed() {
    const word = SEED_WORDS[Math.floor(Math.random() * SEED_WORDS.length)];
    return `${word}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
  }

  // ---------- Parameters ----------

  function normalizeParams(input) {
    const p = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
    if (!input || typeof input !== 'object') return p;
    for (const field of PARAM_FIELDS) {
      const value = input[field.key];
      if (value === undefined || value === null) continue;
      if (field.type === 'int' || field.type === 'tier') {
        const n = Math.round(Number(value));
        if (Number.isFinite(n)) p[field.key] = field.type === 'tier' ? clamp(n, 0, RAINBOW - 1) : clamp(n, field.min, field.max);
      } else if (field.type === 'bool') {
        p[field.key] = !!value;
      } else if (field.type === 'list') {
        if (Array.isArray(value) && value.length === field.names.length) {
          const list = value.map((x) => clamp(Math.round(Number(x)) || 0, 0, 1000));
          if (list.some((x) => x > 0)) p[field.key] = list;
        }
      }
    }
    return p;
  }

  // ---------- State helpers ----------

  function log(state, kind, text) {
    state.log.push({ d: state.day, k: kind, t: text });
  }

  // Inserts an entry earlier in the log, so a summary line can come before the
  // side effects that were logged while it resolved.
  function logAt(state, index, kind, text) {
    state.log.splice(index, 0, { d: state.day, k: kind, t: text });
  }

  function trimLog(state) {
    if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
  }

  function makeInmate(state, beast, tier) {
    return { id: state.nextId++, beast, tier: clamp(tier, 0, RAINBOW) };
  }

  function rollInmate(state, weights) {
    const tier = pickIndex(state, weights || state.params.tierWeights);
    const beast = BEASTS[pickIndex(state, state.params.beastWeights)];
    return makeInmate(state, beast, tier);
  }

  const boardCells = (state) => state.cells.filter((c) => !c.sealed && c.inmate);
  const boardInmates = (state) => boardCells(state).map((c) => c.inmate);
  const cellOf = (state, id) => state.cells.find((c) => c.inmate && c.inmate.id === id) || null;

  function boardCellOf(state, id) {
    const cell = cellOf(state, id);
    return cell && !cell.sealed ? cell : null;
  }

  const linkOf = (state, id) => state.prey.find((l) => l.lion === id || l.prey === id) || null;

  // The occupant behind a sealed door is rolled the first time anyone looks.
  function hiddenOf(state, cell) {
    if (!cell.hidden) cell.hidden = rollInmate(state);
    return cell.hidden;
  }

  function canEat(state, eater, meal) {
    if (!eater || !meal || eater.id === meal.id || eater.tier !== meal.tier || eater.tier >= RAINBOW) return false;
    return BEAST_INFO[eater.beast].eats.includes(meal.beast) || (eater.beast === 'rat' && meal.beast === 'rat' && has(state, 'skewer'));
  }

  function limits(state) {
    return { scout: state.mode === 'challenge' ? 1 : state.params.scoutsPerDay, swap: state.params.swapsPerDay };
  }

  // Ends every prey mark that is no longer valid and logs why.
  function checkPrey(state) {
    state.prey = state.prey.filter((link) => {
      const lion = boardCellOf(state, link.lion);
      const prey = boardCellOf(state, link.prey);
      const valid = lion && prey && lion.inmate.beast === 'lion' && prey.inmate.beast === link.preyBeast;
      if (!valid) log(state, 'prey', 'A prey mark ended: one side left the block or changed beast.');
      return valid;
    });
  }

  // Empties a cell. With reusable cells it seals again and will hold someone
  // new the next time it opens.
  function emptyCell(state, cell) {
    const inmate = cell.inmate;
    cell.inmate = null;
    cell.hidden = null;
    cell.known = 0;
    cell.scratch = false;
    cell.nest = null;
    cell.ivory = false;
    cell.sealed = !!state.params.reusableCells;
    return inmate;
  }

  // Applies rewards for growth: the challenge's Supreme milestone, and the
  // vault for anyone who reaches Rainbow.
  function afterGrowth(state, inmate, events) {
    state.stats.best = Math.max(state.stats.best, inmate.tier);
    if (state.mode === 'challenge' && !state.milestone && inmate.tier >= SUPREME) {
      state.milestone = true;
      const options = shuffle(state, TOOL_IDS.filter((t) => !has(state, t))).slice(0, 3);
      if (options.length) {
        state.pending.push({ kind: 'tool', options });
        log(state, 'tool', `Milestone: a ${describe(inmate)}! Choose a tool.`);
      }
    }
    if (inmate.tier < RAINBOW) return;
    const cell = cellOf(state, inmate.id);
    if (!cell) return;
    emptyCell(state, cell);
    state.vault.push({ id: inmate.id, beast: inmate.beast, day: state.day });
    state.cache += 1;
    log(state, 'rainbow', `Rainbow ${beastName(inmate.beast)}! It left cell ${cellLabel(cell.n)} for the vault. Warden's Cache claims: ${state.cache}.`);
    events.push({ type: 'rainbow', cell: cell.n });
    if (state.mode === 'challenge') state.pending.push({ kind: 'gift', options: GIFT_IDS.slice() });
  }

  function reroll(state, inmate) {
    const before = inmate.beast;
    inmate.beast = BEASTS[pickIndex(state, state.params.beastWeights)];
    return inmate.beast !== before;
  }

  function promote(state, inmate, by, rerollBeast, events) {
    const from = inmate.tier;
    inmate.tier = clamp(inmate.tier + by, 0, RAINBOW);
    const cell = cellOf(state, inmate.id);
    events.push({ type: 'promote', cell: cell ? cell.n : null, from, to: inmate.tier });
    if (rerollBeast && inmate.tier < RAINBOW) reroll(state, inmate);
    afterGrowth(state, inmate, events);
  }

  // Opens a sealed cell. A patrol opening returns the special event behind
  // the door; any other opening uses up the event without triggering it.
  function openCell(state, cell, how, events, forced) {
    if (!cell.sealed) return null;
    const event = cell.event;
    const inmate = forced ? makeInmate(state, forced.beast, forced.tier) : cell.hidden || rollInmate(state);
    const lostNest = !!cell.nest && !forced;
    cell.sealed = false;
    cell.inmate = inmate;
    cell.hidden = null;
    cell.known = 0;
    cell.scratch = false;
    cell.nest = null;
    cell.event = null;
    state.stats.opened += 1;
    events.push({ type: 'open', cell: cell.n });
    const extra = how === 'patrol' ? '' : ' (extra door)';
    log(state, 'patrol', `Opened cell ${cellLabel(cell.n)}${extra}: ${describe(inmate)}.${lostNest ? ' The rat nest inside was destroyed.' : ''}`);
    if (event && how !== 'patrol') log(state, 'event', `The special event behind cell ${cellLabel(cell.n)} was used up without triggering.`);
    afterGrowth(state, inmate, events);
    if (how === 'patrol' && has(state, 'keys') && rand(state) < 0.8) {
      log(state, 'tool', 'Lost Key Ring: the cells on both sides swing open too.');
      for (const step of [-1, 1]) {
        const k = cell.n + step;
        const n = state.params.circularNeighbors ? (k + CELL_COUNT) % CELL_COUNT : k;
        if (n >= 0 && n < CELL_COUNT) openCell(state, state.cells[n], 'side', events);
      }
    }
    return how === 'patrol' ? event : null;
  }

  function guard(state, need) {
    if (state.phase === 'ended') return fail('This run is over. Start a new run to keep playing.');
    if (state.pending.length) return fail('Make your pending choice first.');
    if (state.challenge && state.challenge.window) return fail('Finish the delivery window first.');
    if (state.phase === 'event') return fail('Decide on the special event first.');
    if (need === 'manage' && state.phase === 'patrol') return fail('Patrol first: walk to one of today’s destinations.');
    if (need === 'patrol' && state.phase !== 'patrol') return fail('Today’s patrol is done.');
    return null;
  }

  // ---------- Setup ----------

  function blankCell(n) {
    return { n, sealed: true, inmate: null, hidden: null, known: 0, scratch: false, nest: null, event: null, ivory: false };
  }

  function newGame(options) {
    const opts = options || {};
    const mode = opts.mode === 'challenge' ? 'challenge' : 'drill';
    const scenario = mode === 'drill' && SCENARIOS[opts.scenario] ? opts.scenario : 'empty';
    const loadout = mode === 'challenge' ? (LOADOUTS[opts.loadout] ? opts.loadout : 'supply') : null;
    const params = mode === 'challenge' ? JSON.parse(JSON.stringify(CHALLENGE_PARAMS)) : normalizeParams(opts.params);
    const seed = String(opts.seed || '').trim().toUpperCase().slice(0, 40) || randomSeed();
    const state = {
      v: VERSION,
      mode,
      scenario: mode === 'drill' ? scenario : null,
      loadout,
      seed,
      rng: hashSeed([seed, mode, scenario, loadout].join('|')),
      params,
      day: 1,
      maxDays: mode === 'challenge' ? CHALLENGE_DAYS : params.drillDays,
      phase: 'patrol',
      position: 0,
      destinations: [],
      chain: false,
      event: null,
      cells: Array.from({ length: CELL_COUNT }, (_, n) => blankCell(n)),
      vault: [],
      cache: 0,
      tools: [],
      pending: [],
      milestone: false,
      used: freshDay(),
      prey: [],
      nextId: 1,
      log: [],
      stats: { patrols: 0, opened: 0, scouts: 0, devours: 0, swaps: 0, executions: 0, best: 0 },
      challenge: null,
      result: null,
    };
    for (const cell of state.cells) if (rand(state) * 100 < params.eventChance) cell.event = rand(state) < 0.5 ? 'chain' : 'execution';
    log(state, 'day', `Day 1 of ${state.maxDays}.`);
    if (mode === 'challenge') setupChallenge(state);
    else setupDrill(state);
    return state;
  }

  function place(state, n, beast, tier) {
    const cell = state.cells[n];
    Object.assign(cell, blankCell(n), { sealed: false, inmate: makeInmate(state, beast, tier) });
    state.stats.best = Math.max(state.stats.best, tier);
    return cell.inmate;
  }

  function hide(state, n, beast, tier, extra) {
    const cell = state.cells[n];
    Object.assign(cell, blankCell(n), { hidden: makeInmate(state, beast, tier) }, extra || {});
    return cell;
  }

  function setupDrill(state) {
    const s = state.scenario;
    let note = 'All 16 doors are sealed. Pick one of today’s destinations to meet your first inmate.';
    let destinations = null;
    if (s === 'events') {
      place(state, 0, 'mammoth', 1);
      place(state, 4, 'wolf', 1);
      place(state, 5, 'mammoth', 0);
      place(state, 6, 'rat', 1);
      place(state, 13, 'lion', 2);
      hide(state, 2, 'lion', 2, { event: 'execution', known: 1 });
      hide(state, 9, 'mammoth', 1, { event: 'chain' });
      hide(state, 11, 'wolf', 0);
      destinations = [2, 9, 11];
      note = 'Special events drill: cell 03 hides an Execution behind a Rare inmate, and cell 10 hides a Chain reaction. Patrol one, then accept or skip the event.';
    } else if (s === 'ivory') {
      place(state, 0, 'wolf', 1);
      state.cells[0].ivory = true;
      place(state, 1, 'lion', 2);
      place(state, 2, 'mammoth', 0);
      place(state, 6, 'wolf', 2);
      place(state, 11, 'mammoth', 3);
      place(state, 15, 'rat', 1);
      note = `Ivory drill: cell 01 carries Ivory. Swap its inmate and ${plural(state.params.ivoryCount, 'inmate')} on the block each gain a tier.`;
    } else if (s === 'prey') {
      const lion = place(state, 0, 'lion', 2);
      const rat = place(state, 1, 'rat', 2);
      place(state, 4, 'wolf', 2);
      place(state, 8, 'mammoth', 1);
      place(state, 12, 'rat', 1);
      state.prey.push({ lion: lion.id, prey: rat.id, preyBeast: 'rat', rounds: state.params.preyRounds, next: 2 });
      note = `Prey drill: the Lion in cell 01 has marked the Rat in cell 02. Each morning both rise a tier, for ${plural(state.params.preyRounds, 'morning')}. A devour by either one re-rolls its beast and ends the mark.`;
    } else if (s === 'scratch') {
      place(state, 0, 'wolf', 1);
      hide(state, 1, 'mammoth', 1, { scratch: true, known: 1 });
      place(state, 7, 'wolf', 2);
      hide(state, 8, 'lion', 2, { scratch: true, known: 1 });
      place(state, 13, 'rat', 0);
      note = 'Scratch drill: a scratched door shows the rarity inside. A Wolf can devour a same-rarity inmate through it, whatever its beast, and gains +3.';
    } else if (s === 'nest') {
      place(state, 0, 'lion', 2);
      hide(state, 1, 'rat', 0, { nest: { due: 1 + state.params.nestDays } });
      place(state, 4, 'mammoth', 2);
      place(state, 10, 'wolf', 1);
      place(state, 14, 'rat', 0);
      note = `Rat nest drill: the nest in cell 02 hatches a ${tierName(state.params.nestTier)} Rat on the morning of day ${1 + state.params.nestDays}. Patrolling it before then destroys it.`;
    }
    for (const cell of state.cells) if (!cell.sealed) cell.event = null;
    beginDay(state, []);
    if (destinations) state.destinations = destinations;
    // Marker drills open after the day-1 patrol, except the events drill,
    // which is about the patrol itself.
    if (s !== 'empty' && s !== 'events') state.phase = 'manage';
    log(state, 'drill', note);
  }

  function setupChallenge(state) {
    const kit = LOADOUTS[state.loadout];
    kit.inmates.forEach(([beast, tier], i) => place(state, START_CELLS[i], beast, tier));
    for (const cell of state.cells) if (!cell.sealed) cell.event = null;
    state.tools = kit.tools.slice();
    state.challenge = {
      vouchers: START_VOUCHERS,
      score: 0,
      contracts: makeContracts(state),
      deliveries: [],
      window: null,
      scoutedDay: 0,
      intel: null,
    };
    beginDay(state, []);
    log(state, 'drill', `${kit.name}: ${plural(kit.inmates.length, 'inmate')} on the block. Deliver at least two contracts, including the heavy one, to pass.`);
  }

  function makeContracts(state) {
    const stream = sideStream(state, 'contracts');
    return CONTRACT_SLOTS.map((slot, i) => {
      const v = pickOne(stream, slot.variants);
      const contract = { slot: i, id: v.id, name: v.name, needs: v.needs.slice(), deadline: slot.deadline, heavy: !!slot.heavy };
      if (v.id === 'bounty') {
        contract.bounty = pickOne(stream, BEASTS);
        contract.needs = ['At least 1 Supreme or Rainbow', `+8 points per Supreme or Rainbow ${beastName(contract.bounty)}`];
      }
      return contract;
    });
  }

  // ---------- Day flow ----------

  function destinationLimit(state) {
    return Math.max(1, state.params.destinations - (has(state, 'fire') ? 1 : 0));
  }

  function rollDestinations(state) {
    const sealed = state.cells.filter((c) => c.sealed);
    const pool = sealed.length ? sealed : state.cells;
    const count = destinationLimit(state);
    state.destinations = shuffle(state, pool).slice(0, count).map((c) => c.n);
    fitDestinations(state);
  }

  // In the challenge, one option is always the nearest open cell clockwise
  // from the warden, so a small block can stay small.
  function fitDestinations(state) {
    if (state.phase !== 'patrol') return;
    const limit = destinationLimit(state);
    const sealed = state.destinations.filter((n) => state.cells[n].sealed);
    const open = state.cells.filter((c) => !c.sealed).sort((a, b) => stepsBetween(state.position, a.n) - stepsBetween(state.position, b.n))[0];
    if (state.mode === 'challenge' && sealed.length && open) state.destinations = [...sealed.slice(0, Math.max(1, limit - 1)), open.n];
    else state.destinations = state.destinations.slice(0, limit);
  }

  function beginDay(state, events) {
    state.phase = 'patrol';
    state.used = freshDay();
    if (state.challenge) state.challenge.intel = null;
    checkPrey(state);
    for (const link of state.prey.slice()) {
      if (link.next > state.day) continue;
      const lion = boardCellOf(state, link.lion).inmate;
      const prey = boardCellOf(state, link.prey).inmate;
      link.rounds -= 1;
      link.next = state.day + 1;
      log(state, 'prey', `Prey mark: the Lion and its prey each rise a tier (${describe(lion)} to ${tierName(Math.min(RAINBOW, lion.tier + 1))}, ${describe(prey)} to ${tierName(Math.min(RAINBOW, prey.tier + 1))}).${link.rounds > 0 ? ` ${plural(link.rounds, 'morning')} left.` : ' The mark is spent.'}`);
      if (link.rounds <= 0) state.prey = state.prey.filter((l) => l !== link);
      promote(state, lion, 1, false, events);
      promote(state, prey, 1, false, events);
    }
    checkPrey(state);
    for (const cell of state.cells) {
      if (!cell.nest || cell.nest.due > state.day) continue;
      log(state, 'nest', `The rat nest in cell ${cellLabel(cell.n)} hatched.`);
      openCell(state, cell, 'side', events, { beast: 'rat', tier: state.params.nestTier });
      events.push({ type: 'hatch', cell: cell.n });
    }
    if (has(state, 'ironbox')) {
      const free = state.cells.filter((c) => c.sealed && !c.nest);
      if (free.length) {
        const cell = pickOne(state, free);
        cell.nest = { due: state.day + state.params.nestDays };
        log(state, 'nest', `Writhing Iron Box: cell ${cellLabel(cell.n)} is now a rat nest. It hatches on day ${cell.nest.due}.`);
        events.push({ type: 'nest', cell: cell.n });
      }
    }
    rollDestinations(state);
  }

  // ---------- Queries ----------

  function clockwisePath(state, to) {
    const path = [];
    let n = state.position;
    while (n !== to) {
      n = (n + 1) % CELL_COUNT;
      path.push(n);
    }
    return path.length ? path : [to];
  }

  function patrolOptions(state) {
    if (state.phase !== 'patrol') return [];
    const intel = state.challenge && state.challenge.intel;
    return state.destinations.filter((n) => intel === null || intel === undefined || n === intel || !state.cells[n].sealed);
  }

  function canScout(state, cell) {
    if (!cell || !cell.sealed || state.phase !== 'patrol') return false;
    if (state.mode === 'challenge') {
      const ch = state.challenge;
      return ch.scoutedDay !== state.day && ch.vouchers >= 1 && ch.intel === null && state.destinations.includes(cell.n);
    }
    return !cell.nest && !cell.known && state.used.scout < state.params.scoutsPerDay;
  }

  function devourOptions(state, n) {
    const cell = state.cells[n];
    if (!cell || cell.sealed || !cell.inmate) return [];
    const eater = cell.inmate;
    const out = [];
    for (const c of state.cells) {
      if (c === cell) continue;
      if (!c.sealed && canEat(state, eater, c.inmate)) out.push({ cell: c.n, scratch: false });
      else if (c.sealed && c.scratch && eater.beast === 'wolf' && c.hidden && c.hidden.tier === eater.tier && eater.tier < RAINBOW) out.push({ cell: c.n, scratch: true });
    }
    return out;
  }

  // The sure part of a devour's gain; Rusty Saw and Avenger's Box roll later.
  function gainFor(state, from, option) {
    const eater = state.cells[from].inmate;
    let gain = option.scratch ? 2 + (state.params.scratchStacksBase ? 1 : 0) : 1;
    const notes = [];
    if (option.scratch) notes.push(`scratch +${gain - 1}`);
    if (has(state, 'muzzle') && boardCells(state).length <= 3) {
      gain += 2;
      notes.push('Agony Muzzle +2');
    }
    if (has(state, 'skewer') && eater && eater.beast === 'rat') {
      gain += 1;
      notes.push('Rat-Head Skewer +1');
    }
    return { gain, notes, saw: has(state, 'saw'), revenge: has(state, 'revenge') };
  }

  function executionVictims(state, n) {
    const cell = state.cells[n];
    const exec = cell && !cell.sealed ? cell.inmate : null;
    if (!exec) return [];
    const eats = BEAST_INFO[exec.beast].eats;
    return boardCells(state).filter((c) => c !== cell && eats.includes(c.inmate.beast) && (state.params.executionSameTier ? c.inmate.tier === exec.tier : c.inmate.tier < exec.tier));
  }

  function rosterOf(state) {
    const rows = [];
    for (const c of state.cells) if (!c.sealed && c.inmate) rows.push({ beast: c.inmate.beast, tier: c.inmate.tier, where: `Cell ${cellLabel(c.n)}` });
    for (const v of state.vault) rows.push({ beast: v.beast, tier: RAINBOW, where: `Vault, day ${v.day}` });
    rows.sort((a, b) => b.tier - a.tier || BEASTS.indexOf(a.beast) - BEASTS.indexOf(b.beast));
    return { rows, byTier: TIERS.map((_, t) => rows.filter((r) => r.tier === t).length) };
  }

  const toolText = (id) => (TOOLS[id] ? TOOLS[id].text : GIFTS[id] ? GIFTS[id].text : '');
  const toolName = (id) => (TOOLS[id] ? TOOLS[id].name : GIFTS[id] ? GIFTS[id].name : id);

  // ---------- Actions ----------

  function patrol(state, n) {
    const blocked = guard(state, 'patrol');
    if (blocked) return blocked;
    if (!state.destinations.includes(n)) return fail('Patrol one of today’s destinations.');
    if (!patrolOptions(state).includes(n)) return fail(`You scouted cell ${cellLabel(state.challenge.intel)}, so today you can only go there or to an open cell.`);
    const events = [{ type: 'move', from: state.position, to: n }];
    const cell = state.cells[n];
    state.stats.patrols += 1;
    let event = null;
    if (state.chain) {
      const path = clockwisePath(state, n);
      log(state, 'event', `Chain reaction: walking clockwise from cell ${cellLabel(state.position)} to cell ${cellLabel(n)} opens every sealed door on the way.`);
      for (const k of path) openCell(state, state.cells[k], 'side', events);
      state.chain = false;
    } else if (cell.sealed) {
      event = openCell(state, cell, 'patrol', events);
    } else {
      log(state, 'patrol', `Walked to open cell ${cellLabel(n)}. No door opened.`);
    }
    state.position = n;
    if (state.challenge) state.challenge.intel = null;
    checkPrey(state);
    if (event && state.cells[n].inmate) {
      state.phase = 'event';
      state.event = { kind: event, cell: n };
      log(state, 'event', `Cell ${cellLabel(n)} held a special event: ${event === 'chain' ? 'Chain reaction' : 'Execution'}. Accept or skip it.`);
    } else {
      state.phase = 'manage';
    }
    return ok(events);
  }

  function resolveEvent(state, accept) {
    if (state.phase !== 'event' || !state.event) return fail('There is no special event to decide.');
    if (state.pending.length) return fail('Make your pending choice first.');
    const { kind, cell: n } = state.event;
    const events = [];
    if (!accept) {
      state.event = null;
      state.phase = 'manage';
      log(state, 'event', 'Skipped the special event.');
      return ok(events);
    }
    if (kind === 'chain') {
      state.chain = true;
      log(state, 'event', 'Chain reaction armed: your next patrol opens every sealed cell on the clockwise walk to its destination.');
    } else {
      const cell = state.cells[n];
      const exec = cell.inmate;
      if (!exec) return fail('Nobody is left in that cell to carry out the execution.');
      const victims = executionVictims(state, n);
      const at = state.log.length;
      const names = victims.map((c) => `${describe(c.inmate)} (${cellLabel(c.n)})`);
      for (const c of victims) {
        emptyCell(state, c);
        events.push({ type: 'devour', from: n, to: c.n });
      }
      state.stats.executions += 1;
      checkPrey(state);
      const before = describe(exec);
      if (victims.length) promote(state, exec, victims.length, state.params.executionRerolls, events);
      logAt(state, at, 'event', victims.length
        ? `Execution: the ${before} in cell ${cellLabel(n)} removed ${names.join(', ')} and rose ${victims.length} ${victims.length === 1 ? 'tier' : 'tiers'}.`
        : `Execution: the ${before} in cell ${cellLabel(n)} found nobody to execute.`);
    }
    state.event = null;
    state.phase = 'manage';
    return ok(events);
  }

  function scout(state, n) {
    const blocked = guard(state, 'patrol');
    if (blocked) return blocked;
    const cell = state.cells[n];
    if (state.mode === 'challenge') {
      const ch = state.challenge;
      if (ch.scoutedDay === state.day) return fail('You already scouted today.');
      if (ch.vouchers < 1) return fail('Scouting costs 1 dispatch voucher, and you have none left.');
      if (!cell || !cell.sealed || !state.destinations.includes(n)) return fail('Scout one of today’s sealed destinations.');
      const inmate = hiddenOf(state, cell);
      cell.known = 2;
      ch.vouchers -= 1;
      ch.scoutedDay = state.day;
      ch.intel = n;
      state.stats.scouts += 1;
      log(state, 'scout', `Scouted cell ${cellLabel(n)} for 1 voucher: a ${describe(inmate)}. Today you can only patrol there or to an open cell.`);
      return ok([{ type: 'scout', cell: n }]);
    }
    if (!cell || !cell.sealed || cell.nest || cell.known) return fail('Scout a sealed door whose rarity you have not seen yet.');
    if (state.used.scout >= state.params.scoutsPerDay) return fail('No scouts left today.');
    const inmate = hiddenOf(state, cell);
    cell.known = 1;
    state.used.scout += 1;
    state.stats.scouts += 1;
    log(state, 'scout', `Scouted cell ${cellLabel(n)}: a ${tierName(inmate.tier)} inmate waits inside. Its beast stays hidden.`);
    return ok([{ type: 'scout', cell: n }]);
  }

  // Resolves one devour without the phase checks, so gifts can reuse it.
  function doDevour(state, from, option, events) {
    const eaterCell = state.cells[from];
    const mealCell = state.cells[option.cell];
    const eater = eaterCell.inmate;
    const meal = mealCell.sealed ? mealCell.hidden : mealCell.inmate;
    const before = describe(eater);
    const wasRat = eater.beast === 'rat';
    const crowd = boardCells(state).length;
    const at = state.log.length;
    emptyCell(state, mealCell);
    let gain = option.scratch ? 2 + (state.params.scratchStacksBase ? 1 : 0) : 1;
    const notes = [];
    if (option.scratch) notes.push(`scratch +${gain - 1}`);
    if (has(state, 'muzzle') && crowd <= 3) {
      gain += 2;
      notes.push('Agony Muzzle +2');
    }
    if (has(state, 'skewer') && wasRat) {
      gain += 1;
      notes.push('Rat-Head Skewer +1');
    }
    if (has(state, 'saw') && rand(state) < 0.25) {
      gain += 1;
      notes.push('Rusty Saw +1');
    }
    const revenge = has(state, 'revenge') && rand(state) < 0.3;
    events.push({ type: 'devour', from, to: option.cell });
    promote(state, eater, gain, true, events);
    state.stats.devours += 1;
    const still = boardCellOf(state, eater.id);
    const outcome = eater.tier < RAINBOW ? ` and ${still ? `is now a ${beastName(eater.beast)}` : 'left'}` : '';
    logAt(state, at, 'devour', `The ${before} in cell ${cellLabel(from)} devoured the ${option.scratch ? 'scratched-door ' : ''}${describe(meal)} in cell ${cellLabel(option.cell)}. It rose to ${tierName(eater.tier)}${outcome}${notes.length ? ` (${notes.join(', ')})` : ''}.`);
    checkPrey(state);
    if (revenge && still) {
      const sealed = state.cells.filter((c) => c.sealed);
      if (sealed.length) {
        const target = pickOne(state, sealed);
        const food = pickOne(state, BEAST_INFO[eater.beast].eats);
        log(state, 'tool', `Avenger's Box: cell ${cellLabel(target.n)} opens with a meal for the ${describe(eater)}.`);
        openCell(state, target, 'side', events, { beast: food, tier: eater.tier });
      }
    }
  }

  function devour(state, from, to) {
    const blocked = guard(state, 'manage');
    if (blocked) return blocked;
    const option = devourOptions(state, from).find((o) => o.cell === to);
    if (!option) return fail('That inmate cannot devour that target.');
    const events = [];
    doDevour(state, from, option, events);
    return ok(events);
  }

  function swap(state, n) {
    const blocked = guard(state, 'manage');
    if (blocked) return blocked;
    const cell = state.cells[n];
    if (!cell || cell.sealed || !cell.inmate) return fail('Select an inmate on the block to swap.');
    if (state.used.swap >= state.params.swapsPerDay) return fail('No swaps left today.');
    const weights = state.params.tierWeights.slice();
    if (has(state, 'rope')) weights[0] = weights[1] = 0;
    if (!weights.some((w) => w > 0)) return fail('No rarity is left to roll. Adjust the rarity weights in the Lab.');
    const old = cell.inmate;
    const events = [{ type: 'swap', cell: n }];
    const at = state.log.length;
    cell.inmate = null;
    checkPrey(state);
    const fresh = rollInmate(state, weights);
    let fired = false;
    if (has(state, 'fire') && old.tier < 3 && rand(state) < 0.4) {
      fresh.tier = 3;
      fired = true;
    }
    cell.inmate = fresh;
    state.used.swap += 1;
    state.stats.swaps += 1;
    logAt(state, at, 'swap', `Swapped out the ${describe(old)} in cell ${cellLabel(n)}. In came a ${describe(fresh)}${fired ? ' (Burning Stake)' : ''}.`);
    afterGrowth(state, fresh, events);
    if (cell.ivory && boardCellOf(state, fresh.id)) {
      const pool = boardInmates(state).filter((i) => state.params.ivoryIncludesSwapped || i.id !== fresh.id);
      const picks = shuffle(state, pool).slice(0, state.params.ivoryCount);
      if (picks.length) {
        log(state, 'ivory', `Ivory: ${plural(picks.length, 'inmate')} each gain a tier (cells ${picks.map((i) => cellLabel(cellOf(state, i.id).n)).join(', ')}).`);
        for (const i of picks) if (boardCellOf(state, i.id)) promote(state, i, 1, false, events);
      }
    }
    return ok(events);
  }

  function endDay(state) {
    const blocked = guard(state, 'manage');
    if (blocked) return blocked;
    const ch = state.challenge;
    if (ch) {
      const contract = currentContract(state);
      if (contract && contract.deadline === state.day) {
        ch.window = { early: false };
        log(state, 'contract', `Delivery window: "${contract.name}" is due today. Deliver now or skip it.`);
        return ok([{ type: 'window' }]);
      }
    }
    const events = [];
    advanceDay(state, events);
    return ok(events);
  }

  function advanceDay(state, events) {
    if (state.day >= state.maxDays) {
      finish(state, false);
      events.push({ type: 'end' });
      return;
    }
    state.day += 1;
    log(state, 'day', `Day ${state.day} of ${state.maxDays}.`);
    beginDay(state, events);
    events.push({ type: 'day' });
  }

  function finish(state, early) {
    if (state.challenge) settleChallenge(state);
    state.phase = 'ended';
    state.destinations = [];
    state.event = null;
    state.chain = false;
    const roster = rosterOf(state);
    state.result = {
      day: state.day,
      early: !!early,
      roster,
      cache: state.cache,
      best: Math.max(state.stats.best, ...roster.rows.map((r) => r.tier), 0),
      stats: Object.assign({}, state.stats),
      challenge: state.challenge ? state.challenge.result : null,
    };
    log(state, 'end', early ? 'The run was closed early. The handoff roster is ready.' : 'The run is over. The handoff roster is ready.');
  }

  function endRun(state) {
    if (state.phase === 'ended') return fail('This run is already over.');
    if (state.challenge) state.challenge.window = null;
    state.pending = [];
    finish(state, true);
    return ok([{ type: 'end' }]);
  }

  // ---------- Contract challenge ----------

  function currentContract(state) {
    const ch = state.challenge;
    return ch ? ch.contracts[ch.deliveries.length] || null : null;
  }

  function qualifies(contract, cargo) {
    const beasts = new Set(cargo.map((p) => p.beast)).size;
    const elite = cargo.filter((p) => p.tier === 2 || p.tier === 3).length;
    switch (contract.id) {
      case 'mixed': return cargo.length >= 3 && beasts >= 2;
      case 'cohort': return cargo.length >= 4;
      case 'veteran': return elite >= 1 && cargo.filter((p) => p.tier <= 1).length >= 2;
      case 'elite': return elite >= 2 && beasts >= 2;
      case 'kin': return cargo.some((p) => p.tier === 3 && cargo.some((q) => q !== p && q.beast === p.beast && q.tier < 3));
      case 'muster': return elite >= 3;
      default: return cargo.some((p) => p.tier >= SUPREME);
    }
  }

  const cargoPoints = (cargo) => cargo.reduce((sum, p) => sum + 2 ** p.tier, 0);
  const cargoBonus = (contract, cargo) => (contract.bounty ? cargo.filter((p) => p.tier >= SUPREME && p.beast === contract.bounty).length * 8 : 0);

  function cargoOf(state, cellNumbers, vaultIds) {
    const cargo = [];
    for (const n of new Set(cellNumbers || [])) {
      const c = state.cells[n];
      if (!c || c.sealed || !c.inmate) return null;
      cargo.push(c.inmate);
    }
    for (const id of new Set(vaultIds || [])) {
      const v = state.vault.find((x) => x.id === id);
      if (!v) return null;
      cargo.push({ id: v.id, beast: v.beast, tier: RAINBOW });
    }
    return cargo;
  }

  function deliveryCheck(state, cellNumbers, vaultIds, escortKey) {
    const ch = state.challenge;
    const contract = currentContract(state);
    const base = { ok: false, reason: '', pressure: 0, cost: 0, points: 0, bonus: 0, contract };
    if (!ch || !ch.window || !contract) return Object.assign(base, { reason: 'No delivery window is open.' });
    const cargo = cargoOf(state, cellNumbers, vaultIds);
    if (!cargo) return Object.assign(base, { reason: 'Some of those inmates are no longer available.' });
    if (!cargo.length) return Object.assign(base, { reason: 'Pick the inmates to send.' });
    const escort = ESCORTS[escortKey];
    if (!escort) return Object.assign(base, { reason: 'Choose an escort.' });
    const pressure = cargo.reduce((sum, p) => sum + PRESSURE[p.tier], 0);
    const bonus = cargoBonus(contract, cargo);
    const result = Object.assign(base, { pressure, cost: escort.cost, points: cargoPoints(cargo) + bonus, bonus });
    if (!qualifies(contract, cargo)) return Object.assign(result, { reason: `This cargo does not meet "${contract.name}": ${contract.needs.join('; ').toLowerCase()}.` });
    if (pressure > escort.cap) return Object.assign(result, { reason: `Pressure ${pressure} is over the ${escort.name.toLowerCase()} limit of ${escort.cap}.` });
    if (ch.vouchers < escort.cost) return Object.assign(result, { reason: `A ${escort.name.toLowerCase()} costs ${plural(escort.cost, 'voucher')}. You have ${ch.vouchers}.` });
    return Object.assign(result, { ok: true, reason: `Meets "${contract.name}".` });
  }

  function afterDelivery(state, events) {
    const ch = state.challenge;
    const early = ch.window && ch.window.early;
    ch.window = null;
    if (state.day >= CHALLENGE_DAYS || early) {
      finish(state, false);
      events.push({ type: 'end' });
      return;
    }
    advanceDay(state, events);
  }

  function deliver(state, cellNumbers, vaultIds, escortKey) {
    if (state.mode !== 'challenge') return fail('Contracts only exist in the contract challenge.');
    if (state.phase === 'ended') return fail('This run is over.');
    const check = deliveryCheck(state, cellNumbers, vaultIds, escortKey);
    if (!check.ok) return fail(check.reason);
    const ch = state.challenge;
    const contract = check.contract;
    const cargo = cargoOf(state, cellNumbers, vaultIds);
    const names = cargo.map(describe);
    const events = [{ type: 'deliver', cells: [...new Set(cellNumbers || [])] }];
    for (const n of new Set(cellNumbers || [])) emptyCell(state, state.cells[n]);
    state.vault = state.vault.filter((v) => !(vaultIds || []).includes(v.id));
    checkPrey(state);
    ch.vouchers -= check.cost;
    ch.score += check.points;
    ch.deliveries.push({ slot: contract.slot, day: state.day, success: true, points: check.points, cost: check.cost, pressure: check.pressure, escort: escortKey, names, early: !!ch.window.early });
    log(state, 'contract', `Delivered "${contract.name}" by ${ESCORTS[escortKey].name.toLowerCase()} (${plural(check.cost, 'voucher')}, pressure ${check.pressure}, ${check.points} points): ${names.join(', ')}.`);
    afterDelivery(state, events);
    if (state.phase !== 'ended' && ch.deliveries.length <= 2) queueRefit(state, contract.slot);
    return ok(events);
  }

  function skipDelivery(state) {
    const ch = state.challenge;
    if (!ch || !ch.window) return fail('No delivery window is open.');
    if (ch.window.early) return fail('Close the early window instead. The heavy contract can still be delivered by day 12.');
    const contract = currentContract(state);
    ch.deliveries.push({ slot: contract.slot, day: state.day, success: false, points: 0, cost: 0, pressure: 0, escort: null, names: [], early: false });
    log(state, 'contract', `Skipped "${contract.name}". Your inmates and vouchers stay put.`);
    const events = [];
    afterDelivery(state, events);
    return ok(events);
  }

  function canOpenEarly(state) {
    const ch = state.challenge;
    return !!ch && !ch.window && state.phase !== 'ended' && ch.deliveries.length === 2 && state.day >= 9 && state.day <= CHALLENGE_DAYS && ['patrol', 'manage'].includes(state.phase) && !state.pending.length && !state.event;
  }

  function openEarlyDelivery(state) {
    if (!canOpenEarly(state)) return fail('From day 9, once the first two contracts are settled, you can open the heavy delivery early.');
    state.challenge.window = { early: true };
    log(state, 'contract', 'Opened the heavy delivery window early. Delivering now ends the run.');
    return ok([{ type: 'window' }]);
  }

  function cancelEarlyDelivery(state) {
    const ch = state.challenge;
    if (!ch || !ch.window || !ch.window.early) return fail('There is no early window to close.');
    ch.window = null;
    log(state, 'contract', 'Closed the early delivery window.');
    return ok([]);
  }

  function settleChallenge(state) {
    const ch = state.challenge;
    if (ch.result) return;
    while (ch.deliveries.length < 3) {
      const c = ch.contracts[ch.deliveries.length];
      ch.deliveries.push({ slot: c.slot, day: state.day, success: false, points: 0, cost: 0, pressure: 0, escort: null, names: [], early: false });
    }
    const completed = ch.deliveries.filter((d) => d.success).length;
    const heavy = ch.deliveries.some((d) => d.slot === 2 && d.success);
    const passed = completed >= 2 && heavy;
    ch.result = { passed, grade: completed === 3 ? 'full' : passed ? 'passed' : 'failed', completed, score: ch.score, vouchers: ch.vouchers };
  }

  function refitOptions(state, slot, refreshed) {
    const available = TOOL_IDS.filter((t) => !has(state, t));
    const first = shuffle(sideStream(state, `refit|${slot}|0`), available).slice(0, 3);
    if (!refreshed) return first;
    const order = shuffle(sideStream(state, `refit|${slot}|1`), available);
    return [...order.filter((id) => !first.includes(id)), ...order.filter((id) => first.includes(id))].slice(0, 3);
  }

  function queueRefit(state, slot) {
    const options = refitOptions(state, slot, false);
    if (!options.length) {
      log(state, 'tool', 'Refit: you already hold every tool.');
      return;
    }
    state.pending.unshift({ kind: 'refit', slot, options, refreshed: false });
    log(state, 'tool', 'Refit: choose a tool for the rest of the run.');
  }

  function choose(state, id) {
    const choice = state.pending[0];
    if (!choice) return fail('There is nothing to choose right now.');
    if (!choice.options.includes(id)) return fail('That option is not on offer.');
    state.pending.shift();
    const events = [{ type: 'tool' }];
    if (choice.kind === 'gift') applyGift(state, id, events);
    else {
      state.tools.push(id);
      log(state, 'tool', `Took the ${TOOLS[id].name}.`);
      if (state.phase === 'patrol') fitDestinations(state);
    }
    return ok(events);
  }

  function canRefresh(state) {
    const choice = state.pending[0];
    if (!choice || choice.kind !== 'refit' || choice.refreshed || state.challenge.vouchers < 1) return false;
    return TOOL_IDS.filter((t) => !has(state, t)).length > choice.options.length;
  }

  function refreshRefit(state) {
    if (!canRefresh(state)) return fail('This refit cannot be refreshed: it needs 1 voucher, works once, and only when unseen tools remain.');
    const choice = state.pending[0];
    state.challenge.vouchers -= 1;
    choice.options = refitOptions(state, choice.slot, true);
    choice.refreshed = true;
    log(state, 'tool', 'Refreshed the refit offer for 1 voucher.');
    return ok([]);
  }

  function applyGift(state, id, events) {
    log(state, 'tool', `Warden's Cache: ${GIFTS[id].name}.`);
    if (id === 'ring') {
      for (const c of shuffle(state, state.cells.filter((x) => x.sealed)).slice(0, 3)) openCell(state, c, 'side', events);
    } else if (id === 'horn') {
      for (const inmateId of boardInmates(state).filter((i) => devourOptions(state, cellOf(state, i.id).n).length).map((i) => i.id)) {
        const cell = boardCellOf(state, inmateId);
        if (!cell) continue;
        const options = devourOptions(state, cell.n).filter((o) => !o.scratch);
        if (options.length) doDevour(state, cell.n, pickOne(state, options), events);
      }
    } else if (id === 'wine') {
      for (const i of boardInmates(state).filter((x) => x.tier < 3)) if (boardCellOf(state, i.id)) promote(state, i, 1, false, events);
    } else if (id === 'brand') {
      const hungry = shuffle(state, boardInmates(state).filter((i) => !devourOptions(state, cellOf(state, i.id).n).length)).slice(0, 4);
      for (const i of hungry) {
        const cell = boardCellOf(state, i.id);
        if (!cell || devourOptions(state, cell.n).length) continue;
        const possible = BEASTS.filter((b) => boardInmates(state).some((o) => canEat(state, { id: i.id, beast: b, tier: i.tier }, o)));
        if (possible.length) {
          i.beast = pickOne(state, possible);
          log(state, 'tool', `Brand of Sin: cell ${cellLabel(cell.n)} is now a ${describe(i)}.`);
        }
      }
      checkPrey(state);
    }
  }

  // ---------- Lab (drills only) ----------

  function labCheck(state) {
    if (state.mode !== 'drill') return fail('The Lab only edits drills. The contract challenge uses fixed rules.');
    if (state.phase === 'ended') return fail('This run is over.');
    if (state.phase === 'event' || state.pending.length) return fail('Finish the current decision first.');
    return null;
  }

  function editCell(state, n, spec) {
    const blocked = labCheck(state);
    if (blocked) return blocked;
    const cell = state.cells[n];
    if (!cell) return fail('Pick a cell to edit.');
    Object.assign(cell, blankCell(n));
    const beast = BEASTS.includes(spec.beast) ? spec.beast : 'mammoth';
    const tier = clamp(Math.round(Number(spec.tier)) || 0, 0, RAINBOW - 1);
    const event = spec.event === 'chain' || spec.event === 'execution' ? spec.event : null;
    let what;
    if (spec.kind === 'open') {
      cell.sealed = false;
      cell.inmate = makeInmate(state, beast, tier);
      cell.ivory = !!spec.ivory;
      state.stats.best = Math.max(state.stats.best, tier);
      what = `an open cell with a ${describe(cell.inmate)}${cell.ivory ? ' and Ivory' : ''}`;
    } else if (spec.kind === 'empty') {
      cell.sealed = false;
      what = 'an empty open cell';
    } else if (spec.kind === 'nest') {
      cell.nest = { due: state.day + state.params.nestDays };
      what = `a rat nest that hatches on day ${cell.nest.due}`;
    } else if (spec.kind === 'hidden') {
      cell.hidden = makeInmate(state, beast, tier);
      cell.scratch = !!spec.scratch;
      cell.known = cell.scratch ? 1 : 0;
      cell.event = event;
      what = `a sealed door hiding a ${describe(cell.hidden)}${cell.scratch ? ', scratched' : ''}`;
    } else {
      cell.event = event;
      what = 'a sealed door with an unknown occupant';
    }
    if (event && cell.sealed && !cell.nest) what += `, with a ${event === 'chain' ? 'Chain reaction' : 'Execution'} event`;
    checkPrey(state);
    if (state.phase === 'patrol') state.destinations = state.destinations.filter((d) => state.cells[d].sealed || state.mode === 'challenge');
    if (state.phase === 'patrol' && !state.destinations.length) rollDestinations(state);
    log(state, 'lab', `Scene editor: cell ${cellLabel(n)} is now ${what}.`);
    return ok([]);
  }

  function markPrey(state, lionCell, targetCell) {
    const blocked = labCheck(state);
    if (blocked) return blocked;
    const a = state.cells[lionCell];
    const b = state.cells[targetCell];
    if (!a || a.sealed || !a.inmate || a.inmate.beast !== 'lion') return fail('Pick an open cell with a Lion.');
    if (!b || b.sealed || !b.inmate || !canEat(state, a.inmate, b.inmate)) return fail('The prey must be a same-rarity inmate the Lion can eat.');
    if (linkOf(state, a.inmate.id) || linkOf(state, b.inmate.id)) return fail('One of them already has a prey mark.');
    state.prey.push({ lion: a.inmate.id, prey: b.inmate.id, preyBeast: b.inmate.beast, rounds: state.params.preyRounds, next: state.day + 1 });
    log(state, 'lab', `Scene editor: the Lion in cell ${cellLabel(lionCell)} marked the ${describe(b.inmate)} in cell ${cellLabel(targetCell)} as prey.`);
    return ok([]);
  }

  function moveWarden(state, n) {
    const blocked = labCheck(state);
    if (blocked) return blocked;
    if (n < 0 || n >= CELL_COUNT) return fail('Pick a cell.');
    state.position = n;
    log(state, 'lab', `Scene editor: the warden now stands at cell ${cellLabel(n)}.`);
    return ok([]);
  }

  function addTool(state, id) {
    const blocked = labCheck(state);
    if (blocked) return blocked;
    if (!TOOLS[id]) return fail('Unknown tool.');
    if (has(state, id)) return fail('You already hold that tool.');
    state.tools.push(id);
    log(state, 'lab', `Scene editor: added the ${TOOLS[id].name}.`);
    return ok([]);
  }

  function removeTool(state, id) {
    const blocked = labCheck(state);
    if (blocked) return blocked;
    if (!has(state, id)) return fail('You do not hold that tool.');
    state.tools = state.tools.filter((t) => t !== id);
    log(state, 'lab', `Scene editor: removed the ${TOOLS[id].name}.`);
    return ok([]);
  }

  // ---------- Advisor ----------

  function choiceScore(state, id) {
    const board = boardInmates(state);
    const small = board.length <= 3;
    switch (id) {
      case 'muzzle': return small ? 30 : 8;
      case 'skewer': return board.filter((i) => i.beast === 'rat').length * 8;
      case 'ironbox': return state.maxDays - state.day >= state.params.nestDays ? 18 : 0;
      case 'keys':
      case 'ring': return (board.length < 4 ? 20 : 5) - (has(state, 'muzzle') && small ? 12 : 0);
      case 'revenge': return 14;
      case 'saw': return 12;
      case 'rope': return 10;
      case 'fire': return 6;
      case 'wine': return board.filter((i) => i.tier < 3).length * 4;
      case 'horn': return board.filter((i) => devourOptions(state, cellOf(state, i.id).n).length).length * 6;
      case 'brand': return board.filter((i) => !devourOptions(state, cellOf(state, i.id).n).length).length * 5;
      default: return 0;
    }
  }

  // Finds the best cargo for the open window: most points, then cheapest escort.
  function bestCargo(state) {
    const ch = state.challenge;
    const contract = currentContract(state);
    if (!ch || !ch.window || !contract) return null;
    // The strongest 14 candidates keep the search small on a crowded block.
    const pool = [
      ...state.vault.map((v) => ({ kind: 'vault', key: v.id, p: { id: v.id, beast: v.beast, tier: RAINBOW } })),
      ...boardCells(state).map((c) => ({ kind: 'cell', key: c.n, p: c.inmate })),
    ].sort((a, b) => b.p.tier - a.p.tier).slice(0, 14);
    let best = null;
    const pick = [];
    const walk = (i, pressure) => {
      if (i === pool.length) {
        if (!pick.length) return;
        const cargo = pick.map((x) => x.p);
        if (!qualifies(contract, cargo)) return;
        for (const key of ['light', 'heavy']) {
          const e = ESCORTS[key];
          if (pressure > e.cap || ch.vouchers < e.cost) continue;
          const points = cargoPoints(cargo) + cargoBonus(contract, cargo);
          if (!best || points > best.points || (points === best.points && e.cost < best.cost)) {
            best = { points, cost: e.cost, escort: key, pressure, cells: pick.filter((x) => x.kind === 'cell').map((x) => x.key), vaultIds: pick.filter((x) => x.kind === 'vault').map((x) => x.key) };
          }
        }
        return;
      }
      walk(i + 1, pressure);
      const extra = PRESSURE[pool[i].p.tier];
      if (pressure + extra <= ESCORTS.heavy.cap) {
        pick.push(pool[i]);
        walk(i + 1, pressure + extra);
        pick.pop();
      }
    };
    walk(0, 0);
    return best;
  }

  // Ranks the moves available right now using visible information only.
  function advise(state) {
    if (state.phase === 'ended') return [];
    const tips = [];
    const board = boardInmates(state);
    const counts = TIERS.map((_, t) => board.filter((i) => i.tier === t).length);
    const choice = state.pending[0];
    if (choice) {
      return choice.options
        .map((id) => ({ kind: 'choose', id, score: choiceScore(state, id), text: `${toolName(id)}: ${toolText(id)}` }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    }
    if (state.challenge && state.challenge.window) {
      const best = bestCargo(state);
      if (!best) return [{ kind: 'note', text: state.challenge.window.early ? 'No cargo meets the heavy contract yet. Close the early window and keep building.' : 'No cargo meets this contract. Skip it to keep your inmates and vouchers.' }];
      const names = [...best.cells.map((n) => `${describe(state.cells[n].inmate)} (${cellLabel(n)})`), ...best.vaultIds.map(() => 'a vault Rainbow')];
      return [{ kind: 'cargo', cargo: best, text: `Send ${names.join(', ')} by ${ESCORTS[best.escort].name.toLowerCase()}: ${best.points} points, pressure ${best.pressure}.` }];
    }
    if (state.phase === 'event' && state.event) {
      if (state.event.kind === 'execution') {
        const victims = executionVictims(state, state.event.cell);
        return [{ kind: 'event', accept: victims.length > 0, text: victims.length ? `Accept: the executioner removes ${plural(victims.length, 'inmate')} and rises ${victims.length} ${victims.length === 1 ? 'tier' : 'tiers'}.` : 'Skip: there is nobody for this inmate to execute.' }];
      }
      const keepSmall = has(state, 'muzzle') && board.length <= 3;
      return [{ kind: 'event', accept: !keepSmall, text: keepSmall ? 'Skip: a chain would flood the block and switch off the Agony Muzzle.' : 'Accept: your next patrol opens every sealed cell on the way to its destination.' }];
    }
    if (state.phase === 'patrol') {
      for (const n of patrolOptions(state)) {
        const c = state.cells[n];
        let score;
        let why;
        if (!c.sealed) {
          score = has(state, 'muzzle') && board.length <= 3 ? 26 : 4;
          why = 'an open cell, so no new inmate arrives';
        } else if (c.nest) {
          score = -40;
          why = `it destroys the rat nest due on day ${c.nest.due}`;
        } else if (c.known && c.hidden) {
          const t = c.hidden.tier;
          score = 12 + WORTH[t] + counts[t] * 6;
          why = `${c.known === 2 ? describe(c.hidden) : `${TIERS[t]} inmate`} inside${counts[t] ? `, pairs with ${counts[t]} ${TIERS[t]} on the block` : ''}`;
        } else {
          score = 9;
          why = 'unknown occupant';
        }
        if (c.sealed && c.event) {
          score += 6;
          why += '; a special event waits there';
        }
        if (state.chain) {
          const opens = clockwisePath(state, n).filter((k) => state.cells[k].sealed).length;
          score += opens * 3;
          why += `; the chain opens ${plural(opens, 'door')} on the way`;
        }
        tips.push({ kind: 'patrol', cell: n, score, text: `Go to cell ${cellLabel(n)}: ${why}.` });
      }
      tips.sort((a, b) => b.score - a.score);
      return tips.slice(0, 3);
    }
    for (const c of boardCells(state)) {
      const eater = c.inmate;
      for (const option of devourOptions(state, c.n)) {
        const t = eater.tier;
        const { gain } = gainFor(state, c.n, option);
        const to = Math.min(RAINBOW, t + gain);
        const step = WORTH[Math.min(RAINBOW, t + 1)] - WORTH[t];
        let score = WORTH[to] - 2 * WORTH[t] + (to === RAINBOW ? 200 : 0);
        const notes = [];
        const own = linkOf(state, eater.id);
        if (own) {
          score -= own.rounds * step * 1.5;
          notes.push('ends its prey mark if its beast changes');
        }
        const meal = state.cells[option.cell];
        const theirs = !meal.sealed ? linkOf(state, meal.inmate.id) : null;
        if (theirs && theirs !== own) {
          score -= theirs.rounds * step;
          notes.push('ends a prey mark');
        }
        tips.push({
          kind: 'devour',
          from: c.n,
          to: option.cell,
          score,
          text: `${beastName(eater.beast)} in ${cellLabel(c.n)} eats ${meal.sealed ? 'the scratched door' : beastName(meal.inmate.beast)} in ${cellLabel(option.cell)}: ${TIERS[to]}${gain > 1 ? ` (+${gain})` : ''}${to === RAINBOW ? ', a Rainbow' : ''}${notes.length ? `; ${notes.join(', ')}` : ''}.`,
        });
      }
    }
    if (state.used.swap < state.params.swapsPerDay) {
      const ivory = boardCells(state).find((c) => c.ivory);
      if (ivory) tips.push({ kind: 'swap', cell: ivory.n, score: 20 + Math.min(board.length, state.params.ivoryCount) * 6, text: `Swap the inmate in Ivory cell ${cellLabel(ivory.n)}: up to ${plural(state.params.ivoryCount, 'inmate')} gain a tier.` });
    }
    tips.sort((a, b) => b.score - a.score);
    const out = tips.filter((t) => t.score > 0).slice(0, 4);
    if (!out.length) {
      const due = currentContract(state);
      const waits = [];
      if (state.prey.length) waits.push('prey marks grow');
      if (state.cells.some((c) => c.nest)) waits.push('nests hatch');
      const deliveryDay = due && due.deadline === state.day;
      out.push({ kind: 'end', text: deliveryDay ? `Nothing left to do on the block. End the day to open the "${due.name}" delivery.` : `Nothing on the block is worth doing now. End the day${waits.length ? ` so ${waits.join(' and ')}` : ''}.` });
    }
    if (canOpenEarly(state) && (board.some((i) => i.tier >= SUPREME) || state.vault.length)) {
      out.push({ kind: 'early', text: 'You hold a Supreme or Rainbow: you can deliver the heavy contract now and end the run.' });
    }
    return out;
  }

  // ---------- Saves ----------

  function serialize(state) {
    return JSON.stringify(state);
  }

  function deserialize(input) {
    let data;
    try {
      data = JSON.parse(typeof input === 'string' ? input : JSON.stringify(input));
    } catch (e) {
      throw new Error('That is not valid save data. The JSON could not be read.');
    }
    if (data && data.app === 'tartarus-sim') data = data.state;
    const valid = data && data.v === VERSION && Array.isArray(data.cells) && data.cells.length === CELL_COUNT && Array.isArray(data.log) && typeof data.day === 'number';
    if (!valid) throw new Error('That save is not from this version of the simulator.');
    data.params = data.mode === 'challenge' ? JSON.parse(JSON.stringify(CHALLENGE_PARAMS)) : normalizeParams(data.params);
    data.prey = Array.isArray(data.prey) ? data.prey : [];
    data.vault = Array.isArray(data.vault) ? data.vault : [];
    data.tools = Array.isArray(data.tools) ? data.tools.filter((t) => TOOLS[t]) : [];
    data.pending = Array.isArray(data.pending) ? data.pending : [];
    data.destinations = Array.isArray(data.destinations) ? data.destinations : [];
    data.used = Object.assign(freshDay(), data.used || {});
    data.stats = Object.assign({ patrols: 0, opened: 0, scouts: 0, devours: 0, swaps: 0, executions: 0, best: 0 }, data.stats || {});
    data.rng = Number(data.rng) >>> 0;
    data.cache = Number(data.cache) || 0;
    data.position = clamp(Number(data.position) || 0, 0, CELL_COUNT - 1);
    return data;
  }

  // Wraps a public action so the log stays bounded whatever happened inside.
  const bounded = (fn) => (state, ...args) => {
    const result = fn(state, ...args);
    trimLog(state);
    return result;
  };

  const api = {
    VERSION, CELL_COUNT, SUPREME, RAINBOW, TIERS, BEASTS, BEAST_INFO, PRESSURE, ESCORTS, TOOLS, TOOL_IDS, GIFTS, GIFT_IDS,
    LOADOUTS, SCENARIOS, CONTRACT_SLOTS, DEFAULT_PARAMS, PARAM_FIELDS, CHALLENGE_DAYS, START_VOUCHERS,
    newGame, randomSeed, normalizeParams, serialize, deserialize,
    patrol: bounded(patrol),
    resolveEvent: bounded(resolveEvent),
    scout: bounded(scout),
    devour: bounded(devour),
    swap: bounded(swap),
    endDay: bounded(endDay),
    endRun: bounded(endRun),
    deliver: bounded(deliver),
    skipDelivery: bounded(skipDelivery),
    openEarlyDelivery: bounded(openEarlyDelivery),
    cancelEarlyDelivery: bounded(cancelEarlyDelivery),
    choose: bounded(choose),
    refreshRefit: bounded(refreshRefit),
    editCell: bounded(editCell),
    markPrey: bounded(markPrey),
    moveWarden: bounded(moveWarden),
    addTool: bounded(addTool),
    removeTool: bounded(removeTool),
    patrolOptions, clockwisePath, devourOptions, gainFor, executionVictims, canScout, canEat, canOpenEarly, canRefresh,
    linkOf, cellOf, boardInmates, currentContract, deliveryCheck, bestCargo, rosterOf, advise, limits,
    toolText, toolName, describe, tierName, beastName, cellLabel, plural, stepsBetween,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Tartarus = api;
})(typeof window !== 'undefined' ? window : globalThis);
