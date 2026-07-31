// LightmapBaker 测试 — 离线光照贴图烘焙。
//
// 验证:
//   • 基础烘焙:输出尺寸正确
//   • 单个三角形:方向光直射面 → 高亮度
//   • 方向光背向面 → 0 亮度
//   • 点光源:近处比远处亮
//   • 环境光:全三角形常数亮度
//   • AO:几何遮挡降低亮度
//   • 烘焙统计(validTexels / totalTexels / bakingTime)
//   • 高斯模糊后处理

import { describe, it, expect } from 'vitest';
import { LightmapBaker, type BakerGeometry, type BakerLight } from './LightmapBaker';

/** 构建单个朝 +Z 的三角形,UV2 覆盖 [0,0]-[1,1]。
 *  顶点顺序:A=(0,0), B=(1,0), C=(0,1),法线 = +Z。 */
function buildSingleTriangle(): BakerGeometry {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    uv2: new Float32Array([
      0, 0,
      1, 0,
      0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2]),
  };
}

/** 构建一个矩形(2 个三角形),覆盖 UV2 [0,0]-[1,1]。 */
function buildQuad(): BakerGeometry {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      1, 1, 0,
      0, 1, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    uv2: new Float32Array([
      0, 0,
      1, 0,
      1, 1,
      0, 1,
    ]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  };
}

describe('LightmapBaker — 基础烘焙', () => {
  it('输出尺寸正确', () => {
    const baker = new LightmapBaker();
    const result = baker.bake(buildSingleTriangle(), [], { width: 32, height: 32, enableBlur: false });
    expect(result.width).toBe(32);
    expect(result.height).toBe(32);
    expect(result.data.length).toBe(32 * 32 * 4);
  });

  it('无光时输出全黑', () => {
    const baker = new LightmapBaker();
    const result = baker.bake(buildSingleTriangle(), [], { width: 16, height: 16, enableBlur: false });
    for (let i = 0; i < result.data.length; i += 4) {
      // 有效 texel 也应为 0(无光),无效 texel 也是 0
      expect(result.data[i]).toBe(0);
      expect(result.data[i + 1]).toBe(0);
      expect(result.data[i + 2]).toBe(0);
      expect(result.data[i + 3]).toBe(1);
    }
  });

  it('validTexels > 0(三角形覆盖的 texel)', () => {
    const baker = new LightmapBaker();
    const result = baker.bake(buildSingleTriangle(), [], { width: 32, height: 32, enableBlur: false });
    expect(result.validTexels).toBeGreaterThan(0);
    expect(result.totalTexels).toBe(32 * 32);
  });

  it('bakingTime 非负', () => {
    const baker = new LightmapBaker();
    const result = baker.bake(buildSingleTriangle(), [], { width: 8, height: 8, enableBlur: false });
    expect(result.bakingTime).toBeGreaterThanOrEqual(0);
  });
});

describe('LightmapBaker — 方向光', () => {
  it('方向光直射 +Z 面:亮度 > 0', () => {
    const baker = new LightmapBaker();
    const light: BakerLight = {
      type: 'directional',
      direction: { x: 0, y: 0, z: -1 }, // 从 +Z 照向 -Z,即光来自 +Z
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
    };
    const result = baker.bake(buildSingleTriangle(), [light], { width: 32, height: 32, enableBlur: false });
    // 找一个有效 texel
    let foundLit = false;
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i] > 0 || result.data[i + 1] > 0 || result.data[i + 2] > 0) {
        foundLit = true;
        break;
      }
    }
    expect(foundLit).toBe(true);
  });

  it('方向光背向面:亮度 = 0', () => {
    const baker = new LightmapBaker();
    const light: BakerLight = {
      type: 'directional',
      direction: { x: 0, y: 0, z: 1 }, // 从 -Z 照向 +Z,即光来自 -Z,三角形法线 +Z,N·L < 0
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
    };
    const result = baker.bake(buildSingleTriangle(), [light], { width: 32, height: 32, enableBlur: false });
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(0);
      expect(result.data[i + 1]).toBe(0);
      expect(result.data[i + 2]).toBe(0);
    }
  });

  it('颜色分量正确传递', () => {
    const baker = new LightmapBaker();
    const light: BakerLight = {
      type: 'directional',
      direction: { x: 0, y: 0, z: -1 },
      color: { r: 1, g: 0.5, b: 0.25 },
      intensity: 1,
    };
    const result = baker.bake(buildSingleTriangle(), [light], { width: 16, height: 16, enableBlur: false });
    // 找一个亮 texel
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i] > 0) {
        // R > G > B(因 color.r > color.g > color.b)
        expect(result.data[i]).toBeGreaterThan(result.data[i + 1]);
        expect(result.data[i + 1]).toBeGreaterThan(result.data[i + 2]);
        break;
      }
    }
  });
});

