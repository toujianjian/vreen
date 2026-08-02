// UnrealBloomPass — 多层 mip 高斯 Bloom(Unreal Engine / three.js UnrealBloomPass 风格)。
//
// 设计目标:
//   - 替代基础版 BloomPass(仅 2 次盒式模糊),显著提升发光质量。
//   - 5 级 mip 金字塔 + 可分离高斯,每级用不同核尺寸(越大 mip 核越大,
//     性能友好,因为 mip 更小)。
//   - knee 软阈值避免"亮部硬边"。
//   - 可选 lens dirt 纹理,实现脏镜头高光散射(电影感)。
//   - TAA 兼容:在线性空间工作,保持 alpha 不变,加法混合不干扰速度/历史缓冲。
//
// 管线阶段(4 组 GPU dispatch):
//   1. Luminosity high-pass (soft knee)   → mrtBright
//   2. Separable Gaussian ×5 levels      → hTargets[], vTargets[] (每级 H→V 共 10 次 FS draw)
//   3. Mip-weighted composite + dirt     → hTargets[0]
//   4. Additive blend over source        → output (ctx.resources.bloomTexture1 / or ping-pong)
//
// 与 soup3D 对比:
//   - soup3D 仅有单级 box blur Bloom(看源码),UnrealBloom 在 HDR 场景中
//     可同时保留小面积尖高光(Neon 边缘)和大面积柔和辉光(天空/屏幕),
//     视觉层次更接近 UE4/Unity HDRP。
//
// 参考:
//   - three.js/examples/jsm/postprocessing/UnrealBloomPass.js (MIT)
//   - Unreal Engine 文档: Post Process / Bloom
//   - Jorge Jiminez @ SIGGRAPH 2014, "Next Generation Post-Processing
//     in Call of Duty Advanced Warfare" (mip bloom 原理)

import { RenderPass, type PassContext } from '../RenderPass';
import {
  POST_VERT as POST_VERT_SRC,
  BLOOM_HIGHPASS_FRAG,
  BLOOM_GAUSSIAN_FRAG,
  BLOOM_COMPOSITE_FRAG,
  BLOOM_ADDITIVE_BLEND_FRAG,
} from '../../Materials/shaders';

/** UnrealBloom Pass 用户参数。 */
export interface UnrealBloomOptions {
  /** 全局强度,默认 1.0。值过大时靠 ToneMapping 压缩。 */
  strength?: number;
  /** 半径 [0,1],控制高/低 mip 混合偏置。0 = 仅细 mip(锐利),1 = 粗 mip(柔和)。 */
  radius?: number;
  /** 亮度阈值。低于此值的像素不贡献 Bloom,0 = 全部贡献。 */
  threshold?: number;
  /** knee 软边宽度,相对 threshold 的比例,默认 0.01。越大越柔和(避免硬边)。 */
  smoothWidth?: number;
  /** 5 级 mip 的权重(从细到粗)。默认 [1, 0.8, 0.6, 0.4, 0.2]。 */
  mipFactors?: [number, number, number, number, number];
  /** 5 级 mip 的 RGB 染色(冷光、暖光等)。默认全白。 */
  mipTints?: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ];
  /** 镜头污渍纹理(WebGLTexture,可选)。脏的区域 Bloom 会被放大,产生电影感。 */
  dirtTexture?: WebGLTexture | null;
  /** 污渍强度,0 = 禁用,0.3~1.0 有明显效果。 */
  dirtStrength?: number;
  /** 是否启用该 pass。 */
  enabled?: boolean;
}

/** 内部:单级 mip 的 FBO 对。 */
interface MipRT {
  width: number;
  height: number;
  fboH: WebGLFramebuffer;
  texH: WebGLTexture;
  fboV: WebGLFramebuffer;
  texV: WebGLTexture;
}

/** 高斯模糊方向。 */
const DIR_X = new Float32Array([1, 0]);
const DIR_Y = new Float32Array([0, 1]);

/** 每级 mip 的高斯核半径(取自 three.js PR #31528,与 sigma=R/3 配合)。 */
const KERNEL_SIZES: [number, number, number, number, number] = [6, 10, 14, 18, 22];
const BLOOM_FACTORS_DEFAULT: [number, number, number, number, number] = [1.0, 0.8, 0.6, 0.4, 0.2];
const BLOOM_TINTS_DEFAULT: [
  [number, number, number],
  [number, number, number],
  [number, number, number],
  [number, number, number],
  [number, number, number]
] = [
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [1, 1, 1],
];
const NMIPS = 5;

export class UnrealBloomPass extends RenderPass {
  readonly name = 'unreal-bloom';
  enabled: boolean;

