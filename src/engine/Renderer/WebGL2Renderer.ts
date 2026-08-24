// WebGL2Renderer — the heart of the new engine. Takes a Scene + Camera,
// does shadow pass (if any DirectionalLight has castShadow) then main
// pass. Manages a per-geometry VAO cache and a per-light shadow FBO
// cache; both are invalidated by `version` counters so re-uploads only
// happen on actual CPU-side changes.

import { Camera } from '../Cameras/Camera';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import { InstancedMesh } from '../Core/InstancedMesh';
import { LOD } from '../Core/LOD';
import { Object3D } from '../Core/Object3D';
import { Scene } from '../Core/Scene';
import { SkinnedMesh } from '../Core/SkinnedMesh';
import { Matrix4, Vector3 } from '../Math';
import { AmbientLight, DirectionalLight } from '../Lights';
import { StandardMaterial, STANDARD_FRAGMENT_SRC, STANDARD_VERTEX_SRC } from '../Materials/StandardMaterial';
import { ShaderMaterial as ShaderMaterialCls } from '../Materials/ShaderMaterial';
import {
  HairMarschnerMaterial as HairMarschnerMaterialCls,
  HAIR_MARSCHNER_VERT,
  HAIR_MARSCHNER_FRAG,
} from '../Materials/HairMarschnerMaterial';
import { SHADOW_FRAG, SHADOW_VERT, DEPTH_NORMAL_VERT, DEPTH_NORMAL_FRAG, SSAO_VERT, SSAO_FRAG, POST_VERT, BLOOM_EXTRACT_FRAG, BLOOM_BLUR_FRAG, CHROMATIC_ABERRATION_FRAG, VIGNETTE_FRAG, FINAL_COMPOSE_FRAG } from '../Materials/shaders';
import { ShaderProgram } from './ShaderProgram';
import type { Renderer } from './Renderer';
import { Frustum } from '../Math/Frustum';
import { createLogger } from '@/lib/logger';

const log = createLogger('Renderer');

interface MeshResources {
  vao: WebGLVertexArrayObject;
  /** Maps attribute name -> VBO + cached CPU version. */
  buffers: Map<string, { buf: WebGLBuffer; version: number; itemSize: number }>;
  /** Index buffer (optional). */
  index: { buf: WebGLBuffer; count: number; version: number; is32: boolean } | null;
  /** Sum of vertex counts across attributes (we just take position.count). */
  vertexCount: number;
  /** Sum of triangles (computed from index or position.count/3). */
  triangleCount: number;
}

interface ShadowResources {
  fbo: WebGLFramebuffer;
  texture: WebGLTexture;
  size: number;
  /** Cached light viewProjection; recomputed each shadow pass. */
  viewProjection: Matrix4;
  /** Stable view target — set to the scene AABB center once. */
  target: Vector3;
}

interface SSAOResources {
  depthFbo: WebGLFramebuffer;
  depthTexture: WebGLTexture;
  normalTexture: WebGLTexture;
  ssaoFbo: WebGLFramebuffer;
  ssaoTexture: WebGLTexture;
  size: number;
}

interface PostProcessingResources {
  mainFbo: WebGLFramebuffer;
  mainTexture: WebGLTexture;
  mainDepth: WebGLRenderbuffer;
  bloomFbo1: WebGLFramebuffer;
  bloomTexture1: WebGLTexture;
  bloomFbo2: WebGLFramebuffer;
  bloomTexture2: WebGLTexture;
  finalFbo: WebGLFramebuffer;
  finalTexture: WebGLTexture;
  width: number;
  height: number;
}

/** 单 mesh 的 draw call 贡献(用 mesh.name 当 key)。 */
export interface DrawCallEntry {
  /** 该帧 draw call 次数。 */
  calls: number;
  /** 该帧三角形总数。 */
  triangles: number;
  /** 命中的 pass 标签,用于区分开销来源。 */
  passes: { main: number; shadow: number; ssao: number; helper: number };
}

export interface RendererStats {
  drawCalls: number;
  triangles: number;
  shadowPasses: number;
  programs: number;
  /** 当前帧按 mesh name 拆解的 draw call 明细。key = mesh.name。 */
  drawCallBreakdown: Record<string, DrawCallEntry>;
}

