// VolumetricClouds — 体积云渲染系统(噪声生成 + 光线步进 + 照明)。
//
// 设计:
//   * 与 ProceduralSky / WeatherSystem / CloudSystem 互补:
//       - ProceduralSky 提供大气散射 + 简单云量(uniform)
//       - WeatherSystem 提供天气参数 + 雷电
//       - CloudSystem 用粒子化云团近似(轻量、低成本)
//       - VolumetricClouds 用光线步进 + 3D 噪声做高质量体积云,面向"写实感云"
//   * 纯数据 + 计算层,不持有 GL 资源(与 ProceduralSky / WeatherSystem 一致)。
//     通过 getShaderUniforms() / getCloudData() 暴露给 renderer / shader 消费,
//     由调用方在合适的 pass 中绑定 3D 噪声纹理并执行 ray-march。
//   * 噪声:Perlin (FBM) + Worley 混合,存为 Float32Array(noiseResolution^3)。
//     Perlin 提供基础密度场,Worley 减法形成"云洞 + 边缘羽化"。
//   * 照明(v2 升级,对标 UE5/Horizon Zero Dawn):
//       - Beer-Lambert 透射率 + Beer-Powder 粉末效应(Bouthors 2008)
//       - 双叶 Henyey-Greenstein 相位函数(前向 g1 + 后向 g2,银边效应)
//       - 多散射近似(Wenzel 2019 能量重分布,避免云体过暗)
//       - 高度密度调制(底部浓密、顶部羽化)
//       - 锥形阴影采样(可选,coneRadius > 0 时启用)
//   * 云类型预设:Cumulus / Stratus / Cirrus / Cumulonimbus,一键切换参数组合。
//   * 风偏移:update(dt) 推进 windOffset,云层沿 windDirection 漂移。
//
// 与 VolumetricFogPass 的区别:
//   * VolumetricFogPass 是后处理 Pass,持有 GL 资源,关注"全屏雾 + 丁达尔";
//   * VolumetricClouds 是数据/计算层,关注"云的密度场 + 光照模型",
//     可被天空盒 shader 或独立云 pass 消费。
//
// 用法:
//   const clouds = new VolumetricClouds();
//   clouds.setCloudType('cumulonimbus');
//   clouds.generateNoise(1337);
//   clouds.setCoverage(0.6).setSunDirection(new Vector3(0.3, 0.8, 0.1));
//   clouds.update(dt);
//   const uniforms = clouds.getShaderUniforms(); // 传给天空盒 / 云 pass shader
//   const data = clouds.getCloudData();          // density field + lighting

import { Vector3 } from '../Math/Vector3';

/** RGB 颜色三元组(0..1 线性)。 */
export interface CloudRGB {
  r: number;
  g: number;
  b: number;
}

/** 噪声分辨率(x/y/z 轴向体素数)。 */
export interface NoiseResolution {
  x: number;
  y: number;
  z: number;
}

/** 云类型枚举(决定密度/高度/厚度/散射预设)。 */
export type CloudType = 'cumulus' | 'stratus' | 'cirrus' | 'cumulonimbus';

/** 云类型预设参数。 */
export interface CloudTypePreset {
  /** 类型名。 */
  type: CloudType;
  /** 默认覆盖度。 */
  coverage: number;
  /** 默认密度倍率。 */
  density: number;
  /** 云层底部高度(世界单位)。 */
  height: number;
  /** 云层厚度(世界单位)。 */
  thickness: number;
  /** 底部密度衰减(0=不衰减,1=完全衰减)。 */
  heightDensityBottom: number;
  /** 顶部密度衰减(0=不衰减,1=完全衰减)。 */
  heightDensityTop: number;
  /** 前向散射不对称参数 g1 (0..0.99)。 */
  hgForwardG: number;
  /** 后向散射不对称参数 g2 (-0.99..0)。 */
  hgBackwardG: number;
  /** 前向权重(0..1,1=完全前向)。 */
  hgForwardWeight: number;
  /** 多散射强度(0=关闭,1=全量)。 */
  multiScatteringFactor: number;
}

/** 体积云着色器 uniform(扁平化,可直接灌入 GLSL)。 */
export interface VolumetricCloudsUniforms {
  /** 云基础颜色。 */
  u_cloudColor: [number, number, number];
  /** 云覆盖度 [0,1]。 */
  u_cloudCoverage: number;
  /** 云密度倍率。 */
  u_cloudDensity: number;
  /** 云层底部高度(世界空间)。 */
  u_cloudHeight: number;
  /** 云层厚度(世界空间)。 */
  u_cloudThickness: number;
  /** 风向(归一化)。 */
  u_windDirection: [number, number, number];
  /** 风速。 */
  u_windSpeed: number;
  /** 风偏移(由 update 累积,vec3)。 */
  u_windOffset: [number, number, number];
  /** 环境光颜色。 */
  u_ambientColor: [number, number, number];
  /** 太阳颜色。 */
  u_sunColor: [number, number, number];
  /** 太阳方向(归一化,指向太阳)。 */
  u_sunDirection: [number, number, number];
  /** 主光线步进数。 */
  u_steps: number;
  /** 阴影光线步进数。 */
  u_shadowSteps: number;
  /** 噪声分辨率(vec3)。 */
  u_noiseResolution: [number, number, number];
  /** 是否启用(0/1)。 */
  u_enabled: number;
  // ── v2 升级:多散射 + 双叶 HG + 高度密度 + 云类型 ──
  /** 多散射强度(0..1)。 */
  u_multiScatteringFactor: number;
  /** 多散射近似步数。 */
  u_multiScatteringSteps: number;
  /** 前向 HG g 参数 (0..0.99)。 */
  u_hgForwardG: number;
  /** 后向 HG g 参数 (-0.99..0)。 */
  u_hgBackwardG: number;
  /** 前向权重 (0..1)。 */
  u_hgForwardWeight: number;
  /** 底部密度衰减 (0..1)。 */
  u_heightDensityBottom: number;
  /** 顶部密度衰减 (0..1)。 */
  u_heightDensityTop: number;
  /** 云类型(0=cumulus,1=stratus,2=cirrus,3=cumulonimbus)。 */
  u_cloudType: number;
  /** 锥形阴影半径(0=点采样,>0=锥形扩散)。 */
  u_coneRadius: number;
}

