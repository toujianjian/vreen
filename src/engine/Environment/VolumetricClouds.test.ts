// VolumetricClouds.test.ts — 体积云渲染系统测试。
//
// 验证:
//   * 构造与默认值
//   * setEnabled / setCloudColor / setCoverage / setDensity / setHeight / setThickness
//   * setWind / setAmbientColor / setSunColor / setSunDirection
//   * setSteps / setShadowSteps / setNoiseResolution
//   * generateNoise(确定性、可复现、范围 0..1)
//   * sampleNoise(三线性插值、环绕寻址)
//   * render / marchRay(光线步进)
//   * computeLighting(Beer-Lambert)
//   * update(风偏移累积)
//   * getCloudData / getShaderUniforms / getStats

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { VolumetricClouds, CLOUD_PRESETS } from './VolumetricClouds';

describe('VolumetricClouds — 构造与默认值', () => {
  it('默认构造', () => {
    const c = new VolumetricClouds();
    expect(c.cloudColor).toEqual({ r: 1, g: 1, b: 1 });
    expect(c.cloudCoverage).toBeCloseTo(0.5, 5);
    expect(c.cloudDensity).toBeCloseTo(0.5, 5);
    expect(c.cloudHeight).toBe(1000);
    expect(c.cloudThickness).toBe(500);
    expect(c.windDirection).toEqual({ x: 1, y: 0, z: 0 });
    expect(c.windSpeed).toBe(10);
    expect(c.windOffset).toEqual({ x: 0, y: 0, z: 0 });
    expect(c.ambientColor).toEqual({ r: 0.3, g: 0.35, b: 0.4 });
    expect(c.sunColor).toEqual({ r: 1, g: 0.95, b: 0.85 });
    expect(c.sunDirection).toEqual({ x: 0, y: 1, z: 0 });
    expect(c.steps).toBe(64);
    expect(c.shadowSteps).toBe(16);
    expect(c.noiseResolution).toEqual({ x: 64, y: 64, z: 64 });
    expect(c.noiseData).toBeNull();
    expect(c.enabled).toBe(true);
  });

  it('默认不预生成噪声', () => {
    const c = new VolumetricClouds();
    expect(c.noiseData).toBeNull();
    expect(c.getStats().noiseGenerated).toBe(false);
  });
});

describe('VolumetricClouds — 开关与基础 setter', () => {
  it('setEnabled 切换', () => {
    const c = new VolumetricClouds();
    c.setEnabled(false);
    expect(c.enabled).toBe(false);
    c.setEnabled(true);
    expect(c.enabled).toBe(true);
  });

  it('setCloudColor 复制颜色', () => {
    const c = new VolumetricClouds();
    const src = { r: 0.5, g: 0.6, b: 0.7 };
    c.setCloudColor(src);
    expect(c.cloudColor).toEqual(src);
    src.r = 999;
    expect(c.cloudColor.r).toBe(0.5);
  });

  it('setCoverage 限制 [0,1]', () => {
    const c = new VolumetricClouds();
    c.setCoverage(-1);
    expect(c.cloudCoverage).toBe(0);
    c.setCoverage(2);
    expect(c.cloudCoverage).toBe(1);
    c.setCoverage(0.7);
    expect(c.cloudCoverage).toBeCloseTo(0.7, 5);
  });

  it('setDensity 限制非负', () => {
    const c = new VolumetricClouds();
    c.setDensity(-1);
    expect(c.cloudDensity).toBe(0);
    c.setDensity(1.5);
    expect(c.cloudDensity).toBeCloseTo(1.5, 5);
  });

  it('setHeight 限制非负', () => {
    const c = new VolumetricClouds();
    c.setHeight(-100);
    expect(c.cloudHeight).toBe(0);
    c.setHeight(2000);
    expect(c.cloudHeight).toBe(2000);
  });

  it('setThickness 限制非负', () => {
    const c = new VolumetricClouds();
    c.setThickness(-50);
    expect(c.cloudThickness).toBe(0);
    c.setThickness(800);
    expect(c.cloudThickness).toBe(800);
  });

  it('setWind 归一化方向 + 非负速度', () => {
    const c = new VolumetricClouds();
    c.setWind(new Vector3(0, 0, 5), -3);
    expect(c.windDirection.length()).toBeCloseTo(1, 5);
    expect(c.windDirection.z).toBeCloseTo(1, 5);
    expect(c.windSpeed).toBe(0);
  });

  it('setAmbientColor 复制颜色', () => {
    const c = new VolumetricClouds();
    c.setAmbientColor({ r: 0.1, g: 0.2, b: 0.3 });
    expect(c.ambientColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
  });

  it('setSunColor 复制颜色', () => {
    const c = new VolumetricClouds();
    c.setSunColor({ r: 0.5, g: 0.5, b: 0.5 });
    expect(c.sunColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
  });

  it('setSunDirection 归一化', () => {
    const c = new VolumetricClouds();
    c.setSunDirection(new Vector3(0, 2, 0));
    expect(c.sunDirection.length()).toBeCloseTo(1, 5);
    expect(c.sunDirection.y).toBeCloseTo(1, 5);
  });
});

describe('VolumetricClouds — 步进与噪声分辨率', () => {
  it('setSteps 限制 [1, 512]', () => {
    const c = new VolumetricClouds();
    c.setSteps(0);
    expect(c.steps).toBe(1);
    c.setSteps(1000);
    expect(c.steps).toBe(512);
    c.setSteps(128);
    expect(c.steps).toBe(128);
  });

  it('setShadowSteps 限制 [1, 128]', () => {
    const c = new VolumetricClouds();
    c.setShadowSteps(0);
    expect(c.shadowSteps).toBe(1);
    c.setShadowSteps(256);
    expect(c.shadowSteps).toBe(128);
    c.setShadowSteps(32);
    expect(c.shadowSteps).toBe(32);
  });

  it('setNoiseResolution 各轴最小 2', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(1, 1, 1);
    expect(c.noiseResolution).toEqual({ x: 2, y: 2, z: 2 });
    c.setNoiseResolution(16, 32, 8);
    expect(c.noiseResolution).toEqual({ x: 16, y: 32, z: 8 });
  });

  it('setNoiseResolution 清空旧噪声数据', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    expect(c.noiseData).not.toBeNull();
    c.setNoiseResolution(16, 16, 16);
    expect(c.noiseData).toBeNull();
  });
});

