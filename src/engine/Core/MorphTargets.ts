// MorphTargets — 形变目标(面部表情 / 形变动画)。
//
// 设计:
//   - `morphTargets`: 每个目标存绝对顶点位置(Float32Array,长度 = 顶点数 * 3)
//   - `morphInfluences`: 与目标索引对应的权重数组,默认 0(无影响)
//   - `morphTargetDictionary`: 名称 → 索引,反查表
//
// 应用规则(three.js 兼容):
//   result[i] = base[i] + Σ_j (target_j[i] - base[i]) * influence_j
// 即每个目标贡献一个"位移 delta = target - base",再按权重线性叠加。
//
// 顶点数 = base geometry 的 position.count。MorphTargets 不持有 base,
// `applyToGeometry` 时才从 geometry.attributes.position 读取。
//
// 与 Mesh 的集成:由调用方在 `mesh.morphTargets` 上挂载(参考 SkinnedMesh),
// renderer 在每帧 draw 之前调用 `update(geometry)` 把叠加结果写回 position 属性,
// 通过 version++ 触发 GPU VBO 重传(参考 BufferAttribute.version 机制)。

import { BufferGeometry } from './BufferGeometry';

export class MorphTargets {
  /** 名称 → 顶点位置绝对坐标(Float32Array,长度 = vertexCount * 3)。 */
  morphTargets: Map<string, Float32Array> = new Map();
  /** 每个目标的权重(按目标添加顺序索引)。 */
  morphInfluences: number[] = [];
  /** 名称 → 索引,反查表(与 morphInfluences 顺序一致)。 */
  morphTargetDictionary: Map<string, number> = new Map();
  /** 顶点数(由首个添加的目标确定,后续目标必须匹配)。0 = 未初始化。 */
  vertexCount: number = 0;
  /** applyToGeometry 是否已写回过(用于首次缓存 base position)。 */
  private _basePositions: Float32Array | null = null;
  /** 上次 applyToGeometry 写入的 geometry,用于 base 失效检测。 */
  private _boundGeometry: BufferGeometry | null = null;

  /** 添加形变目标。首个目标确定 vertexCount,后续目标必须长度一致。
   *  重复名称抛错(避免 dictionary 索引混乱)。 */
  addMorphTarget(name: string, positions: Float32Array | ArrayLike<number>): this {
    if (this.morphTargetDictionary.has(name)) {
      throw new Error(`MorphTargets: duplicate morph target name "${name}"`);
    }
    const arr = positions instanceof Float32Array
      ? new Float32Array(positions)
      : Float32Array.from(positions);
    if (arr.length % 3 !== 0) {
      throw new Error(`MorphTargets: positions length must be multiple of 3 (got ${arr.length})`);
    }
    const vc = arr.length / 3;
    if (this.vertexCount === 0) {
      this.vertexCount = vc;
    } else if (vc !== this.vertexCount) {
      throw new Error(
        `MorphTargets: vertex count mismatch (expected ${this.vertexCount}, got ${vc}) for target "${name}"`,
      );
    }
    const idx = this.morphInfluences.length;
    this.morphTargets.set(name, arr);
    this.morphTargetDictionary.set(name, idx);
    this.morphInfluences.push(0);
    return this;
  }

  /** 设置指定目标的权重。名称不存在抛错。权重未做 [0,1] 截断
   *  (允许负权重做反向形变 / >1 做夸张)。 */
  setMorphInfluence(name: string, weight: number): this {
    const idx = this.morphTargetDictionary.get(name);
    if (idx === undefined) {
      throw new Error(`MorphTargets: unknown morph target "${name}"`);
    }
    this.morphInfluences[idx] = weight;
    return this;
  }

  /** 获取指定目标的权重。名称不存在返回 0(不抛错,便于脚本安全查询)。 */
  getMorphInfluence(name: string): number {
    const idx = this.morphTargetDictionary.get(name);
    if (idx === undefined) return 0;
    return this.morphInfluences[idx];
  }

  /** 将所有目标的形变叠加到 geometry.attributes.position。
   *  - 首次调用会缓存 base position(从 geometry 读)
   *  - 切换 geometry 时自动重缓存
   *  - 所有 influence 为 0 时,position 复位为 base 并标记 needsUpdate
   *  - 写回后 position.version++ 触发 GPU VBO 重传 */
  applyToGeometry(geometry: BufferGeometry): void {
    const posAttr = geometry.attributes.position;
    if (!posAttr) {
      throw new Error('MorphTargets.applyToGeometry: geometry has no position attribute');
    }
    const vc = posAttr.count;
    if (vc !== this.vertexCount) {
      throw new Error(
        `MorphTargets: geometry vertex count (${vc}) does not match morph target vertex count (${this.vertexCount})`,
      );
    }

    // 失效 base 缓存:换 geometry 或 position 长度变了。
    if (this._boundGeometry !== geometry || !this._basePositions || this._basePositions.length !== posAttr.array.length) {
      this._basePositions = new Float32Array(posAttr.array);
      this._boundGeometry = geometry;
    }

    const base = this._basePositions;
    const out = posAttr.array as Float32Array;

    // 优化:若所有 influence 都为 0,直接复制 base。
    let anyInfluence = false;
    for (let i = 0; i < this.morphInfluences.length; i++) {
      if (this.morphInfluences[i] !== 0) { anyInfluence = true; break; }
    }
    if (!anyInfluence) {
      out.set(base);
      posAttr.version++;
      return;
    }

    // 起点 = base
    out.set(base);
    // 累加每个 target 的 delta * influence
    for (const [name, target] of this.morphTargets) {
      const idx = this.morphTargetDictionary.get(name)!;
      const w = this.morphInfluences[idx];
      if (w === 0) continue;
      // out[i] += (target[i] - base[i]) * w
      for (let i = 0; i < out.length; i++) {
        out[i] += (target[i] - base[i]) * w;
      }
    }
    posAttr.version++;
  }

  /** 同 applyToGeometry,语义别名。renderer 每帧调用。 */
  update(geometry: BufferGeometry): void {
    this.applyToGeometry(geometry);
  }

  /** 重置所有权重为 0。 */
  resetInfluences(): this {
    for (let i = 0; i < this.morphInfluences.length; i++) this.morphInfluences[i] = 0;
    return this;
  }

  /** 深拷贝(共享 base 缓存状态独立)。targets/influences/dictionary 全部独立。 */
  clone(): MorphTargets {
    const clone = new MorphTargets();
    for (const [name, positions] of this.morphTargets) {
      clone.addMorphTarget(name, new Float32Array(positions));
    }
    for (let i = 0; i < this.morphInfluences.length; i++) {
      clone.morphInfluences[i] = this.morphInfluences[i];
    }
    clone.vertexCount = this.vertexCount;
    return clone;
  }

  /** 序列化(用于 .vreen / 调试)。targets 以普通数组形式输出。 */
  toJSON(): Record<string, unknown> {
    const targets: Record<string, number[]> = {};
    for (const [name, positions] of this.morphTargets) {
      targets[name] = Array.from(positions);
    }
    return {
      vertexCount: this.vertexCount,
      morphTargets: targets,
      morphInfluences: this.morphInfluences.slice(),
    };
  }
}
