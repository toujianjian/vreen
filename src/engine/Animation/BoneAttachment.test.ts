// BoneAttachment tests — 骨骼附件系统测试。

import { describe, it, expect } from 'vitest';
import { BoneAttachment, BoneAttachmentManager, type FollowMode } from './BoneAttachment';
import { Bone } from '../Core/Bone';
import { Object3D } from '../Core/Object3D';
import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 工具:构造一个已计算 matrixWorld 的 Bone。 */
function makeBone(name: string = '', pos: [number, number, number] = [0, 0, 0]): Bone {
  const b = new Bone();
  b.name = name;
  b.position.set(pos[0], pos[1], pos[2]);
  b.updateMatrix();
  b.updateMatrixWorld(true);
  return b;
}

/** 工具:构造一个已计算 matrixWorld 的 Object3D。 */
function makeObject(name: string = ''): Object3D {
  const o = new Object3D();
  o.name = name;
  o.updateMatrix();
  o.updateMatrixWorld(true);
  return o;
}

describe('BoneAttachment — 基础', () => {
  it('构造器接受默认参数', () => {
    const bone = makeBone('hand');
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone });
    expect(a.target).toBe(target);
    expect(a.bone).toBe(bone);
    expect(a.followMode).toBe('world');
    expect(a.smoothing).toBe(0);
    expect(a.enabled).toBe(true);
    expect(a.attachToSceneGraph).toBe(false);
  });

  it('update snap 模式直接贴合 bone 世界矩阵', () => {
    const bone = makeBone('hand', [1, 2, 3]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'snap' });
    a.update(0);
    // target.matrixWorld 应等于 bone.matrixWorld(单位 offset)
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    target.matrixWorld.decompose(p, q, s);
    expect(p.x).toBeCloseTo(1);
    expect(p.y).toBeCloseTo(2);
    expect(p.z).toBeCloseTo(3);
  });

  it('offset 偏移正确应用', () => {
    const bone = makeBone('hand', [0, 0, 0]);
    const target = makeObject('sword');
    const offset = new Matrix4().makeTranslation(0.5, 0, 0);
    const a = new BoneAttachment({ target, bone, offset, followMode: 'snap' });
    a.update(0);
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    target.matrixWorld.decompose(p, q, s);
    expect(p.x).toBeCloseTo(0.5);
  });

  it('bone 移动后 update 同步 target', () => {
    const bone = makeBone('hand', [0, 0, 0]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'snap' });
    a.update(0);
    // 移动 bone
    bone.position.set(10, 0, 0);
    bone.updateMatrix();
    bone.updateMatrixWorld(true);
    a.update(0);
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    target.matrixWorld.decompose(p, q, s);
    expect(p.x).toBeCloseTo(10);
  });

  it('disabled 时 update 无效', () => {
    const bone = makeBone('hand', [5, 5, 5]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'snap', enabled: false });
    a.update(0);
    // target.matrixWorld 应保持原始(单位矩阵)
    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    target.matrixWorld.decompose(p, q, s);
    expect(p.x).toBe(0);
    expect(p.y).toBe(0);
    expect(p.z).toBe(0);
  });
});

describe('BoneAttachment — FollowMode', () => {
  it('position 模式只跟随位置,保留 target 旋转', () => {
    const bone = makeBone('hand', [1, 0, 0]);
    const target = makeObject('sword');
    // 给 target 一个初始旋转(绕 Z 轴 π/2)
    target.rotation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    target.updateMatrix();
    target.updateMatrixWorld(true);
    const originalQuat = new Quaternion();
    target.matrixWorld.decompose(new Vector3(), originalQuat, new Vector3());

    const a = new BoneAttachment({ target, bone, followMode: 'position' });
    a.update(0);

    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    target.matrixWorld.decompose(p, q, s);
    expect(p.x).toBeCloseTo(1);
    // 旋转应保留
    expect(q.x).toBeCloseTo(originalQuat.x);
    expect(q.y).toBeCloseTo(originalQuat.y);
    expect(q.z).toBeCloseTo(originalQuat.z);
    expect(q.w).toBeCloseTo(originalQuat.w);
  });

  it('rotation 模式只跟随旋转,保留 target 位置', () => {
    const bone = makeBone('hand');
    bone.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    bone.updateMatrix();
    bone.updateMatrixWorld(true);

    const target = makeObject('sword');
    target.position.set(7, 7, 7);
    target.updateMatrix();
    target.updateMatrixWorld(true);

    const a = new BoneAttachment({ target, bone, followMode: 'rotation' });
    a.update(0);

    const p = new Vector3();
    const q = new Quaternion();
    const s = new Vector3();
    target.matrixWorld.decompose(p, q, s);
    // 位置应保留
    expect(p.x).toBeCloseTo(7);
    expect(p.y).toBeCloseTo(7);
    expect(p.z).toBeCloseTo(7);
  });

  it('world 模式完整跟随', () => {
    const bone = makeBone('hand', [2, 3, 4]);
    bone.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4);
    bone.updateMatrix();
    bone.updateMatrixWorld(true);

    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'world', smoothing: 0 });
    a.update(0);

    // target.matrixWorld 应等于 bone.matrixWorld
    for (let i = 0; i < 16; i++) {
      expect(target.matrixWorld.elements[i]).toBeCloseTo(bone.matrixWorld.elements[i], 5);
    }
  });
});

