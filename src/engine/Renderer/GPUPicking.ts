// GPUPicking — O(1) 物体拾取(离屏 ID 渲染 + readPixels)。
//
// 适配 three.js ColorPickMesh + o3de Atom EditorMeshPickPass。
//
// 核心思路:
//   1. register(object) 给每个可拾取物体分配一个稠密递增的 pickId(0,1,2,...),
//      维护 pickId ↔ Object3D 双向映射。pickId 与 Object3D.id 不同:
//      Object3D.id 是引擎全局自增(可能很大且稀疏),pickId 是拾取器本地分配
//      (从 0 开始稠密,适合 24-bit 编码)。
//   2. render(gl, camera) 把所有已注册物体用 PICK_* shader 渲染到离屏 MRT FBO:
//        attachment 0 (RGBA8): RGB = pickId 编码,A = 255(命中标记)
//        attachment 1 (RGBA8): RGB = instanceId 编码,A = 255(非实例时全 0)
//      开启深度测试,只保留最前面的物体 id。
//   3. pick(gl, pixelX, pixelY) 用 readPixels 读 (pixelX, pixelY) 一个像素,
//      解码 pickId → 查映射 → 返回 { object, instanceId }。O(1)。
//
// 与 Core/Raycaster 互补:
//   - Raycaster:逐三角形求交,O(三角形数),得到精确 faceIndex/uv/point。
//     适合需要精确命中点(如放置标记、绘制贴花)或场景物体较少时。
//   - GPUPicking:GPU 渲染 + 单像素读取,O(1),只得到 object + instanceId。
//     适合海量物体的编辑器框选 / 悬停高亮 / 点击选中,不需要精确命中点。
//   - 两者可级联:GPUPicking 先确定命中物体,O(1);若需 faceIndex,再对该
//     单个物体调 Raycaster.intersectObject,O(该物体三角形数)。
//
// 设计原则:纯逻辑可测试。encode/decode 是纯函数,无 WebGL 依赖,可在 Node/
// 无头环境测试。GPUPicking 类的 GL 调用集中在 render()/pick()/dispose(),
// register/unregister/lookup 等映射操作不依赖 GL。

import { PICK_VERT, PICK_INSTANCED_VERT, PICK_FRAG } from '../Materials/shaders';
import { ShaderProgram } from './ShaderProgram';
import { MRTTarget } from './MRTTarget';
import type { Object3D } from '../Core/Object3D';
import type { Mesh } from '../Core/Mesh';
import type { InstancedMesh } from '../Core/InstancedMesh';
import type { BufferGeometry } from '../Core/BufferGeometry';
import type { BufferAttribute } from '../Core/BufferAttribute';
import type { Camera } from '../Cameras/Camera';
import { createLogger } from '@/lib/logger';

const log = createLogger('GPUPicking');

/** 24-bit pickId 上限(2^24 = 16777216)。超过抛错。 */
export const MAX_PICK_ID = 0xffffff;

// ── 纯 CPU 函数(与 GLSL encodeId24 1:1 对应) ─────────────────────

/**
 * 把 24-bit pickId 编码为 [r,g,b] 三字节(0..255)。
 * 与 PICK_FRAG 中 encodeId24() 1:1 对应:
 *   r = id & 0xFF, g = (id >> 8) & 0xFF, b = (id >> 16) & 0xFF
 *
 * @param id  0 .. MAX_PICK_ID
 * @returns   [r, g, b],每个 0..255
 */
export function encodeId24(id: number): [number, number, number] {
  if (id < 0 || id > MAX_PICK_ID) {
    throw new RangeError(`encodeId24: id ${id} out of range [0, ${MAX_PICK_ID}]`);
  }
  const u = id >>> 0;
  return [u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff];
}

/**
 * 把 [r,g,b](0..255)解码为 24-bit pickId。
 * 与 encodeId24 互逆,与 GPU readPixels 读出的 Uint8 数据直接配合。
 */
export function decodeId24(r: number, g: number, b: number): number {
  return ((r & 0xff) | ((g & 0xff) << 8) | ((b & 0xff) << 16)) >>> 0;
}

