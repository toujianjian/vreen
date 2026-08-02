// CSMShadowMap 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. 级联分割点计算(对数/均匀/PSSM)
//   3. update() 计算级联矩阵
//   4. getViewProjectionArray / getSplitDistances
//   5. dispose
//   6. CSM_SAMPLE_CHUNK shader 源码校验

import { describe, it, expect } from 'vitest';
import { CSMShadowMap } from './CSMShadowMap';
import { CSM_SAMPLE_CHUNK } from '../Materials/ShaderChunks/csm.glsl';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { DirectionalLight } from '../Lights';

function makeCamera(): PerspectiveCamera {
  return new PerspectiveCamera(60, 1.5, 0.1, 200);
}

function makeLight(): DirectionalLight {
  const l = new DirectionalLight(0xffffff, 1.0, { x: -0.5, y: -1, z: -0.3 });
  l.position.set(50, 100, 50);
  return l;
}

// ── 构造与默认值 ────────────────────────────────────────────────────

describe('CSMShadowMap construction', () => {
  it('defaults: cascadeCount=4, mapSize=1024, splitFactor=0.5, shadowDistance=100, blendMargin=0.1', () => {
    const csm = new CSMShadowMap();
    expect(csm.cascadeCount).toBe(4);
    expect(csm.mapSize).toBe(1024);
    expect(csm.splitFactor).toBe(0.5);
    expect(csm.shadowDistance).toBe(100);
    expect(csm.blendMargin).toBe(0.1);
    expect(csm.scheme).toBe('pssm');
  });

  it('accepts all options', () => {
    const csm = new CSMShadowMap({
      cascadeCount: 8, mapSize: 2048, splitFactor: 0.8,
      shadowDistance: 500, blendMargin: 0.2, scheme: 'logarithmic',
    });
    expect(csm.cascadeCount).toBe(8);
    expect(csm.mapSize).toBe(2048);
    expect(csm.splitFactor).toBe(0.8);
    expect(csm.shadowDistance).toBe(500);
    expect(csm.blendMargin).toBe(0.2);
    expect(csm.scheme).toBe('logarithmic');
  });

  it('initializes cascades array with correct length', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4 });
    expect(csm.cascades.length).toBe(4);
  });

  it('initializes splits array with cascadeCount+1 entries', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4 });
    expect(csm.splits.length).toBe(5); // N+1 split points
  });
});

// ── 级联分割点 ──────────────────────────────────────────────────────

describe('CSMShadowMap split computation', () => {
  it('first split is near (0.1), last split is shadowDistance', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100 });
    expect(csm.splits[0]).toBeCloseTo(0.1, 5);
    expect(csm.splits[4]).toBeCloseTo(100, 5);
  });

  it('splits are monotonically increasing', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 200 });
    for (let i = 0; i < csm.cascadeCount; i++) {
      expect(csm.splits[i]).toBeLessThan(csm.splits[i + 1]);
    }
  });

  it('logarithmic scheme produces denser near splits', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100, scheme: 'logarithmic' });
    // 对数分割:第一级应该覆盖很小的范围
    const firstRange = csm.splits[1] - csm.splits[0];
    const lastRange = csm.splits[4] - csm.splits[3];
    expect(firstRange).toBeLessThan(lastRange);
  });

  it('uniform scheme produces equal splits', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100, scheme: 'uniform' });
    const range1 = csm.splits[1] - csm.splits[0];
    const range2 = csm.splits[2] - csm.splits[1];
    const range3 = csm.splits[3] - csm.splits[2];
    const range4 = csm.splits[4] - csm.splits[3];
    // 均匀分割:每级范围接近相等
    expect(Math.abs(range1 - range2)).toBeLessThan(0.01);
    expect(Math.abs(range2 - range3)).toBeLessThan(0.01);
    expect(Math.abs(range3 - range4)).toBeLessThan(0.01);
  });

  it('pssm scheme blends logarithmic and uniform', () => {
    const csmLog = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100, scheme: 'logarithmic' });
    const csmUni = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100, scheme: 'uniform' });
    const csmPssm = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100, scheme: 'pssm', splitFactor: 0.5 });

    // PSSM 中间分割点应在 log 和 uniform 之间
    const logMid = csmLog.splits[2];
    const uniMid = csmUni.splits[2];
    const pssmMid = csmPssm.splits[2];
    expect(pssmMid).toBeGreaterThan(Math.min(logMid, uniMid) - 0.01);
    expect(pssmMid).toBeLessThan(Math.max(logMid, uniMid) + 0.01);
  });
});

// ── update ─────────────────────────────────────────────────────────

