// GPUParticleSystem — GPU 粒子系统(纹理 ping-pong 模拟 + POINTS 渲染)。
//
// 设计目标:
//   - 把每个粒子的状态(position/velocity/meta)存在 RGBA32F 纹理的 texel 中,
//     在 fragment shader 中进行模拟(MRT 单 pass 同时写 position+velocity),
//     渲染时用 gl_VertexID 从纹理 fetch 位置,以 POINTS 绘制。
//   - 全程零 CPU→GPU 粒子数据回读,可支持 65536+ 粒子(受纹理大小限制)。
//   - 与 ParticleSystem2(CPU 粒子)平行:CPU 粒子支持复杂 modifier/拖尾/子发射器,
//     GPU 粒子追求高吞吐量(火焰/烟尘/星空/雨雪等大量简单粒子)。
//
// 数据布局(每粒子 1 texel,maxParticles = sizeX * sizeY):
//   positionTex (RGBA32F) ping-pong ×2: xyz = 世界位置, w = life ratio [0,1]
//     (1 = 刚复活, 0 = 死亡)
//   velocityTex (RGBA32F) ping-pong ×2: xyz = 速度 (m/s), w = age (秒, 已存活)
//   metaTex (RGBA32F) 静态 ×1: r = maxLife (s), g = startSize, b = endSize,
//     a = seed (用于 spawn 随机)
//
// 模拟流程(update, MRT 单 pass):
//   1. 读旧 positionTex/velocityTex/metaTex
//   2. 判断 texelId 是否在 [spawnStart, spawnStart+spawnCount) 环形范围内
//      且 life<=0 → 复活(emitterPos + 球形随机偏移, 随机方向 × startSpeed)
//   3. 否则若 life>0 积分:半隐式 Euler
//        vel += gravity*dt; vel *= (1 - drag*dt); pos += vel*dt;
//        age += dt; life = max(0, 1 - age/maxLife)
//   4. swap ping-pong read 索引
//
// 渲染流程(render, POINTS + gl_VertexID):
//   vertex: tid → texelCoord → fetch positionTex/metaTex → clipPos + PointSize
//   fragment: 圆形 sprite(1-r² 软边) + color over life + sin(life·π) alpha fade
//
// 与 ParticleSystem2 的差异:
//   * ParticleSystem2 在 CPU 上积分,支持 ForceField/Vortex/Turbulence 等 modifier、
//     拖尾、子发射器,但受 JS 单线程限制(~10k 粒子上限)。
//   * GPUParticleSystem 在 GPU 上积分,无 modifier/拖尾,但支持 65536+ 粒子,
//     适合火焰、烟尘、星空、雨雪等大量简单粒子。
//
// 参考:
//   - GPU Gems 3 Ch.23 "High-Performance Screen-Space Particles"
//   - o3de Atom, RPI ParticleSystem
//   - three.js GPGPU particles (Yomboprime)
//   - Thomas 2014 "DirectCompute Optimizations for GPU Particles"

import type { Camera } from '../Cameras/Camera';
import {
  GPU_PARTICLE_SIM_FRAG,
  GPU_PARTICLE_RENDER_VERT,
  GPU_PARTICLE_RENDER_FRAG,
  POST_VERT,
} from '../Materials/shaders';
import { ShaderProgram } from '../Renderer/ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('GPUParticleSystem');

