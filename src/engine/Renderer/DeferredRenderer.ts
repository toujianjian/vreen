// DeferredRenderer — 基于 GBuffer 的延迟渲染管线。
//
// 设计:
//   - geometryPass: 把场景渲染到 GBuffer(4 个 MRT 附件 + 深度)
//       attachment0 = 世界位置(RGBA16F)
//       attachment1 = 世界法线(RGBA16F)
//       attachment2 = 漫反射 + opacity(RGBA8)
//       attachment3 = metallic / roughness / emissive / AO(RGBA8)
//   - lightingPass: 全屏三角形读取 GBuffer + 对每个光源累加贡献
//
// 与 WebGL2Renderer 的关系:
//   - DeferredRenderer 是独立组件,不继承 Renderer 接口(接口面向前向渲染)
//   - 调用方(引擎 demo / 测试)直接持有 DeferredRenderer 并显式调用 geometryPass /
//     lightingPass / render。可以理解成"渲染管线的一部分",而非完整渲染器
//   - GBuffer 资源生命周期由本类管理(dispose 时全部释放)
//
// 限制(v1):
//   - 不支持透明物体(透明物体需要单独的前向 pass 叠加)
//   - 不支持多光源阴影(只读取外部已渲染的 shadow map,可选)
//   - 光照模型:Blinn-Phong(简化版),不计算 IBL / SSAO
//     (这些可作为 onBeforeCompile / uniform 注入扩展点)
//
// 着色器约定:
//   - 顶点 layout(location=N):0 = position, 1 = normal, 2 = uv
//   - geometryPass fragment 输出 4 个 layout(location=0..3) vec4
//   - lightingPass 输出单 layout(location=0) vec4 到默认 FBO
//   - 假设场景中 mesh 材质为 StandardMaterial(读取 baseColor/metallic/roughness)

import { GBuffer } from './GBuffer';
import { ShaderProgram } from './ShaderProgram';
import { Camera } from '../Cameras/Camera';
import { Scene } from '../Core/Scene';
import { Mesh } from '../Core/Mesh';
import { SkinnedMesh } from '../Core/SkinnedMesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { AmbientLight, DirectionalLight, PointLight } from '../Lights';
import { createLogger } from '@/lib/logger';

const log = createLogger('DeferredRenderer');

/** 延迟渲染支持的光源类型(运行时 instanceof 判断)。 */
export type DeferredLight = AmbientLight | DirectionalLight | PointLight;

/** 延迟渲染统计。 */
export interface DeferredRendererStats {
  /** 上一帧 geometry pass 的 draw call 数。 */
  geometryDrawCalls: number;
  /** 上一帧 geometry pass 的三角面数。 */
  geometryTriangles: number;
  /** 上一帧 lighting pass 处理的光源数。 */
  lightCount: number;
  /** 上一帧总耗时(ms)。 */
  frameTimeMs: number;
}

// ── Shaders ───────────────────────────────────────────────────────────

/**
 * 几何通道顶点着色器:输出 worldPos / worldNormal / uv 到 fragment。
 * 与 PBR_VERT 兼容的 layout 声明(0=position,1=normal,2=uv)。
 */
const GEOMETRY_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
uniform mat3 u_normalMatrix;

out vec3 v_worldPos;
out vec3 v_worldNormal;
out vec2 v_uv;

void main() {
  vec4 worldPos = u_model * vec4(a_position, 1.0);
  v_worldPos = worldPos.xyz;
  v_worldNormal = normalize(u_normalMatrix * a_normal);
  v_uv = a_uv;
  gl_Position = u_projection * u_view * worldPos;
}
`;

/**
 * 几何通道片段着色器:写入 4 个 MRT 输出。
 * 简化:材质参数走 uniform(不读贴图),与 StandardMaterial 字段映射。
 */
const GEOMETRY_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;

layout(location = 0) out vec4 g_position;
layout(location = 1) out vec4 g_normal;
layout(location = 2) out vec4 g_albedo;
layout(location = 3) out vec4 g_material;

uniform vec3  u_baseColor;
uniform float u_metallic;
uniform float u_roughness;
uniform vec3  u_emissive;
uniform float u_emissiveIntensity;
uniform float u_opacity;

void main() {
  g_position = vec4(v_worldPos, 1.0);
  // 法线编码到 [0,1] 空间存储(避免负值在 RGBA8 中丢失)
  g_normal = vec4(normalize(v_worldNormal) * 0.5 + 0.5, 1.0);
  g_albedo = vec4(u_baseColor, u_opacity);
  g_material = vec4(u_metallic, u_roughness, length(u_emissive) * u_emissiveIntensity, 1.0);
}
`;