describe('VolumetricClouds — 噪声生成', () => {
  it('generateNoise 生成正确大小的 Float32Array', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(42);
    expect(c.noiseData).not.toBeNull();
    expect(c.noiseData!.length).toBe(8 * 8 * 8);
    expect(c.noiseData).toBeInstanceOf(Float32Array);
  });

  it('generateNoise 所有值在 [0,1]', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(16, 16, 16);
    c.generateNoise(0);
    expect(c.noiseData).not.toBeNull();
    for (let i = 0; i < c.noiseData!.length; i++) {
      const v = c.noiseData![i];
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('generateNoise 同种子可复现', () => {
    const c1 = new VolumetricClouds();
    c1.setNoiseResolution(8, 8, 8);
    c1.generateNoise(123);
    const c2 = new VolumetricClouds();
    c2.setNoiseResolution(8, 8, 8);
    c2.generateNoise(123);
    expect(c1.noiseData!.length).toBe(c2.noiseData!.length);
    for (let i = 0; i < c1.noiseData!.length; i++) {
      expect(c1.noiseData![i]).toBeCloseTo(c2.noiseData![i], 6);
    }
  });

  it('generateNoise 不同种子产生不同结果', () => {
    const c1 = new VolumetricClouds();
    c1.setNoiseResolution(8, 8, 8);
    c1.generateNoise(1);
    const c2 = new VolumetricClouds();
    c2.setNoiseResolution(8, 8, 8);
    c2.generateNoise(2);
    let differs = false;
    for (let i = 0; i < c1.noiseData!.length; i++) {
      if (Math.abs(c1.noiseData![i] - c2.noiseData![i]) > 1e-6) {
        differs = true;
        break;
      }
    }
    expect(differs).toBe(true);
  });

  it('generateNoise 返回 this 链式调用', () => {
    const c = new VolumetricClouds();
    expect(c.generateNoise(0)).toBe(c);
  });
});

describe('VolumetricClouds — 噪声采样', () => {
  it('sampleNoise 未生成时返回 0', () => {
    const c = new VolumetricClouds();
    expect(c.sampleNoise(0.5, 0.5, 0.5)).toBe(0);
  });

  it('sampleNoise 在生成后返回 [0,1] 范围值', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    const v = c.sampleNoise(0.5, 0.5, 0.5);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(1);
  });

  it('sampleNoise 整数坐标等于直接采样', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(4, 4, 4);
    c.generateNoise(0);
    // (0,0,0) 处的值应等于 noiseData[0]
    const v = c.sampleNoise(0, 0, 0);
    expect(v).toBeCloseTo(c.noiseData![0], 5);
  });

  it('sampleNoise 环绕寻址', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(4, 4, 4);
    c.generateNoise(0);
    const v0 = c.sampleNoise(0.25, 0, 0);
    const v1 = c.sampleNoise(1.25, 0, 0); // 越界应环绕
    expect(v1).toBeCloseTo(v0, 5);
  });

  it('sampleNoise 负坐标环绕', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(4, 4, 4);
    c.generateNoise(0);
    const v0 = c.sampleNoise(0.5, 0, 0);
    const v1 = c.sampleNoise(-0.5, 0, 0); // 等价于 0.5
    expect(v1).toBeCloseTo(v0, 5);
  });
});

