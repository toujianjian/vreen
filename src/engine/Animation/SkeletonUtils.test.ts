// SkeletonUtils 单元测试(数据层,不依赖 WebGL)。
// 覆盖 retarget(实时姿势重定向)/ retargetClip(动画烘焙)/ clone(骨骼感知深拷贝)
// (three.js examples/jsm/utils/SkeletonUtils.js 适配)。

import { describe, it, expect } from 'vitest';
import { retarget, retargetClip, clone } from './SkeletonUtils';
import { AnimationClip } from './AnimationClip';
import { AnimationMixer } from './AnimationMixer';
import { VectorKeyframeTrack, QuaternionKeyframeTrack } from './KeyframeTrack';
import { Bone } from '../Core/Bone';
import { Group } from '../Core/Group';
import { Skeleton } from '../Core/Skeleton';
import { SkinnedMesh } from '../Core/SkinnedMesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Vector3, Quaternion } from '../Math';

/** 构造一套两骨骨架(hip→spine)绑定的 SkinnedMesh。
 *  骨架树 root→hip→spine 挂在 mesh 下,bind 到 Skeleton。 */
function makeRig() {
  const root = new Group();
  const hip = new Bone();
  hip.name = 'hip';
  const spine = new Bone();
  spine.name = 'spine';
  spine.position.set(0, 1, 0);
  hip.add(spine);
  root.add(hip);
  root.updateMatrixWorld(true);

  const mesh = new SkinnedMesh(new BufferGeometry(), new StandardMaterial());
  mesh.add(root);
  const skeleton = new Skeleton([hip, spine]);
  mesh.bind(skeleton);
  mesh.updateMatrixWorld(true);
  return { mesh, skeleton, root, hip, spine };
}

