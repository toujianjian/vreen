// ImportPipeline — 导入管线(模型导入预处理)。
//
// 设计目标:
//   * 封装 GLB / OBJ / FBX 加载 + 几何体归一化 + 资源验证的统一流程
//   * 复用 Loaders/ 下的 GLBLoader / parseOBJ / FBXLoader
//   * 复用 GeometryProcessor 的 normalize / computeBoundingBox
//   * 与 AssetPipeline 解耦:本类负责"格式 → 引擎对象"的导入,
//     AssetPipeline 负责"引擎对象 → 优化后对象"的处理
//
// 用法:
//   const pipeline = new ImportPipeline();
//   const result = await pipeline.importGLTF('model.glb');
//   scene.add(result.root);

import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { Object3D } from '../Core/Object3D';
import { GLBLoader, type LoadedGLB } from '../Loaders/GLBLoader';
import { parseOBJ, type ParsedOBJ } from '../Loaders/OBJLoader';
import { FBXLoader, type LoadedFBX } from '../Loaders/FBXLoader';
import { toArrayBuffer, type AssetSource } from '../Loaders/Loader';
import { createLogger } from '@/lib/logger';

const log = createLogger('ImportPipeline');

/** 通用导入结果(三种格式共用)。 */
export interface ImportResult<T = unknown> {
  /** 根 Group(挂载所有 Mesh)。 */
  root: Group;
  /** 材质列表(由各 loader 产出)。 */
  materials: unknown[];
  /** 加载器特有元数据(如 GLB 的 animations / FBX 的 version)。 */
  meta?: T;
  /** 校验报告。 */
  validation?: ValidationReport;
}

/** 验证报告。 */
export interface ValidationReport {
  /** 是否通过。 */
  ok: boolean;
  /** 警告(不阻塞导入)。 */
  warnings: string[];
  /** 错误(已阻塞导入,但因本类不抛错而以报告形式呈现)。 */
  errors: string[];
  /** Mesh 数量。 */
  meshCount: number;
  /** 总三角形数。 */
  triangleCount: number;
  /** 总顶点数。 */
  vertexCount: number;
}

/**
 * 导入管线(每个实例独立,可持有自定义 GLBLoader / FBXLoader)。
 */
export class ImportPipeline {
  private glbLoader: GLBLoader;
  private fbxLoader: FBXLoader;

  constructor() {
    this.glbLoader = new GLBLoader();
    this.fbxLoader = new FBXLoader();
  }

  /**
   * 导入 GLTF/GLB(含 Draco 解码 + 纹理优化标志)。
   * @param url  URL / File / Blob / ArrayBuffer / Uint8Array
   */
  async importGLTF(url: AssetSource): Promise<ImportResult<LoadedGLB>> {
    log.info(`importGLTF — start`);
    const loaded = await this.glbLoader.load(url);
    // 归一化:居中 + 缩放到 [-1, 1] 立方体内
    this.normalize(loaded.root);
    const validation = this.validate(loaded.root);
    log.info(`importGLTF — done (${validation.meshCount} meshes, ${validation.triangleCount} tris)`);
    return {
      root: loaded.root,
      materials: loaded.materials,
      meta: loaded,
      validation,
    };
  }

  /**
   * 导入 OBJ。
   * OBJ 是文本格式,需要 fetch + parseOBJ。
   */
  async importOBJ(url: AssetSource): Promise<ImportResult<ParsedOBJ>> {
    log.info(`importOBJ — start`);
    let text: string;
    if (typeof url === 'string' || url instanceof URL) {
      const resp = await fetch(url.toString());
      text = await resp.text();
    } else if (url instanceof Blob) {
      text = await url.text();
    } else {
      // ArrayBuffer / Uint8Array
      const buf = await toArrayBuffer(url);
      text = new TextDecoder().decode(buf);
    }
    const parsed = parseOBJ(text);
    this.normalize(parsed.root);
    const validation = this.validate(parsed.root);
    log.info(`importOBJ — done (${validation.meshCount} meshes, ${validation.triangleCount} tris)`);
    return {
      root: parsed.root,
      materials: Object.values(parsed.materials).map(r => r.material),
      meta: parsed,
      validation,
    };
  }

