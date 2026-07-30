// ShaderCompiler — 着色器编译器(预处理 + 注入 chunk + 编译 + 缓存)。
//
// 设计目标:
//   - 提供 #include <chunk_name> 预处理(委托给 ShaderChunkRegistry);
//   - 支持 injectChunks(source, chunkNames) 显式注入多个片段到源码顶部;
//   - 编译 GLSL 源码为 WebGLProgram 并缓存(key = hash(vertexSource + fragmentSource + defines));
//   - 反射 uniform / attribute 位置,供渲染器使用。
//
// 与 ShaderProgram / WebGL2Renderer.getProgram 的关系:
//   - ShaderProgram 是低级包装(直接编译 + 收集 location);
//   - WebGL2Renderer.getProgram 内置 programCache,但只对预设 key 缓存;
//   - ShaderCompiler 是面向用户的"自带预处理 + 缓存"的编译器,可被
//     ShaderMaterial / 工具脚本直接使用,不依赖 renderer 实例。
//
// 缓存策略:
//   - key = FNV-1a hash(vertexSource | fragmentSource | defines.join(','))
//   - 命中返回缓存 program(不重新编译);
//   - clearCache() 释放所有缓存的 program;
//   - dispose() = clearCache + 置空 registry 引用。
//
// 不变量:
//   - 编译失败抛 Error(含 GL info log);
//   - getCompileStatus() 反映最后一次 compile 调用是否成功;
//   - preprocess() 不依赖 GL(纯字符串处理),可在无 GL 环境使用。

import { ShaderProgram } from '../Renderer/ShaderProgram';
import { ShaderChunkRegistry } from './ShaderChunks/ShaderChunkRegistry';
import { createLogger } from '@/lib/logger';

const log = createLogger('ShaderCompiler');

/** 编译状态(供反射查询)。 */
export interface CompileStatus {
  /** 最后一次 compile 是否成功。 */
  success: boolean;
  /** 失败原因(成功时为空字符串)。 */
  error: string;
  /** 最后一次编译的 vertex hash(调试用)。 */
  lastVertexHash: string;
  /** 最后一次编译的 fragment hash。 */
  lastFragmentHash: string;
  /** 缓存命中数。 */
  cacheHits: number;
  /** 缓存未命中数(实际编译次数)。 */
  cacheMisses: number;
}

/** FNV-1a hash(用于 cache key)。 */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * 着色器编译器(预处理 + chunk 注入 + 编译 + 缓存)。
 *
 * 用法:
 *   const compiler = new ShaderCompiler();
 *   compiler.preprocess('#include <common>\nvoid main() {}');
 *   const program = compiler.compile(gl, vertSrc, fragSrc, ['USE_FOG']);
 *   const uniforms = compiler.getUniforms(program);
 *
 * 单进程内通常共享一个实例(import { shaderCompiler }),但每个实例
 * 有独立缓存 + registry,可创建多个实例做沙盒(测试常用)。
 */
export class ShaderCompiler {
  /** chunk 注册表(用于 #include 解析)。 */
  chunkRegistry: ShaderChunkRegistry;
  /** 已编译的程序缓存(key = hash)。 */
  cache: Map<string, ShaderProgram> = new Map();
  /** 最后一次编译状态。 */
  private _status: CompileStatus = {
    success: false,
    error: '',
    lastVertexHash: '',
    lastFragmentHash: '',
    cacheHits: 0,
    cacheMisses: 0,
  };

  constructor(registry?: ShaderChunkRegistry) {
    this.chunkRegistry = registry ?? new ShaderChunkRegistry();
  }

  /**
   * 预处理源码:解析 #include <chunk_name> 引用。
   *
   * 委托给 chunkRegistry.resolve();未注册的引用保留原样并 warn。
   * 不依赖 GL,可在 node 环境运行(便于构建期 lint)。
   *
   * @param source 原始 GLSL 源码
   * @returns 处理后源码(include 已被替换)
   */
  preprocess(source: string): string {
    return this.chunkRegistry.resolve(source);
  }

