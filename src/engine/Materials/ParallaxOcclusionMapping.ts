// ParallaxOcclusionMapping — 视差遮挡贴图 (Parallax Occlusion Mapping, POM)。
//
// 适配自 o3de Atom `ParallaxMapping.azsli` + Real-Time Rendering 4th ed. §6.7.1
// + Tartachuk (2004) "Parallax Occlusion Mapping" + McGuire & McGuire (2005)
// "Bump-Mapped Parallax Mapping"。提供 5 种算法:
//
//   1. Basic   — 单采样偏移(最快,精度最低,适合低角度不明显的表面)
//   2. Steep   — 多步射线步进(找到第一个交点,无插值,有阶梯伪影)
//   3. POM     — Steep + 线性插值(消除阶梯伪影,标准 AAA 做法)
//   4. Relief  — Steep + 二分查找细化(精度最高,但每个步进需额外纹理采样)
//   5. Contact — Steep + Contact refinement(Andrea Riccardi 2018,精度接近 Relief
//                但采样次数更少)
//
// 可选自阴影:从交点向光源方向步进,检测是否被高度场遮挡,产生软自阴影。
//
// 可选像素深度偏移(Pixel Depth Offset, PDO):把切线空间偏移转回世界空间,
// 修正最终片元深度,使视差表面能正确参与深度测试 / 阴影接收。
//
// 质量预设(步数):Low=16, Medium=32, High=64, Ultra=128(与 o3de 一致)。
//
// 与 o3de 的差异:
//   - 纯 TypeScript CPU 参考实现(Float32Array 高度图),无 GPU 依赖
//   - GLSL chunk 可直接嵌入 WebGL2 片段着色器
//   - 增加了返回值类型安全(intersection point + UV offset + shadow factor)
//
// soup3D 无视差遮挡贴图,仅支持基础法线贴图。VREEN 的 POM 让平坦表面
// (砖墙 / 鹅卵石 / 地砖 / 地形细节)获得 3D 几何般的深度感,无需增加顶点。
//
// 参考:
//   - o3de Atom ParallaxMapping.azsli
//   - Real-Time Rendering 4th ed. §6.7.1 "Parallax Occlusion Mapping"
//   - Tartachuk (2004) "Parallax Occlusion Mapping: Self-Shadowing and Perspective-Correct Bumps"
//   - McGuire & McGuire (2005) "Bump-Mapped Parallax Mapping"
//   - Andrea Riccardi (2018) "Contact Refinement Parallax Mapping"

// ── 类型 ─────────────────────────────────────────────────────────────

/** POM 算法选择(与 o3de ParallaxAlgorithm 枚举一致)。 */
export type ParallaxAlgorithm = 'basic' | 'steep' | 'pom' | 'relief' | 'contact';

/** 质量预设(步数,与 o3de ParallaxQuality 一致)。 */
export type ParallaxQuality = 'low' | 'medium' | 'high' | 'ultra';

/** 质量预设对应的步数。 */
export const PARALLAX_QUALITY_STEPS: Record<ParallaxQuality, number> = {
  low: 16,
  medium: 32,
  high: 64,
  ultra: 128,
};

/** POM 配置参数。 */
export interface ParallaxOptions {
  /**
   * 算法选择。
   * @default 'pom'
   */
  algorithm?: ParallaxAlgorithm;
  /**
   * 质量预设(决定步数)。也可直接传 `numSteps` 覆盖。
   * @default 'medium'
   */
  quality?: ParallaxQuality;
  /**
   * 射线步进次数。若提供则覆盖 `quality` 对应的步数。
   * 范围 [1, 256]。更多步 = 更平滑但更慢。
   */
  numSteps?: number;
  /**
   * 深度缩放因子(depthFactor / amplitude)。控制视差效果的"深度"。
   * 值越大 → 视差越强但伪影越多。典型 0.02..0.1。
   * @default 0.05
   */
  depthFactor?: number;
  /**
   * 深度偏移(depthOffset)。把整个高度场上下移动(切线空间单位)。
   * 正值 = 下沉(表面变低),负值 = 上升(表面变高,可超出原始网格)。
   * @default 0
   */
  depthOffset?: number;
  /**
   * 是否启用自阴影(从交点向光源步进检测遮挡)。
   * @default false
   */
  enableShadow?: boolean;
  /**
   * 自阴影步数(独立于主步数)。若未提供则用 `numSteps * 当前步比例`。
   */
  shadowSteps?: number;
  /**
   * 自阴影强度(0..1)。0 = 无阴影,1 = 完全遮挡。
   * @default 0.5
   */
  shadowStrength?: number;
}

