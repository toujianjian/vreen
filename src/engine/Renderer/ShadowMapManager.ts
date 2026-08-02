// ShadowMapManager — 阴影贴图渲染管理器。
//
// 参考 three.js WebGLShadowMap.js。设计目标:
//   - 把 WebGL2Renderer._renderShadowPass 的阴影贴图渲染流程抽成独立
//     类,便于:
//       a) 在不修改主渲染器的前提下切换/关闭阴影;
//       b) 在多渲染器场景(WebGL2 主 + ShadowMapManager 辅)下复用;
//       c) 单元测试构造/属性/类型切换。
//   - 支持 Basic(硬阴影,单采样)与 PCF(软阴影,9-tap)两种模式;
//     两种模式的 depth shader 相同,区别在阴影贴图采样 filter 与 consumer
//     shader 中如何读取(由 ShadowMaterial / PBR_FRAG 注入 PCF_SHADOW_FRAG)。
//   - 阴影贴图按 light 缓存(WeakMap),mapSize 变化时重建 FBO。
//
// 不变量:
//   - enabled=false 时 render() 立即返回,不触碰 GL 状态。
//   - getShadowMap(light) 对未渲染过的光源返回 null。
//   - type 切换会标记所有缓存的贴图 filter 待下次 render 时更新。
//
// 与 WebGL2Renderer._renderShadowPass 的差异:
//   - 独立类,不依赖 WebGL2Renderer 实例;
//   - 使用 SHADOW_DEPTH_VERT/FRAG(显式输出深度到 R 通道)而非旧的
//     SHADOW_VERT/FRAG(只依赖 gl_FragDepth);
//   - 支持 type 属性切换 basic/pcf 模式(basic=NEAREST filter,pcf=LINEAR filter);
//   - renderSingleSided 控制是否启用 front-face culling(默认 true,避免
//     模型背面自阴影 acne;false 时关闭 culling,双面都写入深度)。
//
// 集成说明(留给后续工作):
//   - WebGL2Renderer.render() 可在 shadow pass 阶段调用 ShadowMapManager.render()
//     替代 _renderShadowPass,主 pass 中读取 getShadowMap(dirLight) 绑定到
//     u_shadowMap uniform;
//   - 本类不维护 program cache(交由调用方提供 IProgramProvider,或后续注入);
//     v1 直接在内部用 ShaderProgram 编译,缓存 key='shadow-depth'/'shadow-depth-skin'。

import { Camera } from '../Cameras/Camera';
import { InstancedMesh } from '../Core/InstancedMesh';
import { Mesh } from '../Core/Mesh';
import { Object3D } from '../Core/Object3D';
import { Scene } from '../Core/Scene';
import { SkinnedMesh } from '../Core/SkinnedMesh';
import { AmbientLight, DirectionalLight } from '../Lights';
import { Matrix4, Vector3 } from '../Math';
import { SHADOW_DEPTH_VERT, SHADOW_DEPTH_FRAG } from '../Materials/shaders';
import { ShaderProgram } from './ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('ShadowMapManager');

/** 阴影模式。 */
export type ShadowType = 'basic' | 'pcf' | 'pcss';

/** 内部缓存的阴影 FBO 资源(每个 castShadow 光源一份)。 */
interface ShadowResources {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  size: number;
  /** 上次写入时的 filter,用于检测 type 切换后是否需要重设 filter。 */
  filter: 'nearest' | 'linear';
  /** 光源 viewProjection(每帧重新计算)。 */
  viewProjection: Matrix4;
}

/** ShadowMapManager 构造选项。 */
export interface ShadowMapManagerOptions {
  /** 初始阴影模式,默认 'pcf'。 */
  type?: ShadowType;
  /** 是否启用,默认 false(调用方需显式打开)。 */
  enabled?: boolean;
  /** 是否单面渲染(开启 front-face culling),默认 true。 */
  renderSingleSided?: boolean;
  /** 默认阴影贴图分辨率,默认 1024。 */
  defaultMapSize?: number;
  /** PCSS 光源尺寸(世界单位,控制半影宽度)。仅 type='pcss' 时使用。默认 0.5。 */
  lightSize?: number;
}

