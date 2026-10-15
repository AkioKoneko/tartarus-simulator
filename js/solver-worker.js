/* Tartarus Simulator: solver worker.
 * Runs the Monte Carlo solver off the page's main thread and streams partial
 * results back, so the board stays responsive while it plays options out.
 * A newer request replaces the one in progress. */
'use strict';

importScripts(`engine.js${self.location.search}`, `tool-combos.js${self.location.search}`, `solver.js${self.location.search}`);

let current = 0;

self.onmessage = (e) => {
  const { id, state, rollouts, params, extra } = e.data;
  current = id;
  const job = self.TartarusSolver.solve(state, { rollouts, params, extra, seed: (id * 7919 + 1) >>> 0 });
  const tick = () => {
    if (id !== current) return;
    const result = job.step(60);
    self.postMessage({ id, result });
    if (!result.done) setTimeout(tick, 0);
  };
  tick();
};