/**
 * 把 pickId 编码为归一化 [r,g,b](0..1),供直接写入 GLSL u_pickId uniform。
 * 等价于 encodeId24(id).map(v => v / 255)。
 */
export function encodeId24Uniform(id: number): [number, number, number] {
  const [r, g, b] = encodeId24(id);
  return [r / 255, g / 255, b / 255];
}

// ── 类型 ──────────────────────────────────────────────────────────

/** 拾取结果。 */
export interface GPUPickResult {
  /** 命中的物体(查不到映射时为 null,理论上不会发生)。 */
  object: Object3D | null;
  /** 命中物体的 pickId(用于调试 / 与映射核对)。 */
  pickId: number;
  /**
   * 命中的实例索引(InstancedMesh 时为 0..count-1)。
   * 普通 Mesh 时为 -1(表示"非实例化")。
   */
  instanceId: number;
}

/** 普通几何体的 GPU 资源缓存(位置 + 索引 + VAO)。 */
interface GeomResources {
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  idxBuf: WebGLBuffer | null;
  posCount: number;
  indexCount: number;
  /** 索引是否为 Uint32(否则 Uint16)。 */
  is32: boolean;
  /** 上次上传的 position.version(变更时重传)。 */
  posVersion: number;
  /** 上次上传的 index.version(变更时重传)。 */
  indexVersion: number;
}

/** InstancedMesh 的 GPU 资源缓存(位置 + 索引 + instanceMatrix + instanceId + VAO)。 */
interface InstancedResources extends GeomResources {
  instanceMatrixBuf: WebGLBuffer;
  instanceIdBuf: WebGLBuffer;
  /** 上次上传的 instanceMatrixVersion(变更时重传)。 */
  instanceMatrixVersion: number;
  /** 实例数量。 */
  instanceCount: number;
}

/** GPUPicking 配置。 */
export interface GPUPickingOptions {
  /**
   * 拾取 FBO 分辨率缩放因子(相对 canvas)。
   * 1.0 = 与 canvas 同分辨率;0.5 = 半分辨率(更快,精度略低)。
   * 默认 1.0。框选大区域时建议降到 0.5。
   */
  resolutionScale?: number;
  /** 是否在 register 时自动跳过 invisible 物体。默认 true。 */
  skipInvisible?: boolean;
}

// ── GPUPicking 类 ─────────────────────────────────────────────────

export class GPUPicking {
  /** pickId → Object3D 映射(稠密,从 1 开始;0 保留给"背景/无命中")。 */
  private _idToObj: Map<number, Object3D> = new Map();
  /** Object3D → pickId 映射(register 的逆映射)。 */
  private _objToId: Map<Object3D, number> = new Map();
  /** 下一个待分配的 pickId(从 1 开始)。 */
  private _nextId: number = 1;

  /** 离屏 MRT FBO(2 个 RGBA8 颜色附件 + 深度附件)。 */
  private _mrt: MRTTarget = new MRTTarget();
  /** FBO 宽度。 */
  private _width: number = 0;
  /** FBO 高度。 */
  private _height: number = 0;
  /** resolutionScale 缓存。 */
  private _resolutionScale: number;
  /** skipInvisible 缓存。 */
  private _skipInvisible: boolean;

  /** 普通 Mesh 的 picking shader program。 */
  private _pickProg: ShaderProgram | null = null;
  /** InstancedMesh 的 picking shader program。 */
  private _instancedProg: ShaderProgram | null = null;

  /** 每个几何体(普通 Mesh 路径)的 VAO + buffer 缓存。 */
  private _geomCache: WeakMap<BufferGeometry, GeomResources> = new WeakMap();
  /** 每个 InstancedMesh 的 VAO + buffer 缓存(含实例属性)。 */
  private _instancedCache: WeakMap<InstancedMesh, InstancedResources> = new WeakMap();

  /** 跟踪已创建的资源以便 dispose(WeakMap 不可遍历的补偿)。 */
  private _geomDisposables: Set<GeomResources> = new Set();
  private _instancedDisposables: Set<InstancedResources> = new Set();

  /** 临时 Uint8Array,readPixels 1 像素用。 */
  private _readBuf: Uint8Array = new Uint8Array(4);