  strength: number;
  radius: number;
  threshold: number;
  smoothWidth: number;
  mipFactors: [number, number, number, number, number];
  mipTints: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number],
    [number, number, number]
  ];
  dirtTexture: WebGLTexture | null;
  dirtStrength: number;

  /** pass 私有的 FBO(5 级 mip + bright target)。首次 apply 时按 ctx 尺寸创建。 */
  private _cacheKey: string = '';
  private _bright: { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number } | null = null;
  private _mips: MipRT[] = [];
  /** 1x1 黑色默认纹理(供 dirtTexture=null 时绑定,避免 sampler 空引用)。 */
  private _blackTex: WebGLTexture | null = null;

  constructor(opts: UnrealBloomOptions = {}) {
    super();
    this.strength = opts.strength ?? 1.0;
    this.radius = opts.radius ?? 0.5;
    this.threshold = opts.threshold ?? 0.85;
    this.smoothWidth = opts.smoothWidth ?? 0.01;
    this.mipFactors = opts.mipFactors ?? BLOOM_FACTORS_DEFAULT;
    this.mipTints = opts.mipTints ?? BLOOM_TINTS_DEFAULT;
    this.dirtTexture = opts.dirtTexture ?? null;
    this.dirtStrength = opts.dirtStrength ?? 0;
    this.enabled = opts.enabled ?? true;
  }

  // ── helpers ──────────────────────────────────────────────────

  private static _createFloatTex(
    gl: WebGL2RenderingContext,
    w: number,
    h: number
  ): WebGLTexture {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    // HALF_FLOAT(ext) -> 更省带宽;WebGL2 原生支持 RGBA16F 作为 color attachment。
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA16F,
      w,
      h,
      0,
      gl.RGBA,
      gl.HALF_FLOAT,
      null
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private static _createFBO(
    gl: WebGL2RenderingContext,
    tex: WebGLTexture
  ): WebGLFramebuffer {
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0
    );
    return fbo;
  }

  private _ensureSize(ctx: PassContext) {
    const key = `${ctx.width}x${ctx.height}`;
    if (this._cacheKey === key && this._mips.length === NMIPS) return;
    this._disposeGPU(ctx.gl);

    const gl = ctx.gl;
    let w = Math.max(1, Math.round(ctx.width / 2));
    let h = Math.max(1, Math.round(ctx.height / 2));

    // bright target (half-res)
    const brightTex = UnrealBloomPass._createFloatTex(gl, w, h);
    const brightFbo = UnrealBloomPass._createFBO(gl, brightTex);
    this._bright = { fbo: brightFbo, tex: brightTex, w, h };

    // 5-level mip chain (each half the previous)
    this._mips = [];
    for (let i = 0; i < NMIPS; i++) {
      const texH = UnrealBloomPass._createFloatTex(gl, w, h);
      const fboH = UnrealBloomPass._createFBO(gl, texH);
      const texV = UnrealBloomPass._createFloatTex(gl, w, h);
      const fboV = UnrealBloomPass._createFBO(gl, texV);
      this._mips.push({ width: w, height: h, fboH, texH, fboV, texV });
      w = Math.max(1, Math.round(w / 2));
      h = Math.max(1, Math.round(h / 2));
    }

    // 1x1 black texture for dirt fallback
    if (!this._blackTex) {
      this._blackTex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this._blackTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R8,
        1,
        1,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        new Uint8Array([0])
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    this._cacheKey = key;
  }

  private _disposeGPU(gl: WebGL2RenderingContext) {
    if (this._bright) {
      gl.deleteFramebuffer(this._bright.fbo);
      gl.deleteTexture(this._bright.tex);
      this._bright = null;
    }
    for (const m of this._mips) {
      gl.deleteFramebuffer(m.fboH);
      gl.deleteTexture(m.texH);
      gl.deleteFramebuffer(m.fboV);
      gl.deleteTexture(m.texV);
    }
    this._mips = [];
    this._cacheKey = '';
  }

  override dispose(_ctx: PassContext): void {
    const gl = _ctx.gl;
    this._disposeGPU(gl);
    if (this._blackTex) {
      gl.deleteTexture(this._blackTex);
      this._blackTex = null;
    }
  }

  // ── main apply ───────────────────────────────────────────────

  override apply(input: WebGLTexture, ctx: PassContext): WebGLTexture {
    if (!this.enabled) return input;
    this._ensureSize(ctx);

    const gl = ctx.gl;
    const vao = ctx.fullscreenQuad;
    // Helper: bind sampler 2D to unit and set uniform-sampler.
    const bindTex2D = (prog: ReturnType<PassContext['getProgram']>, name: string, unit: number, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      prog.setUniformSampler(name, unit);
    };

    // We use ctx.resources.bloomFbo2 as the final additive blend render target,
    // then return bloomTexture2 as our output so the next pass in the pipeline
    // (usually FinalCompose / Output) reads our additive result.
    const outFBO = ctx.resources.bloomFbo2;
    const outTex = ctx.resources.bloomTexture2;

    // ── 1. high-pass ─────────────────────────────────────────
    const bright = this._bright!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, bright.fbo);
    gl.viewport(0, 0, bright.w, bright.h);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    {
      const p = ctx.getProgram('unreal-bloom-highpass', POST_VERT_SRC, BLOOM_HIGHPASS_FRAG);
      p.use();
      bindTex2D(p, 'u_colorMap', 0, input);
      p.setUniform1f('u_luminosityThreshold', this.threshold);
      p.setUniform1f('u_smoothWidth', Math.max(1e-4, this.smoothWidth));
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    // ── 2. per-mip separable Gaussian blur ───────────────────
    let srcTex: WebGLTexture = bright.tex;
    for (let i = 0; i < NMIPS; i++) {
      const mip = this._mips[i];
      const frag = BLOOM_GAUSSIAN_FRAG(KERNEL_SIZES[i]);
      const progKey = `unreal-bloom-gauss-${KERNEL_SIZES[i]}`;
      const invSize = new Float32Array([1 / mip.width, 1 / mip.height]);

      // Horizontal pass  -> mip.texH
      gl.bindFramebuffer(gl.FRAMEBUFFER, mip.fboH);
      gl.viewport(0, 0, mip.width, mip.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      {
        const p = ctx.getProgram(progKey, POST_VERT_SRC, frag);
        p.use();
        bindTex2D(p, 'u_colorMap', 0, srcTex);
        p.setUniform2f('u_invSize', invSize[0], invSize[1]);
        p.setUniform2f('u_direction', DIR_X[0], DIR_X[1]);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
      }

      // Vertical pass    -> mip.texV
      gl.bindFramebuffer(gl.FRAMEBUFFER, mip.fboV);
      gl.clear(gl.COLOR_BUFFER_BIT);
      {
        const p = ctx.getProgram(progKey, POST_VERT_SRC, frag);
        p.use();
        bindTex2D(p, 'u_colorMap', 0, mip.texH);
        p.setUniform2f('u_invSize', invSize[0], invSize[1]);
        p.setUniform2f('u_direction', DIR_Y[0], DIR_Y[1]);
        gl.bindVertexArray(vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
      }

      srcTex = mip.texV; // feed coarser mip with finer blurred
    }

    // ── 3. composite 5 mips + dirt -> reuse mip[0].texH ─────
    const m0 = this._mips[0];
    gl.bindFramebuffer(gl.FRAMEBUFFER, m0.fboH);
    gl.viewport(0, 0, m0.width, m0.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    {
      const p = ctx.getProgram(
        'unreal-bloom-composite',
        POST_VERT_SRC,
        BLOOM_COMPOSITE_FRAG
      );
      p.use();
      bindTex2D(p, 'u_blurTex0', 0, this._mips[0].texV);
      bindTex2D(p, 'u_blurTex1', 1, this._mips[1].texV);
      bindTex2D(p, 'u_blurTex2', 2, this._mips[2].texV);
      bindTex2D(p, 'u_blurTex3', 3, this._mips[3].texV);
      bindTex2D(p, 'u_blurTex4', 4, this._mips[4].texV);
      p.setUniform1f('u_bloomStrength', this.strength);
      p.setUniform1f('u_bloomRadius', Math.max(0, Math.min(1, this.radius)));
      // u_bloomFactors: 5-element float array
      {
        const loc = p.uniforms.get('u_bloomFactors');
        if (loc) gl.uniform1fv(loc, new Float32Array(this.mipFactors));
      }
      // u_bloomTints: 5× vec3 (15 floats)
      const tints = new Float32Array(15);
      for (let i = 0; i < 5; i++) {
        tints[i * 3] = this.mipTints[i][0];
        tints[i * 3 + 1] = this.mipTints[i][1];
        tints[i * 3 + 2] = this.mipTints[i][2];
      }
      {
        const loc = p.uniforms.get('u_bloomTints');
        if (loc) gl.uniform3fv(loc, tints);
      }
      // dirt: slot 5
      const dirtTex = this.dirtTexture ?? this._blackTex!;
      bindTex2D(p, 'u_dirtTexture', 5, dirtTex);
      p.setUniform1f('u_dirtStrength', this.dirtStrength);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    // ── 4. additive blend onto source -> bloomTexture2 ──────
    gl.bindFramebuffer(gl.FRAMEBUFFER, outFBO);
    gl.viewport(0, 0, ctx.width, ctx.height);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT);
    {
      const p = ctx.getProgram(
        'unreal-bloom-additive',
        POST_VERT_SRC,
        BLOOM_ADDITIVE_BLEND_FRAG
      );
      p.use();
      bindTex2D(p, 'u_colorMap', 0, input);
      bindTex2D(p, 'u_bloomMap', 1, m0.texH);
      p.setUniform1f('u_bloomStrength', 1.0); // final tweak knob (1 = composite说了算)
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
    }

    // restore default framebuffer binding
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // reset active texture to 0 (common courtesy for downstream passes)
    gl.activeTexture(gl.TEXTURE0);

    return outTex;
  }
}
