/* Tartarus Simulator: the live board collector.
 * The board analyzer sends the boards players ask about, once a run has two
 * or more in a row. This Worker rebuilds each snapshot from the fields it
 * knows (anything else is dropped), stores it in D1, and hands the rows to
 * the repo's scheduled export. There are no accounts and no addresses are
 * kept: limits are counted against a salted hash that changes every day. */

const MAX_BODY = 200000; // bytes per upload
const MAX_BATCH = 10; // snapshots per upload
const DAILY_QUOTA = 1500; // snapshots per address per day
const EXPORT_PAGE = 2000;

const STEPS = ['patrol', 'manage', 'event', 'choice', 'window'];
const KINDS = ['sealed', 'inmate', 'empty', 'scratch', 'scouted', 'nest'];
const BEASTS = ['mammoth', 'lion', 'wolf', 'rat'];
const EVENTS = ['unknown', 'chain', 'execution'];
const ACTIONS = ['patrol', 'devour', 'swap', 'end', 'event', 'choose', 'deliver', 'skip', 'close', 'early'];
const ID = /^[A-Za-z0-9_-]{8,40}$/;
const WORD = /^[a-z]{1,16}$/;
const KEY = /^(c\d{1,2}|dest|event|choice)$/;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === '/v1/snapshots' && request.method === 'POST') return await receive(request, env);
      if (url.pathname === '/v1/export' && request.method === 'GET') return await exportRows(request, env, url);
      if (url.pathname === '/v1/health') return json({ ok: true });
      return json({ error: 'Not found.' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'Server error.' }, 500);
    }
  },
};

// ---------- Uploads ----------

async function receive(request, env) {
  const text = await request.text();
  if (text.length > MAX_BODY) return json({ error: 'Too large.' }, 413);
  let input;
  try {
    input = JSON.parse(text);
  } catch (e) {
    return json({ error: 'Not JSON.' }, 400);
  }
  const items = Array.isArray(input && input.items) ? input.items.slice(0, MAX_BATCH) : [];
  if (!items.length) return json({ error: 'No snapshots.' }, 400);

  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const key = await sha256(`${env.IP_SALT || ''}|${day}|${ip}`);
  if (env.LIMIT) {
    const { success } = await env.LIMIT.limit({ key });
    if (!success) return json({ error: 'Too many uploads. Try again in a minute.' }, 429);
  }

  const clean = [];
  let rejected = 0;
  for (const item of items) {
    try {
      clean.push(cleanItem(item));
    } catch (e) {
      rejected += 1;
    }
  }
  if (!clean.length) return json({ stored: 0, rejected }, 400);

  const used = await env.DB.prepare('INSERT INTO quota (key, day, n) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET n = n + ?3 RETURNING n')
    .bind(key, day, clean.length)
    .first('n');
  if (used > DAILY_QUOTA) return json({ error: 'Daily limit reached.' }, 429);

  const insert = env.DB.prepare('INSERT OR IGNORE INTO snapshots (uid, received, client, run, seq, app, body) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const results = await env.DB.batch(
    clean.map((s) => insert.bind(s.uid, day, s.client, s.run, s.seq, s.app, JSON.stringify({ t: s.t, board: s.board, via: s.via }))),
  );
  const stored = results.reduce((sum, r) => sum + (r.meta && r.meta.changes ? r.meta.changes : 0), 0);
  return json({ stored, rejected });
}

// ---------- Cleaning ----------
// Each snapshot is rebuilt from the fields the analyzer sends. Anything out
// of range throws, and that snapshot is rejected.

function bad(what) {
  throw new Error(`Bad ${what}`);
}

const int = (v, lo, hi, what) => (Number.isInteger(v) && v >= lo && v <= hi ? v : bad(what));
const oneOf = (v, list, what) => (list.includes(v) ? v : bad(what));
const bool = (v) => v === true;
const list = (v, max, each, what) => (Array.isArray(v) && v.length <= max ? v.map(each) : bad(what));
const word = (v) => (typeof v === 'string' && WORD.test(v) ? v : bad('word'));

function cleanItem(s) {
  if (!s || typeof s !== 'object') bad('item');
  const id = (v, what) => (typeof v === 'string' && ID.test(v) ? v : bad(what));
  const t = Number.isFinite(s.t) && s.t > 1767225600000 && s.t < Date.now() + 86400000 ? Math.round(s.t) : null;
  return {
    uid: id(s.uid, 'uid'),
    client: id(s.client, 'client'),
    run: id(s.run, 'run'),
    seq: int(s.seq, 0, 100000, 'seq'),
    app: typeof s.app === 'string' && /^[\w.-]{0,24}$/.test(s.app) ? s.app : bad('app'),
    t,
    board: cleanBoard(s.board),
    via: s.via ? cleanVia(s.via) : null,
  };
}

