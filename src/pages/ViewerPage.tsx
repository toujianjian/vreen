// Viewer page: the full inspector experience
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Stage } from '@/components/viewer/Stage';
import { Outliner } from '@/components/viewer/Outliner';
import { Inspector } from '@/components/viewer/Inspector';
import { ViewerToolbar } from '@/components/viewer/ViewerToolbar';
import { ViewerStatusBar } from '@/components/viewer/ViewerStatusBar';
import { useViewerStore } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';
import { getPresetById } from '@/lib/presets';

export function ViewerPage() {
  const { assetId } = useParams<{ assetId?: string }>();
  const setAssetSource = useViewerStore((s) => s.setAssetSource);
  const pushLog = useUIStore((s) => s.pushLog);

  // Resolve route param to an asset source on mount
  useEffect(() => {
    if (assetId) {
      const preset = getPresetById(assetId);
      if (preset) {
        setAssetSource({ kind: 'preset', presetId: preset.id }, preset.name);
        pushLog('OK', `Booted preset "${preset.name}" (${preset.polyCount.toLocaleString()} tris)`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetId]);

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
        </aside>
      </div>
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
  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-space-900/60 backdrop-blur border border-neon-cyan/20 font-mono text-[10px] tracking-[0.22em] text-neon-cyan">
      STAGE // LIVE
    </div>
  );
}
