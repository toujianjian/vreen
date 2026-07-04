// VREEN Electron main process.
//
// In dev (VREEN_DEV=1):  load http://localhost:5173 with HMR.
// In prod:               load the bundled dist/index.html from disk.
// All security: contextIsolation on, nodeIntegration off, IPC via preload.

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');

const isDev = process.env.VREEN_DEV === '1' || !app.isPackaged;
const DEV_URL = process.env.VREEN_DEV_URL || 'http://localhost:5173';

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#05070d',
    title: 'VREEN — 3D Display System',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // we use ESM in renderer; sandbox would block preload require
      // WebGL needs hardware acceleration; do not disable.
    },
  });

  // Inject a tiny startup "vreen" global so the renderer knows it's in Electron.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      'window.__VREEN_RUNTIME__ = Object.assign(window.__VREEN_RUNTIME__ || {}, { electron: true, version: "' + app.getVersion() + '", platform: "' + process.platform + '" });',
      true,
    ).catch(() => {});
  });

  // Open external links in the default browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- IPC: file open dialog for assets (optional convenience) ----
ipcMain.handle('vreen:open-asset', async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Open 3D model',
    properties: ['openFile'],
    filters: [
      { name: '3D models', extensions: ['glb', 'gltf', 'obj', 'fbx', 'stl', 'ply'] },
      { name: 'All files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  const filePath = result.filePaths[0];
  const fs = require('node:fs/promises');
  const stat = await fs.stat(filePath);
  return { filePath, name: path.basename(filePath), size: stat.size };
});

// ---- IPC: app info ----
ipcMain.handle('vreen:app-info', () => ({
  version: app.getVersion(),
  name: app.getName(),
  platform: process.platform,
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
}));

// ---- IPC: quit ----
ipcMain.handle('vreen:quit', () => {
  app.quit();
});

// ---- App lifecycle ----
app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
