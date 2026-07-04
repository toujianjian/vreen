// VREEN Electron preload — exposes a minimal, typed API to the renderer.
// Renderer (sandboxed) can only call what we explicitly surface here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vreenAPI', {
  /** Open a native file picker for 3D models. */
  openAsset: () => ipcRenderer.invoke('vreen:open-asset'),
  /** Get runtime information (version, platform, etc.). */
  appInfo: () => ipcRenderer.invoke('vreen:app-info'),
  /** Quit the app. */
  quit: () => ipcRenderer.invoke('vreen:quit'),
  /** True when running inside Electron. */
  isElectron: true,
});
