// ScreenSpaceDecalPass 单元测试。
//
// 覆盖:
//   A. CPU 纯函数(projectToDecalLocal / decalAnglePass / decalEdgeFade /
//      decalBlend / buildDecalMatrix / transformNormalToView)
//   B. GPU Pass(MockGL2):构造、apply、ping-pong、资源生命周期、dispose
//   C. 着色器源码校验

import { describe, it, expect } from 'vitest';
import {
  ScreenSpaceDecalPass,
  DecalBlendMode,
  projectToDecalLocal,
  decalAnglePass,
  decalEdgeFade,
  decalBlend,
  buildDecalMatrix,
  transformNormalToView,
  type Decal,
} from './ScreenSpaceDecalPass';
import { DECAL_FRAG } from '../../Materials/shaders';

// ════════════════════════════════════════════════════════════════════
//  MockGL2
// ════════════════════════════════════════════════════════════════════

class MockGL2 {
  static readonly FRAMEBUFFER = 0x8D40;
  static readonly TEXTURE_2D = 0x0DE1;
  static readonly TEXTURE0 = 0x84C0;
  static readonly TEXTURE1 = 0x84C1;
  static readonly TEXTURE2 = 0x84C2;
  static readonly TEXTURE3 = 0x84C3;
  static readonly TRIANGLES = 0x0004;
  static readonly RGBA = 0x1908;
  static readonly RGBA16F = 0x881A;
  static readonly HALF_FLOAT = 0x140B;
  static readonly TEXTURE_MIN_FILTER = 0x2801;
  static readonly TEXTURE_MAG_FILTER = 0x2800;
  static readonly TEXTURE_WRAP_S = 0x2802;
  static readonly TEXTURE_WRAP_T = 0x2803;
  static readonly LINEAR = 0x2601;
  static readonly CLAMP_TO_EDGE = 0x812F;
  static readonly ARRAY_BUFFER = 0x8892;
  static readonly STATIC_DRAW = 0x88E4;
  static readonly COLOR_ATTACHMENT0 = 0x8CE0;
  static readonly VERTEX_SHADER = 0x8B31;
  static readonly FRAGMENT_SHADER = 0x8B30;
  static readonly COMPILE_STATUS = 0x8B81;
  static readonly LINK_STATUS = 0x8B82;
  static readonly ACTIVE_UNIFORMS = 0x8B86;
  static readonly ACTIVE_ATTRIBUTES = 0x8B89;
  static readonly BLEND = 0x0BE2;

  readonly FRAMEBUFFER = MockGL2.FRAMEBUFFER;
  readonly TEXTURE_2D = MockGL2.TEXTURE_2D;
  readonly TEXTURE0 = MockGL2.TEXTURE0;
  readonly TEXTURE1 = MockGL2.TEXTURE1;
  readonly TEXTURE2 = MockGL2.TEXTURE2;
  readonly TEXTURE3 = MockGL2.TEXTURE3;
  readonly TRIANGLES = MockGL2.TRIANGLES;
  readonly RGBA = MockGL2.RGBA;
  readonly RGBA16F = MockGL2.RGBA16F;
  readonly HALF_FLOAT = MockGL2.HALF_FLOAT;
  readonly TEXTURE_MIN_FILTER = MockGL2.TEXTURE_MIN_FILTER;
  readonly TEXTURE_MAG_FILTER = MockGL2.TEXTURE_MAG_FILTER;
  readonly TEXTURE_WRAP_S = MockGL2.TEXTURE_WRAP_S;
  readonly TEXTURE_WRAP_T = MockGL2.TEXTURE_WRAP_T;
  readonly LINEAR = MockGL2.LINEAR;
  readonly CLAMP_TO_EDGE = MockGL2.CLAMP_TO_EDGE;
  readonly ARRAY_BUFFER = MockGL2.ARRAY_BUFFER;
  readonly STATIC_DRAW = MockGL2.STATIC_DRAW;
  readonly COLOR_ATTACHMENT0 = MockGL2.COLOR_ATTACHMENT0;
  readonly VERTEX_SHADER = MockGL2.VERTEX_SHADER;
  readonly FRAGMENT_SHADER = MockGL2.FRAGMENT_SHADER;
  readonly COMPILE_STATUS = MockGL2.COMPILE_STATUS;
  readonly LINK_STATUS = MockGL2.LINK_STATUS;
  readonly ACTIVE_UNIFORMS = MockGL2.ACTIVE_UNIFORMS;
  readonly ACTIVE_ATTRIBUTES = MockGL2.ACTIVE_ATTRIBUTES;
  readonly BLEND = MockGL2.BLEND;

  canvas: { width: number; height: number } = { width: 800, height: 600 };

