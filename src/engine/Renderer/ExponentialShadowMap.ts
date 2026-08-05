// ExponentialShadowMap — 指数阴影贴图(Exponential Shadow Map, ESM)。
//
// 适配自:
//   - o3de Atom `EsmShadowmapsPass` + `DepthExponentiationPass`
//   - Salvi 2008 "Fast Shadow Maps on a 1K Budget" +影场 2010
//   - Annen et al. 2008 "Exponential Shadow Maps"
//
// 核心思想(与 PCF / PCSS 对比):
//   PCF (Percentage-Closer Filtering) 在阴影测试后做滤波,无法用硬件线性过滤,
//   采样 N×N 次深度比较 → 昂贵且会 aliasing。
//   ESM 把深度 d 做 exp(-c·d) 变换后存储,利用 exp 的可加性:
//     shadow(d_receiver) ≈ exp(c·d_receiver) · E[exp(-c·d_occluder)] - 1
//   其中 E[exp(-c·d)] 是 exp 域的期望,可用线性 / 高斯滤波算出。
//   滤波后的 ESM 纹理可用硬件 bilinear / Gaussian blur,完全无 aliasing。
//
// 优势:
//   - 线性滤波合法(exp 是连续函数,期望可线性组合)
//   - 软阴影只需一次 bilinear 采样(或一次 Gaussian blur + 一次采样)
//   - 比 PCSS 便宜很多(PCSS 需 16-41 tap,ESM 需 1-9 tap)
//   - 比 VSM 不易漏光(light leaking)且无 precision 爆炸问题
//
// 劣势:
//   - c 参数需调(过大 → 精度溢出;过小 → 阴影变软)
//   - 大 penumbra 仍需 blur pass(但 blur 可分离 = 2 pass,代价低)
//
// 与现有 ShadowMapManager 的关系:
//   ShadowMapManager(type='basic'|'pcf'|'pcss') 在 GPU 端做阴影采样;
//   本模块是 ESM 的 CPU 参考实现(与 PCSSSampler 同构):
//     - `expDepthMap()`        深度 → exp 域(对应 o3de DepthExponentiationPass)
//     - `filterESM()`           exp 域 Gaussian / box blur(对应 o3de EsmBlurPass)
//     - `sampleESM()`           单次 ESM 采样
//     - `sampleESMFiltered()`   滤波后采样(主路径)
//     - `sampleESMPCF()`        对照:PCF 采样(验证用)
//   纯 CPU,Float32Array 操作,不依赖 WebGL,可在 Node/无头环境测试。
//
// 与 soup3D 的对比:
//   soup3D 只有 basic 硬阴影,无 ESM / 软阴影 / PCSS。
//   VREEN 现在有 basic / PCF / PCSS / ESM 四种阴影方案,覆盖全精度-性能谱。
//
// 参考:
//   - o3de `Gems/Atom/Feature/Common/Code/Source/CoreLights/EsmShadowmapsPass.cpp`
//   - o3de `Gems/Atom/Feature/Common/Code/Source/CoreLights/DepthExponentiationPass.cpp`
//   - Salvi 2008 "Fast Shadow Maps on a 1K Budget"
//   - Annen et al. 2008 "Exponential Shadow Maps"
//   - VREEN 用纯 CPU Float32Array 实现,无 WebGL 依赖,可在 Node/无头环境测试。

// ── 类型 ──────────────────────────────────────────────────────────

/** ESM 纹理数据(单通道 Float32,长度 = width × height)。 */
export interface ESMTexture {
  /** exp 域数据(length = width × height)。 */
  data: Float32Array;
  /** 宽度。 */
  width: number;
  /** 高度。 */
  height: number;
  /** 指数常数 c(用于采样时重建)。 */
  c: number;
}

