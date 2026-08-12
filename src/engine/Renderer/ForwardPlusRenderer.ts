// ForwardPlusRenderer — Forward+ 渲染管线(前向渲染 + 屏幕分块光源剔除)。
//
// 设计:
//   - depthPrepass: 可选深度预 pass,把场景深度写入深度缓冲(降低几何 pass
//     的过度绘制,并可供后续分块光源剔除读取深度做更精确的剔除)。
//   - computeLightTiles: CPU 侧分块光源剔除(WebGL2 无 compute shader,在
//     CPU 完成)。屏幕被划分为 tileSize × tileSize 的网格,每个 tile 维护
//     一个影响它的光源索引列表。DirectionalLight / AmbientLight 影响所有
//     tile;PointLight / SpotLight 投影到屏幕后估算屏幕空间半径决定覆盖
//     的 tile 集合。
//   - geometryPass: 前向渲染几何体,把分块光源列表以 uniform 数组形式上传,
//     fragment shader 按 tile 取对应光源列表累加光照。
//
// 与 WebGL2Renderer / DeferredRenderer 的关系:
//   - 与 DeferredRenderer 类似,本类是独立渲染组件,不实现 Renderer 接口
//     (接口面向单 pass 前向渲染)。调用方直接持有本类并显式调用
//     depthPrepass / geometryPass / render。
//   - 与 WebGL2Renderer 的前向渲染相比,Forward+ 通过分块光源剔除支持
//     大量点光源(传统前向渲染受 fragment uniform 数组上限制约)。
//
// 着色器约定:
//   - 顶点 layout(location=N):0 = position, 1 = normal, 2 = uv
//   - depthPrepass 只写深度(空 fragment shader)
//   - geometryPass fragment 输出单 layout(location=0) vec4
//
// 命名说明:
//   - 属性 `depthPrepassEnabled` 与方法 `depthPrepass()` 同名冲突,故属性
//     加 `Enabled` 后缀(对齐 WebGL2Renderer 的 ssaoEnabled / bloomEnabled
//     约定),setter `setDepthPrepass(enabled)` 写该属性。

import { ShaderProgram } from './ShaderProgram';
import { Camera } from '../Cameras/Camera';
import { Scene } from '../Core/Scene';
import { Mesh } from '../Core/Mesh';
import { SkinnedMesh } from '../Core/SkinnedMesh';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import { Frustum } from '../Math/Frustum';
import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  Light,
  PointLight,
  RectAreaLight,
  SpotLight,
} from '../Lights';
import { createLogger } from '@/lib/logger';

const log = createLogger('ForwardPlusRenderer');

/** Forward+ 管线支持的光源类型。 */
export type ForwardPlusLight =
  | AmbientLight
  | DirectionalLight
  | PointLight
  | SpotLight
  | HemisphereLight
  | RectAreaLight
  | Light;

/** Forward+ 渲染器选项。 */
export interface ForwardPlusRendererOptions {
  /** 屏幕宽度(像素,默认取 gl.canvas.width)。 */
  width?: number;
  /** 屏幕高度(像素,默认取 gl.canvas.height)。 */
  height?: number;
  /** 分块大小(像素,默认 16)。 */
  tileSize?: number;
  /** 每分块最大光源数(默认 64)。 */
  maxLightsPerTile?: number;
  /** 是否启用深度预 pass(默认 true)。 */
  depthPrepass?: boolean;
  /** 是否启用调试光源数统计(默认 false)。 */
  debugLightCount?: boolean;
  /** 时钟函数(默认 performance.now),便于测试注入。 */
  now?: () => number;
}

/** Forward+ 渲染统计。 */
export interface ForwardPlusStats {
  /** 当前分块数(x/y 维度)。 */
  tileCount: { x: number; y: number };
  /** 分块大小(像素)。 */
  tileSize: number;
  /** 总分块数。 */
  totalTiles: number;
  /** 每分块最大光源数。 */
  maxLightsPerTile: number;
  /** 上一帧处理的总光源数。 */
  totalLights: number;
  /** 上一帧视锥剔除后可见光源数。 */
  visibleLights: number;
  /** 上一帧被视锥剔除的光源数。 */
  culledLights: number;
  /** 上一帧每分块平均光源数。 */
  avgLightsPerTile: number;
  /** 上一帧单分块最大光源数。 */
  maxLightsInTile: number;
  /** 上一帧光源索引缓冲总条目数。 */
  lightIndexCount: number;
  /** 是否启用深度预 pass。 */
  depthPrepass: boolean;
  /** 是否启用调试光源数。 */
  debugLightCount: boolean;
  /** 上一帧深度预 pass draw call 数。 */
  depthDrawCalls: number;
  /** 上一帧几何 pass draw call 数。 */
  geometryDrawCalls: number;
  /** 上一帧几何 pass 三角面数。 */
  geometryTriangles: number;
  /** 上一帧总耗时(ms)。 */
  frameTimeMs: number;
}

// ── Shaders ───────────────────────────────────────────────────────────