/** POM 计算结果。 */
export interface ParallaxResult {
  /** 偏移后的 UV 坐标(用于后续纹理采样)。 */
  uv: { u: number; v: number };
  /** 切线空间偏移量(xyz)。z 分量可用于深度修正。 */
  offsetTS: { x: number; y: number; z: number };
  /** 归一化交点深度 [0,1](0 = 高度场顶部,1 = 底部)。 */
  depth: number;
  /** 自阴影衰减 [0,1](1 = 完全照亮,0 = 完全遮挡)。无 enableShadow 时为 1。 */
  shadowAttenuation: number;
  /** 实际使用的步数。 */
  steps: number;
  /** 是否被几何表面裁剪(offset.z > 0 → 超出表面)。 */
  isClipped: boolean;
}

// ── 工具函数 ─────────────────────────────────────────────────────────

/**
 * 高度图采样函数(CPU 参考)。
 *
 * @param heightmap  高度图数据(单通道,每像素一个 float。[0,1] 范围)
 * @param width      高度图宽度
 * @param height     高度图高度
 * @param u          U 坐标 [0,1]
 * @param v          V 坐标 [0,1]
 * @param wrap       UV wrap 模式
 * @returns          归一化高度值 [0,1](0 = 顶部,1 = 底部,与 o3de 一致:
 *                   `1.0 - heightmap.sample().r`)
 */
export function sampleHeightmap(
  heightmap: Float32Array | ArrayLike<number>,
  width: number,
  height: number,
  u: number,
  v: number,
  wrap: 'clamp' | 'repeat' = 'clamp',
): number {
  // UV → texel 坐标(中心采样)
  let fx = u * width - 0.5;
  let fy = v * height - 0.5;
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  // wrap 处理
  if (wrap === 'repeat') {
    x0 = ((x0 % width) + width) % width;
    y0 = ((y0 % height) + height) % height;
  } else {
    // clamp
    x0 = Math.max(0, Math.min(width - 1, x0));
    y0 = Math.max(0, Math.min(height - 1, y0));
  }
  const x1 = wrap === 'repeat' ? (x0 + 1) % width : Math.max(0, Math.min(width - 1, x0 + 1));
  const y1 = wrap === 'repeat' ? (y0 + 1) % height : Math.max(0, Math.min(height - 1, y0 + 1));

  // 4-tap bilinear
  const v00 = heightmap[y0 * width + x0];
  const v10 = heightmap[y0 * width + x1];
  const v01 = heightmap[y1 * width + x0];
  const v11 = heightmap[y1 * width + x1];

  const a = v00 * (1 - tx) + v10 * tx;
  const b = v01 * (1 - tx) + v11 * tx;
  const raw = a * (1 - ty) + b * ty;

  // o3de 约定:1.0 - raw(高度图越亮 = 越高 = 越接近 0)
  return 1.0 - Math.max(0, Math.min(1, raw));
}

/**
 * 归一化深度(与 o3de GetNormalizedDepth 一致)。
 *
 * @param heightmap      高度图数据
 * @param width          高度图宽度
 * @param height         高度图高度
 * @param u              U 坐标
 * @param v              V 坐标
 * @param startDepth     搜索起始深度(高度场范围上界)
 * @param stopDepth      搜索终止深度(高度场范围下界)
 * @param inverseDepthRange  1 / (stopDepth - startDepth)
 * @param wrap           UV wrap 模式
 * @returns              归一化深度 [0,1](0 = 顶部,1 = 底部)
 */
