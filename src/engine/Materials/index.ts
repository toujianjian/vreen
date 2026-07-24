// Materials barrel.

export { StandardMaterial, STANDARD_VERTEX_SRC, STANDARD_FRAGMENT_SRC } from './StandardMaterial';
export { PhysicalMaterial, type PhysicalMaterialOptions } from './MeshPhysicalMaterial';
export { MeshBasicMaterial, type MeshBasicMaterialOptions } from './MeshBasicMaterial';
export { PhongMaterial, type PhongMaterialOptions } from './MeshPhongMaterial';
export { NormalMaterial, type NormalMaterialOptions } from './MeshNormalMaterial';
export { ShadowMaterial, type ShadowMaterialOptions, SHADOW_MATERIAL_VERT, SHADOW_MATERIAL_FRAG } from './ShadowMaterial';
export {
  PBR_VERT,
  PBR_FRAG,
  SHADOW_VERT,
  SHADOW_FRAG,
  SHADOW_DEPTH_VERT,
  SHADOW_DEPTH_FRAG,
  PCF_SHADOW_FRAG,
} from './shaders';

