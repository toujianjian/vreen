// DecalGeometry 单元测试 —— 验证贴花投影与 Sutherland–Hodgman 三角面裁剪。

import { describe, it, expect } from 'vitest';
import { DecalGeometry } from './DecalGeometry';
import { PlaneGeometry } from './PlaneGeometry';
import { BoxGeometry } from './BoxGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import { Quaternion, Vector3 } from '../Math';

/** 创建一个无 renderer 依赖的占位 Mesh(供 DecalGeometry 投影)。 */
function makeMesh(width = 2, height = 2, segs = 1): Mesh {
  const geom = new PlaneGeometry(width, height, segs, segs);
  return new Mesh(geom, { type: 'Basic' } as unknown as Material);
}

/** identity 四元数 (0,0,0,1)。 */
const ID_QUAT = new Quaternion(0, 0, 0, 1);

describe('DecalGeometry', () => {
  it('create() 返回 DecalGeometry 实例', () => {
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(2, 2, 2),
    );
    expect(decal).toBeInstanceOf(DecalGeometry);
  });

  it('原点平面 + identity + size (2,2,2) → 2 个三角形 (6 顶点,无裁剪)', () => {
    // PlaneGeometry(2,2,1,1):4 顶点位于 (±1, ±1, 0),全在 [-1,1]³ 盒内。
    // 2 个三角形 × 3 顶点 = 6(非索引输出)。
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);

    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(2, 2, 2),
    );

    expect(decal.attributes.position).toBeDefined();
    expect(decal.attributes.position.count).toBe(6);
    expect(decal.attributes.uv).toBeDefined();
    expect(decal.attributes.uv.count).toBe(6);
    expect(decal.attributes.normal).toBeDefined();
    expect(decal.attributes.normal.count).toBe(6);
  });

  it('size 0.5 的贴花在 2×2 分段平面上裁出多个三角形', () => {
    // PlaneGeometry(2,2,2,2):3×3=9 顶点,8 个三角形。
    // 仅中心 (0,0,0) 在 [-0.25,0.25]³ 内。边缘顶点如 (0,±1,0) 的 X 在盒内,
    // 其三角形经 X 裁剪后保留,再经 Y 裁剪。最终 14 三角形 = 42 顶点。
    const target = makeMesh(2, 2, 2);
    target.updateMatrixWorld(true);

    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(0.5, 0.5, 0.5),
    );

    expect(decal.attributes.position.count).toBe(42);
  });

  it('所有 UV 在 [0,1] 范围内', () => {
    const target = makeMesh(2, 2, 2);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(0.5, 0.5, 0.5),
    );
    const uv = decal.attributes.uv.array;
    for (let i = 0; i < uv.length; i++) {
      expect(uv[i]).toBeGreaterThanOrEqual(-1e-6);
      expect(uv[i]).toBeLessThanOrEqual(1 + 1e-6);
    }
  });

  it('中心顶点 UV = (0.5, 0.5)', () => {
    // 6 个三角形都含中心顶点 (0,0,0),其 UV = (0.5 + 0/0.5, 0.5 + 0/0.5) = (0.5, 0.5)。
    const target = makeMesh(2, 2, 2);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(0.5, 0.5, 0.5),
    );
    const pos = decal.attributes.position.array;
    const uv = decal.attributes.uv.array;
    let foundCenter = false;
    for (let i = 0; i < pos.length; i += 3) {
      if (
        Math.abs(pos[i]) < 1e-6 &&
        Math.abs(pos[i + 1]) < 1e-6 &&
        Math.abs(pos[i + 2]) < 1e-6
      ) {
        const u = uv[(i / 3) * 2];
        const v = uv[(i / 3) * 2 + 1];
        expect(u).toBeCloseTo(0.5, 6);
        expect(v).toBeCloseTo(0.5, 6);
        foundCenter = true;
      }
    }
    expect(foundCenter).toBe(true);
  });

  it('法线从目标几何体继承(平面法线 = +Z)', () => {
    // PlaneGeometry 法线为 (0,0,1);identity 朝向下世界法线仍为 (0,0,1)。
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(2, 2, 2),
    );
    const n = decal.attributes.normal.array;
    for (let i = 0; i < n.length; i += 3) {
      expect(n[i]).toBeCloseTo(0, 6);
      expect(n[i + 1]).toBeCloseTo(0, 6);
      expect(n[i + 2]).toBeCloseTo(1, 6);
    }
  });

  it('完全在盒外的三角形被丢弃', () => {
    // 贴花偏移到 (5,0,0),平面在原点 → 无顶点在盒内 → 空几何体。
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(5, 0, 0),
      ID_QUAT,
      new Vector3(0.5, 0.5, 0.5),
    );
    expect(decal.attributes.position.count).toBe(0);
    expect(decal.attributes.uv.count).toBe(0);
  });

  it('偏移投影只裁掉部分三角形', () => {
    // 贴花中心在 (0.5, 0, 0),size (1,2,2)。
    // 盒范围 X∈[0,1], Y∈[-1,1], Z∈[-1,1]。
    // PlaneGeometry(2,2,1,1) 顶点:(-1,±1,0), (1,±1,0)。
    // 投影器局部空间:X=-1→-1.5(外),X=1→0.5(内)。
    // 三角形 1 (v0,v2,v1):v0/v2 外(-X),v1 内 → case 2 → 1 三角形。
    // 三角形 2 (v2,v3,v1):v2 外(-X),v3/v1 内 → case 1 → 2 三角形。
    // → 3 三角形 = 9 顶点。
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0.5, 0, 0),
      ID_QUAT,
      new Vector3(1, 2, 2),
    );
    expect(decal.attributes.position.count).toBe(9);
  });

  it('裁剪后位置在世界空间(投影器位置偏移)', () => {
    // 贴花中心 (1, 0, 0),size (2,2,2)。平面在原点。
    // 平面顶点 (±1, ±1, 0) 在投影器局部 = world − (1,0,0) = (±1−1, ±1, 0) = (0 or −2, ±1, 0)。
    // (0, ±1, 0) 在 [-1,1]³ 内,(−2, ±1, 0) 在外(X=−2 < −1)。
    // 2 个三角形各裁掉 1 个顶点(X=−2 的那个)→ case 1 → 2 三角形 each → 4 三角形 = 12 顶点。
    // 输出位置在世界空间:含 X=1 的点(原 (1,±1,0) 顶点,在盒内边界)。
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(1, 0, 0),
      ID_QUAT,
      new Vector3(2, 2, 2),
    );
    const pos = decal.attributes.position.array;
    // 至少存在一个 X≈1 的顶点(原 (1,±1,0) 在世界空间保持 X=1)。
    let hasX1 = false;
    for (let i = 0; i < pos.length; i += 3) {
      if (Math.abs(pos[i] - 1) < 1e-6) hasX1 = true;
    }
    expect(hasX1).toBe(true);
  });

  it('旋转的贴花:90° 绕 Z 轴 → 平面顶点旋转后仍全在盒内', () => {
    // 绕 Z 旋转 90°:投影器局部空间 X' = −Y, Y' = X。
    // 平面顶点 (±1, ±1, 0) → 局部 (±1, ±1, 0)(旋转后仍在 ±1)。
    // 用 size (3,3,3) 避免边界浮点精度问题(s=1.5,顶点在 ±1,安全在内)。
    // 2 三角形无裁剪 → 6 顶点。
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);
    const quat = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI / 2,
    );
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      quat,
      new Vector3(3, 3, 3),
    );
    expect(decal.attributes.position.count).toBe(6);
  });

  it('无 geometry 的目标 → 空几何体(不崩溃)', () => {
    const target = new Mesh(
      new PlaneGeometry(1, 1),
      { type: 'Basic' } as unknown as Material,
    );
    target.geometry.deleteAttribute('position');
    expect(() =>
      DecalGeometry.create(
        target,
        new Vector3(0, 0, 0),
        ID_QUAT,
        new Vector3(2, 2, 2),
      ),
    ).not.toThrow();
  });

  it('size 含 0 分量 → 空几何体(不除零)', () => {
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);
    expect(() =>
      DecalGeometry.create(
        target,
        new Vector3(0, 0, 0),
        ID_QUAT,
        new Vector3(0, 2, 2),
      ),
    ).not.toThrow();
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(0, 2, 2),
    );
    expect(decal.attributes.position.count).toBe(0);
  });

  it('3D 目标(BoxGeometry):贴花覆盖整个盒子 → 非空', () => {
    // BoxGeometry(2,2,2) 顶点在 ±1,全部在 size (4,4,4) 盒内。
    // 12 三角形 × 3 = 36 顶点。
    const box = new BoxGeometry(2, 2, 2);
    const target = new Mesh(box, { type: 'Basic' } as unknown as Material);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(4, 4, 4),
    );
    expect(decal.attributes.position.count).toBe(36);
  });

  it('位置缓冲数量 = UV 缓冲数量 × 3/2(一致性)', () => {
    const target = makeMesh(2, 2, 2);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      ID_QUAT,
      new Vector3(0.5, 0.5, 0.5),
    );
    const posCount = decal.attributes.position.count;
    const uvCount = decal.attributes.uv.count;
    const normCount = decal.attributes.normal.count;
    expect(posCount).toBe(uvCount);
    expect(posCount).toBe(normCount);
  });
});
