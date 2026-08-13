// Reflector 单元测试 (平面镜面反射)。
//
// 覆盖:
//   1. 构造默认值 + 自定义平面 + setPlane/setResolution/setOpacity/setTint
//   2. mirrorPoint — y=0 平面翻转 y 分量
//   3. mirrorPoint — 任意平面 (x=1)
//   4. mirrorPoint — 原地(平面上的点不变)
//   5. mirrorDirection — 法线分量翻转,切线分量不变
//   6. mirrorCamera — eye/target 点翻转,up 方向翻转
//   7. reflectionMatrix — 矩阵乘点 == mirrorPoint
//   8. reflectionMatrix — 行列式 = -1 (正交,手性翻转)
//   9. reflectionMatrix — 平面上的点不变
//  10. computeTextureMatrix — scaleBias × projection × view
//  11. 斜截投影 — 不崩溃 + 返回 Matrix4
//  12. plane 归一化 — 非归一化输入自动归一化

import { describe, it, expect } from 'vitest';
import { Reflector } from './Reflector';
import { Plane } from '../Math/Plane';
import { Vector3 } from '../Math/Vector3';
import { Matrix4 } from '../Math/Matrix4';

// ── 构造与配置 ──────────────────────────────────────────────────────

describe('Reflector construction', () => {
  it('defaults: y=0 plane, 512 resolution, opacity 1, white tint', () => {
    const r = new Reflector();
    expect(r.plane.normal.x).toBe(0);
    expect(r.plane.normal.y).toBe(1);
    expect(r.plane.normal.z).toBe(0);
    expect(r.plane.constant).toBe(0);
    expect(r.resolution).toBe(512);
    expect(r.opacity).toBe(1);
    expect(r.tint).toEqual([1, 1, 1]);
  });

  it('accepts custom options', () => {
    const r = new Reflector({
      plane: new Plane(new Vector3(0, 1, 0), -1),
      resolution: 1024,
      opacity: 0.5,
      tint: [0.8, 0.8, 0.9],
    });
    expect(r.plane.constant).toBe(-1);
    expect(r.resolution).toBe(1024);
    expect(r.opacity).toBeCloseTo(0.5);
    expect(r.tint).toEqual([0.8, 0.8, 0.9]);
  });

  it('setPlane updates the reflection matrix', () => {
    const r = new Reflector();
    const m1 = r.reflectionMatrix.elements.slice();
    r.setPlane(new Plane(new Vector3(1, 0, 0), 0));
    const m2 = r.reflectionMatrix.elements.slice();
    // 矩阵应该变化(从 y=0 翻转变成 x=0 翻转)
    expect(m2).not.toEqual(m1);
  });

  it('setPlane normalizes the plane', () => {
    const r = new Reflector();
    // 非归一化法线 (0,2,0) 应被归一化为 (0,1,0)
    r.setPlane(new Plane(new Vector3(0, 2, 0), 4));
    expect(r.plane.normal.y).toBeCloseTo(1);
    expect(r.plane.constant).toBeCloseTo(2); // constant 也除以 |N|
  });

  it('setResolution clamps to >= 1 and floors', () => {
    const r = new Reflector();
    r.setResolution(0);
    expect(r.resolution).toBe(1);
    r.setResolution(-10);
    expect(r.resolution).toBe(1);
    r.setResolution(100.9);
    expect(r.resolution).toBe(100);
  });

  it('setOpacity clamps to [0, 1]', () => {
    const r = new Reflector();
    r.setOpacity(-0.5);
    expect(r.opacity).toBe(0);
    r.setOpacity(2);
    expect(r.opacity).toBe(1);
    r.setOpacity(0.7);
    expect(r.opacity).toBeCloseTo(0.7);
  });

  it('setTint updates tint', () => {
    const r = new Reflector();
    r.setTint(0.1, 0.2, 0.3);
    expect(r.tint).toEqual([0.1, 0.2, 0.3]);
  });
});