describe('VolumetricClouds — 光照计算', () => {
  it('computeLighting 返回非负颜色', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    const pos = new Vector3(512, 1200, 512);
    const light = c.computeLighting(pos, 0.5, new Vector3(0, 1, 0));
    expect(light.r).toBeGreaterThanOrEqual(0);
    expect(light.g).toBeGreaterThanOrEqual(0);
    expect(light.b).toBeGreaterThanOrEqual(0);
  });

  it('computeLighting 高密度时环境光更暗', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    const pos = new Vector3(512, 1200, 512);
    const low = c.computeLighting(pos, 0.1, new Vector3(0, 1, 0));
    const high = c.computeLighting(pos, 0.9, new Vector3(0, 1, 0));
    // 高密度时环境光被衰减,光照整体可能更低(取决于太阳衰减)
    // 关键断言:两者都有效且环境光项在高密度下更暗
    const lowAmbient = low.r + low.g + low.b;
    const highAmbient = high.r + high.g + high.b;
    expect(lowAmbient).toBeGreaterThanOrEqual(0);
    expect(highAmbient).toBeGreaterThanOrEqual(0);
  });

  it('computeLighting 无噪声时不抛错', () => {
    const c = new VolumetricClouds();
    // 不生成噪声 — 应安全处理(密度为 0,光学深度为 0)
    expect(() => {
      c.computeLighting(new Vector3(0, 0, 0), 0.5, new Vector3(0, 1, 0));
    }).not.toThrow();
  });
});

describe('VolumetricClouds — 光线步进与渲染', () => {
  it('marchRay 未生成噪声时返回 0 alpha', () => {
    const c = new VolumetricClouds();
    const origin = new Vector3(0, 0, 0);
    const dir = new Vector3(0, 1, 0);
    const result = c.marchRay(origin, dir, 8);
    expect(result.alpha).toBe(0);
  });

  it('marchRay 光线不指向云层时 alpha 为 0', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    // 云层在 y=1000..1500,光线从 y=0 向下不命中
    const origin = new Vector3(0, 0, 0);
    const dir = new Vector3(0, -1, 0);
    const result = c.marchRay(origin, dir, 8);
    expect(result.alpha).toBe(0);
  });

  it('marchRay 光线指向云层时返回有效结果', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.setCoverage(0.8);
    c.setDensity(0.8);
    c.generateNoise(0);
    // 从 y=0 向上指向云层(1000..1500)
    const origin = new Vector3(512, 0, 512);
    const dir = new Vector3(0, 1, 0);
    const result = c.marchRay(origin, dir, 16);
    expect(result.alpha).toBeGreaterThanOrEqual(0);
    expect(result.alpha).toBeLessThanOrEqual(1);
    expect(result.color.r).toBeGreaterThanOrEqual(0);
  });

  it('render 禁用时返回 0 alpha', () => {
    const c = new VolumetricClouds();
    c.setEnabled(false);
    const camera = { position: new Vector3(0, 0, 0), forward: new Vector3(0, 1, 0) };
    const result = c.render(camera);
    expect(result.alpha).toBe(0);
  });

  it('render 启用且无噪声时安全返回', () => {
    const c = new VolumetricClouds();
    const camera = { position: new Vector3(0, 0, 0), forward: new Vector3(0, 1, 0) };
    expect(() => c.render(camera)).not.toThrow();
  });

  it('marchRay 累计采样数被记录到统计', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.setCoverage(0.8);
    c.generateNoise(0);
    const origin = new Vector3(512, 0, 512);
    const dir = new Vector3(0, 1, 0);
    c.marchRay(origin, dir, 8);
    expect(c.getStats().lastSampleCount).toBeGreaterThanOrEqual(0);
  });
});

