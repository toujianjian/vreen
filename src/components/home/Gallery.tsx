// Asset gallery — interactive cards with live 3D preview and metadata.
import { Suspense } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Box, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PresetPreview } from '@/components/three/PresetPreview';
import { HudPanel } from '@/components/hud/HudPanel';
import { PRESETS } from '@/lib/presets';
import { useUIStore } from '@/stores/uiStore';

export function Gallery() {
  const { t } = useTranslation();
  const pushLog = useUIStore((s) => s.pushLog);

  return (
    <section id="gallery" className="relative max-w-[1600px] mx-auto px-5 py-20">
      <header className="flex flex-wrap items-end justify-between gap-6 mb-10">
        <div>
          <div className="font-mono text-[11px] tracking-[0.32em] text-neon-cyan mb-2">
            <span className="inline-block w-8 h-px bg-neon-cyan align-middle mr-2" />
            {t('gallery.section')}
          </div>
          <h2 className="font-display font-black text-[clamp(1.8rem,3.6vw,3rem)] tracking-[0.04em] text-haze leading-tight">
            {t('gallery.title')}
          </h2>
          <p className="mt-2 text-mist text-sm max-w-2xl">
            {t('gallery.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.22em] text-mist">
          <span>{t('gallery.assetsCount', { count: PRESETS.length })}</span>
          <span className="w-1 h-1 rounded-full bg-neon-cyan" />
          <span className="text-neon-cyan">{t('gallery.online')}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {PRESETS.map((preset, i) => (
          <Link
            key={preset.id}
            to={`/viewer/${preset.id}`}
            onClick={() => pushLog('INFO', t('scene.loadingPreset', { id: preset.id }))}
            className="group relative block animate-fade-up"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <HudPanel className="overflow-hidden transition-all duration-300 group-hover:border-neon-cyan/50 group-hover:shadow-glow">
              <div className="relative aspect-[16/10] bg-space-950 overflow-hidden">
                {/* subtle grid behind preview */}
                <div className="absolute inset-0 bg-grid bg-grid-32 opacity-30" />
                <Suspense
                  fallback={
                    <div className="absolute inset-0 flex items-center justify-center text-mist text-xs font-mono">
                      {t('gallery.loading')}
                    </div>
                  }
                >
                  <PresetPreview
                    generator={preset.generator}
                    className="absolute inset-0"
                    rotate
                  />
                </Suspense>
                {/* top-right tag */}
                <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
                  <span className="hud-tag">{preset.tag}</span>
                  <span className="hud-tag hud-tag-mist">{(preset.format).toUpperCase()}</span>
                </div>
                {/* hover overlay */}
                <div className="absolute inset-0 bg-gradient-to-t from-space-900 via-space-900/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                <div className="absolute bottom-3 right-3 z-10 opacity-0 group-hover:opacity-100 transition-all duration-300 group-hover:translate-y-0 translate-y-1">
                  <span className="hud-btn !text-[10px] !px-2.5 !py-1">
                    {t('gallery.inspect')} <ArrowUpRight className="w-3 h-3" />
                  </span>
                </div>
              </div>

              <div className="p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-[13px] font-bold tracking-[0.18em] text-haze truncate">
                    {preset.name}
                  </h3>
                  <span className="font-mono text-[10px] text-mist shrink-0">#{String(i + 1).padStart(2, '0')}</span>
                </div>
                <p className="text-mist text-[12px] leading-relaxed line-clamp-2 min-h-[2.4em]">
                  {preset.description}
                </p>
                <div className="flex items-center gap-4 pt-2 border-t border-neon-cyan/10 text-[10px] font-mono tracking-[0.2em] text-mist">
                  <span className="flex items-center gap-1.5">
                    <Box className="w-3 h-3" />
                    {(preset.polyCount).toLocaleString()} {t('gallery.tris')}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Layers className="w-3 h-3" />
                    {t('gallery.idleLoop')}
                  </span>
                </div>
              </div>
            </HudPanel>
          </Link>
        ))}
      </div>
    </section>
  );
}
