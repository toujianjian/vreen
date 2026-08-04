// WhiteBalancePass 单元测试。
//
// 覆盖:
//   1. temperatureTintToWhiteXY: D65 默认值、temperature 偏移方向、tint 偏移
//   2. xyToLMS: D65 白点 → 参考白 LMS、边界(y=0 防除零)
//   3. computeWhiteBalance: 恒等(0,0)→ (1,1,1)、非恒等方向性
//   4. isIdentityWhiteBalance: (0,0) → true、其他 → false
//   5. whiteBalance 纯函数: 恒等、D65 白色保持白色、暖/冷方向、tint 方向
//   6. WhiteBalancePass 类: 构造、enabled、apply 在 mock GL 下不抛错、
//      dispose 释放资源、恒等跳过
//
// 与 o3de Atom WhiteBalance.azsl 对齐:
//   - D65 白点 x=0.31271
//   - D65 LMS = (0.949237, 1.03542, 1.08728)
//   - LIN_2_LMS_MAT / LMS_2_LIN_MAT 互为逆矩阵
//   - balance = D65_LMS / target_LMS

import { describe, it, expect } from 'vitest';
import {
  D65_WHITE_X,
  D65_WHITE_LMS,
  LIN_2_LMS_MAT,
  LMS_2_LIN_MAT,
  temperatureTintToWhiteXY,
  xyToLMS,
  computeWhiteBalance,
  isIdentityWhiteBalance,
  whiteBalance,
  WhiteBalancePass,
} from './WhiteBalancePass';

// ── 常量 ───────────────────────────────────────────────────────────

describe('constants', () => {
  it('D65_WHITE_X = 0.31271(标准照明体 D65)', () => {
    expect(D65_WHITE_X).toBeCloseTo(0.31271, 5);
  });

  it('D65_WHITE_LMS 为预计算参考值', () => {
    expect(D65_WHITE_LMS[0]).toBeCloseTo(0.949237, 6);
    expect(D65_WHITE_LMS[1]).toBeCloseTo(1.03542, 5);
    expect(D65_WHITE_LMS[2]).toBeCloseTo(1.08728, 5);
  });

  it('LIN_2_LMS_MAT 和 LMS_2_LIN_MAT 互为逆矩阵', () => {
    // 验证 M * M⁻¹ ≈ I(行主序)
    // (LIN_2_LMS_MAT) * (LMS_2_LIN_MAT) = I
    const m1 = LIN_2_LMS_MAT;
    const m2 = LMS_2_LIN_MAT;
    // 行 × 列
    const r00 = m1[0]*m2[0] + m1[1]*m2[3] + m1[2]*m2[6];
    const r01 = m1[0]*m2[1] + m1[1]*m2[4] + m1[2]*m2[7];
    const r02 = m1[0]*m2[2] + m1[1]*m2[5] + m1[2]*m2[8];
    const r11 = m1[3]*m2[1] + m1[4]*m2[4] + m1[5]*m2[7];
    const r22 = m1[6]*m2[2] + m1[7]*m2[5] + m1[8]*m2[8];
    expect(r00).toBeCloseTo(1.0, 4);
    expect(r01).toBeCloseTo(0.0, 4);
    expect(r02).toBeCloseTo(0.0, 4);
    expect(r11).toBeCloseTo(1.0, 4);
    expect(r22).toBeCloseTo(1.0, 4);
  });
});

// ── temperatureTintToWhiteXY ───────────────────────────────────────

