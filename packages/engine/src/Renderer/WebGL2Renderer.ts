// WebGL2Renderer — the heart of the new engine. Takes a Scene + Camera,
// does shadow pass (if any DirectionalLight has castShadow) then main
// pass. Manages a per-geometry VAO cache and a per-light shadow FBO
// cache; both are invalidated by `version` counters so re-uploads only
// happen on actual CPU-side changes.

import { Camera } from '../Cameras/Camera';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import { Object3D } from '../Core/Object3D';
import { Scene } from '../Core/Scene';
import { SkinnedMesh } from '../Core/SkinnedMesh';
import { Matrix4, Vector3 } from '../Math';
import { AmbientLight, DirectionalLight } from '../Lights/Light';
import { StandardMaterial, STANDARD_FRAGMENT_SRC, STANDARD_VERTEX_SRC } from '../Materials/StandardMaterial';
import { ShaderMaterial as ShaderMaterialCls } from '../Materials/ShaderMaterial';
import { SHADOW_FRAG, SHADOW_VERT, DEPTH_NORMAL_VERT, DEPTH_NORMAL_FRAG, SSAO_VERT, SSAO_FRAG, POST_VERT, BLOOM_EXTRACT_FRAG, BLOOM_BLUR_FRAG, CHROMATIC_ABERRATION_FRAG, VIGNETTE_FRAG, FINAL_COMPOSE_FRAG } from '../Materials/shaders';
import { ShaderProgram } from './ShaderProgram';
import { createLogger } from '../logger';

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
  bloomFbo1: WebGLFramebuffer;
  bloomTexture1: WebGLTexture;
  bloomFbo2: WebGLFramebuffer;
  bloomTexture2: WebGLTexture;
  finalFbo: WebGLFramebuffer;
  finalTexture: WebGLTexture;
  size: number;
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

export class WebGL2Renderer {
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

  private programCache: Map<string, ShaderProgram> = new Map();
  private meshCache: WeakMap<BufferGeometry, MeshResources> = new WeakMap();
  private shadowCache: WeakMap<DirectionalLight, ShadowResources> = new WeakMap();
  private ssaoResources: SSAOResources | null = null;
  private postResources: PostProcessingResources | null = null;

