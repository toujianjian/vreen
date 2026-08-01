// Refractor 单元测试 (平面折射)。
//
// 覆盖:
//   1. 构造默认值 + 配置
//   2. refractDirection — 垂直入射(无偏折)
//   3. refractDirection — 倾斜入射(向法线弯折,eta<1)
//   4. refractDirection — 全反射(TIR)返回 null
//   5. isTotalInternalReflection
//   6. criticalAngle
//   7. estimateUVOffset — 垂直 vs 掠射
//   8. computeVirtualPosition — 水底视浅
//   9. 独立 refract() 函数
//  10. 与 GLSL refract() 一致性验证

import { describe, it, expect } from 'vitest';
import { Refractor, refract } from './Refractor';
import { Plane } from '../Math/Plane';
import { Vector3 } from '../Math/Vector3';

// ── 构造与配置 ──────────────────────────────────────────────────────

describe('Refractor construction', () => {
  it('defaults: y=0 plane, eta=0.75, res=512', () => {
    const r = new Refractor();
    expect(r.plane.normal.y).toBe(1);
    expect(r.eta).toBeCloseTo(0.75);
    expect(r.resolution).toBe(512);
  });

  it('accepts custom options', () => {
    const r = new Refractor({
      plane: new Plane(new Vector3(0, 0, 1), 0),
      eta: 1.33,
      resolution: 1024,
    });
    expect(r.plane.normal.z).toBe(1);
    expect(r.eta).toBeCloseTo(1.33);
    expect(r.resolution).toBe(1024);
  });

  it('setPlane normalizes', () => {
    const r = new Refractor();
    r.setPlane(new Plane(new Vector3(0, 2, 0), 0));
    expect(r.plane.normal.y).toBeCloseTo(1);
  });

  it('setEta updates eta', () => {
    const r = new Refractor();
    r.setEta(1.5);
    expect(r.eta).toBeCloseTo(1.5);
  });

  it('setResolution clamps to >= 1 and floors', () => {
    const r = new Refractor();
    r.setResolution(0);
    expect(r.resolution).toBe(1);
    r.setResolution(100.9);
    expect(r.resolution).toBe(100);
  });
});

// ── refractDirection ───────────────────────────────────────────────

describe('Refractor refractDirection', () => {
  it('vertical incidence — no bending', () => {
    const r = new Refractor({ eta: 0.75 });
    // D = (0, -1, 0) 向下,N = (0, 1, 0) 向上 → 垂直入射
    const d = new Vector3(0, -1, 0);
    const n = new Vector3(0, 1, 0);
    const result = r.refractDirection(d, n);
    expect(result).not.toBeNull();
    // 垂直入射:折射方向 = 入射方向(无偏折)
    expect(result!.x).toBeCloseTo(0);
    expect(result!.y).toBeCloseTo(-1);
    expect(result!.z).toBeCloseTo(0);
  });

  it('tilted incidence bends toward normal (eta < 1)', () => {
    const r = new Refractor({ eta: 0.5 }); // 疏→密,弯向法线
    // D = (1, -1, 0).normalize(),N = (0, 1, 0)
    const d = new Vector3(1, -1, 0).normalize();
    const n = new Vector3(0, 1, 0);
    const result = r.refractDirection(d, n);
    expect(result).not.toBeNull();
    // eta < 1 → 折射角 < 入射角 → 弯向法线 → y 分量更大(更垂直)
    const incidentAngle = Math.acos(-d.y);
    const refractedAngle = Math.acos(-result!.y);
    expect(refractedAngle).toBeLessThan(incidentAngle);
  });

  it('tilted incidence bends away from normal (eta > 1)', () => {
    // eta=1.1 + 30° 入射角 → 不触发 TIR
    const r = new Refractor({ eta: 1.1 }); // 密→疏,弯离法线
    const d = new Vector3(Math.sin(Math.PI / 6), -Math.cos(Math.PI / 6), 0); // 30° 入射
    const n = new Vector3(0, 1, 0);
    const result = r.refractDirection(d, n);
    expect(result).not.toBeNull();
    const incidentAngle = Math.acos(-d.y);
    const refractedAngle = Math.acos(-result!.y);
    expect(refractedAngle).toBeGreaterThan(incidentAngle);
  });

  it('total internal reflection returns null', () => {
    // eta > 1 + 大入射角 → TIR
    const r = new Refractor({ eta: 2.0 });
    // 掠射:几乎平行于表面
    const d = new Vector3(1, -0.01, 0).normalize();
    const n = new Vector3(0, 1, 0);
    const result = r.refractDirection(d, n);
    expect(result).toBeNull();
  });

  it('does not modify input vectors', () => {
    const r = new Refractor({ eta: 0.75 });
    const d = new Vector3(1, -1, 0).normalize();
    const n = new Vector3(0, 1, 0);
    const dCopy = d.clone();
    const nCopy = n.clone();
    r.refractDirection(d, n);
    expect(d.x).toBeCloseTo(dCopy.x);
    expect(d.y).toBeCloseTo(dCopy.y);
    expect(n.x).toBeCloseTo(nCopy.x);
  });

  it('writes to target vector', () => {
    const r = new Refractor();
    const d = new Vector3(0, -1, 0);
    const n = new Vector3(0, 1, 0);
    const target = new Vector3();
    const result = r.refractDirection(d, n, target);
    expect(result).toBe(target);
  });
});

