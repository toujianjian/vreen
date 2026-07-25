// Materials barrel.

export { StandardMaterial, STANDARD_VERTEX_SRC, STANDARD_FRAGMENT_SRC } from './StandardMaterial';
export { PhysicalMaterial, type PhysicalMaterialOptions } from './MeshPhysicalMaterial';
export { MeshBasicMaterial, type MeshBasicMaterialOptions } from './MeshBasicMaterial';
export { PhongMaterial, type PhongMaterialOptions } from './MeshPhongMaterial';
export { NormalMaterial, type NormalMaterialOptions } from './MeshNormalMaterial';
export { ShadowMaterial, type ShadowMaterialOptions, SHADOW_MATERIAL_VERT, SHADOW_MATERIAL_FRAG } from './ShadowMaterial';
export { SpriteMaterial, type SpriteMaterialOptions } from './SpriteMaterial';
export {
  PBR_VERT,
  PBR_FRAG,
  SHADOW_VERT,
  SHADOW_FRAG,
  SHADOW_DEPTH_VERT,
  SHADOW_DEPTH_FRAG,
  PCF_SHADOW_FRAG,
} from './shaders';

// 着色器片段库(子模块)。注意:与 ShaderChunks.ts 平级文件同名,
// 用显式 '/index' 路径消歧,确保解析到 ShaderChunks/ 目录而非 ShaderChunks.ts。
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
  ShaderChunkRegistry,
  shaderChunkRegistry,
  BUILTIN_SHADER_CHUNKS,
  registerBuiltinChunks,
} from './ShaderChunks/index';

