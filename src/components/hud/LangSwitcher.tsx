// Language switcher — toggles between Chinese (default) and English.
// Persists choice to localStorage; subscribes to i18n for live updates.
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react';
import { getLanguage, setLanguage } from '@/i18n';
import { cn } from '@/lib/cn';

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
      <button
        type="button"
        onClick={() => setLanguage('zh')}
        className={cn(
          'px-2.5 py-1 transition-colors',
          current === 'zh' ? 'text-neon-cyan text-glow-soft' : 'text-mist hover:text-haze',
        )}
        aria-pressed={current === 'zh'}
      >
        中
      </button>
      <span className="text-mist/40">·</span>
      <button
        type="button"
        onClick={() => setLanguage('en')}
        className={cn(
          'px-2.5 py-1 transition-colors',
          current === 'en' ? 'text-neon-cyan text-glow-soft' : 'text-mist hover:text-haze',
        )}
        aria-pressed={current === 'en'}
      >
        EN
      </button>
    </div>
  );
}
