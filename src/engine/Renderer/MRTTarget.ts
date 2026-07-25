// MRTTarget — 多渲染目标(Multi-Render Target)FBO 封装。
//
// 设计:
//   - 一个 framebuffer + N 个颜色附件(COLOR_ATTACHMENT0..N-1)
//   - 一个可选深度附件(DEPTH_ATTACHMENT 或 DEPTH_STENCIL_ATTACHMENT)
//   - setup(gl, w, h, colorCount) 创建 GL 资源
//   - bind(gl) 绑定 FBO + 配置 drawBuffers,后续 draw call 写入所有附件
//   - unbind(gl) 还原默认 FBO
//   - resize(gl, w, h) 重新分配纹理(gl.deleteTexture + 重建)
//   - dispose(gl) 释放所有 GL 资源
//
// 约定:
//   - 颜色附件内部格式 RGBA16F(浮点,适合 G-Buffer 位置 / 法线等高动态范围数据)
//   - 深度附件 DEPTH_COMPONENT24(uint,与现有 ShadowMapManager 一致)
//   - 颜色纹理 filter = NEAREST(MRT 通常用于 G-Buffer,不做插值)
//   - 颜色纹理 wrap = CLAMP_TO_EDGE
//
// WebGL2 限制:
//   - 颜色附件上限 gl.getParameter(gl.MAX_COLOR_ATTACHMENTS)(至少 4)
//   - drawBuffers 数量上限 gl.getParameter(gl.MAX_DRAW_BUFFERS)(至少 4)
//   - 浮点渲染需要 EXT_color_buffer_float 扩展(WebGL2 默认支持 RGBA16F 渲染)
//
// 与 WebGL2Renderer 中 SSAO 的 _getSSAOResources 的区别:
//   SSAO FBO 是硬编码 2 个附件(depth + normal),MRTTarget 是通用 N 附件封装。

export interface MRTSetupOptions {
  /** 颜色附件数量(1..MAX_COLOR_ATTACHMENTS)。 */
  colorCount: number;
  /** 是否创建深度附件(默认 true)。 */
  depth?: boolean;
  /** 是否创建模板附件(默认 false;true 时用 DEPTH24_STENCIL8)。 */
  stencil?: boolean;
  /** 颜色附件内部格式(默认 'rgba16f')。可选:'rgba8' / 'rgba16f' / 'rgba32f' / 'rg16f' / 'r16f'。 */
  colorInternalFormat?: 'rgba8' | 'rgba16f' | 'rgba32f' | 'rg16f' | 'r16f';
  /** 颜色附件数据类型(默认 'float';'rgba8' 时强制 'unsigned-byte')。 */
  colorType?: 'unsigned-byte' | 'float' | 'half-float';
  /** 颜色纹理 min/mag filter(默认 'nearest')。 */
  colorFilter?: 'nearest' | 'linear';
}

export class MRTTarget {
  /** 颜色附件 GL 纹理(索引 0..colorCount-1)。setup 前为空。 */
  textures: WebGLTexture[] = [];
  /** 深度附件 GL 纹理(无深度时为 null)。 */
  depthTexture: WebGLTexture | null = null;
  /** FBO 句柄。setup 前为 null。 */
  framebuffer: WebGLFramebuffer | null = null;
  /** 宽度(像素)。 */
  width: number = 0;
  /** 高度(像素)。 */
  height: number = 0;
  /** 颜色附件数量。 */
  colorCount: number = 0;
  /** 是否已 setup。 */
  isSetup: boolean = false;

  private _colorInternalFormat: MRTSetupOptions['colorInternalFormat'] = 'rgba16f';
  private _colorType: MRTSetupOptions['colorType'] = 'float';
  private _colorFilter: 'nearest' | 'linear' = 'nearest';
  private _hasDepth: boolean = true;
  private _hasStencil: boolean = false;

  /** 创建 FBO + 颜色 / 深度纹理。重复调用会先释放旧资源。 */
  setup(gl: WebGL2RenderingContext, width: number, height: number, opts: MRTSetupOptions): this {
    // 校验
    const maxColor = gl.getParameter(gl.MAX_COLOR_ATTACHMENTS) as number;
    if (opts.colorCount < 1 || opts.colorCount > maxColor) {
      throw new Error(
        `MRTTarget.setup: colorCount ${opts.colorCount} out of range (MAX_COLOR_ATTACHMENTS=${maxColor})`,
      );
    }
    if (width < 1 || height < 1) {
      throw new Error(`MRTTarget.setup: width/height must be >= 1 (got ${width}x${height})`);
    }

    // 释放旧资源
    if (this.isSetup) this.dispose(gl);

    this.width = Math.floor(width);
    this.height = Math.floor(height);
    this.colorCount = opts.colorCount;
    this._colorInternalFormat = opts.colorInternalFormat ?? 'rgba16f';
    this._colorType = opts.colorType ?? 'float';
    this._colorFilter = opts.colorFilter ?? 'nearest';
    this._hasDepth = opts.depth ?? true;
    this._hasStencil = opts.stencil ?? false;

    // rgba8 强制 unsigned-byte
    if (this._colorInternalFormat === 'rgba8') {
      this._colorType = 'unsigned-byte';
    }

    // 创建颜色纹理
    this.textures = [];
    for (let i = 0; i < opts.colorCount; i++) {
      const tex = gl.createTexture();
      if (!tex) throw new Error(`MRTTarget.setup: createTexture() returned null (color ${i})`);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const { internalFormat, format, type } = this._resolveColorFormat(gl);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, internalFormat,
        this.width, this.height, 0,
        format, type, null,
      );
      const filter = this._colorFilter === 'nearest' ? gl.NEAREST : gl.LINEAR;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures.push(tex);
    }

