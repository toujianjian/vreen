// GPUComputationRenderer — GPGPU 通用计算编排器(纹理 ping-pong + 依赖图)。
//
// 设计目标:
//   - 把"在 GPU 上迭代计算的数据纹理"抽象成 Variable,每个 Variable 持有一张
//     RGBA 浮点纹理(数据缓冲),通过 fragment shader 读写。
//   - 一个 Variable 可以依赖其它 Variable(如速度场依赖位置场),系统按拓扑序
//     依次计算,保证本轮依赖读取的是上一轮的稳定值(three.js 行为)。
//   - 提供 ping-pong 双缓冲:每步把 shader 输出写到 alternate buffer,再交换,
//     避免读写同一纹理的数据竞争。
//
// 与 three.js GPUComputationRenderer 的差异:
//   * three.js 版本强绑定 WebGL(创建 DataTexture / RenderTarget / ShaderMaterial /
//     全屏 quad mesh,compute() 真正渲染)。本引擎遵循 VREEN 渲染器约定:
//     不直接绑定 GL,而是提供 CPU 侧编排 + 数据缓冲 + GLSL 包装生成,实际
//     GL 提交由调用方(如 WebGL2Renderer)完成。这样可在 Node/无头环境测试。
//   * 额外提供 setVariableKernel() CPU 内核,用于无头测试 / 降级回退:
//     compute() 会在 CPU 上按 texel 调用 kernel,语义等价于 fragment shader。
//   * 数据纹理统一 RGBA(4 floats/texel)打包,与 GPU 纹理格式对齐;
//     channels 字段仅作为"有效通道数"提示,不改变存储。
//
// 典型用法(GPU 路径,由调用方提交 GL):
//   const gpu = new GPUComputationRenderer(64, 64);
//   gpu.addVariable('position', positionFragSource);
//   gpu.addVariable('velocity', velocityFragSource);
//   gpu.setVariableDependencies('velocity', ['position']);
//   gpu.setVariableDependencies('position', ['velocity']);
//   gpu.init();
//   // 每帧:
//   const uniforms = gpu.getVariableUniforms('position'); // {tex, sizeX, sizeY}
//   gpu.compute(); // 推进一步(CPU kernel)或 GPU 提交后 swap
//
// 典型用法(CPU 测试 / 降级):
//   gpu.setVariableKernel('position', (deps, coord, out, off) => {
//     const v = deps['velocity'].data;
//     const i = (coord.y * 64 + coord.x) * 4;
//     out[off]   += v[i];
//     out[off+1] += v[i+1];
//     out[off+2] += v[i+2];
//   });

import { createLogger } from '@/lib/logger';

const log = createLogger('GPUComputationRenderer');

/** 每个 texel 的浮点通道数(内部始终按 RGBA = 4 存储,与 GPU 纹理对齐)。 */
const TEXEL_CHANNELS = 4;

/**
 * CPU 侧计算内核,语义等价于 fragment shader。
 *
 * @param deps   依赖 Variable 的只读数据集合(key = 依赖名)。
 * @param coord  当前 texel 坐标 {x, y}。
 * @param out    输出缓冲(写入 4 个 float 到 out[off..off+3])。
 * @param off    输出缓冲起始偏移(单位:float)。
 * @param sizeX  纹理宽度。
 * @param sizeY  纹理高度。
 *
 * 注意:kernel 应只读 deps(上一轮稳定值),写 out(本轮输出)。
 *       禁止读写自身 Variable 的当前缓冲(会引起数据竞争)。
 */
export type GPUKernel = (
  deps: Record<string, GPUVariableData>,
  coord: { x: number; y: number },
  out: Float32Array,
  off: number,
  sizeX: number,
  sizeY: number,
) => void;

/** Variable 的只读数据视图(传给 kernel 的依赖数据)。 */
export interface GPUVariableData {
  /** 数据缓冲(Float32Array,长度 = sizeX * sizeY * 4)。 */
  data: Float32Array;
  /** 纹理宽度。 */
  sizeX: number;
  /** 纹理高度。 */
  sizeY: number;
  /** 有效通道数(1..4)。 */
  channels: number;
}