/** ESM 采样选项。 */
export interface ESMOptions {
  /** 指数常数 c(默认 50.0)。越大阴影越锐利,但精度需求越高。 */
  c?: number;
  /** 深度偏移(默认 0.001,缓解自阴影)。 */
  bias?: number;
  /** UV 包裹模式:'clamp'(默认)| 'repeat'。 */
  wrap?: 'clamp' | 'repeat';
}

/** ESM 过滤选项。 */
export interface ESMFilterOptions {
  /** 滤波核:'box' | 'gaussian'(默认 'gaussian')。 */
  kernel?: 'box' | 'gaussian';
  /** 滤波半径(像素,默认 3)。 */
  radius?: number;
  /** Gaussian σ(默认 = radius / 2)。 */
  sigma?: number;
  /** 是否分离通道(先横后纵,默认 true,Gaussian 推荐分离)。 */
  separable?: boolean;
}

/** ESM 统计信息。 */
export interface ESMStats {
  /** 深度纹理宽度。 */
  width: number;
  /** 深度纹理高度。 */
  height: number;
  /** 指数常数 c。 */
  c: number;
  /** 滤波半径。 */
  filterRadius: number;
  /** 滤波核类型。 */
  kernel: 'box' | 'gaussian' | 'none';
  /** exp 域数据范围[min, max]。 */
  expRange: [number, number];
}

// ── 深度指数化(对应 o3de DepthExponentiationPass) ────────────────

/**
 * 把阴影贴图(深度)转换为 exp 域纹理。
 *
 * 公式:esm(x,y) = exp(c * depth(x,y))
 *
 * 注意:
 *   - depth 应为光线空间线性深度(0 = 近平面 / 接近光源,1 = 远平面)
 *   - exp(c·d) 在 d=0 时为 1,d 增大时迅速增大(遮挡物越远 → esm 越大)
 *   - c 越大,阴影越锐利,但浮点精度需求越高
 *   - 对 RGBA16F 纹理,c 上限约 10-11(exp(11) ≈ 60000 接近 half float 上限)
 *   - 对 RGBA32F 纹理,c 上限约 80(exp(80) ≈ 5.5e34,接近 float32 上限)
 *
 * 与 o3de DepthExponentiation.azsl 一致:存储 exp(occluderDepth * esmExponent)。
 *
 * @param shadowMap  深度数据(Float32Array,length = width × height)
 * @param width      纹理宽度
 * @param height     纹理高度
 * @param c          指数常数(默认 50.0,16-bit 纹理建议 ≤ 11)
 * @returns          ESM 纹理
 */
export function expDepthMap(
  shadowMap: Float32Array | ArrayLike<number>,
  width: number,
  height: number,
  c: number = 50.0,
): ESMTexture {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const d = shadowMap[i];
    // 限制深度范围避免 exp 溢出
    const clampedDepth = Math.max(0, Math.min(1, d));
    data[i] = Math.exp(c * clampedDepth);
  }
  return { data, width, height, c };
}

// ── 过滤(对应 o3de EsmBlurPass) ──────────────────────────────────

/**
 * 一维 Gaussian 权重(用于可分离滤波)。
 *
 * 公式:w(x) = exp(-x² / (2σ²)) / (σ·√(2π))
 *
 * 返回 length = 2*radius+1 的权重数组(对称)。
 */
export function gaussianWeights(radius: number, sigma: number): Float32Array {
  const weights = new Float32Array(radius * 2 + 1);
  const invTwoSigmaSq = 1.0 / (2.0 * sigma * sigma);
  const invSqrtTwoPiSigma = 1.0 / (sigma * Math.sqrt(2.0 * Math.PI));
  let sum = 0.0;
  for (let i = -radius; i <= radius; i++) {
    const w = invSqrtTwoPiSigma * Math.exp(-(i * i) * invTwoSigmaSq);
    weights[i + radius] = w;
    sum += w;
  }
  // 归一化(数值稳定)
  const invSum = 1.0 / sum;
  for (let i = 0; i < weights.length; i++) {
    weights[i] *= invSum;
  }
  return weights;
}

