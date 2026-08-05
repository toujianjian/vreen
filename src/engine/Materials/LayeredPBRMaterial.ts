// LayeredPBRMaterial — 层叠 PBR 材质(多层 PBR 通过遮罩混合)。
//
// 设计目标:
//   - 允许在单一 mesh 上叠加多层 PBR 材质,每层有独立的 albedo / metallic /
//     roughness / normal / emissive / AO / 高度,以及一个遮罩(mask)控制
//     该层在表面各处的混合权重。
//   - 典型用途:
//       * 车漆:金属底材 + 油漆 + 划痕 + 锈迹 + 污渍
//       * 地形:岩石 + 草地 + 泥土 + 雪
//       * 角色:皮肤 + 污渍 + 血迹 + 服装磨损
//       * 武器:金属 + 涂装 + 磨损 + 锈迹
//   - 适配自 o3de 的 Material Layering 系统(每层独立 UV 集合、遮罩、混合模式)。
//
// 算法(逐像素自底向上累积):
//   layers[0] = base 层(必有,mask 无效,权重恒为 1)
//   for i in 1..N-1:
//     w_i = sampleMask(layer_i, uv) * layer_i.opacity * layer_i.maskStrength
//     if blendMode == 'normal':
//       result.albedo     = lerp(result.albedo,     layer_i.albedo,     w_i)
//       result.metallic   = lerp(result.metallic,   layer_i.metallic,   w_i)
//       result.roughness  = lerp(result.roughness,  layer_i.roughness,  w_i)
//       result.normal     = lerp(result.normal,     layer_i.normal,     w_i) // 归一化后
//       result.emissive   = result.emissive + layer_i.emissive * w_i   // emissive 累加
//     elif blendMode == 'add':
//       result.albedo += layer_i.albedo * w_i
//       ...
//     elif blendMode == 'multiply':
//       result.albedo *= (1 - w_i) + layer_i.albedo * w_i
//       ...
//     elif blendMode == 'overlay':
//       result.albedo = overlay(result.albedo, layer_i.albedo, w_i)
//       ...
//
// 不变量:
//   - 必须有至少 1 层(base 层)
//   - 总层数 <= MAX_LAYERS(8)
//   - 每层 mask 为 Float32Array(0..1,可空表示全 1)
//   - mask 的 UV 与纹理 UV 一致,但可独立缩放/偏移
//   - 法线混合后必须重新归一化
//   - emissive 是加性的,不受 base 层遮罩影响
//   - 层叠评估顺序:从 base(底层)到顶层,顶层覆盖底层
//
// 参考:
//   - o3de Atom "Material Layering" 文档与 MaterialLayer lua API
//   - UE5 "Material Layer Blending"
//   - Substance Painter "Layer Stack"
//   - Burley 2012 "Physically Based Shading at Disney"
//   - Karis 2013 "Real Shading in Unreal Engine 4" — PBR layer blending

import { type RGB } from '../Core/Material';

/** 单层材质的混合模式。 */
export type LayerBlendMode = 'normal' | 'add' | 'multiply' | 'overlay';

/** 单层 PBR 材质属性 + 遮罩。 */
export interface MaterialLayer {
  /** 层名称(便于调试)。 */
  name: string;
  /** 是否启用。 */
  enabled: boolean;
  /** 基础颜色(线性 0..1)。 */
  baseColor: RGB;
  /** 金属度 [0,1]。 */
  metallic: number;
  /** 粗糙度 [0,1]。 */
  roughness: number;
  /** 切线空间法线(0..1,127..255 映射到 -1..1)。null 表示沿用 base 层法线。 */
  normal: RGB | null;
  /** 自发光颜色(线性 0..1)。 */
  emissive: RGB;
  /** 自发光强度(>=0)。 */
  emissiveIntensity: number;
  /** 环境光遮蔽强度 [0,1](1 = 无 AO,0 = 完全遮蔽)。 */
  ao: number;
  /** 高度(用于视差偏移,>=0)。 */
  height: number;
  /** 遮罩纹理(灰度 0..1,长度 = maskWidth × maskHeight)。null = 全 1(完全覆盖)。 */
  mask: Float32Array | null;
  /** 遮罩宽度(像素)。mask 为 null 时忽略。 */
  maskWidth: number;
  /** 遮罩高度(像素)。mask 为 null 时忽略。 */
  maskHeight: number;
  /** 遮罩 UV 缩放(每轴,1 = 与纹理 UV 一致)。 */
  maskUVScale: { u: number; v: number };
  /** 遮罩 UV 偏移(每轴,0..1)。 */
  maskUVOffset: { u: number; v: number };
  /** 全局层不透明度 [0,1]。 */
  opacity: number;
  /** 遮罩强度倍率 [0,1]。 */
  maskStrength: number;
  /** 混合模式。 */
  blendMode: LayerBlendMode;
  /** 法线混合强度 [0,1](0 = 不混合法线,1 = 完全使用本层法线)。 */
  normalBlend: number;
}