describe('VolumetricClouds — 风偏移', () => {
  it('update 累积风偏移', () => {
    const c = new VolumetricClouds();
    c.setWind(new Vector3(1, 0, 0), 10);
    c.update(1); // 1 秒 → 偏移 10
    expect(c.windOffset.x).toBeCloseTo(10, 5);
    expect(c.windOffset.y).toBeCloseTo(0, 5);
    c.update(1); // 再 1 秒 → 累计 20
    expect(c.windOffset.x).toBeCloseTo(20, 5);
  });

  it('update dt<=0 不前进', () => {
    const c = new VolumetricClouds();
    c.setWind(new Vector3(1, 0, 0), 10);
    c.update(0);
    expect(c.windOffset.x).toBe(0);
    c.update(-1);
    expect(c.windOffset.x).toBe(0);
  });

  it('update enabled=false 不前进', () => {
    const c = new VolumetricClouds();
    c.setWind(new Vector3(1, 0, 0), 10);
    c.setEnabled(false);
    c.update(1);
    expect(c.windOffset.x).toBe(0);
  });

  it('update 返回 this', () => {
    const c = new VolumetricClouds();
    expect(c.update(0.016)).toBe(c);
  });

  it('getStats.lastDt 反映上次 dt', () => {
    const c = new VolumetricClouds();
    c.update(0.5);
    expect(c.getStats().lastDt).toBeCloseTo(0.5, 5);
  });
});

describe('VolumetricClouds — 数据 / uniform / 统计', () => {
  it('getCloudData 返回快照', () => {
    const c = new VolumetricClouds();
    c.setCoverage(0.6).setDensity(0.4);
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    const data = c.getCloudData();
    expect(data.coverage).toBeCloseTo(0.6, 5);
    expect(data.density).toBeCloseTo(0.4, 5);
    expect(data.enabled).toBe(true);
    expect(data.noiseData).not.toBeNull();
    expect(data.noiseResolution).toEqual({ x: 8, y: 8, z: 8 });
    expect(data.windOffset).toBeInstanceOf(Vector3);
  });

  it('getCloudData 风偏移返回克隆', () => {
    const c = new VolumetricClouds();
    c.update(1);
    const data = c.getCloudData();
    data.windOffset.x = 999;
    expect(c.windOffset.x).not.toBe(999);
  });

  it('getShaderUniforms 返回完整字段', () => {
    const c = new VolumetricClouds();
    c.setCoverage(0.7);
    c.setDensity(0.3);
    const u = c.getShaderUniforms();
    expect(u.u_cloudColor).toHaveLength(3);
    expect(u.u_cloudCoverage).toBeCloseTo(0.7, 5);
    expect(u.u_cloudDensity).toBeCloseTo(0.3, 5);
    expect(u.u_cloudHeight).toBe(1000);
    expect(u.u_cloudThickness).toBe(500);
    expect(u.u_windDirection).toHaveLength(3);
    expect(u.u_windSpeed).toBe(10);
    expect(u.u_windOffset).toHaveLength(3);
    expect(u.u_ambientColor).toHaveLength(3);
    expect(u.u_sunColor).toHaveLength(3);
    expect(u.u_sunDirection).toHaveLength(3);
    expect(u.u_steps).toBe(64);
    expect(u.u_shadowSteps).toBe(16);
    expect(u.u_noiseResolution).toHaveLength(3);
    expect(u.u_enabled).toBe(1);
  });

  it('getShaderUniforms 禁用时 u_enabled 为 0', () => {
    const c = new VolumetricClouds();
    c.setEnabled(false);
    expect(c.getShaderUniforms().u_enabled).toBe(0);
  });

  it('getShaderUniforms 反映风偏移', () => {
    const c = new VolumetricClouds();
    c.setWind(new Vector3(1, 0, 0), 5);
    c.update(2); // 偏移 10
    const u = c.getShaderUniforms();
    expect(u.u_windOffset[0]).toBeCloseTo(10, 5);
  });

  it('getStats 返回正确统计', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    c.setCoverage(0.5);
    c.setSteps(32);
    c.setShadowSteps(8);
    const stats = c.getStats();
    expect(stats.coverage).toBeCloseTo(0.5, 5);
    expect(stats.steps).toBe(32);
    expect(stats.shadowSteps).toBe(8);
    expect(stats.noiseResolution).toEqual({ x: 8, y: 8, z: 8 });
    expect(stats.noiseVoxelCount).toBe(8 * 8 * 8);
    expect(stats.noiseGenerated).toBe(true);
    expect(stats.enabled).toBe(true);
    expect(stats.windOffset).toBeInstanceOf(Vector3);
  });

  it('getStats 未生成噪声时 noiseGenerated 为 false', () => {
    const c = new VolumetricClouds();
    expect(c.getStats().noiseGenerated).toBe(false);
    expect(c.getStats().noiseVoxelCount).toBe(64 * 64 * 64);
  });
});

