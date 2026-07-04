// Viewer toolbar: top bar with camera presets, playback, screenshot, exit.
import {
  ArrowLeft,
  Camera,
  Circle,
  Download,
  Pause,
  Play,
  Repeat,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useViewerStore, NO_ASSET_NAME, NO_ASSET_NAME_KEY } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';
import { screenshotCanvas } from '@/lib/screenshot';
import { cn } from '@/lib/cn';
import type { CameraPreset } from '@/types';
import { CAMERA_PRESET_LIST } from '@/three/camera';

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

export function ViewerToolbar() {
  const { t } = useTranslation();
  const cameraPreset = useViewerStore((s) => s.camera.preset);
  const setCameraPreset = useViewerStore((s) => s.setCameraPreset);
  const animation = useViewerStore((s) => s.animation);
  const setAnimation = useViewerStore((s) => s.setAnimation);
  const assetName = useViewerStore((s) => s.assetName);
  const pushLog = useUIStore((s) => s.pushLog);
  const [capturing, setCapturing] = useState(false);

  const togglePlay = () => {
    setAnimation({ isPlaying: !animation.isPlaying });
    pushLog('INFO', animation.isPlaying ? t('toolbar.logs.paused') : t('toolbar.logs.resumed'));
  };

  const handleScreenshot = async () => {
    setCapturing(true);
    pushLog('INFO', t('toolbar.logs.capturing'));
    try {
      await screenshotCanvas(`${assetName.replace(/\s+/g, '_')}_${Date.now()}.png`);
      pushLog('OK', t('toolbar.logs.saved'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog('ERR', t('toolbar.logs.failed', { msg }));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="relative flex items-center justify-between gap-3 px-4 h-14 bg-space-900/85 backdrop-blur-xl border-b border-neon-cyan/15">
      {/* Left: Back + asset name */}
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/" className="hud-btn hud-btn-ghost shrink-0" aria-label={t('toolbar.exit')}>
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t('toolbar.exit')}</span>
        </Link>
        <div className="h-6 w-px bg-neon-cyan/20" />
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-[0.22em] text-mist">{t('viewer.ready')}</div>
          <div className="font-display text-[12px] tracking-[0.18em] text-haze truncate">
            {assetName === NO_ASSET_NAME ? t(NO_ASSET_NAME_KEY) : assetName}
          </div>
        </div>
      </div>

      {/* Center: Camera + playback */}
      <div className="hidden lg:flex items-center gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 mr-1 shrink-0">
          <Camera className="w-3 h-3 text-neon-cyan" />
          <span className="hud-label">{t('viewer.pov')}</span>
        </div>
        <div className="flex items-center gap-1 p-1 border border-neon-cyan/20 bg-space-800/40">
          {CAMERA_PRESET_LIST.map((p) => {
            const key = presetToI18nKey(p.value);
            return (
              <button
                key={p.value}
                onClick={() => setCameraPreset(p.value as CameraPreset)}
                className={cn(
                  'px-2 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors shrink-0',
                  cameraPreset === p.value
                    ? 'bg-neon-cyan/15 text-neon-cyan'
                    : 'text-mist hover:text-haze',
                )}
                title={p.tag}
              >
                {t(`viewer.preset.${key}`)}
              </button>
            );
          })}
        </div>

        <div className="w-px h-6 bg-neon-cyan/20 mx-2" />

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={togglePlay}
            className={cn('hud-btn', animation.isPlaying ? '' : 'hud-btn-amber')}
            aria-label={animation.isPlaying ? t('toolbar.pause') : t('toolbar.play')}
          >
            {animation.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{animation.isPlaying ? t('toolbar.pause') : t('toolbar.play')}</span>
          </button>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-mist ml-1">
            <Repeat className="w-3 h-3" />
            <span>{t('toolbar.speed')}</span>
            <select
              value={animation.speed}
              onChange={(e) => setAnimation({ speed: parseFloat(e.target.value) })}
              className="bg-space-800 border border-neon-cyan/20 px-1 py-0.5 text-haze"
            >
              {[0.25, 0.5, 1, 1.5, 2].map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Right: Screenshot */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleScreenshot}
          disabled={capturing}
          className={cn('hud-btn hud-btn-magenta', capturing && 'opacity-60')}
          aria-label={t('viewer.capture')}
        >
          {capturing ? <Circle className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          <span>{capturing ? t('viewer.capturing') : t('viewer.capture')}</span>
        </button>
      </div>
    </div>
  );
}