/**
 * 光照通道顶点着色器:全屏三角形(只绘制一个三角形覆盖整个屏幕)。
 * 输入顶点数据来自 attribute 0(由 _getFullscreenTriangle 提供)。
 */
const LIGHTING_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_position;
layout(location = 2) in vec2 a_uv;

out vec2 v_uv;

void main() {
  v_uv = a_uv;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * 光照通道片段着色器:采样 GBuffer + 对每个光源累加 Blinn-Phong 贡献。
 *
 * uniform u_lightCount 之外,用数组 uniform 传光源参数(每光源一组)。
 * 限制:WebGL2 默认 MAX_FRAGMENT_UNIFORM_VECTORS ≥ 32,这里支持最多 8 光源。
 */
const LIGHTING_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_positionTex;
uniform sampler2D u_normalTex;
uniform sampler2D u_albedoTex;
uniform sampler2D u_materialTex;

uniform vec3  u_cameraPos;
uniform vec3  u_ambientColor;

#define MAX_LIGHTS 8

// 光源类型枚举:0=ambient, 1=directional, 2=point
uniform int   u_lightCount;
uniform int   u_lightType[MAX_LIGHTS];
uniform vec3  u_lightColor[MAX_LIGHTS];
uniform vec3  u_lightDir[MAX_LIGHTS];     // directional: 光传播方向
uniform vec3  u_lightPos[MAX_LIGHTS];     // point: 光源位置
uniform float u_lightIntensity[MAX_LIGHTS];
uniform float u_lightDistance[MAX_LIGHTS]; // point: 衰减距离
uniform float u_lightDecay[MAX_LIGHTS];    // point: 衰减指数

void main() {
  vec4 posData = texture(u_positionTex, v_uv);
  vec4 nrmData = texture(u_normalTex, v_uv);
  vec4 albData = texture(u_albedoTex, v_uv);
  vec4 matData = texture(u_materialTex, v_uv);

  // 提前剔除:无几何写入的位置(pos.a < 0.5)
  if (posData.a < 0.5) {
    discard;
  }

  vec3 worldPos = posData.rgb;
  vec3 normal = normalize(nrmData.rgb * 2.0 - 1.0);
  vec3 albedo = albData.rgb;
  float opacity = albData.a;
  float metallic = matData.r;
  float roughness = max(matData.g, 0.04);
  float emissive = matData.b;

  vec3 viewDir = normalize(u_cameraPos - worldPos);

  // 环境光
  vec3 ambient = u_ambientColor * albedo;

  // 累加每个光源
  vec3 lighting = vec3(0.0);
  for (int i = 0; i < MAX_LIGHTS; i++) {
    if (i >= u_lightCount) break;

    int t = u_lightType[i];
    vec3 lightColor = u_lightColor[i];
    float intensity = u_lightIntensity[i];

    vec3 L;
    float attenuation = 1.0;

    if (t == 1) {
      // Directional:方向光,L = -direction
      L = normalize(-u_lightDir[i]);
    } else if (t == 2) {
      // Point:点光源,带距离衰减
      L = u_lightPos[i] - worldPos;
      float dist = length(L);
      L = dist > 0.0 ? L / dist : vec3(0.0);
      float distAtten = 1.0;
      if (u_lightDistance[i] > 0.0) {
        distAtten = 1.0 - clamp(dist / u_lightDistance[i], 0.0, 1.0);
      }
      float decay = u_lightDecay[i];
      if (decay > 0.0 && dist > 0.0) {
        distAtten *= pow(max(1.0 / max(dist, 0.001), 0.0), decay);
      }
      attenuation = distAtten;
    } else {
      // ambient 由 u_ambientColor 一次性叠加,不进 loop 累加
      continue;
    }

    float NdotL = max(dot(normal, L), 0.0);

    // Blinn-Phong 漫反射 + 镜面反射
    vec3 H = normalize(L + viewDir);
    float NdotH = max(dot(normal, H), 0.0);
    float shininess = mix(64.0, 16.0, roughness);
    float spec = pow(NdotH, shininess);

    vec3 diffuse = albedo * NdotL;
    // 镜面项:金属度高时颜色跟随 albedo(金属反射带色),非金属用白
    vec3 specColor = mix(vec3(1.0), albedo, metallic);
    vec3 specular = specColor * spec * NdotL;

    lighting += (diffuse + specular) * lightColor * intensity * attenuation;
  }

  vec3 finalColor = ambient + lighting + albedo * emissive;
  outColor = vec4(finalColor, opacity);
}
`;

// ── DeferredRenderer ───────────────────────────────────────────────────

export interface DeferredRendererOptions {
  /** 屏幕宽度(像素)。 */
  width?: number;
  /** 屏幕高度(像素)。 */
  height?: number;
  /** G-Buffer 高精度格式(默认 'rgba16f')。 */
  highPrecisionFormat?: 'rgba16f' | 'rgba32f' | 'rgba8';
}

/**
 * 延迟渲染器:把场景拆成 geometry + lighting 两个 pass。
 *
 * 典型用法:
 * ```ts
 * const dr = new DeferredRenderer(gl, { width: 800, height: 600 });
 * function frame() {
 *   dr.render(gl, scene, camera, lights);
 *   requestAnimationFrame(frame);
 * }
 * ```
 *
 * 不持有 canvas;viewport 与默认 FBO 由调用方在 render 外控制。
 */
export class DeferredRenderer {
  readonly gbuffer: GBuffer;
  /** 几何通道着色器(渲染场景到 GBuffer)。 */
  geometryShader: ShaderProgram;
  /** 光照通道着色器(从 GBuffer 重建光照)。 */
  lightingShader: ShaderProgram;

  screenWidth: number;
  screenHeight: number;

  /** 上一帧统计。 */
  stats: DeferredRendererStats = {
    geometryDrawCalls: 0,
    geometryTriangles: 0,
    lightCount: 0,
    frameTimeMs: 0,
  };

  private _fullscreenVao: WebGLVertexArrayObject | null = null;
  private _fullscreenBuf: WebGLBuffer | null = null;
  private _normalMat3: Float32Array = new Float32Array(9);
  private _disposed: boolean = false;
  /** Per-geometry VAO + VBO 缓存(version 比对增量重传)。 */
  private _geomCache: WeakMap<BufferGeometry, {
    vao: WebGLVertexArrayObject;
    attrBuffers: Map<string, { buf: WebGLBuffer; version: number }>;
    indexBuf: WebGLBuffer | null;
    indexVersion: number;
  }> = new WeakMap();

  constructor(gl: WebGL2RenderingContext, opts: DeferredRendererOptions = {}) {
    this.screenWidth = opts.width ?? gl.canvas.width;
    this.screenHeight = opts.height ?? gl.canvas.height;

    this.gbuffer = new GBuffer({
      depth: true,
      highPrecisionFormat: opts.highPrecisionFormat ?? 'rgba16f',
    });
    this.gbuffer.setup(gl, this.screenWidth, this.screenHeight);

    // 编译两个 shader;失败抛错由调用方捕获
    this.geometryShader = new ShaderProgram(gl, GEOMETRY_VERT_SRC, GEOMETRY_FRAG_SRC);
    this.lightingShader = new ShaderProgram(gl, LIGHTING_VERT_SRC, LIGHTING_FRAG_SRC);

    this._initFullscreenQuad(gl);

    log.info(
      `DeferredRenderer created: ${this.screenWidth}x${this.screenHeight}, ` +
      `GBuffer precision=${opts.highPrecisionFormat ?? 'rgba16f'}`,
    );
  }

  /** 几何通道:渲染场景到 GBuffer。 */
  geometryPass(gl: WebGL2RenderingContext, scene: Scene, camera: Camera): void {
    const t0 = performance.now();
    let drawCalls = 0;
    let triangles = 0;

    // 绑定 GBuffer FBO
    this.gbuffer.bind(gl);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    this.geometryShader.use();
    this.geometryShader.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    this.geometryShader.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);

    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!(mesh instanceof Mesh)) return;
      if (!mesh.visible) return;
      if (mesh instanceof SkinnedMesh) {
        // SkinnedMesh 延迟渲染支持需要 skinning shader 变体,v1 跳过
        log.warn('SkinnedMesh skipped in deferred geometry pass (not yet supported)');
        return;
      }
      const geom = mesh.geometry;
      if (!geom || !geom.attributes.position) return;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;

      // 绑定 VAO + VBO(缓存在 _geomCache,version 变更时重传)
      this._bindGeometryAttributes(gl, geom);

      this.geometryShader.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
      mesh.matrixWorld.getNormalMatrix(this._normalMat3);
      this.geometryShader.setUniformMatrix3fv('u_normalMatrix', this._normalMat3);

      // 写入材质参数(若材质提供这些字段;否则用默认值)
      const m = mat as {
        baseColor?: { r: number; g: number; b: number };
        metallic?: number;
        roughness?: number;
        emissive?: { r: number; g: number; b: number };
        emissiveIntensity?: number;
        opacity?: number;
      };
      const baseColor = m?.baseColor ?? { r: 1, g: 1, b: 1 };
      const emissive = m?.emissive ?? { r: 0, g: 0, b: 0 };
      this.geometryShader.setUniform3f('u_baseColor', baseColor.r, baseColor.g, baseColor.b);
      this.geometryShader.setUniform1f('u_metallic', m?.metallic ?? 0);
      this.geometryShader.setUniform1f('u_roughness', m?.roughness ?? 1);
      this.geometryShader.setUniform3f('u_emissive', emissive.r, emissive.g, emissive.b);
      this.geometryShader.setUniform1f('u_emissiveIntensity', m?.emissiveIntensity ?? 1);
      this.geometryShader.setUniform1f('u_opacity', m?.opacity ?? 1);

      // 绘制
      const pos = geom.attributes.position;
      const idx = geom.index;
      if (idx) {
        // 索引可能是 Uint16Array 或 Uint32Array(BufferAttribute 类型擦除)
        const is32 = (idx.array as ArrayLike<number>) instanceof Uint32Array;
        gl.drawElements(
          gl.TRIANGLES,
          idx.count,
          is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          0,
        );
        drawCalls++;
        triangles += idx.count / 3;
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, pos.count);
        drawCalls++;
        triangles += pos.count / 3;
      }
    });

    // 解绑 GBuffer,恢复默认 FBO
    this.gbuffer.unbind(gl);

    this.stats.geometryDrawCalls = drawCalls;
    this.stats.geometryTriangles = triangles;
    const dt = performance.now() - t0;
    this.stats.frameTimeMs = dt;
    log.debug(
      `geometryPass: draws=${drawCalls}, tris=${Math.round(triangles)}, ` +
      `dt=${dt.toFixed(2)}ms`,
    );
  }

  /** 光照通道:从 GBuffer 读取 + 对每个光源累加。绘制到当前绑定的 FBO。 */
  lightingPass(gl: WebGL2RenderingContext, lights: DeferredLight[]): void {
    const t0 = performance.now();

    // 绑定 GBuffer 纹理到 unit 0..3
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.getPosition());
    this.lightingShader.setUniformSampler('u_positionTex', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.getNormal());
    this.lightingShader.setUniformSampler('u_normalTex', 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.getAlbedo());
    this.lightingShader.setUniformSampler('u_albedoTex', 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.gbuffer.getMaterial());
    this.lightingShader.setUniformSampler('u_materialTex', 3);

    // 收集 ambient(若有多个 ambient,只取第一个;其余累加到 ambientColor)
    let ambientR = 0, ambientG = 0, ambientB = 0;
    let hasAmbient = false;
    let lightIdx = 0;
    const lightTypes: number[] = [];
    const lightColors: number[] = [];
    const lightDirs: number[] = [];
    const lightPoss: number[] = [];
    const lightIntensities: number[] = [];
    const lightDistances: number[] = [];
    const lightDecays: number[] = [];

    for (const light of lights) {
      if (lightIdx >= 8) break;
      if (light instanceof AmbientLight) {
        ambientR += light.color.r * light.intensity;
        ambientG += light.color.g * light.intensity;
        ambientB += light.color.b * light.intensity;
        hasAmbient = true;
        continue;
      }
      if (light instanceof DirectionalLight) {
        lightTypes.push(1);
        lightColors.push(light.color.r, light.color.g, light.color.b);
        lightDirs.push(light.direction.x, light.direction.y, light.direction.z);
        lightPoss.push(0, 0, 0);
        lightIntensities.push(light.intensity);
        lightDistances.push(0);
        lightDecays.push(0);
        lightIdx++;
        continue;
      }
      if (light instanceof PointLight) {
        lightTypes.push(2);
        lightColors.push(light.color.r, light.color.g, light.color.b);
        lightDirs.push(0, 0, 0);
        lightPoss.push(light.position.x, light.position.y, light.position.z);
        lightIntensities.push(light.intensity);
        lightDistances.push(light.distance);
        lightDecays.push(light.decay);
        lightIdx++;
        continue;
      }
    }

    // u_lightCount = 非环境光光源数(ambient 不进 loop 累加)
    this.lightingShader.setUniform1i('u_lightCount', lightIdx);
    this.lightingShader.setUniform3f(
      'u_ambientColor',
      ambientR,
      ambientG,
      ambientB,
    );

    // 把数组写入 uniform(用 setUniform3f 逐光源写)
    // 由于 ShaderProgram 没有 setUniform3fv 数组版本,这里逐光源写
    for (let i = 0; i < lightIdx; i++) {
      const base = i * 3;
      const typeLoc = this.lightingShader.uniforms.get(`u_lightType[${i}]`);
      if (typeLoc !== undefined) gl.uniform1i(typeLoc, lightTypes[i]);
      this._setUniform3fByName(gl, this.lightingShader, `u_lightColor[${i}]`,
        lightColors[base], lightColors[base + 1], lightColors[base + 2]);
      this._setUniform3fByName(gl, this.lightingShader, `u_lightDir[${i}]`,
        lightDirs[base], lightDirs[base + 1], lightDirs[base + 2]);
      this._setUniform3fByName(gl, this.lightingShader, `u_lightPos[${i}]`,
        lightPoss[base], lightPoss[base + 1], lightPoss[base + 2]);
      const intensityLoc = this.lightingShader.uniforms.get(`u_lightIntensity[${i}]`);
      if (intensityLoc !== undefined) gl.uniform1f(intensityLoc, lightIntensities[i]);
      const distLoc = this.lightingShader.uniforms.get(`u_lightDistance[${i}]`);
      if (distLoc !== undefined) gl.uniform1f(distLoc, lightDistances[i]);
      const decayLoc = this.lightingShader.uniforms.get(`u_lightDecay[${i}]`);
      if (decayLoc !== undefined) gl.uniform1f(decayLoc, lightDecays[i]);
    }

    // 绘制全屏三角形
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this._fullscreenVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.stats.lightCount = lightIdx;
    const dt = performance.now() - t0;
    this.stats.frameTimeMs += dt;
    log.debug(
      `lightingPass: lights=${lightIdx} (ambient=${hasAmbient ? 1 : 0}), ` +
      `dt=${dt.toFixed(2)}ms`,
    );
  }

  /** 完整延迟渲染:geometry pass + lighting pass。 */
  render(
    gl: WebGL2RenderingContext,
    scene: Scene,
    camera: Camera,
    lights: DeferredLight[],
  ): void {
    if (this._disposed) {
      throw new Error('DeferredRenderer.render: renderer disposed');
    }
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    this.geometryShader.setUniform3f(
      'u_cameraPos',
      camera.position.x,
      camera.position.y,
      camera.position.z,
    );
    this.lightingShader.setUniform3f(
      'u_cameraPos',
      camera.position.x,
      camera.position.y,
      camera.position.z,
    );

    this.geometryPass(gl, scene, camera);

    // lighting pass 绘制到默认 FBO
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.screenWidth, this.screenHeight);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.lightingShader.use();
    this.lightingPass(gl, lights);
  }

  /** 调整 GBuffer 与屏幕尺寸。 */
  resize(gl: WebGL2RenderingContext, width: number, height: number): void {
    if (width < 1 || height < 1) {
      throw new Error(`DeferredRenderer.resize: width/height must be >= 1 (got ${width}x${height})`);
    }
    if (width === this.screenWidth && height === this.screenHeight) return;
    this.gbuffer.resize(gl, width, height);
    this.screenWidth = width;
    this.screenHeight = height;
    log.debug(`resized: ${width}x${height}`);
  }

  /** 释放所有 GL 资源(GBuffer + shaders + fullscreen VAO)。 */
  dispose(gl: WebGL2RenderingContext): void {
    if (this._disposed) return;
    this.gbuffer.dispose(gl);
    this.geometryShader.dispose();
    this.lightingShader.dispose();
    if (this._fullscreenBuf) {
      gl.deleteBuffer(this._fullscreenBuf);
      this._fullscreenBuf = null;
    }
    if (this._fullscreenVao) {
      gl.deleteVertexArray(this._fullscreenVao);
      this._fullscreenVao = null;
    }
    this._disposed = true;
    log.info('DeferredRenderer disposed');
  }

  // ── private ───────────────────────────────────────────────────────

  private _initFullscreenQuad(gl: WebGL2RenderingContext): void {
    // 全屏三角形:3 个顶点覆盖整个 NDC 空间
    // 顶点 (x, y, uv_x, uv_y)
    const vertices = new Float32Array([
      -1, -1, 0, 0,
      3, -1, 2, 0,
      -1, 3, 0, 2,
    ]);
    this._fullscreenVao = gl.createVertexArray();
    this._fullscreenBuf = gl.createBuffer();
    if (!this._fullscreenVao || !this._fullscreenBuf) {
      throw new Error('DeferredRenderer: failed to alloc fullscreen VAO/buffer');
    }
    gl.bindVertexArray(this._fullscreenVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this._fullscreenBuf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);
    gl.bindVertexArray(null);
  }

  /**
   * 为当前 geometry 绑定 VAO + VBO(缓存在 _geomCache,version 变更时重传)。
   * 简化版的 attribute 绑定:不依赖 WebGL2Renderer 私有 meshCache,自管 VAO。
   */
  private _bindGeometryAttributes(gl: WebGL2RenderingContext, geom: BufferGeometry): void {
    let entry = this._geomCache.get(geom);
    if (!entry) {
      const vao = gl.createVertexArray();
      if (!vao) {
        log.warn('createVertexArray() returned null; skip geometry');
        return;
      }
      entry = {
        vao,
        attrBuffers: new Map(),
        indexBuf: null,
        indexVersion: -1,
      };
      this._geomCache.set(geom, entry);
    }
    gl.bindVertexArray(entry.vao);

    const layoutFor: Record<string, number> = {
      position: 0, normal: 1, uv: 2,
    };
    for (const name of ['position', 'normal', 'uv']) {
      const attr = geom.attributes[name];
      if (!attr) continue;
      const loc = layoutFor[name];
      let bufEntry = entry.attrBuffers.get(name);
      if (!bufEntry || bufEntry.version !== attr.version) {
        const buf = bufEntry?.buf ?? gl.createBuffer();
        if (!buf) {
          log.warn(`createBuffer() returned null for ${name}; skip`);
          continue;
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, attr.array, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, attr.itemSize, gl.FLOAT, false, 0, 0);
        bufEntry = { buf, version: attr.version };
        entry.attrBuffers.set(name, bufEntry);
      }
    }
    // Index buffer
    if (geom.index) {
      const idx = geom.index;
      if (!entry.indexBuf || entry.indexVersion !== idx.version) {
        const buf = entry.indexBuf ?? gl.createBuffer();
        if (!buf) {
          log.warn('createBuffer() returned null for index; skip');
          return;
        }
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx.array, gl.STATIC_DRAW);
        entry.indexBuf = buf;
        entry.indexVersion = idx.version;
      }
    }
  }

  private _setUniform3fByName(
    gl: WebGL2RenderingContext,
    program: ShaderProgram,
    name: string,
    x: number, y: number, z: number,
  ): void {
    const loc = program.uniforms.get(name);
    if (loc !== undefined) gl.uniform3f(loc, x, y, z);
  }
}