/** Variable 的 Uniform 上传信息(供调用方绑定到 GL sampler2D)。 */
export interface GPUVariableUniforms {
  /** 当前数据缓冲(调用方上传为 sampler2D)。 */
  data: Float32Array;
  /** 纹理宽度。 */
  sizeX: number;
  /** 纹理高度。 */
  sizeY: number;
  /** 有效通道数。 */
  channels: number;
  /** 该 Variable 的完整 fragment shader 源(已包装,可直接编译)。 */
  shaderSource: string;
  /** 依赖名列表(对应 shader 中的 sampler2D uniform)。 */
  dependencies: string[];
}

/** Variable 内部状态。 */
interface Variable {
  /** 名称(唯一标识)。 */
  name: string;
  /** 纹理宽度。 */
  sizeX: number;
  /** 纹理高度。 */
  sizeY: number;
  /** 有效通道数(1..4),内部仍按 4 存储。 */
  channels: number;
  /** 用户提供的 fragment shader 片段(写 gl_FragColor,读取依赖 uniform)。 */
  shaderSource: string;
  /** 包装后的完整 fragment shader 源(init 时生成)。 */
  wrappedShader: string;
  /** 依赖名列表。 */
  dependencies: string[];
  /** 当前数据缓冲(sizeX*sizeY*4)。 */
  data: Float32Array;
  /** ping-pong 备用缓冲。 */
  dataAlt: Float32Array;
  /** 当前写入索引(0 = data 为最新,1 = dataAlt 为最新)。 */
  writeIndex: number;
  /** CPU 内核(可选,用于无头测试 / 降级)。 */
  kernel?: GPUKernel;
  /** 是否已 init。 */
  initialized: boolean;
}

/** init() 失败原因枚举。 */
export type GPUInitError =
  | 'duplicate-variable'
  | 'unknown-dependency'
  | 'cyclic-dependency'
  | 'empty';

/** compute() 结果统计。 */
export interface GPUComputeStats {
  /** 本步计算的 Variable 数量。 */
  variableCount: number;
  /** 处理的总 texel 数。 */
  texelCount: number;
  /** 拓扑执行顺序(Variable 名)。 */
  order: string[];
}

/**
 * GPUComputationRenderer — GPGPU 纹理计算编排器。
 *
 * 管理一组 Variable(数据纹理)及其依赖关系,按拓扑序迭代计算。
 * 提供 CPU 内核路径(无头测试 / 降级)与 GLSL 包装生成(GPU 路径)。
 */
export class GPUComputationRenderer {
  /** 纹理宽度(所有 Variable 共享,与 three.js 一致)。 */
  readonly sizeX: number;
  /** 纹理高度(所有 Variable 共享)。 */
  readonly sizeY: number;

  private variables: Map<string, Variable> = new Map();
  /** 拓扑执行顺序(init 后填充)。 */
  private order: string[] = [];
  private _initialized: boolean = false;
  private _disposed: boolean = false;

  /**
   * @param sizeX 纹理宽度(所有 Variable 共享,与 three.js 一致)。
   * @param sizeY 纹理高度。
   */
  constructor(sizeX: number = 64, sizeY: number = 64) {
    if (sizeX <= 0 || sizeY <= 0) {
      throw new Error(`GPUComputationRenderer: sizeX/sizeY must be positive (got ${sizeX}x${sizeY})`);
    }
    this.sizeX = Math.floor(sizeX);
    this.sizeY = Math.floor(sizeY);
  }

  /**
   * 注册一个 Variable。
   *
   * @param name          Variable 唯一名称。
   * @param shaderSource  fragment shader 片段(读取依赖 uniform,写 gl_FragColor)。
   *                      可为空字符串(纯 CPU kernel 路径)。
   * @param channels      有效通道数(1..4),默认 4。内部仍按 RGBA 存储。
   * @param initialData   初始数据(Float32Array,长度 = sizeX*sizeY*4)。
   *                      可选,缺省全零。
   * @returns 是否注册成功(名称重复时返回 false)。
   */
  addVariable(
    name: string,
    shaderSource: string = '',
    channels: number = 4,
    initialData?: Float32Array,
  ): boolean {
    if (this._disposed) {
      log.warn('addVariable: renderer disposed');
      return false;
    }
    if (this.variables.has(name)) {
      log.warn(`addVariable: duplicate variable name "${name}"`);
      return false;
    }
    const ch = Math.max(1, Math.min(TEXEL_CHANNELS, Math.floor(channels)));
    const len = this.sizeX * this.sizeY * TEXEL_CHANNELS;
    const data = new Float32Array(len);
    if (initialData) {
      if (initialData.length !== len) {
        throw new Error(
          `GPUComputationRenderer: initialData length ${initialData.length} != ${len} for "${name}"`,
        );
      }
      data.set(initialData);
    }
    const v: Variable = {
      name,
      sizeX: this.sizeX,
      sizeY: this.sizeY,
      channels: ch,
      shaderSource,
      wrappedShader: '',
      dependencies: [],
      data,
      dataAlt: new Float32Array(len),
      writeIndex: 0,
      initialized: false,
    };
    this.variables.set(name, v);
    // 注册后需要重新 init。
    this._initialized = false;
    log.debug(`addVariable: "${name}" (${this.sizeX}x${this.sizeY}, channels=${ch})`);
    return true;
  }