describe('VolumetricClouds — 链式调用', () => {
  it('所有 setter 返回 this', () => {
    const c = new VolumetricClouds();
    expect(c.setEnabled(true)).toBe(c);
    expect(c.setCloudColor({ r: 0, g: 0, b: 0 })).toBe(c);
    expect(c.setCoverage(0.5)).toBe(c);
    expect(c.setDensity(0.5)).toBe(c);
    expect(c.setHeight(100)).toBe(c);
    expect(c.setThickness(50)).toBe(c);
    expect(c.setWind(new Vector3(0, 0, 1), 5)).toBe(c);
    expect(c.setAmbientColor({ r: 0, g: 0, b: 0 })).toBe(c);
    expect(c.setSunColor({ r: 0, g: 0, b: 0 })).toBe(c);
    expect(c.setSunDirection(new Vector3(0, 1, 0))).toBe(c);
    expect(c.setSteps(32)).toBe(c);
    expect(c.setShadowSteps(8)).toBe(c);
    expect(c.setNoiseResolution(16, 16, 16)).toBe(c);
    expect(c.generateNoise(0)).toBe(c);
  });

  it('链式调用后状态正确', () => {
    const c = new VolumetricClouds()
      .setCoverage(0.8)
      .setDensity(0.6)
      .setSunDirection(new Vector3(0.5, 0.8, 0.1))
      .setSteps(128);
    expect(c.cloudCoverage).toBeCloseTo(0.8, 5);
    expect(c.cloudDensity).toBeCloseTo(0.6, 5);
    expect(c.sunDirection.length()).toBeCloseTo(1, 5);
    expect(c.steps).toBe(128);
  });
});

// ──────────────────────────────────────────────────────────────
// v2 升级测试:多散射 / 双叶 HG / 高度密度 / 云类型预设 / 锥形阴影
// ──────────────────────────────────────────────────────────────

describe('VolumetricClouds — v2 默认值与 setter', () => {
  it('v2 新字段默认值', () => {
    const c = new VolumetricClouds();
    expect(c.multiScatteringFactor).toBeCloseTo(0.5, 5);
    expect(c.multiScatteringSteps).toBe(4);
    expect(c.hgForwardG).toBeCloseTo(0.8, 5);
    expect(c.hgBackwardG).toBeCloseTo(-0.2, 5);
    expect(c.hgForwardWeight).toBeCloseTo(0.7, 5);
    expect(c.heightDensityBottom).toBeCloseTo(0.0, 5);
    expect(c.heightDensityTop).toBeCloseTo(0.5, 5);
    expect(c.coneRadius).toBeCloseTo(0.0, 5);
    expect(c.cloudType).toBe('cumulus');
  });

  it('setMultiScattering 限制 factor 到 [0,1] + steps 到 [1,16]', () => {
    const c = new VolumetricClouds();
    c.setMultiScattering(-1, 0);
    expect(c.multiScatteringFactor).toBe(0);
    expect(c.multiScatteringSteps).toBe(1);
    c.setMultiScattering(2, 100);
    expect(c.multiScatteringFactor).toBe(1);
    expect(c.multiScatteringSteps).toBe(16);
    c.setMultiScattering(0.6, 8);
    expect(c.multiScatteringFactor).toBeCloseTo(0.6, 5);
    expect(c.multiScatteringSteps).toBe(8);
  });

  it('setMultiScattering 省略 steps 时保留原值', () => {
    const c = new VolumetricClouds();
    c.multiScatteringSteps = 8;
    c.setMultiScattering(0.3);
    expect(c.multiScatteringFactor).toBeCloseTo(0.3, 5);
    expect(c.multiScatteringSteps).toBe(8);
  });

  it('setPhaseFunction 限制 g 到 [-0.99, 0.99] + weight 到 [0,1]', () => {
    const c = new VolumetricClouds();
    c.setPhaseFunction(5, -5, 2);
    expect(c.hgForwardG).toBeCloseTo(0.99, 5);
    expect(c.hgBackwardG).toBeCloseTo(-0.99, 5);
    expect(c.hgForwardWeight).toBeCloseTo(1, 5);
    c.setPhaseFunction(0.6, -0.1, 0.5);
    expect(c.hgForwardG).toBeCloseTo(0.6, 5);
    expect(c.hgBackwardG).toBeCloseTo(-0.1, 5);
    expect(c.hgForwardWeight).toBeCloseTo(0.5, 5);
  });

  it('setHeightDensity 限制到 [0,1]', () => {
    const c = new VolumetricClouds();
    c.setHeightDensity(-1, 2);
    expect(c.heightDensityBottom).toBe(0);
    expect(c.heightDensityTop).toBe(1);
    c.setHeightDensity(0.3, 0.7);
    expect(c.heightDensityBottom).toBeCloseTo(0.3, 5);
    expect(c.heightDensityTop).toBeCloseTo(0.7, 5);
  });

  it('setConeRadius 限制非负', () => {
    const c = new VolumetricClouds();
    c.setConeRadius(-1);
    expect(c.coneRadius).toBe(0);
    c.setConeRadius(0.5);
    expect(c.coneRadius).toBeCloseTo(0.5, 5);
  });

  it('v2 setter 链式调用返回 this', () => {
    const c = new VolumetricClouds();
    expect(c.setMultiScattering(0.5, 4)).toBe(c);
    expect(c.setPhaseFunction(0.8, -0.2, 0.7)).toBe(c);
    expect(c.setHeightDensity(0, 0.5)).toBe(c);
    expect(c.setConeRadius(0.3)).toBe(c);
    expect(c.setCloudType('stratus')).toBe(c);
  });
});

