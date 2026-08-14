// LightHelper 家族单元测试 —— 验证 DirectionalLight / PointLight / SpotLight /
// HemisphereLight 四个 Helper 的纯函数几何构造(buildXxxGeometry)。
//
// Helper 类构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此测试聚焦于
// buildXxxGeometry() 纯函数,验证:
//   - position / color 顶点数量与布局
//   - 坐标在合法范围且几何有意义(球半径、锥长、八面体对称)
//   - 顶点色取自 light.color / override

import { describe, it, expect } from 'vitest';
import { buildDirectionalLightHelperGeometry } from './DirectionalLightHelper';
import { buildPointLightHelperGeometry } from './PointLightHelper';
import { buildSpotLightHelperGeometry } from './SpotLightHelper';
import { buildHemisphereLightHelperGeometry } from './HemisphereLightHelper';
import { DirectionalLight } from '../Lights/DirectionalLight';
import { PointLight } from '../Lights/PointLight';
import { SpotLight } from '../Lights/SpotLight';
import { HemisphereLight } from '../Lights/HemisphereLight';

// ── DirectionalLight ────────────────────────────────────────────────────
describe('buildDirectionalLightHelperGeometry', () => {
  it('方框 4 边 + 射线 = 10 顶点,position/color 同长', () => {
    const light = new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 });
    light.position.set(10, 20, 0);
    const g = buildDirectionalLightHelperGeometry(light, 2);
    const pos = g.getAttribute('position')!;
    const col = g.getAttribute('color')!;
    expect(pos.count).toBe(10);
    expect(col.count).toBe(10);
    expect(pos.array.length).toBe(col.array.length);
  });

  it('方框四角到光源距离 = size*sqrt(2)(±right/up 构成正方形)', () => {
    const light = new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 });
    light.position.set(0, 0, 0);
    const size = 3;
    const g = buildDirectionalLightHelperGeometry(light, size);
    const p = g.getAttribute('position')!.array as Float32Array;
    // 前 8 顶点是 4 条边(角点循环),角点到原点距离 = size*√2(对角)
    for (let i = 0; i < 8; i++) {
      const d = Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      expect(Math.abs(d - size * Math.SQRT2)).toBeLessThan(1e-5);
    }
  });

  it('射线起点 = 光源位置,终点 = 光源 + 方向×(size*10)', () => {
    const light = new DirectionalLight(0xffffff, 1, { x: 0, y: -1, z: 0 });
    light.position.set(5, 6, 7);
    const size = 1;
    const g = buildDirectionalLightHelperGeometry(light, size);
    const p = g.getAttribute('position')!.array as Float32Array;
    // 顶点 8 = 光源
    expect(p[8 * 3]).toBeCloseTo(5, 5);
    expect(p[8 * 3 + 1]).toBeCloseTo(6, 5);
    expect(p[8 * 3 + 2]).toBeCloseTo(7, 5);
    // 顶点 9 = 光源 + (0,-1,0)*10 = (5,-4,7)
    expect(p[9 * 3]).toBeCloseTo(5, 5);
    expect(p[9 * 3 + 1]).toBeCloseTo(-4, 5);
    expect(p[9 * 3 + 2]).toBeCloseTo(7, 5);
  });

  it('override 颜色覆盖全部 10 顶点', () => {
    const light = new DirectionalLight(0xff0000, 1, { x: 0, y: -1, z: 0 });
    const override = { r: 0.2, g: 0.4, b: 0.6 };
    const g = buildDirectionalLightHelperGeometry(light, 1, override);
    const c = g.getAttribute('color')!.array as Float32Array;
    for (let i = 0; i < 10; i++) {
      expect(c[i * 3]).toBeCloseTo(0.2, 5);
      expect(c[i * 3 + 1]).toBeCloseTo(0.4, 5);
      expect(c[i * 3 + 2]).toBeCloseTo(0.6, 5);
    }
  });

  it('无 override 时取 light.color', () => {
    const light = new DirectionalLight(0x00ff00, 1, { x: 0, y: -1, z: 0 });
    // 0x00ff00 → r=0, g=1, b=0
    const g = buildDirectionalLightHelperGeometry(light, 1);
    const c = g.getAttribute('color')!.array as Float32Array;
    expect(c[0]).toBeCloseTo(0, 5);
    expect(c[1]).toBeCloseTo(1, 5);
    expect(c[2]).toBeCloseTo(0, 5);
  });
});

