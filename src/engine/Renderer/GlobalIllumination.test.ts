// GlobalIllumination 单元测试。
//
// 覆盖:
//   1. 构造默认值
//   2. addProbe / removeProbe / getProbeCount
//   3. setMode / setEnabled
//   4. computeSH:9 个 SH2 系数,RGB 三通道,长度 27
//   5. evaluateSH:与 computeSH 互逆(同向同色近似还原)
//   6. updateProbes:scene 含 AmbientLight / DirectionalLight 后系数非零
//   7. sampleIrradiance:在探针附近采样得到非零辐照度
//   8. getShaderUniforms:格式正确(header + per-probe 32 floats)
//   9. setVoxelData + voxelResolution
//  10. dispose 后状态清零

import { describe, it, expect } from 'vitest';
import {
  GlobalIllumination,
  computeSH,
  evaluateSH,
  MAX_GI_PROBES,
  SH2_COEFF_COUNT,
  SH2_RGB_FLOATS,
} from './GlobalIllumination';
import { Vector3 } from '../Math/Vector3';
import { Scene } from '../Core/Scene';
import { AmbientLight, DirectionalLight, PointLight } from '../Lights';

describe('GlobalIllumination construction', () => {
  it('defaults: disabled, off mode, empty probes', () => {
    const gi = new GlobalIllumination();
    expect(gi.giEnabled).toBe(false);
    expect(gi.giMode).toBe('off');
    expect(gi.lightProbes).toEqual([]);
    expect(gi.voxelResolution).toBe(64);
    expect(gi.voxelData).toBeNull();
    expect(gi.irradianceMap).toBeNull();
    expect(gi.bounceCount).toBe(1);
  });
});

describe('GlobalIllumination probe management', () => {
  it('addProbe returns index and increments count', () => {
    const gi = new GlobalIllumination();
    const idx = gi.addProbe(new Vector3(1, 2, 3));
    expect(idx).toBe(0);
    expect(gi.getProbeCount()).toBe(1);
    expect(gi.lightProbes[0].position.x).toBe(1);
    expect(gi.lightProbes[0].position.y).toBe(2);
    expect(gi.lightProbes[0].position.z).toBe(3);
    expect(gi.lightProbes[0].coefficients.length).toBe(SH2_RGB_FLOATS);
    expect(gi.lightProbes[0].intensity).toBe(1.0);
  });

  it('addProbe respects MAX_GI_PROBES', () => {
    const gi = new GlobalIllumination();
    for (let i = 0; i < MAX_GI_PROBES; i++) {
      gi.addProbe(new Vector3(i, 0, 0));
    }
    expect(gi.getProbeCount()).toBe(MAX_GI_PROBES);
    const idx = gi.addProbe(new Vector3(100, 0, 0));
    expect(idx).toBe(-1);
    expect(gi.getProbeCount()).toBe(MAX_GI_PROBES);
  });

  it('removeProbe by index', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    gi.addProbe(new Vector3(1, 0, 0));
    expect(gi.removeProbe(0)).toBe(true);
    expect(gi.getProbeCount()).toBe(1);
    expect(gi.lightProbes[0].position.x).toBe(1);
  });

  it('removeProbe out-of-range returns false', () => {
    const gi = new GlobalIllumination();
    expect(gi.removeProbe(-1)).toBe(false);
    expect(gi.removeProbe(0)).toBe(false);
    expect(gi.removeProbe(99)).toBe(false);
  });
});

describe('GlobalIllumination setMode / setEnabled', () => {
  it('setMode switches mode', () => {
    const gi = new GlobalIllumination();
    gi.setMode('lightprobes');
    expect(gi.giMode).toBe('lightprobes');
    gi.setMode('vxgi');
    expect(gi.giMode).toBe('vxgi');
    expect(gi.voxelData).not.toBeNull();
    expect(gi.voxelData!.length).toBe(64 * 64 * 64 * 4);
    gi.setMode('off');
    expect(gi.giMode).toBe('off');
  });

  it('setEnabled toggles flag', () => {
    const gi = new GlobalIllumination();
    gi.setEnabled(true);
    expect(gi.giEnabled).toBe(true);
    gi.setEnabled(false);
    expect(gi.giEnabled).toBe(false);
  });
});

