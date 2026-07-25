// WaterSimulation — 2D 水面波动模拟(ripples)。
//
// 解波动方程:
//   ∂²h/∂t² = c² ∇²h - d·∂h/∂t
//
// 离散化(显式有限差分,grid spacing = 1, time step = dt):
//   h_new[i,j] = 2·h[i,j] - h_prev[i,j]
//                + c²·dt²·(h[i+1,j] + h[i-1,j] + h[i,j+1] + h[i,j-1] - 4·h[i,j])
//                - d·dt·(h[i,j] - h_prev[i,j])
//
// 稳定性条件: c·dt / dx ≤ 1/√2  (CFL),取 c=1, dx=1 时 dt ≤ 0.707。
// 本实现固定 dt=0.5,调用方按需调用 update(simulatedDt) 累计时间。
//
// 用途:
//   * 由 WaterSystem 调用,把高度场采样到水面顶点位移
//   * 也可独立用于游戏机制(浮力、波纹触发器)

/** 临时向量复用。 */
interface Vec2Like { x: number; y: number; }

/**
 * 水面波动模拟器 — 在 resolution×resolution 网格上模拟 2D 波动方程。
 *
 * 三个缓冲区轮换:current / previous / next。
 * 调用 update(dt) 后,current ← next,previous ← 旧 current。
 */
export class WaterSimulation {
  /** 网格分辨率(每边格数)。 */
  resolution: number;
  /** 当前高度场(resolution²)。 */
  heightField: Float32Array;
  /** 上一帧高度场(用于显式时间积分)。 */
  previousField: Float32Array;
  /** 阻尼系数(0=无阻尼,1=强阻尼)。 */
  damping: number;
  /** 波速(格/秒)。 */
  waveSpeed: number;
  /** 累计未模拟的时间(秒)。 */
  private _accumulator: number = 0;
  /** 固定模拟步长(秒)。 */
  private readonly _fixedDt: number = 0.5;

  constructor(resolution: number = 64, damping: number = 0.05) {
    this.resolution = Math.max(2, Math.floor(resolution));
    this.heightField = new Float32Array(this.resolution * this.resolution);
    this.previousField = new Float32Array(this.resolution * this.resolution);
    this.damping = Math.max(0, Math.min(1, damping));
    this.waveSpeed = 1;
  }

  /**
   * 创建/重置模拟场。
   *
   * @param resolution 网格分辨率。
   */
  create(resolution: number): this {
    this.resolution = Math.max(2, Math.floor(resolution));
    this.heightField = new Float32Array(this.resolution * this.resolution);
    this.previousField = new Float32Array(this.resolution * this.resolution);
    this._accumulator = 0;
    return this;
  }

  /**
   * 在 (x, y) 处添加一个波纹(瞬时高度脉冲)。
   *
   * @param x 列索引 [0, resolution)。
   * @param y 行索引 [0, resolution)。
   * @param strength 脉冲强度(可正可负)。
   */
  addRipple(x: number, y: number, strength: number): this {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || ix >= this.resolution || iy < 0 || iy >= this.resolution) return this;
    const idx = iy * this.resolution + ix;
    this.heightField[idx] += strength;
    return this;
  }

  /**
   * 推进模拟。会按固定步长累计时间,可能多次步进。
   *
   * @param dt 实际流逝时间(秒)。
   */
  update(dt: number): this {
    if (dt <= 0) return this;
    this._accumulator += dt;
    const step = this._fixedDt;
    // 防止极端 dt 导致卡死(单次最多 256 步,足以覆盖 128s 模拟时间)
    let steps = 0;
    const maxSteps = 256;
    while (this._accumulator >= step && steps < maxSteps) {
      this.stepOnce(step);
      this._accumulator -= step;
      steps++;
    }
    // 丢弃剩余累计(避免堆积)
    if (steps >= maxSteps) this._accumulator = 0;
    return this;
  }

  /**
   * 获取 (x, y) 处的高度(双线性插值)。
   *
   * @param x 列浮点坐标 [0, resolution)。
   * @param y 行浮点坐标 [0, resolution)。
   */
  getHeight(x: number, y: number): number {
    const r = this.resolution;
    if (x < 0) x = 0; else if (x > r - 1) x = r - 1;
    if (y < 0) y = 0; else if (y > r - 1) y = r - 1;
    const ix0 = Math.floor(x);
    const iy0 = Math.floor(y);
    const ix1 = Math.min(r - 1, ix0 + 1);
    const iy1 = Math.min(r - 1, iy0 + 1);
    const tx = x - ix0;
    const ty = y - iy0;
    const h00 = this.heightField[iy0 * r + ix0];
    const h10 = this.heightField[iy0 * r + ix1];
    const h01 = this.heightField[iy1 * r + ix0];
    const h11 = this.heightField[iy1 * r + ix1];
    const h0 = h00 + (h10 - h00) * tx;
    const h1 = h01 + (h11 - h01) * tx;
    return h0 + (h1 - h0) * ty;
  }

  /**
   * 获取 (x, y) 处的法线(中心差分,归一化)。
   * 返回 {x, y, z} 对象,z 为竖直方向(向上)。
   */
  getNormal(x: number, y: number): Vec2Like & { z: number } {
    const eps = 1;
    const hL = this.getHeight(x - eps, y);
    const hR = this.getHeight(x + eps, y);
    const hD = this.getHeight(x, y - eps);
    const hU = this.getHeight(x, y + eps);
    // 法线 ∝ (-dh/dx, -dh/dy, 1)
    const nx = -(hR - hL) / (2 * eps);
    const ny = -(hU - hD) / (2 * eps);
    const nz = 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /** 清零高度场与上一帧。 */
  reset(): this {
    this.heightField.fill(0);
    this.previousField.fill(0);
    this._accumulator = 0;
    return this;
  }

  // ---- 内部 ----

  /** 单步显式时间积分(dt 已固定为 _fixedDt)。 */
  private stepOnce(dt: number): void {
    const r = this.resolution;
    const cur = this.heightField;
    const prev = this.previousField;
    const next = new Float32Array(r * r);
    const c2 = this.waveSpeed * this.waveSpeed;
    const dt2 = dt * dt;
    const k = c2 * dt2;
    const dampFactor = this.damping * dt;

    for (let y = 0; y < r; y++) {
      for (let x = 0; x < r; x++) {
        const idx = y * r + x;
        const h = cur[idx];
        const hPrev = prev[idx];
        // 邻居(边界处钳制为自身,简化为反射边界)
        const xL = x > 0 ? cur[idx - 1] : h;
        const xR = x < r - 1 ? cur[idx + 1] : h;
        const yD = y > 0 ? cur[idx - r] : h;
        const yU = y < r - 1 ? cur[idx + r] : h;
        const lap = xL + xR + yD + yU - 4 * h;
        // 显式更新
        let hNew = 2 * h - hPrev + k * lap - dampFactor * (h - hPrev);
        if (hNew !== hNew) hNew = 0; // NaN 防护
        next[idx] = hNew;
      }
    }
    // 轮换缓冲:prev ← cur, cur ← next
    this.previousField.set(cur);
    this.heightField.set(next);
  }
}