/**
 * UV 包裹辅助。
 */
function wrapCoord(x: number, size: number, mode: 'clamp' | 'repeat'): number {
  if (mode === 'repeat') {
    // 正确的取模(处理负数)
    return ((x % size) + size) % size;
  }
  return Math.max(0, Math.min(size - 1, x));
}

/**
 * 单通道纹理水平方向滤波(可分离 Gaussian / box 的第一步)。
 *
 * 输入:src(Float32Array,width × height)
 * 输出:中间结果(同尺寸)
 */
function filterHorizontal(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  weights: Float32Array | null,
  wrap: 'clamp' | 'repeat',
): Float32Array {
  const dst = new Float32Array(width * height);
  const isBox = weights === null;
  const boxInv = isBox ? 1.0 / (radius * 2 + 1) : 0;

  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0.0;
      for (let dx = -radius; dx <= radius; dx++) {
        const sx = wrapCoord(x + dx, width, wrap);
        const w = isBox ? boxInv : weights![dx + radius];
        sum += src[rowOff + sx] * w;
      }
      dst[rowOff + x] = sum;
    }
  }
  return dst;
}

/**
 * 单通道纹理垂直方向滤波(可分离 Gaussian / box 的第二步)。
 */
function filterVertical(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  weights: Float32Array | null,
  wrap: 'clamp' | 'repeat',
): Float32Array {
  const dst = new Float32Array(width * height);
  const isBox = weights === null;
  const boxInv = isBox ? 1.0 / (radius * 2 + 1) : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0.0;
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = wrapCoord(y + dy, height, wrap);
        const w = isBox ? boxInv : weights![dy + radius];
        sum += src[sy * width + x] * w;
      }
      dst[y * width + x] = sum;
    }
  }
  return dst;
}

/**
 * 不可分离 2D 滤波(用于对照测试,实际推荐 separable)。
 */
function filter2D(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  weights: Float32Array | null,
  wrap: 'clamp' | 'repeat',
): Float32Array {
  const dst = new Float32Array(width * height);
  const isBox = weights === null;
  const boxInv = isBox ? 1.0 / ((radius * 2 + 1) * (radius * 2 + 1)) : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0.0;
      for (let dy = -radius; dy <= radius; dy++) {
        const sy = wrapCoord(y + dy, height, wrap);
        for (let dx = -radius; dx <= radius; dx++) {
          const sx = wrapCoord(x + dx, width, wrap);
          const w = isBox ? boxInv : (weights![dx + radius] * weights![dy + radius]);
          sum += src[sy * width + sx] * w;
        }
      }
      dst[y * width + x] = sum;
    }
  }
  return dst;
}

/**
 * 对 ESM 纹理做滤波(Gaussian 或 box,可选分离)。
 *
 * 滤波后 exp 域存储的是 E[exp(-c·d)](期望),可用于软阴影采样。
 * Gaussian 滤波会产生更平滑的软阴影,box 滤波更快但稍粗糙。
 *
 * @param esm      输入 ESM 纹理
 * @param options  滤波选项
 * @returns        滤波后的 ESM 纹理(新对象,不修改输入)
 */
export function filterESM(
  esm: ESMTexture,
  options: ESMFilterOptions = {},
): ESMTexture {
  const kernel = options.kernel ?? 'gaussian';
  const radius = Math.max(0, Math.floor(options.radius ?? 3));
  const sigma = options.sigma ?? radius / 2.0;
  const separable = options.separable ?? true;

  if (radius === 0) {
    // 无滤波,直接返回拷贝
    return {
      data: new Float32Array(esm.data),
      width: esm.width,
      height: esm.height,
      c: esm.c,
    };
  }

  const weights = kernel === 'gaussian' ? gaussianWeights(radius, sigma) : null;
  const wrap: 'clamp' | 'repeat' = 'clamp';

  let filtered: Float32Array;
  if (separable) {
    // 分离滤波:先横后纵(代价 = 2 × radius × width × height)
    const horizontal = filterHorizontal(esm.data, esm.width, esm.height, radius, weights, wrap);
    filtered = filterVertical(horizontal, esm.width, esm.height, radius, weights, wrap);
  } else {
    // 不可分离 2D 滤波(代价 = (2×radius+1)² × width × height)
    filtered = filter2D(esm.data, esm.width, esm.height, radius, weights, wrap);
  }

  return {
    data: filtered,
    width: esm.width,
    height: esm.height,
    c: esm.c,
  };
}

