// ShaderChunkRegistry — 着色器片段注册表。
//
// 集中管理命名 GLSL 片段,提供:
//   - register(name, glsl)  注册/覆盖片段
//   - get(name)             取片段源码(不存在返回 undefined)
//   - inject(name)          返回 `#define CHUNK_<NAME>` + 片段源码,便于
//                           在 ShaderMaterial 中作为字符串拼接
//   - resolve(source)       解析源码中的 `#include <chunk_name>` 引用,
//                           递归替换为对应片段(支持嵌套)
//
// 与现有 ShaderChunks.ts 中 resolveIncludes 的区别:
//   - resolveIncludes 是固定字典的简单正则替换,无嵌套;
//   - ShaderChunkRegistry 是可扩展的运行时注册表,支持递归 include,
//     避免循环引用。可被 ShaderMaterial / WebGL2Renderer 使用以提供
//     three.js 风格的 `#include <common>` 体验。
//
// 用法:
//   import { shaderChunkRegistry } from './ShaderChunkRegistry';
//   import { COMMON_CHUNK } from './common.glsl';
//   shaderChunkRegistry.register('COMMON', COMMON_CHUNK);
//   const fragSrc = shaderChunkRegistry.resolve(`
//     #include <common>
//     void main() { ... }
//   `);

/** 着色器片段注册表。管理命名 GLSL 片段,支持 #include <name> 解析。 */
export class ShaderChunkRegistry {
  private readonly chunks = new Map<string, string>();

  /** 注册一个命名片段。同名注册会覆盖。
   *  @param name 片段名(大小写敏感,推荐大写)
   *  @param glsl GLSL 源码字符串 */
  register(name: string, glsl: string): this {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(`ShaderChunkRegistry.register: name must be non-empty string, got: ${String(name)}`);
    }
    if (typeof glsl !== 'string') {
      throw new Error(`ShaderChunkRegistry.register: glsl must be string, got: ${typeof glsl}`);
    }
    this.chunks.set(name, glsl);
    return this;
  }

  /** 批量注册。 */
  registerAll(entries: Record<string, string>): this {
    for (const [name, glsl] of Object.entries(entries)) {
      this.register(name, glsl);
    }
    return this;
  }

  /** 取片段源码。不存在返回 undefined。 */
  get(name: string): string | undefined {
    return this.chunks.get(name);
  }

  /** 判断是否已注册。 */
  has(name: string): boolean {
    return this.chunks.has(name);
  }

  /** 注销片段。 */
  unregister(name: string): boolean {
    return this.chunks.delete(name);
  }

  /** 列出所有已注册片段名(按字典序)。 */
  names(): string[] {
    return Array.from(this.chunks.keys()).sort();
  }

  /** 已注册片段数量。 */
  size(): number {
    return this.chunks.size;
  }

  /** 清空注册表。 */
  clear(): void {
    this.chunks.clear();
  }

  /** 生成可注入到 shader 顶部的片段文本:
   *    `#define CHUNK_<NAME>\n<glsl>`
   *  调用方常用:
   *    const src = registry.inject('COMMON') + 'void main() { ... }';
   *  若 name 未注册,抛错(显式失败优于静默插入空字符串)。 */
  inject(name: string): string {
    const glsl = this.chunks.get(name);
    if (glsl === undefined) {
      throw new Error(`ShaderChunkRegistry.inject: chunk "${name}" not registered`);
    }
    return `#define CHUNK_${name}\n${glsl}`;
  }

  /** 解析源码中的 `#include <chunk_name>` 引用,递归替换为片段源码。
   *  - 递归:被注入的片段内部的 #include 也会被解析(深度优先)
   *  - 循环检测:A include B include A 抛错
   *  - 未注册引用:保留原 `#include <name>` 文本并在 console.warn(便于调试),
   *    而非抛错(允许在分段加载时部分引用尚未注册)
   *  - 不处理 `#include "name"`(只用尖括号语法,与 three.js 一致) */
  resolve(source: string): string {
    // 每次调用创建独立的解析栈,避免并发/连续调用间状态泄漏。
    const stack: string[] = [];
    return this.resolveInternal(source, stack);
  }

  private resolveInternal(source: string, stack: string[]): string {
    // 匹配 `#include <name>`(允许中间任意空格)。
    const includeRe = /#include\s+<([A-Za-z0-9_]+)>/g;
    return source.replace(includeRe, (fullMatch: string, name: string) => {
      const glsl = this.chunks.get(name);
      if (glsl === undefined) {
        // 未注册,保留原引用。
        if (typeof console !== 'undefined' && console.warn) {
          console.warn(`ShaderChunkRegistry.resolve: chunk "${name}" not registered, leaving #include as-is`);
        }
        return fullMatch;
      }
      if (stack.includes(name)) {
        const chain = stack.concat(name).join(' -> ');
        throw new Error(`ShaderChunkRegistry.resolve: circular include detected: ${chain}`);
      }
      // 在当前解析栈中递归处理子片段,完成后弹出。
      stack.push(name);
      try {
        return this.resolveInternal(glsl, stack);
      } finally {
        stack.pop();
      }
    });
  }
}

/** 进程级默认注册表单例。 */
export const shaderChunkRegistry = new ShaderChunkRegistry();