/** 深度预 pass 顶点着色器:只计算 gl_Position,无 varying 输出。 */
const DEPTH_VERT_SRC = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_position;

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;

void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

/** 深度预 pass 片段着色器:空(只写深度)。 */
const DEPTH_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

out vec4 outColor;

void main() {
  outColor = vec4(1.0);
}
`;

/**
 * 几何 pass 顶点着色器:输出 worldPos / worldNormal / uv。
 * 与 DeferredRenderer 的 GEOMETRY_VERT_SRC 兼容。
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
 * 几何 pass 片段着色器:Forward+ 光照。
 *
 * uniform u_lightGrid / u_lightIndex 描述每个 tile 的光源列表,
 * fragment 根据 gl_FragCoord 计算 tile 索引,取对应光源列表累加。
 *
 * 简化:光照模型 Blinn-Phong,不计算 IBL / 阴影 / SSAO。
 * 光源类型:0=ambient, 1=directional, 2=point。
 */
const GEOMETRY_FRAG_SRC = /* glsl */ `#version 300 es
precision highp float;

in vec3 v_worldPos;
in vec3 v_worldNormal;
in vec2 v_uv;

out vec4 outColor;

uniform vec3  u_cameraPos;
uniform vec2  u_screenSize;
uniform float u_tileSize;
uniform ivec2 u_tileCount;

uniform vec3  u_baseColor;
uniform float u_metallic;
uniform float u_roughness;
uniform float u_opacity;

uniform int   u_totalLights;
uniform int   u_ambientLightCount;
uniform vec3  u_ambientColor;

#define MAX_LIGHTS 256

uniform int   u_lightType[MAX_LIGHTS];    // 0=ambient 1=dir 2=point
uniform vec3  u_lightColor[MAX_LIGHTS];
uniform vec3  u_lightDir[MAX_LIGHTS];     // directional: 光传播方向
uniform vec3  u_lightPos[MAX_LIGHTS];     // point: 光源位置
uniform float u_lightIntensity[MAX_LIGHTS];
uniform float u_lightDistance[MAX_LIGHTS]; // point: 衰减距离
uniform float u_lightDecay[MAX_LIGHTS];    // point: 衰减指数

// 分块光源网格:每 tile 2 个 uint(offset, count)
uniform usampler2D u_lightGrid;
uniform usampler2D u_lightIndex;