export function getNormalizedDepth(
  heightmap: Float32Array | ArrayLike<number>,
  width: number,
  height: number,
  u: number,
  v: number,
  startDepth: number,
  stopDepth: number,
  inverseDepthRange: number,
  wrap: 'clamp' | 'repeat' = 'clamp',
): number {
  // o3de: 如果深度范围太小(< 0.0001),直接返回 0(无视差效果)
  // 这处理 depthFactor≈0 的边界情况,避免除零和无效搜索
  if (Math.abs(stopDepth - startDepth) < 0.0001) {
    return 0.0;
  }
  const raw = sampleHeightmap(heightmap, width, height, u, v, wrap);
  // o3de: clamped to minimum of 0 (no displacement above surface)
  const minNormalizedDepth = -startDepth * inverseDepthRange;
  return Math.max(raw, minNormalizedDepth);
}

// ── 算法实现 ─────────────────────────────────────────────────────────

/**
 * Basic Parallax Mapping — 单采样偏移。
 *
 * 从当前 UV 沿视线方向偏移 `depthFactor * height` 个 UV 单位。
 * 最快但精度最低,在低角度(掠射角)会产生明显伪影。
 *
 * 公式(Real-Time Rendering 3rd ed. p.192):
 *   delta = dirToCameraTS.xy * height * depthFactor
 *   uv' = uv - delta
 *
 * @returns 偏移后的 UV + 切线空间偏移
 */
export function basicParallaxMapping(
  heightmap: Float32Array | ArrayLike<number>,
  width: number,
  height: number,
  uv: { u: number; v: number },
  dirToCameraTS: { x: number; y: number; z: number },
  depthFactor: number,
  wrap: 'clamp' | 'repeat' = 'clamp',
): ParallaxResult {
  const h = getNormalizedDepth(
    heightmap, width, height,
    uv.u, uv.v,
    0, depthFactor, 1 / depthFactor,
    wrap,
  );
  const deltaX = dirToCameraTS.x * h * depthFactor;
  const deltaY = dirToCameraTS.y * h * depthFactor;

  return {
    uv: { u: uv.u - deltaX, v: uv.v - deltaY },
    offsetTS: { x: -deltaX, y: -deltaY, z: 0 },
    depth: h,
    shadowAttenuation: 1,
    steps: 1,
    isClipped: false,
  };
}

/**
 * Advanced Parallax Mapping — 多步射线步进 + 可选细化算法。
 *
 * 适配自 o3de `AdvancedParallaxMapping`。沿切线空间视线方向步进,
 * 在高度场中搜索第一个交点(射线从顶部向下,找到高度场表面)。
 *
 * 算法选择:
 *   - 'steep'   — 找到粗略交点即返回(有阶梯伪影)
 *   - 'pom'     — Steep + 线性插值(标准 POM,消除阶梯)
 *   - 'relief'  — Steep + 二分查找细化(最高精度)
 *   - 'contact' — Steep + Contact refinement(Riccardi 2018,精度高采样少)
 *
 * 可选自阴影:从交点向光源方向步进,检测遮挡并计算软阴影衰减。
 *
 * @param heightmap      高度图数据
 * @param width          高度图宽度
 * @param height         高度图高度
 * @param uv             表面 UV 坐标
 * @param dirToCameraTS  切线空间视线方向(归一化,指向相机)
 * @param dirToLightTS   切线空间光源方向(归一化,指向光源)。enableShadow=true 时使用
 * @param depthFactor    深度缩放
 * @param depthOffset    深度偏移
 * @param numSteps       步数
 * @param algorithm      细化算法
 * @param enableShadow   是否计算自阴影
 * @param shadowSteps    自阴影步数(可选)
 * @param wrap           UV wrap 模式
 * @returns              POM 计算结果
 */
