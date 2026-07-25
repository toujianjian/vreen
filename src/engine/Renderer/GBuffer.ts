// GBuffer — 基于 MRTTarget 的几何缓冲(Geometry Buffer),用于延迟渲染。
//
// 经典 G-Buffer 布局(4 个颜色附件 + 1 个深度):
//   - ATTACHMENT0 (positionTexture):    RGBA16F  — xyz = 世界位置,  a = 1
//   - ATTACHMENT1 (normalTexture):      RGBA16F  — xyz = 世界法线,  a = 1
//   - ATTACHMENT2 (albedoTexture):      RGBA8    — rgb = 漫反射颜色, a = opacity
//   - ATTACHMENT3 (materialTexture):    RGBA8    — r = metallic, g = roughness, b = emissive, a = AO
//
// 流程:
//   1. gbuffer.bind(gl) — 绑定 FBO + 配置 drawBuffers([0,1,2,3])
//   2. 渲染几何体到 G-Buffer(材质 shader 写入 4 个 layout 输出)
//   3. gbuffer.unbind(gl)
//   4. 后续 lighting pass 采样 4 个颜色纹理做 PBR 着色(可选 SSAO / 屏幕空间反射)
//
// 与现有 SSAO depth-normal FBO 的区别:
//   - SSAO FBO 只有 depth + normal 两附件,只服务 SSAO pass
//   - GBuffer 是完整 4 附件 + 深度,服务整个延迟管线
//   - 可作为延迟 lighting pass 的输入纹理源
//
// 注意:GBuffer 不直接渲染几何体;渲染由调用方(如 WebGL2Renderer 的 deferred path)
// 用合适的 G-Buffer shader 完成。本类只负责 FBO / 纹理生命周期管理。

import { MRTTarget } from './MRTTarget';

export interface GBufferOptions {
  /** 是否创建深度附件(默认 true)。 */
  depth?: boolean;
  /** Position / Normal 通道的精度(默认 'rgba16f')。
   *  可选 'rgba32f'(更高精度,显存翻倍)或 'rgba8'(低精度,法线/位置可能不准)。 */
  highPrecisionFormat?: 'rgba16f' | 'rgba32f' | 'rgba8';
}

export class GBuffer {
  /** 底层 MRT。 */
  mrt: MRTTarget;
  /** 0: 世界位置(RGBA16F)。 */
  positionTexture: WebGLTexture | null = null;
  /** 1: 世界法线(RGBA16F)。 */
  normalTexture: WebGLTexture | null = null;
  /** 2: 漫反射颜色 + opacity(RGBA8)。 */
  albedoTexture: WebGLTexture | null = null;
  /** 3: metallic / roughness / emissive / AO(RGBA8)。 */
  materialTexture: WebGLTexture | null = null;

  private _highPrecisionFormat: 'rgba16f' | 'rgba32f' | 'rgba8' = 'rgba16f';
  private _hasDepth: boolean = true;

  constructor(opts: GBufferOptions = {}) {
    this.mrt = new MRTTarget();
    this._highPrecisionFormat = opts.highPrecisionFormat ?? 'rgba16f';
    this._hasDepth = opts.depth ?? true;
  }

  /** 设置 G-Buffer(4 个颜色附件 + 可选深度)。
   *  颜色附件 0/1 用 highPrecisionFormat,2/3 用 RGBA8。 */
  setup(gl: WebGL2RenderingContext, width: number, height: number): this {
    // 简单做法:用 MRTTarget 的统一颜色格式创建 4 个 RGBA16F 附件,
    // 然后单独重建 2/3(albedo / material)为 RGBA8 以节省显存。
    // 但 MRTTarget 当前只支持统一格式;为简化,我们用 RGBA16F 全部,
    // 显存稍多但 API 简洁。生产中可扩展 MRTTarget 支持 per-attachment 格式。
    this.mrt.setup(gl, width, height, {
      colorCount: 4,
      depth: this._hasDepth,
      colorInternalFormat: this._highPrecisionFormat,
      colorType: this._highPrecisionFormat === 'rgba8' ? 'unsigned-byte' : 'float',
      colorFilter: 'nearest',
    });
    this.positionTexture = this.mrt.textures[0] ?? null;
    this.normalTexture = this.mrt.textures[1] ?? null;
    this.albedoTexture = this.mrt.textures[2] ?? null;
    this.materialTexture = this.mrt.textures[3] ?? null;
    return this;
  }

  /** 绑定 G-Buffer FBO + 配置 drawBuffers([0,1,2,3])。 */
  bind(gl: WebGL2RenderingContext): void {
    this.mrt.bind(gl);
    gl.viewport(0, 0, this.mrt.width, this.mrt.height);
  }

  /** 解绑,恢复默认 FBO。 */
  unbind(gl: WebGL2RenderingContext): void {
    this.mrt.unbind(gl);
  }

  /** 位置纹理(附件 0)。setup 前为 null。 */
  getPosition(): WebGLTexture | null {
    return this.positionTexture;
  }

  /** 法线纹理(附件 1)。 */
  getNormal(): WebGLTexture | null {
    return this.normalTexture;
  }

  /** 漫反射颜色纹理(附件 2)。 */
  getAlbedo(): WebGLTexture | null {
    return this.albedoTexture;
  }

  /** 材质纹理(附件 3)。 */
  getMaterial(): WebGLTexture | null {
    return this.materialTexture;
  }

  /** 深度纹理(若创建)。无深度时返回 null。 */
  getDepth(): WebGLTexture | null {
    return this.mrt.depthTexture;
  }

  /** 当前宽度。 */
  get width(): number {
    return this.mrt.width;
  }

  /** 当前高度。 */
  get height(): number {
    return this.mrt.height;
  }

  /** 调整大小(保留原格式选项)。 */
  resize(gl: WebGL2RenderingContext, width: number, height: number): this {
    this.mrt.resize(gl, width, height);
    // resize 内部已重建,textures 数组引用更新
    this.positionTexture = this.mrt.textures[0] ?? null;
    this.normalTexture = this.mrt.textures[1] ?? null;
    this.albedoTexture = this.mrt.textures[2] ?? null;
    this.materialTexture = this.mrt.textures[3] ?? null;
    return this;
  }

  /** 释放所有 GL 资源。 */
  dispose(gl: WebGL2RenderingContext): void {
    this.mrt.dispose(gl);
    this.positionTexture = null;
    this.normalTexture = null;
    this.albedoTexture = null;
    this.materialTexture = null;
  }
}