/** 层叠材质评估结果。 */
export interface LayeredMaterialEval {
  /** 混合后的基础颜色。 */
  baseColor: RGB;
  /** 混合后的金属度。 */
  metallic: number;
  /** 混合后的粗糙度。 */
  roughness: number;
  /** 混合后的法线(切线空间,0..1)。 */
  normal: RGB;
  /** 混合后的自发光。 */
  emissive: RGB;
  /** 混合后的自发光强度。 */
  emissiveIntensity: number;
  /** 混合后的 AO。 */
  ao: number;
  /** 混合后的高度。 */
  height: number;
  /** 每层实际贡献权重(诊断用)。 */
  layerWeights: number[];
}

/** 层数上限。 */
export const MAX_LAYERS = 8;

/** 默认 base 层。 */
export function createDefaultBaseLayer(name: string = 'base'): MaterialLayer {
  return {
    name,
    enabled: true,
    baseColor: { r: 0.5, g: 0.5, b: 0.5 },
    metallic: 0.0,
    roughness: 0.5,
    normal: null,
    emissive: { r: 0, g: 0, b: 0 },
    emissiveIntensity: 0,
    ao: 1.0,
    height: 0,
    mask: null,
    maskWidth: 0,
    maskHeight: 0,
    maskUVScale: { u: 1, v: 1 },
    maskUVOffset: { u: 0, v: 0 },
    opacity: 1.0,
    maskStrength: 1.0,
    blendMode: 'normal',
    normalBlend: 1.0,
  };
}

/** 线性插值。 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** RGB 线性插值。 */
export function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

/** RGB 加法。 */
export function addRGB(a: RGB, b: RGB): RGB {
  return { r: a.r + b.r, g: a.g + b.g, b: a.b + b.b };
}

/** RGB 乘法。 */
export function multiplyRGB(a: RGB, b: RGB): RGB {
  return { r: a.r * b.r, g: a.g * b.g, b: a.b * b.b };
}

/** RGB 缩放。 */
export function scaleRGB(a: RGB, s: number): RGB {
  return { r: a.r * s, g: a.g * s, b: a.b * s };
}

/** Overlay 混合(Photoshop 风格)。 */
export function overlayRGB(base: RGB, layer: RGB, t: number): RGB {
  const overlayChannel = (b: number, l: number): number => {
    if (b < 0.5) {
      return 2 * b * l;
    }
    return 1 - 2 * (1 - b) * (1 - l);
  };
  const result: RGB = {
    r: overlayChannel(base.r, layer.r),
    g: overlayChannel(base.g, layer.g),
    b: overlayChannel(base.b, layer.b),
  };
  return lerpRGB(base, result, t);
}

/** 归一化 RGB 法线(0..1 → -1..1 → 归一化 → 0..1)。 */
export function normalizeNormalRGB(n: RGB): RGB {
  const x = n.r * 2 - 1;
  const y = n.g * 2 - 1;
  const z = n.b * 2 - 1;
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-6) {
    return { r: 0.5, g: 0.5, b: 1.0 }; // 默认朝 +Z
  }
  const inv = 1 / len;
  return {
    r: x * inv * 0.5 + 0.5,
    g: y * inv * 0.5 + 0.5,
    b: z * inv * 0.5 + 0.5,
  };
}