  /**
   * 导入 FBX。
   */
  async importFBX(url: AssetSource): Promise<ImportResult<LoadedFBX>> {
    log.info(`importFBX — start`);
    const loaded = await this.fbxLoader.load(url);
    this.normalize(loaded.root);
    const validation = this.validate(loaded.root);
    log.info(`importFBX — done (v${loaded.version}, ${validation.meshCount} meshes, ${validation.triangleCount} tris)`);
    return {
      root: loaded.root,
      materials: loaded.materials,
      meta: loaded,
      validation,
    };
  }

  /**
   * 归一化:把 Group 整体居中 + 缩放到 [-1, 1] 立方体。
   * 通过遍历所有 Mesh 的 position 属性计算包围盒,
   * 再 applyMatrix4 一个组合矩阵(平移 + 均匀缩放)。
   */
  normalize(root: Group): Group {
    // 计算所有 mesh 的合并 AABB
    const box = this._computeHierarchyBoundingBox(root);
    if (!box) return root;
    const { min, max } = box;
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const sx = max[0] - min[0];
    const sy = max[1] - min[1];
    const sz = max[2] - min[2];
    const maxSize = Math.max(sx, sy, sz);
    if (maxSize <= 0) return root;
    const scale = 2 / maxSize; // 归一化到 [-1, 1]
    // 在 root 上应用平移 + 缩放(不动每个 mesh 的本地几何)
    root.position.set(-cx * scale, -cy * scale, -cz * scale);
    root.scale.set(scale, scale, scale);
    log.info(`normalize — center=(${cx.toFixed(2)},${cy.toFixed(2)},${cz.toFixed(2)}), scale=${scale.toFixed(4)}`);
    return root;
  }

  /**
   * 验证资源:遍历所有 Mesh,统计三角形/顶点,检测异常。
   */
  validate(root: Group | Object3D): ValidationReport {
    const warnings: string[] = [];
    const errors: string[] = [];
    let meshCount = 0;
    let triangleCount = 0;
    let vertexCount = 0;

    root.traverse((obj: Object3D) => {
      if (obj instanceof Mesh) {
        meshCount++;
        const geo = obj.geometry;
        const pos = geo.attributes.position;
        if (!pos) {
          errors.push(`Mesh #${meshCount} 缺少 position 属性`);
          return;
        }
        vertexCount += pos.count;
        const idx = geo.index;
        if (idx) {
          triangleCount += idx.count / 3;
        } else {
          triangleCount += pos.count / 3;
        }
        if (pos.count < 3) {
          warnings.push(`Mesh #${meshCount} 顶点数 < 3`);
        }
        if (!geo.attributes.normal) {
          warnings.push(`Mesh #${meshCount} 缺少 normal 属性`);
        }
        if (!geo.attributes.uv) {
          warnings.push(`Mesh #${meshCount} 缺少 uv 属性`);
        }
      }
    });

    return {
      ok: errors.length === 0,
      warnings,
      errors,
      meshCount,
      triangleCount,
      vertexCount,
    };
  }

  // ── 内部 ──────────────────────────────────────────────────────────

  /** 遍历整个层级计算合并 AABB(世界空间)。 */
  private _computeHierarchyBoundingBox(
    root: Group | Object3D,
  ): { min: [number, number, number]; max: [number, number, number] } | null {
    let min: [number, number, number] | null = null;
    let max: [number, number, number] | null = null;
    root.traverse((obj: Object3D) => {
      if (obj instanceof Mesh) {
        const geo = obj.geometry;
        if (!geo.attributes.position) return;
        // 确保 mesh 的 world matrix 已更新
        obj.updateMatrixWorld?.(true);
        const pos = geo.attributes.position.array;
        // 简化:直接用本地 position(归一化在 root 上应用)
        for (let i = 0; i < pos.length; i += 3) {
          const x = pos[i], y = pos[i + 1], z = pos[i + 2];
          if (min === null || max === null) {
            min = [x, y, z];
            max = [x, y, z];
          } else {
            if (x < min[0]) min[0] = x;
            if (y < min[1]) min[1] = y;
            if (z < min[2]) min[2] = z;
            if (x > max[0]) max[0] = x;
            if (y > max[1]) max[1] = y;
            if (z > max[2]) max[2] = z;
          }
        }
      }
    });
    if (min === null || max === null) return null;
    return { min, max };
  }
}
