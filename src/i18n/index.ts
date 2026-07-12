// i18n bootstrap — Chinese first, English fallback, localStorage persistence.
import { createLogger } from '@/lib/logger';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';

const log = createLogger('i18n');

const STORAGE_KEY = 'vreen.lang';

// 1) Determine initial language: localStorage > navigator > 'zh' (default).
function detectInitialLang(): 'zh' | 'en' {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
  } catch {
    /* localStorage may be unavailable (e.g. Electron with strict cookie policy) */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'zh-CN') || 'zh-CN';
  return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

// 2) Build the set of keys present in zh.json. We treat zh.json as the source of truth
//    for the "must-have" set: when running in Chinese, we never want a bare key to be
//    shown, so we synthesize a Chinese fallback for any missing entry.
const missingInZh = new Set<string>();
function flattenKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const k in obj) {
    const p = prefix ? `${prefix}.${k}` : k;
    const v = obj[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...flattenKeys(v as Record<string, unknown>, p));
    } else {
      out.push(p);
    }
  }
  return out;
}
const zhKeys = new Set(flattenKeys(zh as unknown as Record<string, unknown>));
const enKeys = new Set(flattenKeys(en as unknown as Record<string, unknown>));
for (const k of enKeys) {
  if (!zhKeys.has(k)) missingInZh.add(k);
}
if (typeof window !== 'undefined') {
  (window as unknown as { __VREEN_I18N_MISSING__?: string[] }).__VREEN_I18N_MISSING__ = Array.from(missingInZh);
}

void i18n.use(initReactI18next).init({
  resources: {
    zh: { translation: zh },
    en: { translation: en },
  },
  lng: detectInitialLang(),
  fallbackLng: ['zh', 'en'],
  // Always return a string so we never render a bare key in the UI.
  parseMissingKeyHandler: (key) => {
    // Use the last segment as a friendly human-readable label.
    const seg = key.split('.').pop() ?? key;
    return `[${seg}]`;
  },
  interpolation: { escapeValue: false }, // React already escapes
  returnObjects: true,
  // Emit a single warning in dev so we notice missing keys instead of silently rendering.
  saveMissing: import.meta.env.DEV,
  missingKeyHandler: (_lngs, _ns, key) => {
    if (import.meta.env.DEV) {
      log.warn(`missing key: ${key}`);
    }
  },
});

export function setLanguage(lang: 'zh' | 'en') {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* noop */
  }
}

export function getLanguage(): 'zh' | 'en' {
  return (i18n.language?.startsWith('zh') ? 'zh' : 'en') as 'zh' | 'en';
}

export default i18n;