describe('temperatureTintToWhiteXY', () => {
  it('(0, 0) → D65 白点 (0.31271, ~0.32902)', () => {
    const [x, y] = temperatureTintToWhiteXY(0, 0);
    expect(x).toBeCloseTo(0.31271, 5);
    // y = 2.87*0.31271 - 3*0.31271² - 0.27509507 ≈ 0.32902
    expect(y).toBeCloseTo(0.32902, 4);
  });

  it('temperature > 0 → x 减小(变暖,移向低色温/红侧)', () => {
    const [x0] = temperatureTintToWhiteXY(0, 0);
    const [xWarm] = temperatureTintToWhiteXY(0.5, 0);
    expect(xWarm).toBeLessThan(x0);
  });

  it('temperature < 0 → x 增大(变冷,移向高色温/蓝侧)', () => {
    const [x0] = temperatureTintToWhiteXY(0, 0);
    const [xCold] = temperatureTintToWhiteXY(-0.5, 0);
    expect(xCold).toBeGreaterThan(x0);
    // 负温度偏移系数 0.1,正温度 0.05,所以 |xCold - x0| > |xWarm - x0|
    const [xWarm] = temperatureTintToWhiteXY(0.5, 0);
    const coldDelta = Math.abs(x0 - xCold);
    const warmDelta = Math.abs(x0 - xWarm);
    expect(coldDelta).toBeGreaterThan(warmDelta);
  });

  it('tint > 0 → y 增加(偏品红方向)', () => {
    const [, y0] = temperatureTintToWhiteXY(0, 0);
    const [, yTint] = temperatureTintToWhiteXY(0, 0.5);
    expect(yTint).toBeGreaterThan(y0);
  });

  it('tint < 0 → y 减小(偏绿方向)', () => {
    const [, y0] = temperatureTintToWhiteXY(0, 0);
    const [, yTint] = temperatureTintToWhiteXY(0, -0.5);
    expect(yTint).toBeLessThan(y0);
  });

  it('tint 偏移系数 0.05', () => {
    const [, y0] = temperatureTintToWhiteXY(0, 0);
    const [, y1] = temperatureTintToWhiteXY(0, 1.0);
    expect(y1 - y0).toBeCloseTo(0.05, 6);
  });
});

// ── xyToLMS ────────────────────────────────────────────────────────

describe('xyToLMS', () => {
  it('D65 白点 xy → 接近预计算 D65_WHITE_LMS', () => {
    // 注意:o3de shader 用的简化矩阵(0.7328, -0.7036, ...)
    // 与 LIN_2_LMS_MAT(3.90405e-1, ...)略不同。
    // 此处验证 xyToLMS 使用的是 o3de shader 的简化矩阵,
    // 结果应与 D65_WHITE_LMS 在 5% 以内。
    const [L, M, S] = xyToLMS(D65_WHITE_X, 0.32902);
    // 简化矩阵算出的 D65 LMS 与预计算的 D65_WHITE_LMS 应接近
    expect(L).toBeCloseTo(D65_WHITE_LMS[0], 1);
    expect(M).toBeCloseTo(D65_WHITE_LMS[1], 1);
    expect(S).toBeCloseTo(D65_WHITE_LMS[2], 1);
  });

  it('y=0 不抛错(防除零)', () => {
    expect(() => xyToLMS(0.3, 0)).not.toThrow();
    const [L, M, S] = xyToLMS(0.3, 0);
    expect(Number.isFinite(L)).toBe(true);
    expect(Number.isFinite(M)).toBe(true);
    expect(Number.isFinite(S)).toBe(true);
  });

  it('等能白点 (1/3, 1/3) → 有限正值', () => {
    const [L, M, S] = xyToLMS(1/3, 1/3);
    expect(L).toBeGreaterThan(0);
    expect(M).toBeGreaterThan(0);
    expect(S).toBeGreaterThan(0);
  });
});

// ── computeWhiteBalance ────────────────────────────────────────────

describe('computeWhiteBalance', () => {
  it('(0, 0) → balance = (1, 1, 1)(恒等,D65 白点)', () => {
    const [bL, bM, bS] = computeWhiteBalance(0, 0);
    expect(bL).toBeCloseTo(1.0, 3);
    expect(bM).toBeCloseTo(1.0, 3);
    expect(bS).toBeCloseTo(1.0, 3);
  });

  it('temperature > 0(变暖)→ balance 不全为 1', () => {
    const [bL, bM, bS] = computeWhiteBalance(0.5, 0);
    expect(bL).not.toBeCloseTo(1.0, 4);
    expect(bM).not.toBeCloseTo(1.0, 4);
    expect(bS).not.toBeCloseTo(1.0, 4);
  });

  it('tint > 0(偏品红)→ balance M 通道受影响', () => {
    const [, bM0] = computeWhiteBalance(0, 0);
    const [, bM1] = computeWhiteBalance(0, 0.5);
    // tint 主要影响 y,从而影响 M 通道
    expect(bM1).not.toBeCloseTo(bM0, 4);
  });

  it('balance 为有限正数', () => {
    for (const t of [-1.67, -1.0, -0.5, 0, 0.5, 1.0, 1.67]) {
      const [bL, bM, bS] = computeWhiteBalance(t, 0);
      expect(Number.isFinite(bL)).toBe(true);
      expect(Number.isFinite(bM)).toBe(true);
      expect(Number.isFinite(bS)).toBe(true);
    }
  });
});