// ── 采样 ──────────────────────────────────────────────────────────

/**
 * 单次 ESM 采样(无滤波,用于硬阴影或已滤波纹理)。
 *
 * 公式(与 o3de ESM.azsli SampleESM 一致):
 *   visibility = clamp(exp(-c · d_receiver) · ESM[u,v], 0, 1)
 *             = clamp(exp(c · (d_occluder - d_receiver)), 0, 1)
 *
 * 其中 ESM[u,v] = exp(c · d_occluder)(已 exp 化)。
 *
 * 当 d_receiver <= d_occluder(接收者更近,无遮挡)时:
 *   exp(c·(d_o - d_r)) >= exp(0) = 1 → visibility = 1(全亮)
 * 当 d_receiver > d_occluder(接收者更远,被遮挡)时:
 *   exp(c·(d_o - d_r)) 随差值增大迅速衰减 → visibility → 0(全暗)
 *
 * @param esm            ESM 纹理(已 exp 化,可选已滤波)
 * @param u              U 坐标 [0, 1]
 * @param v              V 坐标 [0, 1]
 * @param receiverDepth  接收者深度(光线空间,0..1)
 * @param options        采样选项
 * @returns              可见度 [0, 1](1 = 全亮,0 = 全暗)
 */
export function sampleESM(
  esm: ESMTexture,
  u: number,
  v: number,
  receiverDepth: number,
  options: ESMOptions = {},
): number {
  const c = options.c ?? esm.c;
  const bias = options.bias ?? 0.001;
  const wrap = options.wrap ?? 'clamp';

  // UV → texel 坐标(中心采样)
  const fx = u * esm.width - 0.5;
  const fy = v * esm.height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  // 4-tap bilinear(线性滤波对 ESM 合法,这是 ESM 的核心优势)
  const x0w = wrapCoord(x0, esm.width, wrap);
  const x1w = wrapCoord(x0 + 1, esm.width, wrap);
  const y0w = wrapCoord(y0, esm.height, wrap);
  const y1w = wrapCoord(y0 + 1, esm.height, wrap);

  const v00 = esm.data[y0w * esm.width + x0w];
  const v10 = esm.data[y0w * esm.width + x1w];
  const v01 = esm.data[y1w * esm.width + x0w];
  const v11 = esm.data[y1w * esm.width + x1w];

  const v0 = v00 * (1 - tx) + v10 * tx;
  const v1 = v01 * (1 - tx) + v11 * tx;
  const esmValue = v0 * (1 - ty) + v1 * ty;

  // ESM 重建(与 o3de 一致):visibility = exp(-c · d_receiver) · ESM[u,v]
  const dReceiver = Math.max(0, Math.min(1, receiverDepth - bias));
  const visibility = Math.exp(-c * dReceiver) * esmValue;

  // 限制到 [0, 1]
  return Math.max(0, Math.min(1, visibility));
}

/**
 * 带滤波的 ESM 采样(主路径:内联 box 滤波)。
 *
 * 与 `filterESM + sampleESM` 的区别:
 *   - `filterESM` 预先滤波整张纹理(适合多像素复用)
 *   - 本函数在采样时即时滤波(单像素查询,适合测试 / 离线烘焙)
 *
 * @param esm            ESM 纹理(未滤波)
 * @param u              U 坐标
 * @param v              V 坐标
 * @param receiverDepth  接收者深度
 * @param filterRadius   滤波半径(像素,默认 2)
 * @param options        采样选项
 * @returns              可见度 [0, 1]
 */