/** 在 mask 上双线性采样。 */
export function sampleMaskBilinear(
  mask: Float32Array | null,
  width: number,
  height: number,
  u: number,
  v: number,
): number {
  if (!mask || width <= 0 || height <= 0) return 1.0;
  // Wrap UV(repeat)
  let uu = u - Math.floor(u);
  let vv = v - Math.floor(v);
  const fx = uu * width - 0.5;
  const fy = vv * height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const wrapX = (i: number): number => ((i % width) + width) % width;
  const wrapY = (i: number): number => ((i % height) + height) % height;
  const idx = (x: number, y: number): number => wrapY(y) * width + wrapX(x);
  const v00 = mask[idx(x0, y0)] ?? 0;
  const v10 = mask[idx(x0 + 1, y0)] ?? 0;
  const v01 = mask[idx(x0, y0 + 1)] ?? 0;
  const v11 = mask[idx(x0 + 1, y0 + 1)] ?? 0;
  const top = v00 + (v10 - v00) * tx;
  const bottom = v01 + (v11 - v01) * tx;
  return top + (bottom - top) * ty;
}

/** 层叠 PBR 材质类。 */
export class LayeredPBRMaterial {
  /** 材质层列表(从底到顶)。 */
  layers: MaterialLayer[] = [];
  /** 顶点颜色作为遮罩的强度 [0,1](0 = 不使用顶点色,1 = 完全使用)。 */
  vertexColorMaskStrength: number = 0;
  /** 整体材质不透明度。 */
  opacity: number = 1.0;
  /** Alpha 模式。 */
  alphaMode: 'opaque' | 'mask' | 'blend' = 'opaque';
  /** Alpha 截断。 */
  alphaCutoff: number = 0.5;
  /** 双面渲染。 */
  doubleSided: boolean = false;
  /** 是否启用线框。 */
  wireframe: boolean = false;

  constructor(baseLayer: MaterialLayer = createDefaultBaseLayer()) {
    this.layers = [baseLayer];
  }

  /** 添加一个材质层。返回层索引,或 -1 表示达到上限。 */
  addLayer(layer: MaterialLayer): number {
    if (this.layers.length >= MAX_LAYERS) return -1;
    this.layers.push(layer);
    return this.layers.length - 1;
  }

  /** 移除指定层(不能移除 base 层,索引 0)。 */
  removeLayer(index: number): boolean {
    if (index <= 0 || index >= this.layers.length) return false;
    this.layers.splice(index, 1);
    return true;
  }

  /** 获取层数。 */
  getLayerCount(): number {
    return this.layers.length;
  }

  /** 获取指定层。 */
  getLayer(index: number): MaterialLayer | null {
    if (index < 0 || index >= this.layers.length) return null;
    return this.layers[index];
  }

  /** 设置指定层。 */
  setLayer(index: number, layer: MaterialLayer): boolean {
    if (index < 0 || index >= this.layers.length) return false;
    this.layers[index] = layer;
    return true;
  }

  /** 交换两层顺序。 */
  swapLayers(i: number, j: number): boolean {
    if (i <= 0 || j <= 0 || i >= this.layers.length || j >= this.layers.length) return false;
    if (i === j) return true;
    const tmp = this.layers[i];
    this.layers[i] = this.layers[j];
    this.layers[j] = tmp;
    return true;
  }