  createdTextures: unknown[] = [];
  createdFramebuffers: unknown[] = [];
  createdBuffers: unknown[] = [];
  createdVAOs: unknown[] = [];
  createdPrograms: unknown[] = [];
  createdShaders: unknown[] = [];
  drawCalls = 0;

  private _c = 0;
  private _id(): unknown { this._c++; return { id: this._c } as unknown; }

  createTexture(): WebGLTexture { const t = this._id() as WebGLTexture; this.createdTextures.push(t); return t; }
  createFramebuffer(): WebGLFramebuffer { const f = this._id() as WebGLFramebuffer; this.createdFramebuffers.push(f); return f; }
  createBuffer(): WebGLBuffer { const b = this._id() as WebGLBuffer; this.createdBuffers.push(b); return b; }
  createVertexArray(): WebGLVertexArrayObject { const v = this._id() as WebGLVertexArrayObject; this.createdVAOs.push(v); return v; }
  createProgram(): WebGLProgram { const p = this._id() as WebGLProgram; this.createdPrograms.push(p); return p; }
  createShader(_t: number): WebGLShader { const s = this._id() as WebGLShader; this.createdShaders.push(s); return s; }

  deleteTexture(_t: WebGLTexture | null): void {}
  deleteFramebuffer(_f: WebGLFramebuffer | null): void {}
  deleteBuffer(_b: WebGLBuffer | null): void {}
  deleteVertexArray(_v: WebGLVertexArrayObject | null): void {}
  deleteProgram(_p: WebGLProgram | null): void {}
  deleteShader(_s: WebGLShader | null): void {}

  shaderSource(_s: WebGLShader, _src: string): void {}
  compileShader(_s: WebGLShader): void {}
  getShaderParameter(_s: WebGLShader, _p: number): unknown { return true; }
  getShaderInfoLog(_s: WebGLShader): string | null { return null; }
  attachShader(_p: WebGLProgram, _s: WebGLShader): void {}
  linkProgram(_p: WebGLProgram): void {}
  getProgramParameter(_p: WebGLProgram, p: number): unknown {
    if (p === this.LINK_STATUS) return true;
    if (p === this.ACTIVE_UNIFORMS) return 0;
    if (p === this.ACTIVE_ATTRIBUTES) return 0;
    return 0;
  }
  getProgramInfoLog(_p: WebGLProgram): string | null { return null; }
  getActiveUniform(_p: WebGLProgram, _i: number): unknown { return null; }
  getActiveAttrib(_p: WebGLProgram, _i: number): unknown { return null; }
  getUniformLocation(_p: WebGLProgram, _n: string): WebGLUniformLocation | null { return null; }
  getAttribLocation(_p: WebGLProgram, _n: string): number { return -1; }

  useProgram(_p: WebGLProgram | null): void {}
  uniform1f(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform1i(_l: WebGLUniformLocation | null, _v: number): void {}
  uniform2f(_l: WebGLUniformLocation | null, _x: number, _y: number): void {}
  uniform3f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number): void {}
  uniform4f(_l: WebGLUniformLocation | null, _x: number, _y: number, _z: number, _w: number): void {}
  uniformMatrix4fv(_l: WebGLUniformLocation | null, _t: boolean, _m: Float32Array): void {}

  bindFramebuffer(_t: number, _f: WebGLFramebuffer | null): void {}
  framebufferTexture2D(..._a: unknown[]): void {}
  viewport(_x: number, _y: number, _w: number, _h: number): void {}
  clear(_m: number): void {}
  clearColor(_r: number, _g: number, _b: number, _a: number): void {}
  colorMask(_r: boolean, _g: boolean, _b: boolean, _a: boolean): void {}
  activeTexture(_u: number): void {}
  bindTexture(_t: number, _tex: WebGLTexture | null): void {}
  texImage2D(..._a: unknown[]): void {}
  texParameteri(_t: number, _p: number, _v: number): void {}
  bindVertexArray(_v: WebGLVertexArrayObject | null): void {}
  bindBuffer(_t: number, _b: WebGLBuffer | null): void {}
  bufferData(_t: number, _d: BufferSource, _u: number): void {}
  enableVertexAttribArray(_i: number): void {}
  vertexAttribPointer(_i: number, _s: number, _t: number, _n: boolean, _st: number, _o: number): void {}
  drawArrays(_m: number, _f: number, _c: number): void { this.drawCalls++; }

  enable(_c: number): void {}
  disable(_c: number): void {}
}

function makeTex(gl: MockGL2): WebGLTexture { return gl.createTexture(); }

