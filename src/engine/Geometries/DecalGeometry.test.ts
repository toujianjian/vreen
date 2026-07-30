// DecalGeometry 单元测试 —— 验证贴花投影与裁剪。

import { describe, it, expect } from 'vitest';
import { DecalGeometry } from './DecalGeometry';
import { PlaneGeometry } from './PlaneGeometry';
import { Mesh } from '../Core/Mesh';
import type { Material } from '../Core/Material';
import { Quaternion, Vector3 } from '../Math';

/** 创建一个无 renderer 依赖的占位 Mesh(供 DecalGeometry 投影)。 */
function makeMesh(width = 2, height = 2, segs = 1): Mesh {
  const geom = new PlaneGeometry(width, height, segs, segs);
  return new Mesh(geom, { type: 'Basic' } as unknown as Material);
}

describe('DecalGeometry', () => {
  it('create() 返回 DecalGeometry 实例', () => {
    const target = makeMesh(2, 2, 1);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      new Quaternion(0, 0, 0, 1),
      new Vector3(2, 2, 2),
    );
    expect(decal).toBeInstanceOf(DecalGeometry);
  });

  it('原点平面 + identity 朝向 + size (2,2,2) → 捕获 4 个顶点', () => {
    // PlaneGeometry(2,2,1,1):4 顶点位于 (±1, ±1, 0)
    const target = makeMesh(2, 2, 1);
    target.updateMatrixWorld(true);

    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      new Quaternion(0, 0, 0, 1), // identity
      new Vector3(2, 2, 2),
    );

    expect(decal.attributes.position).toBeDefined();
    expect(decal.attributes.position.count).toBe(4);
    expect(decal.attributes.uv).toBeDefined();
    expect(decal.attributes.uv.count).toBe(4);
  });

  it('size 0.5 的贴花在 2 宽平面上只捕获中心顶点', () => {
    // PlaneGeometry(2,2,2,2):3×3=9 顶点,x/y ∈ {-1, 0, 1}
    const target = makeMesh(2, 2, 2);
    target.updateMatrixWorld(true);

    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      new Quaternion(0, 0, 0, 1),
      new Vector3(0.5, 0.5, 0.5),
    );

    // 仅 (0,0,0) 落在 [-0.25, 0.25]³ 内 → 1 个顶点
    expect(decal.attributes.position.count).toBe(1);
    const p = decal.attributes.position.array;
    expect(p[0]).toBeCloseTo(0, 6);
    expect(p[1]).toBeCloseTo(0, 6);
    expect(p[2]).toBeCloseTo(0, 6);
  });

  it('UV 范围在 [0,1],中心顶点 uv=(0.5,0.5)', () => {
    const target = makeMesh(2, 2, 2);
    target.updateMatrixWorld(true);
    const decal = DecalGeometry.create(
      target,
      new Vector3(0, 0, 0),
      new Quaternion(0, 0, 0, 1),
      new Vector3(0.5, 0.5, 0.5),
    );
    const uv = decal.attributes.uv.array;
    expect(uv[0]).toBeCloseTo(0.5, 6);
    expect(uv[1]).toBeCloseTo(0.5, 6);
  });

  it('无 geometry 的目标 → 空几何体(不崩溃)', () => {
    const target = new Mesh(
      new PlaneGeometry(1, 1),
      { type: 'Basic' } as unknown as Material,
    );
    // 强制清空 geometry 的 position(模拟无可用顶点)
    target.geometry.deleteAttribute('position');
    expect(() =>
      DecalGeometry.create(
        target,
        new Vector3(0, 0, 0),
        new Quaternion(0, 0, 0, 1),
        new Vector3(2, 2, 2),
      ),
    ).not.toThrow();
  });
});
