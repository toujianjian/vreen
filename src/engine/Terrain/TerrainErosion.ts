// TerrainErosion — 程序化地形侵蚀系统。
//
// 在已有高度图上叠加自然侵蚀效果,使 Perlin / Diamond-Square 生成的
// 地形更接近真实地貌:山脊锐化、河谷下切、坡脚堆积、风蚀洼地。
//
// 三种侵蚀机制互补:
//   * 热力侵蚀(thermal)  — 重力驱动的松散物蠕动,模拟坡脚堆积。
//     单元格若比最低邻居高出一个超过「休止角」的阈值,就把超出部分
//     按比例转给邻居。多次迭代后陡坡松弛到休止角附近。
//   * 水力侵蚀(hydraulic) — 雨滴沿最陡下降路径流动,沿途侵蚀与沉积。
//     每滴携带水量与沉积量,速度由落差驱动,水量按蒸发率衰减。
//     这是 computer-graphics 圈常用的「Particle-based Hydraulic Erosion」
//     简化版(Mei et al. 2007 思路),单线程 CPU 即可跑通中等规模高度图。
//   * 风力侵蚀(wind)      — 沿风向搬运表层物质。当目标格低于源格
//     (顺风下坡),物质从源搬运到目标;迎风坡(目标更高)几乎不搬运,
//     模拟风影效应。简化版不含沙粒弹道与悬浮尘。
//
// 设计要点:
//   * 不依赖 TerrainGeometry:输入仅为 Float32Array 高度图 + 宽高,
//     可与任意生成器(HeightmapGenerator / 外部导入)组合
//   * erosionMap 同步记录每个单元格的净侵蚀量(负=被蚀,正=沉积),
//     供可视化 / 统计使用
//   * 所有随机均走 mulberry32(与 HeightmapGenerator 同 PRNG),种子可控
//   * 三个 *_rate 参数都是 0..1 区间的「混合系数」:0 = 不侵蚀,1 = 全量搬运

/** mulberry32 — 与 HeightmapGenerator 同 PRNG,保证种子行为一致。 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 8 邻居偏移(4 直连 + 4 对角),用于热力/风力遍历。 */
const NEIGHBORS_8: ReadonlyArray<readonly [number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0],           [1, 0],
  [-1, 1],  [0, 1],  [1, 1],
];

/** 综合侵蚀调用时的可选参数;未传入字段使用实例当前值。 */
export interface ErodeOptions {
  /** 热力侵蚀次数(覆盖 iterations)。 */
  thermalIterations?: number;
  /** 水力侵蚀雨滴数(覆盖 drops)。 */
  hydraulicDrops?: number;
  /** 单滴初始水量(覆盖 rainAmount)。 */
  rainAmount?: number;
  /** 风向(单位向量);不传则跳过风力。 */
  windDirection?: { x: number; y: number };
  /** 风力强度 0..1。 */
  windStrength?: number;
  /** 随机种子;不传则使用 Date.now() 派生。 */
  seed?: number;
}

/** getStats 返回的侵蚀统计。 */
export interface ErosionStats {
  /** 平均侵蚀量(负=净流失,正=净沉积)。 */
  averageErosion: number;
  /** 最大沉积量(正值)。 */
  maxDeposition: number;
  /** 最大侵蚀深度(负值,即 min(erosionMap))。 */
  maxErosion: number;
  /** 总体积变化(ΣerosionMap);正=净沉积,负=净流失。 */
  volumeChange: number;
  /** 单元格总数。 */
  cellCount: number;
}

/**
 * 程序化地形侵蚀系统。
 *
 * 用法:
 *   const erosion = new TerrainErosion();
 *   erosion.setHeightmap(heightmap, 128, 128);
 *   erosion.talusAngle = 35;
 *   erosion.applyThermalErosion();
 *   erosion.applyHydraulicErosion(1.0, 5000);
 *   const eroded = erosion.getHeightmap();
 *
 * 注意:本类不持有 TerrainGeometry 引用,只操作 Float32Array;
 * 调用方负责把结果灌回 geometry(通常重建 TerrainGeometry)。
 */