export interface GPUParticleOptions {
  /** 最大粒子数(向上取整到完全方形纹理,默认 65536 = 256×256)。 */
  maxParticles?: number;
  /** 发射速率(粒子/秒,默认 1000)。 */
  emissionRate?: number;
  /** 发射器世界位置(默认 (0, 0, 0))。 */
  emitterPosition?: [number, number, number];
  /** 发射器基础速度(所有粒子共有的方向偏移,默认 (0, 0, 0))。 */
  emitterVelocity?: [number, number, number];
  /** 球形发射半径(默认 0.5,粒子在 emitterPosition ± radius 球内随机出生)。 */
  emitterRadius?: number;
  /** 初始速度大小(默认 2 m/s)。 */
  startSpeed?: number;
  /** 初始速度随机变化 0..1(默认 0.5,实际速度 = startSpeed × (1-var + var×rand))。 */
  startSpeedVariance?: number;
  /** 寿命范围(秒,默认 {min:1, max:3})。 */
  lifetime?: { min: number; max: number };
  /** 起始大小(世界单位,默认 0.1)。 */
  startSize?: number;
  /** 结束大小(默认 0.0)。 */
  endSize?: number;
  /** 重力加速度(m/s²,默认 (0, -9.8, 0))。 */
  gravity?: [number, number, number];
  /** 速度阻尼(1/秒,默认 0)。 */
  drag?: number;
  /** 起始颜色(life=1,默认 (1, 1, 1))。 */
  startColor?: [number, number, number];
  /** 结束颜色(life=0,默认 (0.2, 0.2, 0.2))。 */
  endColor?: [number, number, number];
  /** 全局大小缩放(默认 1)。 */
  sizeScale?: number;
  /** 全局 alpha 缩放(默认 1)。 */
  alphaScale?: number;
  /** 混合模式(默认 'additive' 加性,'alpha' 普通 alpha)。 */
  blendMode?: 'additive' | 'alpha';
  /** 是否启用(默认 true)。 */
  enabled?: boolean;
  /** devicePixelRatio(默认 1,影响 gl_PointSize)。 */
  pixelRatio?: number;
}

/**
 * GPU 粒子系统。纹理 ping-pong 模拟 + POINTS 渲染。
 *
 * 每帧调用 `update(gl, dt)` 推进模拟,然后 `render(gl, camera)` 绘制。
 * 模拟在 fragment shader(MRT)中执行,渲染在 vertex shader(gl_VertexID fetch)中执行,
 * 全程零 CPU→GPU 粒子数据回读。
 *
 * @example
 * ```ts
 * const particles = new GPUParticleSystem({
 *   maxParticles: 65536,
 *   emissionRate: 5000,
 *   emitterPosition: [0, 0, 0],
 *   startColor: [1, 0.6, 0.1],   // 橙色火焰
 *   endColor: [0.5, 0.1, 0],
 *   startSpeed: 3,
 *   lifetime: { min: 0.5, max: 1.5 },
 *   blendMode: 'additive',
 * });
 * // 每帧:
 * particles.update(gl, dt);
 * particles.render(gl, camera);
 * ```
 */
export class GPUParticleSystem {
  readonly name = 'gpuparticles';
  /** 实际粒子容量(sizeX × sizeY,可能 ≥ 构造时传入的 maxParticles)。 */
  readonly maxParticles: number;
  readonly sizeX: number;
  readonly sizeY: number;

  emissionRate: number;
  emitterPosition: [number, number, number];
  emitterVelocity: [number, number, number];
  emitterRadius: number;
  startSpeed: number;
  startSpeedVariance: number;
  lifetimeMin: number;
  lifetimeMax: number;
  startSize: number;
  endSize: number;
  gravity: [number, number, number];
  drag: number;
  startColor: [number, number, number];
  endColor: [number, number, number];
  sizeScale: number;
  alphaScale: number;
  blendMode: 'additive' | 'alpha';
  enabled: boolean;
  pixelRatio: number;

  // ── GL 资源 ──────────────────────────────────────────────────────
  private _positionTex: [WebGLTexture, WebGLTexture] | null = null;
  private _velocityTex: [WebGLTexture, WebGLTexture] | null = null;
  private _metaTex: WebGLTexture | null = null;
  private _simFbo: WebGLFramebuffer | null = null;
  private _simVao: WebGLVertexArrayObject | null = null;
  private _simBuf: WebGLBuffer | null = null;
  private _renderVao: WebGLVertexArrayObject | null = null;
  private _simProgram: ShaderProgram | null = null;
  private _renderProgram: ShaderProgram | null = null;

  /** 当前读取索引(0 或 1);simulate 写入 (1-readIndex),完成后 swap。 */
  private _readIndex: 0 | 1 = 0;
  /** 复活游标(0..maxParticles-1,每帧环形前进)。 */
  private _spawnCursor: number = 0;
  /** 发射累积(小数部分,避免低速时漏发射)。 */
  private _spawnAccum: number = 0;
  /** 全局时间(秒,用于 spawn 随机种子)。 */
  private _time: number = 0;
  private _initialized: boolean = false;
  private _dirty: boolean = true;