    // 创建深度 / 模板纹理
    if (this._hasDepth) {
      const dt = gl.createTexture();
      if (!dt) throw new Error('MRTTarget.setup: createTexture() returned null (depth)');
      gl.bindTexture(gl.TEXTURE_2D, dt);
      if (this._hasStencil) {
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.DEPTH24_STENCIL8,
          this.width, this.height, 0,
          gl.DEPTH_STENCIL, gl.UNSIGNED_INT_24_8, null,
        );
      } else {
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24,
          this.width, this.height, 0,
          gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null,
        );
      }
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.depthTexture = dt;
    }

    // 创建 FBO
    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('MRTTarget.setup: createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    for (let i = 0; i < opts.colorCount; i++) {
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0 + i,
        gl.TEXTURE_2D,
        this.textures[i],
        0,
      );
    }
    if (this._hasDepth && this.depthTexture) {
      const attachment = this._hasStencil ? gl.DEPTH_STENCIL_ATTACHMENT : gl.DEPTH_ATTACHMENT;
      gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, this.depthTexture, 0);
    }

    // 校验完整性
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      this.dispose(gl);
      throw new Error(`MRTTarget.setup: framebuffer incomplete (status=0x${status.toString(16)})`);
    }

    this.framebuffer = fbo;
    this.isSetup = true;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return this;
  }

  /** 解析颜色格式 → GL 枚举元组。 */
  private _resolveColorFormat(gl: WebGL2RenderingContext): {
    internalFormat: number;
    format: number;
    type: number;
  } {
    const map: Record<string, { internalFormat: number; format: number; type: number }> = {
      'rgba8': { internalFormat: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE },
      'rgba16f': { internalFormat: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT },
      'rgba32f': { internalFormat: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT },
      'rg16f': { internalFormat: gl.RG16F, format: gl.RG, type: gl.HALF_FLOAT },
      'r16f': { internalFormat: gl.R16F, format: gl.RED, type: gl.HALF_FLOAT },
    };
    const entry = map[this._colorInternalFormat ?? 'rgba16f'];
    if (!entry) throw new Error(`MRTTarget: unsupported colorInternalFormat "${this._colorInternalFormat}"`);
    // type 覆盖(允许调用方指定 unsigned-byte / float / half-float)
    if (this._colorType === 'unsigned-byte') entry.type = gl.UNSIGNED_BYTE;
    else if (this._colorType === 'float') entry.type = gl.FLOAT;
    else if (this._colorType === 'half-float') entry.type = gl.HALF_FLOAT;
    return entry;
  }

  /** 绑定 FBO + 配置 drawBuffers。
   *  调用方在 bind 后须自行 gl.viewport(0, 0, width, height)。 */
  bind(gl: WebGL2RenderingContext): void {
    if (!this.isSetup || !this.framebuffer) {
      throw new Error('MRTTarget.bind: not setup; call setup() first');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    const drawBuffers: number[] = [];
    for (let i = 0; i < this.colorCount; i++) {
      drawBuffers.push(gl.COLOR_ATTACHMENT0 + i);
    }
    gl.drawBuffers(drawBuffers);
  }

  /** 解绑:绑定回默认 FBO(屏幕)。 */
  unbind(gl: WebGL2RenderingContext): void {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** 获取第 index 个颜色附件纹理。越界抛错。 */
  getColorTexture(index: number): WebGLTexture {
    if (index < 0 || index >= this.textures.length) {
      throw new Error(`MRTTarget.getColorTexture: index ${index} out of range (count=${this.textures.length})`);
    }
    return this.textures[index];
  }

  /** 获取深度附件纹理。无深度时抛错。 */
  getDepthTexture(): WebGLTexture {
    if (!this.depthTexture) {
      throw new Error('MRTTarget.getDepthTexture: no depth attachment');
    }
    return this.depthTexture;
  }

  /** 调整大小:删除旧纹理 + 创建新纹理(FBO 复用)。
   *  保留原 setup 选项(colorCount / 格式 / 深度)。 */
  resize(gl: WebGL2RenderingContext, width: number, height: number): this {
    if (!this.isSetup) {
      throw new Error('MRTTarget.resize: not setup; call setup() first');
    }
    if (width < 1 || height < 1) {
      throw new Error(`MRTTarget.resize: width/height must be >= 1 (got ${width}x${height})`);
    }
    if (width === this.width && height === this.height) return this;

    const colorCount = this.colorCount;
    const opts: MRTSetupOptions = {
      colorCount,
      depth: this._hasDepth,
      stencil: this._hasStencil,
      colorInternalFormat: this._colorInternalFormat,
      colorType: this._colorType,
      colorFilter: this._colorFilter,
    };
    return this.setup(gl, width, height, opts);
  }

  /** 释放所有 GL 资源。调用后 isSetup=false,textures/framebuffer 清空。 */
  dispose(gl: WebGL2RenderingContext): void {
    for (const tex of this.textures) {
      if (tex) gl.deleteTexture(tex);
    }
    this.textures = [];
    if (this.depthTexture) {
      gl.deleteTexture(this.depthTexture);
      this.depthTexture = null;
    }
    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
      this.framebuffer = null;
    }
    this.isSetup = false;
    this.colorCount = 0;
    this.width = 0;
    this.height = 0;
  }
}