// ── PointLight ──────────────────────────────────────────────────────────
describe('buildPointLightHelperGeometry', () => {
  it('distance=0 时不含外环,只有经线+纬线', () => {
    const light = new PointLight(0xffffff, 1, 0, 2); // distance=0
    const g = buildPointLightHelperGeometry(light, 1, undefined, 8, 3);
    const pos = g.getAttribute('position')!;
    // 经线 4 条 × 8 段 × 2 + 纬线 3 条 × 9 段(=segments+1) × 2
    const expected = 4 * 8 * 2 + 3 * (8 + 1) * 2;
    expect(pos.count).toBe(expected);
  });

  it('distance>0 时多出一个外环(latSegs 段闭环)', () => {
    const light = new PointLight(0xffffff, 1, 100, 2); // distance=100
    const g = buildPointLightHelperGeometry(light, 1, undefined, 10, 3);
    const pos = g.getAttribute('position')!;
    const expected = 4 * 10 * 2 + 3 * (10 + 1) * 2 + (10 + 1) * 2;
    expect(pos.count).toBe(expected);
  });

  it('线框球所有顶点距原点 = sphereSize', () => {
    const light = new PointLight(0xffffff, 1, 0, 2);
    const R = 2.5;
    const g = buildPointLightHelperGeometry(light, R, undefined, 8, 3);
    const p = g.getAttribute('position')!.array as Float32Array;
    // 经线+纬线(不含外环,distance=0)的所有点距原点 ≈ R
    const vertCountNoRing = 4 * 8 * 2 + 3 * 9 * 2;
    for (let i = 0; i < vertCountNoRing; i++) {
      const d = Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      expect(Math.abs(d - R)).toBeLessThan(1e-4);
    }
  });

  it('外环在 y≈0 平面,半径=distance', () => {
    const light = new PointLight(0xffffff, 1, 50, 2);
    const g = buildPointLightHelperGeometry(light, 1, undefined, 10, 3);
    const p = g.getAttribute('position')!.array as Float32Array;
    // 外环是最后 (latSegs=11) × 2 = 22 个顶点
    const latSegs = 11;
    const totalBeforeRing = 4 * 10 * 2 + 3 * (10 + 1) * 2;
    for (let i = totalBeforeRing; i < totalBeforeRing + latSegs * 2; i++) {
      const r = Math.hypot(p[i * 3], p[i * 3 + 2]); // xz 平面半径
      expect(Math.abs(r - 50)).toBeLessThan(1e-4);
      expect(Math.abs(p[i * 3 + 1])).toBeLessThan(1e-4); // y≈0
    }
  });
});

// ── SpotLight ──────────────────────────────────────────────────────────
describe('buildSpotLightHelperGeometry', () => {
  it('5 辐射线 + 32 段底环 = (1+4)*2 + 32*2 = 74 顶点', () => {
    const light = new SpotLight(0xffffff, 1, 100, Math.PI / 6, 0, 2);
    const g = buildSpotLightHelperGeometry(light);
    expect(g.getAttribute('position')!.count).toBe(74);
    expect(g.getAttribute('color')!.count).toBe(74);
  });

  it('锥顶(第一个顶点)在原点,中心轴端点在 z=coneLength', () => {
    const light = new SpotLight(0xffffff, 1, 50, Math.PI / 8, 0, 2);
    const g = buildSpotLightHelperGeometry(light);
    const p = g.getAttribute('position')!.array as Float32Array;
    // 顶点 0 = 中心轴起点(原点) → (0,0,coneLength)
    expect(p[0]).toBeCloseTo(0, 5); expect(p[1]).toBeCloseTo(0, 5); expect(p[2]).toBeCloseTo(0, 5);
    expect(p[3]).toBeCloseTo(0, 5); expect(p[4]).toBeCloseTo(0, 5); expect(p[5]).toBeCloseTo(50, 4);
  });

  it('锥底环半径 = coneLength × tan(angle)', () => {
    const angle = Math.PI / 6;
    const light = new SpotLight(0xffffff, 1, 100, angle, 0, 2);
    const g = buildSpotLightHelperGeometry(light);
    const p = g.getAttribute('position')!.array as Float32Array;
    const expectedWidth = 100 * Math.tan(angle);
    // 底环从顶点 10 起(5 辐射线 × 2),每对环上点在 z=100 平面,xz 距原点 = coneWidth
    for (let i = 10; i < 74; i++) {
      const z = p[i * 3 + 2];
      expect(Math.abs(z - 100)).toBeLessThan(1e-4);
      const r = Math.hypot(p[i * 3], p[i * 3 + 1]);
      expect(Math.abs(r - expectedWidth)).toBeLessThan(1e-4);
    }
  });

  it('distance=0 时锥长回退到 1000(避免无穷锥)', () => {
    const light = new SpotLight(0xffffff, 1, 0, Math.PI / 6, 0, 2);
    const g = buildSpotLightHelperGeometry(light);
    const p = g.getAttribute('position')!.array as Float32Array;
    // 中心轴端点(顶点 1) z = 1000
    expect(p[5]).toBeCloseTo(1000, 2);
  });
});