export function advancedParallaxMapping(
  heightmap: Float32Array | ArrayLike<number>,
  width: number,
  height: number,
  uv: { u: number; v: number },
  dirToCameraTS: { x: number; y: number; z: number },
  dirToLightTS: { x: number; y: number; z: number },
  depthFactor: number,
  depthOffset: number,
  numSteps: number,
  algorithm: ParallaxAlgorithm,
  enableShadow: boolean,
  shadowSteps?: number,
  wrap: 'clamp' | 'repeat' = 'clamp',
): ParallaxResult {
  const dirZInv = 1.0 / dirToCameraTS.z;
  const step = 1.0 / numSteps;
  let currentStep = 0.0;

  // 每步偏移量(沿视线反方向)
  const delta = {
    x: -dirToCameraTS.x * depthFactor * dirZInv * step,
    y: -dirToCameraTS.y * depthFactor * dirZInv * step,
    z: -dirToCameraTS.z * depthFactor * dirZInv * step,
  };

  const depthSearchStart = depthOffset;
  const depthSearchEnd = depthSearchStart + depthFactor;
  const inverseDepthFactor = 1.0 / depthFactor;

  // 初始偏移位置(考虑 depthOffset)
  let parallaxOffset = {
    x: -dirToCameraTS.x * dirZInv * depthOffset,
    y: -dirToCameraTS.y * dirZInv * depthOffset,
    z: -dirToCameraTS.z * dirZInv * depthOffset,
  };

  // 初始高度采样
  let currentSample = getNormalizedDepth(
    heightmap, width, height,
    uv.u + parallaxOffset.x, uv.v + parallaxOffset.y,
    depthSearchStart, depthSearchEnd, inverseDepthFactor,
    wrap,
  );
  let prevSample = currentSample;

  // ── 粗略搜索:沿射线步进直到穿过高度场表面 ──
  while (currentSample > currentStep) {
    currentStep += step;
    parallaxOffset.x += delta.x;
    parallaxOffset.y += delta.y;
    parallaxOffset.z += delta.z;
    prevSample = currentSample;
    currentSample = getNormalizedDepth(
      heightmap, width, height,
      uv.u + parallaxOffset.x, uv.v + parallaxOffset.y,
      depthSearchStart, depthSearchEnd, inverseDepthFactor,
      wrap,
    );
  }

  // ── 细化算法 ──
  switch (algorithm) {
    case 'steep':
      // 无细化,直接用粗略交点
      break;

    case 'pom': {
      // 线性插值:在 prevSample/currentSample 之间插值
      if (currentStep > 0.0) {
        const prevStep = currentStep - step;
        const currentDiff = currentStep - currentSample;
        const prevDiff = prevSample - prevStep;
        const denom = prevDiff + currentDiff;
        if (Math.abs(denom) > 1e-8) {
          const ratio = prevDiff / denom;
          parallaxOffset.x = (parallaxOffset.x - delta.x) * (1 - ratio) + parallaxOffset.x * ratio;
          parallaxOffset.y = (parallaxOffset.y - delta.y) * (1 - ratio) + parallaxOffset.y * ratio;
          parallaxOffset.z = (parallaxOffset.z - delta.z) * (1 - ratio) + parallaxOffset.z * ratio;
        }
      }
      break;
    }

    case 'relief': {
      // 二分查找细化
      if (currentStep > 0.0) {
        let reliefDelta = { ...delta };
        let reliefStep = step;
        for (let i = 0; i < numSteps; i++) {
          reliefDelta.x *= 0.5;
          reliefDelta.y *= 0.5;
          reliefDelta.z *= 0.5;
          reliefStep *= 0.5;
          const depthSign = Math.sign(currentSample - currentStep);
          parallaxOffset.x += reliefDelta.x * depthSign;
          parallaxOffset.y += reliefDelta.y * depthSign;
          parallaxOffset.z += reliefDelta.z * depthSign;
          currentStep += reliefStep * depthSign;
          currentSample = getNormalizedDepth(
            heightmap, width, height,
            uv.u + parallaxOffset.x, uv.v + parallaxOffset.y,
            depthSearchStart, depthSearchEnd, inverseDepthFactor,
            wrap,
          );
        }
      }
      break;
    }

    case 'contact': {
      // Contact refinement (Riccardi 2018)
      if (currentStep > 0.0) {
        // 回退到上一步
        parallaxOffset.x -= delta.x;
        parallaxOffset.y -= delta.y;
        parallaxOffset.z -= delta.z;
        currentStep -= step;
        currentSample = prevSample;

        // 调整精度:用 step² 作为新步长
        const adjustedDelta = {
          x: delta.x * step,
          y: delta.y * step,
          z: delta.z * step,
        };
        const adjustedStep = step * step;

        while (currentSample > currentStep) {
          currentStep += adjustedStep;
          parallaxOffset.x += adjustedDelta.x;
          parallaxOffset.y += adjustedDelta.y;
          parallaxOffset.z += adjustedDelta.z;
          prevSample = currentSample;
          currentSample = getNormalizedDepth(
            heightmap, width, height,
            uv.u + parallaxOffset.x, uv.v + parallaxOffset.y,
            depthSearchStart, depthSearchEnd, inverseDepthFactor,
            wrap,
          );
        }
      }
      break;
    }

    default:
      break;
  }

  // 裁剪:如果偏移超出表面(offset.z > 0),归零
  let isClipped = false;
  if (parallaxOffset.z > 0.0) {
    parallaxOffset = { x: 0, y: 0, z: 0 };
    isClipped = true;
  }

  // ── 自阴影计算 ──
  let shadowAttenuation = 1.0;
  if (enableShadow && (dirToLightTS.x !== 0 || dirToLightTS.y !== 0 || dirToLightTS.z !== 0)) {
    const shadowU = { u: uv.u + parallaxOffset.x, v: uv.v + parallaxOffset.y };
    const sSteps = shadowSteps ?? Math.max(1, Math.round(numSteps * currentStep));
    const shadowStep = 1.0 / sSteps;
    const lightZInv = 1.0 / dirToLightTS.z;
    const shadowDelta = {
      x: dirToLightTS.x * depthFactor * lightZInv * shadowStep,
      y: dirToLightTS.y * depthFactor * lightZInv * shadowStep,
    };

    let rayUnderSurface = false;
    let partialShadowFactor = 0;
    let shadowCurrentSample = currentSample;
    let shadowCurrentStep = currentStep;

    for (let i = 0; i < sSteps; i++) {
      if (shadowCurrentSample < shadowCurrentStep) {
        rayUnderSurface = true;
        const factor = (shadowCurrentStep - shadowCurrentSample) * (1 - (i + 1) * shadowStep);
        partialShadowFactor = Math.max(partialShadowFactor, factor);
      }
      shadowU.u += shadowDelta.x;
      shadowU.v += shadowDelta.y;
      shadowCurrentSample = getNormalizedDepth(
        heightmap, width, height,
        shadowU.u, shadowU.v,
        depthSearchStart, depthSearchEnd, inverseDepthFactor,
        wrap,
      );
      shadowCurrentStep -= step;
    }

    if (rayUnderSurface) {
      shadowAttenuation = 1.0 - partialShadowFactor;
    }
  }

  return {
    uv: { u: uv.u + parallaxOffset.x, v: uv.v + parallaxOffset.y },
    offsetTS: parallaxOffset,
    depth: currentStep,
    shadowAttenuation,
    steps: numSteps,
    isClipped,
  };
}

