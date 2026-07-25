// TreeGenerator — 程序化树木生成器(L-system 风格的递归分支)。
//
// 由 trunkHeight / trunkRadius / branchLevels / leafSize 等参数驱动,
// 递归生成树干 + 分支 + 树叶几何体,合并后返回单一 BufferGeometry。
//
// 算法:
//   * 树干:沿 Y 轴的圆柱段(简化为细长 6 面管)
//   * 分支:从父分支末端按随机角度 + 长度衰减递归生成
//   * 树叶:在末端分支周围生成 billboard 平面(法线随机朝外)
//
// 输出:单一 BufferGeometry(所有部分合并),含 position/normal/uv,
// 由调用方附加材质。group 字段可选保留材质分组信息。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';

/** 树木生成选项。 */
export interface TreeOptions {
  /** 树干高度。 */
  trunkHeight: number;
  /** 树干半径。 */
  trunkRadius: number;
  /** 递归分支层级(1-5)。 */
  branchLevels: number;
  /** 单层分支数(每父分支末端分裂的子分支数)。 */
  branchCount?: number;
  /** 分支长度衰减率(0-1,子分支相对父分支)。 */
  branchLengthDecay?: number;
  /** 分支半径衰减率。 */
  branchRadiusDecay?: number;
  /** 树叶尺寸。 */
  leafSize: number;
  /** 每末端分支的叶子数。 */
  leafCount?: number;
  /** 随机种子。 */
  seed?: number;
}

/** 单个分支(用于递归)。 */
export interface TreeBranch {
  /** 起点。 */
  startX: number; startY: number; startZ: number;
  /** 终点。 */
  endX: number; endY: number; endZ: number;
  /** 起点半径。 */
  startRadius: number;
  /** 终点半径。 */
  endRadius: number;
  /** 层级(0=主干)。 */
  level: number;
}

/** 树木生成结果。 */
export interface TreeResult {
  /** 合并后的几何体(含 trunk + branches + leaves)。 */
  geometry: BufferGeometry;
  /** 元数据:所有分支。 */
  branches: TreeBranch[];
  /** 元数据:叶子数量。 */
  leafCount: number;
}

/** mulberry32 — 与其他 PCG 模块同实现的种子化 PRNG。 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 程序化树木生成器(全部静态方法)。
 *
 * 用法:
 *   const tree = TreeGenerator.generate(42, {
 *     trunkHeight: 4, trunkRadius: 0.3, branchLevels: 3, leafSize: 0.6,
 *   });
 *   scene.add(new Mesh(tree.geometry, material));
 */
export class TreeGenerator {
  /**
   * 生成完整树木(树干 + 分支 + 树叶合并几何体)。
   * @param seed 随机种子(也作为 options.seed 默认值)
   */
  static generate(seed: number = 0, options: TreeOptions): TreeResult {
    const {
      trunkHeight,
      trunkRadius,
      branchLevels,
      branchCount = 3,
      branchLengthDecay = 0.7,
      branchRadiusDecay = 0.65,
      leafSize,
      leafCount = 4,
      seed: optSeed,
    } = options;
    const actualSeed = optSeed ?? seed;
    const rng = mulberry32(actualSeed >>> 0);

    if (trunkHeight <= 0 || trunkRadius <= 0 || branchLevels < 1) {
      throw new Error(`TreeGenerator: trunkHeight/trunkRadius 必须为正, branchLevels >= 1`);
    }

    // 主干作为 level 0 分支
    const trunk: TreeBranch = {
      startX: 0, startY: 0, startZ: 0,
      endX: 0, endY: trunkHeight, endZ: 0,
      startRadius: trunkRadius,
      endRadius: trunkRadius * branchRadiusDecay,
      level: 0,
    };
    const allBranches: TreeBranch[] = [trunk];
    this.generateBranches(0, trunk, {
      branchLevels,
      branchCount,
      branchLengthDecay,
      branchRadiusDecay,
      rng,
      out: allBranches,
    });

    // 几何体构建
    const trunkGeo = this.generateTrunk();
    const branchGeos = allBranches.map(b => this._buildBranchGeometry(b));
    const leafGeo = this.generateLeaves(allBranches, { leafSize, leafCount, rng });
    const merged = this._mergeGeometries([trunkGeo, ...branchGeos, leafGeo]);

    return {
      geometry: merged,
      branches: allBranches,
      leafCount,
    };
  }

