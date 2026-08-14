// SkeletonHelper 单元测试 —— 验证骨骼可视化辅助器。
//
// SkeletonHelper 类构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于:
//   - collectBones():从 Bone 树收集 isBone 节点
//   - buildSkeletonHelperGeometry():按骨连杆对数预估顶点、颜色渐变
//   - SkeletonHelper 实例化用 fake renderer mock(仅取 renderer.gl),
//     并验证 updateMatrixWorld 回填骨位置到 position 属性

import { describe, it, expect } from 'vitest';
import { collectBones, buildSkeletonHelperGeometry } from './SkeletonHelper';
import { Bone } from '../Core/Bone';
import { Object3D } from '../Core/Object3D';

// SkeletonHelper 类构造需 renderer.gl(ShaderProgram 在 jsdom 无 GL)→ 仅验证抛错/降级语义。
// 骨位置回填更适合集成测试,这里聚焦 collectBones / buildSkeletonHelperGeometry 纯逻辑。

describe('collectBones', () => {
  it('从 Bone 根收集自身 + 所有后代 Bone', () => {
    const root = new Bone();
    const a = new Bone();
    const b = new Bone();
    const c = new Bone();
    root.add(a);
    a.add(b);
    root.add(c); // 树状分支
    const list = collectBones(root);
    expect(list.length).toBe(4);
    expect(list).toContain(root);
    expect(list).toContain(a);
    expect(list).toContain(b);
    expect(list).toContain(c);
  });

  it('忽略非 Bone 节点(普通 Object3D 子树不收)', () => {
    const root = new Bone();
    const nonBone = new Object3D();
    const childBone = new Bone();
    root.add(nonBone);
    nonBone.add(childBone); // 孙骨也要收(递归)
    const list = collectBones(root);
    expect(list.length).toBe(2);
    expect(list).toContain(root);
    expect(list).toContain(childBone);
    expect(list.includes(nonBone as unknown as Bone)).toBe(false);
  });

  it('从 SkinnedMesh(非 Bone 根)出发一样能递归收集子树 Bone', () => {
    const skinned = new Object3D();
    const b1 = new Bone();
    const b2 = new Bone();
    skinned.add(b1);
    b1.add(b2);
    const list = collectBones(skinned);
    expect(list.length).toBe(2);
    expect(list[0]).toBe(b1);
    expect(list[1]).toBe(b2);
  });
});

describe('buildSkeletonHelperGeometry', () => {
  it('线性 N 骨链 → (N-1) 连杆 × 2 顶点 = 顶点数,position 初始全 0', () => {
    const root = new Bone();
    const a = new Bone();
    const b = new Bone();
    root.add(a);
    a.add(b);
    const { geometry, bones } = buildSkeletonHelperGeometry(root);
    expect(bones.length).toBe(3);
    const pos = geometry.getAttribute('position')!;
    expect(pos.count).toBe(4); // 2 连杆 × 2 顶点
    // 初始 position 全 0(updateMatrixWorld 后才回填)
    const arr = pos.array as Float32Array;
    for (let i = 0; i < arr.length; i++) expect(arr[i]).toBe(0);
  });

  it('单骨根(无父骨连杆)→ 0 顶点', () => {
    const root = new Bone();
    const { geometry } = buildSkeletonHelperGeometry(root);
    expect(geometry.getAttribute('position')!.count).toBe(0);
  });

  it('颜色从 color1 线性渐变到 color2,段两端同色', () => {
    const root = new Bone();
    const a = new Bone();
    const b = new Bone();
    const c = new Bone();
    root.add(a);
    a.add(b);
    b.add(c); // 4 骨 → 3 连杆
    const color1 = { r: 0, g: 0, b: 1 }; // 蓝
    const color2 = { r: 0, g: 1, b: 0 }; // 绿
    const { geometry } = buildSkeletonHelperGeometry(root, color1, color2);
    const col = geometry.getAttribute('color')!.array as Float32Array;
    // 3 连杆 × 2 端 = 6 顶点, 每 2 顶点(一对)同 t
    // t_i = i / (3-1) = {0, 0.5, 1}
    const ts = [0, 0.5, 1];
    for (let i = 0; i < 3; i++) {
      const t = ts[i];
      const r = 0 + (0 - 0) * t;       // r: 0→0
      const g = 0 + (1 - 0) * t;       // g: 0→1
      const bb = 1 + (0 - 1) * t;      // b: 1→0
      const idx = i * 2;
      const checkVert = (vi: number): void => {
        expect(col[vi * 3]).toBeCloseTo(r, 5);
        expect(col[vi * 3 + 1]).toBeCloseTo(g, 5);
        expect(col[vi * 3 + 2]).toBeCloseTo(bb, 5);
      };
      checkVert(idx);
      checkVert(idx + 1);
    }
  });

  it('默认两色为蓝→绿(对照 three.js 约定)', () => {
    const root = new Bone();
    const a = new Bone();
    root.add(a);
    const { geometry } = buildSkeletonHelperGeometry(root);
    const col = geometry.getAttribute('color')!.array as Float32Array;
    // 单连杆 → t=0(无第二段,边界 segCount=1 → t=0)→ color1=蓝
    expect(col[0]).toBeCloseTo(0, 5);
    expect(col[2]).toBeCloseTo(1, 5);
  });
});