/** 一条 1 秒走步 clip:hip 平移 + hip 绕 Y 转 90°。 */
function makeWalkClip(): AnimationClip {
  return new AnimationClip('walk', 1, [
    new VectorKeyframeTrack('hip.position', [0, 1], [0, 0, 0, 1, 0, 0]),
    new QuaternionKeyframeTrack('hip.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.70710678, 0, 0.70710678]),
  ]);
}

describe('SkeletonUtils.clone', () => {
  it('deep-copies the tree and remaps skinned mesh skeleton to cloned bones', () => {
    const rig = makeRig();
    rig.hip.position.set(1, 2, 3);
    rig.root.updateMatrixWorld(true);

    const cloned = clone(rig.mesh);

    let clonedMesh: SkinnedMesh | null = null;
    cloned.traverse((n) => {
      if ((n as SkinnedMesh).isSkinnedMesh === true) clonedMesh = n as SkinnedMesh;
    });
    expect(clonedMesh).not.toBeNull();
    expect(clonedMesh).not.toBe(rig.mesh);
    // skeleton 是新实例,骨骼重映射到克隆树(而非共享原骨骼)
    expect(clonedMesh!.skeleton).not.toBe(rig.mesh.skeleton);
    expect(clonedMesh!.skeleton!.bones).toHaveLength(2);
    expect(clonedMesh!.skeleton!.bones[0]).not.toBe(rig.mesh.skeleton!.bones[0]);
    expect(clonedMesh!.skeleton!.bones.map((b) => b.name)).toEqual(['hip', 'spine']);
    // 克隆骨架的骨骼在克隆树里能找到(经 getObjectByName)
    expect(clonedMesh!.skeleton!.bones[0]).toBe(cloned.getObjectByName('hip'));
    expect(clonedMesh!.skeleton!.bones[1]).toBe(cloned.getObjectByName('spine'));
    // 几何与材质共享(引用不变)
    expect(clonedMesh!.geometry).toBe(rig.mesh.geometry);
    expect(clonedMesh!.material).toBe(rig.mesh.material);
  });

  it('cloned skeleton pose is independent of the source', () => {
    const rig = makeRig();
    const cloned = clone(rig.mesh);
    const clonedHip = cloned.getObjectByName('hip') as Bone;

    clonedHip.position.set(9, 9, 9);
    expect(rig.hip.position.x).toBe(0);
    expect(rig.hip.position.y).toBe(0);
    expect(rig.hip.position.z).toBe(0);
  });
});

describe('SkeletonUtils.retarget', () => {
  it('copies source bone rotation to matching target bones', () => {
    const src = makeRig();
    const tgt = makeRig();
    src.hip.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    src.root.updateMatrixWorld(true);
    const srcHipQ = src.hip.rotation.clone();
    const srcSpineWorldQ = new Quaternion().setFromRotationMatrix(src.spine.matrixWorld);

    retarget(tgt.skeleton, src.skeleton, { preserveBoneMatrix: true });

    // target hip 旋转与 source hip 一致(dot≈1 表示同向单位四元数)
    expect(tgt.hip.rotation.dot(srcHipQ)).toBeCloseTo(1, 5);
    // spine 世界姿态应与 source spine 一致:target spine 局部旋转补偿父级(hip)旋转后
    // 为 identity,合成世界旋转 = hip rot90 = source spine 世界旋转(而非 identity ——
    // 历史错误断言把"双重旋转"bug 当成正确行为)。
    tgt.root.updateMatrixWorld(true);
    const spineWorldQ = new Quaternion().setFromRotationMatrix(tgt.spine.matrixWorld);
    expect(spineWorldQ.dot(srcSpineWorldQ)).toBeCloseTo(1, 5);
    expect(tgt.spine.matrixWorld.elements[13]).toBeCloseTo(1, 5);
  });

  it('scales hip displacement by scale and hipInfluence', () => {
    const src = makeRig();
    const tgt = makeRig();
    src.hip.position.set(2, 0, 0);
    src.root.updateMatrixWorld(true);

    retarget(tgt.skeleton, src.skeleton, {
      preserveBoneMatrix: true,
      scale: 2,
      hipInfluence: new Vector3(0.5, 1, 1),
    });

    // 2 (源) * 2 (scale) * 0.5 (hipInfluence.x) = 2
    expect(tgt.hip.position.x).toBeCloseTo(2, 5);
    expect(tgt.hip.position.y).toBeCloseTo(0, 5);
  });

  it('resolves bone names through the names mapping', () => {
    const src = makeRig();
    const tgt = makeRig();
    tgt.hip.name = 'pelvis';
    tgt.spine.name = 'chest';
    src.hip.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    src.root.updateMatrixWorld(true);
    const srcHipQ = src.hip.rotation.clone();

    retarget(tgt.skeleton, src.skeleton, {
      names: { pelvis: 'hip', chest: 'spine' },
      preserveBoneMatrix: true,
    });

    expect(tgt.hip.rotation.dot(srcHipQ)).toBeCloseTo(1, 5);
  });
});

describe('SkeletonUtils.retargetClip', () => {
  it('bakes position and quaternion tracks for every matched target bone', () => {
    const src = makeRig();
    const tgt = makeRig();
    const clip = makeWalkClip();

    const baked = retargetClip(tgt.skeleton, src.skeleton, clip, { fps: 10, hip: 'hip' });

    expect(baked.name).toBe('walk');
    expect(baked.duration).toBeCloseTo(1, 5);
    expect(baked.tracks.map((t) => t.name).sort()).toEqual([
      'hip.position',
      'hip.quaternion',
      'spine.quaternion',
    ]);
    // 末帧(时间=1.0)位置 = 源 clip 终点 (1,0,0),旋转 = 绕 Y 90°
    const posTrack = baked.tracks.find((t) => t.name === 'hip.position')!;
    const quatTrack = baked.tracks.find((t) => t.name === 'hip.quaternion')!;
    const pv = posTrack.values;
    expect(pv[pv.length - 3]).toBeCloseTo(1, 5);
    expect(pv[pv.length - 2]).toBeCloseTo(0, 5);
    const qv = quatTrack.values;
    expect(qv[qv.length - 3]).toBeCloseTo(0.70710678, 5);
    expect(qv[qv.length - 2]).toBeCloseTo(0, 5);
    expect(qv[qv.length - 1]).toBeCloseTo(0.70710678, 5);
  });

  it('baked clip drives the target skeleton via AnimationMixer', () => {
    const src = makeRig();
    const tgt = makeRig();
    const baked = retargetClip(tgt.skeleton, src.skeleton, makeWalkClip(), { fps: 10, hip: 'hip' });

    const mixer = new AnimationMixer(tgt.mesh);
    mixer.clipAction(baked).play();
    mixer.update(0.5);

    // 半程:hip x = 0.5(线性插值 0→1),旋转处于 0°→90° 中间
    expect(tgt.hip.position.x).toBeCloseTo(0.5, 5);
    expect(tgt.hip.rotation.y).toBeGreaterThan(0.3);
    expect(tgt.hip.rotation.y).toBeLessThan(0.75);
  });
});
