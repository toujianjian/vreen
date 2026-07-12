// ProceduralHumanoid — a simple bipedal character built from BoxGeometry
// pieces, each driven by a single Bone via 4-bone skinning. Includes a
// `wave` AnimationClip (arm bones rotating) so the full pipeline
// (Bone → SkinnedMesh → Mixer → Renderer USE_SKINNING variant) can be
// exercised end-to-end without any external asset.
//
// Bone hierarchy:
//   root
//   └── pelvis
//       ├── spine
//       │   └── chest
//       │       ├── head
//       │       ├── shoulder.L → upperArm.L → lowerArm.L
//       │       └── shoulder.R → upperArm.R → lowerArm.R
//       ├── thigh.L → shin.L → foot.L
//       └── thigh.R → shin.R → foot.R
//
// Each mesh is 100% weighted to a single bone, so the GPU skinning
// math collapses to a single matrix multiply — still valid for the
// USE_SKINNING code path.

import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Group,
  Matrix4,
  QuaternionKeyframeTrack,
  Skeleton,
  SkinnedMesh,
  StandardMaterial,
} from '..';
import { Object3D } from '../Core/Object3D';
import { AnimationClip } from './AnimationClip';
import { AnimationMixer } from './AnimationMixer';

export interface HumanoidBundle {
  root: Group;
  mixer: AnimationMixer;
  wave: AnimationClip;
  /** SkinnedMeshes in the rig (the things the renderer should draw). */
  skinnedMeshes: SkinnedMesh[];
  /** All bones, in the same order as Skeleton.bones. */
  bones: Bone[];
}

