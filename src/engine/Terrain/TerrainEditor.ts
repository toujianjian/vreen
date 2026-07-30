// TerrainEditor — 交互式地形笔刷编辑器。
//
// 设计要点:
//   * 不直接持有 TerrainGeometry 实例,而是通过 setTerrain(any) 接受任何具备
//     { heightmap, width, height, widthSegments, heightSegments, heightScale, splatmap? } 字段的对象,
//     使其与 TerrainGeometry / 自定义实现解耦。
//   * 笔刷在「世界坐标」下定位,内部换算到「顶点网格坐标」(ix, iy) 再操作 heightmap[i]。
//   * 7 种工具:raise / lower / smooth / flatten / paint / noise / erode。
//     * raise/lower  — 沿 +Y/-Y 抬升或下沉,按 brushStrength × weight 调整
//     * smooth       — 3×3 箱式平均,过渡到邻居均值
//     * flatten      — 向 heightTarget 收敛
//     * paint        — 修改 splatmap (RGBA) 第 layerIndex 通道权重
//     * noise        — 叠加 Perlin 风格伪随机扰动
//     * erode        — 简化热力侵蚀(把高单元超过阈值的物质转给最低邻居)
//   * 笔刷形状:circle / square / diamond,衰减 brushFalloff 控制(0=硬边,1=最平滑)
//   * 历史栈 history + redo 栈,只记录 heightmap 切片(before/after),支持 undo/redo
//
// 注意:
//   * 编辑直接修改 terrain.heightmap (原地);调用方负责通知渲染层重建 normals/上传 GPU
//   * TerrainEdit.beforeData/afterData 仅记录「受影响顶点」的 heightmap 切片,
//     配合 affectedIndices 还原,避免每次保存整张图

/** 笔刷形状。 */
export type BrushShape = 'circle' | 'square' | 'diamond';

/** 编辑工具。 */
export type TerrainTool = 'raise' | 'lower' | 'smooth' | 'flatten' | 'paint' | 'noise' | 'erode';

/** 一次笔刷操作的快照(用于 undo/redo)。 */
export interface TerrainEdit {
  /** 触发该快照的工具。 */
  tool: TerrainTool;
  /** 笔刷中心世界坐标(XZ)。 */
  position: { x: number; z: number };
  /** 笔刷半径(世界单位)。 */
  brushSize: number;
  /** 笔刷强度(0..1)。 */
  brushStrength: number;
  /** 受影响顶点在 heightmap 中的索引列表。 */
  affectedIndices: number[];
  /** 应用前的 heightmap 切片(按 affectedIndices 顺序)。 */
  beforeData: Float32Array;
  /** 应用后的 heightmap 切片。 */
  afterData: Float32Array;
  /** paint 工具时记录的 splatmap 快照(可选,其他工具为 null)。 */
  splatBefore?: Uint8Array | null;
  splatAfter?: Uint8Array | null;
}

/** 编辑器统计。 */
export interface TerrainEditorStats {
  /** 当前工具。 */
  tool: TerrainTool;
  /** 笔刷大小。 */
  brushSize: number;
  /** 笔刷强度。 */
  brushStrength: number;
  /** 历史记录数。 */
  historySize: number;
  /** 重做栈大小。 */
  redoSize: number;
  /** 累计编辑次数。 */
  totalEdits: number;
}

/** 期望 terrain 对象具备的字段(鸭子类型,不强制类型)。 */
interface TerrainLike {
  heightmap: Float32Array;
  width: number;
  height: number;
  widthSegments: number;
  heightSegments: number;
  heightScale: number;
  splatmap?: Uint8Array | null;
}

/** 钳制到 [0, 1]。 */
function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * 交互式地形笔刷编辑器。
 *
 * 用法:
 *   const editor = new TerrainEditor();
 *   editor.setTerrain(terrainGeometry);
 *   editor.setTool('raise');
 *   editor.setBrushSize(5);
 *   editor.apply(0, 0);  // 在世界原点抬升
 *   if (editor.canUndo()) editor.undo();
 */