  constructor(opts: GPUParticleOptions = {}) {
    const requested = Math.max(1, Math.floor(opts.maxParticles ?? 65536));
    // 向上取整到方形纹理:sizeX = ceil(sqrt(n)), sizeY = ceil(n / sizeX)
    const sx = Math.max(1, Math.ceil(Math.sqrt(requested)));
    const sy = Math.max(1, Math.ceil(requested / sx));
    this.sizeX = sx;
    this.sizeY = sy;
    this.maxParticles = sx * sy;

    this.emissionRate = opts.emissionRate ?? 1000;
    this.emitterPosition = opts.emitterPosition ?? [0, 0, 0];
    this.emitterVelocity = opts.emitterVelocity ?? [0, 0, 0];
    this.emitterRadius = opts.emitterRadius ?? 0.5;
    this.startSpeed = opts.startSpeed ?? 2;
    this.startSpeedVariance = opts.startSpeedVariance ?? 0.5;
    const lt = opts.lifetime ?? { min: 1, max: 3 };
    this.lifetimeMin = lt.min;
    this.lifetimeMax = lt.max;
    this.startSize = opts.startSize ?? 0.1;
    this.endSize = opts.endSize ?? 0.0;
    this.gravity = opts.gravity ?? [0, -9.8, 0];
    this.drag = opts.drag ?? 0;
    this.startColor = opts.startColor ?? [1, 1, 1];
    this.endColor = opts.endColor ?? [0.2, 0.2, 0.2];
    this.sizeScale = opts.sizeScale ?? 1;
    this.alphaScale = opts.alphaScale ?? 1;
    this.blendMode = opts.blendMode ?? 'additive';
    this.enabled = opts.enabled ?? true;
    this.pixelRatio = opts.pixelRatio ?? 1;
  }

  /** 当前读取的位置纹理(update 后是最新状态)。 */
  get positionTexture(): WebGLTexture | null {
    return this._positionTex ? this._positionTex[this._readIndex] : null;
  }

  /** 当前读取的速度纹理。 */
  get velocityTexture(): WebGLTexture | null {
    return this._velocityTex ? this._velocityTex[this._readIndex] : null;
  }

  /** 静态元数据纹理(maxLife/startSize/endSize/seed)。 */
  get metaTexture(): WebGLTexture | null {
    return this._metaTex;
  }

  /** 全局时间(秒)。 */
  get time(): number {
    return this._time;
  }

  /** 复活游标(下一个待复活的 texel id)。 */
  get spawnCursor(): number {
    return this._spawnCursor;
  }

  /**
   * 推进一步模拟。
   *
   * 在 MRT fragment shader 中同时写 positionTex + velocityTex:
   *   - 复活 texelId 在 [spawnStart, spawnStart+spawnCount) 环形范围内且 life<=0 的粒子;
   *   - 积分 life>0 的粒子(半隐式 Euler);
   *   - life<=0 且不复活 → 保持死亡状态。
   *
   * @param gl WebGL2 上下文(需启用 EXT_color_buffer_float 扩展以渲染 RGBA32F)
   * @param dt 帧时间(秒)
   */
  update(gl: WebGL2RenderingContext, dt: number): void {
    if (!this.enabled) return;
    if (this._dirty || !this._initialized) {
      this._initResources(gl);
      this._dirty = false;
    }

    // ── 计算本帧复活数(累积小数部分) ───────────────────────────
    this._spawnAccum += this.emissionRate * dt;
    const spawnThisFrame = Math.min(this.maxParticles, Math.max(0, Math.floor(this._spawnAccum)));
    this._spawnAccum -= spawnThisFrame;

    const spawnStart = this._spawnCursor;
    this._spawnCursor = (this._spawnCursor + spawnThisFrame) % this.maxParticles;
    this._time += dt;

    // ── simulate pass(MRT) ──────────────────────────────────────
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._simFbo as WebGLFramebuffer);
    // ping-pong:每帧重绑 write 索引的纹理到 MRT attachment
    // (read=readIndex,write=1-readIndex)
    this._bindWriteAttachments(gl);
    // MRT:同时绘制到 COLOR_ATTACHMENT0(position) + COLOR_ATTACHMENT1(velocity)
    (gl as WebGL2RenderingContext).drawBuffers([
      (gl as WebGL2RenderingContext).COLOR_ATTACHMENT0,
      (gl as WebGL2RenderingContext).COLOR_ATTACHMENT1,
    ]);
    gl.viewport(0, 0, this.sizeX, this.sizeY);
    gl.disable(gl.BLEND);
    gl.colorMask(true, true, true, true);