  /**
   * 设置 Variable 的依赖。
   *
   * 依赖 Variable 在 compute() 中先于本 Variable 计算,且本 Variable 的
   * shader / kernel 读取的是它们上一轮的稳定值。
   *
   * @param name     Variable 名。
   * @param depNames 依赖名列表。
   * @returns 是否设置成功(Variable 不存在时 false)。
   */
  setVariableDependencies(name: string, depNames: string[]): boolean {
    if (this._disposed) return false;
    const v = this.variables.get(name);
    if (!v) {
      log.warn(`setVariableDependencies: unknown variable "${name}"`);
      return false;
    }
    v.dependencies = Array.from(new Set(depNames)); // 去重
    this._initialized = false;
    return true;
  }

  /**
   * 设置 Variable 的 CPU 计算内核(用于无头测试 / 降级路径)。
   *
   * @param name   Variable 名。
   * @param kernel CPU 内核。
   * @returns 是否设置成功。
   */
  setVariableKernel(name: string, kernel: GPUKernel): boolean {
    if (this._disposed) return false;
    const v = this.variables.get(name);
    if (!v) {
      log.warn(`setVariableKernel: unknown variable "${name}"`);
      return false;
    }
    v.kernel = kernel;
    return true;
  }

  /**
   * 初始化:验证依赖图(无环、依赖存在)、生成 GLSL 包装、计算拓扑序。
   *
   * @returns null 成功,否则返回错误原因。
   */
  init(): GPUInitError | null {
    if (this._disposed) return 'empty';
    if (this.variables.size === 0) {
      log.warn('init: no variables');
      return 'empty';
    }

    // 1) 依赖存在性检查 + 重名已在 addVariable 拦截。
    for (const v of this.variables.values()) {
      for (const dep of v.dependencies) {
        if (!this.variables.has(dep)) {
          log.error(`init: variable "${v.name}" depends on unknown "${dep}"`);
          return 'unknown-dependency';
        }
      }
    }

    // 2) 拓扑排序 + 环检测(Kahn 算法)。
    const order = this._topoSort();
    if (order === null) {
      log.error('init: cyclic dependency detected');
      return 'cyclic-dependency';
    }
    this.order = order;

    // 3) 生成 GLSL 包装。
    for (const v of this.variables.values()) {
      v.wrappedShader = this._wrapShader(v);
      v.initialized = true;
    }

    this._initialized = true;
    log.info(`init: ${this.variables.size} variables, order=[${order.join(',')}]`);
    return null;
  }