function makeDecal(gl: MockGL2, overrides: Partial<Decal> = {}): Decal {
  return {
    texture: makeTex(gl),
    decalMatrix: new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]),
    decalNormalView: [0, 0, 1],
    ...overrides,
  };
}

const IDENTITY_VP_INV = new Float32Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

// ════════════════════════════════════════════════════════════════════
//  A. CPU 纯函数
// ════════════════════════════════════════════════════════════════════

describe('projectToDecalLocal', () => {
  const ID = new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);

  it('origin is inside the identity box', () => {
    const r = projectToDecalLocal([0, 0, 0], ID);
    expect(r.inside).toBe(true);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
    expect(r.z).toBe(0);
  });

  it('(0.5, 0.5, 0.5) is inside (boundary inclusive)', () => {
    const r = projectToDecalLocal([0.5, 0.5, 0.5], ID);
    expect(r.inside).toBe(true);
  });

  it('(0.51, 0, 0) is outside', () => {
    const r = projectToDecalLocal([0.51, 0, 0], ID);
    expect(r.inside).toBe(false);
  });

  it('(-0.5, -0.5, -0.5) is inside (negative boundary)', () => {
    const r = projectToDecalLocal([-0.5, -0.5, -0.5], ID);
    expect(r.inside).toBe(true);
  });

  it('(-0.51, 0, 0) is outside', () => {
    const r = projectToDecalLocal([-0.51, 0, 0], ID);
    expect(r.inside).toBe(false);
  });

  it('(1, 1, 1) is outside', () => {
    const r = projectToDecalLocal([1, 1, 1], ID);
    expect(r.inside).toBe(false);
  });

  it('respects translated decal matrix (box shifted to [1,2]×[1,2]×[1,2])', () => {
    // decalMatrix = translate(-1, -2, ...); 这样世界 (1.5, 2.5, 1.5) → 局部 (0.5, 0.5, 0.5)
    // 等价于把贴花中心放在 (1, 2, 1):world→local = T(-1,-2,-1)
    const m = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -1, -2, -1, 1, // 平移列(列主序:m[12]=tx, m[13]=ty, m[14]=tz)
    ]);
    // 注:上面 m[12]=-1, m[13]=-2, m[14]=-1;但按列主序排布是
    //   [m0 m4 m8  m12]   [1 0 0 -1]
    //   [m1 m5 m9  m13] = [0 1 0 -2]
    //   [m2 m6 m10 m14]   [0 0 1 -1]
    //   [m3 m7 m11 m15]   [0 0 0  1]
    // 即 T(-1,-2,-1),把世界 (1.5,2.5,1.5) 变为 (0.5,0.5,0.5)
    const r = projectToDecalLocal([1.5, 2.5, 1.5], m);
    expect(r.x).toBeCloseTo(0.5, 5);
    expect(r.y).toBeCloseTo(0.5, 5);
    expect(r.z).toBeCloseTo(0.5, 5);
    expect(r.inside).toBe(true);
  });

  it('respects scaled decal matrix (box scaled 2×)', () => {
    // decalMatrix = scale(0.5, 0.5, 0.5):世界 (1, 1, 1) → 局部 (0.5, 0.5, 0.5)
    // scale(0.5) 列主序:对角线 m[0]=0.5, m[5]=0.5, m[10]=0.5
    const m = new Float32Array([
      0.5, 0, 0, 0,
      0, 0.5, 0, 0,
      0, 0, 0.5, 0,
      0, 0, 0, 1,
    ]);
    const r = projectToDecalLocal([1, 1, 1], m);
    expect(r.x).toBeCloseTo(0.5, 5);
    expect(r.y).toBeCloseTo(0.5, 5);
    expect(r.z).toBeCloseTo(0.5, 5);
    expect(r.inside).toBe(true);
  });

  it('handles w != 1 (perspective divide)', () => {
    // 构造一个 w=2 的矩阵:最后一列 (0,0,0,2) → w = 2*1 = 2
    const m = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 2,
    ]);
    const r = projectToDecalLocal([1, 1, 1], m);
    // x = 1 / 2 = 0.5
    expect(r.x).toBeCloseTo(0.5, 5);
    expect(r.y).toBeCloseTo(0.5, 5);
    expect(r.z).toBeCloseTo(0.5, 5);
    expect(r.inside).toBe(true);
  });

  it('w=0 falls back to no divide', () => {
    const m = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 0, // w=0
    ]);
    const r = projectToDecalLocal([0.3, 0.3, 0.3], m);
    expect(r.x).toBeCloseTo(0.3, 5);
    expect(r.inside).toBe(true);
  });
});