    const prog = this._getSimProgram(gl);
    prog.use();

    // 绑定读取纹理(readIndex 指向上一轮结果)
    const read = this._readIndex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._positionTex![read]);
    prog.setUniformSampler('u_positionTex', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._velocityTex![read]);
    prog.setUniformSampler('u_velocityTex', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this._metaTex as WebGLTexture);
    prog.setUniformSampler('u_metaTex', 2);

    // uniforms
    prog.setUniform2f('u_texelSize', 1 / this.sizeX, 1 / this.sizeY);
    prog.setUniform1i('u_sizeX', this.sizeX);
    prog.setUniform1i('u_maxParticles', this.maxParticles);
    prog.setUniform1f('u_dt', dt);
    const ep = this.emitterPosition;
    prog.setUniform3f('u_emitterPos', ep[0], ep[1], ep[2]);
    const ev = this.emitterVelocity;
    prog.setUniform3f('u_emitterVel', ev[0], ev[1], ev[2]);
    prog.setUniform1f('u_emitterRadius', this.emitterRadius);
    prog.setUniform1f('u_startSpeed', this.startSpeed);
    prog.setUniform1f('u_startSpeedVar', this.startSpeedVariance);
    const g = this.gravity;
    prog.setUniform3f('u_gravity', g[0], g[1], g[2]);
    prog.setUniform1f('u_drag', this.drag);
    prog.setUniform1i('u_spawnStart', spawnStart);
    prog.setUniform1i('u_spawnCount', spawnThisFrame);
    prog.setUniform1f('u_time', this._time);
    prog.setUniform1i('u_enabled', 1);

    gl.bindVertexArray(this._simVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // ── swap ping-pong ──────────────────────────────────────────
    this._readIndex = (this._readIndex === 0 ? 1 : 0) as 0 | 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindVertexArray(null);
  }

  /**
   * 渲染所有活跃粒子。
   *
   * 用 POINTS + gl_VertexID 从 positionTex/metaTex fetch 数据:
   *   - vertex:tid → texelCoord → fetch → clipPos + PointSize(life<=0 裁剪)
   *   - fragment:圆形 sprite + color over life + sin(life·π) alpha fade
   *
   * 混合模式:additive 用 ONE/ONE(预乘 alpha),alpha 用 SRC_ALPHA/ONE_MINUS_SRC_ALPHA。
   * 渲染期间禁用深度写入(深度测试仍启用,粒子间不排序)。
   *
   * @param gl     WebGL2 上下文
   * @param camera 当前相机(读取 projection / view)
   */
  render(gl: WebGL2RenderingContext, camera: Camera): void {
    if (!this.enabled || !this._initialized) return;

    const prog = this._getRenderProgram(gl);
    prog.use();

    const read = this._readIndex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this._positionTex![read]);
    prog.setUniformSampler('u_positionTex', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this._metaTex as WebGLTexture);
    prog.setUniformSampler('u_metaTex', 1);

    prog.setUniform2f('u_texelSize', 1 / this.sizeX, 1 / this.sizeY);
    prog.setUniform1i('u_sizeX', this.sizeX);
    prog.setUniformMatrix4fv('u_viewProjection', this._computeVP(camera));
    const w = gl.canvas.width;
    const h = gl.canvas.height;
    prog.setUniform2f('u_viewportSize', w, h);
    prog.setUniform1f('u_sizeScale', this.sizeScale);
    prog.setUniform1f('u_pixelRatio', this.pixelRatio);

    const sc = this.startColor;
    prog.setUniform3f('u_startColor', sc[0], sc[1], sc[2]);
    const ec = this.endColor;
    prog.setUniform3f('u_endColor', ec[0], ec[1], ec[2]);
    prog.setUniform1f('u_alphaScale', this.alphaScale);
    prog.setUniform1i('u_blendMode', this.blendMode === 'additive' ? 0 : 1);

    // 混合状态
    gl.enable(gl.BLEND);
    if (this.blendMode === 'additive') {
      // 预乘 alpha 加性:out = src.rgb(已 ×alpha) × 1 + dst × 1
      gl.blendFunc(gl.ONE, gl.ONE);
    } else {
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.depthMask(false); // 粒子不写深度,避免互相遮挡

    gl.bindVertexArray(this._renderVao as WebGLVertexArrayObject);
    gl.drawArrays(gl.POINTS, 0, this.maxParticles);

    // 恢复状态
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }

  /** 重置:清空所有粒子(life=0),重置游标与时间。 */
  reset(gl: WebGL2RenderingContext): void {
    if (!this._initialized) return;
    const len = this.maxParticles * 4;
    const zeros = new Float32Array(len);
    // positionTex[0/1] + velocityTex[0/1] 全清零(life=0 → 死亡)
    for (let i = 0; i < 2; i++) {
      gl.bindTexture(gl.TEXTURE_2D, this._positionTex![i]);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, (gl as WebGL2RenderingContext).RGBA32F,
        this.sizeX, this.sizeY, 0, gl.RGBA, gl.FLOAT, zeros,
      );
      gl.bindTexture(gl.TEXTURE_2D, this._velocityTex![i]);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, (gl as WebGL2RenderingContext).RGBA32F,
        this.sizeX, this.sizeY, 0, gl.RGBA, gl.FLOAT, zeros,
      );
    }
    this._readIndex = 0;
    this._spawnCursor = 0;
    this._spawnAccum = 0;
    this._time = 0;
    log.debug('reset');
  }

  /** 标记下一帧需要重建资源(分辨率/上下文丢失等)。 */
  setDirty(): void {
    this._dirty = true;
  }

  /** 释放 GPU 资源。可重复调用。 */
  dispose(gl?: WebGL2RenderingContext): void {
    if (gl) {
      if (this._positionTex) {
        gl.deleteTexture(this._positionTex[0]);
        gl.deleteTexture(this._positionTex[1]);
      }
      if (this._velocityTex) {
        gl.deleteTexture(this._velocityTex[0]);
        gl.deleteTexture(this._velocityTex[1]);
      }
      if (this._metaTex) gl.deleteTexture(this._metaTex);
      if (this._simFbo) gl.deleteFramebuffer(this._simFbo);
      if (this._simVao) gl.deleteVertexArray(this._simVao);
      if (this._simBuf) gl.deleteBuffer(this._simBuf);
      if (this._renderVao) gl.deleteVertexArray(this._renderVao);
      if (this._simProgram) this._simProgram.dispose();
      if (this._renderProgram) this._renderProgram.dispose();
    }
    this._positionTex = null;
    this._velocityTex = null;
    this._metaTex = null;
    this._simFbo = null;
    this._simVao = null;
    this._simBuf = null;
    this._renderVao = null;
    this._simProgram = null;
    this._renderProgram = null;
    this._initialized = false;
    this._dirty = true;
    this._readIndex = 0;
    this._spawnCursor = 0;
    this._spawnAccum = 0;
    this._time = 0;
    log.debug('disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  private _initResources(gl: WebGL2RenderingContext): void {
    const sx = this.sizeX;
    const sy = this.sizeY;
    const len = sx * sy * 4;
    const gl2 = gl as WebGL2RenderingContext;

    // ── positionTex[2] + velocityTex[2](RGBA32F ping-pong) ──────
    const posTex0 = gl.createTexture()!;
    const posTex1 = gl.createTexture()!;
    const velTex0 = gl.createTexture()!;
    const velTex1 = gl.createTexture()!;
    this._positionTex = [posTex0, posTex1];
    this._velocityTex = [velTex0, velTex1];

    const zeros = new Float32Array(len);
    for (const [t, data] of [
      [posTex0, zeros], [posTex1, zeros],
      [velTex0, zeros], [velTex1, zeros],
    ] as [WebGLTexture, Float32Array][]) {
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl2.RGBA32F, sx, sy, 0, gl.RGBA, gl.FLOAT, data);
      // 浮点数据纹理必须 NEAREST + CLAMP,避免插值与接缝
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    // ── metaTex(RGBA32F 静态:r=maxLife, g=startSize, b=endSize, a=seed) ──
    this._metaTex = gl.createTexture();
    const meta = new Float32Array(len);
    for (let i = 0; i < sx * sy; i++) {
      const off = i * 4;
      // maxLife 在 [lifetimeMin, lifetimeMax] 随机
      const t = Math.random();
      meta[off + 0] = this.lifetimeMin + (this.lifetimeMax - this.lifetimeMin) * t;
      meta[off + 1] = this.startSize;
      meta[off + 2] = this.endSize;
      meta[off + 3] = Math.random(); // seed
    }
    gl.bindTexture(gl.TEXTURE_2D, this._metaTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl2.RGBA32F, sx, sy, 0, gl.RGBA, gl.FLOAT, meta);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // ── MRT FBO(simulate pass 输出 position + velocity) ──────────
    // 绑定 write 索引(初始 readIndex=0 → 写 1;但 FBO 在每帧需要重绑。
    // 这里创建空 FBO,每帧 update 时由 framebufferTexture2D 绑定 write 纹理。
    // 为简化,我们在 _initResources 中绑定 write=index 1(初始),update 时每帧重绑。
    // 实际上 FBO 的 attachment 可以持久绑定一张纹理,但我们 ping-pong,
    // 所以每帧需要重绑 attachment。这里只创建 FBO 对象。
    this._simFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._simFbo);
    // 初始绑定 write=index 1(readIndex 初始 0 → 写 1)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, posTex1, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velTex1, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    // ── simVao(空 VAO + 全屏三角形) ───────────────────────────
    this._simBuf = gl.createBuffer();
    this._simVao = gl.createVertexArray();
    gl.bindVertexArray(this._simVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._simBuf);
    const verts = new Float32Array([-1, -1, 3, -1, -1, 3]);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    // ── renderVao(空 VAO,POINTS,顶点靠 gl_VertexID) ───────────
    this._renderVao = gl.createVertexArray();

    this._initialized = true;
    log.info(`GPUParticleSystem initialized: ${sx}×${sy} = ${this.maxParticles} particles`);
  }

  /**
   * 每帧 update 前绑定 write 索引的纹理到 MRT FBO。
   * (ping-pong:read=readIndex,write=1-readIndex)
   */
  private _bindWriteAttachments(gl: WebGL2RenderingContext): void {
    const write = this._readIndex === 0 ? 1 : 0;
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D,
      this._positionTex![write], 0,
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D,
      this._velocityTex![write], 0,
    );
  }

  private _getSimProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._simProgram) {
      this._simProgram = new ShaderProgram(gl, POST_VERT, GPU_PARTICLE_SIM_FRAG);
    }
    return this._simProgram;
  }

  private _getRenderProgram(gl: WebGL2RenderingContext): ShaderProgram {
    if (!this._renderProgram) {
      this._renderProgram = new ShaderProgram(
        gl, GPU_PARTICLE_RENDER_VERT, GPU_PARTICLE_RENDER_FRAG,
      );
    }
    return this._renderProgram;
  }

  /** VP = projection × view(column-major 4×4 乘法)。 */
  private _computeVP(camera: Camera): Float32Array {
    const proj = camera.projectionMatrix.elements;
    const view = camera.matrixWorldInverse.elements;
    const vp = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += view[k * 4 + r] * proj[c * 4 + k];
        }
        vp[c * 4 + r] = sum;
      }
    }
    return vp;
  }
}
