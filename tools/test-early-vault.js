'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const T = require('../js/engine'), S = require('../js/solver');
function board(day = 1) {
  const st = T.newGame({ seed: 'early-vault-test', params: { startTools: 0, rewards: false, eventStartChance: 0, eventActionChance: 0, eventMorningChance: 0 } });
  st.cells.forEach(c => Object.assign(c, { sealed: c.n !== 0, inmate: null, hidden: null, event: null, nest: null }));
  [[1, 'wolf', 4], [2, 'rat', 4]].forEach(([n, beast, tier]) => Object.assign(st.cells[n], { sealed: false, inmate: { id: 100 + n, beast, tier } }));
  Object.assign(st, { day, maxDays: day, position: 1, phase: 'manage', pending: [], tools: [], chaining: null });
  return st;
}
function solve(st, options) {
  const job = S.solve(st, options); let result;
  do { result = job.step(50); } while (!result.done);
  return { job, result };
}
const st = board(), before = JSON.stringify(st);
const off = solve(st, { seed: 17, rollouts: 4 });
const on = solve(st, { seed: 17, rollouts: 4, earlyVaultDays: 4 });
assert.equal(JSON.stringify(st), before, 'checks preserve the observed board');
assert.deepEqual(on.job.rows.map(r => r.vals), off.job.rows.map(r => r.vals), 'observing early gains cannot change terminal outcomes');
assert(off.job.rows.every(r => !r.earlyVals), 'default off has no early samples');
const bite = on.job.rows.find(r => r.action.type === 'devour');
assert(bite && bite.earlyVals.every(v => v === 1), 'the initial candidate banking a Rainbow is included on the last day');
assert(on.job.rows.every(r => r.vals.length === r.earlyVals.length));
const tracker = S.earlyVaultTracker({ day: 7, maxDays: 60, vault: ['old'] }, 4);
assert.equal(tracker.endDay, 10);
assert.equal(tracker.observe({ day: 7, vault: ['old', 'new'] }), 1);
assert.equal(tracker.observe({ day: 10, vault: ['old', 'new', 'last'] }), 2);
assert.equal(tracker.observe({ day: 11, vault: ['old', 'new', 'last', 'late'] }), 2, 'day five is excluded');
assert.equal(S.earlyVaultTracker({ day: 58, maxDays: 60, vault: [] }, 4).endDay, 60);
const a = { mean: 2, n: 150, earlyMean: 0, earlyVals: Array(150).fill(0) };
const b = { mean: 1.96, n: 150, earlyMean: 1, earlyVals: Array(150).fill(1) };
assert.equal(S.preferEarlyVault([a, b], a, .05), b);
assert.equal(S.preferEarlyVault([a, { ...b, mean: 1.94 }], a, .05), null, 'never spend more than terminal tolerance');
assert.equal(S.preferEarlyVault([a, { ...b, earlyVals: Array(150).fill(0) }], a, .05), null, 'uncertain/tied early outcomes keep the ordinary pick');
assert.equal(S.preferEarlyVault([a, { ...b, earlyVals: Array(149).fill(1) }], a, .05), null, 'unaligned arrays cannot be compared');
const missingA = { ...a, earlyVals: [...Array(150).fill(0), NaN], earlyMean: 0 };
const missingB = { ...b, earlyVals: [...Array(150).fill(0), 100], earlyMean: 100 / 151 };
assert.equal(S.preferEarlyVault([missingA, missingB], missingA, .05), null, 'unpaired outliers cannot create a paired advantage');
assert.equal(S.preferEarlyVault([a, { ...b, earlyVals: Array(150).fill(NaN) }], a, .05), null, 'missing rounds cannot fabricate evidence');
assert.equal(S.preferEarlyVault([a, { ...b, n: 149 }], a, .05), null);
// Execute the actual worker transport, then the actual Analyzer merge functions.
const queue = [], messages = [];
const self = { location: { search: '' }, TartarusSolver: S, postMessage: m => messages.push(structuredClone(m)) };
const worker = { self, importScripts() {}, setTimeout: fn => queue.push(fn) };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/solver-worker.js'), 'utf8'), worker);
self.onmessage({ data: { id: 2, state: st, rollouts: 4, earlyVaultDays: 4, raw: true, stream: 0 } });
while (queue.length) queue.shift()();
const direct = solve(st, { seed: 2 * 7919 + 1, rollouts: 4, earlyVaultDays: 4 });
assert.deepEqual(messages.flatMap(m => m.rows[0].earlyVals), direct.job.rows[0].earlyVals, 'raw worker and fallback use identical early samples');
const source = fs.readFileSync(path.join(__dirname, '../js/analyze.js'), 'utf8');
function declaration(name) { const start = source.indexOf(`  function ${name}(`), end = source.indexOf('\n  }', start); assert(start >= 0 && end > start); return source.slice(start, end + 4); }
const context = { S, solver: { id: 2, shares: [{ rounds: 0, done: false, rows: null }], target: 4, workers: null }, mergeTimer: 0, clearTimeout() {}, setTimeout() {}, idleLater() {}, settled: () => false, renderResults() {}, renderBoard() {}, renderCourt() {} };
vm.createContext(context);
vm.runInContext(declaration('onShare') + declaration('merge'), context);
for (const message of messages) context.onShare(0, message);
assert.deepEqual(JSON.parse(JSON.stringify(context.solver.result.options)), JSON.parse(JSON.stringify(direct.result.options)), 'Analyzer raw merge matches fallback metrics and ordering');
// The existing recommendation guards run before any optional preference.
Object.assign(context, { preferences: { earlyVault: true }, SWITCH_MIN: .05, LIVE_MIN: 150, model: { chainPaused: true }, cancelEndIntent: 'keep', cancelDecisionKey: () => 'keep' });
vm.runInContext(declaration('bestCalculatedMove') + declaration('earlierRecommendation'), context);
const end = { ...a, action: { type: 'end' }, label: 'End', gapSe: 0 };
const eat = { ...b, action: { type: 'devour', to: 2 }, label: 'Eat', gapSe: 0 };
Object.assign(context.solver, { st, instant: { action: end.action, why: 'policy' }, result: { rounds: 150, done: true, options: [end, eat] } });
assert.equal(context.bestCalculatedMove().action.type, 'end', 'chosen Cancel/end intent outranks early preference');
context.cancelEndIntent = null;
const savedShort = S.preferShortWalk;
try { S.preferShortWalk = () => eat; assert.equal(context.bestCalculatedMove().why.includes('short walk'), true); } finally { S.preferShortWalk = savedShort; }
assert.equal(context.bestCalculatedMove().action.type, 'devour', 'optional preference reaches the ordinary recommendation path');
context.preferences.earlyVault = false;
assert.equal(context.bestCalculatedMove().action.type, 'end', 'off preserves the ordinary policy');
vm.runInContext(declaration('expectText'), context);
assert.match(context.expectText('rainbows', { mean: 2, earlyMean: 8 }, { maxDays: 60 }), /2\.00 Rainbows.*day 60/);
assert.match(source, /saved\.preferences.*earlyVault/);
console.log('PASS early vault: initial action, inclusive horizon/end, unchanged terminal scores, paired guard, worker/Analyzer merge parity, preserved Cancel/short-walk guards and truthful score labels');