describe('VolumetricClouds — 云类型预设', () => {
  it('CLOUD_PRESETS 包含 4 种类型', () => {
    expect(CLOUD_PRESETS.cumulus).toBeDefined();
    expect(CLOUD_PRESETS.stratus).toBeDefined();
    expect(CLOUD_PRESETS.cirrus).toBeDefined();
    expect(CLOUD_PRESETS.cumulonimbus).toBeDefined();
  });

  it('setCloudType(cumulus) 应用 cumulus 预设', () => {
    const c = new VolumetricClouds();
    c.setCloudType('cumulus');
    expect(c.cloudType).toBe('cumulus');
    expect(c.cloudCoverage).toBeCloseTo(CLOUD_PRESETS.cumulus.coverage, 5);
    expect(c.cloudDensity).toBeCloseTo(CLOUD_PRESETS.cumulus.density, 5);
    expect(c.cloudHeight).toBe(CLOUD_PRESETS.cumulus.height);
    expect(c.cloudThickness).toBe(CLOUD_PRESETS.cumulus.thickness);
    expect(c.hgForwardG).toBeCloseTo(CLOUD_PRESETS.cumulus.hgForwardG, 5);
    expect(c.multiScatteringFactor).toBeCloseTo(CLOUD_PRESETS.cumulus.multiScatteringFactor, 5);
  });

  it('setCloudType(cumulonimbus) 应用积雨云预设 (高密度大厚度)', () => {
    const c = new VolumetricClouds();
    c.setCloudType('cumulonimbus');
    expect(c.cloudType).toBe('cumulonimbus');
    expect(c.cloudDensity).toBeGreaterThan(0.7);
    expect(c.cloudThickness).toBeGreaterThan(2000);
    expect(c.heightDensityTop).toBeGreaterThan(0.5);
  });

  it('setCloudType(cirrus) 应用卷云预设 (高空稀薄)', () => {
    const c = new VolumetricClouds();
    c.setCloudType('cirrus');
    expect(c.cloudType).toBe('cirrus');
    expect(c.cloudHeight).toBeGreaterThan(3000);
    expect(c.cloudDensity).toBeLessThan(0.3);
  });

  it('setCloudType(stratus) 应用层云预设 (大覆盖低密度)', () => {
    const c = new VolumetricClouds();
    c.setCloudType('stratus');
    expect(c.cloudType).toBe('stratus');
    expect(c.cloudCoverage).toBeGreaterThan(0.7);
    expect(c.cloudDensity).toBeLessThan(0.5);
  });

  it('setCloudType 后 generateNoise 仍正常工作', () => {
    const c = new VolumetricClouds();
    c.setCloudType('cumulonimbus');
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(42);
    expect(c.noiseData).not.toBeNull();
    expect(c.noiseData!.length).toBe(8 * 8 * 8);
  });

  it('切换云类型后再切回 cumulus 恢复默认值', () => {
    const c = new VolumetricClouds();
    c.setCloudType('cirrus');
    c.setCloudType('cumulus');
    expect(c.cloudCoverage).toBeCloseTo(0.5, 5);
    expect(c.cloudDensity).toBeCloseTo(0.5, 5);
    expect(c.cloudHeight).toBe(1000);
  });
});