export class TerrainEditor {
  /** 当前地形(任何具备 heightmap/width/height/segments 字段的对象)。 */
  terrain: any | null = null;
  /** 笔刷半径(世界单位)。 */
  brushSize: number = 5;
  /** 笔刷强度(0..1,每帧应用的最大高度变化比例)。 */
  brushStrength: number = 0.5;
  /** 笔刷衰减(0=硬边,1=最平滑高斯衰减)。 */
  brushFalloff: number = 0.5;
  /** 笔刷形状。 */
  brushShape: BrushShape = 'circle';
  /** 当前工具。 */
  tool: TerrainTool = 'raise';
  /** 当前纹理层(paint 工具使用,0..3 对应 RGBA)。 */
  layerIndex: number = 0;
  /** flatten 工具目标高度(世界 Y)。 */
  heightTarget: number = 0;
  /** noise 工具采样缩放(越大噪声越密)。 */
  noiseScale: number = 0.1;
  /** noise 工具幅度(世界高度单位)。 */
  noiseAmplitude: number = 1;
  /** 历史栈(undo 用)。 */
  history: TerrainEdit[] = [];
  /** 历史栈上限。 */
  maxHistory: number = 50;
  /** 重做栈。 */
  private _redoStack: TerrainEdit[] = [];
  /** 累计编辑次数。 */
  private _totalEdits: number = 0;

  /** 设置当前地形。 */
  setTerrain(terrain: any | null): this {
    this.terrain = terrain;
    return this;
  }

  /** 获取当前地形。 */
  getTerrain(): any | null {
    return this.terrain;
  }

  /** 设置笔刷半径(世界单位,>0)。 */
  setBrushSize(size: number): this {
    this.brushSize = Math.max(0.001, size);
    return this;
  }

  /** 设置笔刷强度(0..1)。 */
  setBrushStrength(strength: number): this {
    this.brushStrength = clamp01(strength);
    return this;
  }

  /** 设置笔刷衰减(0..1)。 */
  setBrushFalloff(falloff: number): this {
    this.brushFalloff = clamp01(falloff);
    return this;
  }

  /** 设置笔刷形状。 */
  setBrushShape(shape: BrushShape): this {
    this.brushShape = shape;
    return this;
  }

  /** 设置当前工具。 */
  setTool(tool: TerrainTool): this {
    this.tool = tool;
    return this;
  }

  /** 设置当前纹理层(0..3)。 */
  setLayer(index: number): this {
    this.layerIndex = Math.max(0, Math.min(3, Math.floor(index)));
    return this;
  }

  /** 设置 flatten 工具目标高度(世界 Y)。 */
  setHeightTarget(height: number): this {
    this.heightTarget = height;
    return this;
  }

  /** 设置 noise 工具参数。 */
  setNoiseParams(scale: number, amplitude: number): this {
    this.noiseScale = Math.max(0.0001, scale);
    this.noiseAmplitude = amplitude;
    return this;
  }

  /**
   * 计算笔刷在 (x, z) 处对每个受影响顶点的权重。
   *
   * @returns Map<vertexIndex, weight>,权重 ∈ [0, 1]
   */
  computeBrushWeights(x: number, z: number): Map<number, number> {
    const weights = new Map<number, number>();
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) return weights;

    const segW = terrain.width / terrain.widthSegments;
    const segH = terrain.height / terrain.heightSegments;
    const widthHalf = terrain.width / 2;
    const heightHalf = terrain.height / 2;
    const gridX1 = terrain.widthSegments + 1;

    // 世界 → 网格浮点坐标
    const fx = (x + widthHalf) / segW;
    const fz = (z + heightHalf) / segH;
    const cx = Math.floor(fx);
    const cz = Math.floor(fz);

    // 笔刷覆盖的网格范围(向上取整保证不漏顶点)
    const radius = this.brushSize;
    const rCellsX = Math.ceil(radius / segW) + 1;
    const rCellsZ = Math.ceil(radius / segH) + 1;

    const falloff = this.brushFalloff;
    const shape = this.brushShape;