export class TerrainErosion {
  /** 高度图宽度(单元格列数)。 */
  width: number = 0;
  /** 高度图高度(单元格行数)。 */
  height: number = 0;
  /** 当前高度图(0..1 归一化值,本类直接原地修改)。 */
  heightmap: Float32Array = new Float32Array(0);
  /** 每个单元格自上次 setHeightmap 以来的净侵蚀量(负=流失,正=沉积)。 */
  erosionMap: Float32Array = new Float32Array(0);
  /** 热力侵蚀强度系数 0..1,默认 0.5。 */
  thermalErosionRate: number = 0.5;
  /** 水力侵蚀强度系数 0..1,默认 0.5。 */
  hydraulicErosionRate: number = 0.5;
  /** 风力侵蚀强度系数 0..1,默认 0.3。 */
  windErosionRate: number = 0.3;
  /** 休止角(度数),默认 35。超过此角的坡会松弛。 */
  talusAngle: number = 35;
  /** 默认迭代次数(供 erode() 与未显式指定次数的方法使用)。 */
  iterations: number = 50;

  /** 内部 PRNG,供水力 / 风力侵蚀复用;每次 erode 调用重置。 */
  private _rng: () => number = mulberry32(0xdeadbeef);

  /**
   * 设置输入高度图(复制到内部缓冲,避免外部修改影响侵蚀过程)。
   * 同时把 erosionMap 清零,开始一轮新的统计。
   *
   * @param data    长度必须等于 width × height 的 Float32Array
   * @param width   高度图列数
   * @param height  高度图行数
   */
  setHeightmap(data: Float32Array, width: number, height: number): this {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (data.length !== w * h) {
      throw new Error(
        `TerrainErosion.setHeightmap: data 长度 ${data.length} 与 width*height=${w * h} 不匹配`,
      );
    }
    this.width = w;
    this.height = h;
    this.heightmap = new Float32Array(data.length);
    this.heightmap.set(data);
    this.erosionMap = new Float32Array(data.length);
    return this;
  }

  /** 获取当前高度图(返回内部缓冲引用,只读场景下使用)。 */
  getHeightmap(): Float32Array {
    return this.heightmap;
  }