  /**
   * 在指定 UV + 可选顶点颜色处评估层叠材质。
   *
   * @param uv       表面 UV 坐标(0..1)
   * @param vertColor 顶点颜色(可选,作为额外遮罩)
   * @returns         混合后的材质属性
   */
  evaluate(
    uv: { u: number; v: number },
    vertColor: { r: number; g: number; b: number; a: number } | null = null,
  ): LayeredMaterialEval {
    const layerWeights: number[] = new Array(this.layers.length).fill(0);

    // 从 base 层开始
    const base = this.layers[0];
    let baseColor: RGB = { ...base.baseColor };
    let metallic = base.metallic;
    let roughness = base.roughness;
    let normal: RGB = base.normal ? { ...base.normal } : { r: 0.5, g: 0.5, b: 1.0 };
    let emissive: RGB = scaleRGB(base.emissive, base.emissiveIntensity);
    let ao = base.ao;
    let height = base.height;
    layerWeights[0] = 1.0;

    // 自底向上叠加
    for (let i = 1; i < this.layers.length; i++) {
      const layer = this.layers[i];
      if (!layer.enabled) {
        layerWeights[i] = 0;
        continue;
      }

      // 采样遮罩
      const maskU = uv.u * layer.maskUVScale.u + layer.maskUVOffset.u;
      const maskV = uv.v * layer.maskUVScale.v + layer.maskUVOffset.v;
      let maskVal = sampleMaskBilinear(layer.mask, layer.maskWidth, layer.maskHeight, maskU, maskV);

      // 顶点颜色遮罩调制
      if (vertColor && this.vertexColorMaskStrength > 0) {
        const vertMask = vertColor.a; // 使用 alpha 通道作为遮罩
        maskVal = maskVal * (1 - this.vertexColorMaskStrength) + vertMask * this.vertexColorMaskStrength;
      }

      // 计算最终权重
      const w = maskVal * layer.opacity * layer.maskStrength;
      layerWeights[i] = w;
      if (w < 1e-6) continue;

      // 按混合模式应用
      switch (layer.blendMode) {
        case 'normal': {
          baseColor = lerpRGB(baseColor, layer.baseColor, w);
          metallic = lerp(metallic, layer.metallic, w);
          roughness = lerp(roughness, layer.roughness, w);
          if (layer.normal) {
            const nb = layer.normalBlend;
            normal = lerpRGB(normal, layer.normal, w * nb);
            normal = normalizeNormalRGB(normal);
          }
          // emissive 累加(不受 base 遮罩影响)
          emissive = addRGB(emissive, scaleRGB(layer.emissive, layer.emissiveIntensity * w));
          ao = lerp(ao, layer.ao, w);
          height = lerp(height, layer.height, w);
          break;
        }
        case 'add': {
          baseColor = addRGB(baseColor, scaleRGB(layer.baseColor, w));
          metallic = Math.min(1, metallic + layer.metallic * w);
          roughness = Math.max(0, roughness - layer.roughness * w * 0.5);
          if (layer.normal) {
            normal = lerpRGB(normal, layer.normal, w * layer.normalBlend);
            normal = normalizeNormalRGB(normal);
          }
          emissive = addRGB(emissive, scaleRGB(layer.emissive, layer.emissiveIntensity * w));
          ao = Math.max(0, ao - (1 - layer.ao) * w);
          height += layer.height * w;
          break;
        }
        case 'multiply': {
          const k = 1 - w;
          baseColor = {
            r: baseColor.r * (k + layer.baseColor.r * w),
            g: baseColor.g * (k + layer.baseColor.g * w),
            b: baseColor.b * (k + layer.baseColor.b * w),
          };
          metallic = metallic * (k + layer.metallic * w);
          roughness = roughness * (k + layer.roughness * w);
          if (layer.normal) {
            normal = lerpRGB(normal, layer.normal, w * layer.normalBlend);
            normal = normalizeNormalRGB(normal);
          }
          emissive = addRGB(emissive, scaleRGB(layer.emissive, layer.emissiveIntensity * w));
          ao = ao * (k + layer.ao * w);
          height = height * (k + layer.height * w);
          break;
        }
        case 'overlay': {
          baseColor = overlayRGB(baseColor, layer.baseColor, w);
          metallic = lerp(metallic, layer.metallic, w);
          roughness = lerp(roughness, layer.roughness, w);
          if (layer.normal) {
            normal = lerpRGB(normal, layer.normal, w * layer.normalBlend);
            normal = normalizeNormalRGB(normal);
          }
          emissive = addRGB(emissive, scaleRGB(layer.emissive, layer.emissiveIntensity * w));
          ao = lerp(ao, layer.ao, w);
          height = lerp(height, layer.height, w);
          break;
        }
      }
    }

    return {
      baseColor,
      metallic,
      roughness,
      normal,
      emissive,
      emissiveIntensity: 1.0,
      ao,
      height,
      layerWeights,
    };
  }

  /** 创建一个简单的遮罩(全 1)。 */
  static createFullMask(width: number, height: number, value: number = 1): Float32Array {
    const mask = new Float32Array(width * height);
    mask.fill(value);
    return mask;
  }

  /** 创建一个圆形遮罩(中心 1,边缘 0)。 */
  static createRadialMask(
    width: number,
    height: number,
    centerX: number = 0.5,
    centerY: number = 0.5,
    radius: number = 0.5,
  ): Float32Array {
    const mask = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const u = x / (width - 1);
        const v = y / (height - 1);
        const dx = u - centerX;
        const dy = v - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        mask[y * width + x] = Math.max(0, 1 - dist / radius);
      }
    }
    return mask;
  }

  /** 创建一个噪声遮罩(用于污渍/锈迹)。 */
  static createNoiseMask(
    width: number,
    height: number,
    seed: number = 0,
    threshold: number = 0.5,
  ): Float32Array {
    const mask = new Float32Array(width * height);
    // 简单哈希噪声(无需依赖外部库)
    let s = seed | 0;
    const rand = (): number => {
      s = (s * 1664525 + 1013904223) | 0;
      return ((s >>> 0) & 0xffffff) / 0xffffff;
    };
    for (let i = 0; i < mask.length; i++) {
      mask[i] = rand() > threshold ? 1 : 0;
    }
    return mask;
  }
}