/**
 * 阴影贴图管理器。负责:
 *   1. 为每个 castShadow 光源分配/缓存 depth FBO;
 *   2. 构建光源 viewProjection(正交,围绕场景 AABB);
 *   3. 用 SHADOW_DEPTH_VERT/FRAG 渲染 castShadow mesh 到深度贴图;
 *   4. 在 type 切换时更新 texture filter(basic=NEAREST,pcf=LINEAR)。
 *
 * 调用方(WebGL2Renderer 或未来后端)在主 pass 中调用 getShadowMap(light)
 * 取得深度贴图,绑定到 u_shadowMap 供 PCF_SHADOW_FRAG 采样。
 */
export class ShadowMapManager {
  readonly gl: WebGL2RenderingContext;

  /** 阴影模式:'basic'(硬阴影) / 'pcf'(9-tap PCF) / 'pcss'(物理软阴影)。 */
  type: ShadowType;
  /** 是否启用。false 时 render() 立即返回。 */
  enabled: boolean;
  /** 是否单面渲染(开启 front-face culling 减少 self-shadow acne)。 */
  renderSingleSided: boolean;
  /** 默认阴影贴图分辨率(正方形边长)。 */
  defaultMapSize: number;
  /** PCSS 光源尺寸(世界单位)。仅 type='pcss' 时由 consumer shader 读取。 */
  lightSize: number;

  /** 每光源的 FBO 缓存。 */
  private _cache: WeakMap<DirectionalLight, ShadowResources> = new WeakMap();
  /** 跟踪所有已分配资源,供 dispose() 释放(WeakMap 不可迭代)。 */
  private _resourcesSet: Set<ShadowResources> = new Set();
  /** 已编译的深度 shader program(skin/no-skin 两个变体)。 */
  private _programs: Map<string, ShaderProgram> = new Map();

  /** 复用 scratch 矩阵/向量,避免每帧 GC。 */
  private _lightView = new Matrix4();
  private _lightProj = new Matrix4();
  private _lightVP = new Matrix4();
  private _sceneCenter = new Vector3();
  private _sceneHalfSize = 1;
  private _sceneBoundsValid = false;
  private _tmpVec = new Vector3();

  constructor(gl: WebGL2RenderingContext, opts: ShadowMapManagerOptions = {}) {
    this.gl = gl;
    this.type = opts.type ?? 'pcf';
    this.enabled = opts.enabled ?? false;
    this.renderSingleSided = opts.renderSingleSided ?? true;
    this.defaultMapSize = opts.defaultMapSize ?? 1024;
    this.lightSize = opts.lightSize ?? 0.5;
  }