export function sampleESMFiltered(
  esm: ESMTexture,
  u: number,
  v: number,
  receiverDepth: number,
  filterRadius: number = 2,
  options: ESMOptions = {},
): number {
  if (filterRadius <= 0) {
    return sampleESM(esm, u, v, receiverDepth, options);
  }

  const c = options.c ?? esm.c;
  const bias = options.bias ?? 0.001;
  const wrap = options.wrap ?? 'clamp';
  const dReceiver = Math.max(0, Math.min(1, receiverDepth - bias));

  // 在 UV 周围做 N×N box 滤波(对 ESM 域)
  const px = u * esm.width - 0.5;
  const py = v * esm.height - 0.5;
  let sum = 0.0;
  let count = 0;

  for (let dy = -filterRadius; dy <= filterRadius; dy++) {
    for (let dx = -filterRadius; dx <= filterRadius; dx++) {
      const sx = wrapCoord(Math.round(px + dx), esm.width, wrap);
      const sy = wrapCoord(Math.round(py + dy), esm.height, wrap);
      sum += esm.data[sy * esm.width + sx];
      count++;
    }
  }

  const avgEsm = sum / count;
  // ESM 重建(与 o3de 一致):visibility = exp(-c · d_receiver) · ESM[u,v]
  const visibility = Math.exp(-c * dReceiver) * avgEsm;
  return Math.max(0, Math.min(1, visibility));
}

/**
 * PCF 采样(对照实现,用于验证 ESM 正确性)。
 *
 * 标准百分比接近过滤:N×N 深度比较 + 平均。
 * 与 ShadowMapManager(type='pcf') 的 GPU 实现一致。
 *
 * @param shadowMap      原始深度纹理(未 exp 化)
 * @param width          纹理宽度
 * @param height         纹理高度
 * @param u              U 坐标
 * @param v              V 坐标
 * @param receiverDepth  接收者深度
 * @param radius         PCF 半径(像素,默认 1,即 3×3)
 * @param bias           深度偏移
 * @returns              可见度 [0, 1]
 */
export function sampleESMPCF(
  shadowMap: Float32Array | ArrayLike<number>,
  width: number,
  height: number,
  u: number,
  v: number,
  receiverDepth: number,
  radius: number = 1,
  bias: number = 0.001,
): number {
  const px = u * width - 0.5;
  const py = v * height - 0.5;
  let sum = 0.0;
  let count = 0;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const sx = Math.max(0, Math.min(width - 1, Math.round(px + dx)));
      const sy = Math.max(0, Math.min(height - 1, Math.round(py + dy)));
      const occluderDepth = shadowMap[sy * width + sx];
      // 接收者深度 > 遮挡者深度(更远)→ 被遮挡
      sum += receiverDepth - bias > occluderDepth ? 0.0 : 1.0;
      count++;
    }
  }

  return sum / count;
}

// ── 工具函数 ──────────────────────────────────────────────────────

/**
 * 创建测试用阴影贴图:中心有遮挡物,周围为空。
 *
 * @param width    宽度
 * @param height   高度
 * @param blockerX 遮挡物中心 X(归一化 0..1,默认 0.5)
 * @param blockerY 遮挡物中心 Y(归一化 0..1,默认 0.5)
 * @param blockerSize 遮挡物尺寸(归一化,默认 0.5)
 * @param blockerDepth 遮挡物深度(0..1,默认 0.3)
 * @param emptyDepth    空区域深度(0..1,默认 1.0 = 远)
 * @returns       深度数据(Float32Array)
 */
