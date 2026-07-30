import { describe, it, expect } from 'vitest';
import { FFTOcean } from './FFTOcean';
import { Vector3 } from '../Math/Vector3';

describe('FFTOcean', () => {
  describe('构造与默认值', () => {
    it('默认参数正确', () => {
      const o = new FFTOcean();
      expect(o.resolution).toBe(64);
      expect(o.physicalSize).toBe(100);
      expect(o.windSpeed).toBe(10);
      expect(o.waveAmplitude).toBe(1.0);
      expect(o.choppyFactor).toBe(1.0);
      expect(o.time).toBe(0);
    });

    it('构造时生成 h0 与 ht', () => {
      const o = new FFTOcean({ resolution: 16 });
      expect(o.h0).not.toBeNull();
      expect(o.h0!.length).toBe(2 * 16 * 16);
      expect(o.ht).not.toBeNull();
      expect(o.ht!.length).toBe(2 * 16 * 16);
    });

    it('应用构造选项', () => {
      const o = new FFTOcean({
        resolution: 32,
        physicalSize: 200,
        windSpeed: 15,
        waveAmplitude: 2,
        choppyFactor: 1.5,
        foamThreshold: 0.3,
        foamIntensity: 4,
        windDirection: { x: 0, z: 1 },
        deepWaterColor: { r: 0.1, g: 0.2, b: 0.3 },
        shallowWaterColor: { r: 0.4, g: 0.5, b: 0.6 },
        foamColor: { r: 0.9, g: 0.9, b: 0.9 },
        sunColor: { r: 1, g: 0.8, b: 0.6 },
        skyColor: { r: 0.3, g: 0.5, b: 0.7 },
      });
      expect(o.resolution).toBe(32);
      expect(o.physicalSize).toBe(200);
      expect(o.windSpeed).toBe(15);
      expect(o.waveAmplitude).toBe(2);
      expect(o.choppyFactor).toBe(1.5);
      expect(o.foamThreshold).toBe(0.3);
      expect(o.foamIntensity).toBe(4);
      expect(o.deepWaterColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
      expect(o.shallowWaterColor).toEqual({ r: 0.4, g: 0.5, b: 0.6 });
      expect(o.foamColor).toEqual({ r: 0.9, g: 0.9, b: 0.9 });
      expect(o.sunColor).toEqual({ r: 1, g: 0.8, b: 0.6 });
      expect(o.skyColor).toEqual({ r: 0.3, g: 0.5, b: 0.7 });
    });

    it('风向被归一化', () => {
      const o = new FFTOcean({ windDirection: { x: 3, z: 4 } });
      const len = Math.hypot(o.windDirection.x, o.windDirection.z);
      expect(len).toBeCloseTo(1, 6);
      expect(o.windDirection.x).toBeCloseTo(0.6, 6);
      expect(o.windDirection.z).toBeCloseTo(0.8, 6);
    });

    it('零风向退化为 +x', () => {
      const o = new FFTOcean({ windDirection: { x: 0, z: 0 } });
      expect(o.windDirection).toEqual({ x: 1, z: 0 });
    });

    it('sunDirection 默认为 Vector3', () => {
      const o = new FFTOcean();
      expect(o.sunDirection).toBeInstanceOf(Vector3);
    });
  });

  describe('分辨率钳制', () => {
    it('非 2 的幂钳制到最近的 2 的幂', () => {
      const o = new FFTOcean({ resolution: 100 });
      expect(o.resolution).toBe(128);
    });

    it('最小分辨率为 2', () => {
      const o = new FFTOcean({ resolution: 1 });
      expect(o.resolution).toBeGreaterThanOrEqual(2);
    });

    it('setResolution 重新分配缓冲', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.setResolution(16);
      expect(o.resolution).toBe(16);
      expect(o.h0!.length).toBe(2 * 16 * 16);
      expect(o.ht!.length).toBe(2 * 16 * 16);
      expect(o.time).toBe(0);
    });
  });

  describe('setter', () => {
    it('setPhysicalSize', () => {
      const o = new FFTOcean();
      o.setPhysicalSize(500);
      expect(o.physicalSize).toBe(500);
    });

    it('setPhysicalSize 下限保护', () => {
      const o = new FFTOcean();
      o.setPhysicalSize(-1);
      expect(o.physicalSize).toBeGreaterThan(0);
    });

    it('setWind 归一化方向', () => {
      const o = new FFTOcean();
      o.setWind(20, { x: 1, z: 1 });
      expect(o.windSpeed).toBe(20);
      const len = Math.hypot(o.windDirection.x, o.windDirection.z);
      expect(len).toBeCloseTo(1, 6);
    });

    it('setWaveAmplitude', () => {
      const o = new FFTOcean();
      o.setWaveAmplitude(3.5);
      expect(o.waveAmplitude).toBe(3.5);
    });

    it('setChoppy 下限保护', () => {
      const o = new FFTOcean();
      o.setChoppy(-1);
      expect(o.choppyFactor).toBe(0);
    });

    it('setFoamParams', () => {
      const o = new FFTOcean();
      o.setFoamParams(0.2, 5);
      expect(o.foamThreshold).toBe(0.2);
      expect(o.foamIntensity).toBe(5);
    });

    it('setWaterColors', () => {
      const o = new FFTOcean();
      o.setWaterColors({ r: 0.1, g: 0.2, b: 0.3 }, { r: 0.4, g: 0.5, b: 0.6 });
      expect(o.deepWaterColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
      expect(o.shallowWaterColor).toEqual({ r: 0.4, g: 0.5, b: 0.6 });
    });

    it('setFoamColor', () => {
      const o = new FFTOcean();
      o.setFoamColor({ r: 0.5, g: 0.5, b: 0.5 });
      expect(o.foamColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    });

    it('setSun', () => {
      const o = new FFTOcean();
      o.setSun({ x: 0, y: -1, z: 0 }, { r: 1, g: 1, b: 1 });
      expect(o.sunDirection.y).toBe(-1);
      expect(o.sunColor).toEqual({ r: 1, g: 1, b: 1 });
    });

    it('setSun 接受 Vector3', () => {
      const o = new FFTOcean();
      const v = new Vector3(1, 2, 3);
      o.setSun(v, { r: 0.5, g: 0.5, b: 0.5 });
      expect(o.sunDirection.x).toBe(1);
      expect(o.sunDirection.y).toBe(2);
      expect(o.sunDirection.z).toBe(3);
    });

    it('setSkyColor', () => {
      const o = new FFTOcean();
      o.setSkyColor({ r: 0.1, g: 0.2, b: 0.3 });
      expect(o.skyColor).toEqual({ r: 0.1, g: 0.2, b: 0.3 });
    });
  });

  describe('Phillips 频谱', () => {
    it('k=0 返回 0', () => {
      const o = new FFTOcean({ resolution: 8 });
      expect(o.phillipsSpectrum({ x: 0, z: 0 })).toBe(0);
    });

    it('沿风向有能量, 垂直风向无能量', () => {
      const o = new FFTOcean({ resolution: 8, windDirection: { x: 1, z: 0 } });
      const dk = (2 * Math.PI) / o.physicalSize;
      const kParallel = { x: dk, z: 0 };
      const kPerp = { x: 0, z: dk };
      const pPar = o.phillipsSpectrum(kParallel);
      const pPerp = o.phillipsSpectrum(kPerp);
      expect(pPar).toBeGreaterThan(0);
      expect(pPerp).toBe(0);
    });

    it('更大的 waveAmplitude 产生更大的频谱', () => {
      const o1 = new FFTOcean({ resolution: 8, waveAmplitude: 1 });
      const o2 = new FFTOcean({ resolution: 8, waveAmplitude: 10 });
      const k = { x: (2 * Math.PI) / o1.physicalSize, z: 0 };
      expect(o2.phillipsSpectrum(k)).toBeGreaterThan(o1.phillipsSpectrum(k));
    });

    it('返回值非负', () => {
      const o = new FFTOcean({ resolution: 8 });
      const dk = (2 * Math.PI) / o.physicalSize;
      for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
          expect(o.phillipsSpectrum({ x: i * dk, z: j * dk })).toBeGreaterThanOrEqual(0);
        }
      }
    });
  });

  describe('gaussianRandom', () => {
    it('产生有限数', () => {
      const o = new FFTOcean({ resolution: 8 });
      for (let i = 0; i < 100; i++) {
        const v = o.gaussianRandom();
        expect(Number.isFinite(v)).toBe(true);
      }
    });

    it('均值近似为 0 (统计性质)', () => {
      const o = new FFTOcean({ resolution: 8 });
      let sum = 0;
      const N = 10000;
      for (let i = 0; i < N; i++) sum += o.gaussianRandom();
      const mean = sum / N;
      // 大数定律, 均值应接近 0
      expect(Math.abs(mean)).toBeLessThan(0.1);
    });
  });

  describe('generateSpectrum', () => {
    it('生成 h0 并重置时间', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.time = 5;
      o.generateSpectrum();
      expect(o.time).toBe(0);
      expect(o.h0).not.toBeNull();
    });

    it('h0 含非零项 (有风有波)', () => {
      const o = new FFTOcean({ resolution: 16, windSpeed: 10, waveAmplitude: 1 });
      let nonZero = 0;
      for (let i = 0; i < o.h0!.length; i++) {
        if (o.h0![i] !== 0) nonZero++;
      }
      expect(nonZero).toBeGreaterThan(0);
    });

    it('h0 在风速 0 时除 k=0 外仍可能有小值, 但波幅为 0 时全 0', () => {
      const o = new FFTOcean({ resolution: 8, waveAmplitude: 0 });
      let nonZero = 0;
      for (let i = 0; i < o.h0!.length; i++) {
        if (o.h0![i] !== 0) nonZero++;
      }
      expect(nonZero).toBe(0);
    });
  });

  describe('FFT', () => {
    it('fft1D 正向变换:冲激 → 常数', () => {
      const o = new FFTOcean({ resolution: 8 });
      // 4 点复数冲激 [1+0i, 0, 0, 0]
      const data = new Float32Array([1, 0, 0, 0, 0, 0, 0, 0]);
      o.fft1D(data, false);
      // 正向 FFT of 冲激 → 全 1
      for (let i = 0; i < 4; i++) {
        expect(data[2 * i]).toBeCloseTo(1, 5);
        expect(data[2 * i + 1]).toBeCloseTo(0, 5);
      }
    });

    it('fft1D 逆变换:常数 → 冲激 (非归一化, N 倍)', () => {
      const o = new FFTOcean({ resolution: 8 });
      // 4 点常数 [1, 1, 1, 1]
      const data = new Float32Array([1, 0, 1, 0, 1, 0, 1, 0]);
      o.fft1D(data, true);
      // 逆变换 (非归一化) of 全 1 → [4, 0, 0, 0]
      expect(data[0]).toBeCloseTo(4, 5);
      expect(data[1]).toBeCloseTo(0, 5);
      for (let i = 1; i < 4; i++) {
        expect(data[2 * i]).toBeCloseTo(0, 5);
        expect(data[2 * i + 1]).toBeCloseTo(0, 5);
      }
    });

    it('fft1D 往返 = N·x (1D, 非归一化)', () => {
      const o = new FFTOcean({ resolution: 8 });
      const orig = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]); // 4 复数
      const data = orig.slice();
      o.fft1D(data, false);
      o.fft1D(data, true);
      // 往返 = N * orig, N=4
      for (let i = 0; i < 8; i++) {
        expect(data[i]).toBeCloseTo(4 * orig[i], 4);
      }
    });

    it('fft2D 往返 = N²·x (2D, 非归一化)', () => {
      const o = new FFTOcean({ resolution: 4 });
      const n = 4;
      const orig = new Float32Array(2 * n * n);
      for (let i = 0; i < orig.length; i++) orig[i] = (i % 7) - 3;
      const data = orig.slice();
      o.fft2D(data, false);
      o.fft2D(data, true);
      for (let i = 0; i < orig.length; i++) {
        expect(data[i]).toBeCloseTo(n * n * orig[i], 2);
      }
    });

    it('computeIFFT 调用后 ht 实部为高度场', () => {
      const o = new FFTOcean({ resolution: 16 });
      o.updateSpectrum(1.0);
      o.computeIFFT();
      // ht 实部应含有限值 (高度场)
      let hasFinite = false;
      for (let i = 0; i < o.ht!.length; i += 2) {
        if (Number.isFinite(o.ht![i])) {
          hasFinite = true;
          break;
        }
      }
      expect(hasFinite).toBe(true);
    });
  });

  describe('computeDisplacement', () => {
    it('生成位移图, 长度 3·N·N', () => {
      const o = new FFTOcean({ resolution: 16 });
      o.updateSpectrum(1.0);
      o.computeDisplacement();
      expect(o.displacementMap).not.toBeNull();
      expect(o.displacementMap!.length).toBe(3 * 16 * 16);
    });

    it('位移值有限', () => {
      const o = new FFTOcean({ resolution: 16 });
      o.updateSpectrum(1.0);
      o.computeDisplacement();
      for (let i = 0; i < o.displacementMap!.length; i++) {
        expect(Number.isFinite(o.displacementMap![i])).toBe(true);
      }
    });

    it('choppy=0 时水平位移为 0', () => {
      const o = new FFTOcean({ resolution: 16, choppyFactor: 0 });
      o.updateSpectrum(1.0);
      o.computeDisplacement();
      // dx (分量 0) 与 dz (分量 2) 应全为 0
      for (let i = 0; i < 16 * 16; i++) {
        expect(o.displacementMap![3 * i]).toBeCloseTo(0, 6);
        expect(o.displacementMap![3 * i + 2]).toBeCloseTo(0, 6);
      }
      // 高度 (分量 1) 应有非零
      let nonZeroH = false;
      for (let i = 0; i < 16 * 16; i++) {
        if (Math.abs(o.displacementMap![3 * i + 1]) > 1e-6) {
          nonZeroH = true;
          break;
        }
      }
      expect(nonZeroH).toBe(true);
    });

    it('无 h0 时安全返回', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.dispose();
      expect(o.computeDisplacement()).toBe(o);
    });
  });

  describe('computeNormals', () => {
    it('生成法线图, 长度 3·N·N', () => {
      const o = new FFTOcean({ resolution: 16 });
      o.update(0.1);
      expect(o.normalMap).not.toBeNull();
      expect(o.normalMap!.length).toBe(3 * 16 * 16);
    });

    it('法线归一化 (长度 1)', () => {
      const o = new FFTOcean({ resolution: 16, choppyFactor: 0.5 });
      o.update(0.5);
      for (let i = 0; i < 16 * 16; i++) {
        const nx = o.normalMap![3 * i];
        const ny = o.normalMap![3 * i + 1];
        const nz = o.normalMap![3 * i + 2];
        const len = Math.hypot(nx, ny, nz);
        expect(len).toBeCloseTo(1, 4);
      }
    });

    it('平静海面 (无风无波) 法线接近 +y', () => {
      const o = new FFTOcean({ resolution: 16, waveAmplitude: 0 });
      o.update(0.1);
      for (let i = 0; i < 16 * 16; i++) {
        expect(o.normalMap![3 * i + 1]).toBeCloseTo(1, 4);
      }
    });

    it('无位移图时安全返回', () => {
      const o = new FFTOcean({ resolution: 8 });
      expect(o.computeNormals()).toBe(o);
      expect(o.normalMap).toBeNull();
    });
  });

  describe('computeFoam', () => {
    it('生成泡沫图, 长度 N·N', () => {
      const o = new FFTOcean({ resolution: 16 });
      o.update(0.1);
      expect(o.foamMap).not.toBeNull();
      expect(o.foamMap!.length).toBe(16 * 16);
    });

    it('泡沫值在 [0, 1] 范围内', () => {
      const o = new FFTOcean({ resolution: 16, choppyFactor: 2 });
      o.update(0.5);
      for (let i = 0; i < o.foamMap!.length; i++) {
        expect(o.foamMap![i]).toBeGreaterThanOrEqual(0);
        expect(o.foamMap![i]).toBeLessThanOrEqual(1);
      }
    });

    it('平静海面无泡沫', () => {
      const o = new FFTOcean({ resolution: 16, waveAmplitude: 0 });
      o.update(0.1);
      for (let i = 0; i < o.foamMap!.length; i++) {
        expect(o.foamMap![i]).toBeCloseTo(0, 6);
      }
    });

    it('无位移图时安全返回', () => {
      const o = new FFTOcean({ resolution: 8 });
      expect(o.computeFoam()).toBe(o);
      expect(o.foamMap).toBeNull();
    });
  });

  describe('update', () => {
    it('推进时间并生成所有图', () => {
      const o = new FFTOcean({ resolution: 16 });
      o.update(0.5);
      expect(o.time).toBeCloseTo(0.5, 6);
      expect(o.displacementMap).not.toBeNull();
      expect(o.normalMap).not.toBeNull();
      expect(o.foamMap).not.toBeNull();
    });

    it('负 dt 被钳制为 0', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.update(-1);
      expect(o.time).toBe(0);
    });

    it('多次 update 时间累加', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.update(0.1);
      o.update(0.2);
      expect(o.time).toBeCloseTo(0.3, 6);
    });

    it('h0 为 null 时自动生成', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.dispose();
      o.update(0.1);
      expect(o.h0).not.toBeNull();
      expect(o.displacementMap).not.toBeNull();
    });

    it('不同时间产生不同高度场', () => {
      const o = new FFTOcean({ resolution: 16, windSpeed: 10 });
      o.update(0.0);
      const h0 = o.displacementMap!.slice();
      o.update(1.0);
      const h1 = o.displacementMap!;
      let diff = false;
      for (let i = 0; i < h0.length; i++) {
        if (Math.abs(h0[i] - h1[i]) > 1e-6) {
          diff = true;
          break;
        }
      }
      expect(diff).toBe(true);
    });
  });

  describe('数据访问', () => {
    it('getDisplacementMap 返回内部引用', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.update(0.1);
      expect(o.getDisplacementMap()).toBe(o.displacementMap);
    });

    it('getNormalMap 返回内部引用', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.update(0.1);
      expect(o.getNormalMap()).toBe(o.normalMap);
    });

    it('getFoamMap 返回内部引用', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.update(0.1);
      expect(o.getFoamMap()).toBe(o.foamMap);
    });
  });

  describe('getShaderUniforms', () => {
    it('返回所有 uniform 字段', () => {
      const o = new FFTOcean({ resolution: 16 });
      o.update(0.5);
      const u = o.getShaderUniforms();
      expect(u.u_resolution).toBe(16);
      expect(u.u_physicalSize).toBe(100);
      expect(u.u_windSpeed).toBe(10);
      expect(u.u_waveAmplitude).toBe(1.0);
      expect(u.u_choppyFactor).toBe(1.0);
      expect(u.u_time).toBeCloseTo(0.5, 6);
      expect(u.u_windDirection).toHaveLength(2);
      expect(u.u_deepWaterColor).toHaveLength(3);
      expect(u.u_shallowWaterColor).toHaveLength(3);
      expect(u.u_foamColor).toHaveLength(3);
      expect(u.u_sunDirection).toHaveLength(3);
      expect(u.u_sunColor).toHaveLength(3);
      expect(u.u_skyColor).toHaveLength(3);
      expect(u.u_displacementMap.data).toBe(o.displacementMap);
      expect(u.u_displacementMap.resolution).toBe(16);
      expect(u.u_displacementMap.components).toBe(3);
      expect(u.u_normalMap.data).toBe(o.normalMap);
      expect(u.u_normalMap.components).toBe(3);
      expect(u.u_foamMap.data).toBe(o.foamMap);
      expect(u.u_foamMap.components).toBe(1);
    });

    it('uniform 反映 setter 修改', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.setWind(20, { x: 0, z: 1 });
      o.setChoppy(2);
      const u = o.getShaderUniforms();
      expect(u.u_windSpeed).toBe(20);
      expect(u.u_windDirection[0]).toBeCloseTo(0, 6);
      expect(u.u_windDirection[1]).toBeCloseTo(1, 6);
      expect(u.u_choppyFactor).toBe(2);
    });
  });

  describe('getStats', () => {
    it('返回统计信息', () => {
      const o = new FFTOcean({ resolution: 16 });
      o.update(0.5);
      const s = o.getStats();
      expect(s.resolution).toBe(16);
      expect(s.physicalSize).toBe(100);
      expect(s.windSpeed).toBe(10);
      expect(s.time).toBeCloseTo(0.5, 6);
      expect(s.h0Generated).toBe(true);
      expect(s.htGenerated).toBe(true);
      expect(s.displacementGenerated).toBe(true);
      expect(s.normalGenerated).toBe(true);
      expect(s.foamGenerated).toBe(true);
      expect(s.memoryBytes).toBeGreaterThan(0);
    });

    it('dispose 后统计反映已释放', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.update(0.1);
      o.dispose();
      const s = o.getStats();
      expect(s.h0Generated).toBe(false);
      expect(s.displacementGenerated).toBe(false);
      expect(s.memoryBytes).toBe(0);
      expect(s.time).toBe(0);
    });

    it('memoryBytes 随分辨率增大', () => {
      const o16 = new FFTOcean({ resolution: 16 });
      o16.update(0.1);
      const o32 = new FFTOcean({ resolution: 32 });
      o32.update(0.1);
      expect(o32.getStats().memoryBytes).toBeGreaterThan(o16.getStats().memoryBytes);
    });
  });

  describe('dispose', () => {
    it('释放所有缓冲', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.update(0.1);
      o.dispose();
      expect(o.h0).toBeNull();
      expect(o.ht).toBeNull();
      expect(o.displacementMap).toBeNull();
      expect(o.normalMap).toBeNull();
      expect(o.foamMap).toBeNull();
      expect(o.time).toBe(0);
    });

    it('dispose 后可重新 update', () => {
      const o = new FFTOcean({ resolution: 8 });
      o.dispose();
      o.update(0.1);
      expect(o.displacementMap).not.toBeNull();
      expect(o.h0).not.toBeNull();
    });
  });

  describe('物理合理性', () => {
    it('风速越大平均波高越大', () => {
      const oLow = new FFTOcean({ resolution: 32, windSpeed: 5, waveAmplitude: 1 });
      const oHigh = new FFTOcean({ resolution: 32, windSpeed: 20, waveAmplitude: 1 });
      oLow.update(1.0);
      oHigh.update(1.0);
      let sumLow = 0;
      let sumHigh = 0;
      const n = 32 * 32;
      for (let i = 0; i < n; i++) {
        sumLow += Math.abs(oLow.displacementMap![3 * i + 1]);
        sumHigh += Math.abs(oHigh.displacementMap![3 * i + 1]);
      }
      // 大风应产生更大的平均波高
      expect(sumHigh).toBeGreaterThan(sumLow);
    });

    it('波幅越大平均波高越大', () => {
      const o1 = new FFTOcean({ resolution: 32, waveAmplitude: 1 });
      const o2 = new FFTOcean({ resolution: 32, waveAmplitude: 5 });
      o1.update(1.0);
      o2.update(1.0);
      let sum1 = 0;
      let sum2 = 0;
      const n = 32 * 32;
      for (let i = 0; i < n; i++) {
        sum1 += Math.abs(o1.displacementMap![3 * i + 1]);
        sum2 += Math.abs(o2.displacementMap![3 * i + 1]);
      }
      expect(sum2).toBeGreaterThan(sum1);
    });

    it('高度场高度有限且合理 (米级)', () => {
      const o = new FFTOcean({ resolution: 64, windSpeed: 10, waveAmplitude: 1 });
      o.update(2.0);
      let maxAbs = 0;
      for (let i = 0; i < 64 * 64; i++) {
        const h = Math.abs(o.displacementMap![3 * i + 1]);
        if (h > maxAbs) maxAbs = h;
      }
      // 10 m/s 风, 波高应在合理范围 (小于 100 米)
      expect(maxAbs).toBeLessThan(100);
      expect(maxAbs).toBeGreaterThan(0);
    });
  });
});