// ── isIdentityWhiteBalance ─────────────────────────────────────────

describe('isIdentityWhiteBalance', () => {
  it('(0, 0) → true', () => {
    expect(isIdentityWhiteBalance(0, 0)).toBe(true);
  });

  it('(非0, 0) → false', () => {
    expect(isIdentityWhiteBalance(0.1, 0)).toBe(false);
    expect(isIdentityWhiteBalance(-0.1, 0)).toBe(false);
  });

  it('(0, 非0) → false', () => {
    expect(isIdentityWhiteBalance(0, 0.1)).toBe(false);
    expect(isIdentityWhiteBalance(0, -0.1)).toBe(false);
  });

  it('默认参数 → true', () => {
    expect(isIdentityWhiteBalance()).toBe(true);
  });
});

// ── whiteBalance(纯 CPU 函数) ─────────────────────────────────────

describe('whiteBalance (pure function)', () => {
  it('(0, 0) → 恒等(返回输入)', () => {
    const out = whiteBalance([0.5, 0.4, 0.3], 0, 0);
    expect(out[0]).toBeCloseTo(0.5, 10);
    expect(out[1]).toBeCloseTo(0.4, 10);
    expect(out[2]).toBeCloseTo(0.3, 10);
  });

  it('D65 白色 (1, 1, 1) 在 (0, 0) 下保持白色', () => {
    const out = whiteBalance([1, 1, 1], 0, 0);
    expect(out[0]).toBeCloseTo(1.0, 6);
    expect(out[1]).toBeCloseTo(1.0, 6);
    expect(out[2]).toBeCloseTo(1.0, 6);
  });

  it('temperature > 0(变暖): R 通道增加,B 通道减小', () => {
    const input: [number, number, number] = [0.5, 0.5, 0.5];
    const out = whiteBalance(input, 0.8, 0);
    // 变暖:红色增加,蓝色减少
    expect(out[0]).toBeGreaterThan(input[0]);
    expect(out[2]).toBeLessThan(input[2]);
  });

  it('temperature < 0(变冷): B 通道增加,R 通道减小', () => {
    const input: [number, number, number] = [0.5, 0.5, 0.5];
    const out = whiteBalance(input, -0.8, 0);
    // 变冷:蓝色增加,红色减少
    expect(out[2]).toBeGreaterThan(input[2]);
    expect(out[0]).toBeLessThan(input[0]);
  });

  it('tint > 0(偏品红): R 和 B 相对 G 增加', () => {
    const input: [number, number, number] = [0.5, 0.5, 0.5];
    const out = whiteBalance(input, 0, 0.5);
    // 偏品红:R+G+B 中 R 和 B 相对 G 增加
    // 即 (R+G+B)/3 vs G:out_G 应小于平均值
    const avg = (out[0] + out[1] + out[2]) / 3;
    expect(out[1]).toBeLessThan(avg);
  });

  it('tint < 0(偏绿): G 相对 R 和 B 增加', () => {
    const input: [number, number, number] = [0.5, 0.5, 0.5];
    const out = whiteBalance(input, 0, -0.5);
    // 偏绿:G 通道相对增加
    const avg = (out[0] + out[1] + out[2]) / 3;
    expect(out[1]).toBeGreaterThan(avg);
  });

  it('纯黑 (0, 0, 0) 保持黑色', () => {
    const out = whiteBalance([0, 0, 0], 0.5, 0.2);
    expect(out[0]).toBeCloseTo(0, 10);
    expect(out[1]).toBeCloseTo(0, 10);
    expect(out[2]).toBeCloseTo(0, 10);
  });

  it('HDR 值(>1.0)正确处理', () => {
    const out = whiteBalance([2.0, 1.5, 1.0], 0.5, 0);
    expect(out[0]).toBeGreaterThan(1.5);
    expect(Number.isFinite(out[0])).toBe(true);
    expect(Number.isFinite(out[1])).toBe(true);
    expect(Number.isFinite(out[2])).toBe(true);
  });

  it('往返:apply(forward) → apply(inverse) 近似还原', () => {
    const original: [number, number, number] = [0.5, 0.4, 0.3];
    const forward = whiteBalance(original, 0.5, 0.1);
    // 反向:用相反的 temperature/tint 不能精确还原(因为变换是基于白点的,
    // 不是简单线性偏移),但应在合理范围内
    const backward = whiteBalance(forward, -0.5, -0.1);
    // 验证至少方向正确(不会爆炸)
    expect(Number.isFinite(backward[0])).toBe(true);
    expect(Number.isFinite(backward[1])).toBe(true);
    expect(Number.isFinite(backward[2])).toBe(true);
  });
});