// ── isTotalInternalReflection ─────────────────────────────────────

describe('Refractor isTotalInternalReflection', () => {
  it('returns false for vertical incidence (eta < 1)', () => {
    const r = new Refractor({ eta: 0.75 });
    expect(r.isTotalInternalReflection(
      new Vector3(0, -1, 0),
      new Vector3(0, 1, 0),
    )).toBe(false);
  });

  it('returns true for grazing incidence (eta > 1)', () => {
    const r = new Refractor({ eta: 2.0 });
    expect(r.isTotalInternalReflection(
      new Vector3(1, -0.01, 0).normalize(),
      new Vector3(0, 1, 0),
    )).toBe(true);
  });

  it('returns false for eta = 1 (no refraction)', () => {
    const r = new Refractor({ eta: 1.0 });
    // eta=1 永远不发生 TIR
    expect(r.isTotalInternalReflection(
      new Vector3(1, -0.01, 0).normalize(),
      new Vector3(0, 1, 0),
    )).toBe(false);
  });
});

// ── criticalAngle ──────────────────────────────────────────────────

describe('Refractor criticalAngle', () => {
  it('returns null for eta <= 1', () => {
    const r = new Refractor({ eta: 1.0 });
    expect(r.criticalAngle).toBeNull();
    const r2 = new Refractor({ eta: 0.75 });
    expect(r2.criticalAngle).toBeNull();
  });

  it('returns angle for eta > 1', () => {
    // TIR 条件: sin(θi) > 1/eta → θc = arcsin(1/eta)
    const r = new Refractor({ eta: 2.0 });
    expect(r.criticalAngle).not.toBeNull();
    expect(r.criticalAngle).toBeCloseTo(Math.asin(0.5), 5); // arcsin(1/2) = π/6
  });

  it('critical angle decreases as eta increases', () => {
    // eta 越大 → 1/eta 越小 → arcsin(1/eta) 越小
    const r1 = new Refractor({ eta: 1.5 });
    const r2 = new Refractor({ eta: 3.0 });
    expect(r2.criticalAngle!).toBeLessThan(r1.criticalAngle!);
  });
});

// ── estimateUVOffset ──────────────────────────────────────────────

describe('Refractor estimateUVOffset', () => {
  it('returns 0 for TIR', () => {
    const r = new Refractor({ eta: 2.0 });
    const offset = r.estimateUVOffset(
      new Vector3(1, 0.01, 0).normalize(),
      1.0,
    );
    expect(offset).toBe(0);
  });

  it('vertical view has smaller offset than grazing view', () => {
    const r = new Refractor({ eta: 0.75 });
    const vertical = r.estimateUVOffset(
      new Vector3(0, 1, 0), // 垂直
      1.0,
    );
    const grazing = r.estimateUVOffset(
      new Vector3(1, 0.1, 0).normalize(), // 掠射
      1.0,
    );
    expect(grazing).toBeGreaterThan(vertical);
  });

  it('offset scales with depth', () => {
    const r = new Refractor({ eta: 0.75 });
    const view = new Vector3(0.3, 0.9, 0).normalize();
    const small = r.estimateUVOffset(view, 0.5);
    const large = r.estimateUVOffset(view, 2.0);
    expect(large).toBeGreaterThan(small);
  });
});

// ── computeVirtualPosition ────────────────────────────────────────

