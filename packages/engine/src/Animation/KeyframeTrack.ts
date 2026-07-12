// KeyframeTrack — keyframed animation data for a single property of a
// single Object3D. Properties are addressed by path:
//   'position'  → Vector3
//   'quaternion'→ Quaternion
//   'scale'     → Vector3
//   'rotation.x' / 'rotation.y' / 'rotation.z' → Number
//   'bones[i].position' / 'bones[i].quaternion' → Vector3 / Quaternion
//
// Key times are stored as Float32Array of seconds; values are packed
// tightly (3 floats per Vector3 key, 4 per Quaternion key, 1 per Number).
// Interpolation modes: 'linear' (default) for V3 / Number, 'slerp' for
// Quaternion.

export type InterpMode = 'linear' | 'slerp' | 'step';

export interface TrackTarget {
  /** The node this track animates (e.g. a Bone or Object3D). */
  node: import('../Core/Object3D').Object3D;
  /** Property name. One of: 'position', 'quaternion', 'scale',
   *  'rotation.x', 'rotation.y', 'rotation.z'. */
  property: 'position' | 'quaternion' | 'scale' | 'rotation.x' | 'rotation.y' | 'rotation.z';
}

export abstract class KeyframeTrack {
  /** Name for diagnostics — typically `nodeName.property`. */
  name: string;
  /** Seconds. Sorted ascending. */
  times: Float32Array;
  /** Packed value array; layout depends on valueSize. */
  values: Float32Array;
  /** How many floats form one keyframe (1=Number, 3=Vector3, 4=Quaternion). */
  valueSize: 1 | 3 | 4;
  /** Interpolation mode. */
  interp: InterpMode;
  /** Target — set by AnimationClip when bound. */
  target: TrackTarget | null = null;

  constructor(
    name: string,
    times: ArrayLike<number>,
    values: ArrayLike<number>,
    valueSize: 1 | 3 | 4,
    interp: InterpMode = 'linear',
  ) {
    this.name = name;
    this.times = Float32Array.from(times);
    this.values = Float32Array.from(values);
    this.valueSize = valueSize;
    this.interp = interp;
  }

  /** Find the [t0, t1] keyframe index pair around `time`. */
  findTime(time: number): { i0: number; i1: number; alpha: number } {
    const n = this.times.length;
    if (n === 0) return { i0: 0, i1: 0, alpha: 0 };
    if (n === 1) return { i0: 0, i1: 0, alpha: 0 };
    if (time <= this.times[0]) return { i0: 0, i1: 0, alpha: 0 };
    if (time >= this.times[n - 1]) return { i0: n - 1, i1: n - 1, alpha: 0 };
    // Binary search.
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.times[mid] <= time) lo = mid;
      else hi = mid;
    }
    const t0 = this.times[lo];
    const t1 = this.times[hi];
    const alpha = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
    return { i0: lo, i1: hi, alpha };
  }

  /** Apply this track at `time` to its target. */
  abstract apply(time: number): void;
}

/** 跨 three.js / 自研 engine 的 quaternion setter 桥。
 *  three.js: v.quaternion.set(x,y,z,w) (Object3D 有独立的 quaternion 字段,
 *          rotation 是 Euler,set 只接 3 参)。
 *  自研 engine: v.rotation 是 Quaternion,set 接 4 参。
 *  duck-typing 优先用 quaternion,降级到 rotation。 */
function setNodeQuat(
  v: { quaternion?: { set(x: number, y: number, z: number, w: number): void };
       rotation: { set(x: number, y: number, z: number, w: number): void } },
  x: number, y: number, z: number, w: number,
): void {
  if (v.quaternion) v.quaternion.set(x, y, z, w);
  else v.rotation.set(x, y, z, w);
}