describe('decalAnglePass', () => {
  it('parallel normals pass (dot=1)', () => {
    expect(decalAnglePass([0, 0, 1], [0, 0, 1], 0.5)).toBe(true);
  });

  it('perpendicular normals fail (dot=0)', () => {
    expect(decalAnglePass([1, 0, 0], [0, 0, 1], 0.5)).toBe(false);
  });

  it('opposite normals fail (dot=-1)', () => {
    expect(decalAnglePass([0, 0, -1], [0, 0, 1], 0.5)).toBe(false);
  });

  it('60-degree angle: dot=0.5 passes threshold 0.5 (>=)', () => {
    // 与 [0,0,1] 成 60° 角的向量 = [sin(60°), 0, cos(60°)] = [0.866, 0, 0.5]
    // dot = cos(60°) = 0.5,通过 >= 0.5 阈值
    expect(decalAnglePass([0.8660254, 0, 0.5], [0, 0, 1], 0.5)).toBe(true);
  });

  it('61-degree angle: dot<0.5 fails threshold 0.5', () => {
    // 与 [0,0,1] 成 61° 角的向量 = [sin(61°), 0, cos(61°)] = [0.8746, 0, 0.4848]
    // dot = cos(61°) ≈ 0.4848 < 0.5,被拒绝
    expect(decalAnglePass([0.8746, 0, 0.4848], [0, 0, 1], 0.5)).toBe(false);
  });

  it('threshold=0 accepts perpendicular (dot=0) but rejects opposite (dot<0)', () => {
    // dot=0 (90°) 通过 >= 0 阈值
    expect(decalAnglePass([1, 0, 0], [0, 0, 1], 0)).toBe(true);
    // dot=-1 (180°,反向)被 < 0 拒绝
    expect(decalAnglePass([0, 0, -1], [0, 0, 1], 0)).toBe(false);
  });

  it('threshold=1 only accepts exactly parallel', () => {
    expect(decalAnglePass([0, 0, 1], [0, 0, 1], 1)).toBe(true);
    expect(decalAnglePass([0.001, 0, 0.9999995], [0, 0, 1], 1)).toBe(false);
  });

  it('oblique 45-degree passes threshold 0.5', () => {
    // cos(45°) ≈ 0.707 > 0.5
    expect(decalAnglePass([0.7071, 0, 0.7071], [0, 0, 1], 0.5)).toBe(true);
  });
});

describe('decalEdgeFade', () => {
  it('center (maxComp=0) → 1 (no fade)', () => {
    expect(decalEdgeFade(0, 0, 0)).toBe(1);
  });

  it('edge (maxComp=0.5) → 0 (fully faded)', () => {
    expect(decalEdgeFade(0.5, 0, 0)).toBe(0);
  });

  it('beyond edge (maxComp>0.5) → 0', () => {
    expect(decalEdgeFade(0.6, 0, 0)).toBe(0);
  });

  it('midpoint (maxComp=0.475) → smoothstep ~0.5', () => {
    // smoothstep(0.5, 0.45, 0.475): t = (0.5-0.475)/(0.5-0.45) = 0.5
    // smoothstep = 0.5² × (3 - 2×0.5) = 0.25 × 2 = 0.5
    expect(decalEdgeFade(0.475, 0, 0)).toBeCloseTo(0.5, 5);
  });

  it('below e1 (maxComp=0.45) → 1', () => {
    expect(decalEdgeFade(0.45, 0, 0)).toBe(1);
  });

  it('uses the max of |x|,|y|,|z|', () => {
    expect(decalEdgeFade(0.1, 0.5, 0.2)).toBe(0);
    expect(decalEdgeFade(0.1, 0.4, 0.2)).toBeCloseTo(1, 5);
  });
});