function cleanBoard(b) {
  if (!b || typeof b !== 'object' || !Array.isArray(b.cells) || b.cells.length !== 16) bad('board');
  const challenge = b.mode === 'challenge';
  const choice = b.choice && typeof b.choice === 'object' ? b.choice : {};
  return {
    mode: oneOf(b.mode, ['drill', 'challenge'], 'mode'),
    chain: oneOf(b.chain, ['single', 'two'], 'chain'),
    rewards: bool(b.rewards),
    day: int(b.day, 1, 60, 'day'),
    maxDays: int(b.maxDays, 1, 60, 'maxDays'),
    step: oneOf(b.step, STEPS, 'step'),
    warden: int(b.warden, 0, 15, 'warden'),
    dest: list(b.dest, 16, (n) => int(n, 1, 15, 'dest'), 'dest'),
    devourUsed: bool(b.devourUsed),
    swapUsed: bool(b.swapUsed),
    eventKind: b.eventKind === 'execution' ? 'execution' : 'chain',
    choice: { kind: oneOf(choice.kind || 'tool', ['tool', 'refit', 'gift'], 'choice'), options: list(choice.options || [], 8, word, 'options') },
    windowKind: b.windowKind === 'early' ? 'early' : 'due',
    chainArmed: bool(b.chainArmed),
    milestone: bool(b.milestone),
    tools: list(b.tools || [], 16, word, 'tools'),
    vault: list(b.vault || [], 60, (v) => oneOf(v, BEASTS, 'vault'), 'vault'),
    cells: b.cells.map(cleanCell),
    ch: challenge ? cleanContracts(b.ch) : null,
    ended: bool(b.ended),
  };
}

function cleanCell(c, n) {
  if (n === 0) return { kind: 'office' };
  if (!c || typeof c !== 'object') bad('cell');
  const kind = oneOf(c.kind, KINDS, 'kind');
  const event = c.event == null ? null : oneOf(c.event, EVENTS, 'event');
  switch (kind) {
    case 'sealed':
      return { kind, event };
    case 'inmate':
      return {
        kind,
        beast: oneOf(c.beast, BEASTS, 'beast'),
        tier: int(c.tier, 0, 5, 'tier'),
        ivory: bool(c.ivory),
        prey: c.prey ? { cell: int(c.prey.cell, 1, 15, 'prey'), rounds: int(c.prey.rounds, 1, 9, 'prey') } : null,
      };
    case 'scratch':
      return { kind, tier: int(c.tier, 0, 5, 'tier'), event };
    case 'scouted':
      return { kind, beast: oneOf(c.beast, BEASTS, 'beast'), tier: int(c.tier, 0, 5, 'tier'), event };
    case 'nest':
      return { kind, due: int(c.due, 1, 99, 'due') };
    default:
      return { kind };
  }
}

function cleanContracts(ch) {
  if (!ch || typeof ch !== 'object') bad('contracts');
  return {
    vouchers: int(ch.vouchers, 0, 9, 'vouchers'),
    contracts: list(ch.contracts, 3, word, 'contracts'),
    bounty: oneOf(ch.bounty, BEASTS, 'bounty'),
    status: list(ch.status, 2, (s) => oneOf(s, ['pending', 'delivered', 'skipped'], 'status'), 'status'),
    points: list(ch.points, 2, (p) => int(p, 0, 999, 'points'), 'points'),
  };
}

// How the board got here: a move played with the simulator's dice, or a
// screenshot the reader filled in. `filled` is what the dice or the reader
// decided, `touched` what the player then set or confirmed.
function cleanVia(v) {
  if (typeof v !== 'object') bad('via');
  const keys = (k) => list(k || [], 40, (x) => (typeof x === 'string' && KEY.test(x) ? x : bad('key')), 'keys');
  const out = { filled: keys(v.filled), touched: keys(v.touched) };
  if (v.scan === true) return Object.assign({ scan: true }, out);
  const a = v.action && typeof v.action === 'object' ? v.action : bad('action');
  const action = { type: oneOf(a.type, ACTIONS, 'action') };
  if (a.cell != null) action.cell = int(a.cell, 0, 15, 'action');
  if (a.to != null) action.to = int(a.to, 0, 15, 'action');
  if (a.id != null) action.id = word(a.id);
  if (a.accept != null) action.accept = bool(a.accept);
  if (a.cells != null) action.cells = list(a.cells, 16, (n) => int(n, 0, 15, 'action'), 'action');
  if (a.vaultIds != null) action.vaultIds = list(a.vaultIds, 60, (n) => int(n, 0, 100000, 'action'), 'action');
  if (a.escort != null) action.escort = word(a.escort);
  return Object.assign({ action, label: typeof v.label === 'string' ? v.label.slice(0, 120) : '' }, out);
}

// ---------- Export ----------
// For the repo's scheduled job: every row after `after`, oldest first.

async function exportRows(request, env, url) {
  if (!env.EXPORT_TOKEN || !(await sameText(request.headers.get('Authorization') || '', `Bearer ${env.EXPORT_TOKEN}`))) {
    return json({ error: 'Unauthorized.' }, 401);
  }
  const after = Math.max(0, parseInt(url.searchParams.get('after'), 10) || 0);
  const limit = Math.min(5000, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || EXPORT_PAGE));
  const { results } = await env.DB.prepare('SELECT id, uid, received, client, run, seq, app, body FROM snapshots WHERE id > ? ORDER BY id LIMIT ?').bind(after, limit).all();
  // Yesterday's quota counters are no longer needed.
  await env.DB.prepare('DELETE FROM quota WHERE day < ?').bind(new Date().toISOString().slice(0, 10)).run();
  const rows = results.map(({ body, ...row }) => Object.assign(row, JSON.parse(body)));
  return json({ rows, last: rows.length ? rows[rows.length - 1].id : after });
}

// ---------- Helpers ----------

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compares two strings in constant time by comparing their hashes.
async function sameText(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(x, y);
}
