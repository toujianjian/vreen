// PhysicalMaterial — 在 StandardMaterial 基础上扩展的物理材质。
//
// 参考 three.js MeshPhysicalMaterial。增加清漆层(clearcoat)、光泽
// (sheen)、透射(transmission)、折射(ior)、体积衰减等高级 PBR 属性。
//
// 这些属性目前为"咨询性"(advisory)——材质持有数据,renderer 的 shader
// 集成在后续步骤完成(与 StandardMaterial 的 map 字段策略一致)。
// 通过 onBeforeCompile 可注入对应 GLSL chunk(参考 three.js)。

import { StandardMaterial } from './StandardMaterial';
import type { RGB } from '../Core/Material';

export interface PhysicalMaterialOptions {
  clearcoat?: number;
  clearcoatRoughness?: number;
  sheen?: number;
  sheenColor?: RGB;
  sheenRoughness?: number;
  transmission?: number;
  thickness?: number;
  ior?: number;
  attenuationColor?: RGB;
  attenuationDistance?: number;
  specularIntensity?: number;
  specularColor?: RGB;
}

export class PhysicalMaterial extends StandardMaterial {
  override readonly type: string = 'Physical';
  override programKey: string = 'physical';

  /** 清漆层强度 0..1。0 = 无清漆(车漆/碳纤维/湿润表面)。 */
  clearcoat: number = 0;
  /** 清漆层粗糙度 0..1。 */
  clearcoatRoughness: number = 0;
  /** 光泽层强度 0..1(布料/织物)。 */
  sheen: number = 0;
  /** 光泽颜色。默认黑(无光泽)。 */
  sheenColor: RGB = { r: 0, g: 0, b: 0 };
  /** 光泽层粗糙度 0..1。 */
  sheenRoughness: number = 1;
  /** 透射度(光学透明)0..1。用于玻璃等薄透明表面。 */
  transmission: number = 0;
  /** 体积厚度(世界空间)。0 = 薄壁。 */
  thickness: number = 0;
  /** 折射率 1.0..2.33。默认 1.5(玻璃)。 */
  ior: number = 1.5;
  /** 衰减颜色(白光被吸收后变成的颜色)。默认白。 */
  attenuationColor: RGB = { r: 1, g: 1, b: 1 };
  /** 衰减距离(世界空间单位)。默认 Infinity(无吸收)。 */
  attenuationDistance: number = Infinity;
  /** 非金属镜面反射强度缩放 0..1。 */
  specularIntensity: number = 1;
  /** 非金属镜面反射颜色色调。默认白。 */
  specularColor: RGB = { r: 1, g: 1, b: 1 };

  constructor(opts: PhysicalMaterialOptions = {}) {
    super();
    if (opts.clearcoat !== undefined) this.clearcoat = opts.clearcoat;
    if (opts.clearcoatRoughness !== undefined) this.clearcoatRoughness = opts.clearcoatRoughness;
    if (opts.sheen !== undefined) this.sheen = opts.sheen;
    if (opts.sheenColor) this.sheenColor = { ...opts.sheenColor };
    if (opts.sheenRoughness !== undefined) this.sheenRoughness = opts.sheenRoughness;
    if (opts.transmission !== undefined) this.transmission = opts.transmission;
    if (opts.thickness !== undefined) this.thickness = opts.thickness;
    if (opts.ior !== undefined) this.ior = opts.ior;
    if (opts.attenuationColor) this.attenuationColor = { ...opts.attenuationColor };
    if (opts.attenuationDistance !== undefined) this.attenuationDistance = opts.attenuationDistance;
    if (opts.specularIntensity !== undefined) this.specularIntensity = opts.specularIntensity;
    if (opts.specularColor) this.specularColor = { ...opts.specularColor };
  }
}