export class WebGL2Renderer implements Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  /** Background clear color. Pure black default. */
  clearColor: { r: number; g: number; b: number; a: number } = { r: 0, g: 0, b: 0, a: 1 };
  /** Pixel ratio used for backing-store sizing. */
  pixelRatio: number = Math.min(window.devicePixelRatio || 1, 2);

  ssaoEnabled: boolean = false;
  ssaoRadius: number = 1.5;
  ssaoBias: number = 0.025;

  postProcessingEnabled: boolean = false;
  bloomEnabled: boolean = false;
  bloomIntensity: number = 0.6;
  bloomThreshold: number = 0.85;
  chromaticAberrationEnabled: boolean = false;
  chromaticAberrationOffset: number = 0.0008;
  vignetteEnabled: boolean = false;
  vignetteDarkness: number = 0.45;
  vignetteOffset: number = 0.0;

  /** 场景环境预设名(uiStore → renderer 的桥梁)。 */
  environmentPreset: string = 'midnight';
  /** 0..2,>1 提升曝光。 */
  environmentIntensity: number = 1.0;
  /** 0..2,>1 提亮。 */
  environmentExposure: number = 1.0;

  /** Frustum culling 开关(Phase 2.2.1)。开启后视锥体外的 mesh 被跳过。
   *  Helper mesh(网格/接触点/速度箭头)永远不受 culling 影响。 */
  frustumCullingEnabled: boolean = true;

  private programCache: Map<string, ShaderProgram> = new Map();
  private meshCache: WeakMap<BufferGeometry, MeshResources> = new WeakMap();
  private shadowCache: WeakMap<DirectionalLight, ShadowResources> = new WeakMap();
  /** Tracks all allocated ShadowResources so dispose() can free them
   *  (WeakMap has no iterator). Entries are removed when resized/replaced. */
  private _shadowResourcesSet: Set<ShadowResources> = new Set();
  private ssaoResources: SSAOResources | null = null;
  private postResources: PostProcessingResources | null = null;
  /** 真机 GPU 上后处理任一 FBO 不完整时置真,render() 降级为直绘到屏幕,
   *  避免"静默黑屏"(SwiftShader 宽容自动补全而严格驱动拒绝写入)。 */
  private _postFboBroken = false;

  /** Reusable scratch objects — avoid per-frame allocation. */
  private _viewMatrix = new Matrix4();
  private _projViewMatrix = new Matrix4();
  private _lightView = new Matrix4();
  private _lightProj = new Matrix4();
  private _lightVP = new Matrix4();
  private _normalMat3 = new Float32Array(9);
  private _tmpVec = new Vector3();
  /** InstancedMesh 渲染时用作 u_model 的 identity scratch。 */
  private _identityMat = new Matrix4();
  private _sceneCenter = new Vector3();
  private _sceneHalfSize = 1;
  private _sceneBoundsValid = false;

  /**
   * 把单次 draw call 计入 `stats.drawCallBreakdown`。key 用 mesh.name,
   * 缺失时退到 mesh uuid + 三角面数(避免多 mesh 撞 key)。
   */
  private _recordDrawCall(
    mesh: Mesh,
    pass: 'main' | 'shadow' | 'ssao' | 'helper',
    triangles: number,
  ): void {
    const key = mesh.name || mesh.uuid || '(unnamed)';
    let entry = this.stats.drawCallBreakdown[key];
    if (!entry) {
      entry = { calls: 0, triangles: 0, passes: { main: 0, shadow: 0, ssao: 0, helper: 0 } };
      this.stats.drawCallBreakdown[key] = entry;
    }
    entry.calls += 1;
    entry.triangles += triangles;
    entry.passes[pass] += 1;
  }

  /** Last frame's stats — UI can read. */
  stats: RendererStats = {
    drawCalls: 0,
    triangles: 0,
    shadowPasses: 0,
    programs: 0,
    drawCallBreakdown: {},
  };

  constructor(canvas: HTMLCanvasElement, opts: { antialias?: boolean } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: opts.antialias ?? true,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      log.error('WebGL2 is not available in this browser/environment');
      throw new Error('WebGL2 is not available in this browser');
    }
    this.gl = gl;
    log.info(`WebGL2 context created: canvas=${canvas.width}x${canvas.height}, ` +
      `antialias=${opts.antialias ?? true}, vendor=${gl.getParameter(gl.VENDOR) || '?'}, ` +
      `renderer=${gl.getParameter(gl.RENDERER) || '?'}`);

    // Sane defaults for opaque PBR.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    log.debug('GL state defaults set: DEPTH_TEST, CULL_FACE back, CCW front');
  }

  resize(width: number, height: number): void {
    const dpr = this.pixelRatio;
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    log.debug(`resize: ${width}x${height} (dpr=${dpr}) → backing ${w}x${h}`);
  }

  clear(): void {
    const gl = this.gl;
    const c = this.clearColor;
    gl.clearColor(c.r, c.g, c.b, c.a);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  /** Compile (or fetch from cache) a shader program. */
  getProgram(key: string, vertSrc: string, fragSrc: string, defines: string[] = []): ShaderProgram {
    let p = this.programCache.get(key);
    if (p) return p;
    const t0 = performance.now();
    p = new ShaderProgram(this.gl, vertSrc, fragSrc, defines);
    this.programCache.set(key, p);
    log.info(`program compiled: "${key}" defines=[${defines.join(',') || 'none'}] ` +
      `in ${(performance.now() - t0).toFixed(1)}ms (cache size=${this.programCache.size})`);
    return p;
  }

  /** Build the program for a material on a given mesh. Picks the
   *  USE_SKINNING variant for SkinnedMesh automatically. */
  getProgramFor(mesh: Mesh, mat: StandardMaterial): { program: ShaderProgram; skinning: boolean } {
    const skinning = mesh instanceof SkinnedMesh;
    const key = skinning ? 'standard-skinning' : 'standard';
    const program = this.getProgram(key, STANDARD_VERTEX_SRC, STANDARD_FRAGMENT_SRC, skinning ? ['USE_SKINNING'] : []);
    if (!mat.program) mat.program = program;
    return { program, skinning };
  }

  // ── public render entry ─────────────────────────────────────────────
  private _renderCount = 0;
  /** 复用的视锥体实例(每帧 setFromViewProjectionMatrix 覆写,避免 GC)。 */
  private _frustum = new Frustum();
  /** 复用的世界空间球心 scratch(避免每 mesh new Vector3)。 */
  private _cullCenter = new Vector3();
  /** 本帧被 culling 跳过的 mesh 计数(统计/HUD 用)。 */
  private _culledCount = 0;
  render(scene: Scene, camera: Camera): void {
    const t0 = performance.now();
    this._renderCount++;
    if (camera instanceof Camera) {
      camera.updateMatrixWorld(true);
    }
    scene.updateMatrixWorld(true);

    this._sceneBoundsValid = false;
    this._gatherSceneBounds(scene);

    this.stats.drawCalls = 0;
    this.stats.triangles = 0;
    this.stats.shadowPasses = 0;
    this.stats.drawCallBreakdown = {};

    // 1. Shadow pass — for every castShadow light
    const lights = this._collectLights(scene);
    const castShadowLights = lights.filter((l) => l instanceof DirectionalLight && l.castShadow);
    for (const light of castShadowLights) {
      this._renderShadowPass(scene, light as DirectionalLight);
      this.stats.shadowPasses++;
    }

    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    if ('fov' in camera) {
      (camera as unknown as { aspect: number; updateProjectionMatrix(): void }).aspect = aspect;
      camera.updateProjectionMatrix();
    }

    this._projViewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._viewMatrix.copy(camera.matrixWorldInverse);

    const dirLight = lights.find((l) => l instanceof DirectionalLight) as DirectionalLight | undefined;
    const ambient = lights.find((l) => l instanceof AmbientLight) as AmbientLight | undefined;

    // 2. SSAO pass — depth + normal buffer, then AO calculation
    let ssaoTexture: WebGLTexture | null = null;
    if (this.ssaoEnabled) {
      this._renderSSAOPass(scene, camera);
      ssaoTexture = this.ssaoResources?.ssaoTexture ?? null;
    }

    // 3. Main pass
    if (this.postProcessingEnabled && !this._postFboBroken) {
      const postRes = this._getPostProcessingResources();
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, postRes.mainFbo);
      this.gl.viewport(0, 0, postRes.width, postRes.height);
      this.gl.clearColor(this.clearColor.r, this.clearColor.g, this.clearColor.b, this.clearColor.a);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    } else if (this.postProcessingEnabled && this._postFboBroken) {
      // 后处理 FBO 在真机不完整 → 降级:直接画到默认 framebuffer(带默认 depth)
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
      this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.gl.disable(this.gl.BLEND);
      this.gl.depthMask(true);
      this.clear();
    } else {
      this.clear();
    }

    // 每帧更新视锥体(用于 frustum culling)。viewProjection = projection * view。
    // view = camera.matrixWorldInverse;camera.updateMatrixWorld 已在帧首同步。
    this._culledCount = 0;
    if (this.frustumCullingEnabled) {
      const vp = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      this._frustum.setFromViewProjectionMatrix(vp);
    }

    scene.traverse((obj) => {
      // LOD 节点:按相机距离切换可见级别(自动驱动,无需应用层手动 update)。
      if (obj instanceof LOD) {
        obj.update(camera);
        return; // LOD 本身不可绘制,其子级 Mesh 会被 traverse 单独处理
      }
      const mesh = obj as Mesh;
      if (!(mesh instanceof Mesh)) return;
      if (!mesh.visible) return;
      // 旁路:Helper 类 mesh(Grid / ContactShadows)走专用 path,且永远不 cull。
      if ((mesh.userData as { __helper?: string })?.__helper) {
        this._drawHelper(mesh, camera);
        return;
      }
      // Frustum culling:用世界空间 bounding sphere 测试视锥体。
      // InstancedMesh 跳过(实例散布在空间,单一 bounding sphere 不适用;
      // per-instance culling 会破坏单 draw call 优势,留作后续优化)。
      if (this.frustumCullingEnabled && !(mesh instanceof InstancedMesh) && !this._meshInFrustum(mesh)) {
        this._culledCount++;
        return;
      }
      this._drawMesh(mesh, scene, camera, dirLight, ambient, ssaoTexture);
    });

    // 4. Post-processing pass
    if (this.postProcessingEnabled && !this._postFboBroken) {
      this._renderPostProcessingPass(camera);
    }

    // 每 120 帧 (~2s@60fps) 摘要一次，避免控制台刷屏
    this.stats.programs = this.programCache.size;
    if (this._renderCount % 120 === 1) {
      const dt = performance.now() - t0;
      log.debug(`frame #${this._renderCount}: ` +
        `draws=${this.stats.drawCalls}, tris=${Math.round(this.stats.triangles)}, ` +
        `shadow=${this.stats.shadowPasses}, programs=${this.stats.programs}, ` +
        `lights=${lights.length} (shadow=${castShadowLights.length}), ` +
        `culled=${this._culledCount}, dt=${dt.toFixed(2)}ms`);
    }
  }

  /** Frustum culling 测试:取 mesh 的世界空间 bounding sphere 与视锥体求交。
   *  无 bounding sphere 的 geometry(尚未 computeBoundingSphere)自动计算并缓存。
   *  半径按世界 scale 的最大轴保守放大。 */
  private _meshInFrustum(mesh: Mesh): boolean {
    const geo = mesh.geometry;
    if (!geo) return true; // 无 geometry → 保守渲染
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere;
    if (!bs) return true; // 计算失败(空 geometry)→ 保守渲染

    // 世界空间球心 = local center × matrixWorld
    this._cullCenter.copy(bs.center).applyMatrix4(mesh.matrixWorld);

    // 保守世界半径 = local radius × max(scale)。
    // 用 max 轴向 scale 是 conservative 近似(非均匀缩放下偏大,但保证不误剔除)。
    const s = mesh.scale;
    const maxScale = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
    const worldRadius = bs.radius * maxScale;

    return this._frustum.intersectsSphere(this._cullCenter, worldRadius);
  }

  // ── private ─────────────────────────────────────────────────────────
  private _collectLights(scene: Scene): Array<AmbientLight | DirectionalLight> {
    const out: Array<AmbientLight | DirectionalLight> = [];
    scene.traverse((obj) => {
      // We stash lights on Object3D.userData['__light'] for now.
      // Concrete code will attach real Light objects; the renderer
      // treats them uniformly.
      const l = obj.userData['__light'] as AmbientLight | DirectionalLight | undefined;
      if (l) out.push(l);
    });
    return out;
  }

  private _gatherSceneBounds(scene: Scene): void {
    // Approximate scene AABB by walking meshes; cheap & good enough for
    // auto-fitting the shadow camera. Cache the result.
    if (this._sceneBoundsValid) return;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let any = false;
    scene.traverse((obj) => {
      const m = obj as Mesh;
      if (!(m instanceof Mesh)) return;
      const pos = m.geometry.attributes.position;
      if (!pos) return;
      const a = pos.array;
      // Use the geometry's *local* AABB; the mesh matrix is bounded.
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

  private _renderShadowPass(scene: Scene, light: DirectionalLight): void {
    const gl = this.gl;
    const res = this._getShadowResources(light);
    if (!res) return; // shadow FBO broken on this device → skip (model stays lit) 

    // Build light viewProjection: orthographic around scene center.
    const dir = light.direction;
    const lightPos = this._tmpVec
      .copy(this._sceneCenter)
      .add({ x: -dir.x * this._sceneHalfSize, y: -dir.y * this._sceneHalfSize, z: -dir.z * this._sceneHalfSize } as Vector3);
    this._lightView.makeLookAt(lightPos, this._sceneCenter, { x: 0, y: 1, z: 0 });
    const half = light.shadow.cameraHalfSize;
    // Orthographic projection:
    const e = this._lightProj.elements;
    e[0] = 1 / half; e[5] = 1 / half; e[10] = -2 / (light.shadow.cameraFar - light.shadow.cameraNear);
    e[12] = 0; e[13] = 0; e[14] = -(light.shadow.cameraFar + light.shadow.cameraNear) / (light.shadow.cameraFar - light.shadow.cameraNear);
    e[1] = e[2] = e[3] = e[4] = e[6] = e[7] = e[8] = e[9] = e[11] = 0;
    e[15] = 1;

    this._lightVP.multiplyMatrices(this._lightProj, this._lightView);
    res.viewProjection.copy(this._lightVP);

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
    gl.viewport(0, 0, res.size, res.size);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.cullFace(gl.FRONT);

    // Collect all meshes first; we have to compile both shadow variants
    // (skin / no-skin) and bind the right one per draw.
    // InstancedMesh 暂不参与 shadow pass(需 USE_INSTANCING shadow shader 变体,
    // v1 未实现;若放行会所有实例重叠在 mesh.matrixWorld 处产生错误阴影)。
    const collect = (obj: Object3D, out: Mesh[]) => {
      const m = obj as Mesh;
      if (m instanceof InstancedMesh) {
        // skip — instanced shadow casting 是后续工作
      } else if (m instanceof Mesh) {
        if (m.visible && m.castShadow) out.push(m);
      } else {
        for (const c of obj.children) collect(c, out);
      }
    };
    const drawList: Mesh[] = [];
    collect(scene, drawList);

    for (const mesh of drawList) {
      const skinning = mesh instanceof SkinnedMesh;
      const program = this.getProgram(
        skinning ? 'shadow-skinning' : 'shadow',
        SHADOW_VERT,
        SHADOW_FRAG,
        skinning ? ['USE_SKINNING'] : [],
      );
      program.use();

      const mr = this._getMeshResources(mesh.geometry);
      if (!mr) continue;
      gl.bindVertexArray(mr.vao);
      program.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
      program.setUniformMatrix4fv('u_lightVP', this._lightVP.elements);

      if (skinning) {
        const sk = mesh as SkinnedMesh;
        sk.updateSkeleton();
        if (sk.skeleton) {
          program.setUniformMatrix4fv('u_bindMatrixInverse', sk.bindMatrixInverse.elements);
          // Fallback: some browsers still lack setUniformMatrix4fvArray; do it manually.
          const loc = program.uniforms.get('u_boneMatrices[0]');
          if (loc !== undefined) {
            gl.uniformMatrix4fv(loc, false, sk.skeleton.boneMatrices);
          }
        }
      }

      if (mr.index) {
        gl.drawElements(
          gl.TRIANGLES,
          mr.index.count,
          mr.index.is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          0,
        );
        this._recordDrawCall(mesh, 'shadow', mr.index.count / 3);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, mr.vertexCount);
        this._recordDrawCall(mesh, 'shadow', mr.vertexCount / 3);
      }
    }

    // Restore
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.cullFace(gl.BACK);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private _getShadowResources(light: DirectionalLight): ShadowResources | null {
    const gl = this.gl;
    const cached = this.shadowCache.get(light);
    if (cached && cached.size === light.shadow.mapSize) return cached;

    if (cached) {
      gl.deleteFramebuffer(cached.fbo);
      gl.deleteTexture(cached.texture);
      log.warn(`shadow FBO resized: ${cached.size} → ${light.shadow.mapSize}`);
    }

    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24,
      light.shadow.mapSize, light.shadow.mapSize, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const fbo = gl.createFramebuffer();
    if (!fbo) throw new Error('createFramebuffer() returned null');
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, tex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    // 真机防御:depth-only FBO 若不完整,阴影 draw 静默 no-op,PCF 采黑
    // → lighting*shadow 塌缩 → 整片黑。检测到则禁用该光源阴影。
    const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (fboStatus !== gl.FRAMEBUFFER_COMPLETE) {
      log.error(`shadow FBO INCOMPLETE 0x${fboStatus.toString(16)} — casting shadows disabled for this light`);
      light.castShadow = false;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fbo);
      gl.deleteTexture(tex);
      return null;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const res: ShadowResources = {
      fbo, texture: tex, size: light.shadow.mapSize,
      viewProjection: new Matrix4(), target: new Vector3(),
    };
    this.shadowCache.set(light, res);
    this._shadowResourcesSet.add(res);
    log.info(`shadow FBO created: ${light.shadow.mapSize}x${light.shadow.mapSize} ` +
      `(${light.shadow.cameraNear}-${light.shadow.cameraFar}, half=${light.shadow.cameraHalfSize})`);
    return res;
  }

  private _getMeshResources(geom: BufferGeometry): MeshResources | null {
    const gl = this.gl;
    const cached = this.meshCache.get(geom);
    if (cached) {
      this._syncMeshResources(cached, geom);
      return cached;
    }
    const t0 = performance.now();
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray() returned null');
    const res: MeshResources = {
      vao,
      buffers: new Map(),
      index: null,
      vertexCount: 0,
      triangleCount: 0,
    };
    this.meshCache.set(geom, res);
    this._syncMeshResources(res, geom);
    log.debug(`VAO created for new geometry: ${res.vertexCount} verts, ` +
      `${res.triangleCount} tris, ${res.buffers.size} attrs ` +
      `(${ (performance.now() - t0).toFixed(1) }ms)`);
    return res;
  }

  private _syncMeshResources(res: MeshResources, geom: BufferGeometry): void {
    const gl = this.gl;
    gl.bindVertexArray(res.vao);

    // Always provide layout locations: 0 = position, 1 = normal, 2 = uv.
    // The shader declares the same via `layout(location = N)` so no
    // gl.bindAttribLocation is needed.
    const layoutFor: Record<string, number> = {
      position: 0, normal: 1, uv: 2, color: 3, tangent: 4,
      skinIndex: 5, skinWeight: 6,
    };

    for (const [name, attr] of Object.entries(geom.attributes)) {
      const loc = layoutFor[name];
      if (loc === undefined) continue;
      let entry = res.buffers.get(name);
      if (!entry) {
        const buf = gl.createBuffer();
        if (!buf) throw new Error('createBuffer() returned null');
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, attr.array, attr.usage);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, attr.itemSize, gl.FLOAT, false, 0, 0);
        entry = { buf, version: attr.version, itemSize: attr.itemSize };
        res.buffers.set(name, entry);
      } else if (entry.version !== attr.version || entry.itemSize !== attr.itemSize) {
        gl.bindBuffer(gl.ARRAY_BUFFER, entry.buf);
        gl.bufferData(gl.ARRAY_BUFFER, attr.array, attr.usage);
        if (entry.itemSize !== attr.itemSize) {
          gl.vertexAttribPointer(loc, attr.itemSize, gl.FLOAT, false, 0, 0);
        }
        entry.version = attr.version;
        entry.itemSize = attr.itemSize;
      }
    }

    // Index
    if (geom.index) {
      const idx = geom.index;
      if (!res.index || res.index.version !== idx.version) {
        const buf = gl.createBuffer();
        if (!buf) throw new Error('createBuffer() returned null');
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx.array, idx.usage);
        // Decide element type from the underlying TypedArray kind.
        const is32 = idx.array instanceof Uint32Array;
        res.index = { buf, count: idx.count, version: idx.version, is32 };
      }
    } else {
      res.index = null;
    }

    const pos = geom.attributes.position;
    res.vertexCount = pos ? pos.count : 0;
    res.triangleCount = res.index ? Math.floor(res.index.count / 3) : Math.floor(res.vertexCount / 3);
  }

  private _drawMesh(
    mesh: Mesh,
    scene: Scene,
    camera: Camera,
    dirLight: DirectionalLight | undefined,
    ambient: AmbientLight | undefined,
    ssaoTexture: WebGLTexture | null = null,
  ): void {
    // InstancedMesh 走专用 path(USE_INSTANCING shader + instanced draw)。
    if (mesh instanceof InstancedMesh) {
      this._drawInstancedMesh(mesh, scene, camera, dirLight, ambient, ssaoTexture);
      return;
    }
    const gl = this.gl;
    const geom = mesh.geometry;
    if (!geom || !geom.attributes.position) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as StandardMaterial | ShaderMaterialCls | undefined;
    if (!mat) return;

    const mr = this._getMeshResources(geom);
    if (!mr) return;

    const skinning = mesh instanceof SkinnedMesh;
    // 用户自定义 ShaderMaterial:用 mat.program;走简化 uniform path。
    const isUserShader = mat instanceof ShaderMaterialCls;
    // Marschner 物理毛发材质:走 HAIR_MARSCHNER_VERT/FRAG 专用 path。
    const isHair = mat instanceof HairMarschnerMaterialCls;
    const program = isUserShader
      ? this._getOrCompileUserShaderProgram(mat as ShaderMaterialCls)
      : isHair
        ? this._getOrCompileHairProgram(mat as HairMarschnerMaterialCls)
        : this.getProgramFor(mesh, mat as StandardMaterial).program;
    program.use();

    // Uniforms
    program.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
    program.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    program.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);
    // Normal matrix = transpose(inverse(model3x3))
    mesh.matrixWorld.getNormalMatrix(this._normalMat3);
    program.setUniformMatrix3fv('u_normalMatrix', this._normalMat3);

    if (skinning) {
      const sk = mesh as SkinnedMesh;
      sk.updateSkeleton();
      if (sk.skeleton) {
        program.setUniformMatrix4fv('u_bindMatrixInverse', sk.bindMatrixInverse.elements);
        // Array uniform — call directly on GL because ShaderProgram
        // doesn't track array uniform locations.
        const loc = program.uniforms.get('u_boneMatrices[0]');
        if (loc !== undefined) {
          gl.uniformMatrix4fv(loc, false, sk.skeleton.boneMatrices);
        }
      }
    }

    if (isUserShader) {
      // 用户 shader path:写入 builtin(u_time / u_cameraPos)+ 用户自定义 uniforms
      this._applyUserShaderUniforms(program, mesh, camera, mat as ShaderMaterialCls);
    } else if (isHair) {
      // Marschner 毛发 path:写入毛发专属 uniforms(baseColor/eta/sigmaA/三叶参数...)
      this._applyHairMeshUniforms(program, mesh, camera, mat as HairMarschnerMaterialCls);
    } else {
      this._applyStandardMeshUniforms(
        program, mesh, camera, dirLight, ambient, scene, ssaoTexture,
        mat as StandardMaterial,
      );
    }

    // 毛发 GL 状态:双面关闭背面剔除,透明开启 alpha 混合 + 关深度写。
    // 默认 GL 状态:CULL_FACE enabled / BACK / 无 blend / depthMask true。
    const hairMat = isHair ? (mat as HairMarschnerMaterialCls) : null;
    if (hairMat) {
      if (hairMat.doubleSided) gl.disable(gl.CULL_FACE);
      if (hairMat.transparent) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
      }
    }

    if (mat.wireframe) gl.drawingBufferWidth; // placeholder
    // Bind VAO + draw
    gl.bindVertexArray(mr.vao);
    if (mr.index) {
      gl.drawElements(
        gl.TRIANGLES,
        mr.index.count,
        mr.index.is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        0,
      );
      this.stats.triangles += mr.index.count / 3;
      this._recordDrawCall(mesh, 'main', mr.index.count / 3);
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, mr.vertexCount);
      this.stats.triangles += mr.vertexCount / 3;
      this._recordDrawCall(mesh, 'main', mr.vertexCount / 3);
    }
    this.stats.drawCalls++;

    // 恢复默认 GL 状态(下个 mesh 可能不是 hair)。
    if (hairMat) {
      if (hairMat.doubleSided) gl.enable(gl.CULL_FACE);
      if (hairMat.transparent) {
        gl.disable(gl.BLEND);
        gl.depthMask(true);
      }
    }
  }

  // ── InstancedMesh 渲染 path (Phase 2.2.2) ───────────────────────
  /** 每个 InstancedMesh 的专用 VAO + 实例缓冲。不复用 geometry VAO
   *  以免 instance attribute 污染共享 VAO 状态。 */
  private _instancedCache: WeakMap<InstancedMesh, {
    vao: WebGLVertexArrayObject;
    instanceBuf: WebGLBuffer;
    /** 已绑定到该 VAO 的 base geometry(变更时重建)。 */
    boundGeom: BufferGeometry | null;
    /** 上次上传的 instanceMatrixVersion(变更时重传)。 */
    version: number;
  }> = new WeakMap();

  private _drawInstancedMesh(
    mesh: InstancedMesh,
    scene: Scene,
    camera: Camera,
    dirLight: DirectionalLight | undefined,
    ambient: AmbientLight | undefined,
    ssaoTexture: WebGLTexture | null,
  ): void {
    const gl = this.gl;
    const geom = mesh.geometry;
    if (!geom || !geom.attributes.position) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as StandardMaterial | ShaderMaterialCls | undefined;
    if (!mat) return;
    if (mat instanceof ShaderMaterialCls) {
      // 用户自定义 shader 的 instancing 支持暂未实现(需 shader 自身声明 a_instanceMatrix)。
      // 退化为逐实例绘制:用 base _drawMesh 不行(它是私有且签名不同),这里直接跳过并警告。
      log.warn('InstancedMesh with ShaderMaterial not supported yet; skipping.');
      return;
    }

    // 确保 base geometry 的 VBO/索引缓冲已创建(复用 meshCache)。
    const baseRes = this._getMeshResources(geom);
    if (!baseRes) return;

    let entry = this._instancedCache.get(mesh);
    const geomChanged = !entry || entry.boundGeom !== geom;
    const dataChanged = !entry || entry.version !== mesh.instanceMatrixVersion;
    if (!entry) {
      const vao = gl.createVertexArray();
      const instanceBuf = gl.createBuffer();
      if (!vao || !instanceBuf) { log.warn('InstancedMesh VAO/buffer alloc failed'); return; }
      entry = { vao, instanceBuf, boundGeom: null, version: -1 };
      this._instancedCache.set(mesh, entry);
    }

    // 重建 VAO 绑定(geometry 变更或首次)。
    if (geomChanged) {
      gl.bindVertexArray(entry.vao);
      // 复用 base geometry 的 VBO:position@0, normal@1, uv@2。
      const layoutFor: Record<string, number> = { position: 0, normal: 1, uv: 2, color: 3, tangent: 4 };
      for (const [name, bufEntry] of baseRes.buffers) {
        const loc = layoutFor[name];
        if (loc === undefined) continue;
        gl.bindBuffer(gl.ARRAY_BUFFER, bufEntry.buf);
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, bufEntry.itemSize, gl.FLOAT, false, 0, 0);
      }
      // 索引缓冲复用 base 的。
      if (baseRes.index) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, baseRes.index.buf);
      }
      // 实例矩阵:4 列 vec4 @ locations 7,8,9,10,divisor=1。
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.instanceBuf);
      const stride = 16 * 4; // 16 floats × 4 bytes
      for (let c = 0; c < 4; c++) {
        const loc = 7 + c;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, stride, c * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
      entry.boundGeom = geom;
    }

    // 重传实例数据(version 变更或首次)。
    if (dataChanged) {
      gl.bindBuffer(gl.ARRAY_BUFFER, entry.instanceBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceMatrix.subarray(0, mesh.count * 16), gl.DYNAMIC_DRAW);
      entry.version = mesh.instanceMatrixVersion;
    }

    // 程序:USE_INSTANCING 变体。
    const program = this.getProgram('standard-instanced', STANDARD_VERTEX_SRC, STANDARD_FRAGMENT_SRC, ['USE_INSTANCING']);
    if (!mat.program) mat.program = program;
    program.use();

    // u_model = identity(实例变换来自 a_instanceMatrix)。
    this._identityMat.identity();
    program.setUniformMatrix4fv('u_model', this._identityMat.elements);
    program.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    program.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);
    // normalMatrix 设 identity(实例法线在 shader 内用 mat3(instanceMatrix) 算)。
    this._normalMat3.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    program.setUniformMatrix3fv('u_normalMatrix', this._normalMat3);

    this._applyStandardMeshUniforms(program, mesh, camera, dirLight, ambient, scene, ssaoTexture, mat as StandardMaterial);

    gl.bindVertexArray(entry.vao);
    const instanceCount = mesh.count;
    if (baseRes.index) {
      gl.drawElementsInstanced(
        gl.TRIANGLES,
        baseRes.index.count,
        baseRes.index.is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
        0,
        instanceCount,
      );
      this.stats.triangles += (baseRes.index.count / 3) * instanceCount;
      this._recordDrawCall(mesh, 'main', (baseRes.index.count / 3) * instanceCount);
    } else {
      gl.drawArraysInstanced(gl.TRIANGLES, 0, baseRes.vertexCount, instanceCount);
      this.stats.triangles += (baseRes.vertexCount / 3) * instanceCount;
      this._recordDrawCall(mesh, 'main', (baseRes.vertexCount / 3) * instanceCount);
    }
    this.stats.drawCalls++;
  }
  private _userShaderCache: Map<string, ShaderProgram> = new Map();
  private _getOrCompileUserShaderProgram(mat: ShaderMaterialCls): ShaderProgram {
    if (mat.program) return mat.program;
    const key = `user:${mat.programKey}`;
    const cached = this._userShaderCache.get(key);
    if (cached) {
      mat.program = cached;
      return cached;
    }
    const program = new ShaderProgram(this.gl, mat.vertexSrc, mat.fragmentSrc, mat.defines);
    mat.program = program;
    this._userShaderCache.set(key, program);
    return program;
  }

  /**
   * 编译(或取缓存)Marschner 毛发 shader program。
   *
   * HairMarschnerMaterial 自带 `programKey`('hair-marschner'),用其作为
   * programCache 的键;首次调用编译 HAIR_MARSCHNER_VERT/FRAG,后续直接复用。
   * 与 _getOrCompileUserShaderProgram 不同:毛发 shader 源是引擎内置常量,
   * 不由用户传入,且共享 programCache(便于 dispose 统一回收)。
   */
  private _getOrCompileHairProgram(mat: HairMarschnerMaterialCls): ShaderProgram {
    if (mat.program) return mat.program;
    const key = mat.programKey; // 'hair-marschner'
    const cached = this.programCache.get(key);
    if (cached) {
      mat.program = cached;
      return cached;
    }
    const program = this.getProgram(key, HAIR_MARSCHNER_VERT, HAIR_MARSCHNER_FRAG);
    mat.program = program;
    return program;
  }

  /**
   * 写入 Marschner 毛发专属 uniforms。
   *
   * 对应 HAIR_MARSCHNER_FRAG 声明:
   *   u_cameraPos / u_lightDir / u_lightColor
   *   u_baseColor / u_eta / u_sigmaA
   *   u_betaR / u_betaTT / u_betaTRT  (三叶纵向宽度)
   *   u_alphaR / u_alphaTT / u_alphaTRT (三叶中心偏移)
   *   u_roughness / u_ttScale / u_trtScale / u_diffuseScale / u_opacity
   *
   * 公共 uniforms(u_model/u_view/u_projection/u_normalMatrix)由 _drawMesh
   * 在调用本方法前已写入。光照方向缺省时退回材质自带的 lightDirection。
   */
  private _applyHairMeshUniforms(
    program: ShaderProgram,
    _mesh: Mesh,
    camera: Camera,
    mat: HairMarschnerMaterialCls,
  ): void {
    program.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    program.setUniform3f('u_lightDir', mat.lightDirection.x, mat.lightDirection.y, mat.lightDirection.z);
    program.setUniform3f('u_lightColor', mat.lightColor.r, mat.lightColor.g, mat.lightColor.b);
    program.setUniform3f('u_baseColor', mat.baseColor.r, mat.baseColor.g, mat.baseColor.b);
    program.setUniform1f('u_eta', mat.eta);
    program.setUniform3f('u_sigmaA', mat.sigmaA.r, mat.sigmaA.g, mat.sigmaA.b);
    program.setUniform1f('u_betaR', mat.betaR);
    program.setUniform1f('u_betaTT', mat.betaTT);
    program.setUniform1f('u_betaTRT', mat.betaTRT);
    program.setUniform1f('u_alphaR', mat.alphaR);
    program.setUniform1f('u_alphaTT', mat.alphaTT);
    program.setUniform1f('u_alphaTRT', mat.alphaTRT);
    program.setUniform1f('u_roughness', mat.roughness);
    program.setUniform1f('u_ttScale', mat.ttScale);
    program.setUniform1f('u_trtScale', mat.trtScale);
    program.setUniform1f('u_diffuseScale', mat.diffuseScale);
    program.setUniform1f('u_opacity', mat.opacity);
  }

  /** 用户 shader 路径:u_time 自动更新 + 用户 uniforms 应用。 */
  private _applyUserShaderUniforms(
    program: ShaderProgram,
    _mesh: Mesh,
    camera: Camera,
    mat: ShaderMaterialCls,
  ): void {
    const gl = this.gl;
    program.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    // 写一个时间标量(若用户声明则用之)
    program.setUniform1f('u_time', performance.now() / 1000);

    let texUnit = 5;
    for (const [name, v] of Object.entries(mat.uniforms)) {
      if (v == null) continue;
      if (typeof v === 'number') {
        program.setUniform1f(name, v);
      } else if (typeof v === 'boolean') {
        program.setUniform1i(name, v ? 1 : 0);
      } else if (Array.isArray(v)) {
        if (v.length === 2) program.setUniform2f(name, v[0], v[1]);
        else if (v.length === 3) program.setUniform3f(name, v[0], v[1], v[2]);
        else if (v.length === 4) program.setUniform4f(name, v[0], v[1], v[2], v[3]);
      } else if (v instanceof Float32Array) {
        if (v.length === 16) program.setUniformMatrix4fv(name, v);
        else if (v.length === 9) program.setUniformMatrix3fv(name, v);
      } else if (typeof v === 'object' && 'x' in v) {
        // 简单 {x,y,z} 字典
        const o = v as { x: number; y: number; z: number; w?: number };
        if (o.w !== undefined) program.setUniform4f(name, o.x, o.y, o.z, o.w);
        else program.setUniform3f(name, o.x, o.y, o.z);
      } else if (typeof v === 'object' && 'image' in v) {
        // Texture
        const tex = this._ensureStandardTexture(v as never, false);
        if (tex) {
          gl.activeTexture(texUnit);
          gl.bindTexture(gl.TEXTURE_2D, tex);
          program.setUniformSampler(name, texUnit);
          texUnit++;
        }
      }
    }
    void texUnit;
  }

  /** StandardMaterial 完整 PBR uniform 写入:光照、阴影、贴图、SSAO。 */
  private _applyStandardMeshUniforms(
    program: ShaderProgram,
    _mesh: Mesh,
    camera: Camera,
    dirLight: DirectionalLight | undefined,
    ambient: AmbientLight | undefined,
    scene: Scene,
    ssaoTexture: WebGLTexture | null,
    mat: StandardMaterial,
  ): void {
    const gl = this.gl;
    program.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    program.setUniform3f('u_baseColor', mat.baseColor.r, mat.baseColor.g, mat.baseColor.b);
    program.setUniform1f('u_metallic', mat.metallic);
    program.setUniform1f('u_roughness', mat.roughness);
    program.setUniform3f('u_emissive', mat.emissive.r, mat.emissive.g, mat.emissive.b);
    program.setUniform1f('u_emissiveIntensity', mat.emissiveIntensity);
    program.setUniform1f('u_opacity', mat.opacity);

    // PBR texture maps
    if (mat.map) {
      const tex = this._ensureStandardTexture(mat.map, /* srgb */ true);
      if (tex) {
        gl.activeTexture(gl.TEXTURE3);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        program.setUniformSampler('u_baseColorMap', 3);
        program.setUniform1i('u_baseColorMapEnabled', 1);
      } else {
        program.setUniform1i('u_baseColorMapEnabled', 0);
      }
    } else {
      program.setUniform1i('u_baseColorMapEnabled', 0);
    }
    if (mat.metallicRoughnessMap) {
      const tex = this._ensureStandardTexture(mat.metallicRoughnessMap, /* srgb */ false);
      if (tex) {
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        program.setUniformSampler('u_metallicRoughnessMap', 4);
        program.setUniform1i('u_metallicRoughnessMapEnabled', 1);
      } else {
        program.setUniform1i('u_metallicRoughnessMapEnabled', 0);
      }
    } else {
      program.setUniform1i('u_metallicRoughnessMapEnabled', 0);
    }
    // Normal map — derivative-based TBN, no tangent attribute needed.
    if (mat.normalMap) {
      const tex = this._ensureStandardTexture(mat.normalMap, /* srgb */ false);
      if (tex) {
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        program.setUniformSampler('u_normalMap', 5);
        program.setUniform1i('u_normalMapEnabled', 1);
        program.setUniform1f('u_normalScale', mat.normalScale);
      } else {
        program.setUniform1i('u_normalMapEnabled', 0);
      }
    } else {
      program.setUniform1i('u_normalMapEnabled', 0);
    }
    // Emissive map — multiplied with u_emissive uniform.
    if (mat.emissiveMap) {
      const tex = this._ensureStandardTexture(mat.emissiveMap, /* srgb */ true);
      if (tex) {
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        program.setUniformSampler('u_emissiveMap', 6);
        program.setUniform1i('u_emissiveMapEnabled', 1);
      } else {
        program.setUniform1i('u_emissiveMapEnabled', 0);
      }
    } else {
      program.setUniform1i('u_emissiveMapEnabled', 0);
    }

    if (dirLight) {
      program.setUniform3f('u_lightDir', dirLight.direction.x, dirLight.direction.y, dirLight.direction.z);
      program.setUniform3f('u_lightColor', dirLight.color.r, dirLight.color.g, dirLight.color.b);
      program.setUniform1f('u_lightIntensity', dirLight.intensity);
    } else {
      program.setUniform3f('u_lightDir', 0, -1, 0);
      program.setUniform3f('u_lightColor', 1, 1, 1);
      program.setUniform1f('u_lightIntensity', 0);
    }
    if (ambient) {
      program.setUniform3f('u_ambientColor', ambient.color.r, ambient.color.g, ambient.color.b);
      program.setUniform3f('u_ambientSky', ambient.color.r, ambient.color.g, ambient.color.b);
      program.setUniform3f('u_ambientGround', ambient.color.r * 0.4, ambient.color.g * 0.4, ambient.color.b * 0.4);
    } else {
      program.setUniform3f('u_ambientColor', 0.2, 0.2, 0.25);
      program.setUniform3f('u_ambientSky', 0.2, 0.2, 0.25);
      program.setUniform3f('u_ambientGround', 0.05, 0.05, 0.07);
    }

    const envMap = scene.environment;
    if (envMap && envMap.image) {
      const glTex = this._ensureEnvMapTexture(envMap);
      if (glTex) {
        gl.activeTexture(gl.TEXTURE2);
        gl.bindTexture(gl.TEXTURE_CUBE_MAP, glTex);
        program.setUniformSampler('u_envMap', 2);
        program.setUniform1i('u_envMapEnabled', 1);
      } else {
        program.setUniform1i('u_envMapEnabled', 0);
      }
    } else {
      program.setUniform1i('u_envMapEnabled', 0);
    }

    if (dirLight && dirLight.castShadow) {
      const res = this.shadowCache.get(dirLight);
      if (res) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, res.texture);
        program.setUniformSampler('u_shadowMap', 0);
        program.setUniformMatrix4fv('u_lightVP', res.viewProjection.elements);
        program.setUniform1f('u_shadowBias', dirLight.shadow.bias);
        program.setUniform2f('u_shadowMapSize', res.size, res.size);
        program.setUniform1i('u_shadowEnabled', mat.receiveShadow ? 1 : 0);
      } else {
        program.setUniform1i('u_shadowEnabled', 0);
      }
    } else {
      program.setUniform1i('u_shadowEnabled', 0);
    }

    if (ssaoTexture) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, ssaoTexture);
      program.setUniformSampler('u_ssaoMap', 1);
      program.setUniform1i('u_ssaoEnabled', 1);
    } else {
      program.setUniform1i('u_ssaoEnabled', 0);
    }
  }

  /** Helper 类 mesh(Grid / ContactShadows 等)专用 unlit path。
   *  完全跳过 PBR/阴影/SSAO 路径,只画"屏幕空间特效"。 */
  private _drawHelper(mesh: Mesh, camera: Camera): void {
    const gl = this.gl;
    const helper = mesh.userData as {
      __helper: string;
      program?: ShaderProgram;
      uniforms?: Record<string, number | [number, number, number] | undefined>;
    };
    if (!helper.program) return;

    const geom = mesh.geometry;
    if (!geom) return;
    const mr = this._getMeshResources(geom);
    if (!mr) return;

    // 关掉 depth write 让 helper 永远不遮 main scene(但仍参与 depth test)
    const program = helper.program;
    program.use();
    program.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
    program.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    program.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);

    if (helper.uniforms) {
      for (const [k, v] of Object.entries(helper.uniforms)) {
        if (v === undefined) continue;
        if (typeof v === 'number') {
          program.setUniform1f(k, v);
        } else if (Array.isArray(v) && v.length === 3) {
          program.setUniform3f(k, v[0], v[1], v[2]);
        }
      }
    }

    // 启用 alpha 混合
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 决定图元类型:line helper 走 LINES,其它默认 TRIANGLES。
    const drawMode = helper.__helper === 'line' ? gl.LINES : gl.TRIANGLES;

    gl.bindVertexArray(mr.vao);
    if (mr.index) {
      gl.drawElements(drawMode, mr.index.count, mr.index.is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      this._recordDrawCall(mesh, 'helper', mr.index.count / 3);
    } else {
      const vCount = mesh.geometry.getAttribute('position')?.count ?? 0;
      gl.drawArrays(drawMode, 0, vCount);
      this._recordDrawCall(mesh, 'helper', vCount / 3);
    }
    this.stats.drawCalls++;
  }

  private _renderSSAOPass(scene: Scene, camera: Camera): void {
    const gl = this.gl;
    const res = this._getSSAOResources();

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.depthFbo);
    gl.viewport(0, 0, res.size, res.size);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const program = this.getProgram('depth-normal', DEPTH_NORMAL_VERT, DEPTH_NORMAL_FRAG);
    program.use();
    program.setUniformMatrix4fv('u_view', camera.matrixWorldInverse.elements);
    program.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);

    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!(mesh instanceof Mesh)) return;
      if (!mesh.visible) return;
      const mr = this._getMeshResources(mesh.geometry);
      if (!mr) return;
      program.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
      mesh.matrixWorld.getNormalMatrix(this._normalMat3);
      program.setUniformMatrix3fv('u_normalMatrix', this._normalMat3);
      gl.bindVertexArray(mr.vao);
      if (mr.index) {
        gl.drawElements(gl.TRIANGLES, mr.index.count, mr.index.is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
        this._recordDrawCall(mesh, 'ssao', mr.index.count / 3);
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, mr.vertexCount);
        this._recordDrawCall(mesh, 'ssao', mr.vertexCount / 3);
      }
    });

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.ssaoFbo);
    gl.viewport(0, 0, res.size, res.size);
    gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const ssaoProgram = this.getProgram('ssao', SSAO_VERT, SSAO_FRAG);
    ssaoProgram.use();

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.depthTexture);
    ssaoProgram.setUniformSampler('u_depthMap', 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, res.normalTexture);
    ssaoProgram.setUniformSampler('u_normalMap', 1);

    ssaoProgram.setUniformMatrix4fv('u_projection', camera.projectionMatrix.elements);
    ssaoProgram.setUniformMatrix4fv('u_projectionInverse', camera.projectionMatrixInverse.elements);
    ssaoProgram.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    ssaoProgram.setUniform2f('u_screenSize', res.size, res.size);
    ssaoProgram.setUniform1f('u_ssaoRadius', this.ssaoRadius);
    ssaoProgram.setUniform1f('u_ssaoBias', this.ssaoBias);
    ssaoProgram.setUniform1i('u_ssaoEnabled', 1);

    gl.bindVertexArray(this._getFullscreenQuad());
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private _getSSAOResources(): SSAOResources {
    const gl = this.gl;
    const targetSize = Math.max(256, Math.min(1024, Math.floor(this.canvas.width * 0.5)));

    if (this.ssaoResources && this.ssaoResources.size === targetSize) {
      return this.ssaoResources;
    }

    if (this.ssaoResources) {
      gl.deleteFramebuffer(this.ssaoResources.depthFbo);
      gl.deleteTexture(this.ssaoResources.depthTexture);
      gl.deleteTexture(this.ssaoResources.normalTexture);
      gl.deleteFramebuffer(this.ssaoResources.ssaoFbo);
      gl.deleteTexture(this.ssaoResources.ssaoTexture);
    }

    const depthTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, depthTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetSize, targetSize, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const normalTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, normalTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetSize, targetSize, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const depthFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, depthFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, depthTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, normalTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);

    const ssaoTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, ssaoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetSize, targetSize, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const ssaoFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, ssaoFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, ssaoTex, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.ssaoResources = {
      depthFbo, depthTexture: depthTex, normalTexture: normalTex,
      ssaoFbo, ssaoTexture: ssaoTex, size: targetSize,
    };

    log.info(`SSAO FBO created: ${targetSize}x${targetSize}`);
    return this.ssaoResources;
  }

  private _fullscreenQuadVao: WebGLVertexArrayObject | null = null;
  private _getFullscreenQuad(): WebGLVertexArrayObject {
    const gl = this.gl;
    if (this._fullscreenQuadVao) return this._fullscreenQuadVao;

    const vao = gl.createVertexArray()!;
    const buf = gl.createBuffer()!;
    const vertices = new Float32Array([
      -1, -1, 0, 0,
      1, -1, 1, 0,
      1, 1, 1, 1,
      -1, -1, 0, 0,
      1, 1, 1, 1,
      -1, 1, 0, 1,
    ]);

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 16, 8);

    this._fullscreenQuadVao = vao;
    return vao;
  }

  private _ensureEnvMapTexture(texture: import('../Core/Texture').Texture): WebGLTexture | null {
    const gl = this.gl;
    if (texture.glTexture && texture.glVersion === texture.version) {
      return texture.glTexture;
    }

    const img = texture.image;
    if (!img) return null;

    let tex = texture.glTexture || gl.createTexture();
    if (!tex) return null;

    gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);

    if (typeof img === 'object' && 'data' in img && img.format === 'rgba32f') {
      const size = Math.sqrt(img.data.length / 4 / 6) | 0;
      const faces = [
        gl.TEXTURE_CUBE_MAP_POSITIVE_X, gl.TEXTURE_CUBE_MAP_NEGATIVE_X,
        gl.TEXTURE_CUBE_MAP_POSITIVE_Y, gl.TEXTURE_CUBE_MAP_NEGATIVE_Y,
        gl.TEXTURE_CUBE_MAP_POSITIVE_Z, gl.TEXTURE_CUBE_MAP_NEGATIVE_Z,
      ];

      for (let i = 0; i < 6; i++) {
        const offset = i * size * size * 4;
        gl.texImage2D(
          faces[i], 0, gl.RGBA32F, size, size, 0,
          gl.RGBA, gl.FLOAT, img.data.subarray(offset, offset + size * size * 4),
        );
      }
    }

    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    if (texture.generateMipmaps) {
      gl.generateMipmap(gl.TEXTURE_CUBE_MAP);
    }

    texture.glTexture = tex;
    texture.glVersion = texture.version;
    return tex;
  }

  private _ensureStandardTexture(
    texture: import('../Core/Texture').Texture,
    srgb: boolean,
  ): WebGLTexture | null {
    const gl = this.gl;
    if (texture.glTexture && texture.glVersion === texture.version) {
      return texture.glTexture;
    }

    // Phase 4.1: KTX2 上传路径(compressed 或 uncompressed per-mip levels)
    if (texture.compressedLevels !== null && texture.compressedLevels.length > 0) {
      return this._uploadKtx2Levels(texture);
    }

    const img = texture.image;
    if (!img) return null;

    let tex = texture.glTexture || gl.createTexture();
    if (!tex) return null;

    gl.bindTexture(gl.TEXTURE_2D, tex);

    if (typeof img === 'object' && 'data' in img && img.format === 'rgba32f') {
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA32F,
        img.width, img.height, 0,
        gl.RGBA, gl.FLOAT, img.data,
      );
    } else {
      const internalFormat = srgb ? gl.SRGB8_ALPHA8 : gl.RGBA8;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, internalFormat,
        gl.RGBA, gl.UNSIGNED_BYTE, img as TexImageSource,
      );
    }

    const filterMap: Record<string, number> = {
      'linear': gl.LINEAR,
      'nearest': gl.NEAREST,
      'linear-mipmap-linear': gl.LINEAR_MIPMAP_LINEAR,
      'linear-mipmap-nearest': gl.LINEAR_MIPMAP_NEAREST,
    };
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filterMap[texture.minFilter] ?? gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filterMap[texture.magFilter] ?? gl.LINEAR);

    const wrapMap: Record<string, number> = {
      'repeat': gl.REPEAT, 'clamp': gl.CLAMP_TO_EDGE, 'mirror': gl.MIRRORED_REPEAT,
    };
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMap[texture.wrapS] ?? gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMap[texture.wrapT] ?? gl.REPEAT);

    if (texture.generateMipmaps) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    texture.glTexture = tex;
    texture.glVersion = texture.version;
    return tex;
  }

  /**
   * Phase 4.1: 上传 KTX2 解析后的 per-mip levels。
   *
   * 走两条路径:
   *  - formatHint !== null(uncompressed):gl.texImage2D(per-level)
   *  - formatHint === null(compressed):gl.compressedTexImage2D(per-level)
   *
   * KTX2 自带 mipmap,默认不调用 gl.generateMipmap。
   * 不支持 cube/array(已在 KTX2Loader 拒绝)。
   */
  private _uploadKtx2Levels(
    texture: import('../Core/Texture').Texture,
  ): WebGLTexture | null {
    const gl = this.gl;
    const levels = texture.compressedLevels;
    if (!levels || levels.length === 0) return null;

    let tex = texture.glTexture || gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_2D, tex);

    const internalMap: Record<string, number> = {
      'RGBA8': gl.RGBA8,
      'SRGB8_ALPHA8': gl.SRGB8_ALPHA8,
      'R8': gl.R8,
      'RG8': gl.RG8,
    };
    const formatMap: Record<string, number> = {
      'RGBA': gl.RGBA,
      'RED': gl.RED,
      'RG': gl.RG,
    };
    const typeMap: Record<string, number> = {
      'UNSIGNED_BYTE': gl.UNSIGNED_BYTE,
    };

    // KTX2 数据是 top-down,不 flip
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    for (const lv of levels) {
      if (lv.formatHint !== null && lv.typeHint !== null) {
        // Uncompressed level: texImage2D per mip
        const internalFormat = internalMap[lv.internalFormatHint] ?? gl.RGBA8;
        const fmt = formatMap[lv.formatHint] ?? gl.RGBA;
        const type = typeMap[lv.typeHint] ?? gl.UNSIGNED_BYTE;
        gl.texImage2D(
          gl.TEXTURE_2D, lv.level, internalFormat,
          lv.width, lv.height, 0,
          fmt, type, lv.data,
        );
      } else {
        // Compressed level: compressedTexImage2D
        // 内部格式由 transcoder 决定,通过 internalFormatHint 传入 GL enum 数字
        // 当 internalFormatHint === 'COMPRESSED_BASIS' 时,transcoder 应该
        // 已经在 data 上附加 .glInternalFormat;但当前 CompressedMipmapLevel
        // 没有该字段,留作 Phase 4.1.1 扩展。这里直接跳过 + warn。
        // 实际生产中,Basis transcoder 应返回非 'COMPRESSED_BASIS' 的具体格式。
        // 临时降级:把 'COMPRESSED_BASIS' 视为 RGBA8 fallback。
        // (这会让纹理无法正确渲染,但避免崩溃。)
        // 见 ROADMAP Phase 4.1 后续:接入 basis_transcoder 后会替换此分支。
        // eslint-disable-next-line no-console
        console.warn(
          '[WebGL2Renderer] KTX2 compressed level has no formatHint; ' +
          'Basis transcoder not wired. Skipping level', lv.level,
        );
      }
    }

    const filterMap: Record<string, number> = {
      'linear': gl.LINEAR,
      'nearest': gl.NEAREST,
      'linear-mipmap-linear': gl.LINEAR_MIPMAP_LINEAR,
      'linear-mipmap-nearest': gl.LINEAR_MIPMAP_NEAREST,
    };
    gl.texParameteri(
      gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER,
      filterMap[texture.minFilter] ?? gl.LINEAR,
    );
    gl.texParameteri(
      gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER,
      filterMap[texture.magFilter] ?? gl.LINEAR,
    );
    const wrapMap: Record<string, number> = {
      'repeat': gl.REPEAT, 'clamp': gl.CLAMP_TO_EDGE, 'mirror': gl.MIRRORED_REPEAT,
    };
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapMap[texture.wrapS] ?? gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapMap[texture.wrapT] ?? gl.REPEAT);
    // KTX2 自带 mipmap,不调用 generateMipmap

    texture.glTexture = tex;
    texture.glVersion = texture.version;
    return tex;
  }

  /**
   * 上传 Data3DTexture 到 WebGL2 TEXTURE_3D。
   *
   * 支持 RGBA/RGB/RG/R × unsigned-byte/float/half-float 组合。
   * 三线性过滤(LINEAR)在三个维度连续插值,适合体积场/LUT 采样。
   * 不生成 mipmap(3D mipmap 在 WebGL2 中需要 texStorage3D 预分配,
   * 且体积数据通常不需要多级渐远)。
   */
  private _ensureData3DTexture(
    texture: import('../Core/Data3DTexture').Data3DTexture,
  ): WebGLTexture | null {
    const gl = this.gl;
    if (texture.glTexture && texture.glVersion === texture.version) {
      return texture.glTexture;
    }
    if (!texture.data) return null;

    let tex = texture.glTexture || gl.createTexture();
    if (!tex) return null;
    gl.bindTexture(gl.TEXTURE_3D, tex);

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, texture.flipY);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, texture.unpackAlignment);

    // internalFormat / format / type 映射
    const internalMap: Record<string, Record<string, number>> = {
      'rgba': {
        'unsigned-byte': gl.RGBA8,
        'float': gl.RGBA32F,
        'half-float': gl.RGBA16F,
      },
      'rgb': {
        'unsigned-byte': gl.RGB8,
        'float': gl.RGB32F,
        'half-float': gl.RGB16F,
      },
      'rg': {
        'unsigned-byte': gl.RG8,
        'float': gl.RG32F,
        'half-float': gl.RG16F,
      },
      'r': {
        'unsigned-byte': gl.R8,
        'float': gl.R32F,
        'half-float': gl.R16F,
      },
    };
    const formatMap: Record<string, number> = {
      'rgba': gl.RGBA, 'rgb': gl.RGB, 'rg': gl.RG, 'r': gl.RED,
    };
    const typeMap: Record<string, number> = {
      'unsigned-byte': gl.UNSIGNED_BYTE,
      'float': gl.FLOAT,
      'half-float': gl.HALF_FLOAT,
      'unsigned-short': gl.UNSIGNED_SHORT,
      'unsigned-int': gl.UNSIGNED_INT,
    };

    const internalFmt =
      internalMap[texture.format]?.[texture.type] ?? gl.RGBA8;
    const fmt = formatMap[texture.format] ?? gl.RGBA;
    const ty = typeMap[texture.type] ?? gl.UNSIGNED_BYTE;

    gl.texImage3D(
      gl.TEXTURE_3D, 0, internalFmt,
      texture.width, texture.height, texture.depth, 0,
      fmt, ty, texture.data,
    );

    const filterMap: Record<string, number> = {
      'linear': gl.LINEAR,
      'nearest': gl.NEAREST,
      'linear-mipmap-linear': gl.LINEAR_MIPMAP_LINEAR,
      'linear-mipmap-nearest': gl.LINEAR_MIPMAP_NEAREST,
    };
    gl.texParameteri(
      gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER,
      filterMap[texture.minFilter] ?? gl.LINEAR,
    );
    gl.texParameteri(
      gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER,
      filterMap[texture.magFilter] ?? gl.LINEAR,
    );
    const wrapMap: Record<string, number> = {
      'repeat': gl.REPEAT, 'clamp': gl.CLAMP_TO_EDGE, 'mirror': gl.MIRRORED_REPEAT,
    };
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, wrapMap[texture.wrapS] ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, wrapMap[texture.wrapT] ?? gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, wrapMap[texture.wrapR] ?? gl.CLAMP_TO_EDGE);

    texture.glTexture = tex;
    texture.glVersion = texture.version;
    return tex;
  }

  /**
   * 公开 API:上传任意 Texture 并返回其 WebGL 句柄。
   * 支持 2D / Cube / 3D 纹理。用于 PostProcess Pass 需要直接绑定 GL 句柄的场景
   * (如 LUTPass 绑定 sampler3D)。
   */
  getGLTexture(texture: import('../Core/Texture').Texture): WebGLTexture | null {
    // 3D 纹理
    if ((texture as { isData3DTexture?: boolean }).isData3DTexture) {
      return this._ensureData3DTexture(texture as import('../Core/Data3DTexture').Data3DTexture);
    }
    // 2D 纹理(标准路径)
    return this._ensureStandardTexture(texture, texture.colorSpace === 'srgb');
  }

  private _renderPostProcessingPass(_camera: Camera): void {
    const gl = this.gl;
    const res = this._getPostProcessingResources();

    if (this.bloomEnabled) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.bloomFbo1);
      gl.viewport(0, 0, res.width, res.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const extractProg = this.getProgram('bloom-extract', POST_VERT, BLOOM_EXTRACT_FRAG);
      extractProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.mainTexture);
      extractProg.setUniformSampler('u_colorMap', 0);
      extractProg.setUniform1f('u_bloomThreshold', this.bloomThreshold);
      gl.bindVertexArray(this._getFullscreenQuad());
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, res.bloomFbo2);
      gl.viewport(0, 0, res.width, res.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const blurProg = this.getProgram('bloom-blur', POST_VERT, BLOOM_BLUR_FRAG);
      blurProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.bloomTexture1);
      blurProg.setUniformSampler('u_colorMap', 0);
      blurProg.setUniform2f('u_blurDir', 1.0, 0.0);
      blurProg.setUniform1f('u_blurStrength', 2.0);
      blurProg.setUniform2f('u_screenSize', res.width, res.height);
      gl.bindVertexArray(this._getFullscreenQuad());
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, res.bloomFbo1);
      gl.viewport(0, 0, res.width, res.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      blurProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.bloomTexture2);
      blurProg.setUniformSampler('u_colorMap', 0);
      blurProg.setUniform2f('u_blurDir', 0.0, 1.0);
      blurProg.setUniform1f('u_blurStrength', 2.0);
      blurProg.setUniform2f('u_screenSize', res.width, res.height);
      gl.bindVertexArray(this._getFullscreenQuad());
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.width, res.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    let currentTexture = res.mainTexture;

    if (this.chromaticAberrationEnabled) {
      const caProg = this.getProgram('chromatic-aberration', POST_VERT, CHROMATIC_ABERRATION_FRAG);
      caProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, currentTexture);
      caProg.setUniformSampler('u_colorMap', 0);
      caProg.setUniform1f('u_caOffset', this.chromaticAberrationOffset);
      gl.bindVertexArray(this._getFullscreenQuad());
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      currentTexture = res.finalTexture;

      gl.bindFramebuffer(gl.FRAMEBUFFER, res.mainFbo);
      gl.viewport(0, 0, res.width, res.height);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, currentTexture);
      caProg.setUniformSampler('u_colorMap', 0);
      gl.bindVertexArray(this._getFullscreenQuad());
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      currentTexture = res.mainTexture;
    }

    if (this.vignetteEnabled) {
      const vignetteProg = this.getProgram('vignette', POST_VERT, VIGNETTE_FRAG);
      vignetteProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, currentTexture);
      vignetteProg.setUniformSampler('u_colorMap', 0);
      vignetteProg.setUniform1f('u_vignetteDarkness', this.vignetteDarkness);
      vignetteProg.setUniform1f('u_vignetteOffset', this.vignetteOffset);
      gl.bindVertexArray(this._getFullscreenQuad());
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      currentTexture = res.finalTexture;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    // H6: helper(网格)/粒子等可能遗留 BLEND,合成前强制关闭避免叠加异常
    gl.disable(gl.BLEND);
    gl.depthMask(true);

    const finalProg = this.getProgram('final-compose', POST_VERT, FINAL_COMPOSE_FRAG);
    finalProg.use();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, currentTexture);
    finalProg.setUniformSampler('u_colorMap', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomEnabled ? res.bloomTexture1 : res.mainTexture);
    finalProg.setUniformSampler('u_bloomMap', 1);
    finalProg.setUniform1f('u_bloomIntensity', this.bloomIntensity);
    finalProg.setUniform1i('u_bloomEnabled', this.bloomEnabled ? 1 : 0);
    gl.bindVertexArray(this._getFullscreenQuad());
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private _getPostProcessingResources(): PostProcessingResources {
    const gl = this.gl;
    const targetW = this.canvas.width;
    const targetH = this.canvas.height;

    if (this.postResources && this.postResources.width === targetW && this.postResources.height === targetH) {
      return this.postResources;
    }

    if (this.postResources) {
      gl.deleteFramebuffer(this.postResources.mainFbo);
      gl.deleteTexture(this.postResources.mainTexture);
      if (this.postResources.mainDepth) gl.deleteRenderbuffer(this.postResources.mainDepth);
      gl.deleteFramebuffer(this.postResources.bloomFbo1);
      gl.deleteTexture(this.postResources.bloomTexture1);
      gl.deleteFramebuffer(this.postResources.bloomFbo2);
      gl.deleteTexture(this.postResources.bloomTexture2);
      gl.deleteFramebuffer(this.postResources.finalFbo);
      gl.deleteTexture(this.postResources.finalTexture);
    }

    const createTexture = (): WebGLTexture => {
      const tex = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetW, targetH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    };

    const createFbo = (tex: WebGLTexture): WebGLFramebuffer => {
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return fbo;
    };

    const mainTex = createTexture();
    const mainFbo = createFbo(mainTex);
    // 关键修复:mainFbo 渲染 **3D 几何**(主 pass),DEPTH_TEST 全程开启
    // (见 init 里的 gl.enable(gl.DEPTH_TEST))。没有 depth attachment 时,
    // 真实 GPU 上往无深度附件的 FBO 做深度测试行为未定义 —— 实测会在
    // 真机黑屏,而软件渲染(SwiftShader)碰巧放行。补上 depth renderbuffer。
    const mainDepth = gl.createRenderbuffer()!;
    gl.bindRenderbuffer(gl.RENDERBUFFER, mainDepth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, targetW, targetH);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, mainFbo);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, mainDepth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const bloomTex1 = createTexture();
    const bloomFbo1 = createFbo(bloomTex1);

    const bloomTex2 = createTexture();
    const bloomFbo2 = createFbo(bloomTex2);

    const finalTex = createTexture();
    const finalFbo = createFbo(finalTex);

    this.postResources = {
      mainFbo, mainTexture: mainTex, mainDepth,
      bloomFbo1, bloomTexture1: bloomTex1,
      bloomFbo2, bloomTexture2: bloomTex2,
      finalFbo, finalTexture: finalTex,
      width: targetW,
      height: targetH,
    };

    // 真机 GPU 防御:检查各 FBO 完整性。严格驱动(FBO 不完整)会静默拒绝写入
    // → 黑屏;SwiftShader 宽容自动补全。不完整则降级直绘到屏幕。
    const postFbos: Array<[string, WebGLFramebuffer]> = [
      ['main', mainFbo], ['bloom1', bloomFbo1], ['bloom2', bloomFbo2], ['final', finalFbo],
    ];
    for (const [name, fbo] of postFbos) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        log.error(`post FBO '${name}' INCOMPLETE 0x${status.toString(16)} — disabling post-processing (fallback to direct draw)`);
        this._postFboBroken = true;
        break;
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    log.info(`Post-processing FBOs created: ${targetW}x${targetH}`);
    return this.postResources;
  }

  dispose(): void {
    const gl = this.gl;
    const programCount = this.programCache.size;
    for (const p of this.programCache.values()) p.dispose();
    this.programCache.clear();

    let shadowCount = 0;
    for (const res of this._shadowResourcesSet) {
      gl.deleteFramebuffer(res.fbo);
      gl.deleteTexture(res.texture);
      shadowCount++;
    }
    this._shadowResourcesSet.clear();
    this.shadowCache = new WeakMap();

    if (this.ssaoResources) {
      gl.deleteFramebuffer(this.ssaoResources.depthFbo);
      gl.deleteTexture(this.ssaoResources.depthTexture);
      gl.deleteTexture(this.ssaoResources.normalTexture);
      gl.deleteFramebuffer(this.ssaoResources.ssaoFbo);
      gl.deleteTexture(this.ssaoResources.ssaoTexture);
      this.ssaoResources = null;
    }

    if (this._fullscreenQuadVao) {
      gl.deleteVertexArray(this._fullscreenQuadVao);
      this._fullscreenQuadVao = null;
    }

    if (this.postResources) {
      gl.deleteFramebuffer(this.postResources.mainFbo);
      gl.deleteTexture(this.postResources.mainTexture);
      if (this.postResources.mainDepth) gl.deleteRenderbuffer(this.postResources.mainDepth);
      gl.deleteFramebuffer(this.postResources.bloomFbo1);
      gl.deleteTexture(this.postResources.bloomTexture1);
      gl.deleteFramebuffer(this.postResources.bloomFbo2);
      gl.deleteTexture(this.postResources.bloomTexture2);
      gl.deleteFramebuffer(this.postResources.finalFbo);
      gl.deleteTexture(this.postResources.finalTexture);
      this.postResources = null;
    }

    log.info(`dispose: released ${programCount} programs, ${shadowCount} shadow FBOs, ` +
      `${this._renderCount} frames rendered`);
  }
}
