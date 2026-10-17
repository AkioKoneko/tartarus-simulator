'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const bridge = {
  onHints: (fn) => {
    if (typeof fn === 'function') ipcRenderer.on('hints', (_event, payload) => fn(payload));
  },
};
contextBridge.exposeInMainWorld('Hints', bridge);
contextBridge.exposeInMainWorld('TartarusHints', bridge);