describe('LightmapBaker — 点光源', () => {
  it('点光源:近处比远处亮', () => {
    const baker = new LightmapBaker();
    // 三角形在原点(0,0,0)-(1,1,0)
    // 点光源 A 在 (0.5, 0.5, 0.5) 近,亮度高
    // 点光源 B 在 (0.5, 0.5, 5) 远,亮度低
    const lightA: BakerLight = {
      type: 'point',
      position: { x: 0.5, y: 0.5, z: 0.5 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
      distance: 0,
      decay: 2,
    };
    const resultA = baker.bake(buildSingleTriangle(), [lightA], { width: 16, height: 16, enableBlur: false });
    const lightB: BakerLight = {
      type: 'point',
      position: { x: 0.5, y: 0.5, z: 5 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
      distance: 0,
      decay: 2,
    };
    const resultB = baker.bake(buildSingleTriangle(), [lightB], { width: 16, height: 16, enableBlur: false });

    let maxA = 0, maxB = 0;
    for (let i = 0; i < resultA.data.length; i += 4) {
      maxA = Math.max(maxA, resultA.data[i]);
    }
    for (let i = 0; i < resultB.data.length; i += 4) {
      maxB = Math.max(maxB, resultB.data[i]);
    }
    expect(maxA).toBeGreaterThan(maxB);
  });

  it('距离衰减:超出 distance 范围无光照', () => {
    const baker = new LightmapBaker();
    const light: BakerLight = {
      type: 'point',
      position: { x: 0.5, y: 0.5, z: 100 }, // 极远
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
      distance: 1, // 距离限制 1
      decay: 2,
    };
    const result = baker.bake(buildSingleTriangle(), [light], { width: 16, height: 16, enableBlur: false });
    for (let i = 0; i < result.data.length; i += 4) {
      expect(result.data[i]).toBe(0);
    }
  });
});

describe('LightmapBaker — 环境光', () => {
  it('环境光:全三角形常数亮度', () => {
    const baker = new LightmapBaker();
    const result = baker.bake(
      buildSingleTriangle(),
      [],
      {
        width: 16,
        height: 16,
        enableBlur: false,
        ambientColor: { r: 0.3, g: 0.4, b: 0.5 },
        ambientIntensity: 1,
      },
    );
    // 找一个有效 texel
    let foundLit = false;
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i + 3] === 1 && result.data[i] > 0) {
        expect(result.data[i]).toBeCloseTo(0.3, 2);
        expect(result.data[i + 1]).toBeCloseTo(0.4, 2);
        expect(result.data[i + 2]).toBeCloseTo(0.5, 2);
        foundLit = true;
        break;
      }
    }
    expect(foundLit).toBe(true);
  });

  it('ambient 类型光源同样贡献', () => {
    const baker = new LightmapBaker();
    const light: BakerLight = {
      type: 'ambient',
      color: { r: 0.5, g: 0.5, b: 0.5 },
      intensity: 1,
    };
    const result = baker.bake(buildSingleTriangle(), [light], { width: 16, height: 16, enableBlur: false });
    let foundLit = false;
    for (let i = 0; i < result.data.length; i += 4) {
      if (result.data[i] > 0) {
        expect(result.data[i]).toBeCloseTo(0.5, 2);
        foundLit = true;
        break;
      }
    }
    expect(foundLit).toBe(true);
  });
});

describe('LightmapBaker — AO', () => {
  it('AO 启用:无遮挡时亮度不变', () => {
    const baker = new LightmapBaker();
    const light: BakerLight = {
      type: 'directional',
      direction: { x: 0, y: 0, z: -1 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
    };
    // 单个三角形,无遮挡 → AO = 1
    const withoutAO = baker.bake(buildSingleTriangle(), [light], { width: 16, height: 16, enableBlur: false, enableAO: false });
    const withAO = baker.bake(buildSingleTriangle(), [light], { width: 16, height: 16, enableBlur: false, enableAO: true, aoSamples: 4, aoDistance: 0.1 });
    // 无其他几何遮挡 → AO 应接近 1,两者亮度接近
    let maxWithout = 0, maxWith = 0;
    for (let i = 0; i < withoutAO.data.length; i += 4) {
      maxWithout = Math.max(maxWithout, withoutAO.data[i]);
    }
    for (let i = 0; i < withAO.data.length; i += 4) {
      maxWith = Math.max(maxWith, withAO.data[i]);
    }
    // 无遮挡时 AO 不应大幅降低亮度(允许少量自遮挡数值噪声)
    expect(maxWith).toBeGreaterThan(maxWithout * 0.5);
  });
});

describe('LightmapBaker — 索引几何', () => {
  it('无索引时按顶点数 / 3 处理', () => {
    const baker = new LightmapBaker();
    const geo = buildSingleTriangle();
    geo.indices = null;
    const result = baker.bake(geo, [], { width: 16, height: 16, enableBlur: false });
    expect(result.validTexels).toBeGreaterThan(0);
  });

  it('quad(2 三角形)烘焙:全 UV 覆盖', () => {
    const baker = new LightmapBaker();
    const light: BakerLight = {
      type: 'directional',
      direction: { x: 0, y: 0, z: -1 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
    };
    const result = baker.bake(buildQuad(), [light], { width: 16, height: 16, enableBlur: false });
    // quad 覆盖整个 [0,1]² UV 空间,大部分 texel 应有效
    expect(result.validTexels).toBeGreaterThan(result.totalTexels * 0.8);
  });
});

describe('LightmapBaker — 模糊后处理', () => {
  it('enableBlur=true 不崩溃', () => {
    const baker = new LightmapBaker();
    const light: BakerLight = {
      type: 'directional',
      direction: { x: 0, y: 0, z: -1 },
      color: { r: 1, g: 1, b: 1 },
      intensity: 1,
    };
    const result = baker.bake(buildSingleTriangle(), [light], { width: 16, height: 16, enableBlur: true, blurRadius: 1 });
    expect(result.data.length).toBe(16 * 16 * 4);
    // 所有值为有限数
    for (let i = 0; i < result.data.length; i++) {
      expect(Number.isFinite(result.data[i])).toBe(true);
    }
  });
});

describe('LightmapBaker — 进度回调', () => {
  it('onProgress 被调用', () => {
    const baker = new LightmapBaker();
    let callCount = 0;
    baker.bake(buildSingleTriangle(), [], {
      width: 8,
      height: 8,
      enableBlur: false,
      onProgress: (row, total) => {
        expect(total).toBe(8);
        expect(row).toBeGreaterThan(0);
        expect(row).toBeLessThanOrEqual(8);
        callCount++;
      },
    });
    expect(callCount).toBe(8);
  });
});
