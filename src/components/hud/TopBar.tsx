// Top HUD bar — fixed across all pages
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity, ChevronRight, Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import { formatUtc } from '@/lib/format';
import { LangSwitcher } from './LangSwitcher';

export function TopBar() {
  const { t } = useTranslation();
  const location = useLocation();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const isViewer = location.pathname.startsWith('/viewer');
  const breadcrumb = isViewer
    ? `${t('nav.viewer').toLowerCase()} / ${t('viewer.inspector').toLowerCase()}`
    : `${t('nav.home').toLowerCase()} / index`;

  return (
    <header className="sticky top-0 z-50 h-14 backdrop-blur-xl bg-space-900/70 border-b border-neon-cyan/15">
      <div className="h-full max-w-[1600px] mx-auto px-5 flex items-center justify-between gap-4">
        <Link to="/" className="group flex items-center gap-3">
          <div className="relative w-7 h-7 flex items-center justify-center">
            <div className="absolute inset-0 border border-neon-cyan/60 rotate-45 group-hover:rotate-[55deg] transition-transform duration-500" />
            <div className="absolute inset-1 border border-neon-magenta/40 rotate-45 group-hover:rotate-[35deg] transition-transform duration-500" />
            <span className="relative font-display font-black text-[11px] text-neon-cyan text-glow-soft">V</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display font-bold text-[13px] tracking-[0.32em] text-haze">{t('app.name')}</span>
            <span className="font-mono text-[9px] tracking-[0.24em] text-mist mt-0.5">{t('app.systemLabel')}</span>
          </div>
        </Link>

        <nav className="hidden md:flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em]">
          <span className="text-mist">~/</span>
          <span className="text-neon-cyan/80">{breadcrumb}</span>
          <ChevronRight className="w-3 h-3 text-mist/60" />
          <span className="text-haze/80">{isViewer ? t('topbar.runtime') : t('topbar.idle')}</span>
        </nav>

        <div className="flex items-center gap-4 font-mono text-[10px] uppercase tracking-[0.2em]">
          <LangSwitcher className="hidden sm:inline-flex" />
          <div className="hidden sm:flex items-center gap-1.5 text-mist">
            <Cpu className="w-3 h-3" />
            <span>{t('topbar.gpuOk')}</span>
          </div>
          <div className="hidden sm:flex items-center gap-1.5 text-neon-cyan">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse shadow-glow" />
            <span>{t('topbar.linkStable')}</span>
          </div>
          <div className="flex items-center gap-1.5 text-haze/80">
            <Activity className="w-3 h-3 text-neon-cyan" />
            <span className="hidden md:inline">{t('topbar.version')}</span>
          </div>
          <div className="text-neon-amber/90 tabular-nums">{formatUtc(now).split(' ')[1]}</div>
        </div>
      </div>
      <div className="absolute left-0 right-0 bottom-0 h-px bg-gradient-to-r from-transparent via-neon-cyan/40 to-transparent" />
    </header>
  );
}
