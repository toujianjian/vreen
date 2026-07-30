// Materials barrel.

export { StandardMaterial, STANDARD_VERTEX_SRC, STANDARD_FRAGMENT_SRC } from './StandardMaterial';
export { PhysicalMaterial, type PhysicalMaterialOptions } from './MeshPhysicalMaterial';
export { MeshBasicMaterial, type MeshBasicMaterialOptions } from './MeshBasicMaterial';
export { PhongMaterial, type PhongMaterialOptions } from './MeshPhongMaterial';
export { NormalMaterial, type NormalMaterialOptions } from './MeshNormalMaterial';
export { ShadowMaterial, type ShadowMaterialOptions, SHADOW_MATERIAL_VERT, SHADOW_MATERIAL_FRAG } from './ShadowMaterial';
export { SpriteMaterial, type SpriteMaterialOptions } from './SpriteMaterial';
// 特殊着色器材质(卡通 / 水面 / 线框 / 描边 / Matcap)。
export {
  ToonMaterial,
  type ToonMaterialOptions,
  TOON_VERT,
  TOON_FRAG,
} from './ToonMaterial';
export {
  WaterMaterial,
  type WaterMaterialOptions,
  WATER_VERT,
  WATER_FRAG,
} from './WaterMaterial';
export {
  WireframeMaterial,
  type WireframeMaterialOptions,
  WIREFRAME_VERT,
  WIREFRAME_FRAG,
} from './WireframeMaterial';
export {
  OutlineMaterial,
  type OutlineMaterialOptions,
  OUTLINE_VERT,
  OUTLINE_FRAG,
} from './OutlineMaterial';
export {
  MatcapMaterial,
  type MatcapMaterialOptions,
  MATCAP_VERT,
  MATCAP_FRAG,
} from './MatcapMaterial';
// 毛发材质(shell-based fur)。
export {
  FurMaterial,
  type FurMaterialOptions,
  FUR_VERT,
  FUR_FRAG,
} from './FurMaterial';
// 次表面散射材质(皮肤/蜡/玉石/牛奶等)。
export {
  SubsurfaceScatteringMaterial,
  type SubsurfaceScatteringMaterialOptions,
  SSS_VERT,
  SSS_FRAG,
} from './SubsurfaceScatteringMaterial';
// 高级 PBR 材质(各向异性 + 虹彩 + 透明涂层 + 光泽 + 自发光)。
// 在 PhysicalMaterial 之上扩展:完整 GLSL shader + CPU BRDF 参考实现,
// 直接被 renderer 使用(PhysicalMaterial 的 clearcoat/sheen 为 advisory)。
export {
  AdvancedPBRMaterial,
  type AdvancedPBRMaterialOptions,
  type AdvancedPBRQuality,
  type AlphaMode,
  type AnisotropicBRDFInput,
  type AnisotropicBRDFOutput,
  type IridescenceInput,
  type IridescenceOutput,
  type ClearcoatInput,
  type ClearcoatOutput,
  type SheenInput,
  type SheenOutput,
  ADV_PBR_VERT,
  ADV_PBR_FRAG,
} from './AdvancedPBRMaterial';
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
// 着色器模板库(预定义 15 个完整着色器:unlit/pbr/toon/skybox/water/fur 等)。
export {
  ShaderLibrary,
  shaderLibrary,
  BUILTIN_SHADER_NAMES,
  type ShaderTemplate,
  type ShaderTemplateOverride,
  type UniformDeclaration,
  type AttributeDeclaration,
  type UniformType,
  type AttributeType,
  type ShaderTag,
} from './ShaderLibrary';
// 着色器编译器(预处理 #include + chunk 注入 + 编译 + 缓存)。
export {
  ShaderCompiler,
  shaderCompiler,
  type CompileStatus,
} from './ShaderCompiler';
// 着色器变体系统(关键字组合 + 变体缓存 + LRU 驱逐)。
export {
  ShaderVariant,
  type ShaderKeyword,
  type ShaderVariantEntry,
  type ShaderVariantCacheStats,
  type ShaderVariantOptions,
  type ShaderVariantCompiler,
  type VariantQuery,
} from './ShaderVariant';

