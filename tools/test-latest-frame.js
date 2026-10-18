'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Exercise the real auto receiver with deferred reads: a newer frame must own application.
async function receiverTest() {
  let receiver, target;
  const pending = [], treasures = [], used = [], asks = [], errors = [], replies = [];
  const A = {
    giftCounts: (g) => Math.max(0, g.rainbows - g.taken),
    useTreasure: () => { asks.push('gift'); return true; },
    readFrame: (_bitmap, opts) => new Promise((resolve) => pending.push({ resolve, opts })),
    readTreasure: (_bitmap, opts) => new Promise((resolve) => treasures.push({ resolve, opts })),
    useReading: (r) => used.push(r.tag), ask: () => { asks.push('board'); return true; },
  };
  const element = { hidden: true, addEventListener() {}, classList: { toggle() {} } };
  const sandbox = {
    window: { TartarusCapture: { agreed: () => true }, TartarusAnalyzer: A, addEventListener() {} },
    document: { hasFocus: () => false, getElementById: () => element, addEventListener() {} },
    BroadcastChannel: class { constructor() { receiver = this; } postMessage(m) { if (m.type === 'here') target = m.id; else replies.push(m); } },
    createImageBitmap: async () => ({close(){}}), setInterval() {}, setTimeout() {}, Date, console: {...console,error:e=>errors.push(String(e))},
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/auto.js'), 'utf8'), sandbox);
  const frame = (id, gifts) => receiver.onmessage({ data: { type: 'frame', to: target, id, from: 'source', kind: 'board', blob: {}, gifts } });
  frame(1, { rainbows: 1, taken: 0 });
  await new Promise(setImmediate);
  frame(2, { rainbows: 1, taken: 1 });
  await new Promise(setImmediate);
  assert.equal(pending.length, 2);
  assert.equal(pending[0].opts.isCurrent(), false);
  pending[1].resolve({ ok: true, tag: 'new' });
  await new Promise(setImmediate);
  pending[0].resolve({ ok: true, tag: 'old' });
  await new Promise(setImmediate);
  assert.deepEqual(used, ['new']);
  assert.deepEqual(asks, ['board']);
  receiver.onmessage({ data: { type: 'frame', to: target, id: 3, from: 'source', kind: 'treasure', blob: {}, gifts: { rainbows: 1, taken: 1 } } });
  await new Promise(setImmediate);
  treasures[0].resolve({ok:true,treasure:true});
  await new Promise(setImmediate);
  assert.deepEqual(asks, ['board']);
  assert(replies.some(r=>r.id===3 && r.state==='used' && r.asked===false));
  const gift=id=>receiver.onmessage({data:{type:'frame',to:target,id,from:'source',kind:'treasure',blob:{},gifts:{rainbows:2,taken:1}}});
  gift(4);await new Promise(setImmediate);
  gift(5);await new Promise(setImmediate);
  assert.equal(treasures[1].opts.isCurrent(),false);
  treasures[2].resolve({ok:true,treasure:true});await new Promise(setImmediate);
  treasures[1].resolve({ok:true,treasure:true});await new Promise(setImmediate);
  assert.deepEqual(asks,['board','gift'],'only the latest Treasure frame asks for advice');
  assert.deepEqual(errors,[]);
}
receiverTest().then(() => console.log('capture: bidirectional cues, duplicate confirmations, reset, known zero and latest-wins passed')).catch((e) => { console.error(e); process.exitCode = 1; });
