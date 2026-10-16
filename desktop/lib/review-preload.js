/* Tartarus Overlay: what the review window gets from the shell. */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('Record', {
  sessions: () => ipcRenderer.invoke('record:sessions'),
  load: (name) => ipcRenderer.invoke('record:load', name),
  openFolder: () => ipcRenderer.send('record:folder'),
});
