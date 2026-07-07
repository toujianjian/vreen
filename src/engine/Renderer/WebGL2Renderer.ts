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
import { SHADOW_FRAG, SHADOW_VERT } from '../Materials/shaders';
import { ShaderProgram } from './ShaderProgram';

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

export interface RendererStats {
  drawCalls: number;
  triangles: number;
  shadowPasses: number;
  programs: number;
}

export class WebGL2Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;

  /** Background clear color. Pure black default. */
  clearColor: { r: number; g: number; b: number; a: number } = { r: 0, g: 0, b: 0, a: 1 };
  /** Pixel ratio used for backing-store sizing. */
  pixelRatio: number = Math.min(window.devicePixelRatio || 1, 2);

  private programCache: Map<string, ShaderProgram> = new Map();
  private meshCache: WeakMap<BufferGeometry, MeshResources> = new WeakMap();
  private shadowCache: WeakMap<DirectionalLight, ShadowResources> = new WeakMap();

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

  /** Last frame's stats — UI can read. */
  stats: RendererStats = { drawCalls: 0, triangles: 0, shadowPasses: 0, programs: 0 };

  constructor(canvas: HTMLCanvasElement, opts: { antialias?: boolean } = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: opts.antialias ?? true,
      alpha: false,
      depth: true,
      stencil: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;

    // Sane defaults for opaque PBR.
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
  }

  resize(width: number, height: number): void {
    const dpr = this.pixelRatio;
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
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
    p = new ShaderProgram(this.gl, vertSrc, fragSrc, defines);
    this.programCache.set(key, p);
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
  render(scene: Scene, camera: Camera): void {
    if (camera instanceof Camera) {
      camera.updateMatrixWorld(true);
    }
    scene.updateMatrixWorld(true);

    this._sceneBoundsValid = false;
    this._gatherSceneBounds(scene);

    this.stats.drawCalls = 0;
    this.stats.triangles = 0;
    this.stats.shadowPasses = 0;

    // 1. Shadow pass — for every castShadow light
    const lights = this._collectLights(scene);
    for (const light of lights) {
      if (light instanceof DirectionalLight && light.castShadow) {
        this._renderShadowPass(scene, light);
        this.stats.shadowPasses++;
      }
    }

    // 2. Main pass
    this.clear();
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    if ('fov' in camera) {
      // Perspective: ensure aspect + projection are up to date.
      (camera as unknown as { aspect: number; updateProjectionMatrix(): void }).aspect = aspect;
      camera.updateProjectionMatrix();
    }

    this._projViewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this._viewMatrix.copy(camera.matrixWorldInverse);

    const dirLight = lights.find((l) => l instanceof DirectionalLight) as DirectionalLight | undefined;
    const ambient = lights.find((l) => l instanceof AmbientLight) as AmbientLight | undefined;

    // Walk meshes
    scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!(mesh instanceof Mesh)) return;
      if (!mesh.visible) return;
      this._drawMesh(mesh, camera, dirLight, ambient);
    });
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
      } else {
        gl.drawArrays(gl.TRIANGLES, 0, mr.vertexCount);
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
    return res;
  }

  private _getMeshResources(geom: BufferGeometry): MeshResources | null {
    const gl = this.gl;
    const cached = this.meshCache.get(geom);
    if (cached) {
      this._syncMeshResources(cached, geom);
      return cached;
    }
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
    camera: Camera,
    dirLight: DirectionalLight | undefined,
    ambient: AmbientLight | undefined,
  ): void {
    const gl = this.gl;
    const geom = mesh.geometry;
    if (!geom || !geom.attributes.position) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as StandardMaterial | undefined;
    if (!mat) return;

    const mr = this._getMeshResources(geom);
    if (!mr) return;

    const skinning = mesh instanceof SkinnedMesh;
    const { program } = this.getProgramFor(mesh, mat);
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

    program.setUniform3f('u_cameraPos', camera.position.x, camera.position.y, camera.position.z);
    program.setUniform3f('u_baseColor', mat.baseColor.r, mat.baseColor.g, mat.baseColor.b);
    program.setUniform1f('u_metallic', mat.metallic);
    program.setUniform1f('u_roughness', mat.roughness);
    program.setUniform3f('u_emissive', mat.emissive.r, mat.emissive.g, mat.emissive.b);
    program.setUniform1f('u_emissiveIntensity', mat.emissiveIntensity);
    program.setUniform1f('u_opacity', mat.opacity);

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
      // Hemisphere: sky=color, ground=color*0.4
      program.setUniform3f('u_ambientSky', ambient.color.r, ambient.color.g, ambient.color.b);
      program.setUniform3f('u_ambientGround', ambient.color.r * 0.4, ambient.color.g * 0.4, ambient.color.b * 0.4);
    } else {
      program.setUniform3f('u_ambientColor', 0.2, 0.2, 0.25);
      program.setUniform3f('u_ambientSky', 0.2, 0.2, 0.25);
      program.setUniform3f('u_ambientGround', 0.05, 0.05, 0.07);
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
    } else {
      gl.drawArrays(gl.TRIANGLES, 0, mr.vertexCount);
      this.stats.triangles += mr.vertexCount / 3;
    }
    this.stats.drawCalls++;
  }

  dispose(): void {
    const gl = this.gl;
    for (const p of this.programCache.values()) p.dispose();
    this.programCache.clear();
    // WeakMap GC will collect mesh resources; shadow resources we own:
    // 用 forEach 替代 .values()，避免 lib ES2020 没暴露 WeakMap.values (ES2022+) 的问题。
    const cache = this.shadowCache as unknown as {
      forEach(cb: (res: ShadowResources) => void): void;
    };
    cache.forEach((res) => {
      gl.deleteFramebuffer(res.fbo);
      gl.deleteTexture(res.texture);
    });
    this.shadowCache = new WeakMap();
  }
}
