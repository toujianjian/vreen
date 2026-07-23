// CameraHelper 单元测试 —— 验证几何构造与顶点数。
//
// Helper 类的构造需要 WebGL2Renderer(jsdom 无 WebGL 上下文),因此
// 测试聚焦于 buildCameraHelperGeometry() 纯函数:验证顶点数、pointMap 结构。

import { describe, it, expect } from 'vitest';
import { buildCameraHelperGeometry } from './CameraHelper';

describe('buildCameraHelperGeometry', () => {
  it('生成 50 顶点(25 线段 × 2) + position + color', () => {
    const { geometry, pointMap } = buildCameraHelperGeometry();
    expect(geometry.getAttribute('position')).toBeDefined();
    expect(geometry.getAttribute('color')).toBeDefined();
    expect(geometry.getAttribute('position')!.count).toBe(50);
    expect(geometry.getAttribute('color')!.count).toBe(50);
    expect(pointMap).toBeDefined();
  });

  it('pointMap 包含所有命名点', () => {
    const { pointMap } = buildCameraHelperGeometry();
    const expected = [
      'n1', 'n2', 'n3', 'n4',  // near 四角
      'f1', 'f2', 'f3', 'f4',  // far 四角
      'p',                      // 原点
      'u1', 'u2', 'u3',        // up 指示
      'c', 't',                 // center / target
      'cn1', 'cn2', 'cn3', 'cn4', // cross near
      'cf1', 'cf2', 'cf3', 'cf4', // cross far
    ];
    for (const name of expected) {
      expect(pointMap[name]).toBeDefined();
      expect(pointMap[name].length).toBeGreaterThan(0);
    }
  });

  it('初始位置全 0(等待 update 填充)', () => {
    const { geometry } = buildCameraHelperGeometry();
    const pos = geometry.getAttribute('position')!.array;
    for (let i = 0; i < pos.length; i++) {
      expect(pos[i]).toBe(0);
    }
  });

  it('pointMap 索引在 [0, 49] 范围内', () => {
    const { pointMap } = buildCameraHelperGeometry();
    for (const indices of Object.values(pointMap)) {
      for (const idx of indices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(50);
      }
    }
  });

  it('near 四角各被 3 条线引用(cone + near 边 + side)', () => {
    const { pointMap } = buildCameraHelperGeometry();
    // n1 被 4 条线引用: n1-n2, n3-n1, n1-f1, p-n1
    expect(pointMap['n1'].length).toBe(4);
    expect(pointMap['n2'].length).toBe(4);
    expect(pointMap['n3'].length).toBe(4);
    expect(pointMap['n4'].length).toBe(4);
  });
});