describe('decalBlend', () => {
  it('Alpha blend: mix(scene, decal, a)', () => {
    const r = decalBlend([0.2, 0.4, 0.6], [1, 0, 0, 0.5], DecalBlendMode.Alpha);
    // 0.2*0.5 + 1*0.5 = 0.6
    expect(r[0]).toBeCloseTo(0.6, 5);
    expect(r[1]).toBeCloseTo(0.2, 5); // 0.4*0.5 + 0*0.5 = 0.2
    expect(r[2]).toBeCloseTo(0.3, 5); // 0.6*0.5 + 0*0.5 = 0.3
  });

  it('Alpha blend with a=0 → scene unchanged', () => {
    const r = decalBlend([0.2, 0.4, 0.6], [1, 0, 0, 0], DecalBlendMode.Alpha);
    expect(r[0]).toBeCloseTo(0.2, 5);
    expect(r[1]).toBeCloseTo(0.4, 5);
    expect(r[2]).toBeCloseTo(0.6, 5);
  });

  it('Alpha blend with a=1 → decal', () => {
    const r = decalBlend([0.2, 0.4, 0.6], [1, 0, 0, 1], DecalBlendMode.Alpha);
    expect(r[0]).toBeCloseTo(1, 5);
    expect(r[1]).toBeCloseTo(0, 5);
    expect(r[2]).toBeCloseTo(0, 5);
  });

  it('Multiply blend: scene * mix(white, decal, a)', () => {
    const r = decalBlend([0.8, 0.4, 0.2], [0.5, 0.5, 0.5, 1], DecalBlendMode.Multiply);
    expect(r[0]).toBeCloseTo(0.4, 5); // 0.8 * 0.5
    expect(r[1]).toBeCloseTo(0.2, 5);
    expect(r[2]).toBeCloseTo(0.1, 5);
  });

  it('Multiply blend with a=0 → scene unchanged', () => {
    const r = decalBlend([0.8, 0.4, 0.2], [0.5, 0.5, 0.5, 0], DecalBlendMode.Multiply);
    expect(r[0]).toBeCloseTo(0.8, 5);
    expect(r[1]).toBeCloseTo(0.4, 5);
    expect(r[2]).toBeCloseTo(0.2, 5);
  });

  it('Additive blend: scene + decal * a', () => {
    const r = decalBlend([0.2, 0.4, 0.6], [0.5, 0.3, 0.1, 1], DecalBlendMode.Additive);
    expect(r[0]).toBeCloseTo(0.7, 5);
    expect(r[1]).toBeCloseTo(0.7, 5);
    expect(r[2]).toBeCloseTo(0.7, 5);
  });

  it('Additive blend with a=0 → scene unchanged', () => {
    const r = decalBlend([0.2, 0.4, 0.6], [0.5, 0.3, 0.1, 0], DecalBlendMode.Additive);
    expect(r[0]).toBeCloseTo(0.2, 5);
    expect(r[1]).toBeCloseTo(0.4, 5);
    expect(r[2]).toBeCloseTo(0.6, 5);
  });

  it('Normal blend with a>0 → decal color', () => {
    const r = decalBlend([0.2, 0.4, 0.6], [1, 0.5, 0.25, 0.5], DecalBlendMode.Normal);
    expect(r[0]).toBeCloseTo(1, 5);
    expect(r[1]).toBeCloseTo(0.5, 5);
    expect(r[2]).toBeCloseTo(0.25, 5);
  });

  it('Normal blend with a=0 → scene unchanged', () => {
    const r = decalBlend([0.2, 0.4, 0.6], [1, 0.5, 0.25, 0], DecalBlendMode.Normal);
    expect(r[0]).toBeCloseTo(0.2, 5);
    expect(r[1]).toBeCloseTo(0.4, 5);
    expect(r[2]).toBeCloseTo(0.6, 5);
  });
});