describe('BoneAttachment — 平滑', () => {
  it('smoothing > 0 时第一帧直接贴合(初始化)', () => {
    const bone = makeBone('hand', [1, 0, 0]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'world', smoothing: 0.2 });
    a.update(0.016);
    const p = new Vector3();
    target.matrixWorld.decompose(p, new Quaternion(), new Vector3());
    expect(p.x).toBeCloseTo(1);
  });

  it('smoothing > 0 时第二帧部分插值', () => {
    const bone = makeBone('hand', [0, 0, 0]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'world', smoothing: 0.5 });
    a.update(0.016); // 初始化 → 贴合 [0,0,0]
    // 移动 bone 到 [10, 0, 0]
    bone.position.set(10, 0, 0);
    bone.updateMatrix();
    bone.updateMatrixWorld(true);
    a.update(0.016);
    const p = new Vector3();
    target.matrixWorld.decompose(p, new Quaternion(), new Vector3());
    // p.x 应在 (0, 10) 之间
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(10);
  });

  it('smoothing=0 与 snap 等价', () => {
    const bone1 = makeBone('hand', [5, 5, 5]);
    const bone2 = makeBone('hand', [5, 5, 5]);
    const t1 = makeObject('sword');
    const t2 = makeObject('sword');
    const a1 = new BoneAttachment({ target: t1, bone: bone1, followMode: 'world', smoothing: 0 });
    const a2 = new BoneAttachment({ target: t2, bone: bone2, followMode: 'snap' });
    a1.update(0);
    a2.update(0);
    for (let i = 0; i < 16; i++) {
      expect(t1.matrixWorld.elements[i]).toBeCloseTo(t2.matrixWorld.elements[i], 5);
    }
  });

  it('reset 清空平滑历史', () => {
    const bone = makeBone('hand', [0, 0, 0]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'world', smoothing: 0.5 });
    a.update(0.016);
    bone.position.set(10, 0, 0);
    bone.updateMatrix();
    bone.updateMatrixWorld(true);
    a.update(0.016); // 部分插值
    a.reset();
    a.update(0.016); // 重新初始化 → 直接贴合
    const p = new Vector3();
    target.matrixWorld.decompose(p, new Quaternion(), new Vector3());
    expect(p.x).toBeCloseTo(10);
  });
});

describe('BoneAttachment — 场景图集成', () => {
  it('attachToSceneGraph=true 自动加入 bone.children', () => {
    const bone = makeBone('hand');
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, attachToSceneGraph: true });
    expect(bone.children).toContain(target);
    a.dispose();
    expect(bone.children).not.toContain(target);
  });

  it('attachToSceneGraph=true 时 update 不修改 matrixWorld', () => {
    const bone = makeBone('hand', [1, 2, 3]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, attachToSceneGraph: true });
    const before = target.matrixWorld.elements.slice();
    a.update(0.016);
    // 由场景图驱动,update 不应改 matrixWorld(需要手动 updateMatrixWorld)
    for (let i = 0; i < 16; i++) {
      expect(target.matrixWorld.elements[i]).toBe(before[i]);
    }
  });

  it('detachFromSceneGraph 移除 target', () => {
    const bone = makeBone('hand');
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, attachToSceneGraph: true });
    expect(bone.children).toContain(target);
    a.detachFromSceneGraph();
    expect(bone.children).not.toContain(target);
  });

  it('setBone 切换骨骼并 reset', () => {
    const bone1 = makeBone('hand1', [1, 0, 0]);
    const bone2 = makeBone('hand2', [0, 1, 0]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone: bone1, followMode: 'snap' });
    a.update(0);
    let p = new Vector3();
    target.matrixWorld.decompose(p, new Quaternion(), new Vector3());
    expect(p.x).toBeCloseTo(1);

    a.setBone(bone2);
    a.update(0);
    target.matrixWorld.decompose(p, new Quaternion(), new Vector3());
    expect(p.y).toBeCloseTo(1);
  });

  it('setOffset 更新偏移并 reset', () => {
    const bone = makeBone('hand');
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'snap' });
    a.update(0);
    a.setOffset(new Matrix4().makeTranslation(5, 0, 0));
    a.update(0);
    const p = new Vector3();
    target.matrixWorld.decompose(p, new Quaternion(), new Vector3());
    expect(p.x).toBeCloseTo(5);
  });
});

