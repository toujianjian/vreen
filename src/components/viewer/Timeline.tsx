// Timeline — animation playback bar with play/pause, scrubber, time display.
import { useTranslation } from 'react-i18next';
import { Play, Pause } from 'lucide-react';
import { useViewerStore } from '@/stores/viewerStore';

export function Timeline() {
  const { t } = useTranslation();
  const animation = useViewerStore((s) => s.animation);
  const setAnimation = useViewerStore((s) => s.setAnimation);

  const hasAnimation = animation.duration > 0;

  const togglePlay = () => setAnimation({ isPlaying: !animation.isPlaying });

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setAnimation({ currentTime: val });
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (!hasAnimation) return null;

  return (
    <div className="h-10 px-4 flex items-center gap-3 bg-space-900/85 backdrop-blur-xl border-t border-neon-cyan/15 text-[10px] font-mono">
      <button
        onClick={togglePlay}
        className="hud-btn !px-2 !py-1"
        title={animation.isPlaying ? t('toolbar.pause') : t('toolbar.play')}
      >
        {animation.isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
      </button>

      <span className="text-mist tracking-[0.14em] min-w-[2ch] tabular-nums">
        {formatTime(animation.currentTime)}
      </span>

      <div className="flex-1 relative">
        <input
          type="range"
          min={0}
          max={animation.duration || 1}
          step={0.01}
          value={animation.currentTime}
          onChange={handleScrub}
          className="w-full h-1 appearance-none bg-space-700 cursor-pointer accent-neon-cyan"
        />
        {/* Progress fill */}
        <div
          className="absolute top-1/2 -translate-y-1/2 left-0 h-1 bg-neon-cyan/50 pointer-events-none"
          style={{
            width: `${animation.duration > 0 ? (animation.currentTime / animation.duration) * 100 : 0}%`,
          }}
        />
      </div>

      <span className="text-mist tracking-[0.14em] min-w-[2ch] tabular-nums">
        {formatTime(animation.duration)}
      </span>

      <span className="text-mist/70 tracking-[0.18em] truncate max-w-[120px]">
        {animation.clipName || t('viewer.animations')}
      </span>
    </div>
  );
}
