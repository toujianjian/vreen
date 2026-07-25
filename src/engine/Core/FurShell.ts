// FurShell — Shell-based 毛发多层网格管理器。
//
// 设计思路:
//   FurMaterial 持有着色器与参数;FurShell 负责把 baseMesh 的几何体复制
//   shellCount 份,每份是一个独立的 Mesh,共享同一 BufferGeometry 与
//   FurMaterial 实例。每帧 update(dt):
//     1. 推进 furMaterial.time
//     2. 为每层 shell 设置 shellLayer = i / (shellCount - 1)
//     3. 渲染器在 draw 各层 mesh 时,通过 material.shellLayer 读取当前层
//        并写入 u_shellLayer uniform
//
// 性能权衡:
//   - shellCount = 16: 16 个 draw call,质量/性能平衡点
//   - shellCount = 32: 高质量,draw call 翻倍
//   - shellCount < 8:  毛发看起来稀疏,失去体积感
//
// 与场景图集成:
//   - shells 作为 baseMesh 的子节点添加,跟随父节点变换
//   - 每层 shell 共享 baseMesh.geometry,避免 GPU buffer 重复
//   - 每层 shell.castShadow = false(多层 shell 投影阴影代价高)
//
// 用法:
//   const furMat = new FurMaterial({ furLength: 0.2 });
//   const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 16 });
//   shell.generate();
//   // 每帧:
//   shell.update(dt);

import { Mesh } from './Mesh';
import { Object3D } from './Object3D';
import { FurMaterial } from '../Materials/FurMaterial';

export interface FurShellOptions {
  /** 基础网格(毛发附着的目标)。 */
  baseMesh: Mesh;
  /** 毛发材质。 */
  furMaterial: FurMaterial;
  /** Shell 层数(默认 16,范围 [2, 64])。 */
  shellCount?: number;
  /** 是否在 generate() 时把 shells 作为 baseMesh 子节点挂载(默认 true)。 */
  attachToBase?: boolean;
}

export class FurShell {
  /** 基础网格(毛发附着的目标)。 */
  baseMesh: Mesh;
  /** 毛发材质(所有 shell 共享同一实例)。 */
  furMaterial: FurMaterial;
  /** Shell 层数。 */
  shellCount: number;
  /** 生成的 shell mesh 列表(generate() 后填充)。 */
  shells: Mesh[] = [];
  /** 是否已 generate()。 */
  private _generated: boolean = false;
  /** 累积时间(秒)。 */
  private _elapsed: number = 0;
  /** 是否把 shells 作为 baseMesh 子节点挂载。 */
  private _attachToBase: boolean;

  constructor(opts: FurShellOptions) {
    this.baseMesh = opts.baseMesh;
    this.furMaterial = opts.furMaterial;
    this.shellCount = clampShellCount(opts.shellCount ?? 16);
    this._attachToBase = opts.attachToBase ?? true;
  }

  /** 生成多层 shell mesh。
   *  每层共享 baseMesh.geometry 与 furMaterial,但通过 material.shellLayer
   *  区分当前层。所有 shell.castShadow = false,避免多层阴影开销。
   *  重复调用会先清空旧 shells。 */
  generate(): void {
    this.dispose();

    const geom = this.baseMesh.geometry;
    for (let i = 0; i < this.shellCount; i++) {
      // layer = 0 (毛根) → 1 (毛尖);毛根层 (i=0) 跳过(用 baseMesh 本身)
      // 这里统一生成所有层,渲染顺序由 renderOrder 控制
      const layer = this.shellCount === 1 ? 0 : i / (this.shellCount - 1);
      const shellMat = this._createShellMaterial(layer);
      const shell = new Mesh(geom, shellMat);
      shell.castShadow = false;
      shell.receiveShadow = false;
      shell.renderOrder = 100 + i; // 在基础网格之后渲染
      shell.frustumCulled = true;
      shell.name = `fur_shell_${i}`;
      this.shells.push(shell);

      if (this._attachToBase) {
        this.baseMesh.add(shell);
      }
    }

    this._generated = true;
  }

  /** 创建与 FurMaterial 等价的实例,设置初始 shellLayer。
   *  注意:每层使用独立的 FurMaterial 实例,以便 renderer 缓存不同的
   *  u_shellLayer uniform 值。但所有实例的 furLength/furColor 等参数
   *  从源 furMaterial 复制,保持同步。 */
  private _createShellMaterial(layer: number): FurMaterial {
    const mat = this.furMaterial.clone();
    mat.shellLayer = layer;
    return mat;
  }

  /** 每帧更新:推进时间 + 同步各层 shellLayer。
   *  调用方在每帧 draw 之前调用。 */
  update(dt: number): void {
    if (!this._generated) return;
    if (dt < 0) dt = 0; // 防御负数 dt
    this._elapsed += dt;
    this.furMaterial.time = this._elapsed;

    // 同步源 furMaterial 的 time 与所有 shell 的 time
    for (let i = 0; i < this.shells.length; i++) {
      const mat = this.shells[i].material;
      if (mat instanceof FurMaterial) {
        mat.time = this._elapsed;
        // shellLayer 在 generate() 时已设置,不需要每帧重设
        // 但若用户改了 furLength/furColor 等,需要同步
        this._syncMaterialFields(mat);
      }
    }
  }

  /** 把源 furMaterial 的可变参数同步到 shell mat(每帧调用以反映用户修改)。 */
  private _syncMaterialFields(mat: FurMaterial): void {
    mat.furLength = this.furMaterial.furLength;
    mat.furDensity = this.furMaterial.furDensity;
    mat.furColor.copy(this.furMaterial.furColor);
    mat.furOcclusion = this.furMaterial.furOcclusion;
    mat.gravity.copy(this.furMaterial.gravity);
    mat.wind.copy(this.furMaterial.wind);
    mat.noiseTexture = this.furMaterial.noiseTexture;
    mat.opacity = this.furMaterial.opacity;
    mat.transparent = this.furMaterial.transparent;
    mat.doubleSided = this.furMaterial.doubleSided;
  }

  /** 设置 shell 层数(重新 generate 后生效)。
   *  范围 [2, 64],超出会被 clamp。 */
  setShellCount(count: number): void {
    this.shellCount = clampShellCount(count);
    if (this._generated) {
      this.generate();
    }
  }

  /** 获取所有 shell mesh(用于外部挂到场景图或自定义渲染)。 */
  getShells(): Mesh[] {
    return this.shells;
  }

  /** 获取累积时间。 */
  getElapsedTime(): number {
    return this._elapsed;
  }

  /** 释放资源:从 baseMesh 移除所有 shell 子节点。
   *  注意:不调用 geometry.dispose(),因为 shell 共享 baseMesh.geometry,
   *  由 baseMesh 负责释放。 */
  dispose(): void {
    for (const shell of this.shells) {
      if (shell.parent !== null) {
        shell.parent.remove(shell);
      }
    }
    this.shells = [];
    this._generated = false;
  }

  /** 是否已 generate()。 */
  isGenerated(): boolean {
    return this._generated;
  }
}

/** Clamp shell count 到合理范围 [2, 64]。 */
function clampShellCount(count: number): number {
  if (!Number.isFinite(count)) return 16;
  const n = Math.floor(count);
  if (n < 2) return 2;
  if (n > 64) return 64;
  return n;
}

/** 显式 re-export Object3D 类型,方便外部 import。 */
export type { Object3D };