export function makeBlockerShadowMapESM(
  width: number,
  height: number,
  blockerX: number = 0.5,
  blockerY: number = 0.5,
  blockerSize: number = 0.5,
  blockerDepth: number = 0.3,
  emptyDepth: number = 1.0,
): Float32Array {
  const data = new Float32Array(width * height).fill(emptyDepth);
  const halfSize = blockerSize / 2;
  const minX = Math.floor((blockerX - halfSize) * width);
  const maxX = Math.floor((blockerX + halfSize) * width);
  const minY = Math.floor((blockerY - halfSize) * height);
  const maxY = Math.floor((blockerY + halfSize) * height);
  for (let y = Math.max(0, minY); y < Math.min(height, maxY); y++) {
    for (let x = Math.max(0, minX); x < Math.min(width, maxX); x++) {
      data[y * width + x] = blockerDepth;
    }
  }
  return data;
}

/**
 * 创建平坦阴影贴图(所有像素同一深度,用于测试)。
 */
export function makeFlatShadowMapESM(
  width: number,
  height: number,
  depth: number = 0.5,
): Float32Array {
  return new Float32Array(width * height).fill(depth);
}

/**
 * 获取 ESM 纹理的统计信息。
 */
export function getESMStats(
  esm: ESMTexture,
  filterRadius: number = 0,
  kernel: 'box' | 'gaussian' | 'none' = 'none',
): ESMStats {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < esm.data.length; i++) {
    const v = esm.data[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return {
    width: esm.width,
    height: esm.height,
    c: esm.c,
    filterRadius,
    kernel,
    expRange: [min, max],
  };
}

// ── GLSL 着色器 chunk(GPU 端可直接使用,与 CPU 参考实现同公式) ────

/**
 * ESM 采样 GLSL 工具(chunk,可内嵌到阴影 fragment shader)。
 *
 * 与 o3de ESM.azsli SampleESM 一致。
 *
 * 用法:
 *   uniform sampler2D u_esmMap;       // 已 exp 化 + 已滤波
 *   uniform float     u_esmC;         // 指数常数 c
 *   ...
 *   float vis = sampleESM(u_esmMap, u_esmC, uv, receiverDepth, 0.001);
 */
export const ESM_SAMPLE_GLSL = /* glsl */ `
// ESM 单次采样(bilinear 滤波由硬件 texture() 自动完成)
// 与 o3de ESM.azsli SampleESM 一致:
//   visibility = exp(-c * d_receiver) * ESM[u,v]
//             = exp(c * (d_occluder - d_receiver))
float sampleESM(sampler2D esmMap, float c, vec2 uv, float receiverDepth, float bias) {
    float esmValue = texture(esmMap, uv).r;
    float dReceiver = clamp(receiverDepth - bias, 0.0, 1.0);
    float visibility = exp(-c * dReceiver) * esmValue;
    return clamp(visibility, 0.0, 1.0);
}

// ESM 多次采样(手动 N×N box 滤波,用于未滤波纹理)
float sampleESMBox(sampler2D esmMap, float c, vec2 uv,
                   float receiverDepth, float bias, int radius, vec2 texelSize) {
    float dReceiver = clamp(receiverDepth - bias, 0.0, 1.0);
    float sum = 0.0;
    int count = 0;
    for (int dy = -radius; dy <= radius; dy++) {
        for (int dx = -radius; dx <= radius; dx++) {
            vec2 offset = vec2(float(dx), float(dy)) * texelSize;
            sum += texture(esmMap, uv + offset).r;
            count++;
        }
    }
    float avgEsm = sum / float(count);
    float visibility = exp(-c * dReceiver) * avgEsm;
    return clamp(visibility, 0.0, 1.0);
}

// 深度指数化(用于 DepthExponentiationPass shader)
// 与 o3de DepthExponentiation.azsl 一致:esmValue = exp(c * depth)
float expDepth(float depth, float c) {
    return exp(c * clamp(depth, 0.0, 1.0));
}
`;