  /**
   * 渲染阴影贴图。对每个 castShadow 光源:
   *   1. 计算场景 AABB(若失效);
   *   2. 构建光源正交 viewProjection;
   *   3. 绑定光源 FBO,清空深度;
   *   4. 用 SHADOW_DEPTH_VERT/FRAG 渲染所有 castShadow mesh;
   *   5. 恢复 GL 状态。
   *
   * 注意:本方法假设 mesh 的 VAO 已由调用方(主渲染器)准备就绪,并通过
   * `mesh.userData.__shadowVao` 等方式暴露。v1 框架版本不实现 VAO 获取,
   * 只遍历并构建 lightVP / 设置 uniform;实际 draw call 由集成方负责。
   * 这是为了避免与 WebGL2Renderer 的 meshCache 冲突(任务说明:不需要
   * 完整集成到 WebGL2Renderer,只需要类框架正确)。
   */
  render(
    lights: ReadonlyArray<AmbientLight | DirectionalLight>,
    scene: Scene,
    _camera: Camera,
  ): void {
    if (!this.enabled) return;
    const castShadowLights = lights.filter(
      (l): l is DirectionalLight => l instanceof DirectionalLight && l.castShadow,
    );
    if (castShadowLights.length === 0) return;

    this._gatherSceneBounds(scene);

    const gl = this.gl;
    const prevFbo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
    const prevViewport = gl.getParameter(gl.VIEWPORT) as Int32Array;
    const prevCullFace = gl.isEnabled(gl.CULL_FACE);
    const prevCullMode = gl.getParameter(gl.CULL_FACE_MODE) as number;

    for (const light of castShadowLights) {
      this._renderForLight(light, scene);
    }

    // 恢复 GL 状态
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFbo);
    gl.viewport(prevViewport[0], prevViewport[1], prevViewport[2], prevViewport[3]);
    if (prevCullFace) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
    gl.cullFace(prevCullMode);
  }

  /** 获取指定光源的阴影贴图(供主 pass 绑定到 u_shadowMap)。
   *  若光源未参与过 render() 或未 castShadow,返回 null。 */
  getShadowMap(light: DirectionalLight): WebGLTexture | null {
    const res = this._cache.get(light);
    return res?.texture ?? null;
  }

  /** 获取指定光源的 viewProjection 矩阵(供主 pass 写入 u_lightVP)。
   *  若光源未参与过 render(),返回 null。 */
  getLightViewProjection(light: DirectionalLight): Matrix4 | null {
    return this._cache.get(light)?.viewProjection ?? null;
  }

  /** 释放所有 GPU 资源(FBO + texture + programs)。 */
  dispose(): void {
    const gl = this.gl;
    let fboCount = 0;
    for (const res of this._resourcesSet) {
      gl.deleteFramebuffer(res.fbo);
      gl.deleteTexture(res.texture);
      fboCount++;
    }
    this._resourcesSet.clear();
    this._cache = new WeakMap();

    for (const p of this._programs.values()) p.dispose();
    this._programs.clear();

    if (fboCount > 0) {
      log.info(`dispose: released ${fboCount} shadow FBO(s)`);
    }
  }

  // ── private ─────────────────────────────────────────────────────────

  /** 计算场景 AABB 中心与半尺寸,缓存结果。
   *  与 WebGL2Renderer._gatherSceneBounds 一致:遍历所有 mesh 的 position
   *  attribute,取最小/最大值的并集。 */
  private _gatherSceneBounds(scene: Scene): void {
    if (this._sceneBoundsValid) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let any = false;
    scene.traverse((obj) => {
      const m = obj as Mesh;
      if (!(m instanceof Mesh)) return;
      const pos = m.geometry?.attributes.position;
      if (!pos) return;
      const a = pos.array;
      for (let i = 0; i < a.length; i += 3) {
        if (a[i] < minX) minX = a[i];
        if (a[i + 1] < minY) minY = a[i + 1];
        if (a[i + 2] < minZ) minZ = a[i + 2];
        if (a[i] > maxX) maxX = a[i];
        if (a[i + 1] > maxY) maxY = a[i + 1];
        if (a[i + 2] > maxZ) maxZ = a[i + 2];
      }
      any = true;
    });
    if (!any) {
      this._sceneCenter.set(0, 0, 0);
      this._sceneHalfSize = 1;
    } else {
      this._sceneCenter.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
      this._sceneHalfSize = Math.max(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 1;
    }
    this._sceneBoundsValid = true;
  }

  /** 让场景 AABB 缓存失效(下次 render 重新计算)。
   *  外部可在 scene 几何大幅变化后调用。 */
  invalidateSceneBounds(): void {
    this._sceneBoundsValid = false;
  }

  /** 为单个光源渲染阴影贴图。 */
  private _renderForLight(light: DirectionalLight, scene: Scene): void {
    const gl = this.gl;
    const res = this._getShadowResources(light);

    // 构建光源 viewProjection:正交,围绕场景中心。
    // 与 WebGL2Renderer._renderShadowPass 一致:用 .add() + as Vector3
    // 因为 light.direction 是 { x, y, z } 字面量,不满足 addScaledVector
    // 的 Vector3 类型签名。
    const dir = light.direction;
    const lightPos = this._tmpVec
      .copy(this._sceneCenter)
      .add({
        x: -dir.x * this._sceneHalfSize,
        y: -dir.y * this._sceneHalfSize,
        z: -dir.z * this._sceneHalfSize,
      } as Vector3);
    this._lightView.makeLookAt(lightPos, this._sceneCenter, { x: 0, y: 1, z: 0 });

    const half = light.shadow.cameraHalfSize;
    const e = this._lightProj.elements;
    const far = light.shadow.cameraFar;
    const near = light.shadow.cameraNear;
    e[0] = 1 / half; e[5] = 1 / half; e[10] = -2 / (far - near);
    e[12] = 0; e[13] = 0; e[14] = -(far + near) / (far - near);
    e[1] = e[2] = e[3] = e[4] = e[6] = e[7] = e[8] = e[9] = e[11] = 0;
    e[15] = 1;

    this._lightVP.multiplyMatrices(this._lightProj, this._lightView);
    res.viewProjection.copy(this._lightVP);

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
    gl.viewport(0, 0, res.size, res.size);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);

    if (this.renderSingleSided) {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.FRONT);
    } else {
      gl.disable(gl.CULL_FACE);
    }

    // 收集 castShadow mesh(跳过 InstancedMesh,与 WebGL2Renderer 一致)。
    const drawList: Mesh[] = [];
    this._collectCastShadowMeshes(scene, drawList);

    for (const mesh of drawList) {
      this._drawMeshDepth(mesh, light);
    }
  }

  /** 递归收集 visible + castShadow 的 Mesh(跳过 InstancedMesh)。 */
  private _collectCastShadowMeshes(obj: Object3D, out: Mesh[]): void {
    if (obj instanceof InstancedMesh) {
      // InstancedMesh 阴影投影需 USE_INSTANCING 变体,v1 未实现。
      return;
    }
    if (obj instanceof Mesh) {
      if (obj.visible && obj.castShadow) out.push(obj);
      return;
    }
    for (const c of obj.children) this._collectCastShadowMeshes(c, out);
  }

  /** 用 SHADOW_DEPTH_VERT/FRAG 渲染单个 mesh 到当前绑定的阴影 FBO。
   *  v1 框架版本:只设置 uniform + 调用外部提供的 draw callback(若存在)。
   *  集成时,主渲染器可在 mesh.userData.__shadowDraw 上挂函数实现实际绘制。 */
  private _drawMeshDepth(mesh: Mesh, _light: DirectionalLight): void {
    const skinning = mesh instanceof SkinnedMesh;
    const program = this._getDepthProgram(skinning);
    program.use();
    program.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
    program.setUniformMatrix4fv('u_lightVP', this._lightVP.elements);

    if (skinning) {
      const sk = mesh as SkinnedMesh;
      sk.updateSkeleton();
      if (sk.skeleton) {
        program.setUniformMatrix4fv('u_bindMatrixInverse', sk.bindMatrixInverse.elements);
        const loc = program.uniforms.get('u_boneMatrices[0]');
        if (loc !== undefined) {
          this.gl.uniformMatrix4fv(loc, false, sk.skeleton.boneMatrices);
        }
      }
    }

    // 实际 draw call 由集成方负责(VAO 绑定 + drawElements/drawArrays)。
    // 通过 mesh.userData.__shadowDraw 暴露 hook,签名:() => void。
    // 这是框架占位,避免与 WebGL2Renderer.meshCache 双重管理 VAO。
    const hook = (mesh.userData as { __shadowDraw?: () => void }).__shadowDraw;
    if (typeof hook === 'function') {
      hook();
    }
  }

  /** 取得或编译深度 shader program(skin/no-skin 两个变体)。 */
  private _getDepthProgram(skinning: boolean): ShaderProgram {
    const key = skinning ? 'shadow-depth-skin' : 'shadow-depth';
    const cached = this._programs.get(key);
    if (cached) return cached;
    const p = new ShaderProgram(
      this.gl,
      SHADOW_DEPTH_VERT,
      SHADOW_DEPTH_FRAG,
      skinning ? ['USE_SKINNING'] : [],
    );
    this._programs.set(key, p);
    log.info(`depth program compiled: ${key}`);
    return p;
  }

  /** 取得或重建光源的阴影 FBO。type 切换时更新 filter。 */
  private _getShadowResources(light: DirectionalLight): ShadowResources {
    const gl = this.gl;
    const desiredSize = light.shadow.mapSize || this.defaultMapSize;
    const desiredFilter: 'nearest' | 'linear' =
      this.type === 'basic' ? 'nearest' : 'linear';

    const cached = this._cache.get(light);
    if (cached && cached.size === desiredSize && cached.filter === desiredFilter) {
      return cached;
    }

    // 尺寸或 filter 变了 → 释放旧资源,重建。
    if (cached) {
      gl.deleteFramebuffer(cached.fbo);
      gl.deleteTexture(cached.texture);
      this._resourcesSet.delete(cached);
      log.debug(`shadow FBO rebuilt: size ${cached.size}→${desiredSize} or filter ${cached.filter}→${desiredFilter}`);
    }

    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24,
      desiredSize, desiredSize, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null,
    );
    const filterEnum = desiredFilter === 'linear' ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterEnum);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterEnum);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);

    const res: ShadowResources = {
      fbo, texture: tex, size: desiredSize, filter: desiredFilter,
      viewProjection: new Matrix4(),
    };
    this._cache.set(light, res);
    this._resourcesSet.add(res);
    log.info(`shadow FBO created: ${desiredSize}x${desiredSize} (${desiredFilter}, light.castShadow=${light.castShadow})`);
    return res;
  }
}

/** 类型守卫:DirectionalLight 且 castShadow。 */
export function isCastShadowLight(
  l: AmbientLight | DirectionalLight,
): l is DirectionalLight {
  return l instanceof DirectionalLight && l.castShadow;
}