  /** Reusable scratch objects — avoid per-frame allocation. */
  private _viewMatrix = new Matrix4();
  private _projViewMatrix = new Matrix4();
  private _lightView = new Matrix4();
  private _lightProj = new Matrix4();
  private _lightVP = new Matrix4();
  private _normalMat3 = new Float32Array(9);
  private _tmpVec = new Vector3();
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
    if (this.postProcessingEnabled) {
      const postRes = this._getPostProcessingResources();
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, postRes.mainFbo);
      this.gl.viewport(0, 0, postRes.size, postRes.size);
      this.gl.clearColor(this.clearColor.r, this.clearColor.g, this.clearColor.b, this.clearColor.a);
      this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
    } else {
      this.clear();
    }

    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!(mesh instanceof Mesh)) return;
      if (!mesh.visible) return;
      // 旁路:Helper 类 mesh(Grid / ContactShadows)走专用 path。
      if ((mesh.userData as { __helper?: string })?.__helper) {
        this._drawHelper(mesh, camera);
        return;
      }
      this._drawMesh(mesh, scene, camera, dirLight, ambient, ssaoTexture);
    });

    // 4. Post-processing pass
    if (this.postProcessingEnabled) {
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
        `dt=${dt.toFixed(2)}ms`);
    }
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

    // Build light viewProjection: orthographic around scene center.
    const dir = light.direction;
    const lightPos = this._tmpVec
      .copy(this._sceneCenter)
      .add({ x: -dir.x * this._sceneHalfSize, y: -dir.y * this._sceneHalfSize, z: -dir.z * this._sceneHalfSize } as Vector3);
    this._lightView.makeLookAt(lightPos, this._sceneCenter, { x: 0, y: 1, z: 0 });
    const half = light.shadowHalfSize;
    // Orthographic projection:
    const e = this._lightProj.elements;
    e[0] = 1 / half; e[5] = 1 / half; e[10] = -2 / (light.shadowFar - light.shadowNear);
    e[12] = 0; e[13] = 0; e[14] = -(light.shadowFar + light.shadowNear) / (light.shadowFar - light.shadowNear);
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
    const collect = (obj: Object3D, out: Mesh[]) => {
      const m = obj as Mesh;
      if (m instanceof Mesh) {
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

  private _getShadowResources(light: DirectionalLight): ShadowResources {
    const gl = this.gl;
    const cached = this.shadowCache.get(light);
    if (cached && cached.size === light.shadowMapSize) return cached;

    if (cached) {
      gl.deleteFramebuffer(cached.fbo);
      gl.deleteTexture(cached.texture);
      log.warn(`shadow FBO resized: ${cached.size} → ${light.shadowMapSize}`);
    }

    const tex = gl.createTexture();
    if (!tex) throw new Error('createTexture() returned null');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24,
      light.shadowMapSize, light.shadowMapSize, 0,
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
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const res: ShadowResources = {
      fbo, texture: tex, size: light.shadowMapSize,
      viewProjection: new Matrix4(), target: new Vector3(),
    };
    this.shadowCache.set(light, res);
    log.info(`shadow FBO created: ${light.shadowMapSize}x${light.shadowMapSize} ` +
      `(${light.shadowNear}-${light.shadowFar}, half=${light.shadowHalfSize})`);
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
    const program = isUserShader
      ? this._getOrCompileUserShaderProgram(mat as ShaderMaterialCls)
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
    } else {
      this._applyStandardMeshUniforms(
        program, mesh, camera, dirLight, ambient, scene, ssaoTexture,
        mat as StandardMaterial,
      );
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
  }

  /** 编译并缓存用户 ShaderMaterial 对应的 ShaderProgram。 */
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

    const envMap = scene.background?.envMap;
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
        program.setUniform1f('u_shadowBias', dirLight.shadowBias);
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

  private _renderPostProcessingPass(camera: Camera): void {
    const gl = this.gl;
    const res = this._getPostProcessingResources();

    if (this.bloomEnabled) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.bloomFbo1);
      gl.viewport(0, 0, res.size, res.size);
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
      gl.viewport(0, 0, res.size, res.size);
      gl.clear(gl.COLOR_BUFFER_BIT);

      const blurProg = this.getProgram('bloom-blur', POST_VERT, BLOOM_BLUR_FRAG);
      blurProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.bloomTexture1);
      blurProg.setUniformSampler('u_colorMap', 0);
      blurProg.setUniform2f('u_blurDir', 1.0, 0.0);
      blurProg.setUniform1f('u_blurStrength', 2.0);
      blurProg.setUniform2f('u_screenSize', res.size, res.size);
      gl.bindVertexArray(this._getFullscreenQuad());
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, res.bloomFbo1);
      gl.viewport(0, 0, res.size, res.size);
      gl.clear(gl.COLOR_BUFFER_BIT);

      blurProg.use();
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, res.bloomTexture2);
      blurProg.setUniformSampler('u_colorMap', 0);
      blurProg.setUniform2f('u_blurDir', 0.0, 1.0);
      blurProg.setUniform1f('u_blurStrength', 2.0);
      blurProg.setUniform2f('u_screenSize', res.size, res.size);
      gl.bindVertexArray(this._getFullscreenQuad());
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, res.finalFbo);
    gl.viewport(0, 0, res.size, res.size);
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
      gl.viewport(0, 0, res.size, res.size);
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
    const targetSize = this.canvas.width;

    if (this.postResources && this.postResources.size === targetSize) {
      return this.postResources;
    }

    if (this.postResources) {
      gl.deleteFramebuffer(this.postResources.mainFbo);
      gl.deleteTexture(this.postResources.mainTexture);
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
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, targetSize, this.canvas.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
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

    const bloomTex1 = createTexture();
    const bloomFbo1 = createFbo(bloomTex1);

    const bloomTex2 = createTexture();
    const bloomFbo2 = createFbo(bloomTex2);

    const finalTex = createTexture();
    const finalFbo = createFbo(finalTex);

    this.postResources = {
      mainFbo, mainTexture: mainTex,
      bloomFbo1, bloomTexture1: bloomTex1,
      bloomFbo2, bloomTexture2: bloomTex2,
      finalFbo, finalTexture: finalTex,
      size: targetSize,
    };

    log.info(`Post-processing FBOs created: ${targetSize}x${this.canvas.height}`);
    return this.postResources;
  }

  dispose(): void {
    const gl = this.gl;
    const programCount = this.programCache.size;
    for (const p of this.programCache.values()) p.dispose();
    this.programCache.clear();

    let shadowCount = 0;
    const cache = this.shadowCache as unknown as {
      forEach(cb: (res: ShadowResources) => void): void;
    };
    cache.forEach((res) => {
      gl.deleteFramebuffer(res.fbo);
      gl.deleteTexture(res.texture);
      shadowCount++;
    });
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
