import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

// ── Local fonts (fontsource) — woff2 files are bundled into dist/ at build
//    time, so the app is 100% offline-capable. No CDN, no mirror, no race
//    conditions between dev server, browser, and Electron. ─────────────────
import '@fontsource/orbitron/400.css';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/600.css';
import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/800.css';
import '@fontsource/orbitron/900.css';
import '@fontsource/jetbrains-mono/300.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';
// Noto Sans SC — Chinese subset (fontsource ships ~100 unicode-range
// sub-files per weight; the browser only downloads the ones that contain
// characters actually rendered on the page).
import '@fontsource/noto-sans-sc/chinese-simplified-300.css';
import '@fontsource/noto-sans-sc/chinese-simplified-400.css';
import '@fontsource/noto-sans-sc/chinese-simplified-500.css';
import '@fontsource/noto-sans-sc/chinese-simplified-700.css';

import './i18n'; // initialize i18n (Chinese default)
import './styles/index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found');
}

// ── 全局错误陷阱:任何未捕获 error / 未处理 rejection / WebGL context lost
//    都显示在页面左上角的红色面板上,方便真机排查"静默黑屏"。 ───────────
function installGlobalErrorTrap() {
  const shown = new Set<string>();
  const show = (kind: string, detail: string) => {
    const key = kind + '|' + detail.slice(0, 120);
    if (shown.has(key)) return;
    shown.add(key);
    let banner = document.getElementById('__global_err');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = '__global_err';
      banner.style.cssText =
        'position:fixed;top:8px;left:8px;z-index:99999;max-width:80vw;' +
        'background:rgba(180,30,40,0.92);color:#fff;font:11px/1.5 monospace;' +
        'padding:8px 10px;border:1px solid #ff7a88;border-radius:6px;' +
        'white-space:pre-wrap;word-break:break-all;box-shadow:0 2px 12px rgba(0,0,0,.6);';
      banner.addEventListener('click', () => { banner!.style.display = 'none'; });
      document.body.appendChild(banner);
    }
    banner.textContent = `${kind}: ${detail}\n(点击关闭)`;
    banner.style.display = 'block';
  };
  window.addEventListener('error', (e) => {
    show('ERROR', e.message + (e.filename ? `\n  at ${e.filename}:${e.lineno}:${e.colno}` : ''));
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason as any;
    show('UNHANDLED', String(r?.message ?? r ?? e.reason));
  });
  // webglcontextlost bubbles up the DOM to <html>/<body> — catch it globally.
  document.addEventListener('webglcontextlost', (ev) => {
    const e = ev as unknown as WebGLContextEvent;
    show('WEBGL CONTEXT LOST', e.statusMessage ?? 'context lost');
  }, true);
}
installGlobalErrorTrap();

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