    for (let dz = -rCellsZ; dz <= rCellsZ; dz++) {
      for (let dx = -rCellsX; dx <= rCellsX; dx++) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix > terrain.widthSegments || iz > terrain.heightSegments) continue;

        // 顶点世界坐标
        const vx = ix * segW - widthHalf;
        const vz = iz * segH - heightHalf;
        const ddx = vx - x;
        const ddz = vz - z;

        let inside = false;
        let normDist = 0; // 0=中心, 1=边缘
        if (shape === 'circle') {
          const d = Math.hypot(ddx, ddz);
          if (d <= radius) {
            inside = true;
            normDist = d / radius;
          }
        } else if (shape === 'square') {
          if (Math.abs(ddx) <= radius && Math.abs(ddz) <= radius) {
            inside = true;
            // 用 max 范数,与方形一致
            normDist = Math.max(Math.abs(ddx), Math.abs(ddz)) / radius;
          }
        } else {
          // diamond: |dx| + |dz| <= radius
          const manhattan = Math.abs(ddx) + Math.abs(ddz);
          if (manhattan <= radius) {
            inside = true;
            normDist = manhattan / radius;
          }
        }
        if (!inside) continue;

        // 衰减权重:线性衰减 (1 - normDist),falloff 控制衰减强度
        // falloff=0 → 硬边(权重=1 在内部),falloff=1 → 线性衰减到 0
        let w: number;
        if (falloff <= 0) {
          w = 1;
        } else {
          w = 1 - normDist * falloff;
        }
        if (w <= 0) continue;

