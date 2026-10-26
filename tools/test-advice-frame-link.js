'use strict';
// Real adapter events + snapshot: recording IDs must never be guessed from
// the Analyzer's independent geometry counter, including after manual reads.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let geometry = 7, onMessage;
const records = [];
const context = {
  window: {
    TartarusDesktop: { record: e => records.push(e), onCommand() {} },
    TartarusAnalyzer: {
      recommendation: () => ({ label: 'Consume cell 03' }),
      localAssist: () => ({ hints: geometry === null ? { valid: false } : { valid: true, frameId: geometry } }),
    },
  },
  document: { getElementById: () => null, querySelectorAll: () => [], addEventListener() {} },
  localStorage: { getItem: () => null },
  BroadcastChannel: class { addEventListener(name, fn) { assert.equal(name, 'message'); onMessage = fn; } },
  MutationObserver: class { observe() {} },
  setTimeout: () => 1, clearTimeout() {}, setInterval() {}, Date,
  queueMicrotask() {},
};
let source = fs.readFileSync(path.join(__dirname, '..', 'desktop/lib/analyzer-adapter.js'), 'utf8');
assert.match(source, /\}\)\(\);\s*$/);
source = source.replace(/\}\)\(\);\s*$/, 'window.__snapshotForTest = snapshot;\n})();');
vm.runInNewContext(source, context, { filename: 'desktop/lib/analyzer-adapter.js' });
const snapshot = context.window.__snapshotForTest;
const emit = data => onMessage({ data });
const frame = id => emit({ type: 'frame', id, kind: 'board' });
const read = (id, readerId, extra = {}) => emit({ type: 'read', id, read: { ok: true, _readerId: readerId, ...extra } });

assert.equal(snapshot().recordedFrameId, null, 'Unlinked geometry must not become a recording ID');
frame(103);
read(103, 7);
assert.equal(snapshot().hints.frameId, 7, 'Geometry identity stays owned by Analyzer');
assert.equal(snapshot().recordedFrameId, 103, 'Broadcast identity links independent counters');
assert(records.some(e => e.type === 'picture' && e.id === 103));

geometry = 103;
assert.equal(snapshot().recordedFrameId, null, 'A manual read numerically equal to a recording ID is still unlinked');
geometry = null;
assert.equal(snapshot().recordedFrameId, null, 'Missing geometry does not inherit the previous image');

geometry = 8;
frame(104);
read(104, 8, { ok: false, reason: 'No board' });
assert.equal(snapshot().recordedFrameId, null, 'Failed read must not establish a link');
assert(records.some(e => e.type === 'read' && e.id === 104));
read(104, undefined);
assert.equal(snapshot().recordedFrameId, null, 'Older readers without explicit identity remain unlinked');

// A late response for a superseded reader must not attach itself to whichever
// geometry is current when the adapter receives it.
frame(105);
geometry = 10;
frame(106);
read(105, 9);
assert.equal(snapshot().recordedFrameId, null, 'Late old response cannot link the newer geometry');
read(106, 10);
assert.equal(snapshot().recordedFrameId, 106);
read(105, 9);
assert.equal(snapshot().recordedFrameId, 106, 'Late old response cannot overwrite current association');
geometry = 11;
assert.equal(snapshot().recordedFrameId, null, 'Next manual read invalidates inherited association');
emit({ type: 'read', id: 107, read: { ok: true, pick: true, _pickId: 11 } });
assert.equal(snapshot().recordedFrameId, 107, 'Explicit pick identity links to its own recording counter');

// Exercise the real review renderer with a marker lacking a proven image.
// Matching advice text and numeric coincidences must not invent navigation.
const nodes = new Map();
function element() {
  return { children: [], textContent: '', checked: false, classList: { add() {}, toggle() {} },
    append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; },
    setAttribute(name, value) { this[name] = value; if (name === 'id') nodes.set(value, this); }, addEventListener() {} };
}
const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
const reviewer = { window: { Record: {} }, document: { getElementById: get, createElement: element, addEventListener() {} }, Date };
let reviewSource = fs.readFileSync(path.join(__dirname, '..', 'desktop/lib/review.js'), 'utf8');
assert.match(reviewSource, /loadSessions\(false\);/);
reviewSource = reviewSource.replace('loadSessions(false);', 'window.__renderForTest = value => { data = value; render(); };');
vm.runInNewContext(reviewSource, reviewer, { filename: 'desktop/lib/review.js' });
const walk = (node, pred) => typeof node === 'object' && node !== null ? [ ...(pred(node) ? [node] : []), ...node.children.flatMap(k => walk(k, pred)) ] : [];
const allText = node => typeof node === 'string' ? node : [node.textContent, ...node.children.map(allText)].join(' ');
for (const frameId of [null, 999]) {
  reviewer.window.__renderForTest({ base: '', entries: [
    { type: 'picture', id: 7, at: 1, file: '7.webp' },
    { type: 'advice', at: 2, advice: { move: 'Consume cell 03', dayof: 'Day 2' } },
    { type: 'advice-flag', at: 3, frameId, advice: { move: 'Consume cell 03', dayof: 'Day 2' } },
  ] });
  assert.equal(walk(get('steps'), n => n['data-flag-step'] !== undefined).length, 0, 'Unlinked marker must not offer guessed picture navigation');
  assert.match(allText(get('steps')), /No recorded picture is linked to this mark\./);
  assert.match(allText(get('steps')), /Consume cell 03/, 'Unlinked mark still retains the reported advice');
}
console.log('PASS independent recording/geometry IDs, manual/missing/failed/superseded reads and unlinked-marker presentation');
