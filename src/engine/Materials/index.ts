// Materials barrel.

export { StandardMaterial, STANDARD_VERTEX_SRC, STANDARD_FRAGMENT_SRC } from './StandardMaterial';
export { PhysicalMaterial, type PhysicalMaterialOptions } from './MeshPhysicalMaterial';
export { MeshBasicMaterial, type MeshBasicMaterialOptions } from './MeshBasicMaterial';
export { PhongMaterial, type PhongMaterialOptions } from './MeshPhongMaterial';
export { NormalMaterial, type NormalMaterialOptions } from './MeshNormalMaterial';
export { ShadowMaterial, type ShadowMaterialOptions, SHADOW_MATERIAL_VERT, SHADOW_MATERIAL_FRAG } from './ShadowMaterial';
export { SpriteMaterial, type SpriteMaterialOptions } from './SpriteMaterial';
// 点云材质 (GL_POINTS 点精灵),适配 three.js PointsMaterial。
export { PointsMaterial, type PointsMaterialOptions } from './PointsMaterial';
// 线段材质 (GL_LINES / GL_LINE_STRIP / GL_LINE_LOOP),适配 three.js LineBasicMaterial。
export { LineBasicMaterial, type LineBasicMaterialOptions } from './LineBasicMaterial';
// 粗线材质 (屏幕空间四边形扩展),适配 three.js examples/jsm/lines/LineMaterial。
// 配合 LineSegments2 / Line2 使用,突破 gl.lineWidth=1 限制,支持虚线/逐顶点颜色/worldUnits。
export {
  LineMaterial,
  type LineMaterialOptions,
  type LineMaterialUniforms,
  LINE_MATERIAL_VERT,
  LINE_MATERIAL_FRAG,
} from './LineMaterial';
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
// Marschner 物理毛发材质(R/TT/TRT 三叶 BCSDF + Fresnel + Beer-Lambert 吸收)。
// 适配 Marschner 2003 / d'Eon 2011 / UE5 Strand-based Hair / Unity HDRP Hair。
export {
  HairMarschnerMaterial,
  type HairMarschnerMaterialOptions,
  HAIR_MARSCHNER_VERT,
  HAIR_MARSCHNER_FRAG,
  HAIR_ETA_DEFAULT,
  HAIR_PIGMENTS,
  hairFresnelDielectric,
  hairRefractCosTheta,
  hairAbsorption,
  hairPathLength,
  hairLongitudinalM,
  computeHairBSDF,
  type HairBSDFInput,
} from './HairMarschnerMaterial';
// 次表面散射材质(皮肤/蜡/玉石/牛奶等)。
export {
  SubsurfaceScatteringMaterial,
  type SubsurfaceScatteringMaterialOptions,
  SSS_VERT,
  SSS_FRAG,
} from './SubsurfaceScatteringMaterial';
// Pre-Integrated Skin 材质(d'Eon 2007,GPU Gems 3 Ch. 14)。
// 把 BSSRDF 卷积预算成 DiffuseLUT + TransmittanceLUT,运行时 O(1) 采样,
// 适合大面积皮肤的柔和阴影终止线 + 红色透射。与 SSSMaterial 互补:
// PreIntegratedSkin 适合脸颊/前额,SSSMaterial 适合耳廓/鼻翼薄壁透射。
export {
  PreIntegratedSkinMaterial,
  type PreIntegratedSkinMaterialOptions,
  PRE_INTEGRATED_SKIN_VERT,
  PRE_INTEGRATED_SKIN_FRAG,
} from './PreIntegratedSkinMaterial';
export {
  DiffuseLUT,
  TransmittanceLUT,
  SKIN_PROFILE,
  type DiffuseProfile,
} from './PreIntegratedSkinLUT';
// 平面镜面反射材质(与 Renderer/Reflector.ts CPU 数学库配套)。
// 适配 three.js Reflector.js shader 部分,扩展色调/菲涅尔/基础色。
// Reflector.computeTextureMatrix() → textureMatrix;Reflector 渲染输出 → reflectionTexture。
export {
  ReflectorMaterial,
  type ReflectorMaterialOptions,
  REFLECTOR_VERT,
  REFLECTOR_FRAG,
} from './ReflectorMaterial';
// 平面折射材质(与 Renderer/Refractor.ts CPU 数学库配套)。
// 适配 three.js Refractor.js shader 部分,扩展色散/菲涅尔反射混合/色调/折射强度。
// GLSL refract() 实时计算折射 UV 位移;色散模式 R/G/B 三通道不同 eta。
export {
  RefractorMaterial,
  type RefractorMaterialOptions,
  REFRACTOR_VERT,
  REFRACTOR_FRAG,
} from './RefractorMaterial';
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
// 节点式程序化材质图(可视化编辑器核心 + GLSL 编译器)。
// 参考 o3de MaterialGraph / Unreal Material Editor / Unity ShaderGraph。
// 用户连接节点(Input / Math / Texture / Color / Output),编译器把图
// 编译成 GLSL(顶点 + 片段),最终包装成 ShaderMaterial 供 renderer 使用。
// 完全无 WebGL 依赖(纯数据 + 字符串生成),可在 Node/无头环境运行。
export {
  MaterialGraph,
  type SocketType,
  type SocketDirection,
  type Socket,
  type NodeKind,
  type MaterialNode,
  type MaterialEdge,
  type CompileResult,
  createTexturedPBRGraph,
  createFresnelGraph,
  createNoiseGraph,
} from './MaterialGraph';
// 高光抗锯齿(Specular AA)— 消除法线贴图高频细节在屏幕空间欠采样导致的高光锯齿。
// 实现 Toksvig 2005 / LEAN Mapping (Olano & Baker 2010) / CLEAN / GSAA 四种技术。
// 纯函数,不依赖 WebGL,可在 Node/无头环境测试。与 GLSL `SPECULAR_AA_FRAG` chunk 1:1。
// 参考 UE5 MaterialSpecularAA / o3de Atom SpecularAA。
export {
  toksvigRoughness,
  toksvigVariance,
  leanMappingVariance,
  leanRoughness,
  leanAnisoAngle,
  cleanVariance,
  cleanRoughness,
  gsaaVariance,
  gsaaRoughness,
  computeNormalVariance,
  varianceToRoughness,
  filteredNormalLength,
  generateLEANMap,
  generateCLEANMap,
  sampleLEANMap,
  type LEANMoments,
  type GSAAVertex,
  type LEANMapData,
} from './SpecularAA';