        const idx = iz * gridX1 + ix;
        weights.set(idx, w);
      }
    }
    return weights;
  }

  /**
   * 在 (x, z) 处应用当前工具。会自动记录历史。
   * 若未设置地形或工具未知,什么也不做。
   */
  apply(x: number, z: number): this {
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) return this;

    switch (this.tool) {
      case 'raise': this.applyRaise(x, z); break;
      case 'lower': this.applyLower(x, z); break;
      case 'smooth': this.applySmooth(x, z); break;
      case 'flatten': this.applyFlatten(x, z); break;
      case 'paint': this.applyPaint(x, z); break;
      case 'noise': this.applyNoise(x, z); break;
      case 'erode': this.applyErode(x, z); break;
    }
    return this;
  }

  /** 抬升工具:沿 +Y 抬升高度。 */
  applyRaise(x: number, z: number): this {
    return this._modifyHeights(x, z, (h, w) => {
      // 每次最多抬升 brushStrength * heightScale * 0.1 * weight
      const delta = this.brushStrength * 0.5 * w;
      return h + delta;
    });
  }

  /** 降低工具:沿 -Y 下沉高度。 */
  applyLower(x: number, z: number): this {
    return this._modifyHeights(x, z, (h, w) => {
      const delta = this.brushStrength * 0.5 * w;
      return h - delta;
    });
  }

  /** 平滑工具:向 3×3 邻域均值收敛。 */
  applySmooth(x: number, z: number): this {
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) return this;
    const weights = this.computeBrushWeights(x, z);
    if (weights.size === 0) return this;

    const gridX1 = terrain.widthSegments + 1;
    const gridY1 = terrain.heightSegments + 1;
    const hm = terrain.heightmap;

    // 先算出每个受影响顶点的目标平滑值
    const targets = new Map<number, number>();
    for (const idx of weights.keys()) {
      const ix = idx % gridX1;
      const iz = Math.floor(idx / gridX1);
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ix + dx;
          const ny = iz + dy;
          if (nx < 0 || ny < 0 || nx >= gridX1 || ny >= gridY1) continue;
          sum += hm[ny * gridX1 + nx];
          count++;
        }
      }
      if (count > 0) targets.set(idx, sum / count);
    }

    return this._modifyHeightsWithWeights(x, z, weights, (h, w, idx) => {
      const target = targets.get(idx);
      if (target === undefined) return h;
      // 向均值收敛,收敛速度 = brushStrength * w
      return h + (target - h) * this.brushStrength * w;
    });
  }

  /** 压平工具:向 heightTarget 收敛。 */
  applyFlatten(x: number, z: number): this {
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) return this;
    // heightTarget 是世界 Y,heightmap 存归一化值 (0..1) × heightScale = 世界 Y
    const targetNorm = terrain.heightScale > 0 ? this.heightTarget / terrain.heightScale : 0;
    return this._modifyHeights(x, z, (h, w) => {
      return h + (targetNorm - h) * this.brushStrength * w;
    });
  }

  /** 绘制纹理工具:增加 layerIndex 通道权重,等比减少其他通道。 */
  applyPaint(x: number, z: number): this {
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) return this;
    if (!terrain.splatmap) return this;

    const weights = this.computeBrushWeights(x, z);
    if (weights.size === 0) return this;

    const splat = terrain.splatmap;
    const layer = this.layerIndex;
    const strength = this.brushStrength;

    // 记录快照
    const affected: number[] = [];
    for (const idx of weights.keys()) {
      affected.push(idx);
    }
    const splatBefore = new Uint8Array(affected.length * 4);
    for (let i = 0; i < affected.length; i++) {
      const vi = affected[i];
      splatBefore[i * 4 + 0] = splat[vi * 4 + 0];
      splatBefore[i * 4 + 1] = splat[vi * 4 + 1];
      splatBefore[i * 4 + 2] = splat[vi * 4 + 2];
      splatBefore[i * 4 + 3] = splat[vi * 4 + 3];
    }

    for (const [idx, w] of weights) {
      // 当前 RGBA 权重
      const r = splat[idx * 4 + 0];
      const g = splat[idx * 4 + 1];
      const b = splat[idx * 4 + 2];
      const a = splat[idx * 4 + 3];
      const sum = r + g + b + a;
      if (sum <= 0) continue;
      // 把 layer 通道增加,其他通道按比例减少
      const current = splat[idx * 4 + layer];
      const increase = Math.round(strength * w * 255 * 0.5);
      const newLayer = Math.min(255, current + increase);
      const diff = newLayer - current;
      // 从其他通道按比例扣除
      const others = sum - current;
      if (others > 0) {
        for (let c = 0; c < 4; c++) {
          if (c === layer) {
            splat[idx * 4 + c] = newLayer;
          } else {
            const ov = splat[idx * 4 + c];
            const dec = Math.round((ov / others) * diff);
            splat[idx * 4 + c] = Math.max(0, ov - dec);
          }
        }
      } else {
        splat[idx * 4 + layer] = newLayer;
      }
    }

    const splatAfter = new Uint8Array(affected.length * 4);
    for (let i = 0; i < affected.length; i++) {
      const vi = affected[i];
      splatAfter[i * 4 + 0] = splat[vi * 4 + 0];
      splatAfter[i * 4 + 1] = splat[vi * 4 + 1];
      splatAfter[i * 4 + 2] = splat[vi * 4 + 2];
      splatAfter[i * 4 + 3] = splat[vi * 4 + 3];
    }

    // paint 工具不影响 heightmap,但为统一历史结构,before/after 用空 Float32Array
    this._pushHistory({
      tool: 'paint',
      position: { x, z },
      brushSize: this.brushSize,
      brushStrength: this.brushStrength,
      affectedIndices: affected,
      beforeData: new Float32Array(0),
      afterData: new Float32Array(0),
      splatBefore,
      splatAfter,
    });
    return this;
  }

  /** 噪声工具:叠加 Perlin 风格伪随机扰动。 */
  applyNoise(x: number, z: number): this {
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) return this;
    const weights = this.computeBrushWeights(x, z);
    if (weights.size === 0) return this;

    // 用 brushStrength + noiseScale + noiseAmplitude 控制扰动
    const scale = this.noiseScale;
    const amp = this.noiseAmplitude;
    const heightScale = terrain.heightScale;
    // 把幅度转回归一化空间
    const ampNorm = heightScale > 0 ? amp / heightScale : 0;

    return this._modifyHeightsWithWeights(x, z, weights, (h, w, idx) => {
      // 简单 hash 噪声:基于顶点索引 + 时间种子
      const ix = idx % (terrain.widthSegments + 1);
      const iz = Math.floor(idx / (terrain.widthSegments + 1));
      const n = this._hashNoise(ix * scale, iz * scale);
      return h + n * ampNorm * this.brushStrength * w;
    });
  }

  /** 侵蚀工具:简化热力侵蚀,把高顶点超过阈值的部分转给最低邻居。 */
  applyErode(x: number, z: number): this {
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) return this;
    const weights = this.computeBrushWeights(x, z);
    if (weights.size === 0) return this;

    const gridX1 = terrain.widthSegments + 1;
    const gridY1 = terrain.heightSegments + 1;
    const hm = terrain.heightmap;
    const talus = 0.05; // 归一化空间的休止角阈值

    // 先采集所有受影响顶点的当前值
    const snapshot = new Map<number, number>();
    for (const idx of weights.keys()) {
      snapshot.set(idx, hm[idx]);
    }

    // 对每个受影响顶点,找其 4 邻居中最低的,转移物质
    // (双缓冲避免单趟内链式累积)
    const next = new Map<number, number>();
    for (const [idx, h] of snapshot) {
      next.set(idx, h);
    }
    for (const idx of weights.keys()) {
      const w = weights.get(idx) ?? 0;
      const h = snapshot.get(idx) ?? 0;
      const ix = idx % gridX1;
      const iz = Math.floor(idx / gridX1);
      // 找最低 4 邻居
      let minN = Infinity;
      let minIdx = -1;
      const neighbors = [
        [ix - 1, iz], [ix + 1, iz],
        [ix, iz - 1], [ix, iz + 1],
      ];
      for (const [nx, nz] of neighbors) {
        if (nx < 0 || nz < 0 || nx >= gridX1 || nz >= gridY1) continue;
        const nIdx = nz * gridX1 + nx;
        // 邻居值:若是受影响顶点用 snapshot,否则用 hm
        const nv = snapshot.has(nIdx) ? snapshot.get(nIdx)! : hm[nIdx];
        if (nv < minN) {
          minN = nv;
          minIdx = nIdx;
        }
      }
      if (minIdx < 0) continue;
      const diff = h - minN;
      if (diff <= talus) continue;
      const transfer = (diff - talus) * this.brushStrength * w * 0.5;
      next.set(idx, (next.get(idx) ?? h) - transfer);
      // 邻居若也在受影响集合,更新 next;否则直接写 hm(稍后用 afterData 还原)
      if (next.has(minIdx)) {
        next.set(minIdx, (next.get(minIdx) ?? minN) + transfer);
      } else {
        next.set(minIdx, minN + transfer);
      }
    }

    return this._modifyHeightsWithWeights(x, z, weights, (_h, _w, idx) => {
      return next.get(idx) ?? _h;
    });
  }

  /** 撤销上一次操作。 */
  undo(): this {
    const edit = this.history.pop();
    if (!edit) return this;
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) {
      // 没有地形也无法 undo,把 edit 推回
      this.history.push(edit);
      return this;
    }
    // 还原 heightmap
    const hm = terrain.heightmap as Float32Array;
    for (let i = 0; i < edit.affectedIndices.length; i++) {
      hm[edit.affectedIndices[i]] = edit.beforeData[i];
    }
    // 还原 splatmap
    if (edit.splatBefore && terrain.splatmap) {
      const splat = terrain.splatmap as Uint8Array;
      for (let i = 0; i < edit.affectedIndices.length; i++) {
        const vi = edit.affectedIndices[i];
        splat[vi * 4 + 0] = edit.splatBefore[i * 4 + 0];
        splat[vi * 4 + 1] = edit.splatBefore[i * 4 + 1];
        splat[vi * 4 + 2] = edit.splatBefore[i * 4 + 2];
        splat[vi * 4 + 3] = edit.splatBefore[i * 4 + 3];
      }
    }
    this._redoStack.push(edit);
    return this;
  }

  /** 重做上次撤销的操作。 */
  redo(): this {
    const edit = this._redoStack.pop();
    if (!edit) return this;
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) {
      this._redoStack.push(edit);
      return this;
    }
    const hm = terrain.heightmap as Float32Array;
    for (let i = 0; i < edit.affectedIndices.length; i++) {
      hm[edit.affectedIndices[i]] = edit.afterData[i];
    }
    if (edit.splatAfter && terrain.splatmap) {
      const splat = terrain.splatmap as Uint8Array;
      for (let i = 0; i < edit.affectedIndices.length; i++) {
        const vi = edit.affectedIndices[i];
        splat[vi * 4 + 0] = edit.splatAfter[i * 4 + 0];
        splat[vi * 4 + 1] = edit.splatAfter[i * 4 + 1];
        splat[vi * 4 + 2] = edit.splatAfter[i * 4 + 2];
        splat[vi * 4 + 3] = edit.splatAfter[i * 4 + 3];
      }
    }
    this.history.push(edit);
    return this;
  }

  /** 是否可撤销。 */
  canUndo(): boolean {
    return this.history.length > 0;
  }

  /** 是否可重做。 */
  canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /** 清空历史与重做栈。 */
  clearHistory(): this {
    this.history.length = 0;
    this._redoStack.length = 0;
    return this;
  }

  /** 获取编辑器统计。 */
  getStats(): TerrainEditorStats {
    return {
      tool: this.tool,
      brushSize: this.brushSize,
      brushStrength: this.brushStrength,
      historySize: this.history.length,
      redoSize: this._redoStack.length,
      totalEdits: this._totalEdits,
    };
  }

  // ---------- 内部辅助 ----------

  /** 通用高度修改:用 computeBrushWeights 计算 weights,然后对每个顶点调用 fn(h, w, idx) 得到新值。 */
  private _modifyHeights(
    x: number,
    z: number,
    fn: (h: number, w: number, idx: number) => number,
  ): this {
    const weights = this.computeBrushWeights(x, z);
    if (weights.size === 0) return this;
    return this._modifyHeightsWithWeights(x, z, weights, fn);
  }

  /** 用预计算的 weights 修改高度,记录历史。 */
  private _modifyHeightsWithWeights(
    x: number,
    z: number,
    weights: Map<number, number>,
    fn: (h: number, w: number, idx: number) => number,
  ): this {
    const terrain = this.terrain as TerrainLike | null;
    if (!terrain) return this;
    const hm = terrain.heightmap as Float32Array;

    const affected: number[] = [];
    const beforeData: number[] = [];
    const afterData: number[] = [];
    for (const [idx, w] of weights) {
      const before = hm[idx];
      const after = fn(before, w, idx);
      // 钳制到 [0, 1] 防止越界(归一化空间)
      const clamped = Math.max(0, Math.min(1, after));
      hm[idx] = clamped;
      affected.push(idx);
      beforeData.push(before);
      afterData.push(clamped);
    }

    this._pushHistory({
      tool: this.tool,
      position: { x, z },
      brushSize: this.brushSize,
      brushStrength: this.brushStrength,
      affectedIndices: affected,
      beforeData: new Float32Array(beforeData),
      afterData: new Float32Array(afterData),
    });
    return this;
  }

  /** 压入历史,清空 redo 栈,裁剪到 maxHistory。 */
  private _pushHistory(edit: TerrainEdit): void {
    this.history.push(edit);
    this._redoStack.length = 0;
    this._totalEdits++;
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /** 简单的 hash 噪声(返回 -1..1)。 */
  private _hashNoise(x: number, y: number): number {
    // 用两次 sin hash 模拟伪噪声
    const a = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const b = Math.sin((x + 1.7) * 12.9898 + (y + 1.7) * 78.233) * 43758.5453;
    const fa = (a - Math.floor(a)) * 2 - 1;
    const fb = (b - Math.floor(b)) * 2 - 1;
    return (fa + fb) * 0.5;
  }
}