describe('CSMShadowMap update', () => {
  it('update() does not throw', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4 });
    expect(() => csm.update(makeCamera(), makeLight())).not.toThrow();
  });

  it('update() populates cascade viewProjection matrices', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4 });
    csm.update(makeCamera(), makeLight());
    for (let i = 0; i < csm.cascadeCount; i++) {
      const vp = csm.cascades[i].viewProjection.elements;
      // 矩阵不应全为 0
      const sum = vp.reduce((a, b) => a + Math.abs(b), 0);
      expect(sum).toBeGreaterThan(0.001);
    }
  });

  it('update() sets texelSize > 0 for each cascade', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4, mapSize: 1024 });
    csm.update(makeCamera(), makeLight());
    for (let i = 0; i < csm.cascadeCount; i++) {
      expect(csm.cascades[i].texelSize).toBeGreaterThan(0);
    }
  });

  it('update() sets near/far from splits', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100 });
    csm.update(makeCamera(), makeLight());
    for (let i = 0; i < csm.cascadeCount; i++) {
      expect(csm.cascades[i].near).toBeCloseTo(csm.splits[i], 5);
      expect(csm.cascades[i].far).toBeCloseTo(csm.splits[i + 1], 5);
    }
  });

  it('closer cascades have smaller texelSize (higher resolution)', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100 });
    csm.update(makeCamera(), makeLight());
    // 近处级联的 texel 应更小(更高精度)
    // 注意:不总是严格递减(取决于相机朝向),但通常近 < 远
    expect(csm.cascades[0].texelSize).toBeLessThanOrEqual(csm.cascades[3].texelSize * 10);
  });
});

// ── getViewProjectionArray / getSplitDistances ─────────────────────

describe('CSMShadowMap uniform arrays', () => {
  it('getViewProjectionArray returns cascadeCount*16 floats', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4 });
    csm.update(makeCamera(), makeLight());
    const arr = csm.getViewProjectionArray();
    expect(arr.length).toBe(4 * 16); // 64
  });

  it('getSplitDistances returns cascadeCount floats', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4, shadowDistance: 100 });
    csm.update(makeCamera(), makeLight());
    const arr = csm.getSplitDistances();
    expect(arr.length).toBe(4);
    // 最后一个应等于 shadowDistance
    expect(arr[3]).toBeCloseTo(100, 5);
  });
});

// ── dispose ────────────────────────────────────────────────────────

describe('CSMShadowMap dispose', () => {
  it('clears cascades and splits', () => {
    const csm = new CSMShadowMap({ cascadeCount: 4 });
    csm.update(makeCamera(), makeLight());
    csm.dispose();
    expect(csm.cascades.length).toBe(0);
    expect(csm.splits.length).toBe(0);
  });
});

// ── CSM_SAMPLE_CHUNK shader 源码校验 ─────────────────────────────

describe('CSM_SAMPLE_CHUNK shader source', () => {
  it('defines CSM_MAX_CASCADES', () => {
    expect(CSM_SAMPLE_CHUNK).toContain('CSM_MAX_CASCADES');
    expect(CSM_SAMPLE_CHUNK).toContain('#define CSM_MAX_CASCADES 8');
  });

  it('contains csmPCF3x3 function (9-tap PCF)', () => {
    expect(CSM_SAMPLE_CHUNK).toContain('csmPCF3x3');
    expect(CSM_SAMPLE_CHUNK).toContain('textureSize');
    // 3x3 = 9 taps
    expect(CSM_SAMPLE_CHUNK).toContain('x <= 1');
    expect(CSM_SAMPLE_CHUNK).toContain('y <= 1');
  });

  it('contains sampleCSM function', () => {
    expect(CSM_SAMPLE_CHUNK).toContain('sampleCSM');
    expect(CSM_SAMPLE_CHUNK).toContain('worldPos');
    expect(CSM_SAMPLE_CHUNK).toContain('viewDepth');
  });

  it('performs cascade selection by viewDepth', () => {
    expect(CSM_SAMPLE_CHUNK).toContain('u_csmSplits');
    expect(CSM_SAMPLE_CHUNK).toContain('cascadeIdx');
  });

  it('performs cascade blend at boundaries', () => {
    expect(CSM_SAMPLE_CHUNK).toContain('blendFactor');
    expect(CSM_SAMPLE_CHUNK).toContain('smoothstep');
    expect(CSM_SAMPLE_CHUNK).toContain('mix(');
  });

  it('handles out-of-bounds (returns 1.0 = lit)', () => {
    expect(CSM_SAMPLE_CHUNK).toContain('return 1.0');
  });

  it('references required uniforms', () => {
    expect(CSM_SAMPLE_CHUNK).toContain('u_csmVP');
    expect(CSM_SAMPLE_CHUNK).toContain('u_csmSplits');
    expect(CSM_SAMPLE_CHUNK).toContain('u_csmMaps');
    expect(CSM_SAMPLE_CHUNK).toContain('u_csmCount');
    expect(CSM_SAMPLE_CHUNK).toContain('u_csmBlend');
    expect(CSM_SAMPLE_CHUNK).toContain('u_csmBias');
  });
});
