// Frustum culling 单元测试。
//
// 构造一个已知视锥体:相机在原点看向 -Z,fovY=90°,aspect=1,near=0.1,far=100。
// 该视锥体在 z=-5 处的截面是 ±5 的正方形(因为 90° fov → tan(45°)=1)。
// view 矩阵为 identity(eye=origin, forward=-Z),所以 viewProjection = projection。

import { describe, it, expect } from 'vitest';
import { Frustum } from './Frustum';
import { Matrix4 } from './Matrix4';
import { Vector3 } from './Vector3';

function makeTestFrustum(): Frustum {
  const view = new Matrix4().makeLookAt(
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 1, z: 0 },
  );
  const proj = new Matrix4().makePerspective(
    -0.1,  // left  = -top (top = near·tan(90°/2) = 0.1)
    0.1,   // right
    0.1,   // top
    -0.1,  // bottom
    0.1,   // near
    100,   // far
  );
  const vp = new Matrix4().multiplyMatrices(proj, view);
  return new Frustum().setFromViewProjectionMatrix(vp);
}

describe('Frustum', () => {
  describe('containsPoint', () => {
    const f = makeTestFrustum();

    it('point directly in front is inside', () => {
      expect(f.containsPoint(new Vector3(0, 0, -5))).toBe(true);
    });

    it('point behind camera is outside', () => {
      expect(f.containsPoint(new Vector3(0, 0, 5))).toBe(false);
    });

    it('point too far right is outside (beyond 45° half-angle at z=-5)', () => {
      expect(f.containsPoint(new Vector3(6, 0, -5))).toBe(false);
    });

    it('point just inside right edge is inside', () => {
      expect(f.containsPoint(new Vector3(4, 0, -5))).toBe(true);
    });

    it('point beyond far plane is outside', () => {
      expect(f.containsPoint(new Vector3(0, 0, -200))).toBe(false);
    });

    it('point before near plane is outside', () => {
      expect(f.containsPoint(new Vector3(0, 0, -0.01))).toBe(false);
    });

    it('origin (camera position) is on the boundary — near plane', () => {
      // 原点恰在 near 平面上(near=0.1 不是 0,所以原点在 near 平面后方一点点)
      // near 平面在 z=-0.1,原点 z=0 在 near 平面之后 → outside
      expect(f.containsPoint(new Vector3(0, 0, 0))).toBe(false);
    });
  });

  describe('intersectsSphere', () => {
    const f = makeTestFrustum();

    it('sphere fully inside is intersecting', () => {
      expect(f.intersectsSphere(new Vector3(0, 0, -5), 1)).toBe(true);
    });

    it('sphere behind camera is not intersecting', () => {
      expect(f.intersectsSphere(new Vector3(0, 0, 10), 1)).toBe(false);
    });

    it('sphere center outside but radius reaches in is intersecting', () => {
      // 球心在 z=-5, x=6 (右平面外 1 单位),radius=2 → 跨越右平面
      expect(f.intersectsSphere(new Vector3(6, 0, -5), 2)).toBe(true);
    });

    it('sphere center far outside is not intersecting', () => {
      expect(f.intersectsSphere(new Vector3(6, 0, -5), 0.5)).toBe(false);
    });

    it('sphere straddling near plane is intersecting', () => {
      // near 平面 z=-0.1,球心 z=-0.05 (near 平面正侧 0.05),radius=1 → 跨越
      expect(f.intersectsSphere(new Vector3(0, 0, -0.05), 1)).toBe(true);
    });

    it('sphere beyond far plane is not intersecting', () => {
      expect(f.intersectsSphere(new Vector3(0, 0, -200), 1)).toBe(false);
    });
  });

  describe('containsSphere (strict)', () => {
    const f = makeTestFrustum();

    it('sphere fully inside is contained', () => {
      expect(f.containsSphere(new Vector3(0, 0, -5), 1)).toBe(true);
    });

    it('sphere touching a plane is not strictly contained', () => {
      // 球心 x=4, radius=1:右平面在 x≈5 处(z=-5),球刚好触碰 → 不完全内含
      expect(f.containsSphere(new Vector3(4, 0, -5), 1)).toBe(false);
    });

    it('small sphere deep inside is contained', () => {
      expect(f.containsSphere(new Vector3(0, 0, -10), 0.5)).toBe(true);
    });
  });

  describe('degenerate matrix', () => {
    it('zero matrix produces zero planes without throwing', () => {
      const f = new Frustum();
      const zero = new Matrix4();
      zero.elements.fill(0);
      expect(() => f.setFromViewProjectionMatrix(zero)).not.toThrow();
      // 零平面:normal=(0,0,0),constant=0 → containsPoint 返回 true(无平面拒绝)
      // 这是退化情况,实际调用方应避免传入零矩阵。
      expect(f.containsPoint(new Vector3(0, 0, 0))).toBe(true);
    });
  });
});