// ── GLSL 着色器块 ────────────────────────────────────────────────

/** LayeredPBRMaterial 评估的 GLSL chunk。 */
export const LAYERED_PBR_GLSL = `
// LayeredPBRMaterial evaluation — 多层 PBR 遮罩混合。
// 由 vertex shader 传入 v_uv,由 CPU 上传 u_layerCount + u_layers[] uniform 数组。

#define MAX_LAYERS 8

struct MaterialLayer {
  vec3 baseColor;
  float metallic;
  float roughness;
  vec3 normal;     // tangent space, 0..1
  vec3 emissive;
  float emissiveIntensity;
  float ao;
  float height;
  float opacity;
  float maskStrength;
  float normalBlend;
  int blendMode;   // 0=normal, 1=add, 2=multiply, 3=overlay
  int hasMask;
  sampler2D mask;
  vec2 maskUVScale;
  vec2 maskUVOffset;
};

uniform int u_layerCount;
uniform MaterialLayer u_layers[MAX_LAYERS];
uniform float u_vertexColorMaskStrength;

// 在 mask 上双线性采样(WRAP)
float sampleLayerMask(sampler2D mask, vec2 uv) {
  return texture(mask, uv).r;
}

// 归一化切线空间法线(0..1 → -1..1 → 归一化 → 0..1)
vec3 normalizeTangentNormal(vec3 n01) {
  vec3 n = n01 * 2.0 - 1.0;
  return normalize(n) * 0.5 + 0.5;
}

// Overlay 混合
vec3 overlayBlend(vec3 base, vec3 layer) {
  vec3 result;
  result.r = base.r < 0.5 ? 2.0 * base.r * layer.r : 1.0 - 2.0 * (1.0 - base.r) * (1.0 - layer.r);
  result.g = base.g < 0.5 ? 2.0 * base.g * layer.g : 1.0 - 2.0 * (1.0 - base.g) * (1.0 - layer.g);
  result.b = base.b < 0.5 ? 2.0 * base.b * layer.b : 1.0 - 2.0 * (1.0 - base.b) * (1.0 - layer.b);
  return result;
}

// 评估层叠材质(返回混合后的 PBR 属性)
struct LayeredEval {
  vec3 baseColor;
  float metallic;
  float roughness;
  vec3 normal;
  vec3 emissive;
  float ao;
  float height;
};

LayeredEval evaluateLayeredMaterial(vec2 uv, vec4 vertColor) {
  LayeredEval result;
  // base layer (index 0)
  MaterialLayer base = u_layers[0];
  result.baseColor = base.baseColor;
  result.metallic = base.metallic;
  result.roughness = base.roughness;
  result.normal = base.normal;
  result.emissive = base.emissive * base.emissiveIntensity;
  result.ao = base.ao;
  result.height = base.height;

  for (int i = 1; i < MAX_LAYERS; i++) {
    if (i >= u_layerCount) break;
    MaterialLayer layer = u_layers[i];
    if (layer.opacity < 0.001) continue;

    // 采样遮罩
    vec2 maskUV = uv * layer.maskUVScale + layer.maskUVOffset;
    float maskVal = 1.0;
    if (layer.hasMask == 1) {
      maskVal = sampleLayerMask(layer.mask, maskUV);
    }

    // 顶点颜色调制
    if (u_vertexColorMaskStrength > 0.0) {
      maskVal = mix(maskVal, vertColor.a, u_vertexColorMaskStrength);
    }

    float w = maskVal * layer.opacity * layer.maskStrength;
    if (w < 0.001) continue;

    if (layer.blendMode == 0) {
      // normal
      result.baseColor = mix(result.baseColor, layer.baseColor, w);
      result.metallic = mix(result.metallic, layer.metallic, w);
      result.roughness = mix(result.roughness, layer.roughness, w);
      result.normal = normalizeTangentNormal(mix(result.normal, layer.normal, w * layer.normalBlend));
      result.emissive += layer.emissive * layer.emissiveIntensity * w;
      result.ao = mix(result.ao, layer.ao, w);
      result.height = mix(result.height, layer.height, w);
    } else if (layer.blendMode == 1) {
      // add
      result.baseColor += layer.baseColor * w;
      result.metallic = min(1.0, result.metallic + layer.metallic * w);
      result.roughness = max(0.0, result.roughness - layer.roughness * w * 0.5);
      result.normal = normalizeTangentNormal(mix(result.normal, layer.normal, w * layer.normalBlend));
      result.emissive += layer.emissive * layer.emissiveIntensity * w;
      result.ao = max(0.0, result.ao - (1.0 - layer.ao) * w);
      result.height += layer.height * w;
    } else if (layer.blendMode == 2) {
      // multiply
      float k = 1.0 - w;
      result.baseColor *= (k + layer.baseColor * w);
      result.metallic *= (k + layer.metallic * w);
      result.roughness *= (k + layer.roughness * w);
      result.normal = normalizeTangentNormal(mix(result.normal, layer.normal, w * layer.normalBlend));
      result.emissive += layer.emissive * layer.emissiveIntensity * w;
      result.ao *= (k + layer.ao * w);
      result.height *= (k + layer.height * w);
    } else if (layer.blendMode == 3) {
      // overlay
      result.baseColor = mix(result.baseColor, overlayBlend(result.baseColor, layer.baseColor), w);
      result.metallic = mix(result.metallic, layer.metallic, w);
      result.roughness = mix(result.roughness, layer.roughness, w);
      result.normal = normalizeTangentNormal(mix(result.normal, layer.normal, w * layer.normalBlend));
      result.emissive += layer.emissive * layer.emissiveIntensity * w;
      result.ao = mix(result.ao, layer.ao, w);
      result.height = mix(result.height, layer.height, w);
    }
  }

  return result;
}
`;