describe('buildDecalMatrix', () => {
  it('identity orientation + size (1,1,1) at origin → identity', () => {
    const m = buildDecalMatrix([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
    // 局部 = world(identity),原点 → (0,0,0)
    const r = projectToDecalLocal([0, 0, 0], m);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(0, 5);
    expect(r.inside).toBe(true);
  });

  it('size (2,2,2) at origin: world (1,1,1) → local (0.5,0.5,0.5)', () => {
    const m = buildDecalMatrix([0, 0, 0], [0, 0, 0, 1], [2, 2, 2]);
    const r = projectToDecalLocal([1, 1, 1], m);
    expect(r.x).toBeCloseTo(0.5, 5);
    expect(r.y).toBeCloseTo(0.5, 5);
    expect(r.z).toBeCloseTo(0.5, 5);
    expect(r.inside).toBe(true);
  });

  it('position (5,0,0): world (5,0,0) → local origin', () => {
    const m = buildDecalMatrix([5, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
    const r = projectToDecalLocal([5, 0, 0], m);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(0, 5);
    expect(r.inside).toBe(true);
  });

  it('position (5,0,0): world (5.4,0,0) → local (0.4,0,0) inside', () => {
    const m = buildDecalMatrix([5, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
    const r = projectToDecalLocal([5.4, 0, 0], m);
    expect(r.x).toBeCloseTo(0.4, 5);
    expect(r.inside).toBe(true);
  });

  it('90° rotation around Y: world +X → local +Z (within box)', () => {
    // 四元数 [0, sin(45°), 0, cos(45°)] = 90° around Y
    const sq = Math.SQRT1_2;
    const m = buildDecalMatrix([0, 0, 0], [0, sq, 0, sq], [1, 1, 1]);
    // R_y(90°):列 2 = (1,0,0),即 +Z → +X
    // decalMatrix = inverse(R_y(90°)) = R_y(-90°):列 0 = (0,0,1),即 +X → +Z
    // world (0.4, 0, 0) → local (0, 0, 0.4)(|z|=0.4 <= 0.5,在盒内)
    const r = projectToDecalLocal([0.4, 0, 0], m);
    expect(r.x).toBeCloseTo(0, 5);
    expect(r.y).toBeCloseTo(0, 5);
    expect(r.z).toBeCloseTo(0.4, 5);
    expect(r.inside).toBe(true);
  });

  it('combined: position (1,2,3) + size (2,2,2) + identity rotation', () => {
    const m = buildDecalMatrix([1, 2, 3], [0, 0, 0, 1], [2, 2, 2]);
    // world (2, 3, 4) → local ((2-1)/2, (3-2)/2, (4-3)/2) = (0.5, 0.5, 0.5)
    const r = projectToDecalLocal([2, 3, 4], m);
    expect(r.x).toBeCloseTo(0.5, 5);
    expect(r.y).toBeCloseTo(0.5, 5);
    expect(r.z).toBeCloseTo(0.5, 5);
    expect(r.inside).toBe(true);
  });

  it('returns Float32Array of length 16', () => {
    const m = buildDecalMatrix([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]);
    expect(m).toBeInstanceOf(Float32Array);
    expect(m.length).toBe(16);
  });

  it('handles degenerate size (clamps to 1e-6)', () => {
    const m = buildDecalMatrix([0, 0, 0], [0, 0, 0, 1], [0, 0, 1]);
    // 不应产生 Infinity / NaN
    expect(Number.isFinite(m[0])).toBe(true);
    expect(Number.isFinite(m[5])).toBe(true);
    expect(Number.isFinite(m[10])).toBe(true);
  });
});

describe('transformNormalToView', () => {
  it('identity view matrix: world normal unchanged', () => {
    const view = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const r = transformNormalToView([0, 0, 1], view);
    expect(r[0]).toBeCloseTo(0, 5);
    expect(r[1]).toBeCloseTo(0, 5);
    expect(r[2]).toBeCloseTo(1, 5);
  });

  it('90° rotation around Y view: world +Z → view +X', () => {
    // view = R_y(90°):列主序
    //   [0  0  1  0]
    //   [0  1  0  0]
    //   [-1 0  0  0]
    //   [0  0  0  1]
    // 列主序:m[0]=0, m[1]=0, m[2]=-1, m[3]=0, m[4]=0, m[5]=1, m[6]=0, ...
    const view = new Float32Array([
      0, 0, -1, 0,
      0, 1, 0, 0,
      1, 0, 0, 0,
      0, 0, 0, 1,
    ]);
    const r = transformNormalToView([0, 0, 1], view);
    expect(r[0]).toBeCloseTo(1, 5); // +Z → +X
    expect(r[1]).toBeCloseTo(0, 5);
    expect(r[2]).toBeCloseTo(0, 5);
  });

  it('preserves magnitude for rotation-only view', () => {
    const view = new Float32Array([
      0, 0, -1, 0,
      0, 1, 0, 0,
      1, 0, 0, 0,
      0, 0, 0, 1,
    ]);
    const r = transformNormalToView([0.6, 0.8, 0], view);
    const mag = Math.sqrt(r[0] * r[0] + r[1] * r[1] + r[2] * r[2]);
    expect(mag).toBeCloseTo(1, 5);
  });
});

// ════════════════════════════════════════════════════════════════════
//  B. GPU Pass
// ════════════════════════════════════════════════════════════════════

describe('ScreenSpaceDecalPass construction', () => {
  it('defaults', () => {
    const p = new ScreenSpaceDecalPass();
    expect(p.name).toBe('screenspacedecal');
    expect(p.defaultBlendMode).toBe(DecalBlendMode.Alpha);
    expect(p.defaultOpacity).toBe(1);
    expect(p.defaultAngleThreshold).toBe(0.5);
    expect(p.enabled).toBe(true);
  });

  it('accepts all options', () => {
    const p = new ScreenSpaceDecalPass({
      defaultBlendMode: DecalBlendMode.Multiply,
      defaultOpacity: 0.7,
      defaultAngleThreshold: 0.3,
      enabled: false,
    });
    expect(p.defaultBlendMode).toBe(DecalBlendMode.Multiply);
    expect(p.defaultOpacity).toBe(0.7);
    expect(p.defaultAngleThreshold).toBe(0.3);
    expect(p.enabled).toBe(false);
  });

  it('defaultBlendMode is updatable', () => {
    const p = new ScreenSpaceDecalPass();
    p.defaultBlendMode = DecalBlendMode.Additive;
    expect(p.defaultBlendMode).toBe(DecalBlendMode.Additive);
  });

  it('defaultOpacity is updatable', () => {
    const p = new ScreenSpaceDecalPass();
    p.defaultOpacity = 0.5;
    expect(p.defaultOpacity).toBe(0.5);
  });

  it('defaultAngleThreshold is updatable', () => {
    const p = new ScreenSpaceDecalPass();
    p.defaultAngleThreshold = 0.8;
    expect(p.defaultAngleThreshold).toBe(0.8);
  });

  it('enabled is updatable', () => {
    const p = new ScreenSpaceDecalPass();
    p.enabled = false;
    expect(p.enabled).toBe(false);
  });

  it('DecalBlendMode enum has 4 modes', () => {
    expect(DecalBlendMode.Alpha).toBe(0);
    expect(DecalBlendMode.Multiply).toBe(1);
    expect(DecalBlendMode.Additive).toBe(2);
    expect(DecalBlendMode.Normal).toBe(3);
  });
});

describe('ScreenSpaceDecalPass apply', () => {
  it('apply() does not throw and issues a draw call', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    expect(() => p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV)).not.toThrow();
    expect(gl.drawCalls).toBe(1);
  });

  it('apply() returns a texture', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    const out = p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    expect(out).toBeDefined();
    expect(out).not.toBeNull();
  });

  it('apply() first call allocates 2 output textures + 2 FBOs + 1 VAO + 1 buffer', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    // 4 调用方纹理(input/depth/normal/decal) + 2 ping-pong 输出纹理 = 6
    expect(gl.createdTextures.length).toBe(6);
    expect(gl.createdFramebuffers.length).toBe(2);
    expect(gl.createdVAOs.length).toBe(1);
    expect(gl.createdBuffers.length).toBe(1);
  });

  it('apply() same size does not reallocate', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    const texBefore = gl.createdTextures.length;
    const fboBefore = gl.createdFramebuffers.length;
    // 第二次 apply(同尺寸)不应新建纹理/FBO
    const out1 = p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    expect(gl.createdTextures.length).toBe(texBefore);
    expect(gl.createdFramebuffers.length).toBe(fboBefore);
    void out1;
  });

  it('apply() rebuilds on canvas size change', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    const texBefore = gl.createdTextures.length;
    // 改尺寸
    gl.canvas = { width: 1024, height: 768 };
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    // 重建:新增 2 个纹理 + 2 个 FBO
    expect(gl.createdTextures.length).toBe(texBefore + 2);
    expect(gl.createdFramebuffers.length).toBe(4);
  });

  it('disabled pass returns input unchanged (no draw call)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass({ enabled: false });
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    const out = p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    expect(out).toBe(input);
    expect(gl.drawCalls).toBe(0);
    // 4 个调用方纹理(input/depth/normal/decal);Pass 未创建任何纹理
    expect(gl.createdTextures.length).toBe(4);
  });

  it('setDirty() forces rebuild on next apply', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    const texBefore = gl.createdTextures.length;
    p.setDirty();
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    expect(gl.createdTextures.length).toBe(texBefore + 2);
  });

  it('multiple apply() calls issue multiple draw calls', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    for (let i = 0; i < 5; i++) {
      const decal = makeDecal(gl);
      p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    }
    expect(gl.drawCalls).toBe(5);
  });
});

