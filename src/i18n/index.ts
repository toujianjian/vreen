// i18n bootstrap — English default, fallback en, localStorage persistence.
import { createLogger } from '@/lib/logger';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import zh from './locales/zh.json';
import en from './locales/en.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import es from './locales/es.json';

const log = createLogger('i18n');

const STORAGE_KEY = 'vreen.lang';

export type AppLang = 'en' | 'zh' | 'ja' | 'ko' | 'es';
const SUPPORTED: AppLang[] = ['en', 'zh', 'ja', 'ko', 'es'];

function isAppLang(v: unknown): v is AppLang {
  return typeof v === 'string' && (SUPPORTED as string[]).includes(v);
}

// 1) Determine initial language: localStorage > navigator > 'en' (default).
function detectInitialLang(): AppLang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isAppLang(saved)) return saved;
  } catch {
    /* localStorage may be unavailable (e.g. Electron with strict cookie policy) */
  }
  const nav = (typeof navigator !== 'undefined' ? navigator.language : 'en') || 'en';
  const lower = nav.toLowerCase();
  if (lower.startsWith('zh')) return 'zh';
  if (lower.startsWith('ja')) return 'ja';
  if (lower.startsWith('ko')) return 'ko';
  if (lower.startsWith('es')) return 'es';
  return 'en';
}

// 2) Build the set of keys present in en.json (source of truth for the "must-have" set).
//    We surface a list of keys missing in any of the non-English locales so missing
//    translations are easy to spot in dev.
const missingPerLocale = new Map<string, string[]>();
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
const enKeys = new Set(flattenKeys(en as unknown as Record<string, unknown>));
function diffAgainstEn(name: string, data: unknown) {
  const keys = new Set(flattenKeys(data as Record<string, unknown>));
  const missing: string[] = [];
  for (const k of enKeys) {
    if (!keys.has(k)) missing.push(k);
  }
  if (missing.length) missingPerLocale.set(name, missing);
}
diffAgainstEn('zh', zh);
diffAgainstEn('ja', ja);
diffAgainstEn('ko', ko);
diffAgainstEn('es', es);
if (typeof window !== 'undefined') {
  (window as unknown as { __VREEN_I18N_MISSING__?: Record<string, string[]> }).__VREEN_I18N_MISSING__ =
    Object.fromEntries(missingPerLocale);
}

void i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    ja: { translation: ja },
    ko: { translation: ko },
    es: { translation: es },
  },
  lng: detectInitialLang(),
  fallbackLng: 'en',
  supportedLngs: SUPPORTED,
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

export function setLanguage(lang: AppLang) {
  void i18n.changeLanguage(lang);
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    /* noop */
  }
}

export function getLanguage(): AppLang {
  const lng = i18n.language;
  if (isAppLang(lng)) return lng;
  // Fall back to prefix match (e.g. "en-US" → "en").
  if (typeof lng === 'string') {
    const lower = lng.toLowerCase();
    for (const candidate of SUPPORTED) {
      if (lower.startsWith(candidate)) return candidate;
    }
  }
  return 'en';
}

export function listLanguages(): AppLang[] {
  return [...SUPPORTED];
}

export default i18n;
