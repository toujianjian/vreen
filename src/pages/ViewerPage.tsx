// Viewer page: the full inspector experience
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Stage } from '@/components/viewer/Stage';
import { Outliner } from '@/components/viewer/Outliner';
import { Inspector } from '@/components/viewer/Inspector';
import { VreenInspectorPanel } from '@/components/viewer/VreenInspectorPanel';
import { ViewerToolbar } from '@/components/viewer/ViewerToolbar';
import { ViewerStatusBar } from '@/components/viewer/ViewerStatusBar';
import { Timeline } from '@/components/viewer/Timeline';
import { useViewerStore } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';
import { useWorldStore } from '@/stores/worldStore';
import { getPresetById } from '@/lib/presets';
import { PlayerInput, PlayerInputC } from '@/engine/ECS';

export function ViewerPage() {
  const { assetId } = useParams<{ assetId?: string }>();
  const { t } = useTranslation();
  const setAssetSource = useViewerStore((s) => s.setAssetSource);
  const pushLog = useUIStore((s) => s.pushLog);
  const cameraYaw = useViewerStore((s) => s.camera.yaw);
  const world = useWorldStore((s) => s.world);

  // Resolve route param to an asset source on mount
  useEffect(() => {
    if (assetId) {
      const preset = getPresetById(assetId);
      if (preset) {
        setAssetSource({ kind: 'preset', presetId: preset.id }, preset.name);
        pushLog('OK', t('scene.booted', { name: preset.name, tris: preset.polyCount.toLocaleString() }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

  // Keyboard → PlayerInput (WASD + Shift + Space). 监听在 ViewerPage 顶层,
  // 避免 Canvas 抢焦点问题。
  useEffect(() => {
    const keys = new Set<string>();
    const onDown = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', ' ', 'shift'].includes(k)) {
        e.preventDefault();
      }
      keys.add(k);
      syncInput();
    };
    const onUp = (e: KeyboardEvent) => {
      keys.delete(e.key.toLowerCase());
      syncInput();
    };
    const syncInput = () => {
      if (!world) return;
      // 把 cameraYaw 同步给所有带 PlayerInput 的 entity (root entity)
      world.queryWith(PlayerInputC, (id, input) => {
        input.forward = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
        input.right = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);
        input.run = keys.has('shift');
        input.jump = keys.has(' ');
        input.cameraYaw = cameraYaw ?? 0;
      });
      useWorldStore.setState((s) => ({ version: s.version + 1 }));
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, [world, cameraYaw]);

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] -mt-0">
      <ViewerToolbar />
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr_340px] min-h-0 bg-space-950">
        <aside className="hidden lg:flex flex-col border-r border-neon-cyan/10 min-h-0">
          <Outliner />
        </aside>
        <main className="relative min-h-0">
          <Stage />
          {/* HUD overlay corners */}
          <div className="pointer-events-none absolute inset-0 z-10">
            <CornerMarkers />
            <ScanOverlay />
          </div>
        </main>
        <aside className="hidden lg:flex flex-col border-l border-neon-magenta/15 min-h-0">
          <Inspector />
          <VreenInspectorPanel />
        </aside>
      </div>
      <Timeline />
      <ViewerStatusBar />
    </div>
  );
}

function CornerMarkers() {
  const cls = 'absolute w-4 h-4 border-neon-cyan/70';
  return (
    <>
      <span className={`${cls} top-3 left-3 border-t-2 border-l-2`} />
      <span className={`${cls} top-3 right-3 border-t-2 border-r-2`} />
      <span className={`${cls} bottom-3 left-3 border-b-2 border-l-2`} />
      <span className={`${cls} bottom-3 right-3 border-b-2 border-r-2`} />
    </>
  );
}

function ScanOverlay() {
  const { t } = useTranslation();
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-space-900/60 backdrop-blur border border-neon-cyan/20 font-mono text-[10px] tracking-[0.22em] text-neon-cyan">
      {t('scene.stageLive')}
    </div>
  );
}