describe('ScreenSpaceDecalPass ping-pong', () => {
  it('consecutive apply() returns different textures', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    // 第一次:input = 外部纹理 → 输出 texA
    const externalTex = makeTex(gl);
    const out1 = p.apply(gl as unknown as WebGL2RenderingContext, externalTex, depth, normal, decal, IDENTITY_VP_INV);
    // 第二次:input = texA → 输出 texB
    const out2 = p.apply(gl as unknown as WebGL2RenderingContext, out1, depth, normal, decal, IDENTITY_VP_INV);
    expect(out1).not.toBe(out2);
  });

  it('third apply returns texA again (alternating)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    const externalTex = makeTex(gl);
    const out1 = p.apply(gl as unknown as WebGL2RenderingContext, externalTex, depth, normal, decal, IDENTITY_VP_INV);
    const out2 = p.apply(gl as unknown as WebGL2RenderingContext, out1, depth, normal, decal, IDENTITY_VP_INV);
    const out3 = p.apply(gl as unknown as WebGL2RenderingContext, out2, depth, normal, decal, IDENTITY_VP_INV);
    expect(out3).toBe(out1);
  });

  it('output is never the same as input (no feedback)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    let color: WebGLTexture = makeTex(gl);
    for (let i = 0; i < 10; i++) {
      const out = p.apply(gl as unknown as WebGL2RenderingContext, color, depth, normal, decal, IDENTITY_VP_INV);
      expect(out).not.toBe(color);
      color = out;
    }
  });

  it('chain of 5 decals produces 5 distinct textures in rotation', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    let color: WebGLTexture = makeTex(gl);
    const outputs = new Set<WebGLTexture>();
    for (let i = 0; i < 5; i++) {
      const decal = makeDecal(gl);
      color = p.apply(gl as unknown as WebGL2RenderingContext, color, depth, normal, decal, IDENTITY_VP_INV);
      outputs.add(color);
    }
    // 5 次输出应在 texA/texB 之间交替,所以集合大小为 2
    expect(outputs.size).toBe(2);
  });
});