// ── HemisphereLight ─────────────────────────────────────────────────────
describe('buildHemisphereLightHelperGeometry', () => {
  it('八面体 12 边 × 2 顶点 = 24 顶点', () => {
    const light = new HemisphereLight(0xffffbb, 0x080820, 1);
    const g = buildHemisphereLightHelperGeometry(light, 5);
    expect(g.getAttribute('position')!.count).toBe(24);
    expect(g.getAttribute('color')!.count).toBe(24);
  });

  it('所有顶点距原点 = size(八面体顶点到中心等距)', () => {
    const light = new HemisphereLight(0xffffbb, 0x080820, 1);
    const size = 4;
    const g = buildHemisphereLightHelperGeometry(light, size);
    const p = g.getAttribute('position')!.array as Float32Array;
    for (let i = 0; i < 24; i++) {
      const d = Math.hypot(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      expect(Math.abs(d - size)).toBeLessThan(1e-5);
    }
  });

  it('上半(y>0 端)顶点取 sky=light.color,下半取 ground=groundColor', () => {
    const light = new HemisphereLight(0xff0000, 0x0000ff, 1); // sky=红, ground=蓝
    const g = buildHemisphereLightHelperGeometry(light, 1);
    const c = g.getAttribute('color')!.array as Float32Array;
    // sky 红: (1,0,0); ground 蓝: (0,0,1)
    for (let i = 0; i < 24; i++) {
      // 颜色按"边是否上半"决定,端点 y 可能 = 0(赤道环归上半)。
      // 简单断言:此顶点要么纯红(上半)要么纯蓝(下半)
      const r = c[i * 3], b = c[i * 3 + 2];
      const isRed = Math.abs(r - 1) < 1e-4 && b < 1e-4;
      const isBlue = r < 1e-4 && Math.abs(b - 1) < 1e-4;
      expect(isRed || isBlue).toBe(true);
    }
    // 至少各有一个红/蓝顶点
    let redCount = 0, blueCount = 0;
    for (let i = 0; i < 24; i++) {
      const r = c[i * 3], b = c[i * 3 + 2];
      if (Math.abs(r - 1) < 1e-4 && b < 1e-4) redCount++;
      if (r < 1e-4 && Math.abs(b - 1) < 1e-4) blueCount++;
    }
    expect(redCount).toBeGreaterThan(0);
    expect(blueCount).toBeGreaterThan(0);
  });

  it('override 颜色时上/下半同色', () => {
    const light = new HemisphereLight(0xff0000, 0x0000ff, 1);
    const override = { r: 0.5, g: 0.5, b: 0.5 };
    const g = buildHemisphereLightHelperGeometry(light, 1, override);
    const c = g.getAttribute('color')!.array as Float32Array;
    for (let i = 0; i < 24; i++) {
      expect(c[i * 3]).toBeCloseTo(0.5, 5);
      expect(c[i * 3 + 1]).toBeCloseTo(0.5, 5);
      expect(c[i * 3 + 2]).toBeCloseTo(0.5, 5);
    }
  });
});
