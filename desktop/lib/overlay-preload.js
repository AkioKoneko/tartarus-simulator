/* Tartarus Overlay: what the overlay page gets from the shell. */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, fn) => {
  if (typeof fn === 'function') ipcRenderer.on(channel, (e, data) => fn(data));
};

const bridge = {
  onShell: (fn) => listen('shell', fn),
  onGame: (fn) => listen('game', fn),
  onFollow: (fn) => listen('follow', fn),
  onAdvice: (fn) => listen('advice', fn),
  // board, follow, capture, fix, recheck, report, report-new, hide, lock,
  // pick-log, reload, restart
  command: (name) => ipcRenderer.send('overlay:command', String(name)),
  size: (size) => ipcRenderer.send('overlay:size', typeof size === 'number' ? size : { width: size.width, height: size.height, collapsed:size.collapsed }),
  drag: ({ dx, dy }) => {
    if (Number.isFinite(dx) && Number.isFinite(dy)) ipcRenderer.send('overlay:drag', { dx, dy });
  },
};
contextBridge.exposeInMainWorld('Overlay', bridge);
contextBridge.exposeInMainWorld('TartarusOverlay', bridge);
