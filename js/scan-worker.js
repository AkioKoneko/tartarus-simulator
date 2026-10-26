/* Tartarus Simulator: screenshot reader worker.
 * Reads a screenshot off the page's thread with js/scan.js and its reference
 * data, so the page stays responsive while it works. A message with
 * kind 'pick' is the instrument pick at the start of a run, not a board. */
'use strict';

importScripts(`scan.js${self.location.search}`, `scan-data.js${self.location.search}`, `pick-data.js${self.location.search}`);
importScripts(`acceleration.js${self.location.search}`, `pixel-accelerator.js${self.location.search}`);
let kernelActive = false;
const accelerationReady = self.TartarusAcceleration.load('pixels').then(({instance}) => {
  self.TartarusScan.setKernels(self.TartarusPixelAccelerator.create(instance));
  kernelActive = true;
}).catch(error => console.warn('Pixel acceleration unavailable; using reference reader:', error.message));

// Where the board was in the last picture: the next one of the same size
// (Auto Screenshot Mode's frames of one window) looks there first.
const cache = {};

self.onmessage = async (e) => {
  const { id, kind, width, height, buffer, lang } = e.data;
  try {
    await accelerationReady;
    self.TartarusScan.resetKernels();
    const send = message => self.postMessage({...message, backend:kernelActive ? 'wasm' : 'javascript'});
    const img = { width, height, data: new Uint8ClampedArray(buffer) };
    if (kind === 'treasure') {
      send({id,kind,result:self.TartarusScan.readTreasureCards(img)});
      return;
    }
    if (kind === 'objective') {
      send({ id, kind, result: self.TartarusScan.readObjectiveTitle(img) });
      return;
    }
    if (kind === 'pick') {
      send({ id, kind, result: self.TartarusScan.scanPick(img, self.TARTARUS_SCAN, self.TARTARUS_PICK) });
      return;
    }
    // Instruments' panel icons from labeled live screenshots ride along.
    const ref = self.TartarusScan.withPanelIcons(self.TARTARUS_SCAN, self.TARTARUS_PICK);
    const result = self.TartarusScan.scan(img, ref, { cache, lang });
    // The instruments' names and their simulator tools ride along, for the
    // runner-up matches too.
    if (result.tools && result.tools.tools) {
      const names = ref.toolNames;
      for (const t of result.tools.tools) {
        Object.assign(t, names[t.id] || {});
        for (const a of t.alts || []) a.sim = (names[a.id] || {}).sim;
      }
      // The instruments the reader can tell on a panel: any other one
      // always reads as something else.
      result.tools.sims = [...new Set(ref.tools.map((r) => (names[r.id] || {}).sim).filter(Boolean))];
    }
    send({ id, result });
  } catch (err) {
    if (kernelActive) {
      try {self.TartarusScan.setKernels(null);} catch (cleanup) {console.warn('Pixel cleanup failed:',String(cleanup));}
      kernelActive = false;
      self.TartarusAcceleration.discard('pixels');
      console.warn('Pixel acceleration stopped; retrying reference reader:', String(err));
      return self.onmessage(e);
    }
    self.postMessage({ id, kind, error: String((err && err.message) || err) });
  }
};
