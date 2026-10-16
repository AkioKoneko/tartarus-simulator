/* Tartarus Simulator: rules engine.
 * Game state and rules only, with no DOM access, so the same file runs in the
 * page and under Node for tests. Every random roll draws from a seeded stream,
 * which makes a run replayable from its seed. Public actions validate first and
 * only then change the state, and return { ok, events } or { ok: false, reason }.
 *
 * The block is a ring of 16 cells numbered clockwise. Cell 01 is the warden's
 * office, where every run starts; nothing is ever held there, so 15 cells hold
 * prisoners. Each morning offers a few patrol destinations ahead of the warden,
 * and a chain reaction opens every sealed cell on the clockwise walk to the
 * next destination. */
(function (root) {
  'use strict';

  const VERSION = 3;
  const CELL_COUNT = 16;
  const OFFICE = 0;
  const SUPREME = 4;
  const RAINBOW = 5;
  const LOG_LIMIT = 400;
  const CHALLENGE_DAYS = 12;
  const START_VOUCHERS = 6;

  const TIERS = ['Normal', 'Magic', 'Rare', 'Legendary', 'Supreme', 'Rainbow'];

  const BEASTS = ['mammoth', 'lion', 'wolf', 'rat'];
  const BEAST_INFO = {
    mammoth: { name: 'Mammoth' },
    lion: { name: 'Lion' },
    wolf: { name: 'Wolf' },
    rat: { name: 'Rat' },
  };

  // Who eats whom: each beast has exactly one meal, in a loop. (The Chinese
  // sim's two-meal chain was confirmed not to be in the live game.)
  const FOOD_CHAIN = { mammoth: ['lion'], lion: ['wolf'], wolf: ['rat'], rat: ['mammoth'] };
  const eatsOf = (state, beast) => FOOD_CHAIN[beast] || [];

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
    patrolRange: 6,
    eventTwoDoors: false,
    fewerDoorsChance: 0,
    swapsPerDay: 1,
    reusableCells: true,
    tierWeights: [52, 27, 15, 6, 0],
    beastWeights: [25, 25, 25, 25],
    eventChance: 5,
    executionSameTier: false,
    executionRerolls: false,
    ivoryCount: 4,
    ivoryIncludesSwapped: true,
    preyRounds: 3,
    scratchStacksBase: true,
    nestDays: 2,
    nestTier: 2,
    rewards: true,
    startTools: 1,
  };

  // The contract challenge always plays with these values.
  const CHALLENGE_PARAMS = Object.assign({}, DEFAULT_PARAMS, { executionSameTier: true, executionRerolls: true, rewards: true, startTools: 0 });

  // Field definitions for the Lab form; normalizeParams clamps to these.
  const PARAM_FIELDS = [
    { key: 'drillDays', group: 'Pace', label: 'Drill length in days', type: 'int', min: 5, max: 60 },
    { key: 'destinations', group: 'Pace', label: 'Most patrol doors offered each morning', type: 'int', min: 1, max: 15 },
    { key: 'patrolRange', group: 'Pace', label: 'Destinations come from this many cells clockwise ahead of the warden', type: 'int', min: 1, max: 15 },
    { key: 'fewerDoorsChance', group: 'Pace', label: 'Chance a morning offers one door fewer (%)', type: 'int', min: 0, max: 100 },
    { key: 'swapsPerDay', group: 'Pace', label: 'Swaps per day', type: 'int', min: 0, max: 16 },
    { key: 'reusableCells', group: 'Pace', label: 'Emptied cells seal again and can be reopened', type: 'bool' },
    { key: 'tierWeights', group: 'Odds', label: 'Rarity weights for new inmates', type: 'list', names: TIERS.slice(0, 5) },
    { key: 'beastWeights', group: 'Odds', label: 'Beast weights for new inmates', type: 'list', names: ['Mammoth', 'Lion', 'Wolf', 'Rat'] },
    { key: 'eventChance', group: 'Special events', label: 'Chance a sealed cell hides a special event, seen once the warden walks past it (%)', type: 'int', min: 0, max: 100 },
    { key: 'eventTwoDoors', group: 'Special events', label: 'A morning whose doors include an event offers only 2 doors', type: 'bool' },
    { key: 'executionSameTier', group: 'Special events', label: 'Execution takes same-rarity prey (off: lower rarity only)', type: 'bool' },
    { key: 'executionRerolls', group: 'Special events', label: "Execution re-rolls the executioner's beast", type: 'bool' },
    { key: 'ivoryCount', group: 'Markers', label: 'Inmates raised when a Tusk cell is swapped', type: 'int', min: 1, max: 15 },
    { key: 'ivoryIncludesSwapped', group: 'Markers', label: 'Tusk can raise the swapped-in inmate', type: 'bool' },
    { key: 'preyRounds', group: 'Markers', label: 'Mornings a prey mark lasts', type: 'int', min: 1, max: 10 },
    { key: 'scratchStacksBase', group: 'Markers', label: 'Scratch bonus (+2) adds to the base +1', type: 'bool' },
    { key: 'nestDays', group: 'Markers', label: 'Days before a rat nest hatches', type: 'int', min: 1, max: 10 },
    { key: 'nestTier', group: 'Markers', label: 'Rarity of a hatched Rat', type: 'tier' },
    { key: 'rewards', group: 'Rewards', label: "Meeting the run's objective earns a tool; each Rainbow opens the Warden's Treasure", type: 'bool' },
    { key: 'startTools', group: 'Rewards', label: 'Starting instrument picks, each from 3 random ones (the live game gives 1)', type: 'int', min: 0, max: 5 },
  ];

  const TOOLS = {
    revenge: { name: "Avenger's Casket", text: 'After a devour, 30% chance to open a sealed cell holding a meal for the eater at its new rarity. That door triggers nothing else.' },
    muzzle: { name: "Raging Beast's Agonizing Muzzle", text: 'When 4 or fewer inmates are on the block after the meal, a devour gains +2 extra tiers.' },
    saw: { name: 'Rusty Saw', text: 'After a devour, 25% chance of +1 extra tier.' },
    keys: { name: 'Lost Ring of Keys', text: 'When a patrol opens a door, 80% chance to also open the cells on both sides. Those doors trigger nothing else.' },
    rope: { name: "Hangman's Noose", text: 'Swapped-in inmates are never Normal or Magic.' },
    // Once translated as the Burning Stake, with other rules; the live card reads as below.
    fire: { name: 'Searing Branding Iron', text: 'When a patrol opens a door, 35% chance to copy the inmate behind it into 1 random unopened cell, which opens holding the copy. That door triggers nothing else.' },
    ironbox: { name: 'Squirming Iron Box', text: 'Each morning a sealed cell becomes a rat nest. It hatches a Rare Rat two days later.' },
    skewer: { name: 'Skewered Rat Heads', text: "Rats can devour Rats of the same rarity, and a Rat's devour gains +1 extra tier." },
    hook: { name: 'Sorting Hook', text: 'Cells that open never hold a Normal inmate.' },
    pestle: { name: 'Iron Pestle', text: 'A swapped-in inmate keeps the beast of the one it replaced; only its rarity is re-rolled.' },
    scales: { name: "Warden's Scales", text: 'After a swap, 80% chance to scout the highest-rarity inmate behind the locked doors: its door shows its beast and rarity.' },
    tongs: { name: 'Iron Tongs of Lust', text: 'Each morning a random Mammoth on the block gets a Tusk mark.' },
    guillotine: { name: 'Fanged Guillotine', text: 'Wolves can also devour the beasts they eat at a lower rarity than their own.' },
    axe: { name: "Gaoler's Execution Axe", text: 'When a swap brings in a higher rarity than it replaced, 2 random sealed cells open. Those doors trigger nothing else.' },
    shackles: { name: 'Long-Chained Shackles', text: 'When a patrol walks 4 or more cells, 40% chance that 1 random inmate on the block rises a tier.' },
    // The card reads "When an Inmate Chain Consumes": the bites after the
    // first, which the eater takes by itself.
    collar: { name: "Maddened Beast's Barbed Collar", text: 'Each bite of a devour chain after the first: 80% chance of +1 extra tier.' },
    forged: { name: 'Forged Key', text: 'Each morning offers 1 destination fewer. When a patrol opens a door, 50% chance to open 1 more random sealed cell. That door triggers nothing else.' },
    // The card: "There is a 25% chance to trigger after opening: +1 Rarity
    // Tier to the current Inmate", read as the inmate in the cell the warden
    // just opened (a player's report, 2026-10-16).
    dogtag: { name: "Felon's Dog Tag", text: 'When a patrol opens a door, 25% chance that the inmate behind it rises a tier.' },
    // The card: "There is a 40% chance to trigger after the Inmate is
    // Consumed: the cell occupied by this Inmate is immediately opened (does
    // not trigger other effects)" (a player's report, 2026-10-16).
    cage: { name: 'Crowded Beastcage', text: 'After an inmate is devoured, 40% chance its cell opens again at once with a new inmate. That door triggers nothing else.' },
    // From the user's "Select a Torture Instrument" screenshot (2026-10-16):
    // "When there are no more than 5 unopened cells, after opening: +1 Rarity
    // Tier to 2 random Inmates", and "There is a 50% chance to trigger when
    // moving no more than 3 tiles in a single movement: randomly opens 1 cell".
    blacklist: { name: "Executioner's Blacklist", text: 'When a patrol opens a door and 5 or fewer cells are still locked, 2 random inmates rise a tier.' },
    shortchain: { name: 'Short-Chained Shackles', text: 'When a patrol walks 3 cells or fewer, 50% chance that 1 random locked cell opens. That door triggers nothing else.' },
    // A player's report (#9, 2026-10-16), the card as typed: "Condition: The
    // quantities of this Inmate's Higher-Tier Inmates and Lower-Tier Inmates
    // are equal. Effect: +3 additional Rarity Tiers to the inmate this
    // Replacement" (spelled "Servered"). Read as the inmate a swap (the
    // game's Replace) brings in, counted against the rest of the block.
    maiden: { name: 'Severed Iron Maiden', text: 'After a swap, if as many inmates on the block are above the new inmate’s rarity as below it, it gains +3 tiers.' },
    // From a player's report (#11, 2026-10-16), the instrument pick: "-1 daily
    // destination option; there is a 35% chance to trigger after Consuming",
    // and "+1 additional Rarity Tier" (the rest of the card was cut off),
    // read like the Rusty Saw: the eater, on each bite.
    whip: { name: 'Barbed Whip', text: 'Each morning offers 1 destination fewer. Each bite of a devour has a 35% chance of +1 extra tier.' },
    // From the user's screenshot of its card (2026-10-16): "At the start of
    // each day: Removes Inmates on both sides of the Inmate with the highest
    // rarity; for each Inmate removed, there is a 40% chance to grant that
    // Inmate +1 Rarity Tier". Read as the cells either side on the ring, the
    // removed inmates leaving their cells as a meal does.
    ravenous: { name: "Ferocious Beast's Ravenous Chains", text: 'Each morning the highest-rarity inmate removes the inmates on both sides of it, with a 40% chance of +1 tier for each one removed.' },
    // A player's report (#12, 2026-10-16), the card: "There are at least 2
    // other Inmates on the field when replacing: Randomly removes 2 other
    // Inmates to guarantee that the Inmate's rarity is increased after
    // replacing".
    scapegoat: { name: "Scapegoat's Guillotine", text: 'When a swap has 2 or more other inmates on the block, 2 random ones are removed and the new inmate comes in above the rarity it replaced.' },
    // The user's screenshots of its card (2026-10-16): "-1 daily destination
    // option; when an Inmate with rarity lower than Legendary is Replaced,
    // there is a 40% chance to trigger. Effect: Changes Inmate rarity to
    // Legendary". A separate instrument from the Searing Branding Iron (id
    // `fire`, once taken for its mistranslation).
    stake: { name: 'Burning Stake', text: 'Each morning offers 1 destination fewer. Swapping out an inmate below Legendary has a 40% chance to bring in a Legendary.' },
    // A player's report (#17, 2026-10-16): "At the start of each day, if there
    // are matching Inmates on the field, there is a 60% chance to trigger:
    // Randomly removes 1 matching Inmate, then randomly selects 1 from the
    // remaining matching Inmates to grant them +2 Rarity Tiers". Matching is
    // the same beast and rarity (the user, from the game's own link).
    coin: { name: "Kin's Coin of Fate", text: 'Each morning, when two or more inmates share a beast and rarity, 60% chance that one of them is removed and another like it gains +2 tiers.' },
  };
  const TOOL_IDS = Object.keys(TOOLS);

  // Special events behind sealed doors, each equally likely.
  const EVENTS = {
    chain: { name: 'Chain reaction' },
    execution: { name: 'Execution' },
    trickster: { name: 'Behind Closed Doors' },
    appetite: { name: 'Ravenous Appetite' },
    convict: { name: 'High-Risk Convict' },
    crow: { name: 'Crow Whispers' },
    freedom: { name: 'Taste of Freedom' },
    usurp1: { name: 'Usurpation I' },
    usurp2: { name: 'Usurpation II' },
  };
  // The pool new events are drawn from (the game's "Prison Incidents"). It
  // changes during a run: Usurpation I trades itself for Usurpation II.
  const EVENT_POOL = ['chain', 'execution', 'trickster', 'appetite', 'convict', 'crow', 'freedom', 'usurp1'];
  // Taste of Freedom opens this many random locked cells.
  const FREEDOM_CELLS = 3;
  // Crow Whispers shows the rarity behind this many locked cells.
  const CROW_CELLS = 4;
  // The warden's office: Instigate brings this many new special events.
  const INSTIGATE_EVENTS = 2;
  // Ravenous Appetite: tries at +1 tier, and the chance of each.
  const APPETITE_TRIES = 5;
  const APPETITE_ODDS = 0.5;
  const EVENT_IDS = Object.keys(EVENTS);
  const eventName = (id) => (EVENTS[id] ? EVENTS[id].name : 'Special event');

  // Each run has one objective, drawn at the start; meeting it earns a tool
  // when rewards are on. The live game has more objectives, and what each
  // one pays isn't known yet, so every objective here pays a tool. `other`
  // stands for one the simulator doesn't know: it's never drawn, and it
  // pays nothing, so no tool is ever assumed for it.
  const OBJECTIVES = {
    king: { name: 'King of the Caged', text: "At least 1 inmate's rarity reaches Supreme" },
    walk: { name: 'Prison Walk', text: 'Move 18 tiles', need: 18, unit: 'Tiles moved' },
    // Seen live 2026-10-16, each paying a tool when met (and a Warden's Cache
    // at the riot, not simulated). Not drawn in simulated runs yet: the
    // analyzer uses them when the player sets them.
    consume: { name: 'Survival of the Fittest', text: 'Consume 4 times', need: 4, unit: 'Consumes', drawn: false },
    incident: { name: 'Undercurrents', text: 'Trigger a Prison Incident 2 times', need: 2, unit: 'Prison Incidents', drawn: false },
    other: { name: 'Another objective', text: 'Not in the simulator yet, so no tool is assumed for it', drawn: false },
  };
  const OBJECTIVE_IDS = Object.keys(OBJECTIVES).filter((id) => OBJECTIVES[id].drawn !== false);

  const GIFTS = {
    ring: { name: 'Three-Headed Thumb Ring', text: 'Open up to 3 random sealed cells. They trigger nothing else.' },
    horn: { name: 'Brass Horn of Strife', text: 'Every inmate with a target devours one at random, in turn.' },
    wine: { name: 'Crimson Vintage', text: 'Every inmate below Legendary rises one tier.' },
    brand: { name: 'Brand of Original Sin', text: 'Up to 4 inmates with no meal change beast so they have a same-rarity target.' },
  };
  const GIFT_IDS = Object.keys(GIFTS);

  const START_CELLS = [1, 2, 5, 6, 10, 11];
  const LOADOUTS = {
    supply: { name: 'Supply start', level: 'Standard', text: 'Six inmates and the Lost Ring of Keys. Build numbers for the mixed convoys.', inmates: [['mammoth', 0], ['lion', 0], ['wolf', 1], ['rat', 1], ['rat', 2], ['mammoth', 2]], tools: ['keys'] },
    lean: { name: 'Lean start', level: 'Advanced', text: 'Three inmates and the Agonizing Muzzle. Keep the block small for big tier jumps.', inmates: [['mammoth', 0], ['lion', 0], ['wolf', 3]], tools: ['muzzle'] },
    rats: { name: 'Rat-breeding start', level: 'Easier', text: 'Three inmates, the Squirming Iron Box and the Skewered Rat Heads. Breed Rats and pair them.', inmates: [['rat', 2], ['rat', 2], ['mammoth', 3]], tools: ['ironbox', 'skewer'] },
  };

  const SCENARIOS = {
    empty: { name: 'Empty prison', text: 'Day 1 with all 15 prison cells sealed. Recommended for a first run.' },
    events: { name: 'Special events drill', text: 'The three doors on today’s route hide an Execution, a Chain reaction, and Behind Closed Doors or Ravenous Appetite.' },
    ivory: { name: 'Tusk drill', text: 'Swap the inmate in a Tusk cell and four inmates rise a tier.' },
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
  const freshDay = () => ({ swap: 0, devour: 0 });
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

  // The challenge's values are fixed.
  function challengeParams() {
    return JSON.parse(JSON.stringify(CHALLENGE_PARAMS));
  }

  // ---------- State helpers ----------

  // An entry can carry `x`, a small record of what happened (who opened,
  // who ate whom), which the page draws as beast icons in the log and recap.
  const entry = (state, kind, text, x) => (x ? { d: state.day, k: kind, t: text, x } : { d: state.day, k: kind, t: text });
  const snap = (inmate) => ({ beast: inmate.beast, tier: inmate.tier });

  function log(state, kind, text, x) {
    state.log.push(entry(state, kind, text, x));
  }

  // Inserts an entry earlier in the log, so a summary line can come before the
  // side effects that were logged while it resolved.
  function logAt(state, index, kind, text, x) {
    state.log.splice(index, 0, entry(state, kind, text, x));
  }

  function trimLog(state) {
    if (state.log.length <= LOG_LIMIT) return;
    const cut = state.log.length - LOG_LIMIT;
    state.log.splice(0, cut);
    // A chain waiting for a pick logs its summary where it began.
    if (state.chaining) state.chaining.at = Math.max(0, state.chaining.at - cut);
  }

  function makeInmate(state, beast, tier) {
    return { id: state.nextId++, beast, tier: clamp(tier, 0, RAINBOW) };
  }

  // Rarity odds for whoever is behind a door. The Sorting Hook keeps out Normals.
  function doorWeights(state) {
    const w = state.params.tierWeights.slice();
    if (has(state, 'hook') && w.slice(1).some((x) => x > 0)) w[0] = 0;
    return w;
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
    if (!cell.hidden) cell.hidden = rollInmate(state, doorWeights(state));
    return cell.hidden;
  }

  // Who comes out of a door: the inmate already behind it, unless the Sorting
  // Hook rules out a Normal the player hasn't seen.
  function doorInmate(state, cell) {
    const h = cell.hidden;
    if (h && (h.tier > 0 || cell.known || !has(state, 'hook'))) return h;
    return rollInmate(state, doorWeights(state));
  }

  function canEat(state, eater, meal) {
    if (!eater || !meal || eater.id === meal.id || eater.tier >= RAINBOW) return false;
    if (eater.tier !== meal.tier) return eater.tier > meal.tier && eater.beast === 'wolf' && has(state, 'guillotine') && eatsOf(state, 'wolf').includes(meal.beast);
    return eatsOf(state, eater.beast).includes(meal.beast) || (eater.beast === 'rat' && meal.beast === 'rat' && has(state, 'skewer'));
  }

  // One devour a day, started by the inmate in the warden's cell; it then
  // chains on by itself (see devour). A day has a devour or a swap, not
  // both: either one uses up the other (confirmed in the live game). But
  // the live game can still offer a consume after a swap (seen 2026-10-16,
  // on a day with a special event). The analyzer sets
  // used.devourAfterSwap only when the game shows that offer; it lasts the
  // day.
  // used.noDevour / used.noSwap: the game shows no Consume / Replace card
  // today (the analyzer reads them), so that one isn't on offer, while the
  // other still is.
  const canDevourNow = (state) => state.used.devour < 1 && !state.used.noDevour && (state.used.swap < 1 || !!state.used.devourAfterSwap);
  const canSwapNow = (state) => state.used.devour < 1 && !state.used.noSwap && state.used.swap < state.params.swapsPerDay;

  function startOptions(state) {
    const cell = state.cells[state.position];
    if (!canDevourNow(state) || state.phase !== 'manage' || !cell || cell.sealed || !cell.inmate) return [];
    return devourOptions(state, cell.n);
  }

  function limits(state) {
    return { swap: state.params.swapsPerDay };
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

  // A random special event kind, from the run's current pool.
  const rollEvent = (state) => {
    const pool = state.eventPool || EVENT_POOL;
    return pool[Math.floor(rand(state) * pool.length)];
  };

  // Empties a cell. With reusable cells it seals again and will hold someone
  // new the next time it opens, unseen again: it may hide a new special event.
  function emptyCell(state, cell) {
    const inmate = cell.inmate;
    cell.inmate = null;
    cell.hidden = null;
    cell.known = 0;
    cell.scratch = false;
    cell.nest = null;
    cell.ivory = false;
    cell.sealed = !!state.params.reusableCells;
    cell.seen = false;
    cell.event = cell.sealed && rand(state) * 100 < state.params.eventChance ? rollEvent(state) : null;
    return inmate;
  }

  // The run's objective is met: with rewards on, it earns a tool (pick one
  // of three). `state.milestone` records that it's done.
  function meetObjective(state, why) {
    state.milestone = true;
    const name = OBJECTIVES[state.objective.id].name;
    const options = state.params.rewards ? shuffle(state, TOOL_IDS.filter((t) => !has(state, t))).slice(0, 3) : [];
    if (options.length) state.pending.push({ kind: 'tool', options });
    log(state, 'tool', `Objective met, ${name}: ${why}.${options.length ? ' Choose a tool.' : ''}`, { type: 'objective', id: state.objective.id });
  }

  // Counts toward an objective met by doing something a number of times
  // (Survival of the Fittest: each bite; Undercurrents: each Prison
  // Incident), and meets it at its count.
  function countObjective(state, id, what) {
    const o = state.objective;
    if (!o || o.id !== id || state.milestone) return;
    const need = OBJECTIVES[id].need;
    o.progress = Math.min(need, o.progress + 1);
    if (o.progress >= need) meetObjective(state, `${need} ${what}`);
  }

  // Applies rewards for growth: King of the Caged, and the vault for anyone
  // who reaches Rainbow.
  function afterGrowth(state, inmate, events) {
    state.stats.best = Math.max(state.stats.best, inmate.tier);
    if (state.objective.id === 'king' && !state.milestone && inmate.tier >= SUPREME) meetObjective(state, `a ${describe(inmate)}`);
    if (inmate.tier < RAINBOW) return;
    const cell = cellOf(state, inmate.id);
    if (!cell) return;
    emptyCell(state, cell);
    state.vault.push({ id: inmate.id, beast: inmate.beast, day: state.day });
    state.cache += 1;
    log(state, 'rainbow', `Rainbow ${beastName(inmate.beast)}! It left cell ${cellLabel(cell.n)} for the vault. Warden's Treasure claims: ${state.cache}.`, { type: 'rainbow', cell: cell.n, who: snap(inmate) });
    events.push({ type: 'rainbow', cell: cell.n });
    if (state.params.rewards) state.pending.push({ kind: 'gift', options: GIFT_IDS.slice() });
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
    const inmate = forced ? makeInmate(state, forced.beast, forced.tier) : doorInmate(state, cell);
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
    log(state, 'patrol', `Opened cell ${cellLabel(cell.n)}${extra}: ${describe(inmate)}.${lostNest ? ' The rat nest inside was destroyed.' : ''}`, { type: 'open', cell: cell.n, side: how !== 'patrol', who: snap(inmate) });
    if (event && how !== 'patrol') log(state, 'event', `The special event behind cell ${cellLabel(cell.n)} was used up without triggering.`);
    afterGrowth(state, inmate, events);
    // Felon's Dog Tag: the inmate behind a patrolled door may rise a tier.
    if (how === 'patrol' && has(state, 'dogtag') && cell.inmate === inmate && inmate.tier < RAINBOW && rand(state) < 0.25) {
      log(state, 'tool', `Felon's Dog Tag: the ${describe(inmate)} in cell ${cellLabel(cell.n)} rises a tier.`, { type: 'dogtag', cell: cell.n });
      promote(state, inmate, 1, false, events);
    }
    // Executioner's Blacklist: once 5 or fewer cells are still locked, each
    // door the patrol opens raises 2 random inmates a tier.
    if (how === 'patrol' && has(state, 'blacklist') && state.cells.filter((c) => c.sealed).length <= 5) {
      const picks = shuffle(state, boardInmates(state).filter((i) => i.tier < RAINBOW)).slice(0, 2);
      if (picks.length) {
        log(state, 'tool', `Executioner's Blacklist: ${picks.map((who) => `the ${describe(who)} in cell ${cellLabel(cellOf(state, who.id).n)}`).join(' and ')} ${picks.length === 1 ? 'rises' : 'rise'} a tier.`, { type: 'blacklist', cells: picks.map((who) => cellOf(state, who.id).n) });
        for (const who of picks) if (boardCellOf(state, who.id)) promote(state, who, 1, false, events);
      }
    }
    // Searing Branding Iron: the inmate behind a patrolled door is copied
    // into another unopened cell, which opens with no other effect.
    if (how === 'patrol' && has(state, 'fire') && rand(state) < 0.35 && cell.inmate === inmate) {
      const sealed = state.cells.filter((c) => c.sealed);
      if (sealed.length) {
        const target = pickOne(state, sealed);
        log(state, 'tool', `Searing Branding Iron: the ${describe(inmate)} is copied into cell ${cellLabel(target.n)}.`);
        openCell(state, target, 'side', events, { beast: inmate.beast, tier: inmate.tier });
      }
    }
    if (how === 'patrol' && has(state, 'keys') && rand(state) < 0.8) {
      log(state, 'tool', 'Lost Ring of Keys: the cells on both sides swing open too.');
      // Next to the office there is only one door to open.
      for (const step of [-1, 1]) openCell(state, state.cells[(cell.n + step + CELL_COUNT) % CELL_COUNT], 'side', events);
    }
    if (how === 'patrol' && has(state, 'forged') && rand(state) < 0.5) {
      const sealed = state.cells.filter((c) => c.sealed);
      if (sealed.length) {
        const extra = pickOne(state, sealed);
        log(state, 'tool', `Forged Key: cell ${cellLabel(extra.n)} opens too.`);
        openCell(state, extra, 'side', events);
      }
    }
    return how === 'patrol' ? event : null;
  }

  function guard(state, need) {
    if (state.phase === 'ended') return fail('This run is over. Start a new run to keep playing.');
    if (state.pending.length) return fail('Make your pending choice first.');
    if (state.chaining) return fail('The devour chain must go on: pick its next meal first.');
    if (state.phase === 'office') return fail('Choose Instigate or Bestow first.');
    if (state.challenge && state.challenge.window) return fail('Finish the delivery window first.');
    if (state.phase === 'event') return fail('Decide on the special event first.');
    if (need === 'manage' && state.phase === 'patrol') return fail('Patrol first: walk to one of today’s destinations.');
    if (need === 'patrol' && state.phase !== 'patrol') return fail('Today’s patrol is done.');
    return null;
  }

  // ---------- Setup ----------

  // The office is never sealed and never holds anyone. `seen` turns on when
  // the warden walks past a sealed cell: only then does its event show.
  function blankCell(n) {
    return { n, sealed: n !== OFFICE, inmate: null, hidden: null, known: 0, scratch: false, nest: null, event: null, ivory: false, seen: false };
  }

  function newGame(options) {
    const opts = options || {};
    const mode = opts.mode === 'challenge' ? 'challenge' : 'drill';
    const scenario = mode === 'drill' && SCENARIOS[opts.scenario] ? opts.scenario : 'empty';
    const loadout = mode === 'challenge' ? (LOADOUTS[opts.loadout] ? opts.loadout : 'supply') : null;
    const params = mode === 'challenge' ? challengeParams(opts.params) : normalizeParams(opts.params);
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
      position: OFFICE,
      destinations: [],
      chain: false,
      event: null,
      cells: Array.from({ length: CELL_COUNT }, (_, n) => blankCell(n)),
      vault: [],
      cache: 0,
      tools: [],
      pending: [],
      // A random objective: reaching Supreme earns a tool only when it's
      // King of the Caged.
      objective: { id: pickOne(sideStream({ seed }, 'objective'), OBJECTIVE_IDS), progress: 0 },
      milestone: false,
      used: freshDay(),
      // A devour chain waiting for the player to pick its next meal.
      chaining: null,
      eventPool: EVENT_POOL.slice(),
      prey: [],
      nextId: 1,
      log: [],
      stats: { patrols: 0, opened: 0, devours: 0, chains: 0, swaps: 0, executions: 0, best: 0 },
      challenge: null,
      result: null,
    };
    for (const cell of state.cells) if (cell.sealed && rand(state) * 100 < params.eventChance) cell.event = rollEvent(state);
    log(state, 'day', `Day 1 of ${state.maxDays}.`);
    const goal = OBJECTIVES[state.objective.id];
    log(state, 'tool', `Objective: ${goal.name}. ${goal.text}.`);
    if (mode === 'challenge') setupChallenge(state);
    else setupDrill(state);
    return state;
  }

  function place(state, n, beast, tier) {
    if (n === OFFICE) throw new Error('The office never holds an inmate.');
    const cell = state.cells[n];
    Object.assign(cell, blankCell(n), { sealed: false, inmate: makeInmate(state, beast, tier) });
    state.stats.best = Math.max(state.stats.best, tier);
    return cell.inmate;
  }

  function hide(state, n, beast, tier, extra) {
    if (n === OFFICE) throw new Error('The office never holds an inmate.');
    const cell = state.cells[n];
    Object.assign(cell, blankCell(n), { hidden: makeInmate(state, beast, tier) }, extra || {});
    return cell;
  }

  function setupDrill(state) {
    const s = state.scenario;
    let note = 'All 15 prison cells are sealed, and the warden starts in the office at cell 01. Pick one of today’s destinations to meet your first inmate.';
    let destinations = null;
    // Marker drills open after the day-1 patrol, with the warden at cell 02.
    // The events drill is about the patrol itself, so it starts in the office.
    const marker = s !== 'empty' && s !== 'events';
    if (s === 'events') {
      place(state, 4, 'wolf', 1);
      place(state, 5, 'mammoth', 0);
      place(state, 6, 'wolf', 0);
      place(state, 13, 'lion', 2);
      place(state, 15, 'mammoth', 1);
      // Cell 02 holds one of the two events that only add tiers, by the seed.
      const bonus = pickOne(sideStream(state, 'events-drill'), ['trickster', 'appetite']);
      hide(state, 1, 'wolf', 0, { event: bonus, seen: true });
      hide(state, 2, 'lion', 2, { event: 'execution', known: 1, seen: true });
      hide(state, 3, 'mammoth', 1, { event: 'chain', seen: true });
      destinations = [1, 2, 3];
      note = `Special events drill: cell 02 hides ${eventName(bonus)}, cell 03 hides an Execution behind a Rare inmate, and cell 04 hides a Chain reaction. Patrol one, then accept or skip the event.`;
    } else if (s === 'ivory') {
      place(state, 1, 'wolf', 1);
      state.cells[1].ivory = true;
      place(state, 2, 'lion', 2);
      place(state, 3, 'mammoth', 0);
      place(state, 7, 'wolf', 2);
      place(state, 12, 'mammoth', 3);
      place(state, 15, 'rat', 1);
      note = `Tusk drill: cell 02, the warden's cell, carries a Tusk mark. Swap its inmate and ${plural(state.params.ivoryCount, 'inmate')} on the block each gain a tier.`;
    } else if (s === 'prey') {
      const lion = place(state, 1, 'lion', 2);
      const wolf = place(state, 2, 'wolf', 2);
      place(state, 5, 'mammoth', 2);
      place(state, 9, 'mammoth', 1);
      place(state, 13, 'rat', 1);
      state.prey.push({ lion: lion.id, prey: wolf.id, preyBeast: 'wolf', rounds: state.params.preyRounds, next: 2 });
      note = `Prey drill: the Lion in cell 02 has marked the Wolf in cell 03. Each morning both rise a tier, for ${plural(state.params.preyRounds, 'morning')}. The Lion stands in the warden's cell, so it could devour its prey today, but that re-rolls its beast and ends the mark.`;
    } else if (s === 'scratch') {
      place(state, 1, 'wolf', 1);
      hide(state, 2, 'mammoth', 1, { scratch: true, known: 1 });
      place(state, 8, 'wolf', 2);
      hide(state, 9, 'lion', 2, { scratch: true, known: 1 });
      place(state, 14, 'rat', 0);
      note = 'Scratch drill: a scratched door shows the rarity inside. A Wolf can devour a same-rarity inmate through it, whatever its beast, and gains +3.';
    } else if (s === 'nest') {
      place(state, 1, 'lion', 2);
      hide(state, 2, 'rat', 0, { nest: { due: 1 + state.params.nestDays } });
      place(state, 5, 'mammoth', 2);
      place(state, 11, 'wolf', 2);
      place(state, 15, 'rat', 0);
      note = `Rat nest drill: the nest in cell 03 hatches a ${tierName(state.params.nestTier)} Rat on the morning of day ${1 + state.params.nestDays}. Patrolling it before then destroys it.`;
    }
    for (const cell of state.cells) if (!cell.sealed) cell.event = null;
    offerStartTools(state);
    if (marker) state.position = 1;
    beginDay(state, []);
    if (destinations) state.destinations = destinations;
    if (marker) state.phase = 'manage';
    log(state, 'drill', note);
  }

  // As in the live game, a run starts with a pick of 3 random instruments.
  // More starting picks (a Lab value) each offer 3 others.
  function offerStartTools(state) {
    const picks = Math.min(state.params.startTools, Math.floor(TOOL_IDS.length / 3));
    if (picks <= 0) return;
    const order = shuffle(sideStream(state, 'start-tools'), TOOL_IDS.filter((t) => !has(state, t)));
    for (let i = 0; i < picks; i++) state.pending.push({ kind: 'tool', options: order.slice(3 * i, 3 * i + 3), start: true });
    log(state, 'tool', picks === 1 ? 'Choose a starting instrument.' : `Choose ${picks} starting instruments, one at a time.`);
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

  // Today's door count, drawn each morning.
  // The Forged Key takes one door off every morning.
  function destinationLimit(state) {
    return Math.max(1, (state.destBase || state.params.destinations) - (has(state, 'forged') ? 1 : 0) - (has(state, 'whip') ? 1 : 0) - (has(state, 'stake') ? 1 : 0));
  }

  // Destinations come from the cells just ahead of the warden, clockwise:
  // locked ones to open, open ones whose inmates you already know, or the
  // warden's office, where the warden can Instigate or Bestow.
  function rollDestinations(state) {
    // Some mornings offer one door fewer; the odds are a practice value.
    const fewer = rand(state) * 100 < state.params.fewerDoorsChance;
    state.destBase = Math.max(1, state.params.destinations - (fewer ? 1 : 0));
    const range = Math.min(state.params.patrolRange, CELL_COUNT - 1);
    const ahead = [];
    for (let i = 1; i <= range; i++) ahead.push(state.cells[(state.position + i) % CELL_COUNT]);
    let picks = shuffle(state, ahead).slice(0, destinationLimit(state));
    // A door with an event behind it means a two-door morning.
    const hasEvent = (c) => c.sealed && c.event && c.seen;
    if (state.params.eventTwoDoors && picks.some(hasEvent)) picks = [...picks.filter(hasEvent), ...picks.filter((c) => !hasEvent(c))].slice(0, 2);
    state.destinations = picks.map((c) => c.n).sort((a, b) => stepsBetween(state.position, a) - stepsBetween(state.position, b));
  }

  // Trims today's options to today's door count.
  function fitDestinations(state) {
    if (state.phase !== 'patrol') return;
    state.destinations = state.destinations.slice(0, destinationLimit(state));
  }

  function beginDay(state, events) {
    state.phase = 'patrol';
    state.used = freshDay();
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
    if (has(state, 'tongs')) {
      const mammoths = boardCells(state).filter((c) => c.inmate.beast === 'mammoth' && !c.ivory);
      if (mammoths.length) {
        const cell = pickOne(state, mammoths);
        cell.ivory = true;
        log(state, 'tool', `Iron Tongs of Lust: the Mammoth in cell ${cellLabel(cell.n)} gets a Tusk mark.`);
      }
    }
    if (has(state, 'ironbox')) {
      const free = state.cells.filter((c) => c.sealed && !c.nest);
      if (free.length) {
        const cell = pickOne(state, free);
        cell.nest = { due: state.day + state.params.nestDays };
        log(state, 'nest', `Squirming Iron Box: cell ${cellLabel(cell.n)} is now a rat nest. It hatches on day ${cell.nest.due}.`);
        events.push({ type: 'nest', cell: cell.n });
      }
    }
    if (has(state, 'ravenous')) ravenousChains(state, events);
    if (has(state, 'coin')) coinOfFate(state, events);
    rollDestinations(state);
  }

  // Kin's Coin of Fate, each morning: with inmates that share a beast and
  // rarity on the block, 60% of the time one of them goes and another like
  // it rises 2 tiers.
  function coinOfFate(state, events) {
    const kind = (c) => `${c.inmate.beast}|${c.inmate.tier}`;
    const board = boardCells(state);
    const count = {};
    for (const c of board) count[kind(c)] = (count[kind(c)] || 0) + 1;
    const matching = board.filter((c) => count[kind(c)] >= 2);
    if (!matching.length || rand(state) >= 0.6) return;
    const gone = pickOne(state, matching);
    const lucky = pickOne(state, matching.filter((c) => c !== gone && kind(c) === kind(gone)));
    const goneWho = describe(gone.inmate);
    const luckyWho = describe(lucky.inmate);
    emptyCell(state, gone);
    events.push({ type: 'removed', cell: gone.n });
    checkPrey(state);
    log(state, 'tool', `Kin's Coin of Fate: the ${goneWho} in cell ${cellLabel(gone.n)} goes, and the ${luckyWho} in cell ${cellLabel(lucky.n)} rises 2 tiers.`, { type: 'coin', removed: gone.n, cell: lucky.n });
    promote(state, lucky.inmate, 2, false, events);
  }

  // Ferocious Beast's Ravenous Chains, each morning: the highest-rarity
  // inmate (one at random among equals) removes the inmates in the cells on
  // either side of it on the ring, and may rise a tier for each.
  function ravenousChains(state, events) {
    const board = boardCells(state);
    if (!board.length) return;
    const top = Math.max(...board.map((c) => c.inmate.tier));
    const cell = pickOne(state, board.filter((c) => c.inmate.tier === top));
    const eater = cell.inmate;
    const sides = [(cell.n + CELL_COUNT - 1) % CELL_COUNT, (cell.n + 1) % CELL_COUNT].map((k) => state.cells[k]).filter((c) => !c.sealed && c.inmate);
    if (!sides.length) return;
    const gone = sides.map((c) => `the ${describe(c.inmate)} in ${cellLabel(c.n)}`);
    let rises = 0;
    for (const side of sides) {
      emptyCell(state, side);
      events.push({ type: 'removed', cell: side.n });
      if (rand(state) < 0.4) rises += 1;
    }
    checkPrey(state);
    log(state, 'tool', `Ferocious Beast's Ravenous Chains: the ${describe(eater)} in cell ${cellLabel(cell.n)} removes ${gone.join(' and ')}${rises ? ` and rises ${plural(rises, 'tier')}` : ''}.`, { type: 'ravenous', cell: cell.n, removed: sides.map((c) => c.n), rises });
    if (rises) promote(state, eater, rises, false, events);
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
    return state.phase === 'patrol' ? state.destinations.slice() : [];
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

  // The sure part of a devour's gain; Rusty Saw and Avenger's Casket roll later.
  function gainFor(state, from, option) {
    const eater = state.cells[from].inmate;
    let gain = option.scratch ? 2 + (state.params.scratchStacksBase ? 1 : 0) : 1;
    const notes = [];
    if (option.scratch) notes.push(`scratch +${gain - 1}`);
    // The Muzzle counts the block after the meal is gone.
    if (has(state, 'muzzle') && boardCells(state).length - (option.scratch ? 0 : 1) <= 4) {
      gain += 2;
      notes.push('Agonizing Muzzle +2');
    }
    if (has(state, 'skewer') && eater && eater.beast === 'rat') {
      gain += 1;
      notes.push('Skewered Rat Heads +1');
    }
    return { gain, notes, saw: has(state, 'saw'), revenge: has(state, 'revenge') };
  }

  function executionVictims(state, n) {
    const cell = state.cells[n];
    const exec = cell && !cell.sealed ? cell.inmate : null;
    if (!exec) return [];
    const eats = eatsOf(state, exec.beast);
    return boardCells(state).filter((c) => c !== cell && eats.includes(c.inmate.beast) && (state.params.executionSameTier ? c.inmate.tier === exec.tier : c.inmate.tier < exec.tier));
  }

  // Behind Closed Doors' "Scarce Code": the beasts with the fewest inmates on
  // the block (none counts). The event picks one of them at random.
  function scarceBeasts(state) {
    const counts = BEASTS.map((b) => boardInmates(state).filter((i) => i.beast === b).length);
    const low = Math.min(...counts);
    return BEASTS.filter((_, i) => counts[i] === low);
  }

  // Ravenous Appetite picks one of the inmates with the lowest rarity on the
  // block, at random.
  function lowestInmates(state) {
    const board = boardInmates(state);
    const low = Math.min(...board.map((i) => i.tier));
    return board.filter((i) => i.tier === low);
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
    const events = [{ type: 'move', from: state.position, to: n }];
    const cell = state.cells[n];
    const steps = stepsBetween(state.position, n);
    state.stats.patrols += 1;
    // The doors the warden walks past are seen: any event behind them shows.
    for (const k of clockwisePath(state, n)) if (k !== n) state.cells[k].seen = true;
    let event = null;
    if (state.chain) {
      const path = clockwisePath(state, n);
      log(state, 'event', `Chain reaction: walking clockwise from cell ${cellLabel(state.position)} to cell ${cellLabel(n)} opens every sealed door on the way.`, { type: 'sweep', from: state.position, cell: n });
      for (const k of path) openCell(state, state.cells[k], 'side', events);
      state.chain = false;
    } else if (cell.sealed) {
      event = openCell(state, cell, 'patrol', events);
    } else if (n === OFFICE) {
      log(state, 'patrol', "Walked to the warden's office: Instigate or Bestow.", { type: 'walk', cell: n, who: null });
    } else if (cell.inmate) {
      log(state, 'patrol', `Walked to cell ${cellLabel(n)}. Its ${describe(cell.inmate)} can start today's devour.`, { type: 'walk', cell: n, who: snap(cell.inmate) });
    } else {
      log(state, 'patrol', `Walked to empty cell ${cellLabel(n)}.`, { type: 'walk', cell: n, who: null });
    }
    state.position = n;
    checkPrey(state);
    walked(state, steps, events);
    if (event && state.cells[n].inmate) {
      state.phase = 'event';
      state.event = { kind: event, cell: n };
      countObjective(state, 'incident', 'Prison Incidents');
      log(state, 'event', `Cell ${cellLabel(n)} held a special event: ${eventName(event)}. Accept or skip it.`);
    } else {
      state.phase = n === OFFICE ? 'office' : 'manage';
    }
    return ok(events);
  }

  // The warden's office: Instigate brings new special events behind locked
  // doors, and Bestow raises 1 random inmate on the block a tier. One of
  // the two, then the day goes on as usual.
  function officeAct(state, choice) {
    if (state.phase !== 'office') return fail("Instigate and Bestow come with a visit to the warden's office.");
    if (state.pending.length) return fail('Make your pending choice first.');
    const events = [];
    if (choice === 'instigate') {
      const doors = shuffle(state, state.cells.filter((c) => c.sealed && !c.event && !c.nest)).slice(0, INSTIGATE_EVENTS);
      for (const c of doors) {
        c.event = rollEvent(state);
        c.seen = true;
      }
      log(state, 'event', doors.length
        ? `Instigate: special events now wait behind ${doors.length === 1 ? `cell ${cellLabel(doors[0].n)}` : `cells ${doors.map((c) => cellLabel(c.n)).join(' and ')}`}.`
        : 'Instigate: no locked door was free for a new event.', { type: 'instigate', cells: doors.map((c) => c.n) });
    } else if (choice === 'bestow') {
      const pool = boardInmates(state).filter((i) => i.tier < RAINBOW);
      const at = state.log.length;
      if (pool.length) {
        const who = pickOne(state, pool);
        const before = snap(who);
        const cell = cellOf(state, who.id).n;
        promote(state, who, 1, false, events);
        logAt(state, at, 'event', `Bestow: the ${describe(before)} in cell ${cellLabel(cell)} rises to ${tierName(before.tier + 1)}.`, { type: 'bestow', cell, who: before });
      } else {
        log(state, 'event', 'Bestow: nobody was on the block to rise.', { type: 'bestow', cell: null, who: null });
      }
    } else {
      return fail('Choose Instigate or Bestow.');
    }
    state.phase = 'manage';
    return ok(events);
  }

  // After the warden's walk: the Long-Chained Shackles reward a long one, the
  // Short-Chained Shackles a short one, and every cell walked counts for
  // Prison Walk.
  function walked(state, steps, events) {
    if (has(state, 'shortchain') && steps <= 3 && rand(state) < 0.5) {
      const sealed = state.cells.filter((c) => c.sealed);
      if (sealed.length) {
        const target = pickOne(state, sealed);
        log(state, 'tool', `Short-Chained Shackles: a ${steps}-cell walk opens cell ${cellLabel(target.n)}.`, { type: 'shortchain', cell: target.n });
        openCell(state, target, 'side', events);
      }
    }
    if (has(state, 'shackles') && steps >= 4 && rand(state) < 0.4) {
      const pool = boardInmates(state).filter((i) => i.tier < RAINBOW);
      if (pool.length) {
        const who = pickOne(state, pool);
        log(state, 'tool', `Long-Chained Shackles: a ${steps}-cell walk raises the ${describe(who)} in cell ${cellLabel(cellOf(state, who.id).n)} a tier.`, { type: 'shackles', cell: cellOf(state, who.id).n, who: snap(who) });
        promote(state, who, 1, false, events);
      }
    }
    const o = state.objective;
    if (o.id !== 'walk' || state.milestone) return;
    o.progress = Math.min(OBJECTIVES.walk.need, o.progress + steps);
    if (o.progress >= OBJECTIVES.walk.need) meetObjective(state, `${OBJECTIVES.walk.need} tiles moved`);
  }

  function resolveEvent(state, accept) {
    if (state.phase !== 'event' || !state.event) return fail('There is no special event to decide.');
    if (state.pending.length) return fail('Make your pending choice first.');
    const { kind, cell: n } = state.event;
    const events = [];
    const name = eventName(kind);
    if (!accept) {
      state.event = null;
      state.phase = 'manage';
      log(state, 'event', `Skipped the ${name}.`, { type: 'skipped', name });
      return ok(events);
    }
    if (kind === 'chain') {
      state.chain = true;
      log(state, 'event', 'Chain reaction armed: your next patrol opens every sealed cell on the clockwise walk to its destination.', { type: 'armed' });
    } else if (kind === 'trickster') {
      const who = state.cells[n].inmate;
      if (!who) return fail('Nobody is left in that cell for the event to change.');
      const before = snap(who);
      const scarce = scarceBeasts(state);
      who.beast = pickOne(state, scarce);
      who.tier = SUPREME;
      checkPrey(state);
      const why = scarce.length === 1 ? `the scarcest beast on the block` : `drawn from the ${scarce.length} scarcest beasts`;
      log(state, 'event', `Behind Closed Doors: the ${describe(before)} in cell ${cellLabel(n)} is now a ${describe(who)} (${why}).`, { type: 'trickster', cell: n, who: before, after: snap(who) });
      events.push({ type: 'promote', cell: n, from: before.tier, to: who.tier });
      // The card says it triggers no other effects: no instrument reacts. The
      // run's objective still counts the Supreme.
      afterGrowth(state, who, events);
    } else if (kind === 'crow') {
      // The next locked cells clockwise from the warden show their rarity;
      // open cells, nests and the office are passed over.
      const seen = [];
      for (let i = 1; i < CELL_COUNT && seen.length < CROW_CELLS; i++) {
        const c = state.cells[(n + i) % CELL_COUNT];
        if (!c.sealed || c.nest) continue;
        hiddenOf(state, c);
        c.known = Math.max(c.known, 1);
        seen.push(c);
      }
      log(state, 'event', seen.length
        ? `Crow Whispers: ${seen.map((c) => `cell ${cellLabel(c.n)} holds a ${tierName(c.hidden.tier)}`).join(', ')}.`
        : 'Crow Whispers: no locked cell was left to reveal.', { type: 'crow', cells: seen.map((c) => c.n) });
    } else if (kind === 'usurp1' || kind === 'usurp2') {
      // Random inmates rise a tier: 1 for Usurpation I, 2 for Usurpation II
      // (its card hasn't been seen yet; the user expects 2).
      const picks = shuffle(state, boardInmates(state).filter((i) => i.tier < RAINBOW)).slice(0, kind === 'usurp1' ? 1 : 2);
      const at = state.log.length;
      const raised = picks.map((who) => ({ who: snap(who), cell: cellOf(state, who.id).n }));
      for (const who of picks) if (boardCellOf(state, who.id)) promote(state, who, 1, false, events);
      if (raised.length) {
        logAt(state, at, 'event', `${eventName(kind)}: ${raised.map((r) => `the ${describe(r.who)} in cell ${cellLabel(r.cell)}`).join(' and ')} ${raised.length === 1 ? 'rises' : 'rise'} a tier.`, { type: kind, raised });
      } else {
        log(state, 'event', `${eventName(kind)}: nobody was on the block to rise.`, { type: kind, raised: [] });
      }
      if (kind === 'usurp1') {
        // Usurpation I leaves the pool and Usurpation II joins it, and one
        // appears behind a random locked door at once.
        state.eventPool = (state.eventPool || EVENT_POOL).filter((id) => id !== 'usurp1');
        if (!state.eventPool.includes('usurp2')) state.eventPool.push('usurp2');
        const free = state.cells.filter((c) => c.sealed && !c.event && !c.nest);
        if (free.length) {
          const door = pickOne(state, free);
          door.event = 'usurp2';
          door.seen = true;
          log(state, 'event', `Usurpation II now waits behind cell ${cellLabel(door.n)}.`);
        }
      }
    } else if (kind === 'freedom') {
      // Random locked cells open, setting nothing else off.
      const doors = shuffle(state, state.cells.filter((c) => c.sealed)).slice(0, FREEDOM_CELLS);
      log(state, 'event', doors.length ? `Taste of Freedom: ${doors.length === 1 ? `cell ${cellLabel(doors[0].n)} opens` : `cells ${doors.map((c) => cellLabel(c.n)).join(', ')} open`}.` : 'Taste of Freedom: no locked cell was left to open.', { type: 'freedom', cells: doors.map((c) => c.n) });
      for (const c of doors) openCell(state, c, 'side', events);
    } else if (kind === 'convict') {
      // A random locked cell opens on a Legendary or better inmate, rolled
      // with the door odds above Rare. Like any extra door, it sets nothing
      // else off.
      const sealed = state.cells.filter((c) => c.sealed);
      if (sealed.length) {
        const target = pickOne(state, sealed);
        const weights = state.params.tierWeights.map((w, t) => (t >= 3 ? w : 0));
        const tier = weights.some((w) => w > 0) ? pickIndex(state, weights) : 3;
        log(state, 'event', `High-Risk Convict: cell ${cellLabel(target.n)} opens on a ${tierName(tier)} inmate.`, { type: 'convict', cell: target.n });
        openCell(state, target, 'side', events, { beast: BEASTS[pickIndex(state, state.params.beastWeights)], tier });
      } else {
        log(state, 'event', 'High-Risk Convict: no locked cell was left to open.', { type: 'convict', cell: null });
      }
    } else if (kind === 'appetite') {
      const who = pickOne(state, lowestInmates(state));
      const at = state.log.length;
      const before = snap(who);
      const where = cellOf(state, who.id).n;
      let gain = 0;
      for (let i = 0; i < APPETITE_TRIES; i++) if (rand(state) < APPETITE_ODDS) gain += 1;
      // Rarity only: the beast stays.
      if (gain) promote(state, who, gain, false, events);
      const after = { beast: before.beast, tier: Math.min(RAINBOW, before.tier + gain) };
      logAt(state, at, 'event', gain
        ? `Ravenous Appetite: the ${describe(before)} in cell ${cellLabel(where)} won ${gain} of ${APPETITE_TRIES} tries and rose to ${tierName(after.tier)}.`
        : `Ravenous Appetite: the ${describe(before)} in cell ${cellLabel(where)} won none of its ${APPETITE_TRIES} tries.`, { type: 'appetite', cell: where, who: before, after, gain });
    } else {
      const cell = state.cells[n];
      const exec = cell.inmate;
      if (!exec) return fail('Nobody is left in that cell to carry out the execution.');
      const victims = executionVictims(state, n);
      const at = state.log.length;
      const names = victims.map((c) => `${describe(c.inmate)} (${cellLabel(c.n)})`);
      const record = { type: 'execution', cell: n, who: snap(exec), victims: victims.map((c) => snap(c.inmate)) };
      for (const c of victims) {
        emptyCell(state, c);
        events.push({ type: 'devour', from: n, to: c.n });
      }
      state.stats.executions += 1;
      checkPrey(state);
      const before = describe(exec);
      if (victims.length) promote(state, exec, victims.length, state.params.executionRerolls, events);
      record.after = snap(exec);
      logAt(state, at, 'event', victims.length
        ? `Execution: the ${before} in cell ${cellLabel(n)} removed ${names.join(', ')} and rose ${victims.length} ${victims.length === 1 ? 'tier' : 'tiers'}.`
        : `Execution: the ${before} in cell ${cellLabel(n)} found nobody to execute.`, record);
    }
    state.event = null;
    state.phase = 'manage';
    return ok(events);
  }

  // Resolves one bite without the phase checks, so gifts and chains can reuse
  // it. `chained` marks the bites a chain takes by itself, after the first.
  // Returns a record of the bite for the log.
  function doDevour(state, from, option, events, chained) {
    const eaterCell = state.cells[from];
    const mealCell = state.cells[option.cell];
    const eater = eaterCell.inmate;
    const meal = mealCell.sealed ? mealCell.hidden : mealCell.inmate;
    const bite = { from, cell: option.cell, scratch: !!option.scratch, eater: snap(eater), meal: snap(meal) };
    countObjective(state, 'consume', 'consumes');
    const wasRat = eater.beast === 'rat';
    emptyCell(state, mealCell);
    // The Muzzle counts the block after the meal is gone.
    const crowd = boardCells(state).length;
    let gain = option.scratch ? 2 + (state.params.scratchStacksBase ? 1 : 0) : 1;
    const notes = [];
    if (option.scratch) notes.push(`scratch +${gain - 1}`);
    if (has(state, 'muzzle') && crowd <= 4) {
      gain += 2;
      notes.push('Agonizing Muzzle +2');
    }
    if (has(state, 'skewer') && wasRat) {
      gain += 1;
      notes.push('Skewered Rat Heads +1');
    }
    if (has(state, 'saw') && rand(state) < 0.25) {
      gain += 1;
      notes.push('Rusty Saw +1');
    }
    if (has(state, 'whip') && rand(state) < 0.35) {
      gain += 1;
      notes.push('Barbed Whip +1');
    }
    if (chained && has(state, 'collar') && rand(state) < 0.8) {
      gain += 1;
      notes.push('Barbed Collar +1');
    }
    const revenge = has(state, 'revenge') && rand(state) < 0.3;
    events.push({ type: 'devour', from, to: option.cell });
    promote(state, eater, gain, true, events);
    state.stats.devours += 1;
    Object.assign(bite, { gain, notes, after: snap(eater) });
    checkPrey(state);
    if (revenge && boardCellOf(state, eater.id)) {
      const sealed = state.cells.filter((c) => c.sealed);
      if (sealed.length) {
        const target = pickOne(state, sealed);
        const food = pickOne(state, eatsOf(state, eater.beast));
        log(state, 'tool', `Avenger's Casket: cell ${cellLabel(target.n)} opens with a meal for the ${describe(eater)}.`);
        openCell(state, target, 'side', events, { beast: food, tier: eater.tier });
      }
    }
    // Crowded Beastcage: the eaten inmate's cell may open again at once,
    // holding someone new.
    if (has(state, 'cage') && mealCell.sealed && rand(state) < 0.4) {
      log(state, 'tool', `Crowded Beastcage: cell ${cellLabel(mealCell.n)} opens again.`, { type: 'cage', cell: mealCell.n });
      openCell(state, mealCell, 'side', events);
    }
    return bite;
  }

  // One log entry for a whole devour, inserted before the side effects that
  // were logged while it resolved. Its record lists every bite.
  function logDevour(state, at, bites) {
    if (!bites.length) return;
    const first = bites[0];
    const last = bites[bites.length - 1];
    const end = last.after.tier >= RAINBOW ? ' It reached Rainbow and left for the vault.' : '';
    let text;
    if (bites.length === 1) {
      const outcome = last.after.tier < RAINBOW ? ` and is now a ${beastName(last.after.beast)}` : '';
      text = `The ${describe(first.eater)} in cell ${cellLabel(first.from)} devoured the ${first.scratch ? 'scratched-door ' : ''}${describe(first.meal)} in cell ${cellLabel(first.cell)}. It rose to ${tierName(last.after.tier)}${outcome}${first.notes.length ? ` (${first.notes.join(', ')})` : ''}.`;
    } else {
      const steps = bites.map((b) => `${describe(b.eater)} ate ${b.scratch ? 'the scratched-door ' : ''}${describe(b.meal)} (${cellLabel(b.cell)})${b.notes.length ? ` [${b.notes.join(', ')}]` : ''}`);
      text = `Devour chain, ${bites.length} bites, from cell ${cellLabel(first.from)}: ${steps.join('; then ')}.${end || ` It ended as a ${describe(last.after)}.`}`;
    }
    logAt(state, at, 'devour', text, { type: 'devour', from: first.from, bites });
  }

  function devour(state, from, to) {
    const blocked = guard(state, 'manage');
    if (blocked) return blocked;
    if (state.used.swap > 0 && !state.used.devourAfterSwap) return fail('You swapped today, and a day has a swap or a devour, not both. End the day.');
    if (!canDevourNow(state)) return fail('Today’s devour is used. End the day for another.');
    if (from !== state.position) return fail(`Only the inmate in the warden's cell (${cellLabel(state.position)}) can start a devour.`);
    const option = devourOptions(state, from).find((o) => o.cell === to);
    if (!option) return fail('That inmate cannot devour that target.');
    const events = [];
    state.used.devour += 1;
    state.chaining = { eater: state.cells[from].inmate.id, at: state.log.length, bites: [] };
    state.chaining.bites.push(doDevour(state, from, option, events));
    goOnChain(state, events);
    return ok(events);
  }

  // The eater's meals while its chain waits for a pick.
  function chainOptions(state) {
    const cell = state.chaining ? boardCellOf(state, state.chaining.eater) : null;
    return cell ? devourOptions(state, cell.n) : [];
  }

  // After each bite the chain must go on while the eater has a meal: a
  // single meal is taken at once, and a choice waits for the player's pick
  // (chainBite). Every bite raises a tier, so it ends by Rainbow at the
  // latest. The whole chain is logged as one entry, where it began.
  function goOnChain(state, events) {
    const ch = state.chaining;
    for (let cell = boardCellOf(state, ch.eater); cell; cell = boardCellOf(state, ch.eater)) {
      const options = devourOptions(state, cell.n);
      if (!options.length) break;
      if (options.length > 1) return;
      ch.bites.push(doDevour(state, cell.n, options[0], events, true));
      state.stats.chains += 1;
    }
    state.chaining = null;
    logDevour(state, ch.at, ch.bites);
  }

  // The player's pick of the chain's next meal.
  function chainBite(state, to) {
    if (!state.chaining) return fail('No devour chain is waiting for a meal.');
    if (state.pending.length) return fail('Make your pending choice first.');
    const cell = boardCellOf(state, state.chaining.eater);
    const option = cell ? devourOptions(state, cell.n).find((o) => o.cell === to) : null;
    if (!option) return fail('The chain can’t take that meal.');
    const events = [];
    state.chaining.bites.push(doDevour(state, cell.n, option, events, true));
    state.stats.chains += 1;
    goOnChain(state, events);
    return ok(events);
  }

  // Swaps the inmate in the warden's cell; no other cell can be swapped.
  function swap(state, n = state.position) {
    const blocked = guard(state, 'manage');
    if (blocked) return blocked;
    if (n !== state.position) return fail(`Only the inmate in the warden's cell (${cellLabel(state.position)}) can be swapped.`);
    const cell = state.cells[n];
    if (!cell || cell.sealed || !cell.inmate) return fail('The warden’s cell has no inmate to swap.');
    if (state.used.devour > 0) return fail('You devoured today, and a day has a devour or a swap, not both. End the day.');
    if (state.used.swap >= state.params.swapsPerDay) return fail('No swaps left today.');
    if (state.used.noSwap) return fail('Your game offers no Replace today.');
    const weights = state.params.tierWeights.slice();
    if (has(state, 'rope')) weights[0] = weights[1] = 0;
    if (!weights.some((w) => w > 0)) return fail('No rarity is left to roll. Adjust the rarity weights in the Lab.');
    const old = cell.inmate;
    const events = [{ type: 'swap', cell: n }];
    const at = state.log.length;
    cell.inmate = null;
    checkPrey(state);
    // Scapegoat's Guillotine: with 2 or more others on the block, 2 of them
    // go, and the newcomer comes in above the rarity it replaces (a tier
    // above when the rarity weights reach no higher).
    let above = false;
    if (has(state, 'scapegoat')) {
      const others = boardCells(state);
      if (others.length >= 2) {
        const victims = shuffle(state, others).slice(0, 2);
        const names = victims.map((c) => `the ${describe(c.inmate)} in ${cellLabel(c.n)}`);
        for (const v of victims) {
          emptyCell(state, v);
          events.push({ type: 'removed', cell: v.n });
        }
        checkPrey(state);
        log(state, 'tool', `Scapegoat's Guillotine: ${names.join(' and ')} go, so the swap comes in above ${TIERS[old.tier]}.`, { type: 'scapegoat', cell: n, removed: victims.map((c) => c.n) });
        above = true;
      }
    }
    const higher = weights.map((w, t) => (t > old.tier ? w : 0));
    const fresh = rollInmate(state, above && higher.some((w) => w > 0) ? higher : weights);
    if (above && fresh.tier <= old.tier) fresh.tier = Math.min(RAINBOW, old.tier + 1);
    // Burning Stake: replacing an inmate below Legendary may bring in a
    // Legendary.
    const staked = has(state, 'stake') && old.tier < 3 && rand(state) < 0.4 && fresh.tier !== 3;
    if (staked) fresh.tier = 3;
    if (has(state, 'pestle')) fresh.beast = old.beast;
    cell.inmate = fresh;
    state.used.swap += 1;
    state.stats.swaps += 1;
    logAt(state, at, 'swap', `Swapped out the ${describe(old)} in cell ${cellLabel(n)}. In came a ${describe(fresh)}.`, { type: 'swap', cell: n, old: snap(old), fresh: snap(fresh) });
    if (staked) log(state, 'tool', `Burning Stake: the ${describe(fresh)} in cell ${cellLabel(n)} came in Legendary.`, { type: 'stake', cell: n });
    // Severed Iron Maiden: as many inmates above the newcomer's rarity as below it.
    if (has(state, 'maiden')) {
      const others = boardInmates(state).filter((i) => i.id !== fresh.id);
      const above = others.filter((i) => i.tier > fresh.tier).length;
      if (above === others.filter((i) => i.tier < fresh.tier).length) {
        log(state, 'tool', `Severed Iron Maiden: ${above ? `${plural(above, 'inmate')} above it and as many below` : 'nobody above or below it'}, so the ${describe(fresh)} in cell ${cellLabel(n)} gains 3 tiers.`, { type: 'maiden', cell: n });
        promote(state, fresh, 3, false, events);
      }
    }
    afterGrowth(state, fresh, events);
    if (has(state, 'axe') && fresh.tier > old.tier) {
      const doors = shuffle(state, state.cells.filter((c) => c.sealed)).slice(0, 2);
      if (doors.length) {
        log(state, 'tool', `Gaoler's Execution Axe: the swap raised the rarity, so ${doors.length === 1 ? `cell ${cellLabel(doors[0].n)} opens` : `cells ${doors.map((c) => cellLabel(c.n)).join(' and ')} open`}.`);
        for (const c of doors) openCell(state, c, 'side', events);
      }
    }
    if (has(state, 'scales') && rand(state) < 0.8) scout(state);
    if (cell.ivory && boardCellOf(state, fresh.id)) {
      const pool = boardInmates(state).filter((i) => state.params.ivoryIncludesSwapped || i.id !== fresh.id);
      const picks = shuffle(state, pool).slice(0, state.params.ivoryCount);
      if (picks.length) {
        log(state, 'ivory', `Tusk: ${plural(picks.length, 'inmate')} each gain a tier (cells ${picks.map((i) => cellLabel(cellOf(state, i.id).n)).join(', ')}).`, { type: 'ivory', count: picks.length });
        for (const i of picks) if (boardCellOf(state, i.id)) promote(state, i, 1, false, events);
      }
    }
    return ok(events);
  }

  // Warden's Scales: the highest-rarity inmate behind the locked doors is
  // shown, beast and rarity, while its door stays locked.
  function scout(state) {
    const doors = state.cells.filter((c) => c.sealed && !c.nest);
    if (!doors.length) return;
    for (const c of doors) hiddenOf(state, c);
    const top = Math.max(...doors.map((c) => c.hidden.tier));
    const cell = pickOne(state, doors.filter((c) => c.hidden.tier === top));
    cell.known = 2;
    log(state, 'tool', `Warden's Scales: cell ${cellLabel(cell.n)} holds a ${describe(cell.hidden)}, the best behind the locked doors.`);
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
    if (state.chaining) {
      logDevour(state, state.chaining.at, state.chaining.bites);
      state.chaining = null;
    }
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
    log(state, 'contract', `Delivered "${contract.name}" by ${ESCORTS[escortKey].name.toLowerCase()} (${plural(check.cost, 'voucher')}, pressure ${check.pressure}, ${check.points} points): ${names.join(', ')}.`, { type: 'deliver', name: contract.name, points: check.points, cells: [...new Set(cellNumbers || [])], vault: [...new Set(vaultIds || [])], escort: escortKey });
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
    log(state, 'contract', `Skipped "${contract.name}". Your inmates and vouchers stay put.`, { type: 'skip', name: contract.name });
    const events = [];
    afterDelivery(state, events);
    return ok(events);
  }

  function canOpenEarly(state) {
    const ch = state.challenge;
    return !!ch && !ch.window && state.phase !== 'ended' && ch.deliveries.length === 2 && state.day >= 9 && state.day <= CHALLENGE_DAYS && ['patrol', 'manage'].includes(state.phase) && !state.pending.length && !state.event && !state.chaining;
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
      log(state, 'tool', `Took the ${TOOLS[id].name}.`, { type: 'tool', id });
      if (state.phase === 'patrol') fitDestinations(state);
    }
    // A gift can remove the inmate a waiting event needs (the Brass Horn's
    // bites); the event is then lost.
    if (state.phase === 'event' && state.event && !state.cells[state.event.cell].inmate) {
      log(state, 'event', `The ${eventName(state.event.kind)} in cell ${cellLabel(state.event.cell)} is lost: nobody is left there.`);
      state.event = null;
      state.phase = 'manage';
    }
    return ok(events);
  }

  // A pet can re-roll an instrument offer ("Re-roll, Remaining attempts N"
  // in the game): 3 other instruments take the place of the ones shown. The
  // simulator's own runs have no pet; the analyzer sets the attempts left.
  function canReroll(state) {
    const choice = state.pending[0];
    return !!choice && choice.kind === 'tool' && choice.rerolls > 0;
  }

  function rerollOffer(state) {
    if (!canReroll(state)) return fail('There is no re-roll left for this offer.');
    const choice = state.pending[0];
    let pool = TOOL_IDS.filter((t) => !has(state, t) && !choice.options.includes(t));
    if (pool.length < 3) pool = TOOL_IDS.filter((t) => !has(state, t));
    choice.options = shuffle(state, pool).slice(0, 3);
    choice.rerolls -= 1;
    log(state, 'tool', `Re-rolled the offer: ${choice.options.map((t) => TOOLS[t].name).join(', ')}.`, { type: 'reroll' });
    return ok([]);
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
    log(state, 'tool', `Warden's Treasure: ${GIFTS[id].name}.`, { type: 'gift', id });
    if (id === 'ring') {
      for (const c of shuffle(state, state.cells.filter((x) => x.sealed)).slice(0, 3)) openCell(state, c, 'side', events);
    } else if (id === 'horn') {
      for (const inmateId of boardInmates(state).filter((i) => devourOptions(state, cellOf(state, i.id).n).length).map((i) => i.id)) {
        const cell = boardCellOf(state, inmateId);
        if (!cell) continue;
        const options = devourOptions(state, cell.n).filter((o) => !o.scratch);
        if (!options.length) continue;
        const at = state.log.length;
        logDevour(state, at, [doDevour(state, cell.n, pickOne(state, options), events)]);
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
          log(state, 'tool', `Brand of Original Sin: cell ${cellLabel(cell.n)} is now a ${describe(i)}.`);
        }
      }
      checkPrey(state);
    }
  }

  // ---------- Lab (drills only) ----------

  function labCheck(state) {
    if (state.mode !== 'drill') return fail('The Lab only edits drills. The contract challenge uses fixed rules.');
    if (state.phase === 'ended') return fail('This run is over.');
    if (state.phase === 'event' || state.phase === 'office' || state.pending.length || state.chaining) return fail('Finish the current decision first.');
    return null;
  }

  function editCell(state, n, spec) {
    const blocked = labCheck(state);
    if (blocked) return blocked;
    const cell = state.cells[n];
    if (!cell) return fail('Pick a cell to edit.');
    if (n === OFFICE) return fail("Cell 01 is the warden's office. Nothing can be placed there.");
    Object.assign(cell, blankCell(n));
    const beast = BEASTS.includes(spec.beast) ? spec.beast : 'mammoth';
    const tier = clamp(Math.round(Number(spec.tier)) || 0, 0, RAINBOW - 1);
    const event = EVENTS[spec.event] ? spec.event : null;
    let what;
    if (spec.kind === 'open') {
      cell.sealed = false;
      cell.inmate = makeInmate(state, beast, tier);
      cell.ivory = !!spec.ivory;
      state.stats.best = Math.max(state.stats.best, tier);
      what = `an open cell with a ${describe(cell.inmate)}${cell.ivory ? ' and Tusk' : ''}`;
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
    if (event && cell.sealed && !cell.nest) what += `, with a ${eventName(event)} event`;
    // An event placed by hand shows at once.
    cell.seen = !!cell.event;
    checkPrey(state);
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
    // Destinations always come from the cells ahead of the warden.
    if (state.phase === 'patrol') rollDestinations(state);
    log(state, 'lab', `Scene editor: the warden now stands ${n === OFFICE ? 'in the office' : `at cell ${cellLabel(n)}`}.`);
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
    const small = board.length <= 5;
    switch (id) {
      case 'muzzle': return small ? 30 : 8;
      case 'skewer': return board.filter((i) => i.beast === 'rat').length * 8;
      case 'ironbox': return state.maxDays - state.day >= state.params.nestDays ? 18 : 0;
      case 'keys':
      case 'ring': return (board.length < 4 ? 20 : 5) - (has(state, 'muzzle') && small ? 12 : 0);
      case 'revenge': return 14;
      case 'saw': return 12;
      case 'rope': return 10;
      case 'fire': return board.length < 6 ? 14 : 8;
      case 'hook': return 12;
      case 'pestle': return 4;
      case 'scales': return 6;
      case 'tongs': return board.some((i) => i.beast === 'mammoth') ? 8 : 3;
      case 'guillotine': return board.filter((i) => i.beast === 'wolf').length * 6;
      case 'axe': return 10;
      case 'shackles': return 8;
      case 'collar': return 10;
      case 'forged': return 6;
      case 'dogtag': return 12;
      case 'cage': return 12;
      case 'blacklist': return state.cells.filter((c) => c.sealed).length <= 7 ? 16 : 8;
      case 'shortchain': return 10;
      case 'maiden': return 10;
      case 'whip': return 8;
      case 'ravenous': return 8;
      case 'scapegoat': return board.length >= 3 ? 10 : 4;
      case 'stake': return 10;
      case 'coin': return 10;
      case 'wine': return board.filter((i) => i.tier < 3).length * 4;
      case 'horn': return board.filter((i) => devourOptions(state, cellOf(state, i.id).n).length).length * 6;
      case 'brand': return board.filter((i) => !devourOptions(state, cellOf(state, i.id).n).length).length * 5;
      default: return 0;
    }
  }

  // Finds the cargo with the most points for the open window, then the
  // cheapest escort. Before the heavy contract it always keeps one voucher,
  // since the run can't pass without the heavy contract.
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
          if (!contract.heavy && ch.vouchers - e.cost < 1) continue;
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

  // Scores one devour for the advisor, with a full and a short description.
  function devourTip(state, from, option, kind) {
    const eater = state.cells[from].inmate;
    const t = eater.tier;
    const { gain } = gainFor(state, from, option);
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
    const target = meal.sealed ? 'the scratched door' : beastName(meal.inmate.beast);
    const short = `${target} in ${cellLabel(option.cell)}, to ${TIERS[to]}`;
    return {
      kind,
      from,
      to: option.cell,
      score,
      short,
      text: `${beastName(eater.beast)} in ${cellLabel(from)} eats ${target} in ${cellLabel(option.cell)}: ${TIERS[to]}${gain > 1 ? ` (+${gain})` : ''}${to === RAINBOW ? ', a Rainbow' : ''}${notes.length ? `; ${notes.join(', ')}` : ''}.`,
    };
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
    if (state.chaining) {
      const from = boardCellOf(state, state.chaining.eater).n;
      return chainOptions(state).map((o) => devourTip(state, from, o, 'chain')).sort((a, b) => b.score - a.score).slice(0, 3);
    }
    if (state.phase === 'office') {
      const pool = board.filter((i) => i.tier < RAINBOW);
      const raise = pool.reduce((sum, i) => sum + WORTH[Math.min(RAINBOW, i.tier + 1)] - WORTH[i.tier], 0) / Math.max(1, pool.length);
      return [
        { kind: 'office', choice: 'bestow', score: raise, text: 'Bestow: 1 random inmate on the block rises a tier.' },
        { kind: 'office', choice: 'instigate', score: 12, text: `Instigate: ${INSTIGATE_EVENTS} special events appear behind locked doors.` },
      ].sort((a, b) => b.score - a.score);
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
      if (state.event.kind === 'trickster') {
        const who = state.cells[state.event.cell].inmate;
        const gains = who && who.tier < SUPREME;
        return [{ kind: 'event', accept: !!gains, text: gains ? `Accept: the ${describe(who)} becomes a Supreme.` : 'Skip: it is already a Supreme, and only its beast would change.' }];
      }
      if (state.event.kind === 'appetite') return [{ kind: 'event', accept: true, text: `Accept: a lowest-rarity inmate gets ${APPETITE_TRIES} tries at +1 tier.` }];
      if (state.event.kind === 'convict') return [{ kind: 'event', accept: true, text: 'Accept: a locked cell opens on a Legendary or better inmate.' }];
      if (state.event.kind === 'crow') return [{ kind: 'event', accept: true, text: `Accept: the rarity behind the next ${CROW_CELLS} locked cells is shown.` }];
      if (state.event.kind === 'freedom') return [{ kind: 'event', accept: true, text: `Accept: ${FREEDOM_CELLS} random locked cells open.` }];
      if (state.event.kind === 'usurp1' || state.event.kind === 'usurp2') return [{ kind: 'event', accept: true, text: `Accept: ${state.event.kind === 'usurp1' ? 'a random inmate rises' : '2 random inmates rise'} a tier.` }];
      const keepSmall = has(state, 'muzzle') && board.length <= 5;
      return [{ kind: 'event', accept: !keepSmall, text: keepSmall ? 'Skip: a chain would flood the block and switch off the Agonizing Muzzle.' : 'Accept: your next patrol opens every sealed cell on the way to its destination.' }];
    }
    if (state.phase === 'patrol') {
      for (const n of patrolOptions(state)) {
        const c = state.cells[n];
        let score;
        let why;
        if (!c.sealed && c.inmate) {
          // Walking to a known inmate makes it the one that devours today.
          const best = devourOptions(state, n).map((o) => devourTip(state, n, o, 'devour')).sort((a, b) => b.score - a.score)[0];
          score = best ? 10 + best.score : has(state, 'muzzle') && board.length <= 5 ? 8 : 2;
          why = best ? `its ${describe(c.inmate)} can then devour (${best.short})` : `its ${describe(c.inmate)} has no target from there`;
        } else if (!c.sealed) {
          score = 1;
          why = 'an empty cell';
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
        if (c.sealed && c.event && c.seen) {
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
    // Only the inmate in the warden's cell can start the day's devour.
    for (const option of startOptions(state)) tips.push(devourTip(state, state.position, option, 'devour'));
    // Only the warden's cell can be swapped.
    const here = state.cells[state.position];
    if (canSwapNow(state) && here.ivory && !here.sealed && here.inmate) {
      tips.push({ kind: 'swap', cell: here.n, score: 20 + Math.min(board.length, state.params.ivoryCount) * 6, text: `Swap the inmate in Tusk cell ${cellLabel(here.n)}: up to ${plural(state.params.ivoryCount, 'inmate')} gain a tier.` });
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
    data.params = data.mode === 'challenge' ? challengeParams(data.params) : normalizeParams(data.params);
    data.prey = Array.isArray(data.prey) ? data.prey : [];
    data.vault = Array.isArray(data.vault) ? data.vault : [];
    data.tools = Array.isArray(data.tools) ? data.tools.filter((t) => TOOLS[t]) : [];
    data.pending = Array.isArray(data.pending) ? data.pending : [];
    data.destinations = Array.isArray(data.destinations) ? data.destinations : [];
    data.used = Object.assign(freshDay(), data.used || {});
    data.stats = Object.assign({ patrols: 0, opened: 0, devours: 0, chains: 0, swaps: 0, executions: 0, best: 0 }, data.stats || {});
    data.rng = Number(data.rng) >>> 0;
    data.cache = Number(data.cache) || 0;
    data.position = clamp(Number(data.position) || 0, 0, CELL_COUNT - 1);
    // Saves from before objectives played for King of the Caged.
    const goal = data.objective && OBJECTIVES[data.objective.id] ? data.objective : { id: 'king', progress: 0 };
    data.objective = { id: goal.id, progress: clamp(Number(goal.progress) || 0, 0, 99) };
    data.milestone = !!data.milestone;
    const ch = data.chaining;
    data.chaining = ch && Array.isArray(ch.bites) && ch.bites.length && boardCellOf(data, ch.eater) ? { eater: ch.eater, at: clamp(Number(ch.at) || 0, 0, data.log.length), bites: ch.bites } : null;
    // Saves from before events hid until passed showed every event.
    for (const c of data.cells) if (c.seen === undefined) c.seen = true;
    data.eventPool = Array.isArray(data.eventPool) && data.eventPool.length ? data.eventPool.filter((id) => EVENTS[id]) : EVENT_POOL.slice();
    delete data.chainConsume;
    return data;
  }

  // Wraps a public action so the log stays bounded whatever happened inside.
  const bounded = (fn) => (state, ...args) => {
    const result = fn(state, ...args);
    trimLog(state);
    return result;
  };

  const api = {
    VERSION, CELL_COUNT, OFFICE, SUPREME, RAINBOW, TIERS, BEASTS, BEAST_INFO, FOOD_CHAIN, PRESSURE, ESCORTS, TOOLS, TOOL_IDS, GIFTS, GIFT_IDS,
    EVENTS, EVENT_IDS, EVENT_POOL, APPETITE_TRIES, APPETITE_ODDS, INSTIGATE_EVENTS, CROW_CELLS, FREEDOM_CELLS, OBJECTIVES, OBJECTIVE_IDS,
    LOADOUTS, SCENARIOS, CONTRACT_SLOTS, DEFAULT_PARAMS, PARAM_FIELDS, CHALLENGE_DAYS, START_VOUCHERS,
    newGame, randomSeed, normalizeParams, serialize, deserialize,
    patrol: bounded(patrol),
    resolveEvent: bounded(resolveEvent),
    devour: bounded(devour),
    chainBite: bounded(chainBite),
    officeAct: bounded(officeAct),
    swap: bounded(swap),
    endDay: bounded(endDay),
    endRun: bounded(endRun),
    deliver: bounded(deliver),
    skipDelivery: bounded(skipDelivery),
    openEarlyDelivery: bounded(openEarlyDelivery),
    cancelEarlyDelivery: bounded(cancelEarlyDelivery),
    choose: bounded(choose),
    refreshRefit: bounded(refreshRefit),
    rerollOffer: bounded(rerollOffer),
    editCell: bounded(editCell),
    markPrey: bounded(markPrey),
    moveWarden: bounded(moveWarden),
    addTool: bounded(addTool),
    removeTool: bounded(removeTool),
    patrolOptions, clockwisePath, devourOptions, startOptions, chainOptions, gainFor, executionVictims, canEat, eatsOf, canDevourNow, canSwapNow, canOpenEarly, canRefresh, canReroll,
    linkOf, cellOf, boardInmates, currentContract, deliveryCheck, bestCargo, rosterOf, advise, limits,
    toolText, toolName, eventName, describe, tierName, beastName, cellLabel, plural, stepsBetween, scarceBeasts, lowestInmates,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  root.Tartarus = api;
})(typeof window !== 'undefined' ? window : globalThis);
