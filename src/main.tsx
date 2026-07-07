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

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
