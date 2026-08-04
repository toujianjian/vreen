// LightingChannelMask — 灯光通道掩码(适配自 o3de Atom LightingChannelConfiguration)。
//
// 概念:
//   每盏灯与每个可被照亮的物体都持有一个 32 位"灯光通道掩码"。
//   渲染时,只有当 (lightMask & objectMask) != 0 时,该灯才照亮该物体。
//   默认掩码 = ALL_LIGHTING_CHANNELS(全 1),即"所有灯照亮所有物体"(向后兼容)。
//
// 用途(顶级引擎必备,o3de/Unreal/Unity 都有):
//   - 角色专属灯:玩家身上的手电筒只照亮玩家,不照亮环境
//   - 枪口闪光灯:只照亮敌人与附近物体,不照亮整张地图
//   - UI 灯:场景里的发光面板不污染角色光照
//   - 分区灯:室内灯不漏到室外
//   - 触发器灯:只有进入触发器的物体被照亮
//
// 与 soup3D 对比:
//   soup3D 是面向初学者的 Python 引擎,所有灯照亮所有物体,无通道概念。
//   VREEN 提供 32 个灯光通道,支持精细的灯-物体过滤,符合 o3de/Unreal 标准。
//
// 参考:
//   - o3de Atom `LightingChannelConfiguration.h/.cpp`(5 通道,bool 数组)
//   - Unreal Engine `ELightingChannel`(32 通道,位掩码)
//   - VREEN 扩展为 32 通道(与 Unreal 对齐),用 number 位运算实现。

// ── 常量 ──────────────────────────────────────────────────────────

/** 灯光通道掩码(32 位 bitmask)。bit i = 1 表示该物体/灯属于通道 i。 */
export type LightingChannelMask = number;

/** 最大通道数(32 位)。 */
export const MAX_LIGHTING_CHANNELS = 32;

/** "所有通道"掩码 — 默认值,所有灯照亮所有物体(向后兼容)。 */
export const ALL_LIGHTING_CHANNELS: LightingChannelMask = 0xFFFFFFFF;

/** "无通道"掩码 — 物体永不被照亮(用于纯自发光物体)。 */
export const NO_LIGHTING_CHANNELS: LightingChannelMask = 0x00000000;

/** 默认单通道掩码(通道 0)。 */
export const DEFAULT_LIGHTING_CHANNEL: LightingChannelMask = 0x00000001;

// ── 纯函数(无副作用,可独立测试) ─────────────────────────────────

/**
 * 构造单通道掩码:仅通道 `index` 为 1。
 *
 * @param index  通道索引(0..31)
 * @returns      掩码 `1 << index`
 */
export function channelMask(index: number): LightingChannelMask {
  if (index < 0 || index >= MAX_LIGHTING_CHANNELS) {
    throw new RangeError(`channelMask: index ${index} out of range [0, ${MAX_LIGHTING_CHANNELS})`);
  }
  return (1 << index) >>> 0;
}

/**
 * 构造多通道掩码:把若干通道索引合并为一个掩码。
 *
 * @param indices  通道索引列表(0..31)
 * @returns        通道索引按位或后的掩码
 */
export function channelsMask(...indices: number[]): LightingChannelMask {
  let mask = 0;
  for (const i of indices) {
    if (i < 0 || i >= MAX_LIGHTING_CHANNELS) {
      throw new RangeError(`channelsMask: index ${i} out of range [0, ${MAX_LIGHTING_CHANNELS})`);
    }
    mask |= 1 << i;
  }
  return mask >>> 0;
}

/**
 * 读取掩码中指定通道是否开启。
 *
 * @param mask    掩码
 * @param index   通道索引(0..31)
 * @returns       该通道是否开启
 */
export function getChannel(mask: LightingChannelMask, index: number): boolean {
  if (index < 0 || index >= MAX_LIGHTING_CHANNELS) {
    throw new RangeError(`getChannel: index ${index} out of range [0, ${MAX_LIGHTING_CHANNELS})`);
  }
  return (mask & (1 << index)) !== 0;
}