  constructor(opts: GPUPickingOptions = {}) {
    this._resolutionScale = opts.resolutionScale ?? 1.0;
    this._skipInvisible = opts.skipInvisible ?? true;
  }

  // ── 注册 / 注销 ──────────────────────────────────────────────────

  /**
   * 注册一个可拾取物体。幂等:同一物体重复注册返回已有 pickId。
   * @returns 分配给该物体的 pickId(1 .. MAX_PICK_ID)
   */
  register(object: Object3D): number {
    const existing = this._objToId.get(object);
    if (existing !== undefined) return existing;

    if (this._nextId > MAX_PICK_ID) {
      throw new Error(
        `GPUPicking.register: pickId overflow (exceeded ${MAX_PICK_ID}). ` +
          `Deregister unused objects or increase ID space.`,
      );
    }
    const id = this._nextId++;
    this._objToId.set(object, id);
    this._idToObj.set(id, object);
    return id;
  }

  /**
   * 批量注册物体。返回 {registered, skipped} 统计。
   * skipInvisible=true 时跳过 visible=false 的物体。
   */
  registerAll(objects: Iterable<Object3D>): { registered: number; skipped: number } {
    let registered = 0;
    let skipped = 0;
    for (const o of objects) {
      if (this._skipInvisible && !o.visible) {
        skipped++;
        continue;
      }
      this.register(o);
      registered++;
    }
    return { registered, skipped };
  }

  /** 注销一个物体。释放其 pickId(不回收 id,避免映射混乱)。 */
  unregister(object: Object3D): void {
    const id = this._objToId.get(object);
    if (id === undefined) return;
    this._objToId.delete(object);
    this._idToObj.delete(id);
  }

  /** 注销所有物体。pickId 计数器重置为 1。 */
  clear(): void {
    this._idToObj.clear();
    this._objToId.clear();
    this._nextId = 1;
  }

  /** 查询物体是否已注册。 */
  has(object: Object3D): boolean {
    return this._objToId.has(object);
  }

  /** 获取已注册物体数量。 */
  get count(): number {
    return this._objToId.size;
  }

  /** 按 pickId 查物体(找不到返回 null)。 */
  lookup(pickId: number): Object3D | null {
    return this._idToObj.get(pickId) ?? null;
  }

  /** 获取物体的 pickId(未注册返回 0,即"背景")。 */
  pickIdOf(object: Object3D): number {
    return this._objToId.get(object) ?? 0;
  }

  /** 获取所有已注册物体(数组,顺序不保证)。 */
  getRegisteredObjects(): Object3D[] {
    return Array.from(this._objToId.keys());
  }

  // ── GPU 资源管理 ─────────────────────────────────────────────────

  /** 确保两个 shader program 已编译。 */
  private _ensurePrograms(gl: WebGL2RenderingContext): void {
    if (!this._pickProg) {
      this._pickProg = new ShaderProgram(gl, PICK_VERT, PICK_FRAG);
    }
    if (!this._instancedProg) {
      this._instancedProg = new ShaderProgram(gl, PICK_INSTANCED_VERT, PICK_FRAG);
    }
  }

  /**
   * 确保 MRT FBO 尺寸匹配 canvas × resolutionScale。
   * 尺寸变化时重建(MRTTarget.resize 内部处理)。
   */
  private _ensureFBO(gl: WebGL2RenderingContext, width: number, height: number): void {
    const w = Math.max(1, Math.floor(width * this._resolutionScale));
    const h = Math.max(1, Math.floor(height * this._resolutionScale));
    if (!this._mrt.isSetup) {
      this._mrt.setup(gl, w, h, {
        colorCount: 2,
        depth: true,
        stencil: false,
        colorInternalFormat: 'rgba8',
        colorType: 'unsigned-byte',
        colorFilter: 'nearest',
      });
      this._width = w;
      this._height = h;
    } else if (w !== this._width || h !== this._height) {
      this._mrt.resize(gl, w, h);
      this._width = w;
      this._height = h;
    }
  }