/** LayeredPBRMaterial 顶点着色器 GLSL chunk。 */
export const LAYERED_PBR_VERTEX_GLSL = `
// LayeredPBRMaterial vertex shader
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_tangent;  // optional
layout(location = 4) in vec4 a_vertColor; // optional, for vertex color mask

uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;

out vec2 v_uv;
out vec4 v_vertColor;
out vec3 v_worldNormal;

void main() {
  v_uv = a_uv;
  v_vertColor = a_vertColor;
  v_worldNormal = normalize(mat3(u_model) * a_normal);
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

/** LayeredPBRMaterial 片元着色器 GLSL chunk(配合 LAYERED_PBR_GLSL 使用)。 */
export const LAYERED_PBR_FRAGMENT_GLSL = `
// LayeredPBRMaterial fragment shader (uses LAYERED_PBR_GLSL)
in vec2 v_uv;
in vec4 v_vertColor;
in vec3 v_worldNormal;

layout(location = 0) out vec4 fragColor;

uniform vec3 u_lightDir;       // directional light direction
uniform vec3 u_lightColor;
uniform vec3 u_ambientColor;
uniform sampler2D u_brdfLUT;   // IBL BRDF integration LUT
uniform samplerCube u_irradianceMap;
uniform samplerCube u_prefilteredEnv;

void main() {
  LayeredEval mat = evaluateLayeredMaterial(v_uv, v_vertColor);

  // 切线空间法线 → 世界空间(简化:假设 worldNormal 是几何法线)
  vec3 N = normalize(v_worldNormal);
  vec3 tangentNormal = mat.normal * 2.0 - 1.0;
  // 完整实现需要 TBN 矩阵,这里简化
  // vec3 worldNormal = normalize(TBN * tangentNormal);

  vec3 V = normalize(-vec3(0.0, 0.0, 1.0)); // 简化视线方向
  float NdotV = max(dot(N, V), 0.0);

  // 简化 PBR 计算
  vec3 F0 = mix(vec3(0.04), mat.baseColor, mat.metallic);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);

  // Diffuse
  vec3 kd = (1.0 - F) * (1.0 - mat.metallic);
  vec3 diffuse = mat.baseColor * u_ambientColor * kd;

  // Specular(简化)
  vec3 specular = F * u_lightColor * mat.ao;

  vec3 color = diffuse + specular + mat.emissive;

  // Tonemap + gamma
  color = color / (color + 1.0);
  color = pow(color, vec3(1.0 / 2.2));

  fragColor = vec4(color, 1.0);
}
`;