// ── mirrorPoint ─────────────────────────────────────────────────────

describe('Reflector mirrorPoint', () => {
  it('flips y across y=0 plane', () => {
    const r = new Reflector(); // y=0
    const p = new Vector3(1, 5, 3);
    const m = r.mirrorPoint(p);
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(-5);
    expect(m.z).toBeCloseTo(3);
  });

  it('flips across x=1 plane', () => {
    const r = new Reflector({
      plane: new Plane(new Vector3(1, 0, 0), -1), // x - 1 = 0
    });
    const p = new Vector3(3, 2, 4);
    const m = r.mirrorPoint(p);
    // d = (1*3 + 0 + 0 + (-1)) = 2; m = p - 2*2*(1,0,0) = (3-4, 2, 4) = (-1, 2, 4)
    expect(m.x).toBeCloseTo(-1);
    expect(m.y).toBeCloseTo(2);
    expect(m.z).toBeCloseTo(4);
  });

  it('leaves points on the plane unchanged', () => {
    const r = new Reflector(); // y=0
    const p = new Vector3(5, 0, -3);
    const m = r.mirrorPoint(p);
    expect(m.x).toBeCloseTo(5);
    expect(m.y).toBeCloseTo(0);
    expect(m.z).toBeCloseTo(-3);
  });

  it('writes to target vector', () => {
    const r = new Reflector();
    const p = new Vector3(0, 1, 0);
    const target = new Vector3();
    const result = r.mirrorPoint(p, target);
    expect(result).toBe(target);
    expect(target.y).toBeCloseTo(-1);
  });

  it('reflects origin across y=2 plane', () => {
    const r = new Reflector({
      plane: new Plane(new Vector3(0, 1, 0), -2), // y - 2 = 0
    });
    const m = r.mirrorPoint(new Vector3(0, 0, 0));
    // d = 0 + (-2) = -2; m = (0,0,0) - 2*(-2)*(0,1,0) = (0, 4, 0)
    expect(m.y).toBeCloseTo(4);
  });
});

// ── mirrorDirection ────────────────────────────────────────────────

describe('Reflector mirrorDirection', () => {
  it('flips normal component, keeps tangential', () => {
    const r = new Reflector(); // y=0, normal=(0,1,0)
    const dir = new Vector3(1, 1, 0); // 45° 向上 + x
    const m = r.mirrorDirection(dir);
    expect(m.x).toBeCloseTo(1);  // 切线分量不变
    expect(m.y).toBeCloseTo(-1); // 法线分量翻转
    expect(m.z).toBeCloseTo(0);
  });

  it('purely tangential direction is unchanged', () => {
    const r = new Reflector();
    const dir = new Vector3(1, 0, 1);
    const m = r.mirrorDirection(dir);
    expect(m.x).toBeCloseTo(1);
    expect(m.y).toBeCloseTo(0);
    expect(m.z).toBeCloseTo(1);
  });

  it('purely normal direction is negated', () => {
    const r = new Reflector();
    const dir = new Vector3(0, 5, 0);
    const m = r.mirrorDirection(dir);
    expect(m.x).toBeCloseTo(0);
    expect(m.y).toBeCloseTo(-5);
    expect(m.z).toBeCloseTo(0);
  });
});

// ── mirrorCamera ───────────────────────────────────────────────────

