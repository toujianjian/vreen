// Interpolant — 参数化采样的插值器抽象基类。
//
// 适配自 three.js r169 `src/math/Interpolant.js`(Math 目录)。它是关键帧动画
// `KeyframeTrack` 的核心基石:给定一维参数序列(通常是时间或路径弧长)与
// 多维采样值序列,在任意参数位置 t 处求出一个插值结果,写入复用的 resultBuffer。
//
// 设计采用 Template Method 模式:本类负责「区间查找」(在 parameterPositions 里
// 定位 t 落在哪两个样本之间,并维护缓存下标以摊销为 O(1)),子类只覆写
// `interpolate_(i1, t0, t, t1)` 完成实际插值,以及可选的 `intervalChanged_` 钩子。
//
// 时间复杂度:顺序(顺序增长的 t)访问跨至多两点为 O(1);随机访问为 O(log N),
// N 为样点数 —— 这归功于缓存下标 + 附近线性扫描 + 二分回退的组合查找。
//
// 与 VREEN 现有 `Animation/` 模块的关系:Animation/Mixer 当前直接驱动 clip;
// Interpolant 作为更底层的纯数据插值层,是未来 KeyframeTrack / 数值轨道插值
// 的地基,与面向对象的动画系统解耦便于测试与离线复现。
//
// 参考文档: http://www.oodesign.com/template-method-pattern.html
// 见 three.js Interpolant.js 头注释的算法推导。

/**
 * 插值类型常量(用于声明一条轨道用哪种插值策略)。
 * 适配自 three.js `src/constants.js`,数值与上游一致以兼容序列化。
 */
export const InterpolateDiscrete = 2300; // 离散(阶梯):取前一个采样值,不平滑
export const InterpolateLinear = 2301; // 线性插值
export const InterpolateSmooth = 2302; // 平滑插值(三次样条,C1 连续)

/**
 * 三次样条端点策略常量(仅 CubicInterpolant 用)。
 * 决定参数落到曲线首/末区间之外(或回绕)时如何构造虚拟外延样点。
 */
export const ZeroCurvatureEnding = 2400; // 自然样条:二阶导 f''(端点)=0
export const ZeroSlopeEnding = 2401; // 零斜率:一阶导 f'(端点)=0
export const WrapAroundEnding = 2402; // 回绕:用曲线另一端的样点外延

/** 端点策略选项联合类型。 */
export type EndingPolicy =
  | typeof ZeroCurvatureEnding
  | typeof ZeroSlopeEnding
  | typeof WrapAroundEnding;

/**
 * 采样值/参数序列的最小约束:**可索引读写**的数值数组。
 *
 * three.js 用松散 JS `Array | TypedArray`,等价于这里允许 `Float32Array`(动画数据
 * 最常用)、`number[]`,以及任意 typed 数组(common 分量)。`Float32Array` 的索引签名
 * 是只读的,所以不能用 `ArrayLike<number>`(那会禁止写入 resultBuffer);改用本联合
 * 的最小约束接口:支持数值索引读写 + length。出错原因正是 ArrayLike 的索引签名 readonly。
 */
export type WritableNumberArray =
  | Float32Array
  | Float64Array
  | Int8Array
  | Int16Array
  | Int32Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | number[];

// 内部别名,保持类内简洁
type SampleArray = WritableNumberArray;

/**
 * 端点策略设置(传给 CubicInterpolant 的 settings)。
 * `endingStart` / `endingEnd` 各取一个 EndingPolicy;
 * 普通线性/离散插值器不读 settings,可留默认。
 */
export interface InterpolantSettings {
  endingStart?: EndingPolicy;
  endingEnd?: EndingPolicy;
}

/**
 * 参数化采样插值器抽象基类。子类必须实现 {@link Interpolant.interpolate_}。
 *
 * @abstract
 */
export abstract class Interpolant {
  /** 参数位置序列(单调非减的时间/弧长采样点)。 */
  parameterPositions: SampleArray;

  /** 区间查找缓存下标 —— 顺序访问时摊销 O(1) 的关键,不要外部修改。 */
  _cachedIndex = 0;

  /** 结果缓冲,evaluate 写入并返回它(复用避免 GC)。 */
  resultBuffer: SampleArray;

  /** 采样值序列,按 stride 分块。 */
  sampleValues: SampleArray;

  /** 单个采样值的分量数(value size)。 */
  valueSize: number;

  /** 运行时设置(如三次样条策略);为 null 时用 DefaultSettings_。 */
  settings: InterpolantSettings | null = null;

  /** 子类可覆写的默认设置。 */
  DefaultSettings_: InterpolantSettings = {};

  /**
   * @param parameterPositions 参数位置序列。
   * @param sampleValues 采样值序列。
   * @param sampleSize 单个采样值的分量数(value size)。
   * @param resultBuffer 可选结果缓冲;缺省时按 sampleValues 的构造器分配 sampleSize 长度。
   */
  constructor(
    parameterPositions: SampleArray,
    sampleValues: SampleArray,
    sampleSize: number,
    resultBuffer?: SampleArray,
  ) {
    this.parameterPositions = parameterPositions;
    this.sampleValues = sampleValues;
    this.valueSize = sampleSize;
    // 缺省时用与 sampleValues 同类型构造器新建一个长度=valueSize 的缓冲
    this.resultBuffer =
      resultBuffer ??
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new (sampleValues as any).constructor(sampleSize) as SampleArray;
  }

