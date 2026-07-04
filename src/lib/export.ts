// export.ts — serializes the current viewer state to a .vreen project file.
import { useViewerStore } from '@/stores/viewerStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { useUIStore } from '@/stores/uiStore';

export interface VreenPackage {
  version: '0.1.0';
  exportedAt: string;
  assetName: string;
  camera: ReturnType<typeof useViewerStore.getState>['camera'];
  animation: Pick<ReturnType<typeof useViewerStore.getState>['animation'], 'speed'>;
  materials: ReturnType<typeof useInspectorStore.getState>['materials'];
  environment: ReturnType<typeof useUIStore.getState>['environment'];
  postFX: ReturnType<typeof useUIStore.getState>['postFX'];
}

export function exportVreenPackage(): VreenPackage {
  const viewer = useViewerStore.getState();
  const inspector = useInspectorStore.getState();
  const ui = useUIStore.getState();
  return {
    version: '0.1.0',
    exportedAt: new Date().toISOString(),
    assetName: viewer.assetName,
    camera: viewer.camera,
    animation: { speed: viewer.animation.speed },
    materials: inspector.materials,
    environment: ui.environment,
    postFX: ui.postFX,
  };
}

export function downloadVreenPackage(pkg: VreenPackage) {
  const json = JSON.stringify(pkg, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${pkg.assetName.replace(/\s+/g, '_')}.vreen.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
