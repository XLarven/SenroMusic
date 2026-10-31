'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('senroDesktop', {
  getServerUrl: () => ipcRenderer.invoke('senro:get-server-url'),
  setServerUrl: (url) => ipcRenderer.invoke('senro:set-server-url', url),
  openExternal: (url) => ipcRenderer.invoke('senro:open-external', url),
});