/** 体积云渲染数据(供调用方上传 GPU)。 */
export interface VolumetricCloudsData {
  /** 噪声密度场(noiseResolution.x * y * z 个浮点,0..1)。 */
  noiseData: Float32Array | null;
  /** 噪声分辨率。 */
  noiseResolution: NoiseResolution;
  /** 风偏移(已乘以 windSpeed)。 */
  windOffset: Vector3;
  /** 当前云覆盖度。 */
  coverage: number;
  /** 当前云密度倍率。 */
  density: number;
  /** 是否启用。 */
  enabled: boolean;
}

/** 体积云统计。 */
export interface VolumetricCloudsStats {
  /** 当前覆盖度。 */
  coverage: number;
  /** 当前密度倍率。 */
  density: number;
  /** 主光线步进数。 */
  steps: number;
  /** 阴影光线步进数。 */
  shadowSteps: number;
  /** 噪声分辨率。 */
  noiseResolution: NoiseResolution;
  /** 噪声体素总数。 */
  noiseVoxelCount: number;
  /** 噪声是否已生成。 */
  noiseGenerated: boolean;
  /** 是否启用。 */
  enabled: boolean;
  /** 累计风偏移(世界空间)。 */
  windOffset: Vector3;
  /** 上次 update 的 dt(秒)。 */
  lastDt: number;
  /** 上次 marchRay 的累计采样数(主+阴影)。 */
  lastSampleCount: number;
  /** 云类型。 */
  cloudType: CloudType;
  /** 多散射强度。 */
  multiScatteringFactor: number;
  /** 前向 HG g。 */
  hgForwardG: number;
  /** 后向 HG g。 */
  hgBackwardG: number;
  /** 锥形阴影半径。 */
  coneRadius: number;
}

/** clamp 工具。 */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 线性插值。 */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** smoothstep (Hermite 插值,0..1)。 */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * 云类型预设表 (对标 UE5/Niagara Cloud 参数集)。
 *
 * - Cumulus: 晴天常见蓬松云,中等密度,底部平顶部圆。
 * - Stratus: 层云,扁平分层,低密度大覆盖,雾蒙蒙。
 * - Cirrus: 卷云,高空稀薄,羽状,几乎透明。
 * - Cumulonimbus: 积雨云,高耸浓密,顶部羽化扩散,暴雨前兆。
 */
export const CLOUD_PRESETS: Record<CloudType, CloudTypePreset> = {
  cumulus: {
    type: 'cumulus',
    coverage: 0.5,
    density: 0.5,
    height: 1000,
    thickness: 500,
    heightDensityBottom: 0.0,
    heightDensityTop: 0.5,
    hgForwardG: 0.8,
    hgBackwardG: -0.2,
    hgForwardWeight: 0.7,
    multiScatteringFactor: 0.5,
  },
  stratus: {
    type: 'stratus',
    coverage: 0.8,
    density: 0.3,
    height: 800,
    thickness: 200,
    heightDensityBottom: 0.2,
    heightDensityTop: 0.3,
    hgForwardG: 0.6,
    hgBackwardG: -0.1,
    hgForwardWeight: 0.6,
    multiScatteringFactor: 0.7,
  },
  cirrus: {
    type: 'cirrus',
    coverage: 0.3,
    density: 0.15,
    height: 6000,
    thickness: 300,
    heightDensityBottom: 0.1,
    heightDensityTop: 0.4,
    hgForwardG: 0.9,
    hgBackwardG: -0.3,
    hgForwardWeight: 0.8,
    multiScatteringFactor: 0.3,
  },
  cumulonimbus: {
    type: 'cumulonimbus',
    coverage: 0.7,
    density: 0.85,
    height: 800,
    thickness: 4000,
    heightDensityBottom: 0.0,
    heightDensityTop: 0.7,
    hgForwardG: 0.85,
    hgBackwardG: -0.25,
    hgForwardWeight: 0.75,
    multiScatteringFactor: 0.65,
  },
};

/** 云类型 → uniform 整数映射。 */
const CLOUD_TYPE_INT: Record<CloudType, number> = {
  cumulus: 0,
  stratus: 1,
  cirrus: 2,
  cumulonimbus: 3,
};

/**
 * 体积云渲染系统 — 数据/计算层,产出密度场与着色器 uniform。
 *
 * 典型用法:
 * ```ts
 * const clouds = new VolumetricClouds();
 * clouds.generateNoise(42);
 * clouds.setCoverage(0.6);
 * clouds.update(dt);
 * const u = clouds.getShaderUniforms();
 * // renderer 在天空盒/云 pass 中绑定 u + 3D 噪声纹理
 * ```
 */