describe('computeSH', () => {
  it('produces 27 floats (9 coeffs * 3 RGB)', () => {
    const sh = computeSH(new Vector3(0, 1, 0), { r: 1, g: 1, b: 1 });
    expect(sh.length).toBe(SH2_RGB_FLOATS);
    expect(SH2_COEFF_COUNT).toBe(9);
  });

  it('Y00 coefficient is non-zero for any direction', () => {
    const sh = computeSH(new Vector3(0, 1, 0), { r: 1, g: 0, b: 0 });
    // c[0] = r * Y00 = 1 * 0.282095
    expect(sh[0]).toBeCloseTo(0.282095, 5);
    expect(sh[1]).toBeCloseTo(0, 5); // g=0
    expect(sh[2]).toBeCloseTo(0, 5); // b=0
  });

  it('Y10 coefficient is non-zero when direction is +Z', () => {
    const sh = computeSH(new Vector3(0, 0, 1), { r: 1, g: 1, b: 1 });
    // Y10 = 0.488603 * z = 0.488603, coefficients index 6,7,8
    expect(sh[6]).toBeCloseTo(0.488603, 5);
    expect(sh[7]).toBeCloseTo(0.488603, 5);
    expect(sh[8]).toBeCloseTo(0.488603, 5);
  });

  it('returns zero coefficients for zero color', () => {
    const sh = computeSH(new Vector3(1, 0, 0), { r: 0, g: 0, b: 0 });
    for (let i = 0; i < sh.length; i++) {
      expect(sh[i]).toBe(0);
    }
  });

  it('normalizes direction (longer vector gives same result)', () => {
    const sh1 = computeSH(new Vector3(0, 1, 0), { r: 1, g: 1, b: 1 });
    const sh2 = computeSH(new Vector3(0, 100, 0), { r: 1, g: 1, b: 1 });
    for (let i = 0; i < sh1.length; i++) {
      expect(sh1[i]).toBeCloseTo(sh2[i], 5);
    }
  });
});

