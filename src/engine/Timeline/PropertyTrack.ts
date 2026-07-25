// PropertyTrack — 属性轨道,通过关键帧动画化目标对象的属性。
//
// 设计原则:
//   - 与 TimelineTrack (基于片段) 不同,PropertyTrack 基于关键帧序列;
//   - evaluate(time) 在关键帧间插值,返回当前时间的属性值;
//   - update(time) 把插值结果写回 target[propertyPath];
//   - propertyPath 支持点号嵌套 (如 'position.x' / 'material.baseColor.r'),
//     使用 lodash-like 路径解析 (但不引入 lodash 依赖)。
//
// 不变量:
//   - keyframes 按 time 升序保持排序 (addKeyframe 后自动排序);
//   - time 早于第一帧返回第一帧值;time 晚于最后一帧返回最后一帧值;
//   - interp='step' 取左端值;'linear' 线性插值 (数值) 或 lerp (对象)。
export type PropertyInterp = 'step' | 'linear';

export interface Keyframe {
  /** 关键帧时间(秒)。 */
  time: number;
  /** 关键帧值 (数值或 {x,y,z} / {x,y,z,w} 等结构)。 */
  value: number | Record<string, number>;
  /** 插值模式 (默认 'linear')。 */
  interp?: PropertyInterp;
}

export interface PropertyTrackOptions {
  name: string;
  propertyPath: string;
  target?: object | null;
  keyframes?: Keyframe[];
  enabled?: boolean;
  locked?: boolean;
}

export class PropertyTrack {
  name: string;
  propertyPath: string;
  target: object | null;
  keyframes: Keyframe[];
  enabled: boolean;
  locked: boolean;

  constructor(opts: PropertyTrackOptions) {
    if (!opts.name) throw new Error('PropertyTrack: name must be non-empty');
    if (!opts.propertyPath) {
      throw new Error('PropertyTrack: propertyPath must be non-empty');
    }
    this.name = opts.name;
    this.propertyPath = opts.propertyPath;
    this.target = opts.target ?? null;
    this.keyframes = opts.keyframes ?? [];
    this.enabled = opts.enabled ?? true;
    this.locked = opts.locked ?? false;
    this.keyframes.sort((a, b) => a.time - b.time);
  }

  /** 添加关键帧并保持按 time 升序。 */
  addKeyframe(kf: Keyframe): this {
    this.keyframes.push(kf);
    this.keyframes.sort((a, b) => a.time - b.time);
    return this;
  }

  /** 移除指定关键帧 (按引用)。 */
  removeKeyframe(kf: Keyframe): boolean {
    const idx = this.keyframes.indexOf(kf);
    if (idx === -1) return false;
    this.keyframes.splice(idx, 1);
    return true;
  }

  /** 设置 / 替换目标对象。 */
  addTarget(target: object | null): this {
    this.target = target;
    return this;
  }

  /** 在关键帧间二分查找 [t0, t1] 区间。
   *  time 早于第一帧 → {i0:0, i1:0, alpha:0};
   *  time 晚于最后一帧 → {i0:last, i1:last, alpha:0};
   *  否则返回左右帧索引与 alpha (0..1)。 */
  private findTime(time: number): { i0: number; i1: number; alpha: number } {
    const n = this.keyframes.length;
    if (n === 0) return { i0: 0, i1: 0, alpha: 0 };
    if (n === 1) return { i0: 0, i1: 0, alpha: 0 };
    if (time <= this.keyframes[0].time) return { i0: 0, i1: 0, alpha: 0 };
    if (time >= this.keyframes[n - 1].time) return { i0: n - 1, i1: n - 1, alpha: 0 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.keyframes[mid].time <= time) lo = mid;
      else hi = mid;
    }
    const t0 = this.keyframes[lo].time;
    const t1 = this.keyframes[hi].time;
    const alpha = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
    return { i0: lo, i1: hi, alpha };
  }

  /** 在 time 处采样属性值 (不写回 target)。
   *  - 数值:linear → v0*(1-a)+v1*a;step → v0;
   *  - 对象 ({x,y,...}):逐字段线性插值 (interp='linear') 或取左端 (step)。 */
  evaluate(time: number): number | Record<string, number> | null {
    if (this.keyframes.length === 0) return null;
    const { i0, i1, alpha } = this.findTime(time);
    const k0 = this.keyframes[i0];
    const k1 = this.keyframes[i1] ?? k0;
    const interp = k1.interp ?? 'linear';
    if (i0 === i1) return k0.value;
    if (typeof k0.value === 'number' && typeof k1.value === 'number') {
      if (interp === 'step') return k0.value;
      return k0.value * (1 - alpha) + k1.value * alpha;
    }
    // 对象值:逐字段插值
    if (
      typeof k0.value === 'object' &&
      typeof k1.value === 'object' &&
      k0.value !== null &&
      k1.value !== null
    ) {
      if (interp === 'step') return { ...k0.value };
      const out: Record<string, number> = {};
      for (const key of Object.keys(k0.value)) {
        const a = k0.value[key];
        const b = (k1.value as Record<string, number>)[key] ?? a;
        out[key] = a * (1 - alpha) + b * alpha;
      }
      return out;
    }
    return k0.value;
  }

  /** 解析点号路径 'a.b.c' 并设置 target.a.b.c = value。
   *  路径不存在时创建中间对象 (仅对 plain object 安全,数组/类实例可能失败)。 */
  private static setPath(target: object, path: string, value: unknown): boolean {
    const parts = path.split('.');
    let cur: any = target;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      if (cur[k] == null || typeof cur[k] !== 'object') {
        cur[k] = {};
      }
      cur = cur[k];
    }
    cur[parts[parts.length - 1]] = value;
    return true;
  }

  /** 推进轨道:evaluate(time) 后把值写回 target[propertyPath]。
   *  enabled=false 或 target=null 时不写回。 */
  update(time: number): void {
    if (!this.enabled || !this.target) return;
    const v = this.evaluate(time);
    if (v === null) return;
    PropertyTrack.setPath(this.target, this.propertyPath, v);
  }

  /** 轨道总时长 (最后一帧 time;空轨道为 0)。 */
  getDuration(): number {
    if (this.keyframes.length === 0) return 0;
    return this.keyframes[this.keyframes.length - 1].time;
  }

  /** 序列化为 JSON。 */
  toJSON(): {
    name: string;
    kind: 'property';
    propertyPath: string;
    enabled: boolean;
    locked: boolean;
    keyframes: Keyframe[];
  } {
    return {
      name: this.name,
      kind: 'property',
      propertyPath: this.propertyPath,
      enabled: this.enabled,
      locked: this.locked,
      keyframes: this.keyframes.map((k) => ({ ...k })),
    };
  }
}
