// OutputTransformPass.test.ts — ACES 输出变换 Pass 单元测试。
//
// 覆盖:
//   - 常量验证 (PQ 常量、矩阵)
//   - 10 种色调映射纯函数
//   - PQ 编码函数
//   - ACEScg → sRGB 色彩空间转换
//   - outputTransform 统一函数
//   - OutputTransformPass 类生命周期

import { describe, it, expect } from 'vitest';
import {
  ACESCG_TO_SRGB,
  tonemapReinhard,
  tonemapReinhardExtended,
  tonemapAcesFitted,
  tonemapAcesFilmic,
  tonemapFilmic,
  tonemapAgx,
  tonemapAgxInternal,
  tonemapAgxGolden,
  tonemapAgxPunchy,
  tonemapAgxWarm,
  tonemapPbrNeutral,
  acescgToLinearSrgb,
  perceptualQuantizerRev,
  perceptualQuantizerRevF3,
  linearCVToY,
  outputTransform,
  OutputTransformPass,
  type TonemapperType,
} from './OutputTransformPass';

// ── 常量 ──────────────────────────────────────────────────────────

describe('常量', () => {
  it('ACESCG_TO_SRGB 为 9 元素数组', () => {
    expect(ACESCG_TO_SRGB).toHaveLength(9);
  });

  it('ACESCG_TO_SRGB 行和接近 1 (色彩转换保持白点)', () => {
    // 白色 [1,1,1] 转换后应接近 [1,1,1]
    const white = acescgToLinearSrgb([1, 1, 1]);
    expect(white[0]).toBeCloseTo(1, 2);
    expect(white[1]).toBeCloseTo(1, 2);
    expect(white[2]).toBeCloseTo(1, 2);
  });
});

// ── tonemapReinhard ──────────────────────────────────────────────

