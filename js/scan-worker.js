/* Tartarus Simulator: screenshot reader worker.
 * Reads a screenshot off the page's thread with js/scan.js and its reference
 * data, so the page stays responsive while it works. */
'use strict';

importScripts(`scan.js${self.location.search}`, `scan-data.js${self.location.search}`);

self.onmessage = (e) => {
  const { id, width, height, buffer } = e.data;
  try {
    const result = self.TartarusScan.scan({ width, height, data: new Uint8ClampedArray(buffer) }, self.TARTARUS_SCAN);
    // The instruments' names and their simulator tools ride along.
    if (result.tools && result.tools.tools) {
      for (const t of result.tools.tools) Object.assign(t, self.TARTARUS_SCAN.toolNames[t.id] || {});
    }
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