describe('ScreenSpaceDecalPass dispose', () => {
  it('dispose() releases resources', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    const input = makeTex(gl);
    const depth = makeTex(gl);
    const normal = makeTex(gl);
    const decal = makeDecal(gl);
    p.apply(gl as unknown as WebGL2RenderingContext, input, depth, normal, decal, IDENTITY_VP_INV);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() is idempotent', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTex(gl), makeTex(gl), makeTex(gl), makeDecal(gl), IDENTITY_VP_INV);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    expect(() => p.dispose(gl as unknown as WebGL2RenderingContext)).not.toThrow();
  });

  it('dispose() without gl parameter', () => {
    const p = new ScreenSpaceDecalPass();
    expect(() => p.dispose()).not.toThrow();
  });

  it('can apply() again after dispose() (rebuilds)', () => {
    const gl = new MockGL2();
    const p = new ScreenSpaceDecalPass();
    p.apply(gl as unknown as WebGL2RenderingContext, makeTex(gl), makeTex(gl), makeTex(gl), makeDecal(gl), IDENTITY_VP_INV);
    p.dispose(gl as unknown as WebGL2RenderingContext);
    const texBefore = gl.createdTextures.length;
    p.apply(gl as unknown as WebGL2RenderingContext, makeTex(gl), makeTex(gl), makeTex(gl), makeDecal(gl), IDENTITY_VP_INV);
    // 第二次 apply 新建:4 调用方纹理 + 2 ping-pong 输出 = 6
    expect(gl.createdTextures.length).toBe(texBefore + 6);
  });
});

// ════════════════════════════════════════════════════════════════════
//  C. 着色器源码校验
// ════════════════════════════════════════════════════════════════════

describe('DECAL_FRAG shader source', () => {
  it('is a GLSL ES 3.00 fragment shader', () => {
    expect(DECAL_FRAG).toContain('#version 300 es');
    expect(DECAL_FRAG).toContain('precision highp float');
  });

  it('declares all 4 input samplers', () => {
    expect(DECAL_FRAG).toContain('u_colorMap');
    expect(DECAL_FRAG).toContain('u_depthMap');
    expect(DECAL_FRAG).toContain('u_normalMap');
    expect(DECAL_FRAG).toContain('u_decalMap');
  });

  it('declares both matrices', () => {
    expect(DECAL_FRAG).toContain('u_viewProjInv');
    expect(DECAL_FRAG).toContain('u_decalMatrix');
  });

  it('declares decal parameters', () => {
    expect(DECAL_FRAG).toContain('u_decalNormalView');
    expect(DECAL_FRAG).toContain('u_angleThreshold');
    expect(DECAL_FRAG).toContain('u_blendMode');
    expect(DECAL_FRAG).toContain('u_opacity');
  });

  it('implements world position reconstruction', () => {
    expect(DECAL_FRAG).toContain('reconstructWorldPos');
    expect(DECAL_FRAG).toContain('u_viewProjInv * clip');
  });

  it('implements volume culling ([-0.5, 0.5]³)', () => {
    expect(DECAL_FRAG).toContain('abs(local.xyz)');
    expect(DECAL_FRAG).toContain('0.5');
  });

  it('implements angle culling', () => {
    expect(DECAL_FRAG).toContain('dot(normal');
    expect(DECAL_FRAG).toContain('u_angleThreshold');
  });

  it('implements all 4 blend modes', () => {
    expect(DECAL_FRAG).toContain('mix(sceneColor');
    expect(DECAL_FRAG).toContain('sceneColor *');
    expect(DECAL_FRAG).toContain('sceneColor +');
    expect(DECAL_FRAG).toContain('decalColor.a > 0.0');
  });

  it('implements edge fade', () => {
    expect(DECAL_FRAG).toContain('smoothstep(0.5, 0.45');
  });

  it('skips skybox pixels (depth >= 1.0)', () => {
    expect(DECAL_FRAG).toContain('depth >= 1.0');
  });
});