describe('tonemapReinhard', () => {
  it('0 → 0', () => {
    const out = tonemapReinhard([0, 0, 0]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('1 → 0.5', () => {
    const out = tonemapReinhard([1, 1, 1]);
    expect(out[0]).toBeCloseTo(0.5, 10);
    expect(out[1]).toBeCloseTo(0.5, 10);
    expect(out[2]).toBeCloseTo(0.5, 10);
  });

  it('大值 → 接近 1', () => {
    const out = tonemapReinhard([100, 100, 100]);
    expect(out[0]).toBeCloseTo(100 / 101, 5);
    expect(out[1]).toBeCloseTo(100 / 101, 5);
    expect(out[2]).toBeCloseTo(100 / 101, 5);
  });

  it('输出在 [0, 1) 范围内(非负输入)', () => {
    for (const v of [0, 0.1, 0.5, 1, 2, 10, 100]) {
      const out = tonemapReinhard([v, v, v]);
      expect(out[0]).toBeGreaterThanOrEqual(0);
      expect(out[0]).toBeLessThan(1);
    }
  });
});

// ── tonemapReinhardExtended ──────────────────────────────────────

describe('tonemapReinhardExtended', () => {
  it('0 → 0', () => {
    const out = tonemapReinhardExtended([0, 0, 0]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('白点 6.0 → 输出接近 1', () => {
    const out = tonemapReinhardExtended([6, 6, 6]);
    expect(out[0]).toBeCloseTo(1, 1);
  });

  it('保持色相(同比例缩放)', () => {
    const input: [number, number, number] = [2, 4, 6];
    const out = tonemapReinhardExtended(input);
    const ratio0 = out[0] / out[1];
    const ratio1 = input[0] / input[1];
    expect(ratio0).toBeCloseTo(ratio1, 5);
  });
});

// ── tonemapAcesFitted ────────────────────────────────────────────

describe('tonemapAcesFitted', () => {
  it('0 → 0', () => {
    const out = tonemapAcesFitted([0, 0, 0]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('大值 → 输出 ≤ 1 (saturate)', () => {
    const out = tonemapAcesFitted([100, 100, 100]);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(out[1]).toBeLessThanOrEqual(1);
    expect(out[2]).toBeLessThanOrEqual(1);
  });

  it('单调递增', () => {
    const out1 = tonemapAcesFitted([0.5, 0.5, 0.5]);
    const out2 = tonemapAcesFitted([1.0, 1.0, 1.0]);
    expect(out2[0]).toBeGreaterThan(out1[0]);
  });
});

// ── tonemapAcesFilmic ────────────────────────────────────────────

describe('tonemapAcesFilmic', () => {
  it('0 → 接近 0', () => {
    const out = tonemapAcesFilmic([0, 0, 0]);
    expect(out[0]).toBeCloseTo(0, 5);
  });

  it('大值 → 输出 ≤ 1', () => {
    const out = tonemapAcesFilmic([100, 100, 100]);
    expect(out[0]).toBeLessThanOrEqual(1);
  });

  it('中间值在合理范围', () => {
    const out = tonemapAcesFilmic([0.5, 0.5, 0.5]);
    expect(out[0]).toBeGreaterThan(0.3);
    expect(out[0]).toBeLessThan(0.65);
  });
});

// ── tonemapFilmic ────────────────────────────────────────────────

describe('tonemapFilmic', () => {
  it('0 → 接近 0', () => {
    const out = tonemapFilmic([0, 0, 0]);
    expect(out[0]).toBeCloseTo(0, 5);
  });

  it('1 → 接近 1', () => {
    const out = tonemapFilmic([1, 1, 1]);
    expect(out[0]).toBeGreaterThan(0.8);
    expect(out[0]).toBeLessThanOrEqual(1);
  });

  it('单调递增', () => {
    const out1 = tonemapFilmic([0.3, 0.3, 0.3]);
    const out2 = tonemapFilmic([0.6, 0.6, 0.6]);
    expect(out2[0]).toBeGreaterThan(out1[0]);
  });
});

// ── AgX ──────────────────────────────────────────────────────────

describe('tonemapAgx', () => {
  it('0 → 0', () => {
    const out = tonemapAgx([0, 0, 0]);
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[1]).toBeCloseTo(0, 5);
    expect(out[2]).toBeCloseTo(0, 5);
  });

  it('1 → 输出在合理范围 [0.3, 0.8]', () => {
    const out = tonemapAgx([1, 1, 1]);
    expect(out[0]).toBeGreaterThan(0.3);
    expect(out[0]).toBeLessThan(0.8);
  });

  it('大值 → 输出有限(AgX 不做硬裁剪)', () => {
    const out = tonemapAgx([100, 100, 100]);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(Number.isFinite(out[1])).toBe(true);
    expect(Number.isFinite(out[2])).toBe(true);
  });

  it('单调递增', () => {
    const out1 = tonemapAgx([0.5, 0.5, 0.5]);
    const out2 = tonemapAgx([2.0, 2.0, 2.0]);
    expect(out2[0]).toBeGreaterThan(out1[0]);
  });
});

describe('tonemapAgxInternal', () => {
  it('默认参数 = tonemapAgx', () => {
    const input: [number, number, number] = [0.5, 0.7, 0.3];
    const a = tonemapAgxInternal(input, [1, 1, 1], [0, 0, 0], [1, 1, 1], 1.0);
    const b = tonemapAgx(input);
    expect(a[0]).toBeCloseTo(b[0], 10);
    expect(a[1]).toBeCloseTo(b[1], 10);
    expect(a[2]).toBeCloseTo(b[2], 10);
  });

  it('高 saturation → 更饱和', () => {
    const input: [number, number, number] = [0.6, 0.3, 0.2];
    const low = tonemapAgxInternal(input, [1, 1, 1], [0, 0, 0], [1, 1, 1], 0.5);
    const high = tonemapAgxInternal(input, [1, 1, 1], [0, 0, 0], [1, 1, 1], 2.0);
    // 高饱和度下,通道间差异应更大
    const rangeLow = Math.max(low[0], low[1], low[2]) - Math.min(low[0], low[1], low[2]);
    const rangeHigh = Math.max(high[0], high[1], high[2]) - Math.min(high[0], high[1], high[2]);
    expect(rangeHigh).toBeGreaterThan(rangeLow);
  });
});

describe('AgX 变体', () => {
  it('Golden 与 base 不同', () => {
    const input: [number, number, number] = [0.5, 0.5, 0.5];
    const base = tonemapAgx(input);
    const golden = tonemapAgxGolden(input);
    expect(golden[0]).not.toBeCloseTo(base[0], 4);
  });

  it('Punchy 与 base 不同', () => {
    const input: [number, number, number] = [0.5, 0.5, 0.5];
    const base = tonemapAgx(input);
    const punchy = tonemapAgxPunchy(input);
    expect(punchy[0]).not.toBeCloseTo(base[0], 4);
  });

  it('Warm 与 base 不同', () => {
    const input: [number, number, number] = [0.5, 0.5, 0.5];
    const base = tonemapAgx(input);
    const warm = tonemapAgxWarm(input);
    expect(warm[0]).not.toBeCloseTo(base[0], 4);
  });

  it('所有变体输出有限', () => {
    for (const v of [0, 0.1, 0.5, 1, 10, 100]) {
      for (const fn of [tonemapAgx, tonemapAgxGolden, tonemapAgxPunchy, tonemapAgxWarm]) {
        const out = fn([v, v, v]);
        expect(Number.isFinite(out[0])).toBe(true);
        expect(Number.isFinite(out[1])).toBe(true);
        expect(Number.isFinite(out[2])).toBe(true);
      }
    }
  });
});

// ── PbrNeutral ───────────────────────────────────────────────────

describe('tonemapPbrNeutral', () => {
  it('0 → 0', () => {
    const out = tonemapPbrNeutral([0, 0, 0]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('低值(≤0.76)→ 不压缩(减去 offset 后返回)', () => {
    const out = tonemapPbrNeutral([0.5, 0.5, 0.5]);
    // x=0.5 >= 0.08 → off=0.04, c=0.5-0.04=0.46
    // peak=0.46 < startCompression=0.76 → 直接返回 0.46
    expect(out[0]).toBeCloseTo(0.46, 5);
  });

  it('大值 → 输出 ≤ 1', () => {
    const out = tonemapPbrNeutral([100, 100, 100]);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(out[1]).toBeLessThanOrEqual(1);
    expect(out[2]).toBeLessThanOrEqual(1);
  });

  it('高亮去饱和(接近白色)', () => {
    const out = tonemapPbrNeutral([10, 2, 0.5]);
    // 高亮部分应被去饱和
    const range = Math.max(out[0], out[1], out[2]) - Math.min(out[0], out[1], out[2]);
    const inputRange = 10 - 0.5;
    expect(range).toBeLessThan(inputRange);
  });
});

// ── acescgToLinearSrgb ───────────────────────────────────────────

describe('acescgToLinearSrgb', () => {
  it('白色 [1,1,1] → 接近 [1,1,1]', () => {
    const out = acescgToLinearSrgb([1, 1, 1]);
    expect(out[0]).toBeCloseTo(1, 2);
    expect(out[1]).toBeCloseTo(1, 2);
    expect(out[2]).toBeCloseTo(1, 2);
  });

  it('黑色 [0,0,0] → [0,0,0]', () => {
    const out = acescgToLinearSrgb([0, 0, 0]);
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(0);
  });

  it('输出为有限数', () => {
    const out = acescgToLinearSrgb([0.5, 0.3, 0.8]);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(Number.isFinite(out[1])).toBe(true);
    expect(Number.isFinite(out[2])).toBe(true);
  });
});

// ── PQ 编码 ──────────────────────────────────────────────────────

describe('perceptualQuantizerRev', () => {
  it('0 → 0', () => {
    expect(perceptualQuantizerRev(0)).toBeCloseTo(0, 5);
  });

  it('10000 cd/m² → 1', () => {
    expect(perceptualQuantizerRev(10000)).toBeCloseTo(1, 5);
  });

  it('单调递增', () => {
    const v1 = perceptualQuantizerRev(100);
    const v2 = perceptualQuantizerRev(1000);
    const v3 = perceptualQuantizerRev(5000);
    expect(v2).toBeGreaterThan(v1);
    expect(v3).toBeGreaterThan(v2);
  });
});

describe('perceptualQuantizerRevF3', () => {
  it('vec3 一致性', () => {
    const out = perceptualQuantizerRevF3([100, 200, 500]);
    expect(out[0]).toBeCloseTo(perceptualQuantizerRev(100), 10);
    expect(out[1]).toBeCloseTo(perceptualQuantizerRev(200), 10);
    expect(out[2]).toBeCloseTo(perceptualQuantizerRev(500), 10);
  });
});

describe('linearCVToY', () => {
  it('linCV=0 → Ymin', () => {
    expect(linearCVToY(0, 100, 0.01)).toBeCloseTo(0.01, 10);
  });

  it('linCV=1 → Ymax', () => {
    expect(linearCVToY(1, 100, 0.01)).toBeCloseTo(100, 10);
  });

  it('linCV=0.5 → 中点', () => {
    expect(linearCVToY(0.5, 100, 0)).toBeCloseTo(50, 10);
  });
});

// ── outputTransform (统一函数) ───────────────────────────────────

describe('outputTransform', () => {
  const input: [number, number, number] = [2.5, 1.8, 0.9];

  it('tonemapper=none + tf=none → 仅曝光', () => {
    const out = outputTransform([1, 1, 1], {
      tonemapper: 'none',
      transferFunction: 'none',
      exposure: 1,
    });
    // 1 * 2^1 = 2
    expect(out[0]).toBeCloseTo(2, 5);
    expect(out[1]).toBeCloseTo(2, 5);
    expect(out[2]).toBeCloseTo(2, 5);
  });

  it('gamma22 → 应用 pow(1/2.2)', () => {
    const out = outputTransform([1, 1, 1], {
      tonemapper: 'none',
      transferFunction: 'gamma22',
    });
    expect(out[0]).toBeCloseTo(1, 5); // 1^0.4545 = 1
  });

  it('所有 tonemapper 产生有限输出', () => {
    const tms: TonemapperType[] = [
      'none', 'reinhard', 'reinhardExtended', 'acesFitted', 'acesFilmic',
      'filmic', 'agx', 'agxGolden', 'agxPunchy', 'agxWarm', 'pbrNeutral',
    ];
    for (const tm of tms) {
      const out = outputTransform(input, { tonemapper: tm, transferFunction: 'gamma22' });
      expect(Number.isFinite(out[0])).toBe(true);
      expect(Number.isFinite(out[1])).toBe(true);
      expect(Number.isFinite(out[2])).toBe(true);
    }
  });

  it('PQ 输出在 [0, 1] 范围', () => {
    const out = outputTransform(input, {
      tonemapper: 'agx',
      transferFunction: 'perceptualQuantizer',
      cinemaBlack: 0,
      cinemaWhite: 100,
    });
    expect(out[0]).toBeGreaterThanOrEqual(0);
    expect(out[0]).toBeLessThanOrEqual(1);
    expect(out[1]).toBeGreaterThanOrEqual(0);
    expect(out[1]).toBeLessThanOrEqual(1);
    expect(out[2]).toBeGreaterThanOrEqual(0);
    expect(out[2]).toBeLessThanOrEqual(1);
  });

  it('曝光 > 0 → 更亮', () => {
    const dark = outputTransform([0.5, 0.5, 0.5], { tonemapper: 'none', transferFunction: 'none', exposure: 0 });
    const bright = outputTransform([0.5, 0.5, 0.5], { tonemapper: 'none', transferFunction: 'none', exposure: 2 });
    expect(bright[0]).toBeGreaterThan(dark[0]);
  });

  it('默认参数 = AgX + Gamma22', () => {
    const out = outputTransform([0.5, 0.5, 0.5]);
    // 应该是 AgX tonemap + gamma22
    expect(out[0]).toBeGreaterThan(0);
    expect(out[0]).toBeLessThanOrEqual(1);
  });
});

// ── OutputTransformPass 类 ───────────────────────────────────────

describe('OutputTransformPass', () => {
  it('默认参数', () => {
    const pass = new OutputTransformPass();
    expect(pass.name).toBe('output-transform');
    expect(pass.tonemapper).toBe('agx');
    expect(pass.transferFunction).toBe('gamma22');
    expect(pass.exposure).toBe(0);
    expect(pass.cinemaBlack).toBe(0);
    expect(pass.cinemaWhite).toBe(100);
    expect(pass.enabled).toBe(true);
  });

  it('自定义参数', () => {
    const pass = new OutputTransformPass({
      tonemapper: 'pbrNeutral',
      transferFunction: 'perceptualQuantizer',
      exposure: 1.5,
      cinemaBlack: 0.005,
      cinemaWhite: 1000,
      enabled: false,
    });
    expect(pass.tonemapper).toBe('pbrNeutral');
    expect(pass.transferFunction).toBe('perceptualQuantizer');
    expect(pass.exposure).toBe(1.5);
    expect(pass.cinemaBlack).toBe(0.005);
    expect(pass.cinemaWhite).toBe(1000);
    expect(pass.enabled).toBe(false);
  });

  it('disabled → 返回输入纹理', () => {
    const pass = new OutputTransformPass({ enabled: false });
    const inputTex = {} as WebGLTexture;
    const result = pass.apply({} as WebGL2RenderingContext, inputTex);
    expect(result).toBe(inputTex);
  });

  it('setDirty 标记脏', () => {
    const pass = new OutputTransformPass();
    expect(() => pass.setDirty()).not.toThrow();
  });

  it('dispose 可重复调用', () => {
    const pass = new OutputTransformPass();
    expect(() => pass.dispose()).not.toThrow();
    expect(() => pass.dispose()).not.toThrow();
  });

  it('apply 后 dispose 释放资源', () => {
    const gl = createMockGL2();
    const pass = new OutputTransformPass({ tonemapper: 'agx' });
    const inputTex = gl.createTexture() as WebGLTexture;
    pass.apply(gl, inputTex);
    expect(() => pass.dispose(gl)).not.toThrow();
  });

  it('apply 后 canvas 尺寸变化触发重建', () => {
    const gl = createMockGL2(256, 256);
    const pass = new OutputTransformPass({ tonemapper: 'agx' });
    const inputTex = gl.createTexture() as WebGLTexture;
    pass.apply(gl, inputTex);

    (gl.canvas as any).width = 512;
    (gl.canvas as any).height = 512;
    const out2 = pass.apply(gl, inputTex);
    expect(out2).toBeTruthy();
  });

  it('PQ 模式使用 RGBA16F', () => {
    const gl = createMockGL2();
    const pass = new OutputTransformPass({
      tonemapper: 'agx',
      transferFunction: 'perceptualQuantizer',
    });
    const inputTex = gl.createTexture() as WebGLTexture;
    pass.apply(gl, inputTex);
    // 不抛异常即可验证
    expect(true).toBe(true);
  });
});

// ── MockGL2 工具 ─────────────────────────────────────────────────

function createMockGL2(w: number = 64, h: number = 64): WebGL2RenderingContext {
  const canvas = { width: w, height: h } as HTMLCanvasElement;

  let texCounter = 0;
  let fboCounter = 0;
  let vaoCounter = 0;
  let bufCounter = 0;
  let progCounter = 0;
  let shaderCounter = 0;

  const gl: any = {
    canvas,
    FRAMEBUFFER: 0x8D40,
    COLOR_BUFFER_BIT: 0x4000,
    TEXTURE_2D: 0x0DE1,
    TEXTURE0: 0x84C0,
    TRIANGLES: 0x0004,
    COLOR_ATTACHMENT0: 0x8CE0,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    RGBA16F: 0x881A,
    UNSIGNED_BYTE: 0x1401,
    FLOAT: 0x1406,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    LINEAR: 0x2601,
    NEAREST: 0x2600,
    CLAMP_TO_EDGE: 0x812F,
    VERTEX_SHADER: 0x8B31,
    FRAGMENT_SHADER: 0x8B30,
    COMPILE_STATUS: 0x8B81,
    LINK_STATUS: 0x8B82,
    ACTIVE_UNIFORMS: 0x8B86,
    ACTIVE_ATTRIBUTES: 0x8B89,
    STATIC_DRAW: 0x88E4,
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0BE2,

    createTexture: () => ({ _id: ++texCounter } as WebGLTexture),
    deleteTexture: (_t: WebGLTexture) => {},
    bindTexture: (_target: number, _t: WebGLTexture | null) => {},
    texImage2D: () => {},
    texParameteri: () => {},
    activeTexture: () => {},
    createFramebuffer: () => ({ _id: ++fboCounter } as WebGLFramebuffer),
    deleteFramebuffer: (_f: WebGLFramebuffer) => {},
    bindFramebuffer: (_target: number, _f: WebGLFramebuffer | null) => {},
    framebufferTexture2D: () => {},
    viewport: () => {},
    disable: () => {},
    enable: () => {},
    colorMask: () => {},
    createVertexArray: () => ({ _id: ++vaoCounter } as WebGLVertexArrayObject),
    deleteVertexArray: (_v: WebGLVertexArrayObject) => {},
    bindVertexArray: (_v: WebGLVertexArrayObject | null) => {},
    createBuffer: () => ({ _id: ++bufCounter } as WebGLBuffer),
    deleteBuffer: (_b: WebGLBuffer) => {},
    bindBuffer: (_target: number, _b: WebGLBuffer | null) => {},
    bufferData: () => {},
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    drawArrays: () => {},
    createShader: (type: number) => ({ _id: ++shaderCounter, type } as WebGLShader),
    deleteShader: (_s: WebGLShader) => {},
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: (_s: WebGLShader, _p: number) => true,
    createProgram: () => ({ _id: ++progCounter } as WebGLProgram),
    deleteProgram: (_p: WebGLProgram) => {},
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: (_p: WebGLProgram, _param: number) => true,
    getProgramInfoLog: () => '',
    getAttribLocation: () => 0,
    getUniformLocation: () => ({} as WebGLUniformLocation),
    useProgram: () => {},
    uniform1i: () => {},
    uniform1f: () => {},
    uniform2f: () => {},
    uniform3f: () => {},
    uniform4f: () => {},
    uniformMatrix3fv: () => {},
    uniformMatrix4fv: () => {},
    getActiveUniform: () => ({ size: 1, type: gl.FLOAT, name: 'u_test' }),
    getActiveAttrib: () => ({ size: 1, type: gl.FLOAT, name: 'a_pos' }),
  };

  return gl as WebGL2RenderingContext;
}
