// VREEN 3D camera system.
//
// Each preset defines a base camera position (relative to world origin) and a
// look-at target. The user-tunable CameraState (FOV / distance / damping / etc.)
// is layered on top of the preset at render time. This keeps the rigs
// data-driven and trivially extensible.

import * as THREE from 'three';
import type { CameraPreset } from '@/types';

export interface CameraRigConfig {
  /** Base position of the camera in world units. */
  position: [number, number, number];
  /** Look-at target. */
  target: [number, number, number];
  /** Optional polar/azimuth constraints; undefined = no constraint. */
  minPolarAngle?: number;
  maxPolarAngle?: number;
  /** Disable free orbit for this preset (cinematic / fixed). */
  locked?: boolean;
  /** Default FOV override for this preset (degrees). */
  fov?: number;
  /** Human-readable label for UI. */
  label: string;
  /** Short chip-style badge, e.g. 'POV'. */
  tag: string;
  /** English fallback description (used in tooltips and as last-resort i18n fallback). */
  description: string;
  /** i18n key for the translated description (viewer.presetDesc.*). */
  descriptionKey:
    | 'viewer.presetDesc.free'
    | 'viewer.presetDesc.iso'
    | 'viewer.presetDesc.front'
    | 'viewer.presetDesc.back'
    | 'viewer.presetDesc.side'
    | 'viewer.presetDesc.top'
    | 'viewer.presetDesc.first'
    | 'viewer.presetDesc.third'
    | 'viewer.presetDesc.cine';
}

export const CAMERA_PRESETS: Record<CameraPreset, CameraRigConfig> = {
  free: {
    position: [4.2, 3, 4.2],
    target: [0, 0.7, 0],
    label: 'FREE',
    tag: 'ORBIT',
    description: 'Full free orbit. Default working camera.',
    descriptionKey: 'viewer.presetDesc.free',
  },
  iso: {
    position: [4.2, 3, 4.2],
    target: [0, 0.7, 0],
    label: 'ISO',
    tag: 'GAME',
    description: 'Classic 45° isometric. Great for inspecting silhouettes.',
    descriptionKey: 'viewer.presetDesc.iso',
  },
  front: {
    position: [0, 1.4, 6],
    target: [0, 0.9, 0],
    minPolarAngle: Math.PI * 0.25,
    maxPolarAngle: Math.PI * 0.65,
    label: 'FRONT',
    tag: 'AXIS',
    description: 'Head-on portrait view.',
    descriptionKey: 'viewer.presetDesc.front',
  },
  back: {
    position: [0, 1.4, -6],
    target: [0, 0.9, 0],
    minPolarAngle: Math.PI * 0.25,
    maxPolarAngle: Math.PI * 0.65,
    label: 'BACK',
    tag: 'AXIS',
    description: 'Rear view. Useful for back-of-character inspection.',
    descriptionKey: 'viewer.presetDesc.back',
  },
  side: {
    position: [6, 1.4, 0],
    target: [0, 0.9, 0],
    minPolarAngle: Math.PI * 0.25,
    maxPolarAngle: Math.PI * 0.65,
    label: 'SIDE',
    tag: 'AXIS',
    description: 'Side profile (left).',
    descriptionKey: 'viewer.presetDesc.side',
  },
  top: {
    position: [0.01, 7, 0.01],
    target: [0, 0, 0],
    minPolarAngle: 0,
    maxPolarAngle: 0.35,
    label: 'TOP',
    tag: 'PLAN',
    description: 'Top-down plan view.',
    descriptionKey: 'viewer.presetDesc.top',
  },
  'first-person': {
    position: [0, 1.6, 2.2],
    target: [0, 1.6, 0],
    minPolarAngle: Math.PI * 0.4,
    maxPolarAngle: Math.PI * 0.6,
    fov: 60,
    label: '1ST',
    tag: 'POV',
    description: 'First-person: stand at eye-level, look at the model.',
    descriptionKey: 'viewer.presetDesc.first',
  },
  'third-person': {
    position: [0, 1.8, -3.6],
    target: [0, 1.2, 0],
    minPolarAngle: Math.PI * 0.3,
    maxPolarAngle: Math.PI * 0.6,
    fov: 42,
    label: '3RD',
    tag: 'POV',
    description: 'Third-person: behind & slightly above the model.',
    descriptionKey: 'viewer.presetDesc.third',
  },
  cinematic: {
    position: [4.5, 2.4, 4.5],
    target: [0, 0.9, 0],
    locked: true,
    fov: 36,
    label: 'CINE',
    tag: 'PATH',
    description: 'Auto-orbiting cinematic path. No user input.',
    descriptionKey: 'viewer.presetDesc.cine',
  },
};