// ── 统一入口 ─────────────────────────────────────────────────────────

/**
 * 计算视差偏移(统一入口,与 o3de `CalculateParallaxOffset` 对应)。
 *
 * 根据 `options.algorithm` 选择 Basic 或 Advanced 路径,
 * 根据 `options.quality` / `options.numSteps` 决定步数。
 *
 * @param heightmap      高度图数据(Float32Array,单通道,[0,1])
 * @param width          高度图宽度
 * @param height         高度图高度
 * @param uv             表面 UV 坐标
 * @param dirToCameraTS  切线空间视线方向(归一化)
 * @param dirToLightTS   切线空间光源方向(归一化,自阴影用)
 * @param options        POM 配置
 * @param wrap           UV wrap 模式
 * @returns              POM 计算结果
 */
export function calculateParallaxOffset(
  heightmap: Float32Array | ArrayLike<number>,
  width: number,
  height: number,
  uv: { u: number; v: number },
  dirToCameraTS: { x: number; y: number; z: number },
  dirToLightTS: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 },
  options: ParallaxOptions = {},
  wrap: 'clamp' | 'repeat' = 'clamp',
): ParallaxResult {
  const algorithm = options.algorithm ?? 'pom';
  const depthFactor = options.depthFactor ?? 0.05;
  const depthOffset = options.depthOffset ?? 0;
  const enableShadow = options.enableShadow ?? false;

  if (algorithm === 'basic') {
    return basicParallaxMapping(heightmap, width, height, uv, dirToCameraTS, depthFactor, wrap);
  }

  const numSteps = options.numSteps ?? PARALLAX_QUALITY_STEPS[options.quality ?? 'medium'];
  const clampedSteps = Math.max(1, Math.min(256, Math.floor(numSteps)));

  return advancedParallaxMapping(
    heightmap, width, height,
    uv, dirToCameraTS, dirToLightTS,
    depthFactor, depthOffset,
    clampedSteps, algorithm, enableShadow,
    options.shadowSteps, wrap,
  );
}