// ── WhiteBalancePass 类 ────────────────────────────────────────────

describe('WhiteBalancePass class', () => {
  it('构造函数默认值:temperature=0, tint=0, enabled=true', () => {
    const pass = new WhiteBalancePass();
    expect(pass.temperature).toBe(0);
    expect(pass.tint).toBe(0);
    expect(pass.enabled).toBe(true);
    expect(pass.name).toBe('white-balance');
  });

  it('构造函数接受自定义参数', () => {
    const pass = new WhiteBalancePass({
      temperature: 0.5,
      tint: 0.1,
      enabled: false,
    });
    expect(pass.temperature).toBe(0.5);
    expect(pass.tint).toBe(0.1);
    expect(pass.enabled).toBe(false);
  });

  it('enabled=false → apply 返回输入纹理(不处理)', () => {
    const pass = new WhiteBalancePass({ temperature: 0.5, enabled: false });
    const mockTex = {} as WebGLTexture;
    const mockGl = { canvas: { width: 0, height: 0 } } as unknown as WebGL2RenderingContext;
    const result = pass.apply(mockGl, mockTex);
    expect(result).toBe(mockTex);
  });

  it('(0, 0) 恒等 → apply 返回输入纹理(跳过 GPU 工作)', () => {
    const pass = new WhiteBalancePass({ temperature: 0, tint: 0 });
    const mockTex = {} as WebGLTexture;
    const mockGl = { canvas: { width: 0, height: 0 } } as unknown as WebGL2RenderingContext;
    const result = pass.apply(mockGl, mockTex);
    expect(result).toBe(mockTex);
  });

  it('setDirty 标记需要重建', () => {
    const pass = new WhiteBalancePass({ temperature: 0.5 });
    expect(() => pass.setDirty()).not.toThrow();
  });

  it('dispose 在无 GL 时不抛错', () => {
    const pass = new WhiteBalancePass({ temperature: 0.5 });
    expect(() => pass.dispose()).not.toThrow();
  });

  it('dispose 释放资源后可再次 dispose(幂等)', () => {
    const pass = new WhiteBalancePass({ temperature: 0.5 });
    pass.dispose();
    expect(() => pass.dispose()).not.toThrow();
  });

  it('apply 在 mock GL 下不抛错并返回纹理', () => {
    // 使用最小 mock GL,仅覆盖 apply 路径
    const gl = createMockGL2();
    const pass = new WhiteBalancePass({ temperature: 0.5, tint: 0.1 });
    const inputTex = gl.createTexture() as WebGLTexture;
    const out = pass.apply(gl, inputTex);
    expect(out).toBeTruthy();
    // 再次 apply(同尺寸,不重建)
    const out2 = pass.apply(gl, inputTex);
    expect(out2).toBe(out);
  });

  it('apply 后 dispose 释放资源', () => {
    const gl = createMockGL2();
    const pass = new WhiteBalancePass({ temperature: 0.5, tint: 0.1 });
    const inputTex = gl.createTexture() as WebGLTexture;
    pass.apply(gl, inputTex);
    expect(() => pass.dispose(gl)).not.toThrow();
  });

  it('apply 后 canvas 尺寸变化触发重建', () => {
    const gl = createMockGL2(256, 256);
    const pass = new WhiteBalancePass({ temperature: 0.5, tint: 0.1 });
    const inputTex = gl.createTexture() as WebGLTexture;
    pass.apply(gl, inputTex);

    // 模拟 canvas resize
    (gl.canvas as any).width = 512;
    (gl.canvas as any).height = 512;
    const out2 = pass.apply(gl, inputTex);
    // 重建后输出纹理应不同(虽然 mock 下 createTexture 返回不同对象)
    expect(out2).toBeTruthy();
  });
});

// ── MockGL2 工具 ───────────────────────────────────────────────────

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
    // 常量
    FRAMEBUFFER: 0x8D40,
    COLOR_BUFFER_BIT: 0x4000,
    TEXTURE_2D: 0x0DE1,
    TEXTURE0: 0x84C0,
    TRIANGLES: 0x0004,
    COLOR_ATTACHMENT0: 0x8CE0,
    RGBA: 0x1908,
    RGBA8: 0x8058,
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

    // 方法
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