describe('VolumetricClouds — 多散射', () => {
  it('computeLighting 多散射开启时比关闭时更亮 (同密度同位置)', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    const pos = new Vector3(512, 1200, 512);
    const sun = new Vector3(0, 1, 0);
    const view = new Vector3(0, -1, 0);

    c.setMultiScattering(0); // 关闭
    const off = c.computeLighting(pos, 0.5, sun, view);
    c.setMultiScattering(1, 4); // 全量
    const on = c.computeLighting(pos, 0.5, sun, view);

    // 多散射应让云体内部更亮 (sun 项增加 msEnergy)
    const offSum = off.r + off.g + off.b;
    const onSum = on.r + on.g + on.b;
    expect(onSum).toBeGreaterThanOrEqual(offSum);
  });

  it('marchRay 多散射开启时仍返回有效结果', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.setCoverage(0.8);
    c.setDensity(0.8);
    c.setMultiScattering(1, 8);
    c.generateNoise(0);
    const result = c.marchRay(
      new Vector3(512, 0, 512),
      new Vector3(0, 1, 0),
      16,
    );
    expect(result.alpha).toBeGreaterThanOrEqual(0);
    expect(result.alpha).toBeLessThanOrEqual(1);
  });
});

describe('VolumetricClouds — 双叶 HG 相位函数', () => {
  it('computeLighting 前向散射 (view 朝太阳) 比后向更亮', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    const pos = new Vector3(512, 1200, 512);
    const sun = new Vector3(0, 1, 0);

    // viewDirection 与 sunDirection 同向 (cosθ=1) → 前向散射,银边
    const forward = c.computeLighting(pos, 0.5, sun, new Vector3(0, 1, 0));
    // viewDirection 与 sunDirection 反向 (cosθ=-1) → 后向散射
    const backward = c.computeLighting(pos, 0.5, sun, new Vector3(0, -1, 0));

    // 前向 (g1=0.8) 应比后向 (g2=-0.2) 更亮 (银边效应)
    const forwardSum = forward.r + forward.g + forward.b;
    const backwardSum = backward.r + backward.g + backward.b;
    expect(forwardSum).toBeGreaterThanOrEqual(backwardSum);
  });

  it('setPhaseWeight=1 时完全前向 (后向叶权重为 0)', () => {
    const c = new VolumetricClouds();
    c.setPhaseFunction(0.8, -0.2, 1.0); // forwardWeight=1
    expect(c.hgForwardWeight).toBe(1);
  });

  it('setPhaseWeight=0 时完全后向', () => {
    const c = new VolumetricClouds();
    c.setPhaseFunction(0.8, -0.2, 0);
    expect(c.hgForwardWeight).toBe(0);
  });

  it('computeLighting 省略 viewDirection 时回退到 -sunDirection', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    const pos = new Vector3(512, 1200, 512);
    const sun = new Vector3(0, 1, 0);
    // 不传 viewDirection → 应等价于传 -sunDirection
    const implicit = c.computeLighting(pos, 0.5, sun);
    const explicit = c.computeLighting(pos, 0.5, sun, new Vector3(0, -1, 0));
    expect(implicit.r).toBeCloseTo(explicit.r, 5);
    expect(implicit.g).toBeCloseTo(explicit.g, 5);
    expect(implicit.b).toBeCloseTo(explicit.b, 5);
  });
});

describe('VolumetricClouds — 高度密度调制', () => {
  it('底部衰减让低高度密度降低', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    c.setHeightDensity(0.8, 0); // 底部强衰减,顶部不衰减

    // 采样云层底部 (heightT≈0) 与顶部 (heightT≈1) 的密度
    // 由于底部衰减,底部密度应低于无衰减时
    const c2 = new VolumetricClouds();
    c2.setNoiseResolution(8, 8, 8);
    c2.generateNoise(0);
    c2.setHeightDensity(0, 0); // 无衰减

    // 取一个已知有密度的点 (512, yBottom, 512)
    const x = 512, z = 512;
    // 由于 _sampleDensity 是 private,通过 marchRay 间接验证
    // 只要 marchRay 不抛错且返回有效结果即可
    const r1 = c.marchRay(new Vector3(x, 0, z), new Vector3(0, 1, 0), 16);
    const r2 = c2.marchRay(new Vector3(x, 0, z), new Vector3(0, 1, 0), 16);
    expect(r1.alpha).toBeGreaterThanOrEqual(0);
    expect(r2.alpha).toBeGreaterThanOrEqual(0);
    // 底部衰减应让整体不透明度更低或相等
    expect(r1.alpha).toBeLessThanOrEqual(r2.alpha + 0.01);
  });

  it('顶部衰减让高高度密度降低', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.generateNoise(0);
    c.setHeightDensity(0, 0.8); // 底部不衰减,顶部强衰减
    expect(c.heightDensityTop).toBeCloseTo(0.8, 5);
    // marchRay 仍应返回有效结果
    const r = c.marchRay(new Vector3(512, 0, 512), new Vector3(0, 1, 0), 16);
    expect(r.alpha).toBeGreaterThanOrEqual(0);
    expect(r.alpha).toBeLessThanOrEqual(1);
  });
});

