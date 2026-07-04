// Status bar at the bottom of the viewer
import { Box, Camera, Cpu, Gauge, Layers, Maximize2, Timer } from 'lucide-react';
import { useViewerStore } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';
import { CAMERA_PRESETS } from '@/three/camera';

export function ViewerStatusBar() {
  const stats = useViewerStore((s) => s.stats);
  const animation = useViewerStore((s) => s.animation);
  const cameraPreset = useViewerStore((s) => s.camera.preset);
  const fov = useViewerStore((s) => s.camera.fov);
  const isLoading = useViewerStore((s) => s.isLoading);
  const loadProgress = useViewerStore((s) => s.loadProgress);
  const environment = useUIStore((s) => s.environment);

  const items = [
    { icon: <Gauge className="w-3 h-3" />, k: 'FPS', v: stats.fps.toString().padStart(3, '0'), color: stats.fps >= 50 ? 'text-emerald-300' : stats.fps >= 30 ? 'text-neon-amber' : 'text-neon-magenta' },
    { icon: <Box className="w-3 h-3" />, k: 'TRIS', v: stats.triangles.toLocaleString(), color: 'text-neon-cyan' },
    { icon: <Layers className="w-3 h-3" />, k: 'MESHES', v: stats.geometries.toString(), color: 'text-neon-cyan' },
    { icon: <Cpu className="w-3 h-3" />, k: 'MATS', v: stats.textures.toString(), color: 'text-neon-cyan' },
    { icon: <Camera className="w-3 h-3" />, k: 'POV', v: CAMERA_PRESETS[cameraPreset].label, color: 'text-neon-magenta' },
    { icon: <Maximize2 className="w-3 h-3" />, k: 'FOV', v: `${fov.toFixed(0)}°`, color: 'text-neon-cyan' },
    { icon: <Timer className="w-3 h-3" />, k: 'T', v: `${animation.currentTime.toFixed(2)}s`, color: 'text-neon-amber' },
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
            <span>LOADING {Math.round(loadProgress * 100)}%</span>
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
            <span>STREAMING</span>
          </div>
        )}
        <span className="text-mist">ENV: {environment.preset.toUpperCase()}</span>
        <span className="text-mist">EXP: {environment.exposure.toFixed(2)}</span>
      </div>
    </div>
  );
}