// ── 像素深度偏移(Pixel Depth Offset, PDO) ──────────────────────────

/**
 * 像素深度偏移结果。
 */
export interface PixelDepthOffset {
  /** NDC 深度 [0,1](用于 gl_FragDepth)。 */
  depthNDC: number;
  /** 裁剪空间深度(可用于光照剔除)。 */
  depthCS: number;
  /** 修正后的世界空间位置。 */
  worldPosition: { x: number; y: number; z: number };
}

/**
 * 计算像素深度偏移(与 o3de `CalcPixelDepthOffset` 对应)。
 *
 * 把切线空间偏移转回世界空间,修正最终片元深度,
 * 使视差表面能正确参与深度测试 / 阴影接收 / 后处理。
 *
 * @param tangentOffset     切线空间偏移(ParallaxResult.offsetTS)
 * @param posWS             片元世界空间位置
 * @param tangentWS         世界空间切线
 * @param bitangentWS       世界空间副切线
 * @param normalWS          世界空间法线
 * @param viewProjectionMatrix  视投影矩阵(4x4,行主序)
 * @returns                 修正后的深度 + 世界位置
 */
export function calcPixelDepthOffset(
  tangentOffset: { x: number; y: number; z: number },
  posWS: { x: number; y: number; z: number },
  tangentWS: { x: number; y: number; z: number },
  bitangentWS: { x: number; y: number; z: number },
  normalWS: { x: number; y: number; z: number },
  viewProjectionMatrix: number[],
): PixelDepthOffset {
  // 切线空间 → 世界空间
  // worldOffset = T * offset.x + B * offset.y + N * offset.z
  const worldOffset = {
    x: tangentWS.x * tangentOffset.x + bitangentWS.x * tangentOffset.y + normalWS.x * tangentOffset.z,
    y: tangentWS.y * tangentOffset.x + bitangentWS.y * tangentOffset.y + normalWS.y * tangentOffset.z,
    z: tangentWS.z * tangentOffset.x + bitangentWS.z * tangentOffset.y + normalWS.z * tangentOffset.z,
  };

  const worldOffsetPosition = {
    x: posWS.x + worldOffset.x,
    y: posWS.y + worldOffset.y,
    z: posWS.z + worldOffset.z,
  };

  // 世界 → 裁剪空间(viewProjection * worldPos)
  const m = viewProjectionMatrix;
  const clipZ = m[2] * worldOffsetPosition.x + m[6] * worldOffsetPosition.y + m[10] * worldOffsetPosition.z + m[14];
  const clipW = m[3] * worldOffsetPosition.x + m[7] * worldOffsetPosition.y + m[11] * worldOffsetPosition.z + m[15];

  const depthNDC = clipW !== 0 ? clipZ / clipW : clipZ;
  const depthCS = clipW;

  return {
    depthNDC,
    depthCS,
    worldPosition: worldOffsetPosition,
  };
}

// ── GLSL Shader Chunk ───────────────────────────────────────────────