export class VolumetricClouds {
  // ── 视觉参数 ──────────────────────────────────────────
  /** 云基础颜色(默认白)。 */
  cloudColor: CloudRGB = { r: 1, g: 1, b: 1 };
  /** 云覆盖度 [0,1](0=无云,1=完全覆盖)。 */
  cloudCoverage: number = 0.5;
  /** 云密度倍率(0..1+,典型 0.3~0.8)。 */
  cloudDensity: number = 0.5;
  /** 云层底部高度(世界空间,默认 1000)。 */
  cloudHeight: number = 1000;
  /** 云层厚度(世界空间,默认 500)。 */
  cloudThickness: number = 500;

  // ── 风 ────────────────────────────────────────────────
  /** 风向(归一化,默认 +X)。 */
  windDirection: Vector3 = new Vector3(1, 0, 0);
  /** 风速(世界单位/秒)。 */
  windSpeed: number = 10;
  /** 风偏移(由 update 累积)。 */
  windOffset: Vector3 = new Vector3(0, 0, 0);

  // ── 光照 ──────────────────────────────────────────────
  /** 环境光颜色(云中阴影区颜色,偏暗)。 */
  ambientColor: CloudRGB = { r: 0.3, g: 0.35, b: 0.4 };
  /** 太阳颜色。 */
  sunColor: CloudRGB = { r: 1, g: 0.95, b: 0.85 };
  /** 太阳方向(归一化,指向太阳)。 */
  sunDirection: Vector3 = new Vector3(0, 1, 0);

  // ── 光线步进 ──────────────────────────────────────────
  /** 主光线步进数(默认 64,越大越精细但越慢)。 */
  steps: number = 64;
  /** 阴影光线步进数(默认 16,用于 Beer-Lambert 衰减采样)。 */
  shadowSteps: number = 16;

  // ── v2 升级:多散射 + 双叶 HG + 高度密度 ──────────────
  /** 多散射强度(0=关闭,1=全量;默认 0.5)。 */
  multiScatteringFactor: number = 0.5;
  /** 多散射近似步数(默认 4,越大越多重散射项)。 */
  multiScatteringSteps: number = 4;
  /** 前向 HG 不对称参数 g1 (0..0.99,默认 0.8)。 */
  hgForwardG: number = 0.8;
  /** 后向 HG 不对称参数 g2 (-0.99..0,默认 -0.2)。 */
  hgBackwardG: number = -0.2;
  /** 前向权重 (0..1,1=完全前向;默认 0.7)。 */
  hgForwardWeight: number = 0.7;
  /** 底部密度衰减 (0..1,0=不衰减;默认 0)。 */
  heightDensityBottom: number = 0.0;
  /** 顶部密度衰减 (0..1,0=不衰减;默认 0.5)。 */
  heightDensityTop: number = 0.5;
  /** 锥形阴影半径(0=点采样,>0=锥形扩散;默认 0)。 */
  coneRadius: number = 0.0;
  /** 当前云类型。 */
  cloudType: CloudType = 'cumulus';

  // ── 噪声 ──────────────────────────────────────────────
  /** 噪声分辨率(各轴体素数,默认 64³)。 */
  noiseResolution: NoiseResolution = { x: 64, y: 64, z: 64 };
  /** 噪声密度体素数据(0..1),null 表示未生成。 */
  noiseData: Float32Array | null = null;

  /** 是否启用。 */
  enabled: boolean = true;

  // ── 内部状态 ──────────────────────────────────────────
  /** 上次 update 的 dt。 */
  private _lastDt: number = 0;
  /** 上次 marchRay 的累计采样数。 */
  private _lastSampleCount: number = 0;

  constructor() {
    // 默认不预生成噪声(避免在测试中分配 64³ 内存);
    // 调用方按需 generateNoise()。
  }

  // ── 开关与基础 setter ─────────────────────────────────

  /** 启用/禁用。 */
  setEnabled(enabled: boolean): this {
    this.enabled = enabled;
    return this;
  }