  /**
   * 获取/创建普通几何体的 VAO + buffer(位置 + 索引)。
   * 跟踪 position/index 的 version,变更时重传。
   */
  private _getGeomResources(gl: WebGL2RenderingContext, geom: BufferGeometry): GeomResources | null {
    const posAttr = geom.attributes.position as BufferAttribute | undefined;
    if (!posAttr) return null;

    let res = this._geomCache.get(geom);
    const posDirty = !res || res.posVersion !== posAttr.version;

    if (!res) {
      // 新建 VAO + buffer
      const vao = gl.createVertexArray();
      if (!vao) throw new Error('GPUPicking: createVertexArray() returned null');
      const posBuf = gl.createBuffer();
      if (!posBuf) throw new Error('GPUPicking: createBuffer() returned null (pos)');
      let idxBuf: WebGLBuffer | null = null;
      let indexCount = 0;
      let is32 = false;
      if (geom.index) {
        idxBuf = gl.createBuffer();
        if (!idxBuf) throw new Error('GPUPicking: createBuffer() returned null (idx)');
        // index.array 运行时实际是 Uint16Array / Uint32Array(BufferAttribute
        // 构造时强转为 Float32Array 类型,但 setIndex 存的是原始 typed array)。
        is32 = (geom.index.array as unknown) instanceof Uint32Array;
        indexCount = geom.index.count;
      }

      res = {
        vao,
        posBuf,
        idxBuf,
        posCount: posAttr.count,
        indexCount,
        is32,
        posVersion: posAttr.version,
        indexVersion: geom.index ? geom.index.version : 0,
      };
      this._geomCache.set(geom, res);
      this._geomDisposables.add(res);

      // 上传 position
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, posAttr.array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      // 上传 index
      if (idxBuf && geom.index) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.index.array as unknown as ArrayBufferView, gl.STATIC_DRAW);
      }
      gl.bindVertexArray(null);
    } else if (posDirty) {
      // position 变了,重传
      gl.bindVertexArray(res.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, res.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, posAttr.array, gl.STATIC_DRAW);
      res.posVersion = posAttr.version;
      res.posCount = posAttr.count;
      // index 是否也变?
      if (geom.index && res.indexVersion !== geom.index.version) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.idxBuf as WebGLBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.index.array as unknown as ArrayBufferView, gl.STATIC_DRAW);
        res.indexVersion = geom.index.version;
        res.indexCount = geom.index.count;
        res.is32 = (geom.index.array as unknown) instanceof Uint32Array;
      }
      gl.bindVertexArray(null);
    } else if (geom.index && res.indexVersion !== geom.index.version) {
      // 仅 index 变了
      gl.bindVertexArray(res.vao);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.idxBuf as WebGLBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.index.array as unknown as ArrayBufferView, gl.STATIC_DRAW);
      res.indexVersion = geom.index.version;
      res.indexCount = geom.index.count;
      res.is32 = (geom.index.array as unknown) instanceof Uint32Array;
      gl.bindVertexArray(null);
    }

    return res;
  }

  /**
   * 获取/创建 InstancedMesh 的 VAO + buffer。
   * 额外创建 instanceMatrix(location 3..6)+ instanceId(location 7)实例属性。
   */
  private _getInstancedResources(
    gl: WebGL2RenderingContext,
    mesh: InstancedMesh,
  ): InstancedResources | null {
    const geom = mesh.geometry;
    const posAttr = geom.attributes.position as BufferAttribute | undefined;
    if (!posAttr) return null;

    let res = this._instancedCache.get(mesh);
    const posDirty = !res || res.posVersion !== posAttr.version;
    const instDirty = !res || res.instanceMatrixVersion !== mesh.instanceMatrixVersion;

    if (!res) {
      // InstancedMesh 需要单独的 VAO(实例属性 location 3..7 不能污染共享 VAO)。
      const vao = gl.createVertexArray();
      if (!vao) throw new Error('GPUPicking: createVertexArray() returned null (instanced)');
      const posBuf = gl.createBuffer();
      if (!posBuf) throw new Error('GPUPicking: createBuffer() returned null (pos-i)');
      const instanceMatrixBuf = gl.createBuffer();
      if (!instanceMatrixBuf) throw new Error('GPUPicking: createBuffer() returned null (imat)');
      const instanceIdBuf = gl.createBuffer();
      if (!instanceIdBuf) throw new Error('GPUPicking: createBuffer() returned null (iid)');

      let idxBuf: WebGLBuffer | null = null;
      let indexCount = 0;
      let is32 = false;
      if (geom.index) {
        idxBuf = gl.createBuffer();
        if (!idxBuf) throw new Error('GPUPicking: createBuffer() returned null (idx-i)');
        is32 = (geom.index.array as unknown) instanceof Uint32Array;
        indexCount = geom.index.count;
      }

      res = {
        vao,
        posBuf,
        idxBuf,
        posCount: posAttr.count,
        indexCount,
        is32,
        posVersion: posAttr.version,
        indexVersion: geom.index ? geom.index.version : 0,
        instanceMatrixBuf,
        instanceIdBuf,
        instanceMatrixVersion: mesh.instanceMatrixVersion,
        instanceCount: mesh.count,
      };
      this._instancedCache.set(mesh, res);
      this._instancedDisposables.add(res);

      // 配置 VAO
      gl.bindVertexArray(vao);
      // position (location 0)
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, posAttr.array, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      // index
      if (idxBuf && geom.index) {
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.index.array as unknown as ArrayBufferView, gl.STATIC_DRAW);
      }
      // a_instanceMatrix (location 3,4,5,6) — mat4 占 4 个 location
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceMatrixBuf);
      gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceMatrix, gl.DYNAMIC_DRAW);
      for (let c = 0; c < 4; c++) {
        const loc = 3 + c;
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 64, c * 16);
        gl.vertexAttribDivisor(loc, 1);
      }
      // a_instanceId (location 7) — 每实例一个 float,值为 0..count-1
      const idArr = new Float32Array(mesh.count);
      for (let i = 0; i < mesh.count; i++) idArr[i] = i;
      gl.bindBuffer(gl.ARRAY_BUFFER, instanceIdBuf);
      gl.bufferData(gl.ARRAY_BUFFER, idArr, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(7);
      gl.vertexAttribPointer(7, 1, gl.FLOAT, false, 0, 0);
      gl.vertexAttribDivisor(7, 1);
      gl.bindVertexArray(null);
    } else {
      // 已存在,检查 dirty
      if (posDirty) {
        gl.bindVertexArray(res.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.posBuf);
        gl.bufferData(gl.ARRAY_BUFFER, posAttr.array, gl.STATIC_DRAW);
        res.posVersion = posAttr.version;
        res.posCount = posAttr.count;
        if (geom.index && res.indexVersion !== geom.index.version) {
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.idxBuf as WebGLBuffer);
          gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.index.array as unknown as ArrayBufferView, gl.STATIC_DRAW);
          res.indexVersion = geom.index.version;
          res.indexCount = geom.index.count;
          res.is32 = (geom.index.array as unknown) instanceof Uint32Array;
        }
        gl.bindVertexArray(null);
      } else if (geom.index && res.indexVersion !== geom.index.version) {
        gl.bindVertexArray(res.vao);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, res.idxBuf as WebGLBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.index.array as unknown as ArrayBufferView, gl.STATIC_DRAW);
        res.indexVersion = geom.index.version;
        res.indexCount = geom.index.count;
        res.is32 = (geom.index.array as unknown) instanceof Uint32Array;
        gl.bindVertexArray(null);
      }
      if (instDirty) {
        gl.bindVertexArray(res.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, res.instanceMatrixBuf);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.instanceMatrix, gl.DYNAMIC_DRAW);
        res.instanceMatrixVersion = mesh.instanceMatrixVersion;
        res.instanceCount = mesh.count;
        gl.bindVertexArray(null);
      }
    }

    return res;
  }

  // ── 渲染 ─────────────────────────────────────────────────────────

  /**
   * 把所有已注册物体渲染到拾取 FBO。
   *
   * 调用前需确保 camera.matrixWorld / matrixWorldInverse 已更新
   * (通常由渲染器在主渲染循环中完成)。
   *
   * @param gl       WebGL2 上下文
   * @param camera   相机(读 matrixWorldInverse / projectionMatrix)
   * @param canvasW  canvas 宽度(像素,用于 FBO 尺寸;不传则用 gl.canvas.width)
   * @param canvasH  canvas 高度(像素)
   */
  render(
    gl: WebGL2RenderingContext,
    camera: Camera,
    canvasW?: number,
    canvasH?: number,
  ): void {
    if (this._objToId.size === 0) {
      log.warn('render() called with 0 registered objects; FBO not rendered');
      return;
    }

    const w = canvasW ?? (gl.canvas as HTMLCanvasElement).width;
    const h = canvasH ?? (gl.canvas as HTMLCanvasElement).height;
    this._ensureFBO(gl, w, h);
    this._ensurePrograms(gl);

    // 绑定拾取 FBO,清屏
    this._mrt.bind(gl);
    gl.viewport(0, 0, this._width, this._height);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.clearColor(0, 0, 0, 0);   // 背景:id=0,alpha=0(无命中)
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const view = camera.matrixWorldInverse.elements;
    const proj = camera.projectionMatrix.elements;

    // 渲染所有已注册物体
    for (const [obj, pickId] of this._objToId) {
      if (this._skipInvisible && !obj.visible) continue;
      // 跳过非 Mesh(灯光、相机、空 Object3D 等无可拾取几何体)
      if (!(obj as Mesh).isMesh) continue;

      const [r, g, b] = encodeId24Uniform(pickId);

      if ((obj as InstancedMesh).isInstancedMesh) {
        const mesh = obj as InstancedMesh;
        const res = this._getInstancedResources(gl, mesh);
        if (!res) continue;
        const prog = this._instancedProg as ShaderProgram;
        prog.use();
        prog.setUniformMatrix4fv('u_view', view);
        prog.setUniformMatrix4fv('u_projection', proj);
        prog.setUniform3f('u_pickId', r, g, b);
        gl.bindVertexArray(res.vao);
        if (res.idxBuf) {
          gl.drawElementsInstanced(
            gl.TRIANGLES,
            res.indexCount,
            res.is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
            0,
            res.instanceCount,
          );
        } else {
          gl.drawArraysInstanced(gl.TRIANGLES, 0, res.posCount, res.instanceCount);
        }
      } else {
        const mesh = obj as Mesh;
        const res = this._getGeomResources(gl, mesh.geometry);
        if (!res) continue;
        const prog = this._pickProg as ShaderProgram;
        prog.use();
        prog.setUniformMatrix4fv('u_model', mesh.matrixWorld.elements);
        prog.setUniformMatrix4fv('u_view', view);
        prog.setUniformMatrix4fv('u_projection', proj);
        prog.setUniform3f('u_pickId', r, g, b);
        gl.bindVertexArray(res.vao);
        if (res.idxBuf) {
          gl.drawElements(
            gl.TRIANGLES,
            res.indexCount,
            res.is32 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
            0,
          );
        } else {
          gl.drawArrays(gl.TRIANGLES, 0, res.posCount);
        }
      }
    }

    gl.bindVertexArray(null);
    this._mrt.unbind(gl);
  }

  // ── 拾取 ─────────────────────────────────────────────────────────

  /**
   * 读取 (pixelX, pixelY) 像素的物体 id(假设 render() 已调用)。
   *
   * 坐标原点:左下角(GL 约定)。pixelX/pixelY 是 FBO 像素坐标
   * (已按 resolutionScale 缩放,调用方传 canvas 像素即可,本方法内部缩放)。
   *
   * @returns 命中结果;背景(无命中)返回 null。
   */
  pick(gl: WebGL2RenderingContext, pixelX: number, pixelY: number): GPUPickResult | null {
    if (!this._mrt.isSetup) {
      log.warn('pick() called before render(); FBO not setup');
      return null;
    }

    // canvas 像素 → FBO 像素
    const fx = Math.floor(pixelX * this._resolutionScale);
    const fy = Math.floor(pixelY * this._resolutionScale);
    // 钳制到 [0, w-1] × [0, h-1]
    const cx = Math.max(0, Math.min(this._width - 1, fx));
    const cy = Math.max(0, Math.min(this._height - 1, fy));

    // 绑定 FBO,读 attachment 0(物体 id)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._mrt.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._readBuf);

    // alpha=0 → 背景(无命中)
    if (this._readBuf[3] === 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return null;
    }

    const pickId = decodeId24(this._readBuf[0], this._readBuf[1], this._readBuf[2]);
    const object = this._idToObj.get(pickId) ?? null;

    // 读 attachment 1(实例 id)
    gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(cx, cy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._readBuf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let instanceId = -1;
    if (this._readBuf[3] !== 0) {
      instanceId = decodeId24(this._readBuf[0], this._readBuf[1], this._readBuf[2]);
    }

    return { object, pickId, instanceId };
  }

  /**
   * 便捷:render() + pick() 一次完成。
   * 适合单次点击拾取(每帧只拾取一次时用,避免重复渲染)。
   */
  pickAt(
    gl: WebGL2RenderingContext,
    camera: Camera,
    pixelX: number,
    pixelY: number,
    canvasW?: number,
    canvasH?: number,
  ): GPUPickResult | null {
    this.render(gl, camera, canvasW, canvasH);
    return this.pick(gl, pixelX, pixelY);
  }

  /**
   * 框选:读取矩形区域内所有像素的物体 id(去重)。
   * 返回被命中物体的集合(不含实例 id;框选通常只关心物体级选中)。
   *
   * @param x0,y0  矩形左下角(canvas 像素)
   * @param x1,y1  矩形右上角(canvas 像素)
   * @returns      命中物体数组(去重),无命中返回空数组。
   */
  pickRect(
    gl: WebGL2RenderingContext,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): Object3D[] {
    if (!this._mrt.isSetup) return [];

    const fx0 = Math.max(0, Math.floor(Math.min(x0, x1) * this._resolutionScale));
    const fy0 = Math.max(0, Math.floor(Math.min(y0, y1) * this._resolutionScale));
    const fx1 = Math.min(this._width - 1, Math.floor(Math.max(x0, x1) * this._resolutionScale));
    const fy1 = Math.min(this._height - 1, Math.floor(Math.max(y0, y1) * this._resolutionScale));
    const rw = fx1 - fx0 + 1;
    const rh = fy1 - fy0 + 1;
    if (rw <= 0 || rh <= 0) return [];

    const buf = new Uint8Array(rw * rh * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this._mrt.framebuffer);
    gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(fx0, fy0, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const seen = new Set<number>();
    const result: Object3D[] = [];
    for (let i = 0; i < buf.length; i += 4) {
      if (buf[i + 3] === 0) continue; // 背景
      const id = decodeId24(buf[i], buf[i + 1], buf[i + 2]);
      if (seen.has(id)) continue;
      seen.add(id);
      const obj = this._idToObj.get(id);
      if (obj) result.push(obj);
    }
    return result;
  }

  // ── 资源释放 ─────────────────────────────────────────────────────

  /** 当前 FBO 宽度(未 setup 时为 0)。 */
  get width(): number { return this._width; }
  /** 当前 FBO 高度(未 setup 时为 0)。 */
  get height(): number { return this._height; }
  /** resolutionScale。 */
  get resolutionScale(): number { return this._resolutionScale; }

  /**
   * 释放所有 GL 资源(FBO / 纹理 / program / VAO / buffer)。
   * 调用后实例不可再用,需重新 new。
   */
  dispose(gl: WebGL2RenderingContext): void {
    this._mrt.dispose(gl);
    this._pickProg?.dispose();
    this._pickProg = null;
    this._instancedProg?.dispose();
    this._instancedProg = null;

    // 释放普通几何体 buffer(WeakMap 无法遍历,但 VAO/buffer 由 GL 持有,
    // 需显式删除以避免泄漏)。我们维护一个 side-set 来跟踪。
    for (const res of this._geomDisposables) {
      gl.deleteVertexArray(res.vao);
      gl.deleteBuffer(res.posBuf);
      if (res.idxBuf) gl.deleteBuffer(res.idxBuf);
    }
    this._geomDisposables.clear();
    for (const res of this._instancedDisposables) {
      gl.deleteVertexArray(res.vao);
      gl.deleteBuffer(res.posBuf);
      if (res.idxBuf) gl.deleteBuffer(res.idxBuf);
      gl.deleteBuffer(res.instanceMatrixBuf);
      gl.deleteBuffer(res.instanceIdBuf);
    }
    this._instancedDisposables.clear();

    this._geomCache = new WeakMap();
    this._instancedCache = new WeakMap();
    this._width = 0;
    this._height = 0;
    this.clear();
  }
}