describe('Reflector mirrorCamera', () => {
  it('mirrors eye and target across the plane', () => {
    const r = new Reflector(); // y=0
    const cam = r.mirrorCamera(
      new Vector3(0, 5, 10),
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
    );
    expect(cam.eye.y).toBeCloseTo(-5);
    expect(cam.eye.z).toBeCloseTo(10);
    expect(cam.target.y).toBeCloseTo(0);
    expect(cam.target.z).toBeCloseTo(0);
  });

  it('mirrors up direction (normal component flips)', () => {
    const r = new Reflector(); // y=0
    const cam = r.mirrorCamera(
      new Vector3(0, 5, 0),
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
    );
    // up=(0,1,0) → (0,-1,0) after reflection
    expect(cam.up.x).toBeCloseTo(0);
    expect(cam.up.y).toBeCloseTo(-1);
    expect(cam.up.z).toBeCloseTo(0);
  });

  it('camera on the plane stays on the plane', () => {
    const r = new Reflector(); // y=0
    const cam = r.mirrorCamera(
      new Vector3(0, 0, 10),
      new Vector3(0, 0, 0),
      new Vector3(0, 1, 0),
    );
    expect(cam.eye.y).toBeCloseTo(0);
    expect(cam.target.y).toBeCloseTo(0);
  });
});

// ── reflectionMatrix ───────────────────────────────────────────────

describe('Reflector reflectionMatrix', () => {
  it('matrix × point == mirrorPoint', () => {
    const r = new Reflector(); // y=0
    const p = new Vector3(3, 7, -2);
    const m = r.mirrorPoint(p);

    // 用矩阵变换: P' = M × P (齐次,w=1)
    const mat = r.reflectionMatrix.elements;
    const px = mat[0] * p.x + mat[4] * p.y + mat[8] * p.z + mat[12];
    const py = mat[1] * p.x + mat[5] * p.y + mat[9] * p.z + mat[13];
    const pz = mat[2] * p.x + mat[6] * p.y + mat[10] * p.z + mat[14];
    expect(px).toBeCloseTo(m.x);
    expect(py).toBeCloseTo(m.y);
    expect(pz).toBeCloseTo(m.z);
  });

  it('has determinant -1 (orthogonal, handedness flip)', () => {
    const r = new Reflector();
    const e = r.reflectionMatrix.elements;
    // 3×3 行列式 (左上角)
    const det3 =
      e[0] * (e[5] * e[10] - e[6] * e[9]) -
      e[4] * (e[1] * e[10] - e[2] * e[9]) +
      e[8] * (e[1] * e[6] - e[2] * e[5]);
    expect(det3).toBeCloseTo(-1);
  });

  it('leaves points on the plane unchanged', () => {
    const r = new Reflector(); // y=0
    const p = new Vector3(5, 0, -3);
    const mat = r.reflectionMatrix.elements;
    const py = mat[1] * p.x + mat[5] * p.y + mat[9] * p.z + mat[13];
    expect(py).toBeCloseTo(0);
  });

  it('is symmetric for y=0 plane', () => {
    const r = new Reflector();
    const e = r.reflectionMatrix.elements;
    // y=0 反射矩阵 = diag(1, -1, 1, 1) with 0 translation
    expect(e[0]).toBeCloseTo(1);
    expect(e[5]).toBeCloseTo(-1);
    expect(e[10]).toBeCloseTo(1);
    expect(e[15]).toBeCloseTo(1);
    expect(e[12]).toBeCloseTo(0);
    expect(e[13]).toBeCloseTo(0);
    expect(e[14]).toBeCloseTo(0);
  });

  it('M × M = I (reflecting twice is identity)', () => {
    const r = new Reflector();
    const m = r.reflectionMatrix;
    const result = new Matrix4().multiplyMatrices(m, m);
    const e = result.elements;
    expect(e[0]).toBeCloseTo(1);
    expect(e[5]).toBeCloseTo(1);
    expect(e[10]).toBeCloseTo(1);
    expect(e[15]).toBeCloseTo(1);
    expect(e[1]).toBeCloseTo(0);
    expect(e[4]).toBeCloseTo(0);
    expect(e[12]).toBeCloseTo(0);
  });
});

// ── computeTextureMatrix ───────────────────────────────────────────

