'use strict';
// Exercise the actual overlay and review scripts through their existing bridges.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness() {
  const nodes = new Map(), listeners = {};
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.children = []; this.dataset = {}; this.hidden = false; this.textContent = ''; this.classes = new Set(); this.classList = { add: n => this.classes.add(n), remove: n => this.classes.delete(n), toggle: (n, on) => on ? this.classes.add(n) : this.classes.delete(n) }; }
    append(...kids) { this.children.push(...kids); }
    replaceChildren(...kids) { this.children = kids; }
    setAttribute(k, v) { this[k] = v; if(k === 'id') nodes.set(v, this); if(k === 'data-flag-step') this.dataset.flagStep = v; }
    addEventListener() {}
    getBoundingClientRect() { return { height: 240 }; }
    matches() { return false; }
    scrollIntoView() { this.scrolled = true; }
  }
  const get = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const document = { body: new Element(), getElementById: get, createElement: tag => new Element(tag), addEventListener: (name, fn) => { listeners[name] = fn; } };
  const context = { document, window: {}, Date, setTimeout: () => 1, clearTimeout() {}, setInterval() {}, ResizeObserver: class { observe() {} } };
  return { get, listeners, context, nodes };
}
function run(file, h) { vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), h.context, { filename: file }); }
const h = harness(), callbacks = {}, commands = [];
h.context.window.Overlay = { command: name => commands.push(name), size() {}, ...Object.fromEntries(['Shell', 'Game', 'Follow', 'Advice'].map(name => ['on' + name, fn => { callbacks[name] = fn; }])) };
run('desktop/lib/overlay.js', h);
assert.equal(h.get('report-advice').hidden, true);
const ready = { has: true, move: 'Consume cell 03', options: [] };
callbacks.Advice(ready);
assert.equal(h.get('report-advice').hidden, false);
const click = { id: 'report-advice', dataset: { cmd: 'report-advice' } };
h.listeners.click({ target: { closest: () => click } });
assert.deepEqual(commands, ['report-advice']);
callbacks.Shell({ adviceReport: { status: 'saved', text: 'Advice marked in this run’s record.' } });
assert.equal(h.get('report-advice').disabled, true);
assert.equal(h.get('advice-report-status').hidden, false);
callbacks.Shell({ adviceReport: { status: 'unavailable', text: 'Recording is off.' } });
assert.equal(h.get('report-advice').disabled, false);
assert.equal(h.get('advice-report-status').textContent, 'Recording is off.');
for (const extra of [{ stale: true }, { reading: {} }, { working: true }, { toolsConfirm: 'Check instruments' }, { problems: ['Unknown cell'] }]) {
  callbacks.Advice({ ...ready, ...extra });
  assert.equal(h.get('report-advice').hidden, true);
}
callbacks.Shell({});
assert.equal(h.get('advice-report-status').hidden, true);

(async () => {
  const r = harness();
  r.get('only-fixes').checked = true;
  r.get('show-other').checked = false;
  const entries = [
    { type: 'picture', id: 41, at: 1, kind: 'board', file: '41.webp' },
    { type: 'advice', at: 2, advice: { move: 'Consume cell 03', dayof: 'Day 2' } },
    { type: 'picture', id: 42, at: 3, kind: 'board', file: '42.webp' },
    { type: 'advice-flag', at: 4, frameId: 41, advice: { move: 'Consume cell 03', dayof: 'Day 2' } },
  ];
  r.context.window.Record = { sessions: async () => [{ name: 'test', pictures: 2, advice: 1, edits: 0 }], load: async () => ({ base: '', entries }) };
  run('desktop/lib/review.js', r);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.get('steps').children.length, 2, 'Filter retains flag and its associated picture');
  const allText = node => typeof node === 'string' ? node : [node.textContent, ...node.children.map(allText)].join(' ');
  assert.match(allText(r.get('steps')), /Marked as wrong advice/);
  r.listeners.click({ target: { closest: selector => selector === 'button[data-flag-step]' ? { dataset: { flagStep: '1' } } : null } });
  assert.equal(r.get('step-1').scrolled, true);
  assert(r.get('step-1').classes.has('is-open'));
  assert.match(allText(r.get('step-2')), /Consume cell 03/, 'Marker retains the reported advice after navigation');
  console.log('PASS advice report command, validity gates, save feedback, recorded marker and associated-frame navigation');
})().catch(e => { console.error(e); process.exitCode = 1; });
