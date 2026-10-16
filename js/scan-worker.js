/* Tartarus Simulator: screenshot reader worker.
 * Reads a screenshot off the page's thread with js/scan.js and its reference
 * data, so the page stays responsive while it works. A message with
 * kind 'pick' is the instrument pick at the start of a run, not a board. */
'use strict';

importScripts(`scan.js${self.location.search}`, `scan-data.js${self.location.search}`, `pick-data.js${self.location.search}`);

self.onmessage = (e) => {
  const { id, kind, width, height, buffer } = e.data;
  try {
    const img = { width, height, data: new Uint8ClampedArray(buffer) };
    if (kind === 'objective') {
      self.postMessage({ id, kind, result: self.TartarusScan.readObjectiveTitle(img) });
      return;
    }
    if (kind === 'pick') {
      self.postMessage({ id, kind, result: self.TartarusScan.scanPick(img, self.TARTARUS_SCAN, self.TARTARUS_PICK) });
      return;
    }
    // Instruments' panel icons from labeled live screenshots ride along.
    const result = self.TartarusScan.scan(img, self.TartarusScan.withPanelIcons(self.TARTARUS_SCAN, self.TARTARUS_PICK));
    // The instruments' names and their simulator tools ride along.
    if (result.tools && result.tools.tools) {
      for (const t of result.tools.tools) Object.assign(t, self.TARTARUS_SCAN.toolNames[t.id] || {});
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, kind, error: String((err && err.message) || err) });
  }
};