  /**
   * 推进一步计算。
   *
   * 按拓扑序遍历每个 Variable:
   *   - 若有 kernel:在 CPU 上按 texel 调用 kernel,输出写入 alternate 缓冲;
   *   - 无 kernel:跳过 CPU 计算(调用方应在 GPU 提交后调 swapVariableBuffer);
   *   - 有 kernel 时,compute 完成后自动交换缓冲。
   *
   * 依赖读取的是上一轮稳定值(即依赖 Variable 的当前 data,未被本轮改写)。
   *
   * @returns 计算统计;未 init 时返回 null。
   */
  compute(): GPUComputeStats | null {
    if (this._disposed || !this._initialized) {
      log.warn('compute: not initialized or disposed');
      return null;
    }

    // 收集依赖只读视图(本轮内不被改写,因为先读到 deps 快照)。
    // 注意:同一轮内若 A 依赖 B,且 B 先计算并已 swap,则 A 读到的是 B 本轮新值。
    // three.js 行为是"同一 pass 内读上一轮值",为此我们用"先全部读旧值、
    // 写到 alternate,最后统一 swap"的策略保证语义一致。
    const depSnapshots: Record<string, Float32Array> = {};
    for (const v of this.variables.values()) {
      // 当前 data 是上一轮结果,作为本轮依赖快照。
      depSnapshots[v.name] = v.data;
    }

    let texelCount = 0;
    for (const name of this.order) {
      const v = this.variables.get(name)!;
      if (!v.kernel) {
        // 无 CPU kernel:留给 GPU 路径,调用方自行提交后调 swapVariableBuffer。
        continue;
      }
      // 构建依赖只读视图(指向快照)。
      const deps: Record<string, GPUVariableData> = {};
      for (const dep of v.dependencies) {
        const dv = this.variables.get(dep)!;
        deps[dep] = {
          data: depSnapshots[dep],
          sizeX: dv.sizeX,
          sizeY: dv.sizeY,
          channels: dv.channels,
        };
      }
      // 按 texel 调用 kernel,写入 dataAlt。
      const out = v.dataAlt;
      // 若 kernel 不写全部通道,先把输出清零(避免残留)。
      out.fill(0);
      let idx = 0;
      for (let y = 0; y < v.sizeY; y++) {
        for (let x = 0; x < v.sizeX; x++) {
          v.kernel(deps, { x, y }, out, idx, v.sizeX, v.sizeY);
          idx += TEXEL_CHANNELS;
          texelCount++;
        }
      }
      // 标记:本轮完成后需要 swap(在循环外统一做,避免影响后续依赖快照)。
    }

    // 统一交换所有有 kernel 的 Variable 的缓冲,保证本轮依赖读旧值语义。
    for (const name of this.order) {
      const v = this.variables.get(name)!;
      if (!v.kernel) continue;
      const tmp = v.data;
      v.data = v.dataAlt;
      v.dataAlt = tmp;
      v.writeIndex ^= 1;
    }

    return {
      variableCount: this.order.length,
      texelCount,
      order: Array.from(this.order),
    };
  }

  /**
   * GPU 路径:在调用方完成 GL 提交后,交换 Variable 的 ping-pong 缓冲。
   *
   * 用于无 kernel 的纯 GPU Variable:调用方把 shader 输出渲染到 GL RT 后,
   * 调用本方法让 data 指向最新结果。同时把 GL RT 的像素读回到 data
   * (由调用方自行 readPixels 后 setVariableData,本方法仅交换内部缓冲指针)。
   *
   * @param name Variable 名。
   * @returns 是否交换成功。
   */
  swapVariableBuffer(name: string): boolean {
    if (this._disposed) return false;
    const v = this.variables.get(name);
    if (!v) return false;
    const tmp = v.data;
    v.data = v.dataAlt;
    v.dataAlt = tmp;
    v.writeIndex ^= 1;
    return true;
  }

  /**
   * 获取 Variable 当前数据缓冲(只读视图副本)。
   *
   * 返回 Float32Array 副本,修改不影响内部状态。
   * 用于读回结果 / 测试断言。
   */
  getVariableData(name: string): Float32Array | null {
    const v = this.variables.get(name);
    if (!v) return null;
    return v.data.slice();
  }

  /**
   * 直接覆写 Variable 当前数据(用于初始化 / GPU 路径 readPixels 回填)。
   *
   * @param name Variable 名。
   * @param data 新数据(长度需 = sizeX*sizeY*4)。
   * @returns 是否覆写成功。
   */
  setVariableData(name: string, data: Float32Array): boolean {
    const v = this.variables.get(name);
    if (!v) return false;
    const len = this.sizeX * this.sizeY * TEXEL_CHANNELS;
    if (data.length !== len) {
      log.warn(`setVariableData: length ${data.length} != ${len} for "${name}"`);
      return false;
    }
    v.data.set(data);
    return true;
  }

  /**
   * 获取 Variable 的 Uniform 上传信息(供调用方绑定 GL sampler2D + 编译 shader)。
   */
  getVariableUniforms(name: string): GPUVariableUniforms | null {
    const v = this.variables.get(name);
    if (!v) return null;
    return {
      data: v.data,
      sizeX: v.sizeX,
      sizeY: v.sizeY,
      channels: v.channels,
      shaderSource: v.wrappedShader || this._wrapShader(v),
      dependencies: Array.from(v.dependencies),
    };
  }

