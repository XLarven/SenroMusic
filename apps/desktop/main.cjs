'use strict';

const { app, BrowserWindow, Menu, ipcMain, shell, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

const CONFIG_FILE = 'server.json';

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configPath(), 'utf8'));
  } catch {
    return {};
  }
}

function getServerUrl() {
  const fromConfig = readConfig().url;
  if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim();
  const fromEnv = process.env.Norie_SERVER_URL;
  if (typeof fromEnv === 'string' && fromEnv.trim()) return fromEnv.trim();
  return 'http://localhost:8787';
}

function setServerUrl(url) {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify({ url }, null, 2), 'utf8');
}

let mainWindow = null;

function loadSetup(window) {
  window.loadFile(path.join(__dirname, 'setup.html'));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'Norie Music',
    backgroundColor: '#07080a',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const target = getServerUrl();
  mainWindow.loadURL(target).catch(() => loadSetup(mainWindow));
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    if (validatedURL === target) loadSetup(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Norie Music',
      submenu: [
        {
          label: 'Sunucu adresini değiştir…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            if (mainWindow) loadSetup(mainWindow);
          },
        },
        { type: 'separator' },
        { role: 'reload', label: 'Yenile' },
        { role: 'toggleDevTools', label: 'Geliştirici araçları' },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' },
      ],
    },
    {
      label: 'Düzen',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('Norie:get-server-url', () => getServerUrl());
ipcMain.handle('Norie:set-server-url', (_event, url) => {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    throw new Error('Geçerli bir http:// veya https:// adresi girin.');
  }
  setServerUrl(url.trim());
  return getServerUrl();
});
ipcMain.handle('Norie:open-external', (_event, url) => {
  if (typeof url === 'string') shell.openExternal(url);
});
