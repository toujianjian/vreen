// ShaderChunks barrel — 着色器片段库统一导出。
//
// 12 个文件:
//   - 11 个 GLSL 片段字符串常量(common/lighting/fog/normal_packing/
//     shadow/envmap/tonemapping/noise/uv_transform/color_space/specular_aa)
//   - 1 个注册表 ShaderChunkRegistry(类 + 单例)
//   - 本 barrel index
//
// 用法:
//   import { COMMON_CHUNK, shaderChunkRegistry } from '@/engine/Materials/ShaderChunks';
//   shaderChunkRegistry.register('COMMON', COMMON_CHUNK);
//   const src = shaderChunkRegistry.resolve(`#include <common>\nvoid main() {}`);

// 本地导入,同时再导出。`export ... from` 不会把名字引入本地作用域,
// 而 `registerBuiltinChunks` 需要引用 `ShaderChunkRegistry` 类型与
// `shaderChunkRegistry` 单例,所以这里用 import + export。
import { COMMON_CHUNK } from './common.glsl';
import { LIGHTING_CHUNK } from './lighting.glsl';
import { FOG_CHUNK, FOG_EXP2_CHUNK } from './fog.glsl';
import { NORMAL_PACK_CHUNK } from './normal_packing.glsl';
import { SHADOW_CHUNK } from './shadow.glsl';
import { ENVMAP_CHUNK } from './envmap.glsl';
import { TONEMAP_ACES_CHUNK, TONEMAP_REINHARD_CHUNK } from './tonemapping.glsl';
import { NOISE_CHUNK } from './noise.glsl';
import { UV_TRANSFORM_CHUNK } from './uv_transform.glsl';
import { COLOR_SPACE_CHUNK } from './color_space.glsl';
import { SPECULAR_AA_CHUNK, SPECULAR_AA_INLINE } from './specularAA.glsl';
import { ShaderChunkRegistry, shaderChunkRegistry } from './ShaderChunkRegistry';

export {
  COMMON_CHUNK,
  LIGHTING_CHUNK,
  FOG_CHUNK,
  FOG_EXP2_CHUNK,
  NORMAL_PACK_CHUNK,
  SHADOW_CHUNK,
  ENVMAP_CHUNK,
  TONEMAP_ACES_CHUNK,
  TONEMAP_REINHARD_CHUNK,
  NOISE_CHUNK,
  UV_TRANSFORM_CHUNK,
  COLOR_SPACE_CHUNK,
  SPECULAR_AA_CHUNK,
  SPECULAR_AA_INLINE,
  ShaderChunkRegistry,
  shaderChunkRegistry,
};

/** 全部内置片段的 { name: glsl } 字典,便于一次性注册到自定义 registry。 */
export const BUILTIN_SHADER_CHUNKS: Record<string, string> = {
  COMMON: COMMON_CHUNK,
  LIGHTING: LIGHTING_CHUNK,
  FOG: FOG_CHUNK,
  FOG_EXP2: FOG_EXP2_CHUNK,
  NORMAL_PACK: NORMAL_PACK_CHUNK,
  SHADOW: SHADOW_CHUNK,
  ENVMAP: ENVMAP_CHUNK,
  TONEMAP_ACES: TONEMAP_ACES_CHUNK,
  TONEMAP_REINHARD: TONEMAP_REINHARD_CHUNK,
  NOISE: NOISE_CHUNK,
  UV_TRANSFORM: UV_TRANSFORM_CHUNK,
  COLOR_SPACE: COLOR_SPACE_CHUNK,
  SPECULAR_AA: SPECULAR_AA_CHUNK,
};

/** 将全部内置片段注册到指定 registry(默认为进程级单例)。幂等。 */
export function registerBuiltinChunks(
  registry: ShaderChunkRegistry = shaderChunkRegistry,
): void {
  for (const [name, glsl] of Object.entries(BUILTIN_SHADER_CHUNKS)) {
    if (!registry.has(name)) {
      registry.register(name, glsl);
    }
  }
}
