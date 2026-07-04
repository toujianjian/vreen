// Status bar at the bottom of the viewer
import { Box, Camera, Cpu, Gauge, Layers, Maximize2, Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useViewerStore } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';
import { CAMERA_PRESETS } from '@/three/camera';

export function ViewerStatusBar() {
  const { t } = useTranslation();
  const stats = useViewerStore((s) => s.stats);
  const animation = useViewerStore((s) => s.animation);
  const cameraPreset = useViewerStore((s) => s.camera.preset);
  const fov = useViewerStore((s) => s.camera.fov);
  const isLoading = useViewerStore((s) => s.isLoading);
  const loadProgress = useViewerStore((s) => s.loadProgress);
  const environment = useUIStore((s) => s.environment);

  const povKey = presetToI18nKey(cameraPreset);

  const items = [
    { icon: <Gauge className="w-3 h-3" />, k: t('viewer.fps'), v: stats.fps.toString().padStart(3, '0'), color: stats.fps >= 50 ? 'text-emerald-300' : stats.fps >= 30 ? 'text-neon-amber' : 'text-neon-magenta' },
    { icon: <Box className="w-3 h-3" />, k: t('viewer.tris'), v: stats.triangles.toLocaleString(), color: 'text-neon-cyan' },
    { icon: <Layers className="w-3 h-3" />, k: t('viewer.meshes'), v: stats.geometries.toString(), color: 'text-neon-cyan' },
    { icon: <Cpu className="w-3 h-3" />, k: t('viewer.materials'), v: stats.textures.toString(), color: 'text-neon-cyan' },
    { icon: <Camera className="w-3 h-3" />, k: t('viewer.pov'), v: t(`viewer.preset.${povKey}`), color: 'text-neon-magenta' },
    { icon: <Maximize2 className="w-3 h-3" />, k: t('viewer.fov'), v: `${fov.toFixed(0)}°`, color: 'text-neon-cyan' },
    { icon: <Timer className="w-3 h-3" />, k: t('statusbar.time'), v: `${animation.currentTime.toFixed(2)}s`, color: 'text-neon-amber' },
  ];

  return (
    <div className="h-8 px-4 flex items-center justify-between gap-4 bg-space-900/85 backdrop-blur-xl border-t border-neon-cyan/15 text-[10px] font-mono">
      <div className="flex items-center gap-4 overflow-x-auto">
        {items.map((it) => (
          <div key={it.k} className="flex items-center gap-1.5 shrink-0">
            <span className="text-mist">{it.icon}</span>
            <span className="text-mist tracking-[0.18em]">{it.k}</span>
            <span className={`${it.color} tabular-nums tracking-[0.05em]`}>{it.v}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        {isLoading ? (
          <div className="flex items-center gap-2 text-neon-amber">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-amber animate-pulse" />
            <span>{t('viewer.loading')} {Math.round(loadProgress * 100)}%</span>
            <div className="w-20 h-1 bg-space-800 overflow-hidden">
              <div
                className="h-full bg-neon-amber shadow-glow-amber"
                style={{ width: `${loadProgress * 100}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-neon-cyan">
            <span className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
            <span>{t('statusbar.streaming')}</span>
          </div>
        )}
        <span className="text-mist">{t('statusbar.env')}: {environment.preset.toUpperCase()}</span>
        <span className="text-mist">{t('statusbar.exp')}: {environment.exposure.toFixed(2)}</span>
      </div>
    </div>
  );
}

function presetToI18nKey(v: string): 'free' | 'iso' | 'front' | 'back' | 'side' | 'top' | 'first' | 'third' | 'cine' {
  switch (v) {
    case 'free': return 'free';
    case 'iso': return 'iso';
    case 'front': return 'front';
    case 'back': return 'back';
    case 'side': return 'side';
    case 'top': return 'top';
    case 'first-person': return 'first';
    case 'third-person': return 'third';
    case 'cinematic': return 'cine';
    default: return 'free';
  }
}