export function buildHumanoid(opts: { scale?: number; skinColor?: { r: number; g: number; b: number } } = {}): HumanoidBundle {
  const scale = opts.scale ?? 1;
  const tint = opts.skinColor ?? { r: 0.8, g: 0.7, b: 0.55 };

  const root = new Group();
  root.name = 'Humanoid';

  // ── bones ─────────────────────────────────────────────────────────
  const pelvis = new Bone();   pelvis.name = 'pelvis';
  const spine  = new Bone();   spine.name  = 'spine';
  const chest  = new Bone();   chest.name  = 'chest';
  const head   = new Bone();   head.name   = 'head';
  const shL    = new Bone();   shL.name    = 'shoulder.L';
  const uaL    = new Bone();   uaL.name    = 'upperArm.L';
  const laL    = new Bone();   laL.name    = 'lowerArm.L';
  const shR    = new Bone();   shR.name    = 'shoulder.R';
  const uaR    = new Bone();   uaR.name    = 'upperArm.R';
  const laR    = new Bone();   laR.name    = 'lowerArm.R';
  const thL    = new Bone();   thL.name    = 'thigh.L';
  const snL    = new Bone();   snL.name    = 'shin.L';
  const ftL    = new Bone();   ftL.name    = 'foot.L';
  const thR    = new Bone();   thR.name    = 'thigh.R';
  const snR    = new Bone();   snR.name    = 'shin.R';
  const ftR    = new Bone();   ftR.name    = 'foot.R';

  pelvis.position.set(0, 0.95 * scale, 0);
  spine.position.set(0, 0, 0);
  chest.position.set(0, 0.30 * scale, 0);
  head.position.set(0, 0.30 * scale, 0);
  shL.position.set( 0.20 * scale, 0.20 * scale, 0);
  uaL.position.set( 0,    -0.18 * scale, 0);
  laL.position.set( 0,    -0.20 * scale, 0);
  shR.position.set(-0.20 * scale, 0.20 * scale, 0);
  uaR.position.set( 0,    -0.18 * scale, 0);
  laR.position.set( 0,    -0.20 * scale, 0);
  thL.position.set( 0.10 * scale, -0.05 * scale, 0);
  snL.position.set( 0,    -0.25 * scale, 0);
  ftL.position.set( 0,    -0.25 * scale, 0.04 * scale);
  thR.position.set(-0.10 * scale, -0.05 * scale, 0);
  snR.position.set( 0,    -0.25 * scale, 0);
  ftR.position.set( 0,    -0.25 * scale, 0.04 * scale);

  pelvis.add(spine);
  spine.add(chest);
  chest.add(head);
  chest.add(shL); shL.add(uaL); uaL.add(laL);
  chest.add(shR); shR.add(uaR); uaR.add(laR);
  pelvis.add(thL); thL.add(snL); snL.add(ftL);
  pelvis.add(thR); thR.add(snR); snR.add(ftR);
  root.add(pelvis);

  // ── register bones (order matters: Skeleton.bones index = skinIndex) ──
  const bones: Bone[] = [];
  const inverses: Matrix4[] = [];
  const walk = (o: Object3D) => {
    if (o instanceof Bone) {
      bones.push(o);
      const inv = new Matrix4().copy(o.matrixWorld).getInverse(o.matrixWorld);
      inverses.push(inv);
    }
    for (const c of o.children) walk(c);
  };
  walk(root);

  // ── parts ─────────────────────────────────────────────────────────
  const mats = {
    skin: matFromColor(tint, 0.05, 0.7),
    cloth: matFromColor({ r: 0.15, g: 0.25, b: 0.5 }, 0.05, 0.85),
    hair: matFromColor({ r: 0.1, g: 0.05, b: 0.0 }, 0.05, 0.9),
  };

  const skinnedMeshes: SkinnedMesh[] = [];
  function attachPart(boneName: string, w: number, h: number, d: number, mat: StandardMaterial): SkinnedMesh {
    const idx = bones.findIndex((b) => b.name === boneName);
    if (idx < 0) throw new Error(`bone not found: ${boneName}`);
    const g = makePartGeo({ w, h, d }, idx);
    const sm = new SkinnedMesh(g, mat);
    sm.skeleton = new Skeleton(bones, inverses);
    bones[idx].add(sm);
    skinnedMeshes.push(sm);
    return sm;
  }

  const s = scale;
  attachPart('pelvis',     0.32 * s, 0.18 * s, 0.20 * s, mats.cloth);
  attachPart('spine',      0.28 * s, 0.20 * s, 0.18 * s, mats.cloth);
  attachPart('chest',      0.36 * s, 0.26 * s, 0.22 * s, mats.cloth);
  attachPart('head',       0.22 * s, 0.26 * s, 0.22 * s, mats.skin);
  attachPart('shoulder.L', 0.10 * s, 0.10 * s, 0.10 * s, mats.cloth);
  attachPart('upperArm.L', 0.10 * s, 0.26 * s, 0.10 * s, mats.skin);
  attachPart('lowerArm.L', 0.09 * s, 0.24 * s, 0.09 * s, mats.skin);
  attachPart('shoulder.R', 0.10 * s, 0.10 * s, 0.10 * s, mats.cloth);
  attachPart('upperArm.R', 0.10 * s, 0.26 * s, 0.10 * s, mats.skin);
  attachPart('lowerArm.R', 0.09 * s, 0.24 * s, 0.09 * s, mats.skin);
  attachPart('thigh.L',    0.13 * s, 0.28 * s, 0.13 * s, mats.cloth);
  attachPart('shin.L',     0.11 * s, 0.26 * s, 0.11 * s, mats.skin);
  attachPart('foot.L',     0.14 * s, 0.06 * s, 0.22 * s, mats.hair);
  attachPart('thigh.R',    0.13 * s, 0.28 * s, 0.13 * s, mats.cloth);
  attachPart('shin.R',     0.11 * s, 0.26 * s, 0.11 * s, mats.skin);
  attachPart('foot.R',     0.14 * s, 0.06 * s, 0.22 * s, mats.hair);

  // ── animation: a simple "wave" — both arms rotate around Z. ───────
  const id  = [0, 0, 0, 1];
  const z90 = [0, 0, Math.sin(Math.PI / 4), Math.cos(Math.PI / 4)];
  const wave = new AnimationClip('wave', 1.4, [
    new QuaternionKeyframeTrack('upperArm.L.quaternion', [0, 0.7, 1.4], [...id, ...z90, ...id], 'slerp'),
    new QuaternionKeyframeTrack('upperArm.R.quaternion', [0, 0.7, 1.4], [...id, ...z90, ...id], 'slerp'),
  ]);

  const mixer = new AnimationMixer(root);
  return { root, mixer, wave, skinnedMeshes, bones };
}

function matFromColor(c: { r: number; g: number; b: number }, metallic = 0, roughness = 0.5): StandardMaterial {
  const m = new StandardMaterial();
  m.baseColor = c;
  m.metallic = metallic;
  m.roughness = roughness;
  return m;
}

/** Build a BoxGeometry with `skinIndex` / `skinWeight` attributes
 *  that pin every vertex to `boneIdx` (weight 1, others 0). */
function makePartGeo(box: { w: number; h: number; d: number }, boneIdx: number): BufferGeometry {
  const g = new BoxGeometry(box.w, box.h, box.d);
  const vc = g.attributes.position.count;
  const skinIndex = new Float32Array(vc * 4);
  const skinWeight = new Float32Array(vc * 4);
  for (let i = 0; i < vc; i++) {
    skinIndex[i * 4 + 0] = boneIdx;
    skinWeight[i * 4 + 0] = 1;
  }
  g.setAttribute('skinIndex', new BufferAttribute(skinIndex, 4));
  g.setAttribute('skinWeight', new BufferAttribute(skinWeight, 4));
  return g;
}