  /** 设置云颜色(复制传入对象)。 */
  setCloudColor(color: CloudRGB): this {
    this.cloudColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置覆盖度 [0,1]。 */
  setCoverage(coverage: number): this {
    this.cloudCoverage = clamp(coverage, 0, 1);
    return this;
  }

  /** 设置密度倍率(>=0)。 */
  setDensity(density: number): this {
    this.cloudDensity = Math.max(0, density);
    return this;
  }

  /** 设置云层底部高度(>=0)。 */
  setHeight(height: number): this {
    this.cloudHeight = Math.max(0, height);
    return this;
  }

  /** 设置云层厚度(>=0)。 */
  setThickness(thickness: number): this {
    this.cloudThickness = Math.max(0, thickness);
    return this;
  }

  /** 设置风(方向自动归一化,speed>=0)。 */
  setWind(direction: Vector3, speed: number): this {
    this.windDirection.copy(direction);
    const len = this.windDirection.length();
    if (len > 0) this.windDirection.multiplyScalar(1 / len);
    this.windSpeed = Math.max(0, speed);
    return this;
  }

  /** 设置环境光颜色。 */
  setAmbientColor(color: CloudRGB): this {
    this.ambientColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置太阳颜色。 */
  setSunColor(color: CloudRGB): this {
    this.sunColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置太阳方向(自动归一化)。 */
  setSunDirection(direction: Vector3): this {
    this.sunDirection.copy(direction);
    const len = this.sunDirection.length();
    if (len > 0) this.sunDirection.multiplyScalar(1 / len);
    return this;
  }

  /** 设置主光线步进数(1..512)。 */
  setSteps(steps: number): this {
    this.steps = Math.max(1, Math.min(512, Math.floor(steps)));
    return this;
  }

  /** 设置阴影步进数(1..128)。 */
  setShadowSteps(steps: number): this {
    this.shadowSteps = Math.max(1, Math.min(128, Math.floor(steps)));
    return this;
  }

  // ── v2 升级 setter ────────────────────────────────────

  /** 设置多散射参数(factor 0..1,steps 1..16)。 */
  setMultiScattering(factor: number, steps?: number): this {
    this.multiScatteringFactor = clamp(factor, 0, 1);
    if (steps !== undefined) {
      this.multiScatteringSteps = Math.max(1, Math.min(16, Math.floor(steps)));
    }
    return this;
  }

  /** 设置双叶 Henyey-Greenstein 相位函数参数。 */
  setPhaseFunction(forwardG: number, backwardG: number, forwardWeight: number): this {
    this.hgForwardG = clamp(forwardG, -0.99, 0.99);
    this.hgBackwardG = clamp(backwardG, -0.99, 0.99);
    this.hgForwardWeight = clamp(forwardWeight, 0, 1);
    return this;
  }

  /** 设置高度密度衰减(bottom/top 均 0..1)。 */
  setHeightDensity(bottom: number, top: number): this {
    this.heightDensityBottom = clamp(bottom, 0, 1);
    this.heightDensityTop = clamp(top, 0, 1);
    return this;
  }

  /** 设置锥形阴影半径(0=点采样,>0=锥形扩散)。 */
  setConeRadius(radius: number): this {
    this.coneRadius = Math.max(0, radius);
    return this;
  }

  /**
   * 应用云类型预设(覆盖 coverage/density/height/thickness/高度密度/HG/多散射)。
   * 已生成的噪声数据保留(仅参数变化)。
   */
  setCloudType(type: CloudType): this {
    const p = CLOUD_PRESETS[type];
    if (!p) return this;
    this.cloudType = type;
    this.cloudCoverage = p.coverage;
    this.cloudDensity = p.density;
    this.cloudHeight = p.height;
    this.cloudThickness = p.thickness;
    this.heightDensityBottom = p.heightDensityBottom;
    this.heightDensityTop = p.heightDensityTop;
    this.hgForwardG = p.hgForwardG;
    this.hgBackwardG = p.hgBackwardG;
    this.hgForwardWeight = p.hgForwardWeight;
    this.multiScatteringFactor = p.multiScatteringFactor;
    return this;
  }

  /** 设置噪声分辨率(各轴 >= 2)。 */
  setNoiseResolution(x: number, y: number, z: number): this {
    this.noiseResolution = {
      x: Math.max(2, Math.floor(x)),
      y: Math.max(2, Math.floor(y)),
      z: Math.max(2, Math.floor(z)),
    };
    // 分辨率变化后,旧数据失效
    this.noiseData = null;
    return this;
  }

  // ── 噪声生成 ──────────────────────────────────────────

  /**
   * 生成 3D 噪声(Perlin FBM + Worley 减法混合)。
   *
   * 算法:
   *   * Perlin:多 octaves 累加(FBM),输出 -1..1 → 归一化到 0..1
   *   * Worley:cellular 距离,输出 0..1(距特征点越远值越大)
   *   * 混合:final = perlin - worley * 0.5,clamp 0..1
   *     (Worley 减法形成云洞与边缘羽化)
   *
   * @param seed 随机种子(同种子可复现)。
   */
  generateNoise(seed: number = 0): this {
    const { x: nx, y: ny, z: nz } = this.noiseResolution;
    const data = new Float32Array(nx * ny * nz);

    // 简化 PRNG(Mulberry32),确定性、可复现
    let s = seed >>> 0;
    if (s === 0) s = 1;
    const rand = (): number => {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // 预生成 Perlin 梯度表(256 个)
    const permSize = 256;
    const perm = new Uint8Array(permSize * 2);
    const basePerm = new Uint8Array(permSize);
    for (let i = 0; i < permSize; i++) basePerm[i] = i;
    // Fisher-Yates shuffle(用 rand)
    for (let i = permSize - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = basePerm[i];
      basePerm[i] = basePerm[j];
      basePerm[j] = tmp;
    }
    for (let i = 0; i < permSize * 2; i++) perm[i] = basePerm[i & 255];

    // Perlin 梯度(12 个方向,经典 Perlin)
    const grad = [
      [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
      [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
    ];

    // 缓存 Worley 特征点(每个 cell 一个,grid 大小 = 8 体素)
    const cellSize = 8;
    const cellsX = Math.ceil(nx / cellSize) + 2;
    const cellsY = Math.ceil(ny / cellSize) + 2;
    const cellsZ = Math.ceil(nz / cellSize) + 2;
    const featurePoints: Float32Array[] = [];
    const featureCells = cellsX * cellsY * cellsZ;
    for (let c = 0; c < featureCells; c++) {
      // 每 cell 一个特征点,位置在 cell 内随机
      featurePoints.push(new Float32Array([
        rand() * cellSize,
        rand() * cellSize,
        rand() * cellSize,
      ]));
    }

    // Perlin noise 单次采样(改进版 Perlin,参考 Ken Perlin 2002)
    const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
    const lerpFn = (a: number, b: number, t: number): number => a + t * (b - a);
    const gradDot = (hash: number, x: number, y: number, z: number): number => {
      const g = grad[hash % 12];
      return g[0] * x + g[1] * y + g[2] * z;
    };
    const perlin = (x: number, y: number, z: number): number => {
      const X = Math.floor(x) & 255;
      const Y = Math.floor(y) & 255;
      const Z = Math.floor(z) & 255;
      const xf = x - Math.floor(x);
      const yf = y - Math.floor(y);
      const zf = z - Math.floor(z);
      const u = fade(xf);
      const v = fade(yf);
      const w = fade(zf);
      const p = perm;
      const A = p[X] + Y;
      const AA = p[A] + Z;
      const AB = p[A + 1] + Z;
      const B = p[X + 1] + Y;
      const BA = p[B] + Z;
      const BB = p[B + 1] + Z;
      return lerpFn(
        lerpFn(
          lerpFn(gradDot(p[AA], xf, yf, zf), gradDot(p[BA], xf - 1, yf, zf), u),
          lerpFn(gradDot(p[AB], xf, yf - 1, zf), gradDot(p[BB], xf - 1, yf - 1, zf), u),
          v,
        ),
        lerpFn(
          lerpFn(gradDot(p[AA + 1], xf, yf, zf - 1), gradDot(p[BA + 1], xf - 1, yf, zf - 1), u),
          lerpFn(gradDot(p[AB + 1], xf, yf - 1, zf - 1), gradDot(p[BB + 1], xf - 1, yf - 1, zf - 1), u),
          v,
        ),
        w,
      );
    };

    // FBM:多 octaves 累加
    const fbm = (x: number, y: number, z: number, octaves: number): number => {
      let sum = 0;
      let amp = 0.5;
      let freq = 1;
      for (let i = 0; i < octaves; i++) {
        sum += amp * perlin(x * freq, y * freq, z * freq);
        freq *= 2;
        amp *= 0.5;
      }
      return sum;
    };

    // Worley cellular noise(F1 距离,扫描 3x3x3 邻域 cell)
    const worley = (x: number, y: number, z: number): number => {
      const cx = Math.floor(x / cellSize);
      const cy = Math.floor(y / cellSize);
      const cz = Math.floor(z / cellSize);
      let minDist = Infinity;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ccx = cx + dx;
            const ccy = cy + dy;
            const ccz = cz + dz;
            if (ccx < 0 || ccy < 0 || ccz < 0) continue;
            if (ccx >= cellsX || ccy >= cellsY || ccz >= cellsZ) continue;
            const cellIdx = ccz * cellsX * cellsY + ccy * cellsX + ccx;
            const fp = featurePoints[cellIdx];
            if (!fp) continue;
            const fx = ccx * cellSize + fp[0];
            const fy = ccy * cellSize + fp[1];
            const fz = ccz * cellSize + fp[2];
            const d2 = (fx - x) * (fx - x) + (fy - y) * (fy - y) + (fz - z) * (fz - z);
            if (d2 < minDist) minDist = d2;
          }
        }
      }
      return Math.sqrt(minDist) / (cellSize * Math.SQRT2);
    };

    // 生成体素
    // 采样坐标归一化到 [0, 4](让 FBM 在合理尺度)
    const scale = 4 / Math.max(nx, ny, nz);
    for (let iz = 0; iz < nz; iz++) {
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const idx = (iz * ny + iy) * nx + ix;
          const p = fbm(ix * scale, iy * scale, iz * scale, 4);
          // Perlin 输出约 -0.5..0.5,归一化到 0..1
          const perlinVal = clamp(p + 0.5, 0, 1);
          const worleyVal = clamp(worley(ix, iy, iz), 0, 1);
          // 混合:Perlin 主导,Worley 减法形成云洞
          let v = perlinVal - worleyVal * 0.5;
          v = clamp(v, 0, 1);
          data[idx] = v;
        }
      }
    }

    this.noiseData = data;
    return this;
  }

  /**
   * 采样噪声(三线性插值,环绕寻址)。
   *
   * @param u  [0,1) 归一化坐标 X
   * @param v  [0,1) 归一化坐标 Y
   * @param w  [0,1) 归一化坐标 Z
   * @returns 密度值 [0,1];噪声未生成时返回 0
   */
  sampleNoise(u: number, v: number, w: number): number {
    const data = this.noiseData;
    if (!data) return 0;
    const { x: nx, y: ny, z: nz } = this.noiseResolution;
    // 环绕寻址
    const fx = ((u % 1) + 1) % 1 * nx;
    const fy = ((v % 1) + 1) % 1 * ny;
    const fz = ((w % 1) + 1) % 1 * nz;
    const ix0 = Math.floor(fx) % nx;
    const iy0 = Math.floor(fy) % ny;
    const iz0 = Math.floor(fz) % nz;
    const ix1 = (ix0 + 1) % nx;
    const iy1 = (iy0 + 1) % ny;
    const iz1 = (iz0 + 1) % nz;
    const tx = fx - Math.floor(fx);
    const ty = fy - Math.floor(fy);
    const tz = fz - Math.floor(fz);
    const sample = (x: number, y: number, z: number): number =>
      data[(z * ny + y) * nx + x];
    const c000 = sample(ix0, iy0, iz0);
    const c100 = sample(ix1, iy0, iz0);
    const c010 = sample(ix0, iy1, iz0);
    const c110 = sample(ix1, iy1, iz0);
    const c001 = sample(ix0, iy0, iz1);
    const c101 = sample(ix1, iy0, iz1);
    const c011 = sample(ix0, iy1, iz1);
    const c111 = sample(ix1, iy1, iz1);
    const c00 = lerp(c000, c100, tx);
    const c10 = lerp(c010, c110, tx);
    const c01 = lerp(c001, c101, tx);
    const c11 = lerp(c011, c111, tx);
    const c0 = lerp(c00, c10, ty);
    const c1 = lerp(c01, c11, ty);
    return lerp(c0, c1, tz);
  }

  // ── 渲染/光线步进 ─────────────────────────────────────

  /**
   * 执行体积云渲染(光线步进)。本方法为 CPU 侧参考实现,主要用于
   * 验证密度场与光照模型;实际渲染由 GPU shader 消费 uniform 完成。
   *
   * @param camera 相机(读取 position 与 forward 方向)。
   *               接受 { position: Vector3, forward: Vector3 } 结构类型。
   * @returns 渲染结果 { color: CloudRGB, alpha: number }
   */
  render(camera: { position: Vector3; forward: Vector3 }): { color: CloudRGB; alpha: number } {
    if (!this.enabled) {
      return { color: { r: 0, g: 0, b: 0 }, alpha: 0 };
    }
    // 从相机沿 forward 步进
    const origin = camera.position;
    const direction = camera.forward.clone().normalize();
    return this.marchRay(origin, direction, this.steps);
  }

  /**
   * 光线步进:沿光线穿过云层,累积密度与光照。
   *
   * v2 升级:光照计算传入 viewDirection (= -direction) 以启用方向相关 HG。
   *
   * @param origin    光线起点(世界空间)
   * @param direction 光线方向(归一化)
   * @param steps     步进数(覆盖默认值)
   * @returns { color, alpha } — 累积颜色与不透明度
   */
  marchRay(
    origin: Vector3,
    direction: Vector3,
    steps: number,
  ): { color: CloudRGB; alpha: number } {
    const n = Math.max(1, Math.floor(steps));
    // 计算光线与云层 [cloudHeight, cloudHeight + cloudThickness] 的交点
    const tEnter = this._intersectLayer(origin, direction, true);
    const tExit = this._intersectLayer(origin, direction, false);
    if (tEnter < 0 || tExit < 0 || tExit <= tEnter) {
      this._lastSampleCount = 0;
      return { color: { r: 0, g: 0, b: 0 }, alpha: 0 };
    }

    const stepLen = (tExit - tEnter) / n;
    // 视线方向 = -direction (从采样点指向相机)
    const viewDir = direction.clone().multiplyScalar(-1);
    let transmittance = 1; // 透射率,初始完全透明
    let r = 0, g = 0, b = 0;
    let sampleCount = 0;

    for (let i = 0; i < n; i++) {
      const t = tEnter + stepLen * (i + 0.5);
      const px = origin.x + direction.x * t;
      const py = origin.y + direction.y * t;
      const pz = origin.z + direction.z * t;

      // 采样密度场(用世界坐标 → 噪声 UVW + 风偏移 + 高度密度调制)
      const density = this._sampleDensity(px, py, pz);
      if (density <= 0) continue;
      sampleCount++;

      // Beer-Lambert 透射率衰减
      const extinction = density * this.cloudDensity * stepLen * 0.01;
      const stepTransmittance = Math.exp(-extinction);

      // 光照:沿太阳方向 shadow march 计算衰减 + 多散射 + 双叶 HG
      const lighting = this.computeLighting(
        new Vector3(px, py, pz),
        density,
        this.sunDirection,
        viewDir,
      );

      // 累积颜色(前向合成)
      const scatter = (1 - stepTransmittance) * transmittance;
      r += scatter * lighting.r;
      g += scatter * lighting.g;
      b += scatter * lighting.b;

      transmittance *= stepTransmittance;
      if (transmittance < 0.01) break; // 早期终止
    }

    this._lastSampleCount = sampleCount + sampleCount * this.shadowSteps;
    return {
      color: { r, g, b },
      alpha: clamp(1 - transmittance, 0, 1),
    };
  }

  /**
   * 计算云中某点的照明(v2 升级:多散射 + 双叶 HG + Beer-Powder)。
   *
   * 算法:
   *   1. 沿太阳方向步进 shadowSteps,累积光学深度 τ (可选锥形扩散)
   *   2. Beer-Lambert:           beer       = exp(-τ)
   *   3. Beer-Powder (Bouthors): powder     = 1 - exp(-2τ)
   *      combined = beer * (1 - 0.5 * powder) + 0.5 * powder * beer
   *      (在暗处 powder 让光更暗,在亮处 beer 主导)
   *   4. 多散射近似 (Wenzel 2019):
   *      L_ms = sunColor * (1 - exp(-τ * msFactor)) / (τ * msFactor + 0.001)
   *      归一化后 × msSteps,模拟光在云内多次弹射的能量重分布
   *   5. 双叶 HG 相位函数:
   *      phase = lerp(HG(g1, cosθ), HG(g2, cosθ), 1 - forwardWeight)
   *      其中 cosθ = dot(viewDir, sunDir)
   *
   * @param position      采样点(世界空间)
   * @param density       该点密度
   * @param sunDirection  太阳方向(归一化)
   * @param viewDirection 视线方向(归一化,从采样点指向相机);省略则用 -sunDirection
   * @returns 照明颜色(0..1+)
   */
  computeLighting(
    position: Vector3,
    density: number,
    sunDirection: Vector3,
    viewDirection?: Vector3,
  ): CloudRGB {
    // ── Step 1: 沿太阳方向步进累积光学深度 (可选锥形扩散) ──
    const shadowStepLen = 8; // 阴影步长(世界单位)
    let opticalDepth = 0;
    const shadowN = Math.max(1, this.shadowSteps);
    // 锥形采样:每步偏移一个伪随机方向(基于步序的 hash)
    const cone = this.coneRadius;
    for (let i = 0; i < shadowN; i++) {
      const t = (i + 1) * shadowStepLen;
      let sx = position.x + sunDirection.x * t;
      let sy = position.y + sunDirection.y * t;
      let sz = position.z + sunDirection.z * t;
      if (cone > 0) {
        // 锥形扩散:基于步序的伪随机偏移 (golden-angle 分布)
        const angle = i * 2.39996323; // 黄金角 (弧度)
        const radius = cone * t * 0.1;
        sx += Math.cos(angle) * radius;
        sy += Math.sin(angle) * radius;
      }
      const sd = this._sampleDensity(sx, sy, sz);
      opticalDepth += sd * this.cloudDensity * shadowStepLen * 0.01;
    }

    // ── Step 2-3: Beer-Lambert + Beer-Powder (Bouthors) ──
    const beer = Math.exp(-opticalDepth);
    const powder = 1 - Math.exp(-2 * opticalDepth);
    const beerPowder = beer * (1 - 0.5 * powder) + 0.5 * powder * beer;

    // ── Step 4: 多散射近似 (Wenzel 2019 能量重分布) ──
    // L_ms 模拟光在云内多次弹射后的剩余能量,避免云体过暗。
    // 当 msFactor=0 时 msEnergy=0 (关闭多散射,回退到单散射)。
    let msEnergy = 0;
    if (this.multiScatteringFactor > 0) {
      const msTau = opticalDepth * this.multiScatteringFactor;
      const msN = Math.max(1, this.multiScatteringSteps);
      // 级数近似:每项衰减为前项的 exp(-msTau/msN)
      let term = 1;
      let sum = 0;
      for (let i = 0; i < msN; i++) {
        sum += term;
        term *= Math.exp(-msTau / msN);
      }
      msEnergy = (1 - Math.exp(-msTau)) * sum / msN;
    }

    // ── Step 5: 双叶 Henyey-Greenstein 相位函数 ──
    // HG(g, cosθ) = (1 - g²) / (4π (1 + g² - 2g·cosθ)^1.5)
    // 双叶:phase = lerp(HG(g1, cosθ), HG(g2, cosθ), 1 - forwardWeight)
    // viewDirection 省略时回退到 -sunDirection (cosθ = -1,后向散射)
    const vd = viewDirection ?? sunDirection.clone().multiplyScalar(-1);
    const cosTheta = clamp(
      vd.x * sunDirection.x + vd.y * sunDirection.y + vd.z * sunDirection.z,
      -1, 1,
    );
    const phase = this._dualLobedHG(cosTheta);

    // ── 合成:环境光 + 太阳光 (beerPowder + multiScattering) × phase ──
    const ambientR = this.ambientColor.r;
    const ambientG = this.ambientColor.g;
    const ambientB = this.ambientColor.b;
    const sunR = this.sunColor.r * (beerPowder + msEnergy) * phase;
    const sunG = this.sunColor.g * (beerPowder + msEnergy) * phase;
    const sunB = this.sunColor.b * (beerPowder + msEnergy) * phase;

    // 密度越高环境光越暗(深云内部)
    const ambientFactor = clamp(1 - density * 0.5, 0, 1);

    return {
      r: ambientR * ambientFactor + sunR,
      g: ambientG * ambientFactor + sunG,
      b: ambientB * ambientFactor + sunB,
    };
  }

  /**
   * 双叶 Henyey-Greenstein 相位函数。
   * phase = lerp(HG(g1, cosθ), HG(g2, cosθ), 1 - forwardWeight)
   *
   * 前向叶 (g1>0) 模拟光沿原方向继续传播(银边效应),
   * 后向叶 (g2<0) 模拟光向后散射(云背光面的暗边)。
   */
  private _dualLobedHG(cosTheta: number): number {
    const hg = (g: number, cos: number): number => {
      const g2 = g * g;
      const denom = 1 + g2 - 2 * g * cos;
      return (1 - g2) / (4 * Math.PI * Math.pow(Math.max(denom, 1e-6), 1.5));
    };
    const forward = hg(this.hgForwardG, cosTheta);
    const backward = hg(this.hgBackwardG, cosTheta);
    return lerp(forward, backward, 1 - this.hgForwardWeight);
  }

  /** 推进风偏移(累计 dt * windSpeed * windDirection)。 */
  update(dt: number): this {
    this._lastDt = dt;
    if (!this.enabled) return this;
    if (dt <= 0) return this;
    this.windOffset.addScaledVector(this.windDirection, dt * this.windSpeed);
    return this;
  }

  // ── 数据 / uniform / 统计 ─────────────────────────────

  /** 获取云数据(供调用方上传 GPU)。 */
  getCloudData(): VolumetricCloudsData {
    return {
      noiseData: this.noiseData,
      noiseResolution: { ...this.noiseResolution },
      windOffset: this.windOffset.clone(),
      coverage: this.cloudCoverage,
      density: this.cloudDensity,
      enabled: this.enabled,
    };
  }

  /** 获取着色器 uniform(扁平化)。 */
  getShaderUniforms(): VolumetricCloudsUniforms {
    return {
      u_cloudColor: [this.cloudColor.r, this.cloudColor.g, this.cloudColor.b],
      u_cloudCoverage: this.cloudCoverage,
      u_cloudDensity: this.cloudDensity,
      u_cloudHeight: this.cloudHeight,
      u_cloudThickness: this.cloudThickness,
      u_windDirection: [this.windDirection.x, this.windDirection.y, this.windDirection.z],
      u_windSpeed: this.windSpeed,
      u_windOffset: [this.windOffset.x, this.windOffset.y, this.windOffset.z],
      u_ambientColor: [this.ambientColor.r, this.ambientColor.g, this.ambientColor.b],
      u_sunColor: [this.sunColor.r, this.sunColor.g, this.sunColor.b],
      u_sunDirection: [this.sunDirection.x, this.sunDirection.y, this.sunDirection.z],
      u_steps: this.steps,
      u_shadowSteps: this.shadowSteps,
      u_noiseResolution: [this.noiseResolution.x, this.noiseResolution.y, this.noiseResolution.z],
      u_enabled: this.enabled ? 1 : 0,
      // ── v2 升级字段 ──
      u_multiScatteringFactor: this.multiScatteringFactor,
      u_multiScatteringSteps: this.multiScatteringSteps,
      u_hgForwardG: this.hgForwardG,
      u_hgBackwardG: this.hgBackwardG,
      u_hgForwardWeight: this.hgForwardWeight,
      u_heightDensityBottom: this.heightDensityBottom,
      u_heightDensityTop: this.heightDensityTop,
      u_cloudType: CLOUD_TYPE_INT[this.cloudType],
      u_coneRadius: this.coneRadius,
    };
  }

  /** 获取统计。 */
  getStats(): VolumetricCloudsStats {
    return {
      coverage: this.cloudCoverage,
      density: this.cloudDensity,
      steps: this.steps,
      shadowSteps: this.shadowSteps,
      noiseResolution: { ...this.noiseResolution },
      noiseVoxelCount: this.noiseResolution.x * this.noiseResolution.y * this.noiseResolution.z,
      noiseGenerated: this.noiseData !== null,
      enabled: this.enabled,
      windOffset: this.windOffset.clone(),
      lastDt: this._lastDt,
      lastSampleCount: this._lastSampleCount,
      // ── v2 升级字段 ──
      cloudType: this.cloudType,
      multiScatteringFactor: this.multiScatteringFactor,
      hgForwardG: this.hgForwardG,
      hgBackwardG: this.hgBackwardG,
      coneRadius: this.coneRadius,
    };
  }

  // ── 内部 ──────────────────────────────────────────────

  /**
   * 计算光线与云层的交点 t 参数。
   * 云层在 [cloudHeight, cloudHeight + cloudThickness] 之间(世界 Y)。
   *
   * @param origin    光线起点
   * @param direction 光线方向(归一化)
   * @param enter     true=入射点,false=出射点
   * @returns t 参数(沿 direction 的距离);<0 表示不相交
   */
  private _intersectLayer(
    origin: Vector3,
    direction: Vector3,
    enter: boolean,
  ): number {
    const yBottom = this.cloudHeight;
    const yTop = this.cloudHeight + this.cloudThickness;
    const target = enter ? yBottom : yTop;
    if (Math.abs(direction.y) < 1e-6) {
      // 光线水平:不在云层中则不相交
      if (origin.y < yBottom || origin.y > yTop) return -1;
      return enter ? 0 : 1; // 已在云层中
    }
    const t = (target - origin.y) / direction.y;
    return t >= 0 ? t : -1;
  }

  /**
   * 采样云密度(世界坐标 → 噪声 UVW + 风偏移 + 高度密度调制)。
   *
   * v2 升级:高度密度调制 (height density modulation)
   *   heightT = (y - yBottom) / thickness   // 0=底部, 1=顶部
   *   bottomAtten = 1 - heightDensityBottom * smoothstep(0, 0.2, heightT)
   *   topAtten    = 1 - heightDensityTop * smoothstep(0.6, 1.0, heightT)
   *   density *= bottomAtten * topAtten
   *
   * 效果:云底部浓密 (stratus 除外,底部也有衰减)、顶部羽化扩散,
   * 模拟真实积云的"花椰菜顶"与"扁平底"形态。
   */
  private _sampleDensity(x: number, y: number, z: number): number {
    const data = this.noiseData;
    if (!data) return 0;
    // 检查 Y 是否在云层范围内(避免在云层外采样浪费)
    const yBottom = this.cloudHeight;
    const yTop = this.cloudHeight + this.cloudThickness;
    if (y < yBottom || y > yTop) return 0;

    // 归一化到 [0,1) UVW(用 1024 作为世界尺度,可调)
    const worldScale = 1024;
    const u = (x + this.windOffset.x) / worldScale;
    const v = (y - yBottom) / this.cloudThickness;
    const w = (z + this.windOffset.z) / worldScale;
    const noise = this.sampleNoise(u, v, w);

    // 覆盖度控制:coverage 越高,云密度越浓
    const coverageFactor = 1 - (1 - this.cloudCoverage) * (1 - this.cloudCoverage);

    // ── v2: 高度密度调制 ──
    const heightT = clamp((y - yBottom) / this.cloudThickness, 0, 1);
    // 底部衰减:在 heightT ∈ [0, 0.2] 区间从 (1-bottom) 渐变到 1
    const bottomAtten = 1 - this.heightDensityBottom * (1 - smoothstep(0, 0.2, heightT));
    // 顶部衰减:在 heightT ∈ [0.6, 1.0] 区间从 1 渐变到 (1-top)
    const topAtten = 1 - this.heightDensityTop * smoothstep(0.6, 1.0, heightT);

    return clamp(noise * coverageFactor * bottomAtten * topAtten, 0, 1);
  }
}