  /**
   * 在参数位置 `t` 处求值,结果写入 resultBuffer 并返回它。
   *
   * 区间查找采用「缓存下标 + 附近线性扫描 + 二分回退」三段式:顺序增长的 t 命中
   * 缓存邻域走线性扫描 O(1);随机跳到远处则回退到该侧二分查找 O(log N)。这与
   * three.js 实现逐行一致(labeled loops 保留了原控制流,见行内注释)。
   *
   * @param t 参数位置。
   * @returns resultBuffer。
   */
  evaluate(t: number): SampleArray {
    const pp = this.parameterPositions;
    let i1 = this._cachedIndex;
    let t1 = pp[i1] as number;
    let t0 = pp[i1 - 1] as number;

    // 注意:typed array(以及普通数组)读越界下标返回 undefined。
    // three.js 利用这一点做边界判定 —— 下方 `=== undefined` 分支因此对
    // Float32Array 等同样有效(pp[-1] / pp[len] 都是 undefined)。
    validate_interval: {
      seek: {
        let right: number;

        linear_scan: {
          //- See http://jsperf.com/comparison-to-undefined/3
          forward_scan: if (t1 === undefined || !(t < t1)) {
            for (let giveUpAt = i1 + 2; ; ) {
              if (t1 === undefined) {
                if (t < t0) break forward_scan;

                // 落在末点之后 -> 钳制到最后一个采样值
                i1 = pp.length;
                this._cachedIndex = i1;
                return this.copySampleValue_(i1 - 1);
              }

              if (i1 === giveUpAt) break; // 放弃线性扫描,转二分

              t0 = t1;
              t1 = pp[++i1] as number;

              if (t < t1) {
                // 找到落点区间
                break seek;
              }
            }

            // 在缓存右侧准备二分
            right = pp.length;
            break linear_scan;
          }

          if (t0 === undefined || !(t >= t0)) {
            // backscan: t 在缓存左侧

            const t1global = pp[1] as number;

            if (t < t1global) {
              i1 = 2; // +1,细节见扫描循环
              t0 = t1global;
            }

            for (let giveUpAt = i1 - 2; ; ) {
              if (t0 === undefined) {
                // 落在首点之前 -> 钳制到第一个采样值
                this._cachedIndex = 0;
                return this.copySampleValue_(0);
              }

              if (i1 === giveUpAt) break;

              t1 = t0;
              t0 = pp[--i1 - 1] as number;

              if (t >= t0) {
                break seek;
              }
            }

            // 在缓存左侧准备二分
            right = i1;
            i1 = 0;
            break linear_scan;
          }

          // 缓存区间仍然有效,直接插值
          break validate_interval;
        } // linear_scan

        // 二分查找(回退路径)
        while (i1 < right) {
          const mid = (i1 + right) >>> 1;

          if (t < (pp[mid] as number)) {
            right = mid;
          } else {
            i1 = mid + 1;
          }
        }

        t1 = pp[i1] as number;
        t0 = pp[i1 - 1] as number;

        // 二分后再次核查边界

        if (t0 === undefined) {
          this._cachedIndex = 0;
          return this.copySampleValue_(0);
        }

        if (t1 === undefined) {
          i1 = pp.length;
          this._cachedIndex = i1;
          return this.copySampleValue_(i1 - 1);
        }
      } // seek

      this._cachedIndex = i1;
      this.intervalChanged_(i1, t0, t1);
    } // validate_interval

    return this.interpolate_(i1, t0, t, t1);
  }

  /** 返回当前生效的设置(优先 settings,否则默认)。 */
  getSettings_(): InterpolantSettings {
    return this.settings ?? this.DefaultSettings_;
  }

  /**
   * 把第 `index` 个采样值原样拷贝到 resultBuffer(用于越界钳制)。
   * @param index 采样值下标(以 valueSize 为单位)。
   */
  copySampleValue_(index: number): SampleArray {
    const result = this.resultBuffer;
    const values = this.sampleValues;
    const stride = this.valueSize;
    const offset = index * stride;

    for (let i = 0; i !== stride; ++i) {
      result[i] = values[offset + i];
    }
    return result;
  }

  /**
   * 实际插值 —— 子类必须实现,返回 this.resultBuffer。
   * @param i1 当前区间右端(下个采样点)的索引。
   * @param t0 当前区间左端(上个采样点)的参数。
   * @param t  待求参数。
   * @param t1 当前区间右端的参数。
   */
  abstract interpolate_(
    i1: number,
    t0: number,
    t: number,
    t1: number,
  ): SampleArray;

  /**
   * 区间变化钩子(可选)。子类(如 CubicInterpolant)在区间切换时预计算
   * 邻接样点权重/偏移。默认空实现。
   */
  intervalChanged_(_i1: number, _t0: number, _t1: number): void {
    // 默认无操作
  }
}
