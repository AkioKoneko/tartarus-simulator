'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const captureSource = fs.readFileSync(require.resolve('../js/capture.js'), 'utf8');
function harness() {
  let worker, sequence = 0, now = 1000, grabFrame = async () => ({ width: 64, height: 64, close() {} });
  const timers = new Map(), stored = new Map(), frames = [];
  class Handle { constructor() { this.name = 'isolated.log'; } }
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
  const sandbox = { window: { addEventListener() {} }, navigator: { mediaDevices: {} }, Date: Clock,
    localStorage: { getItem: key => key.includes('capture-waits') ? stored.get(key) || null : JSON.stringify({ enabled: true, consent: 5 }), setItem: (key, value) => stored.set(key, value) },
    FileSystemFileHandle: Handle, Worker: class { constructor() { worker = this; } postMessage() {} terminate() {} },
    ImageCapture: class { grabFrame() { return grabFrame(); } }, document: { createElement() { throw Error('no actual canvas in isolated test'); } },
    Blob, URL: { createObjectURL: () => 'blob:isolated-test', revokeObjectURL() {} },
    setTimeout(fn, ms) { timers.set(++sequence, { fn, ms }); return sequence; }, clearTimeout: id => timers.delete(id), console };
  vm.runInNewContext(captureSource, sandbox);
  const C = sandbox.window.TartarusCapture;
  C.on('frame', frame => frames.push(frame));
  C.setRules([{ kind: 'board', pattern: 'board', settle: 800, rank: 1 }, { kind: 'instruments', pattern: 'instruments', settle: 800, rank: 2 }, { kind: 'skip', pattern: 'skip', settle: 100, rank: 0 }]);
  C.useHandle(new Handle());
  worker.onmessage({ data: { type: 'started', name: 'isolated.log' } });
  const hit = rule => worker.onmessage({ data: { type: 'lines', count: 1, hits: [{ rule, line: ['board', 'instruments', 'skip'][rule] }] } });
  const fire = async () => { assert.equal(timers.size, 1); const [id, task] = timers.entries().next().value; timers.delete(id); await task.fn(); return task; };
  const share = () => { const track = { readyState: 'live', getSettings: () => ({ displaySurface: 'window' }), addEventListener() {}, stop() {} }; C.useStream({ getVideoTracks: () => [track] }); };
  return { C, hit, timers, frames, stored, fire, share, setNow: n => { now = n; }, setGrab: fn => { grabFrame = fn; } };
}
async function main() {
  const h = harness(), key = 'board|board';
  assert.equal(h.C.shareOf(key), .25);
  assert.equal(h.C.shareOf('instruments|instruments'), 1, 'flipping instrument cards keep their full wait');
  assert.equal(h.C.shareOf('objective|objective'), 1);
  assert.equal(h.C.slower(key), .5);
  assert.equal(h.C.faster(key), .425);
  assert(h.stored.size, 'learned waits use the existing capture-waits owner');
  h.C.slower(key); h.C.faster(key);
  assert(h.C.shareOf(key) > .425, 'a failed wait is not revisited by successful reads');
  const recovery = harness();
  recovery.hit(0); assert.equal([...recovery.timers.values()][0].ms, 200);
  await recovery.fire();
  assert.equal(recovery.frames.length, 0, 'a failed early share waits for its one recovery');
  assert.equal([...recovery.timers.values()][0].ms, 600);
  await recovery.fire();
  assert.equal(recovery.frames.length, 1);
  assert.equal(recovery.frames[0].waited, 800);
  assert.equal(recovery.frames[0].frame, null);
  assert.equal(recovery.timers.size, 0, 'recovery cannot retry forever');
  const stale = harness();
  stale.hit(0); await stale.fire(); const old = [...stale.timers.values()][0];
  stale.hit(1);
  assert.equal(stale.timers.size, 1);
  assert.equal([...stale.timers.values()][0].ms, 800, 'new instrument cue replaces stale board recovery');
  old.fn(); await new Promise(setImmediate);
  assert.equal(stale.frames.length, 0, 'even an already queued obsolete recovery cannot emit');
  stale.hit(2); assert.equal(stale.timers.size, 0, 'new-day skip cancels the pending shot');
  const stop = harness(); stop.hit(0); await stop.fire(); stop.C.stopLog();
  assert.equal(stop.timers.size, 0, 'stopping log owns recovery teardown');
  // A successful grab may finish after ownership changed. Exercise both the
  // trigger and manual paths with actual deferred ImageCapture acquisitions.
  for (const source of ['trigger', 'manual']) {
    for (const cancel of ['cue', 'manual', 'skip', 'log-stop', 'window-stop']) {
      const race = harness(), acquisitions = [];
      race.share();
      race.setGrab(() => new Promise(resolve => acquisitions.push(resolve)));
      let pending;
      if (source === 'trigger') { race.hit(0); pending = race.fire(); }
      else pending = race.C.captureNow('manual');
      assert.equal(acquisitions.length, 1);
      let current;
      if (cancel === 'cue') race.hit(1);
      else if (cancel === 'manual') current = race.C.captureNow('manual');
      else if (cancel === 'skip') race.hit(2);
      else if (cancel === 'log-stop') race.C.stopLog();
      else race.C.stopWindow();
      let closed = 0;
      acquisitions[0]({ width: 64, height: 64, close() { closed++; } });
      const result = await pending;
      assert.equal(race.frames.length, 0, `${source} success after ${cancel} cannot emit`);
      assert.equal(race.C.state.frames, 0, 'discarded acquisitions do not increment frame counts');
      assert.equal(closed, 1, 'discarded successful bitmap is released exactly once');
      if (source === 'manual') assert.equal(result, false, 'cancelled manual/retake returns false');
      if (current) {
        acquisitions[1]({ width: 64, height: 64, close() {} });
        assert.equal(await current, true, 'the newest manual capture still succeeds');
        assert.equal(race.frames.length, 1);
      }
    }
  }
  const actual = harness(); actual.share(); let resolve;
  actual.setGrab(() => new Promise(done => { resolve = done; }));
  const pending = actual.C.captureNow('board', { retake: true, of: 3, key: 'board|board', waited: 800, full: 800, retryAttempt: 2, fresh: true, time: new Date(99999), frame: 'forged', kind: 'forged' });
  actual.setNow(2000); resolve({ width: 64, height: 64, close() {} }); assert.equal(await pending, true);
  const shot = actual.frames[0];
  assert.equal(+shot.time, 1000, 'takenAt is acquisition start, not delayed completion or extra metadata');
  assert.equal(shot.kind, 'board'); assert.notEqual(shot.frame, 'forged');
  assert.equal(shot.retake, true); assert.equal(shot.of, 3); assert.equal(shot.retryAttempt, 2); assert.equal(shot.fresh, true);
  assert.equal(shot.waited, 800); assert.equal(shot.full, 800);
  // The actual follow owner must not let a delayed retake replace a new view
  // or race auto.js's independently bounded popup retry sequence.
  const source = fs.readFileSync(require.resolve('../js/follow.js'), 'utf8');
  const start = source.indexOf('  function retake('), end = source.indexOf('\n  }', start);
  assert(start >= 0 && end > start);
  const timers = [], calls = [], c = { id: 1, kind: 'board', waited: 200, wholeWait: 800, at: 1000 };
  const context = { C: { state: { window: 'on' }, captureNow: (...args) => calls.push(args) }, captures: [c], Date: { now: () => 1000 }, setTimeout: fn => timers.push(fn) };
  vm.createContext(context); vm.runInContext(source.slice(start, end + 4), context);
  context.retake(c); assert.equal(timers.length, 1);
  context.captures[0] = { id: 2 }; timers.pop()(); assert.equal(calls.length, 0);
  context.captures[0] = c; context.retake(c); timers.pop()(); assert.equal(calls.length, 1);
  for (const kind of ['treasure', 'instruments']) context.retake({ ...c, kind });
  assert.equal(timers.length, 0, 'popup retries retain one bounded owner');
  // Exercise actual scanner decision parsing with controlled visible captions:
  // a three-slot layout suggests animation, but cannot invent an unseen card.
  const scan = fs.readFileSync(require.resolve('../js/scan.js'), 'utf8');
  const a = scan.indexOf('  function readDecision('), b = scan.indexOf('\n  }', a);
  const piece = (x, width, counts, y = 780) => ({ x0: x, x1: x + width, y0: y, y1: y + 20, words: counts.map(n => ({ glyphs: Array(n).fill({}) })) });
  let layout = [piece(480, 240, [4, 4, 8], 720), piece(560, 80, [7]), piece(815, 40, [3])];
  const scanner = { at: (_loc, x, y) => [600 + (x - 2.5) * 119.45, 100 + y * 80], scaleAt: () => 1, textRadii: () => [1],
    textLines: () => layout.map(p => ({ h: 20, mid: (p.y0 + p.y1) / 2, pieces: [p] })), hsvAt: () => [0, 0, 0] };
  vm.createContext(scanner); vm.runInContext(scan.slice(a, b + 4), scanner);
  const partial = scanner.readDecision({ width: 1200, height: 1000 }, { s: 1 });
  assert.equal(partial.settling, true);
  assert.equal(partial.consume, false, 'layout votes cannot confirm Consume');
  assert.equal(partial.targets.consume, undefined, 'unseen action gets no fabricated caption target');
  assert(partial.targets.replace && partial.targets.end, 'actually observed targets survive');
  layout = [piece(480, 240, [4, 4, 8], 720), piece(440, 80, [7]), piece(700, 40, [3])];
  assert.equal(!!scanner.readDecision({ width: 1200, height: 1000 }, { s: 1 }).settling, false, 'ordinary two-card row does not wait for an imaginary Consume');
  console.log('PASS adaptive waits, popup floors, one failed-share recovery, newer-cue/skip/stop cancellation, timestamp/options integrity and latest-owned retakes');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
