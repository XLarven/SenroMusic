'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('NorieDesktop', {
  getServerUrl: () => ipcRenderer.invoke('Norie:get-server-url'),
  setServerUrl: (url) => ipcRenderer.invoke('Norie:set-server-url', url),
  openExternal: (url) => ipcRenderer.invoke('Norie:open-external', url),
});
