import { create } from 'zustand';
import type { AssetSource, SceneStats, AnimationState, CameraState, SceneNode } from '@/types';
import { DEFAULT_CAMERA } from '@/types';

interface ViewerState {
  /** Current asset source, if any. */
  assetSource: AssetSource | null;
  /** Display name of current asset */
  assetName: string;
  /** Stats of the current 3D scene */
  stats: SceneStats;
  /** Animation playback */
  animation: AnimationState;
  /** Camera state (preset + tunables). */
  camera: CameraState;
  /** Loading state */
  isLoading: boolean;
  /** Loader progress 0..1 */
  loadProgress: number;
  /** Error message */
  errorMessage: string | null;
  /** Show wireframe */
  showWireframe: boolean;
  /** Show ground plane */
  showGround: boolean;
  /** Is auto-rotate enabled */
  autoRotate: boolean;
  /** Real scene tree built from loaded THREE.Object3D */
  sceneTree: SceneNode[];

  // Actions
  setAssetSource: (source: AssetSource | null, name?: string) => void;
  setSceneTree: (nodes: SceneNode[]) => void;
  setAssetName: (name: string) => void;
  setStats: (stats: Partial<SceneStats>) => void;
  setAnimation: (anim: Partial<AnimationState>) => void;
  setCameraPreset: (preset: CameraState['preset']) => void;
  setCamera: (patch: Partial<CameraState>) => void;
  resetCamera: () => void;
  setLoading: (loading: boolean) => void;
  setLoadProgress: (p: number) => void;
  setError: (msg: string | null) => void;
  toggleWireframe: () => void;
  toggleGround: () => void;
  toggleAutoRotate: () => void;
  reset: () => void;
}

const DEFAULT_STATS: SceneStats = {
  fps: 0,
  triangles: 0,
  drawCalls: 0,
  geometries: 0,
  textures: 0,
  programs: 0,
};

const DEFAULT_ANIM: AnimationState = {
  clipName: '',
  isPlaying: false,
  speed: 1,
  currentTime: 0,
  duration: 0,
};

/** Default placeholders surfaced when no asset is selected yet.
 * The corresponding i18n keys live in `viewer.noAsset` and `viewer.ready`. */
export const NO_ASSET_NAME = '— no asset loaded —';
export const NO_ASSET_NAME_KEY = 'viewer.noAsset';

export const useViewerStore = create<ViewerState>((set) => ({
  assetSource: null,
  assetName: NO_ASSET_NAME,
  stats: { ...DEFAULT_STATS },
  animation: { ...DEFAULT_ANIM },
  camera: { ...DEFAULT_CAMERA },
  isLoading: false,
  loadProgress: 0,
  errorMessage: null,
  showWireframe: false,
  showGround: true,
  autoRotate: true,
  sceneTree: [],

  setAssetSource: (source, name) =>
    set(() => ({
      assetSource: source,
      assetName: name ?? (source?.kind === 'preset' ? source.presetId : 'uploaded asset'),
      isLoading: source !== null,
      loadProgress: source ? 0.05 : 0,
      errorMessage: null,
      animation: { ...DEFAULT_ANIM },
      sceneTree: [],
    })),
  setSceneTree: (nodes) => set({ sceneTree: nodes }),
  setAssetName: (name) => set({ assetName: name }),
  setStats: (partial) =>
    set((s) => ({
      stats: { ...s.stats, ...partial },
    })),
  setAnimation: (anim) =>
    set((s) => ({
      animation: { ...s.animation, ...anim },
    })),
  setCameraPreset: (preset) =>
    set((s) => ({
      camera: { ...s.camera, preset },
    })),
  setCamera: (patch) =>
    set((s) => ({
      camera: { ...s.camera, ...patch },
    })),
  resetCamera: () => set({ camera: { ...DEFAULT_CAMERA, preset: 'iso' } }),
  setLoading: (loading) => set({ isLoading: loading }),
  setLoadProgress: (p) => set({ loadProgress: p }),
  setError: (msg) => set({ errorMessage: msg, isLoading: false }),
  toggleWireframe: () => set((s) => ({ showWireframe: !s.showWireframe })),
  toggleGround: () => set((s) => ({ showGround: !s.showGround })),
  toggleAutoRotate: () => set((s) => ({ autoRotate: !s.autoRotate })),
  reset: () =>
    set({
      assetSource: null,
      assetName: NO_ASSET_NAME,
      stats: { ...DEFAULT_STATS },
      animation: { ...DEFAULT_ANIM },
      isLoading: false,
      loadProgress: 0,
      errorMessage: null,
      sceneTree: [],
    }),
}));
