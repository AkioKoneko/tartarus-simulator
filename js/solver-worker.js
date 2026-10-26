/* Tartarus Simulator: solver worker.
 * Runs the Monte Carlo solver off the page's main thread and streams partial
 * results back, so the board stays responsive while it plays options out.
 * A newer request replaces the one in progress.
 *
 * With `raw`, it sends each round's values instead of a result, so the page
 * can run several of these at once, each on its own `stream` of dice, and
 * merge their rows (TartarusSolver.summarize). */
'use strict';

importScripts(`engine.js${self.location.search}`, `tool-combos.js${self.location.search}`, `solver.js${self.location.search}`);
importScripts(`acceleration.js${self.location.search}`, `rust-backend.js${self.location.search}`);

let current = 0, generation = 0, core = null, unavailable = false;
function discardCore() {core=null;unavailable=true;if(self.TartarusAcceleration)self.TartarusAcceleration.discard('solver');}
// Compilation overlaps capture/recognition. Rejected or stale assets retain JS.
const accelerationReady = self.TartarusRustBackend && self.TartarusRustBackend.load().then(value => {core=value;}).catch(error => {
  unavailable=true; console.warn('Calculation acceleration unavailable; using reference:', error.message);
});

async function handleMessage(e) {
  // The page has its answer: the check in progress stops.
  if (e.data.stop) {
    current = 0; generation += 1;
    if (core) { try {core.request({op:'cancel'});} catch {discardCore();} }
    return;
  }
  const { id, state, rollouts, params, stream, raw, earlyVaultDays } = e.data;
  const token = ++generation;
  current = id;
  const options = {rollouts, params, earlyVaultDays, stream:stream||0, seed:(id*7919+1)>>>0};
  if (accelerationReady) await accelerationReady;
  if (token !== generation || id !== current) return;
  let job;
  if (core && !unavailable) {
    try {job=self.TartarusRustBackend.solve(core,state,options);}
    catch (error) {console.warn('Calculation acceleration rejected task; using reference:',error.message);discardCore();}
  }
  if (!job) job=self.TartarusSolver.solve(state,options);
  let sent = 0; // rounds already sent
  const tick = () => {
    if (id !== current || token !== generation) return;
    let result;
    try {result=job.step(60);}
    catch (error) {
      if (job.backend !== 'rust-wasm') {setTimeout(()=>{throw error;},0);return;}
      console.warn('Calculation acceleration stopped; replaying reference stream:',error.message);
      discardCore();job=self.TartarusSolver.solve(state,options);
      // Recreate prior deterministic samples so raw clients receive no duplicates.
      do {result=job.step(60);} while(!result.done && result.rounds<sent);
    }
    if (raw) {
      // Every row gets one value a round, so the new values line up.
      self.postMessage({
        id,
        stream,
        rounds: result.rounds,
        done: result.done,
        goal: result.goal,
        backend: job.backend || 'javascript',
        meta: sent === 0 ? job.rows.map((r) => ({ label: r.label, action: r.action, kind: r.kind, policy: r.policy })) : null,
        rows: job.rows.map((r) => ({ vals: r.vals.slice(sent), ...(r.earlyVals ? { earlyVals: r.earlyVals.slice(sent) } : {}), best: r.best })),
      });
      sent = result.rounds;
    } else self.postMessage({ id, result, backend:job.backend||'javascript' });
    if (!result.done) setTimeout(tick, 0);
  };
  tick();
}
// Async initialization failures must reach Worker.onerror so the Analyzer's
// established recovery path can take over instead of waiting indefinitely.
self.onmessage = (event) => { handleMessage(event).catch(error => setTimeout(() => {throw error;}, 0)); };