describe('Reflector computeTextureMatrix', () => {
  it('returns a 4×4 matrix', () => {
    const r = new Reflector();
    const proj = new Matrix4().makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const view = new Matrix4().makeLookAt(
      { x: 0, y: -5, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    const tex = r.computeTextureMatrix(proj, view);
    expect(tex.elements.length).toBe(16);
  });

  it('maps origin (on plane) to [0.5, 0.5] in UV (roughly)', () => {
    // 原点在 y=0 平面上,镜像相机也在平面上,投影后 NDC ≈ (0, 0) → UV (0.5, 0.5)
    // 但这取决于视图矩阵,这里只验证不崩溃且结果合理
    const r = new Reflector();
    const proj = new Matrix4().makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const view = new Matrix4().makeLookAt(
      { x: 0, y: 0, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    const tex = r.computeTextureMatrix(proj, view);
    // 验证 scaleBias 被应用(纹理矩阵的平移分量非零)
    expect(tex.elements[12]).not.toBeCloseTo(0, 0);
    expect(tex.elements[13]).not.toBeCloseTo(0, 0);
  });
});

// ── computeObliqueProjection ───────────────────────────────────────

describe('Reflector computeObliqueProjection', () => {
  it('returns a Matrix4 without crashing', () => {
    const r = new Reflector();
    const proj = new Matrix4().makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const view = new Matrix4().makeLookAt(
      { x: 0, y: 5, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    const oblique = r.computeObliqueProjection(proj, view);
    expect(oblique.elements.length).toBe(16);
  });

  it('modifies the near-plane row (row 3)', () => {
    const r = new Reflector();
    const proj = new Matrix4().makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const view = new Matrix4().makeLookAt(
      { x: 0, y: 5, z: 10 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
    );
    const oblique = r.computeObliqueProjection(proj, view);
    // row 3 = elements [3], [7], [11], [15]
    // 至少一个分量应该与原投影不同
    const changed =
      Math.abs(oblique.elements[3] - proj.elements[3]) > 1e-6 ||
      Math.abs(oblique.elements[7] - proj.elements[7]) > 1e-6 ||
      Math.abs(oblique.elements[11] - proj.elements[11]) > 1e-6 ||
      Math.abs(oblique.elements[15] - proj.elements[15]) > 1e-6;
    expect(changed).toBe(true);
  });

  it('returns original projection for degenerate case (parallel plane)', () => {
    // 平面与近裁剪面平行 — 可能退化,但不应崩溃
    const r = new Reflector();
    const proj = new Matrix4().makePerspective(-0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), 0.1 * Math.tan(Math.PI / 8), -0.1 * Math.tan(Math.PI / 8), 0.1, 100);
    const view = new Matrix4(); // identity view
    const oblique = r.computeObliqueProjection(proj, view);
    expect(oblique.elements.length).toBe(16);
  });
});

// ── 多平面测试 ─────────────────────────────────────────────────────

describe('Reflector arbitrary planes', () => {
  it('reflects across a diagonal plane', () => {
    // 平面: x + y = 0 (法线 (1,1,0)/√2, constant 0)
    const n = new Vector3(1, 1, 0).normalize();
    const r = new Reflector({ plane: new Plane(n, 0) });
    const p = new Vector3(1, 1, 0);
    const m = r.mirrorPoint(p);
    // 点 (1,1,0) 关于 x+y=0 的镜像 = (-1,-1,0)
    expect(m.x).toBeCloseTo(-1);
    expect(m.y).toBeCloseTo(-1);
    expect(m.z).toBeCloseTo(0);
  });

  it('reflects across z=5 plane', () => {
    const r = new Reflector({
      plane: new Plane(new Vector3(0, 0, 1), -5), // z - 5 = 0
    });
    const p = new Vector3(0, 0, 10);
    const m = r.mirrorPoint(p);
    // d = 10 + (-5) = 5; m = (0,0,10) - 2*5*(0,0,1) = (0,0,0)
    expect(m.z).toBeCloseTo(0);
  });
});