// ── Number (scalar) ──────────────────────────────────────────────
export class NumberKeyframeTrack extends KeyframeTrack {
  constructor(name: string, times: ArrayLike<number>, values: ArrayLike<number>, interp: InterpMode = 'linear') {
    super(name, times, values, 1, interp);
  }
  override apply(time: number): void {
    if (!this.target) return;
    const { i0, i1, alpha } = this.findTime(time);
    const v0 = this.values[i0];
    const v1 = this.values[i1];
    const v = this.interp === 'step' ? v0 : v0 * (1 - alpha) + v1 * alpha;
    const { node, property } = this.target;
    if (property === 'rotation.x') node.rotation.x = v;
    else if (property === 'rotation.y') node.rotation.y = v;
    else if (property === 'rotation.z') node.rotation.z = v;
  }
}

// ── Vector3 ──────────────────────────────────────────────────────
export class VectorKeyframeTrack extends KeyframeTrack {
  constructor(name: string, times: ArrayLike<number>, values: ArrayLike<number>, interp: InterpMode = 'linear') {
    super(name, times, values, 3, interp);
  }
  override apply(time: number): void {
    if (!this.target) return;
    const { i0, i1, alpha } = this.findTime(time);
    const o0 = i0 * 3, o1 = i1 * 3;
    const v = this.target.node;
    if (this.target.property === 'position') {
      v.position.set(
        this.values[o0]     * (1 - alpha) + this.values[o1]     * alpha,
        this.values[o0 + 1] * (1 - alpha) + this.values[o1 + 1] * alpha,
        this.values[o0 + 2] * (1 - alpha) + this.values[o1 + 2] * alpha,
      );
    } else if (this.target.property === 'scale') {
      v.scale.set(
        this.values[o0]     * (1 - alpha) + this.values[o1]     * alpha,
        this.values[o0 + 1] * (1 - alpha) + this.values[o1 + 1] * alpha,
        this.values[o0 + 2] * (1 - alpha) + this.values[o1 + 2] * alpha,
      );
    }
  }
}

// ── Quaternion (slerp) ───────────────────────────────────────────
export class QuaternionKeyframeTrack extends KeyframeTrack {
  constructor(name: string, times: ArrayLike<number>, values: ArrayLike<number>, interp: InterpMode = 'slerp') {
    super(name, times, values, 4, interp);
  }
  override apply(time: number): void {
    if (!this.target) return;
    const { i0, i1, alpha } = this.findTime(time);
    const o0 = i0 * 4, o1 = i1 * 4;
    const v = this.target.node as unknown as {
      quaternion?: { set(x: number, y: number, z: number, w: number): void };
      rotation: { set(x: number, y: number, z: number, w: number): void };
    };
    if (this.target.property !== 'quaternion') return;
    if (this.interp === 'step' || i0 === i1) {
      setNodeQuat(
        v,
        this.values[o0], this.values[o0 + 1], this.values[o0 + 2], this.values[o0 + 3],
      );
      return;
    }
    // Slerp
    const ax = this.values[o0],     ay = this.values[o0 + 1], az = this.values[o0 + 2], aw = this.values[o0 + 3];
    const bx = this.values[o1],     by = this.values[o1 + 1], bz = this.values[o1 + 2], bw = this.values[o1 + 3];
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    let bxf = bx, byf = by, bzf = bz, bwf = bw;
    if (cos < 0) { cos = -cos; bxf = -bx; byf = -by; bzf = -bz; bwf = -bw; }
    let s0, s1;
    if (1 - cos > 1e-5) {
      const omega = Math.acos(cos);
      const sinOm = Math.sin(omega);
      s0 = Math.sin((1 - alpha) * omega) / sinOm;
      s1 = Math.sin(alpha * omega) / sinOm;
    } else {
      s0 = 1 - alpha; s1 = alpha;
    }
    setNodeQuat(
      v,
      s0 * ax + s1 * bxf,
      s0 * ay + s1 * byf,
      s0 * az + s1 * bzf,
      s0 * aw + s1 * bwf,
    );
  }
}