void main() {
  vec3 normal = normalize(v_worldNormal);
  vec3 albedo = u_baseColor;
  float roughness = max(u_roughness, 0.04);
  float metallic = u_metallic;

  vec3 viewDir = normalize(u_cameraPos - v_worldPos);

  // 环境光(已累加所有 ambient 光源)
  vec3 ambient = u_ambientColor * albedo;

  // 计算当前片元所属 tile
  ivec2 tileCoord = ivec2(gl_FragCoord.xy / u_tileSize);
  tileCoord = clamp(tileCoord, ivec2(0), u_tileCount - ivec2(1));
  // lightGrid 纹理:每像素 2 uint(offset, count),用 R/G 通道
  uvec2 grid = texelFetch(u_lightGrid, tileCoord, 0).rg;
  uint offset = grid.r;
  uint count = grid.g;

  vec3 lighting = vec3(0.0);
  for (uint i = uint(0); i < uint(256); i++) {
    if (i >= count) break;
    // lightIndex 纹理:每像素 1 uint(光源索引)
    uint idxU = texelFetch(u_lightIndex, ivec2(int(offset + i), 0), 0).r;
    int idx = int(idxU);
    if (idx < 0 || idx >= u_totalLights) continue;

    int t = u_lightType[idx];
    if (t == 0) continue; // ambient 已在 u_ambientColor 累加

    vec3 lightColor = u_lightColor[idx];
    float intensity = u_lightIntensity[idx];

    vec3 L;
    float attenuation = 1.0;

    if (t == 1) {
      // Directional
      L = normalize(-u_lightDir[idx]);
    } else if (t == 2) {
      // Point
      L = u_lightPos[idx] - v_worldPos;
      float dist = length(L);
      L = dist > 0.0 ? L / dist : vec3(0.0);
      float distAtten = 1.0;
      if (u_lightDistance[idx] > 0.0) {
        distAtten = 1.0 - clamp(dist / u_lightDistance[idx], 0.0, 1.0);
      }
      float decay = u_lightDecay[idx];
      if (decay > 0.0 && dist > 0.0) {
        distAtten *= pow(max(1.0 / max(dist, 0.001), 0.0), decay);
      }
      attenuation = distAtten;
    } else {
      continue;
    }

    float NdotL = max(dot(normal, L), 0.0);
    vec3 H = normalize(L + viewDir);
    float NdotH = max(dot(normal, H), 0.0);
    float shininess = mix(64.0, 16.0, roughness);
    float spec = pow(NdotH, shininess);

    vec3 diffuse = albedo * NdotL;
    vec3 specColor = mix(vec3(1.0), albedo, metallic);
    vec3 specular = specColor * spec * NdotL;

    lighting += (diffuse + specular) * lightColor * intensity * attenuation;
  }

  vec3 finalColor = ambient + lighting;
  outColor = vec4(finalColor, u_opacity);
}
`;

/** 屏幕坐标 → tile 索引(纯数学,无 GL)。 */
function _noop(): void { /* placeholder */ }
void _noop;

// ── ForwardPlusRenderer ───────────────────────────────────────────────

/**
 * Forward+ 渲染器:深度预 pass + 分块光源剔除 + 前向几何 pass。
 *
 * 典型用法:
 * ```ts
 * const fpr = new ForwardPlusRenderer(gl, { width: 800, height: 600 });
 * function frame() {
 *   fpr.render(gl, scene, camera, lights);
 *   requestAnimationFrame(frame);
 * }
 * ```
 */
export class ForwardPlusRenderer {
  readonly gl: WebGL2RenderingContext;
  screenWidth: number;
  screenHeight: number;

  /** 分块数(x/y 维度),由 tileSize 与屏幕尺寸算出。 */
  tileCount: { x: number; y: number } = { x: 0, y: 0 };
  /** 分块大小(像素)。 */
  tileSize: number;
  /** 每分块最大光源数(超出截断,记录 warn)。 */
  maxLightsPerTile: number;
  /** 光源索引缓冲(扁平光源索引列表)。每帧 computeLightTiles 后更新。 */
  lightIndexBuffer: Uint32Array | null = null;
  /** 光源网格缓冲(每 tile 2 uint:offset + count)。每帧 computeLightTiles 后更新。 */
  lightGridBuffer: Uint32Array | null = null;
  /** 是否启用深度预 pass(属性,对应 setDepthPrepass)。 */
  depthPrepassEnabled: boolean;
  /** 是否启用调试光源数统计。 */
  debugLightCount: boolean;

  /** 深度预 pass 着色器。 */
  depthShader: ShaderProgram;
  /** 几何 pass 着色器。 */
  geometryShader: ShaderProgram;

  private readonly _now: () => number;
  private _disposed: boolean = false;

  /** Per-geometry VAO + VBO 缓存(version 比对增量重传)。 */
  private _geomCache: WeakMap<BufferGeometry, {
    vao: WebGLVertexArrayObject;
    attrBuffers: Map<string, { buf: WebGLBuffer; version: number }>;
    indexBuf: WebGLBuffer | null;
    indexVersion: number;
  }> = new WeakMap();

  /** 复用的视锥体实例(每帧 setFromViewProjectionMatrix 覆写)。 */
  private _frustum: Frustum = new Frustum();
  /** 复用的 viewProjection scratch。 */
  private _viewProj: Matrix4 = new Matrix4();
  /**
   * 复用的 view matrix scratch。从 camera.matrixWorld 求逆得到 view 矩阵
   * (VREEN 的 matrixWorldInverse 不会由 updateMatrixWorld 自动同步,
   * 与 FrustumCuller 一致,这里手动求逆保证自包含可用)。
   */
  private _viewMatrix: Matrix4 = new Matrix4();
  /** 复用的 normal matrix scratch。 */
  private _normalMat3: Float32Array = new Float32Array(9);
  /** 复用的临时向量。 */
  private _tmpVec: Vector3 = new Vector3();

  /** 上一帧统计。 */
  stats: ForwardPlusStats = {
    tileCount: { x: 0, y: 0 },
    tileSize: 16,
    totalTiles: 0,
    maxLightsPerTile: 64,
    totalLights: 0,
    visibleLights: 0,
    culledLights: 0,
    avgLightsPerTile: 0,
    maxLightsInTile: 0,
    lightIndexCount: 0,
    depthPrepass: true,
    debugLightCount: false,
    depthDrawCalls: 0,
    geometryDrawCalls: 0,
    geometryTriangles: 0,
    frameTimeMs: 0,
  };

  constructor(gl: WebGL2RenderingContext, opts: ForwardPlusRendererOptions = {}) {
    this.gl = gl;
    this.screenWidth = opts.width ?? (gl.canvas as { width: number }).width ?? 1;
    this.screenHeight = opts.height ?? (gl.canvas as { height: number }).height ?? 1;
    this.tileSize = Math.max(1, opts.tileSize ?? 16);
    this.maxLightsPerTile = Math.max(1, opts.maxLightsPerTile ?? 64);
    this.depthPrepassEnabled = opts.depthPrepass ?? true;
    this.debugLightCount = opts.debugLightCount ?? false;
    this._now = opts.now ?? (() => performance.now());

    this._updateTileCount();
    this._initStats();

    // 编译着色器(失败抛错由调用方捕获)
    this.depthShader = new ShaderProgram(gl, DEPTH_VERT_SRC, DEPTH_FRAG_SRC);
    this.geometryShader = new ShaderProgram(gl, GEOMETRY_VERT_SRC, GEOMETRY_FRAG_SRC);

    log.info(
      `ForwardPlusRenderer created: ${this.screenWidth}x${this.screenHeight}, ` +
      `tile=${this.tileSize}px (${this.tileCount.x}×${this.tileCount.y}=${this.tileCount.x * this.tileCount.y}), ` +
      `maxLights/tile=${this.maxLightsPerTile}, depthPrepass=${this.depthPrepassEnabled}`,
    );
  }

  // ── 配置 ──────────────────────────────────────────────────────────

  /** 调整屏幕尺寸并重算分块数。 */
  resize(width: number, height: number): void {
    if (width < 1 || height < 1) {
      throw new Error(`ForwardPlusRenderer.resize: width/height must be >= 1 (got ${width}x${height})`);
    }
    if (width === this.screenWidth && height === this.screenHeight) return;
    this.screenWidth = width;
    this.screenHeight = height;
    this._updateTileCount();
    log.debug(`resized: ${width}x${height}, tiles=${this.tileCount.x}×${this.tileCount.y}`);
  }

  /** 设置分块大小(像素),触发重算分块数。 */
  setTileSize(size: number): void {
    if (size < 1) {
      throw new Error(`ForwardPlusRenderer.setTileSize: size must be >= 1 (got ${size})`);
    }
    if (size === this.tileSize) return;
    this.tileSize = size;
    this._updateTileCount();
  }

  /** 设置每分块最大光源数。 */
  setMaxLightsPerTile(max: number): void {
    if (max < 1) {
      throw new Error(`ForwardPlusRenderer.setMaxLightsPerTile: max must be >= 1 (got ${max})`);
    }
    this.maxLightsPerTile = max;
  }

  /** 设置是否启用深度预 pass。 */
  setDepthPrepass(enabled: boolean): void {
    this.depthPrepassEnabled = enabled;
  }

  /** 设置是否启用调试光源数统计。 */
  setDebugLightCount(enabled: boolean): void {
    this.debugLightCount = enabled;
  }

  // ── 查询 ──────────────────────────────────────────────────────────

  /** 获取光源网格缓冲(每 tile 2 uint:offset + count)。 */
  getLightGrid(): Uint32Array | null {
    return this.lightGridBuffer;
  }

  /** 获取光源索引缓冲(扁平光源索引列表)。 */
  getLightIndexBuffer(): Uint32Array | null {
    return this.lightIndexBuffer;
  }

  /** 获取当前分块数。 */
  getTileCount(): { x: number; y: number } {
    return { x: this.tileCount.x, y: this.tileCount.y };
  }

  /** 获取统计。 */
  getStats(): ForwardPlusStats {
    return {
      tileCount: { x: this.tileCount.x, y: this.tileCount.y },
      tileSize: this.tileSize,
      totalTiles: this.tileCount.x * this.tileCount.y,
      maxLightsPerTile: this.maxLightsPerTile,
      totalLights: this.stats.totalLights,
      visibleLights: this.stats.visibleLights,
      culledLights: this.stats.culledLights,
      avgLightsPerTile: this.stats.avgLightsPerTile,
      maxLightsInTile: this.stats.maxLightsInTile,
      lightIndexCount: this.stats.lightIndexCount,
      depthPrepass: this.depthPrepassEnabled,
      debugLightCount: this.debugLightCount,
      depthDrawCalls: this.stats.depthDrawCalls,
      geometryDrawCalls: this.stats.geometryDrawCalls,
      geometryTriangles: this.stats.geometryTriangles,
      frameTimeMs: this.stats.frameTimeMs,
    };
  }

  // ── 光源剔除(纯数学,无 GL) ─────────────────────────────────────

  /**
   * 视锥剔除光源:AmbientLight / DirectionalLight 始终可见;
   * PointLight / SpotLight / 其他位置光源按世界空间球体与视锥体求交。
   *
   * @returns 可见光源列表(原数组顺序保留)。
   */
  cullLights(lights: ForwardPlusLight[], camera: Camera): ForwardPlusLight[] {
    this._viewMatrix.getInverse(camera.matrixWorld);
    // 标准列主序:multiplyMatrices(a, b) = a × b,投影 × 视图 = projection * view。
    this._viewProj.multiplyMatrices(camera.projectionMatrix, this._viewMatrix);
    this._frustum.setFromViewProjectionMatrix(this._viewProj);

    const visible: ForwardPlusLight[] = [];
    let culled = 0;
    for (const light of lights) {
      if (light instanceof AmbientLight || light instanceof DirectionalLight) {
        visible.push(light);
        continue;
      }
      // 位置型光源:用球体与视锥体求交
      const range = this._getLightRange(light);
      // light.position 来自 Object3D(Light 继承 Object3D)
      const pos = (light as unknown as { position: Vector3 }).position;
      if (pos && this._frustum.intersectsSphere(pos, range)) {
        visible.push(light);
      } else {
        culled++;
      }
    }

    this.stats.totalLights = lights.length;
    this.stats.visibleLights = visible.length;
    this.stats.culledLights = culled;
    return visible;
  }

  /**
   * 计算光源分块:把每个光源投影到屏幕,确定覆盖的 tile 集合,
   * 构建 lightGridBuffer(每 tile offset+count) 与 lightIndexBuffer(扁平光源索引)。
   *
   * 必须在 cullLights 后调用(用可见光源集)。
   */
  computeLightTiles(lights: ForwardPlusLight[], camera: Camera): void {
    this._viewMatrix.getInverse(camera.matrixWorld);
    // 标准列主序:投影 × 视图 = projection * view。
    this._viewProj.multiplyMatrices(camera.projectionMatrix, this._viewMatrix);

    const tx = this.tileCount.x;
    const ty = this.tileCount.y;
    const totalTiles = tx * ty;

    if (totalTiles <= 0) {
      this.lightGridBuffer = new Uint32Array(0);
      this.lightIndexBuffer = new Uint32Array(0);
      this.stats.avgLightsPerTile = 0;
      this.stats.maxLightsInTile = 0;
      this.stats.lightIndexCount = 0;
      return;
    }

    // 每 tile 的光源列表
    const tileLights: number[][] = new Array(totalTiles);
    for (let i = 0; i < totalTiles; i++) tileLights[i] = [];

    for (let li = 0; li < lights.length; li++) {
      const light = lights[li];
      const coverage = this._computeLightTileCoverage(light);
      for (const t of coverage) {
        if (t < 0 || t >= totalTiles) continue;
        const list = tileLights[t];
        if (list.length < this.maxLightsPerTile) {
          list.push(li);
        } else if (list.length === this.maxLightsPerTile && this.debugLightCount) {
          // 仅在调试模式记录一次溢出
          log.warn(
            `tile ${t} exceeded maxLightsPerTile=${this.maxLightsPerTile}, ` +
            `light ${li} truncated`,
          );
          list.push(-1); // 标记溢出(稍后过滤)
        }
      }
    }

    // 拍平为缓冲
    const grid = new Uint32Array(totalTiles * 2);
    const indices: number[] = [];
    let offset = 0;
    let maxInTile = 0;
    let totalLightsInTiles = 0;
    for (let t = 0; t < totalTiles; t++) {
      const list = tileLights[t];
      // 过滤 -1 溢出标记
      const filtered = list.filter((v) => v >= 0);
      grid[t * 2] = offset;
      grid[t * 2 + 1] = filtered.length;
      for (const li of filtered) indices.push(li);
      offset += filtered.length;
      if (filtered.length > maxInTile) maxInTile = filtered.length;
      totalLightsInTiles += filtered.length;
    }

    this.lightGridBuffer = grid;
    this.lightIndexBuffer = new Uint32Array(indices);
    this.stats.maxLightsInTile = maxInTile;
    this.stats.avgLightsPerTile = totalTiles > 0 ? totalLightsInTiles / totalTiles : 0;
    this.stats.lightIndexCount = indices.length;
  }

  // ── GL 渲染 pass ──────────────────────────────────────────────────

  /** 深度预 pass:渲染场景几何到深度缓冲(只写深度,无着色)。 */
  depthPrepass(scene: Scene, camera: Camera): void {
    const gl = this.gl;
    let drawCalls = 0;

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.colorMask(false, false, false, false); // 关闭颜色写入

    this._viewMatrix.getInverse(camera.matrixWorld);
    this.depthShader.use();
    this.depthShader.setUniformMatrix4fv('u_view', this._viewMatrix.elements);
    this.depthShader.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);

    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!(mesh instanceof Mesh)) return;
      if (!mesh.visible) return;
      if (mesh instanceof SkinnedMesh) {
        // SkinnedMesh 深度预 pass 需要 skinning shader 变体,v1 跳过
        return;
      }
      const geom = mesh.geometry;
      if (!geom || !geom.attributes.position) return;
      this._bindGeometryAttributes(gl, geom);
      this.depthShader.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
      const pos = geom.attributes.position;
      const idx = geom.index;
      if (idx) {
        const is32 = (idx.array as ArrayLike<number>) instanceof Uint32Array;
        gl.drawElements(gl.TRIANGLES, idx.count, is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
        drawCalls++;
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, pos.count);
        drawCalls++;
      }
    });

    gl.colorMask(true, true, true, true); // 恢复颜色写入

    this.stats.depthDrawCalls = drawCalls;
    log.debug(`depthPrepass: draws=${drawCalls}`);
  }

  /** 几何 pass:前向渲染场景,使用分块光源列表着色。 */
  geometryPass(scene: Scene, camera: Camera, lights: ForwardPlusLight[]): void {
    const gl = this.gl;
    let drawCalls = 0;
    let triangles = 0;

    this._viewMatrix.getInverse(camera.matrixWorld);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    this.geometryShader.use();
    this.geometryShader.setUniformMatrix4fv('u_view', this._viewMatrix.elements);
    this.geometryShader.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);
    this.geometryShader.setUniform3f(
      'u_cameraPos',
      camera.position.x,
      camera.position.y,
      camera.position.z,
    );
    this.geometryShader.setUniform2f('u_screenSize', this.screenWidth, this.screenHeight);
    this.geometryShader.setUniform1f('u_tileSize', this.tileSize);

    // tileCount 用 ivec2,ShaderProgram 没有 setUniform2i,用 uniform1i 逐分量
    const tcxLoc = this.geometryShader.uniforms.get('u_tileCount[0]');
    const tcyLoc = this.geometryShader.uniforms.get('u_tileCount[1]');
    if (tcxLoc !== undefined) gl.uniform1i(tcxLoc, this.tileCount.x);
    if (tcyLoc !== undefined) gl.uniform1i(tcyLoc, this.tileCount.y);

    // 收集光源 uniform 数据
    this._uploadLightUniforms(gl, lights);

    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!(mesh instanceof Mesh)) return;
      if (!mesh.visible) return;
      if (mesh instanceof SkinnedMesh) {
        log.warn('Skipped SkinnedMesh in Forward+ geometry pass (not yet supported)');
        return;
      }
      const geom = mesh.geometry;
      if (!geom || !geom.attributes.position) return;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const m = mat as {
        baseColor?: { r: number; g: number; b: number };
        metallic?: number;
        roughness?: number;
        opacity?: number;
      };
      const baseColor = m?.baseColor ?? { r: 1, g: 1, b: 1 };
      this.geometryShader.setUniform3f('u_baseColor', baseColor.r, baseColor.g, baseColor.b);
      this.geometryShader.setUniform1f('u_metallic', m?.metallic ?? 0);
      this.geometryShader.setUniform1f('u_roughness', m?.roughness ?? 1);
      this.geometryShader.setUniform1f('u_opacity', m?.opacity ?? 1);

      this._bindGeometryAttributes(gl, geom);
      this.geometryShader.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
      mesh.matrixWorld.getNormalMatrix(this._normalMat3);
      this.geometryShader.setUniformMatrix3fv('u_normalMatrix', this._normalMat3);

      const pos = geom.attributes.position;
      const idx = geom.index;
      if (idx) {
        const is32 = (idx.array as ArrayLike<number>) instanceof Uint32Array;
        gl.drawElements(gl.TRIANGLES, idx.count, is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
        drawCalls++;
        triangles += idx.count / 3;
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, pos.count);
        drawCalls++;
        triangles += pos.count / 3;
      }
    });

    this.stats.geometryDrawCalls = drawCalls;
    this.stats.geometryTriangles = triangles;
    log.debug(`geometryPass: draws=${drawCalls}, tris=${Math.round(triangles)}`);
  }

  /**
   * 完整 Forward+ 渲染:depthPrepass(可选) → cullLights →
   * computeLightTiles → geometryPass。
   */
  render(
    scene: Scene,
    camera: Camera,
    lights: ForwardPlusLight[],
  ): void {
    if (this._disposed) {
      throw new Error('ForwardPlusRenderer.render: renderer disposed');
    }
    const t0 = this._now();

    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);

    // 重置统计(部分字段由各 pass 写入)
    this.stats.frameTimeMs = 0;

    // 1. 视锥剔除光源
    const visibleLights = this.cullLights(lights, camera);

    // 2. 分块光源剔除
    this.computeLightTiles(visibleLights, camera);

    // 3. 深度预 pass(可选)
    if (this.depthPrepassEnabled) {
      this.depthPrepass(scene, camera);
    } else {
      this.stats.depthDrawCalls = 0;
      // 仍需清深度缓冲
      const gl = this.gl;
      gl.clearDepth(1);
      gl.clear(gl.DEPTH_BUFFER_BIT);
    }

    // 4. 几何 pass
    this.geometryPass(scene, camera, visibleLights);

    this.stats.frameTimeMs = this._now() - t0;

    if (this.debugLightCount) {
      log.debug(
        `frame: lights=${lights.length} (visible=${visibleLights.length}, ` +
        `culled=${this.stats.culledLights}), avg/tile=${this.stats.avgLightsPerTile.toFixed(2)}, ` +
        `max/tile=${this.stats.maxLightsInTile}, dt=${this.stats.frameTimeMs.toFixed(2)}ms`,
      );
    }
  }

  /** 释放着色器资源。 */
  dispose(): void {
    if (this._disposed) return;
    this.depthShader.dispose();
    this.geometryShader.dispose();
    this._disposed = true;
    log.info('ForwardPlusRenderer disposed');
  }

  get disposed(): boolean {
    return this._disposed;
  }

  // ── private ───────────────────────────────────────────────────────

  private _updateTileCount(): void {
    this.tileCount.x = Math.max(1, Math.ceil(this.screenWidth / this.tileSize));
    this.tileCount.y = Math.max(1, Math.ceil(this.screenHeight / this.tileSize));
  }

  private _initStats(): void {
    this.stats.tileSize = this.tileSize;
    this.stats.totalTiles = this.tileCount.x * this.tileCount.y;
    this.stats.maxLightsPerTile = this.maxLightsPerTile;
    this.stats.depthPrepass = this.depthPrepassEnabled;
    this.stats.debugLightCount = this.debugLightCount;
  }

  /** 获取光源影响范围(世界空间半径)。 */
  private _getLightRange(light: ForwardPlusLight): number {
    if (light instanceof PointLight) {
      return light.distance > 0 ? light.distance : 10;
    }
    if (light instanceof SpotLight) {
      return light.distance > 0 ? light.distance : 10;
    }
    if (light instanceof HemisphereLight) {
      return Infinity; // 半球光全局可见
    }
    if (light instanceof RectAreaLight) {
      return 20; // 保守值
    }
    // 未知光源类型,保守取 10
    return 10;
  }

  /**
   * 计算单个光源覆盖的 tile 索引列表(纯数学,无 GL)。
   * - Ambient / Directional: 全部 tile
   * - Point / Spot / 位置型: 投影中心到 NDC,估算屏幕半径,取覆盖矩形
   */
  private _computeLightTileCoverage(light: ForwardPlusLight): number[] {
    const totalTiles = this.tileCount.x * this.tileCount.y;

    if (light instanceof AmbientLight || light instanceof DirectionalLight) {
      const all = new Array<number>(totalTiles);
      for (let i = 0; i < totalTiles; i++) all[i] = i;
      return all;
    }

    const pos = (light as unknown as { position: Vector3 }).position;
    if (!pos) {
      // 无位置信息,保守覆盖全部
      const all = new Array<number>(totalTiles);
      for (let i = 0; i < totalTiles; i++) all[i] = i;
      return all;
    }

    const range = this._getLightRange(light);
    if (!isFinite(range)) {
      // 无限范围光源(Hemisphere 等)覆盖全部
      const all = new Array<number>(totalTiles);
      for (let i = 0; i < totalTiles; i++) all[i] = i;
      return all;
    }

    // 投影光源中心到 NDC
    const centerNdc = this._projectToNDC(pos);
    if (centerNdc === null) {
      // 光源在相机后或退化,保守覆盖全部
      const all = new Array<number>(totalTiles);
      for (let i = 0; i < totalTiles; i++) all[i] = i;
      return all;
    }

    // 估算屏幕空间半径(NDC 单位):采样 6 轴向点取最大 NDC 距离
    const screenRadiusNdc = this._computeScreenRadiusNdc(pos, range);

    // NDC → tile 坐标(NDC [-1,1] → tile [0, tileCount])
    const sx = (centerNdc.x * 0.5 + 0.5) * this.tileCount.x;
    const sy = (centerNdc.y * 0.5 + 0.5) * this.tileCount.y;
    const rTilesX = (screenRadiusNdc * 0.5) * this.tileCount.x;
    const rTilesY = (screenRadiusNdc * 0.5) * this.tileCount.y;

    const minTx = Math.max(0, Math.floor(sx - rTilesX));
    const maxTx = Math.min(this.tileCount.x - 1, Math.ceil(sx + rTilesX));
    const minTy = Math.max(0, Math.floor(sy - rTilesY));
    const maxTy = Math.min(this.tileCount.y - 1, Math.ceil(sy + rTilesY));

    const tiles: number[] = [];
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        tiles.push(ty * this.tileCount.x + tx);
      }
    }
    return tiles;
  }

  /** 投影世界坐标到 NDC(viewProj * pos,透视除法)。光源在相机后返回 null。 */
  private _projectToNDC(pos: Vector3): { x: number; y: number; z: number } | null {
    const e = this._viewProj.elements;
    const x = pos.x, y = pos.y, z = pos.z;
    const clipX = e[0] * x + e[4] * y + e[8] * z + e[12];
    const clipY = e[1] * x + e[5] * y + e[9] * z + e[13];
    const clipZ = e[2] * x + e[6] * y + e[10] * z + e[14];
    const clipW = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (clipW <= 0.0001) return null; // 在相机后或退化
    const invW = 1 / clipW;
    return { x: clipX * invW, y: clipY * invW, z: clipZ * invW };
  }

  /**
   * 估算光源在 NDC 空间的半径:采样 6 轴向边界点,投影后取到中心的最大距离。
   * 任一采样点在相机后(返回 null)时退化为保守全屏覆盖(返回 2.0)。
   */
  private _computeScreenRadiusNdc(center: Vector3, range: number): number {
    const centerNdc = this._projectToNDC(center);
    if (centerNdc === null) return 2.0; // 保守全屏

    const offsets: Array<[number, number, number]> = [
      [range, 0, 0], [-range, 0, 0],
      [0, range, 0], [0, -range, 0],
      [0, 0, range], [0, 0, -range],
    ];
    let maxDist = 0;
    for (const off of offsets) {
      this._tmpVec.set(center.x + off[0], center.y + off[1], center.z + off[2]);
      const ndc = this._projectToNDC(this._tmpVec);
      if (ndc === null) return 2.0; // 保守全屏
      const dx = ndc.x - centerNdc.x;
      const dy = ndc.y - centerNdc.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > maxDist) maxDist = d;
    }
    return maxDist;
  }

  /** 上传光源 uniform 数组 + 累加 ambient 颜色。 */
  private _uploadLightUniforms(gl: WebGL2RenderingContext, lights: ForwardPlusLight[]): void {
    let ambientR = 0, ambientG = 0, ambientB = 0;
    let ambientCount = 0;
    let lightIdx = 0;
    const maxArrayLights = 256; // 与 shader MAX_LIGHTS 一致

    for (const light of lights) {
      if (lightIdx >= maxArrayLights) {
        log.warn(`light count exceeds MAX_LIGHTS=${maxArrayLights}, truncating`);
        break;
      }

      if (light instanceof AmbientLight) {
        ambientR += light.color.r * light.intensity;
        ambientG += light.color.g * light.intensity;
        ambientB += light.color.b * light.intensity;
        ambientCount++;
        // ambient 也写入数组(类型 0),供 shader 跳过
        this._setLightUniform(gl, lightIdx, 0, light.color, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, light.intensity, 0, 0);
        lightIdx++;
        continue;
      }

      if (light instanceof DirectionalLight) {
        this._setLightUniform(
          gl, lightIdx, 1, light.color,
          light.direction, { x: 0, y: 0, z: 0 },
          light.intensity, 0, 0,
        );
        lightIdx++;
        continue;
      }

      if (light instanceof PointLight) {
        this._setLightUniform(
          gl, lightIdx, 2, light.color,
          { x: 0, y: 0, z: 0 }, light.position,
          light.intensity, light.distance, light.decay,
        );
        lightIdx++;
        continue;
      }

      if (light instanceof SpotLight) {
        // 近似为 point light(锥角内保守)
        this._setLightUniform(
          gl, lightIdx, 2, light.color,
          { x: 0, y: 0, z: 0 }, light.position,
          light.intensity, light.distance, light.decay,
        );
        lightIdx++;
        continue;
      }

      if (light instanceof HemisphereLight) {
        // 近似为 ambient
        ambientR += light.color.r * light.intensity * 0.5;
        ambientG += light.color.g * light.intensity * 0.5;
        ambientB += light.color.b * light.intensity * 0.5;
        ambientCount++;
        this._setLightUniform(gl, lightIdx, 0, light.color, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, light.intensity, 0, 0);
        lightIdx++;
        continue;
      }

      if (light instanceof RectAreaLight) {
        // 近似为 point light
        this._setLightUniform(
          gl, lightIdx, 2, light.color,
          { x: 0, y: 0, z: 0 }, light.position,
          light.intensity, 20, 2,
        );
        lightIdx++;
        continue;
      }

      // 未知光源类型,按 ambient 处理
      ambientR += light.color.r * light.intensity;
      ambientG += light.color.g * light.intensity;
      ambientB += light.color.b * light.intensity;
      ambientCount++;
      this._setLightUniform(gl, lightIdx, 0, light.color, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, light.intensity, 0, 0);
      lightIdx++;
    }

    const totalLoc = this.geometryShader.uniforms.get('u_totalLights');
    if (totalLoc !== undefined) gl.uniform1i(totalLoc, lightIdx);
    const ambientCountLoc = this.geometryShader.uniforms.get('u_ambientLightCount');
    if (ambientCountLoc !== undefined) gl.uniform1i(ambientCountLoc, ambientCount);
    this.geometryShader.setUniform3f('u_ambientColor', ambientR, ambientG, ambientB);
  }

  /** 设置单个光源的 uniform 数组项。 */
  private _setLightUniform(
    gl: WebGL2RenderingContext,
    idx: number,
    type: number,
    color: { r: number; g: number; b: number },
    dir: { x: number; y: number; z: number },
    pos: { x: number; y: number; z: number },
    intensity: number,
    distance: number,
    decay: number,
  ): void {
    const typeLoc = this.geometryShader.uniforms.get(`u_lightType[${idx}]`);
    if (typeLoc !== undefined) gl.uniform1i(typeLoc, type);

    const colorLoc = this.geometryShader.uniforms.get(`u_lightColor[${idx}]`);
    if (colorLoc !== undefined) gl.uniform3f(colorLoc, color.r, color.g, color.b);

    const dirLoc = this.geometryShader.uniforms.get(`u_lightDir[${idx}]`);
    if (dirLoc !== undefined) gl.uniform3f(dirLoc, dir.x, dir.y, dir.z);

    const posLoc = this.geometryShader.uniforms.get(`u_lightPos[${idx}]`);
    if (posLoc !== undefined) gl.uniform3f(posLoc, pos.x, pos.y, pos.z);

    const intensityLoc = this.geometryShader.uniforms.get(`u_lightIntensity[${idx}]`);
    if (intensityLoc !== undefined) gl.uniform1f(intensityLoc, intensity);

    const distLoc = this.geometryShader.uniforms.get(`u_lightDistance[${idx}]`);
    if (distLoc !== undefined) gl.uniform1f(distLoc, distance);

    const decayLoc = this.geometryShader.uniforms.get(`u_lightDecay[${idx}]`);
    if (decayLoc !== undefined) gl.uniform1f(decayLoc, decay);
  }

  /** 为 geometry 绑定 VAO + VBO(缓存在 _geomCache,version 变更时重传)。 */
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
    // 索引缓冲
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
}