/**
 * POM GLSL 片段(嵌入 WebGL2 片段着色器)。
 *
 * 提供 `calculatePOM()` 函数,返回偏移后的 UV + 自阴影衰减。
 * 调用方在法线贴图采样前调用:
 *   vec2 parallaxUV = calculatePOM(u_heightmap, v_uv, viewDirTS, lightDirTS);
 *
 * 需要 GLSL ES 3.0(for 循环 + texture() 函数)。
 */
export const PARALLAX_POM_CHUNK = /* glsl */ `
// ParallaxOcclusionMapping — 视差遮挡贴图 (POM) GLSL 实现。
// 适配自 o3de Atom ParallaxMapping.azsli。
// 算法:Steep + POM 线性插值(标准 AAA 做法)。

uniform sampler2D u_heightmap;
uniform float u_parallaxDepthFactor;   // 深度缩放,典型 0.05
uniform float u_parallaxDepthOffset;   // 深度偏移,典型 0
uniform int   u_parallaxNumSteps;      // 步数,典型 32
uniform bool  u_parallaxEnableShadow;  // 自阴影开关
uniform float u_parallaxShadowStrength; // 阴影强度 0..1

// 切线空间视线方向(归一化,指向相机)需由调用方传入(varying)
// in vec3 v_viewDirTS;
// 切线空间光源方向(归一化,指向光源)需由调用方传入(varying)
// in vec3 v_lightDirTS;

// 高度图采样(o3de 约定:1.0 - texture.r)
float pomSampleHeight(sampler2D heightmap, vec2 uv) {
  return 1.0 - texture(heightmap, uv).r;
}

// POM 主函数:返回偏移后的 UV + 自阴影衰减(通过 out 参数)
vec2 calculatePOM(sampler2D heightmap, vec2 uv, vec3 viewDirTS,
                  out float shadowAttenuation) {
  shadowAttenuation = 1.0;

  float dirZInv = 1.0 / viewDirTS.z;
  float step = 1.0 / float(u_parallaxNumSteps);
  float currentStep = 0.0;

  vec3 delta = -viewDirTS * u_parallaxDepthFactor * dirZInv * step;

  float depthSearchStart = u_parallaxDepthOffset;
  float depthSearchEnd = depthSearchStart + u_parallaxDepthFactor;
  float inverseDepthFactor = 1.0 / u_parallaxDepthFactor;

  vec3 parallaxOffset = -viewDirTS * dirZInv * u_parallaxDepthOffset;

  float currentSample = pomSampleHeight(heightmap, uv + parallaxOffset.xy);
  float prevSample = currentSample;

  // 粗略搜索
  for (int i = 0; i < 256; i++) {
    if (i >= u_parallaxNumSteps) break;
    if (currentSample <= currentStep) break;
    currentStep += step;
    parallaxOffset += delta;
    prevSample = currentSample;
    currentSample = pomSampleHeight(heightmap, uv + parallaxOffset.xy);
  }

  // POM 线性插值
  if (currentStep > 0.0) {
    float prevStep = currentStep - step;
    float currentDiff = currentStep - currentSample;
    float prevDiff = prevSample - prevStep;
    float denom = prevDiff + currentDiff;
    if (abs(denom) > 1e-8) {
      float ratio = prevDiff / denom;
      parallaxOffset = mix(parallaxOffset - delta, parallaxOffset, ratio);
    }
  }

  // 裁剪
  if (parallaxOffset.z > 0.0) {
    parallaxOffset = vec3(0.0);
  }

  // 自阴影
  if (u_parallaxEnableShadow) {
    vec3 lightDirTS = v_lightDirTS;
    if (length(lightDirTS) > 0.001) {
      vec2 shadowUV = uv + parallaxOffset.xy;
      float shadowNumSteps = round(float(u_parallaxNumSteps) * currentStep);
      float shadowStep = 1.0 / max(1.0, shadowNumSteps);
      float lightZInv = 1.0 / lightDirTS.z;
      vec2 shadowDelta = lightDirTS.xy * u_parallaxDepthFactor * lightZInv * shadowStep;

      bool rayUnderSurface = false;
      float partialShadowFactor = 0.0;
      float shadowCurrentSample = currentSample;
      float shadowCurrentStep = currentStep;

      for (int i = 0; i < 256; i++) {
        if (float(i) >= shadowNumSteps) break;
        if (shadowCurrentSample < shadowCurrentStep) {
          rayUnderSurface = true;
          float factor = (shadowCurrentStep - shadowCurrentSample) *
                         (1.0 - float(i + 1) * shadowStep);
          partialShadowFactor = max(partialShadowFactor, factor);
        }
        shadowUV += shadowDelta;
        shadowCurrentSample = pomSampleHeight(heightmap, shadowUV);
        shadowCurrentStep -= step;
      }

      if (rayUnderSurface) {
        shadowAttenuation = 1.0 - partialShadowFactor * u_parallaxShadowStrength;
      }
    }
  }

  return uv + parallaxOffset.xy;
}

// 重载:无自阴影参数(简单调用)
vec2 calculatePOM(sampler2D heightmap, vec2 uv, vec3 viewDirTS) {
  float dummyShadow;
  return calculatePOM(heightmap, uv, viewDirTS, dummyShadow);
}
`;