  /**
   * 热力侵蚀(重力沉积)。对每个单元格比较 8 邻居,把超过休止角
   * 阈值的多余高度按 thermalErosionRate 比例转给最低邻居。
   *
   * 算法是 Von Bevendorff 简化型:对每个 (x,y) 找出最低邻居,
   * 若 h(x,y) - h_min > talusThreshold,则转移
   *   Δ = (h(x,y) - h_min - talusThreshold) * thermalErosionRate * 0.5
   * 当前 -= Δ,邻居 += Δ。两侧 erosionMap 同步更新。
   *
   * 复杂度 O(iterations * W * H * 8)。
   */
  applyThermalErosion(): this {
    this._ensureHeightmap();
    const { width: w, height: h, heightmap, erosionMap } = this;
    // 休止角阈值 = tan(angle) * cellSize。这里 cellSize=1(高度图单位)。
    const talusThreshold = Math.tan((this.talusAngle * Math.PI) / 180);
    const rate = clamp01(this.thermalErosionRate);
    const iters = Math.max(1, Math.floor(this.iterations));

    for (let it = 0; it < iters; it++) {
      // 单趟扫描;不从原数组就地改是为了避免同一趟内传递链式累积。
      // 改用「读旧值写新值」的双缓冲,保证 8 邻居比较时数据一致。
      const next = Float32Array.from(heightmap);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          const cur = heightmap[idx];
          // 找最低邻居
          let minN = Infinity;
          let minNX = -1;
          let minNY = -1;
          for (let k = 0; k < 8; k++) {
            const nx = x + NEIGHBORS_8[k][0];
            const ny = y + NEIGHBORS_8[k][1];
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            const v = heightmap[ny * w + nx];
            if (v < minN) {
              minN = v;
              minNX = nx;
              minNY = ny;
            }
          }
          if (minNX < 0) continue; // 无合法邻居(理论上不会发生)
          const diff = cur - minN;
          if (diff <= talusThreshold) continue;
          const transfer = (diff - talusThreshold) * rate * 0.5;
          next[idx] -= transfer;
          next[minNY * w + minNX] += transfer;
          // erosionMap 不需要双缓冲:它记录的是「累计净变化」,直接累加即可
          erosionMap[idx] -= transfer;
          erosionMap[minNY * w + minNX] += transfer;
        }
      }
      // 把新一趟写回 heightmap
      heightmap.set(next);
    }
    return this;
  }

  /**
   * 水力侵蚀(雨滴 + 径流)。模拟 `drops` 颗雨滴从随机位置出发,
   * 沿最陡下降路径(带惯性)流动,沿途侵蚀陡坡、沉积缓坡与洼地。
   *
   * 每滴维护:
   *   water     当前水量(随蒸发衰减)
   *   sediment  当前携带沉积量
   *   dir       流动方向(单位向量,带惯性)
   *   speed     速度大小(由落差驱动)
   *
   * 侵蚀规则(Mei 简化版):
   *   capacity  = max(0, speed * water * 0.5)         — 携带能力
   *   if sediment < capacity: erode (cap - sed) * hydraulicErosionRate,从地形扣除并加到 sediment
   *   else                  : deposit (sed - cap) * 0.3,从 sediment 扣除并加到地形
   * 侵蚀量按双线性权重分摊到 4 个最近单元格(避免锯齿)。
   *
   * @param rainAmount 单滴初始水量(0..1 区间,通常 1)
   * @param drops      雨滴总数(典型 1000..50000)
   */
  applyHydraulicErosion(rainAmount: number = 1, drops: number = 1000): this {
    this._ensureHeightmap();
    const { width: w, height: h, heightmap } = this;
    const rate = clamp01(this.hydraulicErosionRate);
    const initWater = Math.max(0, rainAmount);
    const dropCount = Math.max(0, Math.floor(drops));
    const maxSteps = Math.max(w, h) * 4; // 单滴最多走的步数,避免无限循环
    const erosionRate = rate;       // 侵蚀系数
    const depositRate = 0.3;        // 沉积系数(独立于 hydraulicErosionRate,避免参数过多)
    const evaporate = 0.01;        // 每步蒸发比例
    const inertia = 0.05;          // 流动惯性(0=纯最陡下降,1=完全保持上次方向)
    const gravity = 4;             // 重力加速(用于 speed 更新)

    for (let d = 0; d < dropCount; d++) {
      // 随机起点(避开最外圈,保证梯度采样有效)
      let px = 1 + this._rng() * (w - 2);
      let py = 1 + this._rng() * (h - 2);
      let water = initWater;
      let sediment = 0;
      let dirX = 0;
      let dirY = 0;
      let speed = 1;

      for (let step = 0; step < maxSteps; step++) {
        if (water <= 0.001) break;
        // ---- 双线性采样当前高度与梯度 ----
        const x0 = Math.floor(px);
        const y0 = Math.floor(py);
        const fx = px - x0;
        const fy = py - y0;
        const h00 = heightmap[y0 * w + x0];
        const h10 = heightmap[y0 * w + x0 + 1];
        const h01 = heightmap[(y0 + 1) * w + x0];
        const h11 = heightmap[(y0 + 1) * w + x0 + 1];
        const curH = h00 * (1 - fx) * (1 - fy)
                  + h10 * fx * (1 - fy)
                  + h01 * (1 - fx) * fy
                  + h11 * fx * fy;
        // 中心差分梯度(以 cellSize=1 为单位)
        const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy; // dh/dx
        const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx; // dh/dy

        // ---- 更新方向(惯性 + 梯度) ----
        // 注意梯度方向是「上坡」,水要往「下坡」走,所以用 -grad
        dirX = dirX * inertia - gx * (1 - inertia);
        dirY = dirY * inertia - gy * (1 - inertia);
        const dlen = Math.hypot(dirX, dirY);
        if (dlen < 1e-6) {
          // 梯度近零(洼地):沉积剩余沉积量并结束
          this._deposit(px, py, sediment);
          sediment = 0;
          break;
        }
        dirX /= dlen;
        dirY /= dlen;
        const newPx = px + dirX;
        const newPy = py + dirY;
        // 越界:在边界沉积剩余沉积量并结束
        if (newPx < 1 || newPy < 1 || newPx >= w - 1 || newPy >= h - 1) {
          this._deposit(px, py, sediment);
          sediment = 0;
          break;
        }
        // ---- 采样新位置高度 ----
        const nx0 = Math.floor(newPx);
        const ny0 = Math.floor(newPy);
        const nfx = newPx - nx0;
        const nfy = newPy - ny0;
        const nh00 = heightmap[ny0 * w + nx0];
        const nh10 = heightmap[ny0 * w + nx0 + 1];
        const nh01 = heightmap[(ny0 + 1) * w + nx0];
        const nh11 = heightmap[(ny0 + 1) * w + nx0 + 1];
        const newH = nh00 * (1 - nfx) * (1 - nfy)
                  + nh10 * nfx * (1 - nfy)
                  + nh01 * (1 - nfx) * nfy
                  + nh11 * nfx * nfy;

        const dh = curH - newH; // 落差(正=下坡)
        // ---- 速度更新(能量守恒近似:v^2 = v0^2 + 2*g*dh) ----
        speed = Math.sqrt(Math.max(0, speed * speed + gravity * Math.max(0, dh)));
        speed = Math.min(speed, 4); // 钳制最大速度,避免数值爆炸

        // ---- 携带能力与侵蚀/沉积 ----
        const capacity = Math.max(0, speed * water * 0.5);
        if (dh > 0) {
          // 下坡:可能侵蚀
          const need = capacity - sediment;
          if (need > 0) {
            // 侵蚀量不超过落差,避免负高度
            const erode = Math.min(need * erosionRate, dh * 0.5);
            this._erodeBilinear(px, py, erode);
            sediment += erode;
          }
        } else {
          // 上坡或平地:沉积
          const excess = sediment - capacity;
          if (excess > 0) {
            const dep = excess * depositRate;
            this._deposit(px, py, dep);
            sediment -= dep;
          }
        }

        // ---- 蒸发 ----
        water *= 1 - evaporate;
        // 推进到新位置
        px = newPx;
        py = newPy;
      }
    }
    return this;
  }

  /**
   * 风力侵蚀。沿 `direction`(单位向量)搬运表层物质:
   *   * 顺风下坡(目标格更低):从源格搬运少量高度到目标格
   *   * 顺风上坡(目标格更高):不搬运(风影效应)
   *
   * @param direction 风向(不必归一化,内部归一化;{x, y} 在高度图坐标)
   * @param strength  风力强度 0..1
   */
  applyWindErosion(direction: { x: number; y: number }, strength: number = 0.5): this {
    this._ensureHeightmap();
    const { width: w, height: h, heightmap, erosionMap } = this;
    const rate = clamp01(this.windErosionRate);
    const s = clamp01(strength);
    // 归一化风向
    let dx = direction.x;
    let dy = direction.y;
    const dlen = Math.hypot(dx, dy);
    if (dlen < 1e-6) return this; // 无风不侵蚀
    dx /= dlen;
    dy /= dlen;
    const iters = Math.max(1, Math.floor(this.iterations));
    const transferCoef = rate * s * 0.05;
    // 风向在高度图整数坐标上的位移(round 到最近整数方向)
    const stepX = Math.round(dx);
    const stepY = Math.round(dy);

    for (let it = 0; it < iters; it++) {
      const next = Float32Array.from(heightmap);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const ntx = x + stepX;
          const nty = y + stepY;
          if (ntx < 0 || nty < 0 || ntx >= w || nty >= h) continue;
          const idx = y * w + x;
          const nIdx = nty * w + ntx;
          const cur = heightmap[idx];
          const nH = heightmap[nIdx];
          // 仅顺风下坡搬运
          if (cur <= nH) continue;
          const transfer = (cur - nH) * transferCoef;
          // 钳制不超过当前高度的一半,避免一格被吹空
          const capped = Math.min(transfer, cur * 0.5);
          next[idx] -= capped;
          next[nIdx] += capped;
          erosionMap[idx] -= capped;
          erosionMap[nIdx] += capped;
        }
      }
      heightmap.set(next);
    }
    return this;
  }

  /**
   * 综合侵蚀:一次调用按顺序应用三种侵蚀 + 可选平滑。
   *
   * @param options 各字段可选;未传则使用实例属性或默认值
   */
  erode(options: ErodeOptions = {}): this {
    this._ensureHeightmap();
    const seed = options.seed ?? ((Date.now() ^ 0x9e3779b9) >>> 0);
    this._rng = mulberry32(seed);
    const savedIterations = this.iterations;
    if (options.thermalIterations !== undefined) {
      this.iterations = options.thermalIterations;
    }
    this.applyThermalErosion();
    this.iterations = savedIterations;

    this.applyHydraulicErosion(
      options.rainAmount ?? 1,
      options.hydraulicDrops ?? 1000,
    );

    if (options.windDirection) {
      this.applyWindErosion(options.windDirection, options.windStrength ?? 0.5);
    }
    return this;
  }

  /**
   * 简单的箱式平滑(3×3 平均),用于在侵蚀后消除锯齿。
   * 边界单元复制自身参与平均,保持数组长度不变。
   *
   * @param iterations 平滑次数
   */
  smooth(iterations: number = 1): this {
    this._ensureHeightmap();
    const { width: w, height: h, heightmap } = this;
    const iters = Math.max(1, Math.floor(iterations));
    for (let it = 0; it < iters; it++) {
      const next = new Float32Array(heightmap.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0;
          let count = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
              sum += heightmap[ny * w + nx];
              count++;
            }
          }
          next[y * w + x] = sum / (count > 0 ? count : 1);
        }
      }
      heightmap.set(next);
    }
    return this;
  }

  /** 获取累计侵蚀图(负=流失,正=沉积)。 */
  getErosionMap(): Float32Array {
    return this.erosionMap;
  }

  /**
   * 计算并返回侵蚀统计。
   *
   * @returns 见 {@link ErosionStats}
   */
  getStats(): ErosionStats {
    const map = this.erosionMap;
    if (map.length === 0) {
      return {
        averageErosion: 0,
        maxDeposition: 0,
        maxErosion: 0,
        volumeChange: 0,
        cellCount: 0,
      };
    }
    let sum = 0;
    let maxDep = -Infinity;
    let maxEro = Infinity;
    for (let i = 0; i < map.length; i++) {
      const v = map[i];
      sum += v;
      if (v > maxDep) maxDep = v;
      if (v < maxEro) maxEro = v;
    }
    return {
      averageErosion: sum / map.length,
      maxDeposition: maxDep,
      maxErosion: maxEro,
      volumeChange: sum,
      cellCount: map.length,
    };
  }

  /** 重置侵蚀图(高度图保持不变)。 */
  reset(): this {
    this.erosionMap.fill(0);
    return this;
  }

  // ---------- 内部辅助 ----------

  /** 在指定坐标(x,y 为浮点)按双线性权重侵蚀 amount。 */
  private _erodeBilinear(px: number, py: number, amount: number): void {
    if (amount <= 0) return;
    const { width: w, height: h, heightmap, erosionMap } = this;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const weights = [
      [x0, y0, (1 - fx) * (1 - fy)],
      [x0 + 1, y0, fx * (1 - fy)],
      [x0, y0 + 1, (1 - fx) * fy],
      [x0 + 1, y0 + 1, fx * fy],
    ] as const;
    for (let i = 0; i < 4; i++) {
      const [ix, iy, wt] = weights[i];
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      const idx = iy * w + ix;
      const take = amount * wt;
      // 不允许高度变负
      const safe = Math.min(take, heightmap[idx]);
      heightmap[idx] -= safe;
      erosionMap[idx] -= safe;
    }
  }

  /** 在指定坐标(x,y 为浮点)按双线性权重沉积 amount。 */
  private _deposit(px: number, py: number, amount: number): void {
    if (amount <= 0) return;
    const { width: w, height: h, heightmap, erosionMap } = this;
    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const fx = px - x0;
    const fy = py - y0;
    const weights = [
      [x0, y0, (1 - fx) * (1 - fy)],
      [x0 + 1, y0, fx * (1 - fy)],
      [x0, y0 + 1, (1 - fx) * fy],
      [x0 + 1, y0 + 1, fx * fy],
    ] as const;
    for (let i = 0; i < 4; i++) {
      const [ix, iy, wt] = weights[i];
      if (ix < 0 || iy < 0 || ix >= w || iy >= h) continue;
      const idx = iy * w + ix;
      const add = amount * wt;
      heightmap[idx] += add;
      erosionMap[idx] += add;
    }
  }

  /** 确保已调用过 setHeightmap,否则抛错。 */
  private _ensureHeightmap(): void {
    if (this.heightmap.length === 0) {
      throw new Error('TerrainErosion: 尚未调用 setHeightmap 设置高度图');
    }
  }
}

/** 钳制到 [0, 1]。 */
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