  /**
   * 生成树干几何体(实际就是 level 0 分支的几何体,这里为 API 一致性单独保留)。
   */
  static generateTrunk(): BufferGeometry {
    // 空 BufferGeometry,实际几何体在 generate() 中由 _buildBranchGeometry 构建
    return new BufferGeometry();
  }

  /**
   * 递归生成分支。
   * @param level     当前层级
   * @param parent    父分支
   * @param opts      选项
   */
  static generateBranches(
    level: number,
    parent: TreeBranch,
    opts: {
      branchLevels: number;
      branchCount: number;
      branchLengthDecay: number;
      branchRadiusDecay: number;
      rng: () => number;
      out: TreeBranch[];
    },
  ): void {
    if (level >= opts.branchLevels) return;
    const { branchCount, branchLengthDecay, branchRadiusDecay, rng, out } = opts;
    const parentLen = Math.hypot(
      parent.endX - parent.startX,
      parent.endY - parent.startY,
      parent.endZ - parent.startZ,
    );
    const childLen = parentLen * branchLengthDecay;
    const childStartRadius = parent.endRadius;
    const childEndRadius = parent.endRadius * branchRadiusDecay;

    for (let i = 0; i < branchCount; i++) {
      // 随机方向:以父分支末端为起点,在以 +Y 为主方向的球面上偏移
      const yaw = rng() * Math.PI * 2;
      const pitch = Math.PI / 6 + rng() * Math.PI / 4; // 30°-75°
      // 在父分支末端方向基础上做姿态偏移(简化:沿世界 Y 偏上,加水平扰动)
      const dirX = Math.sin(pitch) * Math.cos(yaw);
      const dirY = Math.cos(pitch);
      const dirZ = Math.sin(pitch) * Math.sin(yaw);
      const child: TreeBranch = {
        startX: parent.endX, startY: parent.endY, startZ: parent.endZ,
        endX: parent.endX + dirX * childLen,
        endY: parent.endY + dirY * childLen,
        endZ: parent.endZ + dirZ * childLen,
        startRadius: childStartRadius,
        endRadius: childEndRadius,
        level: level + 1,
      };
      out.push(child);
      this.generateBranches(level + 1, child, opts);
    }
  }