/**
 * 设置掩码中指定通道的开/关,返回新掩码(不修改原值)。
 *
 * @param mask    原掩码
 * @param index   通道索引(0..31)
 * @param on      true=开启,false=关闭
 * @returns       新掩码
 */
export function setChannel(
  mask: LightingChannelMask,
  index: number,
  on: boolean,
): LightingChannelMask {
  if (index < 0 || index >= MAX_LIGHTING_CHANNELS) {
    throw new RangeError(`setChannel: index ${index} out of range [0, ${MAX_LIGHTING_CHANNELS})`);
  }
  const bit = (1 << index) >>> 0;
  return (on ? (mask | bit) : (mask & ~bit)) >>> 0;
}

/**
 * 判断一盏灯是否照亮一个物体。
 *
 * 规则:`(lightMask & objectMask) !== 0` — 灯与物体共享至少一个通道时照亮。
 * 这是 o3de/Unreal 的标准"灯-物体过滤"测试。
 *
 * @param lightMask    灯的通道掩码
 * @param objectMask   物体的通道掩码
 * @returns            是否照亮
 */
export function affects(
  lightMask: LightingChannelMask,
  objectMask: LightingChannelMask,
): boolean {
  return (lightMask & objectMask) !== 0;
}

/**
 * 判断掩码是否影响默认配置(即任意通道开启)。
 * 等价于 `affects(mask, ALL_LIGHTING_CHANNELS)`,但语义更清晰。
 *
 * @param mask  掩码
 * @returns     是否至少有一个通道开启
 */
export function hasAnyChannel(mask: LightingChannelMask): boolean {
  return mask !== 0;
}

/**
 * 计算掩码中开启的通道数(用途:调试、序列化校验)。
 *
 * @param mask  掩码
 * @returns     开启的通道数(0..32)
 */
export function countChannels(mask: LightingChannelMask): number {
  // Brian Kernighan 算法:每次 n &= n-1 清除最低位 1
  let n = mask >>> 0; // 强制无符号
  let count = 0;
  while (n) {
    n &= n - 1;
    count++;
  }
  return count;
}

/**
 * 列出掩码中所有开启的通道索引(升序)。
 *
 * @param mask  掩码
 * @returns     通道索引数组(如 [0, 3, 5])
 */
export function listChannels(mask: LightingChannelMask): number[] {
  const result: number[] = [];
  let n = mask >>> 0;
  let i = 0;
  while (n && i < MAX_LIGHTING_CHANNELS) {
    if (n & 1) result.push(i);
    n >>>= 1;
    i++;
  }
  return result;
}

// ── LightingChannelConfiguration 类(镜像 o3de 的 Configuration) ───

/**
 * 灯光通道配置 — 包装一个 32 位掩码,提供流畅 API 与序列化。
 *
 * 镜像 o3de Atom `LightingChannelConfiguration`:
 *   - o3de 用 `array<bool, 5>` 存储前 5 个通道
 *   - VREEN 用 `number` 存储全部 32 个通道(与 Unreal 对齐)
 *   - 默认 = ALL_LIGHTING_CHANNELS(全开,向后兼容)
 *
 * 可附加到 Light / Mesh / Material 上作为 `lightingChannelMask` 字段。
 */
export class LightingChannelConfiguration {
  /** 内部掩码。默认全开(所有灯照亮所有物体)。 */
  private _mask: LightingChannelMask;

  constructor(mask: LightingChannelMask = ALL_LIGHTING_CHANNELS) {
    this._mask = mask >>> 0;
  }

  /** 当前掩码值(只读视图)。 */
  get mask(): LightingChannelMask {
    return this._mask;
  }

  /** 直接设置整个掩码。 */
  setMask(mask: LightingChannelMask): this {
    this._mask = mask >>> 0;
    return this;
  }

  /** 读取指定通道是否开启。 */
  getChannel(index: number): boolean {
    return getChannel(this._mask, index);
  }