describe('BoneAttachment — dispose', () => {
  it('dispose 解除引用并恢复 matrixAutoUpdate', () => {
    const bone = makeBone('hand');
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, attachToSceneGraph: true });
    expect(target.matrixAutoUpdate).toBe(true);
    a.dispose();
    expect(target.matrixAutoUpdate).toBe(true);
    expect(a.enabled).toBe(false);
  });

  it('dispose 后 update 无效', () => {
    const bone = makeBone('hand', [1, 1, 1]);
    const target = makeObject('sword');
    const a = new BoneAttachment({ target, bone, followMode: 'snap' });
    a.dispose();
    a.update(0);
    const p = new Vector3();
    target.matrixWorld.decompose(p, new Quaternion(), new Vector3());
    expect(p.x).toBe(0); // 未更新
  });
});

describe('BoneAttachmentManager', () => {
  it('add / get / remove / size', () => {
    const mgr = new BoneAttachmentManager();
    const a1 = new BoneAttachment({ target: makeObject('s'), bone: makeBone('h') });
    const a2 = new BoneAttachment({ target: makeObject('s'), bone: makeBone('h') });
    mgr.add('sword', a1);
    mgr.add('helmet', a2);
    expect(mgr.size).toBe(2);
    expect(mgr.get('sword')).toBe(a1);
    expect(mgr.get('helmet')).toBe(a2);
    expect(mgr.names()).toContain('sword');
    expect(mgr.names()).toContain('helmet');
    mgr.remove('sword');
    expect(mgr.size).toBe(1);
    expect(mgr.get('sword')).toBeUndefined();
  });

  it('setEnabled 控制单个附件', () => {
    const mgr = new BoneAttachmentManager();
    const a = new BoneAttachment({ target: makeObject('s'), bone: makeBone('h', [1, 0, 0]) });
    mgr.add('sword', a);
    mgr.setEnabled('sword', false);
    expect(a.enabled).toBe(false);
    mgr.setEnabled('sword', true);
    expect(a.enabled).toBe(true);
  });

  it('setAllEnabled 批量控制', () => {
    const mgr = new BoneAttachmentManager();
    const a1 = new BoneAttachment({ target: makeObject('s'), bone: makeBone('h') });
    const a2 = new BoneAttachment({ target: makeObject('s'), bone: makeBone('h') });
    mgr.add('sword', a1);
    mgr.add('helmet', a2);
    mgr.setAllEnabled(false);
    expect(a1.enabled).toBe(false);
    expect(a2.enabled).toBe(false);
    mgr.setAllEnabled(true);
    expect(a1.enabled).toBe(true);
    expect(a2.enabled).toBe(true);
  });

  it('update 批量调用', () => {
    const mgr = new BoneAttachmentManager();
    const bone1 = makeBone('h1', [1, 0, 0]);
    const bone2 = makeBone('h2', [0, 1, 0]);
    const t1 = makeObject('s1');
    const t2 = makeObject('s2');
    mgr.add('sword', new BoneAttachment({ target: t1, bone: bone1, followMode: 'snap' }));
    mgr.add('helmet', new BoneAttachment({ target: t2, bone: bone2, followMode: 'snap' }));
    mgr.update(0);
    const p1 = new Vector3();
    const p2 = new Vector3();
    t1.matrixWorld.decompose(p1, new Quaternion(), new Vector3());
    t2.matrixWorld.decompose(p2, new Quaternion(), new Vector3());
    expect(p1.x).toBeCloseTo(1);
    expect(p2.y).toBeCloseTo(1);
  });

  it('dispose 释放所有附件', () => {
    const mgr = new BoneAttachmentManager();
    mgr.add('a', new BoneAttachment({ target: makeObject('s'), bone: makeBone('h') }));
    mgr.add('b', new BoneAttachment({ target: makeObject('s'), bone: makeBone('h') }));
    mgr.dispose();
    expect(mgr.size).toBe(0);
  });
});

describe('BoneAttachment — 类型边界', () => {
  it('所有 FollowMode 取值均可构造', () => {
    const modes: FollowMode[] = ['world', 'position', 'rotation', 'snap'];
    for (const m of modes) {
      const a = new BoneAttachment({
        target: makeObject('s'),
        bone: makeBone('h'),
        followMode: m,
      });
      expect(a.followMode).toBe(m);
    }
  });

  it('smoothing 负数不会破坏(被 clamp 到 0)', () => {
    const bone = makeBone('h', [1, 0, 0]);
    const target = makeObject('s');
    const a = new BoneAttachment({ target, bone, followMode: 'world', smoothing: -1 });
    a.update(0);
    const p = new Vector3();
    target.matrixWorld.decompose(p, new Quaternion(), new Vector3());
    expect(p.x).toBeCloseTo(1);
  });
});