  /**
   * 在末端分支周围生成树叶(billboard 平面)。
   */
  static generateLeaves(
    branches: TreeBranch[],
    opts: { leafSize: number; leafCount: number; rng: () => number },
  ): BufferGeometry {
    const { leafSize, leafCount, rng } = opts;
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    // 只在最深层(末端)分支放叶子
    const maxLevel = branches.reduce((m, b) => Math.max(m, b.level), 0);
    const tipBranches = branches.filter(b => b.level === maxLevel);

    function addLeaf(cx: number, cy: number, cz: number): void {
      const base = positions.length / 3;
      const s = leafSize / 2;
      // 朝向相机的简化 billboard(法线 +Y,平面 XZ)
      // 随机旋转 Y 增加变化
      const rot = rng() * Math.PI * 2;
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const corners: Array<[number, number, number]> = [
        [-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0],
      ];
      for (const [px, py, pz] of corners) {
        const rx = px * cos - pz * sin;
        const rz = px * sin + pz * cos;
        positions.push(cx + rx, cy + py, cz + rz);
        normals.push(0, 0, 1);
      }
      uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }

    for (const b of tipBranches) {
      for (let i = 0; i < leafCount; i++) {
        // 在末端附近随机偏移
        const offX = (rng() - 0.5) * leafSize;
        const offY = (rng() - 0.5) * leafSize;
        const offZ = (rng() - 0.5) * leafSize;
        addLeaf(b.endX + offX, b.endY + offY, b.endZ + offZ);
      }
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    return geo;
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /** 把单个分支构建为圆柱段几何体(6 面管,简化无底盖)。 */
  private static _buildBranchGeometry(b: TreeBranch): BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const segments = 6;

    // 分支方向
    const dx = b.endX - b.startX;
    const dy = b.endY - b.startY;
    const dz = b.endZ - b.startZ;
    const len = Math.hypot(dx, dy, dz) || 1;
    const dirX = dx / len, dirY = dy / len, dirZ = dz / len;
    // 构造垂直于 dir 的两个基向量
    let upX = 0, upY = 1, upZ = 0;
    if (Math.abs(dirY) > 0.9) { upX = 1; upY = 0; upZ = 0; }
    // right = dir × up
    let rightX = dirY * upZ - dirZ * upY;
    let rightY = dirZ * upX - dirX * upZ;
    let rightZ = dirX * upY - dirY * upX;
    const rl = Math.hypot(rightX, rightY, rightZ) || 1;
    rightX /= rl; rightY /= rl; rightZ /= rl;
    // up' = right × dir
    const upX2 = rightY * dirZ - rightZ * dirY;
    const upY2 = rightZ * dirX - rightX * dirZ;
    const upZ2 = rightX * dirY - rightY * dirX;

    for (let i = 0; i < segments; i++) {
      const ang = (i / segments) * Math.PI * 2;
      const cos = Math.cos(ang), sin = Math.sin(ang);
      // 法线 = right*cos + up'*sin
      const nx = rightX * cos + upX2 * sin;
      const ny = rightY * cos + upY2 * sin;
      const nz = rightZ * cos + upZ2 * sin;
      // 起点环
      const sx = b.startX + nx * b.startRadius;
      const sy = b.startY + ny * b.startRadius;
      const sz = b.startZ + nz * b.startRadius;
      // 终点环
      const ex = b.endX + nx * b.endRadius;
      const ey = b.endY + ny * b.endRadius;
      const ez = b.endZ + nz * b.endRadius;
      positions.push(sx, sy, sz, ex, ey, ez);
      normals.push(nx, ny, nz, nx, ny, nz);
      uvs.push(i / segments, 0, i / segments, 1);
    }
    // 索引:每个 segment 与下一个构成一个 quad
    for (let i = 0; i < segments; i++) {
      const a = i * 2;
      const b2 = ((i + 1) % segments) * 2;
      indices.push(a, b2, a + 1, b2, b2 + 1, a + 1);
    }

    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    return geo;
  }

  /** 合并多个 BufferGeometry(参考 BuildingGenerator._mergeGeometries 同实现)。 */
  private static _mergeGeometries(geos: BufferGeometry[]): BufferGeometry {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;
    for (const g of geos) {
      const pos = g.attributes.position?.array;
      if (!pos) continue;
      for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
      const nrm = g.attributes.normal?.array;
      if (nrm) for (let i = 0; i < nrm.length; i++) normals.push(nrm[i]);
      const uv = g.attributes.uv?.array;
      if (uv) for (let i = 0; i < uv.length; i++) uvs.push(uv[i]);
      const idx = g.index?.array as unknown as ArrayLike<number> | undefined;
      if (idx) {
        for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset);
      } else {
        const vc = pos.length / 3;
        for (let i = 0; i < vc; i += 3) {
          indices.push(i, i + 1, i + 2);
        }
      }
      vertexOffset += pos.length / 3;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    if (normals.length > 0) geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
    if (uvs.length > 0) geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(indices);
    geo.computeBoundingBox();
    return geo;
  }
}