/**
 * Basic Parallax Mapping GLSL 片段(单采样,最快)。
 */
export const PARALLAX_BASIC_CHUNK = /* glsl */ `
// BasicParallaxMapping — 单采样偏移(最快,精度最低)。
uniform sampler2D u_heightmap;
uniform float u_parallaxDepthFactor;

vec2 calculateBasicParallax(sampler2D heightmap, vec2 uv, vec3 viewDirTS) {
  float h = 1.0 - texture(heightmap, uv).r;
  vec2 delta = viewDirTS.xy * h * u_parallaxDepthFactor;
  return uv - delta;
}
`;

/**
 * Relief Mapping GLSL 片段(二分查找细化,最高精度)。
 */
export const PARALLAX_RELIEF_CHUNK = /* glsl */ `
// ReliefMapping — Steep + 二分查找细化(最高精度)。
uniform sampler2D u_heightmap;
uniform float u_parallaxDepthFactor;
uniform float u_parallaxDepthOffset;
uniform int   u_parallaxNumSteps;

float reliefSampleHeight(sampler2D heightmap, vec2 uv) {
  return 1.0 - texture(heightmap, uv).r;
}

vec2 calculateReliefParallax(sampler2D heightmap, vec2 uv, vec3 viewDirTS) {
  float dirZInv = 1.0 / viewDirTS.z;
  float step = 1.0 / float(u_parallaxNumSteps);
  float currentStep = 0.0;

  vec3 delta = -viewDirTS * u_parallaxDepthFactor * dirZInv * step;
  vec3 parallaxOffset = -viewDirTS * dirZInv * u_parallaxDepthOffset;

  float currentSample = reliefSampleHeight(heightmap, uv + parallaxOffset.xy);
  float prevSample = currentSample;

  // 粗略搜索
  for (int i = 0; i < 256; i++) {
    if (i >= u_parallaxNumSteps) break;
    if (currentSample <= currentStep) break;
    currentStep += step;
    parallaxOffset += delta;
    prevSample = currentSample;
    currentSample = reliefSampleHeight(heightmap, uv + parallaxOffset.xy);
  }

  // 二分查找细化
  if (currentStep > 0.0) {
    vec3 reliefDelta = delta;
    float reliefStep = step;
    for (int i = 0; i < 256; i++) {
      if (i >= u_parallaxNumSteps) break;
      reliefDelta *= 0.5;
      reliefStep *= 0.5;
      float depthSign = sign(currentSample - currentStep);
      parallaxOffset += reliefDelta * depthSign;
      currentStep += reliefStep * depthSign;
      currentSample = reliefSampleHeight(heightmap, uv + parallaxOffset.xy);
    }
  }

  if (parallaxOffset.z > 0.0) {
    parallaxOffset = vec3(0.0);
  }

  return uv + parallaxOffset.xy;
}
`;