describe('evaluateSH', () => {
  it('returns zero for empty coefficients', () => {
    const empty = new Float32Array(SH2_RGB_FLOATS);
    const result = evaluateSH(empty, new Vector3(0, 1, 0));
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('returns zero for too-short coefficients', () => {
    const short = new Float32Array(3);
    const result = evaluateSH(short, new Vector3(0, 1, 0));
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('ambient-only SH evaluates constant in all directions', () => {
    // Pure ambient: only Y00 coefficient set
    const sh = new Float32Array(SH2_RGB_FLOATS);
    sh[0] = 0.5; sh[1] = 0.5; sh[2] = 0.5; // Y00 RGB
    const r1 = evaluateSH(sh, new Vector3(0, 1, 0));
    const r2 = evaluateSH(sh, new Vector3(1, 0, 0));
    const r3 = evaluateSH(sh, new Vector3(0, 0, 1));
    // All directions should give the same ambient value
    expect(r1.r).toBeCloseTo(r2.r, 5);
    expect(r2.r).toBeCloseTo(r3.r, 5);
    expect(r1.r).toBeCloseTo(0.5 * 0.282095, 5);
  });

  it('normalizes normal vector', () => {
    const sh = computeSH(new Vector3(0, 1, 0), { r: 1, g: 1, b: 1 });
    const r1 = evaluateSH(sh, new Vector3(0, 1, 0));
    const r2 = evaluateSH(sh, new Vector3(0, 100, 0));
    expect(r1.r).toBeCloseTo(r2.r, 5);
  });
});

describe('GlobalIllumination updateProbes', () => {
  it('bakes ambient light into probe coefficients', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    const scene = new Scene();
    const ambient = new AmbientLight(0xffffff, 1.0);
    // _collectLights 通过 userData['__light'] 发现光源
    scene.userData['__light'] = ambient;

    gi.updateProbes(scene);

    // Y00 系数应非零(ambient 贡献)
    expect(gi.lightProbes[0].coefficients[0]).not.toBe(0);
    expect(gi.lightProbes[0].coefficients[1]).not.toBe(0);
    expect(gi.lightProbes[0].coefficients[2]).not.toBe(0);
  });

  it('bakes directional light into probe coefficients', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    const scene = new Scene();
    const dir = new DirectionalLight(0xffffff, 1.0, { x: 0, y: -1, z: 0 });
    scene.userData['__light'] = dir;

    gi.updateProbes(scene);

    // DirectionalLight 应贡献到 SH 系数(非 Y00 项)
    let nonZero = 0;
    for (let i = 0; i < gi.lightProbes[0].coefficients.length; i++) {
      if (gi.lightProbes[0].coefficients[i] !== 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
  });

  it('bakes point light with distance attenuation', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    const scene = new Scene();
    const point = new PointLight(0xffffff, 1.0);
    point.position.set(2, 0, 0);
    scene.userData['__light'] = point;

    gi.updateProbes(scene);

    // 探针在原点,PointLight 在 (2,0,0),衰减后非零
    expect(gi.lightProbes[0].coefficients[0]).not.toBe(0);
  });

  it('applies probe intensity multiplier', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    gi.lightProbes[0].intensity = 2.0;
    const scene = new Scene();
    const ambient = new AmbientLight(0xffffff, 1.0);
    scene.userData['__light'] = ambient;

    gi.updateProbes(scene);

    // intensity=2 应该让系数翻倍(与 intensity=1 比较)
    const gi2 = new GlobalIllumination();
    gi2.addProbe(new Vector3(0, 0, 0));
    gi2.updateProbes(scene);

    const ratio = gi.lightProbes[0].coefficients[0] / gi2.lightProbes[0].coefficients[0];
    expect(ratio).toBeCloseTo(2.0, 3);
  });

  it('no-op when no probes', () => {
    const gi = new GlobalIllumination();
    const scene = new Scene();
    expect(() => gi.updateProbes(scene)).not.toThrow();
  });
});

describe('GlobalIllumination sampleIrradiance', () => {
  it('returns zero when disabled', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    const result = gi.sampleIrradiance(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
  });

  it('returns non-zero when enabled and probe has baked coefficients', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    gi.setEnabled(true);
    gi.setMode('lightprobes');
    const scene = new Scene();
    scene.userData['__light'] = new AmbientLight(0xffffff, 1.0);
    gi.updateProbes(scene);

    const result = gi.sampleIrradiance(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    // ambient 贡献应非零
    expect(Math.abs(result.r) + Math.abs(result.g) + Math.abs(result.b)).toBeGreaterThan(0);
  });

  it('uses nearest probe', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    gi.addProbe(new Vector3(100, 0, 0));
    gi.setEnabled(true);
    gi.setMode('lightprobes');
    // 仅给第二个探针设置非零系数
    gi.lightProbes[1].coefficients[0] = 1.0;
    gi.lightProbes[1].coefficients[1] = 1.0;
    gi.lightProbes[1].coefficients[2] = 1.0;

    // 在第一个探针附近采样,应得到 0(用了第一个探针的零系数)
    const r1 = gi.sampleIrradiance(new Vector3(0.1, 0, 0), new Vector3(0, 1, 0));
    expect(r1.r).toBe(0);

    // 在第二个探针附近采样,应得到非零
    const r2 = gi.sampleIrradiance(new Vector3(99.9, 0, 0), new Vector3(0, 1, 0));
    expect(r2.r).not.toBe(0);
  });
});

describe('GlobalIllumination getShaderUniforms', () => {
  it('returns empty array when disabled', () => {
    const gi = new GlobalIllumination();
    const u = gi.getShaderUniforms();
    expect(u.length).toBe(0);
  });

  it('returns empty array when mode is off even if enabled', () => {
    const gi = new GlobalIllumination();
    gi.setEnabled(true);
    const u = gi.getShaderUniforms();
    expect(u.length).toBe(0);
  });

  it('returns header + per-probe floats when enabled', () => {
    const gi = new GlobalIllumination();
    gi.setEnabled(true);
    gi.setMode('lightprobes');
    gi.addProbe(new Vector3(1, 2, 3));
    gi.addProbe(new Vector3(4, 5, 6));

    const u = gi.getShaderUniforms();
    // header(4) + 2 * per-probe(32) = 68
    expect(u.length).toBe(4 + 2 * 32);
    expect(u[0]).toBe(2); // probe count
    expect(u[1]).toBe(1); // mode = lightprobes = 1
    // probe 0 position
    expect(u[4]).toBe(1);
    expect(u[5]).toBe(2);
    expect(u[6]).toBe(3);
    // probe 1 position
    expect(u[4 + 32]).toBe(4);
    expect(u[4 + 32 + 1]).toBe(5);
    expect(u[4 + 32 + 2]).toBe(6);
  });

  it('encodes vxgi mode as 2', () => {
    const gi = new GlobalIllumination();
    gi.setEnabled(true);
    gi.setMode('vxgi');
    gi.addProbe(new Vector3(0, 0, 0));
    const u = gi.getShaderUniforms();
    expect(u[1]).toBe(2);
  });
});

describe('GlobalIllumination setVoxelData', () => {
  it('sets voxel data and resolution', () => {
    const gi = new GlobalIllumination();
    const res = 8;
    const data = new Float32Array(res * res * res * 4);
    gi.setVoxelData(data, res);
    expect(gi.voxelData).toBe(data);
    expect(gi.voxelResolution).toBe(res);
  });

  it('throws on size mismatch', () => {
    const gi = new GlobalIllumination();
    const bad = new Float32Array(10);
    expect(() => gi.setVoxelData(bad, 8)).toThrow(/expected/);
  });
});

describe('GlobalIllumination dispose', () => {
  it('clears all state', () => {
    const gi = new GlobalIllumination();
    gi.addProbe(new Vector3(0, 0, 0));
    gi.setEnabled(true);
    gi.setMode('lightprobes');
    gi.dispose();
    expect(gi.lightProbes).toEqual([]);
    expect(gi.voxelData).toBeNull();
    expect(gi.irradianceMap).toBeNull();
    expect(gi.giEnabled).toBe(false);
    expect(gi.giMode).toBe('off');
  });

  it('is idempotent', () => {
    const gi = new GlobalIllumination();
    gi.dispose();
    expect(() => gi.dispose()).not.toThrow();
  });
});
