// Language switcher — selects among supported languages (default: English).
// Persists choice to localStorage; subscribes to i18n for live updates.
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { AppLang, getLanguage, setLanguage } from '@/i18n';
import { cn } from '@/lib/cn';

// Short display labels for each supported language, tuned for the compact HUD style.
const LANG_LABELS: Record<AppLang, string> = {
  en: 'EN',
  zh: '中',
  ja: '日',
  ko: '한',
  es: 'ES',
};

// Order shown in the switcher. English first (matches the default language).
const LANG_ORDER: AppLang[] = ['en', 'zh', 'ja', 'ko', 'es'];

export function LangSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const current = getLanguage();

  return (
    <div
      className={cn(
        'inline-flex items-center border border-neon-cyan/20 bg-space-800/60 backdrop-blur-sm',
        'font-mono text-[10px] tracking-[0.18em] uppercase',
        className,
      )}
      role="group"
      aria-label={t('nav.language')}
    >
      <span className="px-2 py-1 text-mist border-r border-neon-cyan/15">
        <Languages className="w-3 h-3 inline-block align-middle" />
      </span>
      {LANG_ORDER.map((lang, i) => (
        <span key={lang} className="inline-flex items-center">
          {i > 0 && <span className="text-mist/40">·</span>}
          <button
            type="button"
            onClick={() => setLanguage(lang)}
            className={cn(
              'px-2 py-1 transition-colors',
              current === lang ? 'text-neon-cyan text-glow-soft' : 'text-mist hover:text-haze',
            )}
            aria-pressed={current === lang}
          >
            {LANG_LABELS[lang]}
          </button>
        </span>
      ))}
    </div>
  );
}