  /**
   * 显式注入多个 chunk 到源码顶部(在 #version 行之后)。
   *
   * 与 preprocess 互补:
   *   - preprocess 处理源码内的 #include <name>(就地替换);
   *   - injectChunks 把指定 chunks 全部插到源码顶部(强制包含,
   *     用于 chunk 内定义了被 main() 隐式调用的工具函数)。
   *
   * @param source 原始源码
   * @param chunkNames 要注入的 chunk 名(必须已注册)
   * @returns 注入后的源码
   */
  injectChunks(source: string, chunkNames: string[]): string {
    if (chunkNames.length === 0) return source;
    const injected = chunkNames
      .map((name) => this.chunkRegistry.inject(name))
      .join('\n');
    // 在 #version 行之后插入
    const versionMatch = source.match(/^(\s*#version[^\n]*\n)/);
    if (versionMatch) {
      return versionMatch[1] + injected + source.slice(versionMatch[1].length);
    }
    return injected + source;
  }

  /**
   * 编译着色器(支持缓存)。
   *
   * @param gl WebGL2 上下文
   * @param vertexSource 顶点着色器源(含 #version)
   * @param fragmentSource 片段着色器源(含 #version)
   * @param defines 额外的 #define 列表(可选)
   * @param skipPreprocess 是否跳过 #include 预处理(默认 false,即默认处理)
   * @returns 编译好的 ShaderProgram
   * @throws 编译失败时抛 Error(含 GL info log)
   */
  compile(
    gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    defines: string[] = [],
    skipPreprocess: boolean = false,
  ): ShaderProgram {
    // 预处理 #include
    const vertSrc = skipPreprocess ? vertexSource : this.preprocess(vertexSource);
    const fragSrc = skipPreprocess ? fragmentSource : this.preprocess(fragmentSource);

    // 计算 cache key
    const keyRaw = vertSrc + '|' + fragSrc + '|' + defines.join(',');
    const key = fnv1a(keyRaw);
    this._status.lastVertexHash = fnv1a(vertSrc);
    this._status.lastFragmentHash = fnv1a(fragSrc);

    // 缓存命中
    const cached = this.cache.get(key);
    if (cached) {
      this._status.success = true;
      this._status.error = '';
      this._status.cacheHits++;
      return cached;
    }

    // 编译
    try {
      const program = new ShaderProgram(gl, vertSrc, fragSrc, defines);
      this.cache.set(key, program);
      this._status.success = true;
      this._status.error = '';
      this._status.cacheMisses++;
      log.debug(`compiled program (key=${key}, defines=[${defines.join(',')}], cache size=${this.cache.size})`);
      return program;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this._status.success = false;
      this._status.error = msg;
      log.error(`compile failed: ${msg}`);
      throw err;
    }
  }

  /**
   * 获取 program 的 uniform 位置(反射)。
   *
   * 直接读取 ShaderProgram.uniforms Map(name → WebGLUniformLocation)。
   * 若 program 已是 ShaderProgram 实例,直接返回其 uniforms 字段;
   * 若是 WebGLProgram 原始句柄,需调用方走 GL API 反射(本方法不支持)。
   */
  getUniforms(program: ShaderProgram): Map<string, WebGLUniformLocation> {
    return program.uniforms;
  }

  /**
   * 获取 program 的 attribute 位置(反射)。
   */
  getAttributes(program: ShaderProgram): Map<string, number> {
    return program.attributes;
  }

  /** 清除缓存(删除所有缓存的 program)。 */
  clearCache(): void {
    for (const p of this.cache.values()) {
      p.dispose();
    }
    this.cache.clear();
    log.debug('cache cleared');
  }

  /**
   * 获取编译状态(反射,供工具 / HUD 用)。
   * 返回的是副本,修改不影响内部状态。
   */
  getCompileStatus(): CompileStatus {
    return { ...this._status };
  }

  /** 缓存条目数。 */
  getCacheSize(): number {
    return this.cache.size;
  }

  /** 释放:清缓存 + 置空 registry 引用。 */
  dispose(): void {
    this.clearCache();
    this.chunkRegistry = new ShaderChunkRegistry();
    log.info('disposed');
  }
}

/** 进程级默认编译器单例(空 registry,可被外部注册 chunk 后使用)。 */
export const shaderCompiler = new ShaderCompiler();