/** Ordered list for UI rendering. */
export const CAMERA_PRESET_LIST: { value: CameraPreset; label: string; tag: string }[] = (
  Object.keys(CAMERA_PRESETS) as CameraPreset[]
).map((k) => ({
  value: k,
  label: CAMERA_PRESETS[k].label,
  tag: CAMERA_PRESETS[k].tag,
}));

/**
 * Apply a preset + tunables to a camera. The camera is positioned at the
 * preset's base position scaled by `distance`, looking at the preset's
 * target shifted by `targetHeight` on the Y axis. FOV is overridden.
 */
export function applyCameraPreset(
  camera: THREE.PerspectiveCamera,
  preset: CameraPreset,
  tunables: {
    distance: number;
    targetHeight: number;
    fov: number;
  },
): void {
  const cfg = CAMERA_PRESETS[preset];
  if (!cfg) return;
  const [px, py, pz] = cfg.position;
  camera.position.set(px * tunables.distance, py, pz * tunables.distance);
  camera.lookAt(cfg.target[0], cfg.target[1] + tunables.targetHeight, cfg.target[2]);
  const newFov = cfg.fov ?? tunables.fov;
  if (Math.abs(camera.fov - newFov) > 0.01) {
    camera.fov = newFov;
    camera.updateProjectionMatrix();
  }
}

/** Animate the camera to a preset+target over a duration (ms). */
export function animateCameraToPreset(
  camera: THREE.PerspectiveCamera,
  preset: CameraPreset,
  tunables: { distance: number; targetHeight: number; fov: number },
  options: { duration?: number; easing?: (k: number) => number } = {},
): void {
  const cfg = CAMERA_PRESETS[preset];
  if (!cfg) return;
  const startPos = camera.position.clone();
  const startFov = camera.fov;
  const endPos = new THREE.Vector3(
    cfg.position[0] * tunables.distance,
    cfg.position[1],
    cfg.position[2] * tunables.distance,
  );
  const endLook = new THREE.Vector3(
    cfg.target[0],
    cfg.target[1] + tunables.targetHeight,
    cfg.target[2],
  );
  const endFov = cfg.fov ?? tunables.fov;

  const lookStart = new THREE.Vector3();
  camera.getWorldDirection(lookStart);
  // We track target via a target object held in closure
  const lookCurrent = lookStart.clone();
  const duration = options.duration ?? 800;
  const easing = options.easing ?? ((k) => 1 - Math.pow(1 - k, 3));
  const t0 = performance.now();

  const tick = () => {
    const elapsed = performance.now() - t0;
    const k = Math.min(1, elapsed / duration);
    const e = easing(k);
    camera.position.lerpVectors(startPos, endPos, e);
    lookCurrent.lerpVectors(lookStart, endLook, e);
    camera.lookAt(lookCurrent);
    if (Math.abs(endFov - startFov) > 0.01) {
      camera.fov = startFov + (endFov - startFov) * e;
      camera.updateProjectionMatrix();
    }
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Camera helper: get the base distance (pre-multiplier) of a preset. */
export function presetBaseDistance(preset: CameraPreset): number {
  const p = CAMERA_PRESETS[preset].position;
  return Math.hypot(p[0], p[1], p[2]);
}

/** Camera helper: effective distance after the multiplier. */
export function effectiveDistance(
  preset: CameraPreset,
  distanceMultiplier: number,
): number {
  return presetBaseDistance(preset) * distanceMultiplier;
}