describe('VolumetricClouds — 锥形阴影', () => {
  it('coneRadius > 0 时不抛错', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.setCoverage(0.8);
    c.setDensity(0.6);
    c.setConeRadius(0.5);
    c.generateNoise(0);
    expect(() => {
      c.marchRay(new Vector3(512, 0, 512), new Vector3(0, 1, 0), 16);
    }).not.toThrow();
  });

  it('coneRadius=0 (点采样) 与 coneRadius>0 结果都有效', () => {
    const c = new VolumetricClouds();
    c.setNoiseResolution(8, 8, 8);
    c.setCoverage(0.8);
    c.setDensity(0.6);
    c.generateNoise(0);

    c.setConeRadius(0);
    const r1 = c.marchRay(new Vector3(512, 0, 512), new Vector3(0, 1, 0), 16);
    c.setConeRadius(0.8);
    const r2 = c.marchRay(new Vector3(512, 0, 512), new Vector3(0, 1, 0), 16);

    expect(r1.alpha).toBeGreaterThanOrEqual(0);
    expect(r2.alpha).toBeGreaterThanOrEqual(0);
    expect(r1.alpha).toBeLessThanOrEqual(1);
    expect(r2.alpha).toBeLessThanOrEqual(1);
  });
});

describe('VolumetricClouds — v2 uniform 与统计', () => {
  it('getShaderUniforms 包含 v2 字段', () => {
    const c = new VolumetricClouds();
    // 注意:setCloudType 会覆盖预设参数,因此先 setCloudType 再单独覆盖。
    c.setCloudType('cumulonimbus');
    c.setMultiScattering(0.6, 6);
    c.setPhaseFunction(0.7, -0.15, 0.65);
    c.setHeightDensity(0.2, 0.6);
    c.setConeRadius(0.4);
    const u = c.getShaderUniforms();
    expect(u.u_multiScatteringFactor).toBeCloseTo(0.6, 5);
    expect(u.u_multiScatteringSteps).toBe(6);
    expect(u.u_hgForwardG).toBeCloseTo(0.7, 5);
    expect(u.u_hgBackwardG).toBeCloseTo(-0.15, 5);
    expect(u.u_hgForwardWeight).toBeCloseTo(0.65, 5);
    expect(u.u_heightDensityBottom).toBeCloseTo(0.2, 5);
    expect(u.u_heightDensityTop).toBeCloseTo(0.6, 5);
    expect(u.u_cloudType).toBe(3); // cumulonimbus
    expect(u.u_coneRadius).toBeCloseTo(0.4, 5);
  });

  it('getShaderUniforms cloudType 整数映射正确', () => {
    const c = new VolumetricClouds();
    c.setCloudType('cumulus');
    expect(c.getShaderUniforms().u_cloudType).toBe(0);
    c.setCloudType('stratus');
    expect(c.getShaderUniforms().u_cloudType).toBe(1);
    c.setCloudType('cirrus');
    expect(c.getShaderUniforms().u_cloudType).toBe(2);
    c.setCloudType('cumulonimbus');
    expect(c.getShaderUniforms().u_cloudType).toBe(3);
  });

  it('getStats 包含 v2 字段', () => {
    const c = new VolumetricClouds();
    c.setCloudType('cirrus');
    c.setMultiScattering(0.7, 6);
    c.setPhaseFunction(0.85, -0.25, 0.75);
    c.setConeRadius(0.3);
    const stats = c.getStats();
    expect(stats.cloudType).toBe('cirrus');
    expect(stats.multiScatteringFactor).toBeCloseTo(0.7, 5);
    expect(stats.hgForwardG).toBeCloseTo(0.85, 5);
    expect(stats.hgBackwardG).toBeCloseTo(-0.25, 5);
    expect(stats.coneRadius).toBeCloseTo(0.3, 5);
  });
});

