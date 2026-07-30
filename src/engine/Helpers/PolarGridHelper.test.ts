// PolarGridHelper 单元测试 —— 验证极坐标网格几何构造。
//
// Helper 类构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于 buildPolarGridGeometry() 纯函数。

import { describe, it, expect } from 'vitest';
import { buildPolarGridGeometry } from './PolarGridHelper';

describe('buildPolarGridGeometry', () => {
  it('默认参数不崩溃并生成 position + color', () => {
    const g = buildPolarGridGeometry();
    expect(g.getAttribute('position')).toBeDefined();
    expect(g.getAttribute('color')).toBeDefined();
    expect(g.getAttribute('position')!.count).toBeGreaterThan(0);
  });

  it('radius=10, sectors=8, rings=4, divisions=32 → 顶点数正确', () => {
    // 同心圆:rings * divisions * 2 = 4 * 32 * 2 = 256
    // 径向线:sectors * 2 = 8 * 2 = 16
    // 合计 = 272
    const g = buildPolarGridGeometry(10, 8, 4, 32);
    expect(g.getAttribute('position')!.count).toBe(272);
    expect(g.getAttribute('color')!.count).toBe(272);
  });

  it('顶点数 > 100', () => {
    const g = buildPolarGridGeometry(10, 8, 4, 32);
    expect(g.getAttribute('position')!.count).toBeGreaterThan(100);
  });

  it('所有顶点距原点不超过 radius', () => {
    const radius = 10;
    const g = buildPolarGridGeometry(radius, 8, 4, 32);
    const p = g.getAttribute('position')!.array;
    for (let i = 0; i < p.length; i += 3) {
      const d = Math.hypot(p[i], p[i + 1], p[i + 2]);
      expect(d).toBeLessThanOrEqual(radius + 1e-5);
    }
  });

  it('顶点无 NaN', () => {
    const g = buildPolarGridGeometry(5, 4, 2, 8);
    const p = g.getAttribute('position')!.array;
    for (let i = 0; i < p.length; i++) {
      expect(Number.isNaN(p[i])).toBe(false);
    }
  });
});
