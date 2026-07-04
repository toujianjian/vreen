// VREEN core type definitions

export type ModelFormat = 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl' | 'ply';

export type NodeKind = 'Group' | 'Mesh' | 'Bone' | 'Light' | 'Camera' | 'Other';

export interface SceneNode {
  id: string;
  name: string;
  type: NodeKind;
  visible: boolean;
  triCount: number;
  materialIds: string[];
  /** Original three.js object uuid for ref lookup */
  uuid: string;
  parentId: string | null;
  children: SceneNode[];
  depth: number;
}

export interface MaterialState {
  id: string;
  name: string;
  baseColor: string;
  metalness: number;
  roughness: number;
  emissive: string;
  emissiveIntensity: number;
  normalScale: number;
  opacity: number;
  wireframe: boolean;
}

export type EnvironmentPreset = 'studio' | 'sunset' | 'warehouse' | 'night' | 'city';

export interface EnvironmentState {
  preset: EnvironmentPreset;
  exposure: number;
  background: 'envmap' | 'transparent' | 'solid';
  backgroundColor: string;
}

export interface PostFXState {
  bloom: boolean;
  bloomIntensity: number;
  chromaticAberration: boolean;
  vignette: boolean;
  ssao: boolean;
}

export interface TransformState {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

export type CameraPreset =
  | 'free'
  | 'front'
  | 'back'
  | 'top'
  | 'side'
  | 'iso'
  | 'first-person'
  | 'third-person'
  | 'cinematic';

/** User-tunable camera parameters layered on top of any preset. */
export interface CameraState {
  preset: CameraPreset;
  /** Field of view in degrees (15-90). */
  fov: number;
  /** Distance multiplier applied to the preset's base distance (0.4-3.0). */
  distance: number;
  /** Vertical offset of the camera target (look-at point) in world units. */
  targetHeight: number;
  /** OrbitControls damping factor (0.0-0.3). */
  damping: number;
  /** Auto-rotation speed (radians/sec) used by 'cinematic' / autoRotate. */
  autoRotateSpeed: number;
  /** Whether OrbitControls allow free user navigation. */
  orbitEnabled: boolean;
  /** Cinematic mode: orbit angle in radians (0 = front, π/2 = side). */
  cinematicAngle: number;
  /** Cinematic mode: orbit speed in rad/s. */
  cinematicSpeed: number;
}

export const DEFAULT_CAMERA: CameraState = {
  preset: 'iso',
  fov: 32,
  distance: 1.0,
  targetHeight: 0.7,
  damping: 0.08,
  autoRotateSpeed: 0.18,
  orbitEnabled: true,
  cinematicAngle: 0,
  cinematicSpeed: 0.35,
};

export interface PresetAsset {
  id: string;
  name: string;
  tag: string;
  format: ModelFormat;
  /** Procedural generator function — we don't ship binary assets; we generate. */
  generator: 'mech' | 'crystal' | 'tree' | 'ship' | 'creature' | 'totem';
  description: string;
  polyCount: number;
}

export interface UploadedAsset {
  id: string;
  name: string;
  format: ModelFormat;
  sizeBytes: number;
  /** Object URL for GLB/GLTF/OBJ/FBX/STL/PLY; for these we use file blob */
  blobUrl: string;
  loadedAt: number;
}

export type AssetSource =
  | { kind: 'preset'; presetId: string }
  | { kind: 'upload'; uploadId: string };

export interface SceneStats {
  fps: number;
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  programs: number;
}

export interface AnimationState {
  clipName: string;
  isPlaying: boolean;
  speed: number;
  currentTime: number;
  duration: number;
}