  /** 设置指定通道开/关(链式)。 */
  setChannel(index: number, on: boolean): this {
    this._mask = setChannel(this._mask, index, on) >>> 0;
    return this;
  }

  /** 开启指定通道(链式)。 */
  enableChannel(index: number): this {
    return this.setChannel(index, true);
  }

  /** 关闭指定通道(链式)。 */
  disableChannel(index: number): this {
    return this.setChannel(index, false);
  }

  /** 只开启指定通道(关闭其他所有)。 */
  setSingleChannel(index: number): this {
    this._mask = channelMask(index);
    return this;
  }

  /** 开启若干通道(不清除已有的)。 */
  enableChannels(...indices: number[]): this {
    this._mask = (this._mask | channelsMask(...indices)) >>> 0;
    return this;
  }

  /** 重置为全开(默认状态,所有灯照亮所有物体)。 */
  reset(): this {
    this._mask = ALL_LIGHTING_CHANNELS;
    return this;
  }

  /** 重置为全关(物体永不被照亮)。 */
  clear(): this {
    this._mask = NO_LIGHTING_CHANNELS;
    return this;
  }

  /** 判断本配置是否照亮(影响)另一个配置。 */
  affects(other: LightingChannelConfiguration | LightingChannelMask): boolean {
    const otherMask = typeof other === 'number' ? other : other.mask;
    return affects(this._mask, otherMask);
  }

  /** 开启的通道数。 */
  count(): number {
    return countChannels(this._mask);
  }

  /** 开启的通道索引列表。 */
  list(): number[] {
    return listChannels(this._mask);
  }

  /** 是否为默认配置(全开)。 */
  isDefault(): boolean {
    return this._mask === ALL_LIGHTING_CHANNELS;
  }

  /** 序列化为 JSON(便于场景保存)。 */
  toJSON(): { mask: number } {
    return { mask: this._mask >>> 0 };
  }

  /** 从 JSON 反序列化。 */
  static fromJSON(data: { mask: number }): LightingChannelConfiguration {
    return new LightingChannelConfiguration(data.mask);
  }

  /** 克隆。 */
  clone(): LightingChannelConfiguration {
    return new LightingChannelConfiguration(this._mask);
  }

  /** 工厂:仅指定通道。 */
  static only(index: number): LightingChannelConfiguration {
    return new LightingChannelConfiguration(channelMask(index));
  }

  /** 工厂:指定若干通道。 */
  static fromChannels(...indices: number[]): LightingChannelConfiguration {
    return new LightingChannelConfiguration(channelsMask(...indices));
  }

  /** 工厂:默认(全开)。 */
  static default(): LightingChannelConfiguration {
    return new LightingChannelConfiguration(ALL_LIGHTING_CHANNELS);
  }
}

// ── GLSL shader chunk(用于材质/光照着色器集成) ───────────────────
//
// 在着色器中,灯与物体的掩码按位 AND,非零则照亮。
// 灯的掩码作为 uniform/mesh 实例属性传入;物体的掩码作为顶点属性或 draw call uniform 传入。
//
// 用法(片元着色器):
//   uniform uint u_lightChannels[8];  // 8 盏灯的掩码
//   flat in uint v_objectChannels;     // 物体掩码(顶点属性)
//   ...
//   for (int i = 0; i < 8; ++i) {
//     if (lightingChannelAffects(u_lightChannels[i], v_objectChannels)) {
//       color += computeLighting(i);
//     }
//   }

export const LIGHTING_CHANNEL_GLSL = /* glsl */ `
// Lighting channel mask test: light affects object iff (light & object) != 0.
// Adapted from o3de Atom LightingChannelConfiguration (5ch) -> VREEN (32ch).
uint lightingChannelAnd(uint lightMask, uint objectMask) {
  return lightMask & objectMask;
}

bool lightingChannelAffects(uint lightMask, uint objectMask) {
  return (lightMask & objectMask) != 0u;
}
`;