describe('Refractor computeVirtualPosition', () => {
  it('water bottom appears shallower (eta < 1)', () => {
    const r = new Refractor({ eta: 0.75 }); // air→water
    // 水底真实位置 y = -4 (水面 y=0,水深 4)
    const real = new Vector3(0, -4, 0);
    const virtual = r.computeVirtualPosition(real, 4);
    // 视浅:apparentDepth = 4 * 0.75 = 3 → 虚拟 y = -3
    expect(virtual.y).toBeCloseTo(-3, 5);
  });

  it('virtual position is between surface and real position (eta < 1)', () => {
    const r = new Refractor({ eta: 0.5 });
    const real = new Vector3(0, -10, 0);
    const virtual = r.computeVirtualPosition(real, 10);
    // eta=0.5 → apparentDepth=5 → y=-5 (在 0 和 -10 之间)
    expect(virtual.y).toBeLessThan(0);
    expect(virtual.y).toBeGreaterThan(real.y);
  });

  it('eta=1 → virtual = real (no refraction)', () => {
    const r = new Refractor({ eta: 1.0 });
    const real = new Vector3(1, -5, 3);
    const virtual = r.computeVirtualPosition(real, 5);
    expect(virtual.x).toBeCloseTo(1);
    expect(virtual.y).toBeCloseTo(-5);
    expect(virtual.z).toBeCloseTo(3);
  });
});

// ── 独立 refract() 函数 ───────────────────────────────────────────

describe('standalone refract()', () => {
  it('matches Refractor.refractDirection', () => {
    const r = new Refractor({ eta: 0.75 });
    const d = new Vector3(1, -1, 0).normalize();
    const n = new Vector3(0, 1, 0);
    const fromClass = r.refractDirection(d, n);
    const fromFunc = refract(d, n, 0.75);
    expect(fromFunc).not.toBeNull();
    expect(fromClass).not.toBeNull();
    expect(fromFunc!.x).toBeCloseTo(fromClass!.x, 5);
    expect(fromFunc!.y).toBeCloseTo(fromClass!.y, 5);
  });

  it('returns null for TIR', () => {
    const d = new Vector3(1, -0.01, 0).normalize();
    const n = new Vector3(0, 1, 0);
    expect(refract(d, n, 2.0)).toBeNull();
  });

  it('eta=1 returns same direction', () => {
    const d = new Vector3(0.6, -0.8, 0);
    const n = new Vector3(0, 1, 0);
    const result = refract(d, n, 1.0);
    expect(result).not.toBeNull();
    expect(result!.x).toBeCloseTo(d.x);
    expect(result!.y).toBeCloseTo(d.y);
  });
});

// ── GLSL 一致性 ────────────────────────────────────────────────────

describe('Refractor GLSL refract() consistency', () => {
  // GLSL refract(I, N, eta) 规范:
  //   k = 1.0 - eta * eta * (1.0 - dot(N, I) * dot(N, I))
  //   if (k < 0.0) return genType(0.0)
  //   return eta * I - (eta * dot(N, I) + sqrt(k)) * N
  // 注意:GLSL 中 I 是入射方向(从光源指向表面),N 指向入射侧
  // 我们的实现中 D 也是入射方向,cos(θi) = -D·N
  // GLSL 中 dot(N, I) = -cos(θi) (因为 I 指向表面,N 指向入射侧)

  it('matches GLSL spec for vertical incidence', () => {
    const eta = 0.75;
    const I = new Vector3(0, -1, 0); // 入射方向(指向表面)
    const N = new Vector3(0, 1, 0);  // 法线(指向入射侧)
    // GLSL: dot(N, I) = 0*0 + 1*(-1) + 0*0 = -1
    // k = 1 - eta² * (1 - (-1)²) = 1 - eta² * 0 = 1
    // result = eta * I - (eta * (-1) + sqrt(1)) * N
    //        = (0, -0.75, 0) - (-0.75 + 1) * (0, 1, 0)
    //        = (0, -0.75, 0) - (0, 0.25, 0)
    //        = (0, -1, 0) — 垂直入射,无偏折 ✓
    const result = refract(I, N, eta);
    expect(result).not.toBeNull();
    expect(result!.y).toBeCloseTo(-1, 5);
  });

  it('matches GLSL spec for 45° incidence', () => {
    const eta = 0.75;
    const I = new Vector3(1, -1, 0).normalize(); // 45° 入射
    const N = new Vector3(0, 1, 0);
    // GLSL 手动计算
    const dotNI = N.x * I.x + N.y * I.y + N.z * I.z; // = I.y / sqrt(2) (负)
    const k = 1 - eta * eta * (1 - dotNI * dotNI);
    expect(k).toBeGreaterThan(0); // 不全反射
    const glslY = eta * I.y - (eta * dotNI + Math.sqrt(k)) * N.y;
    const result = refract(I, N, eta);
    expect(result).not.toBeNull();
    expect(result!.y).toBeCloseTo(glslY, 5);
  });
});
