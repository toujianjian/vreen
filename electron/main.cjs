// VREEN Electron main process.
//
// Boot sequence:
//   1. Splash window — draws engine boot screen directly via data URI
//   2. After 3.5 s → close splash → create main app window
//
// In dev (VREEN_DEV=1):  load http://localhost:5173 with HMR.
// In prod:               load the bundled dist/index.html from disk.

const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fsSync = require('node:fs');

const isDev = process.env.VREEN_DEV === '1' || !app.isPackaged;
const DEV_URL = process.env.VREEN_DEV_URL || 'http://localhost:5173';

// ── Diagnostics: mirror console → file in userData (works on Windows where
//    GUI subsystem discards stdout). Only writes once userData exists, i.e.
//    after `app.whenReady()`. ─────────────────────────────────────────────
function logToFile(...args) {
  try {
    const logPath = path.join(app.getPath('userData'), 'vreen-main.log');
    const line = `[${new Date().toISOString()}] ${args.map((a) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
    fsSync.appendFileSync(logPath, line);
  } catch (_) { /* ignore */ }
}
// Override console.* so every log also lands in userData/vreen-main.log.
const _origLog = console.log, _origErr = console.error, _origWarn = console.warn;
console.log = (...a) => { _origLog(...a); logToFile(...a); };
console.error = (...a) => { _origErr(...a); logToFile('ERROR', ...a); };
console.warn = (...a) => { _origWarn(...a); logToFile('WARN', ...a); };

let mainWindow = null;

// ── Splash: inline HTML (no file I/O, guaranteed to work inside ASAR) ──────
const SPLASH_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#05070d;color:#a0b0c8;display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden;font-family:system-ui,sans-serif}
body::after{content:'';position:fixed;inset:0;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,240,255,0.03) 2px,rgba(0,240,255,0.03) 4px);pointer-events:none}
.splash{text-align:center;animation:fadeIn .6s ease-out}
@keyframes fadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.logo-text{font-size:64px;font-weight:800;letter-spacing:.06em;background:linear-gradient(135deg,#00f0ff,#ff2bd6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;filter:drop-shadow(0 0 30px rgba(0,240,255,.3))}
.logo-sub{font-size:11px;letter-spacing:.3em;color:#4a5a7a;text-transform:uppercase;margin-top:4px}
.boot-log{text-align:left;font-family:monospace;font-size:12px;line-height:1.8;color:#6a7a9a;margin:32px 0 24px;min-height:160px}
.line{opacity:0;animation:typeIn .3s ease-out forwards}
.line.ok{color:#34d399}.line.info{color:#22d3ee}.line.warn{color:#fbbf24}
@keyframes typeIn{to{opacity:1}}
.cursor{display:inline-block;width:8px;height:14px;background:#22d3ee;animation:blink .8s step-end infinite;vertical-align:middle;margin-left:2px}
@keyframes blink{50%{opacity:0}}
.bar{width:100%;height:2px;background:#1a2a3a;overflow:hidden;margin-top:12px}
.fill{height:100%;width:0%;background:linear-gradient(90deg,#00f0ff,#ff2bd6);transition:width .3s ease;box-shadow:0 0 12px rgba(0,240,255,.4)}
.status{font-family:monospace;font-size:10px;color:#4a5a7a;letter-spacing:.18em;margin-top:8px}
</style></head>
<body><div class="splash">
<div class="logo-text">VREEN</div>
<div class="logo-sub">3D Display System</div>
<div class="boot-log" id="log">
<div class="line info" style="animation-delay:0ms">[KERNEL]  VREEN kernel v0.1.0 boot sequence initiated...</div>
<div class="line" style="animation-delay:320ms">[SHADER]  Shader pipeline online. 3D context verified.</div>
<div class="line ok" style="animation-delay:640ms">[ASSET]   Asset index loaded. 6 preset archetypes ready.</div>
<div class="line" style="animation-delay:960ms">[MEMORY]  Heap allocation: 256 MB / 1024 MB</div>
<div class="line info" style="animation-delay:1280ms">[GPU]     Adapter: WebGL2 — hardware acceleration enabled</div>
<div class="line ok" style="animation-delay:1600ms">[NET]     Link stable. Uplink established.</div>
<div class="line warn" style="animation-delay:1920ms">[STATUS]  All systems nominal. Awaiting operator input.</div>
</div><span class="cursor"></span>
<div class="bar"><div class="fill" id="fill"></div></div>
<div class="status" id="status">INITIALIZING SUBSYSTEMS...</div>
</div>
<script>
const MSGS=['LOADING KERNEL MODULES...','COMPILING SHADER GRAPHS...','PARSING ASSET INDEX...','ALLOCATING GPU MEMORY...','INITIALIZING RENDER PIPELINE...','ESTABLISHING UPLINK...','ALL SYSTEMS NOMINAL 鈽?];
const L=document.querySelectorAll('.line'),F=document.getElementById('fill'),S=document.getElementById('status');
let i=0;
function step(){if(i<L.length){F.style.width=((i+1)/L.length*100)+'%';S.textContent=MSGS[Math.min(i,MSGS.length-1)];i++;setTimeout(step,280+Math.random()*200)}else{F.style.width='100%';S.textContent='READY 鈥?LAUNCHING INTERFACE...'}}
setTimeout(step,800);
</script></body></html>`;

function createSplash() {
  const w = new BrowserWindow({
    width: 600, height: 440,
    frame: false, backgroundColor: '#05070d',
    resizable: false, show: true, alwaysOnTop: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  w.setMenuBarVisibility(false);
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML));
  // Auto-close splash after 4 s regardless
  setTimeout(() => {
    if (!w.isDestroyed()) { w.close(); createMainWindow(); }
  }, 4000);
}

// ── Main application window ────────────────────────────────────────────────
function createMainWindow() {
  if (mainWindow) return;
  mainWindow = new BrowserWindow({
    width: 1480, height: 920,
    minWidth: 1100, minHeight: 720,
    backgroundColor: '#05070d',
    title: 'VREEN — 3D Display System',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // ── Diagnostics: forward renderer console → main process stdout ────────
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const tag = ['LOG', 'WARN', 'ERROR', 'INFO'][level] || 'LOG';
    console.log(`[renderer:${tag}] ${message}  (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL) => {
    console.error(`[main] did-fail-load  code=${errorCode}  ${errorDescription}  url=${validatedURL}`);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[main] render-process-gone  reason=${details.reason}  exitCode=${details.exitCode}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.executeJavaScript(
      'window.__VREEN_RUNTIME__=Object.assign(window.__VREEN_RUNTIME__||{},{electron:true,version:"' + app.getVersion() + '",platform:"' + process.platform + '"});',
      true,
    ).catch(() => {});
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // ── Load: dev → Vite, prod → bundled dist/index.html ────────────────────
  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Resolve dist/index.html robustly (asar-aware).
    const fs = require('node:fs');
    const candidates = [
      path.join(__dirname, '..', 'dist', 'index.html'),
      path.join(process.resourcesPath || '', 'app', 'dist', 'index.html'),
      path.join(process.resourcesPath || '', 'dist', 'index.html'),
    ];
    const indexHtml = candidates.find((p) => p && fs.existsSync(p));
    if (indexHtml) {
      console.log(`[main] loading ${indexHtml}`);
      mainWindow.loadFile(indexHtml);
    } else {
      console.error('[main] dist/index.html not found in any of:\n  ' + candidates.join('\n  '));
    }
  }

  // Show the window as soon as the first frame is ready…
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[main] window ready-to-show → shown');
  });
  // …with a hard fallback so the user never sees a stuck splash forever.
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      console.warn('[main] ready-to-show timed out — forcing show()');
      mainWindow.show();
    }
  }, 6000);

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC handlers ──────────────────────────────────────────────────────────
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

ipcMain.handle('vreen:app-info', () => ({
  version: app.getVersion(), name: app.getName(), platform: process.platform,
  electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node,
}));

ipcMain.handle('vreen:quit', () => app.quit());

// ── App lifecycle ──────────────────────────────────────────────────────────
logToFile('=== VREEN main.cjs start ===');
logToFile('isDev=' + isDev + '  isPackaged=' + app.isPackaged + '  resourcesPath=' + (process.resourcesPath || '(none)'));
logToFile('__dirname=' + __dirname);

app.whenReady().then(() => {
  logToFile('app ready, userData=' + app.getPath('userData'));
  // 启动时就扫描 dist/index.html 候选路径并把结果记到日志
  const candidates = [
    path.join(__dirname, '..', 'dist', 'index.html'),
    path.join(__dirname, 'dist', 'index.html'),
    path.join(process.resourcesPath || '', 'app', 'dist', 'index.html'),
    path.join(process.resourcesPath || '', 'dist', 'index.html'),
    path.join(process.resourcesPath || '', 'app.asar', 'dist', 'index.html'),
  ];
  for (const c of candidates) {
    logToFile('candidate: ' + c + '  exists=' + (fsSync.existsSync(c) ? 'YES' : 'no'));
  }
  createSplash();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createSplash();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