  /** 获取所有 Variable 名。 */
  getVariableNames(): string[] {
    return Array.from(this.variables.keys());
  }

  /** 是否已 init。 */
  isInitialized(): boolean {
    return this._initialized;
  }

  /** 获取拓扑执行顺序(init 后有效)。 */
  getOrder(): string[] {
    return Array.from(this.order);
  }

  /**
   * 把用户 fragment shader 片段包装成完整可编译的 GLSL ES 300 fragment shader。
   *
   * 生成内容:
   *   - precision 声明;
   *   - uniform sampler2D 依赖纹理(每个依赖一个,name 即 uniform 名);
   *   - uniform vec2 resolution;
   *   - out highp vec4 fragColor;
   *   - main: 调用用户片段(用 #line 标注行号便于报错),输出 fragColor。
   *
   * 若用户片段为空,生成一个 passthrough(输出 texel 自身,仅用于无依赖场景)。
   */
  private _wrapShader(v: Variable): string {
    const lines: string[] = [];
    lines.push('#version 300 es');
    lines.push('// Auto-generated by GPUComputationRenderer — do not edit.');
    lines.push('precision highp float;');
    lines.push('precision highp sampler2D;');
    lines.push('');
    lines.push('uniform vec2 resolution; // texel resolution (sizeX, sizeY)');
    for (const dep of v.dependencies) {
      // 依赖 uniform 名 = 依赖 Variable 名(假定合法 GLSL 标识符)。
      lines.push(`uniform sampler2D ${dep};`);
    }
    lines.push('');
    lines.push('out highp vec4 fragColor;');
    lines.push('');
    lines.push('// === user fragment begin ===');
    if (v.shaderSource && v.shaderSource.trim().length > 0) {
      // 内嵌用户片段;提供 gl_FragColor 兼容别名。
      lines.push('#define gl_FragColor fragColor');
      lines.push('#line 1');
      lines.push(v.shaderSource);
    } else {
      // passthrough:输出依赖的第一个纹理在当前 texel 的值;无依赖则输出 0。
      if (v.dependencies.length > 0) {
        const dep = v.dependencies[0];
        lines.push('void main() {');
        lines.push(`  vec2 uv = gl_FragCoord.xy / resolution;`);
        lines.push(`  fragColor = texture(${dep}, uv);`);
        lines.push('}');
      } else {
        lines.push('void main() {');
        lines.push('  fragColor = vec4(0.0);');
        lines.push('}');
      }
    }
    lines.push('// === user fragment end ===');
    return lines.join('\n');
  }

  /**
   * 拓扑排序(Kahn 算法)。返回拓扑序数组;存在环时返回 null。
   */
  private _topoSort(): string[] | null {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>(); // dep -> [dependents]
    for (const name of this.variables.keys()) {
      inDegree.set(name, 0);
      adj.set(name, []);
    }
    for (const v of this.variables.values()) {
      for (const dep of v.dependencies) {
        // 边: dep -> v(v 依赖 dep)
        adj.get(dep)!.push(v.name);
        inDegree.set(v.name, (inDegree.get(v.name) || 0) + 1);
      }
    }
    const queue: string[] = [];
    for (const [name, d] of inDegree) {
      if (d === 0) queue.push(name);
    }
    // 保持注册顺序的稳定排序(对同入度节点按注册顺序处理)。
    const regOrder = this.getVariableNames();
    queue.sort((a, b) => regOrder.indexOf(a) - regOrder.indexOf(b));

    const order: string[] = [];
    while (queue.length > 0) {
      const n = queue.shift()!;
      order.push(n);
      const nexts = adj.get(n) || [];
      for (const m of nexts) {
        inDegree.set(m, (inDegree.get(m) || 0) - 1);
        if (inDegree.get(m) === 0) {
          // 插入并保持注册序。
          queue.push(m);
          queue.sort((a, b) => regOrder.indexOf(a) - regOrder.indexOf(b));
        }
      }
    }
    if (order.length !== this.variables.size) {
      return null; // 存在环
    }
    return order;
  }

  /** 释放所有资源。 */
  dispose(): void {
    if (this._disposed) return;
    this.variables.clear();
    this.order = [];
    this._initialized = false;
    this._disposed = true;
    log.debug('disposed');
  }
}
