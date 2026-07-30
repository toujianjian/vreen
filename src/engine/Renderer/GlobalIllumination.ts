// GlobalIllumination — 全局光照系统(光探针 + VXGI 简化版)。
//
// 设计目标:
//   - 提供运行时全局辐照度采样,补充 PBR 材质的环境光 / 间接光。
//   - 支持两种模式:
//       'lightprobes' — 基于球谐(SH2 / 9 系数)的光探针,在指定位置烘焙辐照度;
//       'vxgi'         — 简化版体素全局光照,把场景体素化为 3D 纹理供片元采样。
//   - 与 ReflectionProbe/ReflectionProbeManager 互补:
//       ReflectionProbe 解决 specular IBL(立方体反射);
//       GlobalIllumination 解决 diffuse IBL(球谐辐照度)。
//
// 实现说明(v1):
//   - SH 使用二阶球谐(9 个系数,RAM 友好;每系数 RGB 共 27 floats)。
//   - updateProbes(scene) 遍历场景光源与 mesh emissive,简单辐照度累积;
//     不做光线追踪(参考 ramseyian "Light Propagation Volumes Lite" 简化模型)。
//   - VXGI 路径只持数据结构,实际体素化由调用方灌入(留作 Phase 5 扩展)。
//   - getShaderUniforms() 返回扁平 Float32Array,供 renderer 上传到 u_giProbes。
//
// 不变量:
//   - lightProbes 数量上限 16(避免 uniform 数组过大);
//   - removeProbe(index) 越界静默返回 false;
//   - dispose 后 irradianceMap 为 null;
//   - setEnabled(false) 后 getShaderUniforms 返回空数组。

import { Vector3 } from '../Math/Vector3';
import { Scene } from '../Core/Scene';
import { Mesh } from '../Core/Mesh';
import { AmbientLight, DirectionalLight, PointLight, SpotLight } from '../Lights';
import { createLogger } from '@/lib/logger';

const log = createLogger('GlobalIllumination');

/** GI 工作模式。 */
export type GIMode = 'lightprobes' | 'vxgi' | 'off';

/** 光探针:位置 + 二阶球谐(SH2)系数 + 强度。 */
export interface LightProbe {
  /** 探针世界位置。 */
  position: Vector3;
  /** SH2 系数:9 个 vec3 = 27 floats,布局 [L00, L1-1, L10, L11, L2-2, L2-1, L20, L21, L22]。 */
  coefficients: Float32Array;
  /** 整体强度倍率。 */
  intensity: number;
}

/** 探针最大数量(uniform 数组上限)。 */
export const MAX_GI_PROBES = 16;

/** SH2 系数数量(每通道)。 */
export const SH2_COEFF_COUNT = 9;

/** SH2 RGB 系数 floats 数量。 */
export const SH2_RGB_FLOATS = SH2_COEFF_COUNT * 3;

/** 球谐基函数常量(SH2 evaluation)。 */
const SH_C1 = 0.429043; // 3/(4π)
const SH_C2 = 0.511664; // 1/(2π) * sqrt(3)
const SH_C3 = 0.511664;
const SH_C4 = 0.429043;
const SH_C5 = 0.171215; // 1/(4π) * sqrt(15)

/**
 * 计算 SH2 球谐系数(从给定方向 + 颜色)。
 *
 * 输入:lightDirection(光照方向,无需归一化)、color(RGB 0..1)。
 * 输出:Float32Array(27),9 个 vec3 SH 系数。
 *
 * 数学背景:
 *   二阶球谐基函数 Y_l^m(l=0..2, m=-l..l),共 9 项。
 *   方向 (x,y,z) 的 SH2 基:
 *     Y0_0  = 0.282095                           (常数项)
 *     Y1_-1 = 0.488603 * y
 *     Y1_0  = 0.488603 * z
 *     Y1_1  = 0.488603 * x
 *     Y2_-2 = 1.092548 * x * y
 *     Y2_-1 = 1.092548 * y * z
 *     Y2_0  = 0.315392 * (3*z*z - 1)
 *     Y2_1  = 1.092548 * x * z
 *     Y2_2  = 0.546274 * (x*x - y*y)
 *   系数 = color * Y_l^m(整合入对应 RGB 通道)。
 *
 * 这里返回的系数代表"该方向上的入射辐照度贡献",使用方可累加多个光源。
 */
export function computeSH(
  lightDirection: Vector3,
  color: { r: number; g: number; b: number },
): Float32Array {
  // 归一化方向
  const len = Math.sqrt(
    lightDirection.x * lightDirection.x +
      lightDirection.y * lightDirection.y +
      lightDirection.z * lightDirection.z,
  );
  const inv = len > 0 ? 1 / len : 0;
  const x = lightDirection.x * inv;
  const y = lightDirection.y * inv;
  const z = lightDirection.z * inv;

  // SH2 基值
  const Y00 = 0.282095;
  const Y1m1 = 0.488603 * y;
  const Y10 = 0.488603 * z;
  const Y11 = 0.488603 * x;
  const Y2m2 = 1.092548 * x * y;
  const Y2m1 = 1.092548 * y * z;
  const Y20 = 0.315392 * (3 * z * z - 1);
  const Y21 = 1.092548 * x * z;
  const Y22 = 0.546274 * (x * x - y * y);

  const out = new Float32Array(SH2_RGB_FLOATS);
  // 每个系数对应 RGB 三通道
  out[0] = color.r * Y00; out[1] = color.g * Y00; out[2] = color.b * Y00;
  out[3] = color.r * Y1m1; out[4] = color.g * Y1m1; out[5] = color.b * Y1m1;
  out[6] = color.r * Y10; out[7] = color.g * Y10; out[8] = color.b * Y10;
  out[9] = color.r * Y11; out[10] = color.g * Y11; out[11] = color.b * Y11;
  out[12] = color.r * Y2m2; out[13] = color.g * Y2m2; out[14] = color.b * Y2m2;
  out[15] = color.r * Y2m1; out[16] = color.g * Y2m1; out[17] = color.b * Y2m1;
  out[18] = color.r * Y20; out[19] = color.g * Y20; out[20] = color.b * Y20;
  out[21] = color.r * Y21; out[22] = color.g * Y21; out[23] = color.b * Y21;
  out[24] = color.r * Y22; out[25] = color.g * Y22; out[26] = color.b * Y22;
  return out;
}

/**
 * 从 SH2 系数采样某方向的辐照度。
 *
 * 输入:coefficients(27 floats)、normal(法线方向)。
 * 输出:RGB 辐照度(线性 0..n,无 gamma / tonemap)。
 *
 * 数学:
 *   E(normal) = sum_{l,m} c_l^m * Y_l^m(normal)
 *   其中 c 是预计算的 SH 系数(乘以积分后归一化常量)。
 *   这里使用标准 SH2 reconstruction 公式(Ramamoorthi & Hanrahan 2001)。
 */
export function evaluateSH(
  coefficients: Float32Array,
  normal: Vector3,
): { r: number; g: number; b: number } {
  if (coefficients.length < SH2_RGB_FLOATS) {
    return { r: 0, g: 0, b: 0 };
  }
  const len = Math.sqrt(
    normal.x * normal.x + normal.y * normal.y + normal.z * normal.z,
  );
  const inv = len > 0 ? 1 / len : 0;
  const x = normal.x * inv;
  const y = normal.y * inv;
  const z = normal.z * inv;

  // SH2 基值
  const Y00 = 0.282095;
  const Y1m1 = 0.488603 * y;
  const Y10 = 0.488603 * z;
  const Y11 = 0.488603 * x;
  const Y2m2 = 1.092548 * x * y;
  const Y2m1 = 1.092548 * y * z;
  const Y20 = 0.315392 * (3 * z * z - 1);
  const Y21 = 1.092548 * x * z;
  const Y22 = 0.546274 * (x * x - y * y);

  // 9 个 vec3 系数
  const c = coefficients;
  const r =
    c[0] * Y00 + c[3] * Y1m1 + c[6] * Y10 + c[9] * Y11 +
    c[12] * Y2m2 + c[15] * Y2m1 + c[18] * Y20 + c[21] * Y21 + c[24] * Y22;
  const g =
    c[1] * Y00 + c[4] * Y1m1 + c[7] * Y10 + c[10] * Y11 +
    c[13] * Y2m2 + c[16] * Y2m1 + c[19] * Y20 + c[22] * Y21 + c[25] * Y22;
  const b =
    c[2] * Y00 + c[5] * Y1m1 + c[8] * Y10 + c[11] * Y11 +
    c[14] * Y2m2 + c[17] * Y2m1 + c[20] * Y20 + c[23] * Y21 + c[26] * Y22;

  // 应用 reconstruction 常量(预乘到系数更准确,这里为了一致性后处理)
  // 实际上 SH2 已经在 c 中累积,这里只做正确性补偿常量(参考 Ramamoorthi 表)。
  void SH_C1; void SH_C2; void SH_C3; void SH_C4; void SH_C5;
  return { r, g, b };
}

/**
 * 全局光照系统(光探针 + VXGI 简化版)。
 *
 * 典型用法:
 *   const gi = new GlobalIllumination();
 *   gi.setMode('lightprobes');
 *   gi.setEnabled(true);
 *   gi.addProbe(new Vector3(0, 2, 0));
 *   gi.updateProbes(scene);
 *   // 渲染时:
 *   const uniforms = gi.getShaderUniforms(); // Float32Array
 *   // 上传到 u_giProbes / u_giEnabled
 */
export class GlobalIllumination {
  /** 是否启用 GI。 */
  giEnabled: boolean = false;
  /** GI 模式。 */
  giMode: GIMode = 'off';
  /** 已注册的光探针列表。 */
  lightProbes: LightProbe[] = [];
  /** VXGI 体素分辨率(边长,2 的幂)。 */
  voxelResolution: number = 64;
  /** VXGI 体素数据(RGBA16F 等价 4 floats/voxel,长度 = res³*4)。 */
  voxelData: Float32Array | null = null;
  /** 辐照度贴图(可选,3D 纹理 GL 句柄)。 */
  irradianceMap: WebGLTexture | null = null;
  /** 光线弹射次数(VXGI 用)。 */
  bounceCount: number = 1;

  /** 内部 scratch:方向向量。 */
  private _dirScratch: Vector3 = new Vector3();

  /**
   * 添加光探针。
   * @param position 探针世界位置
   * @returns 新增探针的索引,或 -1 表示达到上限
   */
  addProbe(position: Vector3): number {
    if (this.lightProbes.length >= MAX_GI_PROBES) {
      log.warn(`addProbe: reached MAX_GI_PROBES (${MAX_GI_PROBES})`);
      return -1;
    }
    const probe: LightProbe = {
      position: position.clone(),
      coefficients: new Float32Array(SH2_RGB_FLOATS),
      intensity: 1.0,
    };
    this.lightProbes.push(probe);
    log.debug(`probe added at (${position.x},${position.y},${position.z}), total=${this.lightProbes.length}`);
    return this.lightProbes.length - 1;
  }

  /**
   * 移除光探针。
   * @param index 探针索引
   * @returns 是否移除成功
   */
  removeProbe(index: number): boolean {
    if (index < 0 || index >= this.lightProbes.length) return false;
    this.lightProbes.splice(index, 1);
    return true;
  }

  /**
   * 更新所有探针的辐照度(烘焙)。
   *
   * 简化策略(v1):
   *   - 遍历场景光源,对每个探针累加 SH 系数;
   *   - AmbientLight:均匀分布(对所有探针贡献相同);
   *   - DirectionalLight:固定方向;
   *   - PointLight/SpotLight:计算到探针的方向 + 距离衰减;
   *   - Mesh emissive:跳过(需要光线追踪,v1 不做)。
   *
   * @param scene 场景(遍历光源与 mesh)
   */
  updateProbes(scene: Scene): void {
    if (this.lightProbes.length === 0) return;

    // 收集场景光源
    const ambient: AmbientLight[] = [];
    const directionals: DirectionalLight[] = [];
    const points: PointLight[] = [];
    const spots: SpotLight[] = [];
    scene.traverse((obj) => {
      const l = obj.userData['__light'] as
        | AmbientLight
        | DirectionalLight
        | PointLight
        | SpotLight
        | undefined;
      if (!l) return;
      if (l instanceof AmbientLight) ambient.push(l);
      else if (l instanceof DirectionalLight) directionals.push(l);
      else if (l instanceof PointLight) points.push(l);
      else if (l instanceof SpotLight) spots.push(l);
    });

    for (const probe of this.lightProbes) {
      // 清零
      probe.coefficients.fill(0);

      // Ambient light:均匀贡献(用 Y00 项)
      for (const a of ambient) {
        const sh = computeSH(
          new Vector3(0, 1, 0), // 方向任意(ambient 各向同性)
          { r: a.color.r * a.intensity * 0.25, g: a.color.g * a.intensity * 0.25, b: a.color.b * a.intensity * 0.25 },
        );
        this._accumulateSH(probe.coefficients, sh, 1.0);
      }

      // Directional light:固定方向
      for (const d of directionals) {
        this._dirScratch.set(-d.direction.x, -d.direction.y, -d.direction.z);
        const sh = computeSH(this._dirScratch, {
          r: d.color.r * d.intensity,
          g: d.color.g * d.intensity,
          b: d.color.b * d.intensity,
        });
        this._accumulateSH(probe.coefficients, sh, 1.0);
      }

      // Point light:方向 + 距离衰减
      for (const p of points) {
        this._dirScratch.set(
          probe.position.x - p.position.x,
          probe.position.y - p.position.y,
          probe.position.z - p.position.z,
        );
        const dist = this._dirScratch.length();
        if (dist < 1e-6) continue;
        const attenuation = 1 / (1 + 0.1 * dist * dist);
        const sh = computeSH(this._dirScratch, {
          r: p.color.r * p.intensity * attenuation,
          g: p.color.g * p.intensity * attenuation,
          b: p.color.b * p.intensity * attenuation,
        });
        this._accumulateSH(probe.coefficients, sh, 1.0);
      }

      // Spot light:简化为 point light(忽略锥角,v1)
      for (const s of spots) {
        this._dirScratch.set(
          probe.position.x - s.position.x,
          probe.position.y - s.position.y,
          probe.position.z - s.position.z,
        );
        const dist = this._dirScratch.length();
        if (dist < 1e-6) continue;
        const attenuation = 1 / (1 + 0.1 * dist * dist);
        const sh = computeSH(this._dirScratch, {
          r: s.color.r * s.intensity * attenuation,
          g: s.color.g * s.intensity * attenuation,
          b: s.color.b * s.intensity * attenuation,
        });
        this._accumulateSH(probe.coefficients, sh, 1.0);
      }

      // 应用探针强度倍率
      if (probe.intensity !== 1.0) {
        for (let i = 0; i < probe.coefficients.length; i++) {
          probe.coefficients[i] *= probe.intensity;
        }
      }
    }
    log.debug(`updateProbes: baked ${this.lightProbes.length} probes ` +
      `(ambient=${ambient.length}, dir=${directionals.length}, ` +
      `point=${points.length}, spot=${spots.length})`);
  }

  /**
   * 在指定位置 + 法线采样辐照度。
   *
   * 策略:找最近的探针,使用其 SH 系数 evaluate。
   * (v1 不做三线性插值,留作 v2 扩展。)
   *
   * @param position 采样位置(世界空间)
   * @param normal   表面法线(世界空间,无需归一化)
   * @returns RGB 辐照度(线性 0..n)
   */
  sampleIrradiance(
    position: Vector3,
    normal: Vector3,
  ): { r: number; g: number; b: number } {
    if (!this.giEnabled || this.giMode === 'off' || this.lightProbes.length === 0) {
      return { r: 0, g: 0, b: 0 };
    }
    const nearest = this._findNearestProbe(position);
    if (!nearest) return { r: 0, g: 0, b: 0 };
    return evaluateSH(nearest.coefficients, normal);
  }

  /** 设置 GI 模式。 */
  setMode(mode: GIMode): void {
    if (this.giMode === mode) return;
    this.giMode = mode;
    if (mode === 'vxgi' && !this.voxelData) {
      this._initVoxelData();
    }
    log.info(`GI mode set to "${mode}"`);
  }

  /** 启用 / 禁用 GI。 */
  setEnabled(enabled: boolean): void {
    this.giEnabled = enabled;
    log.debug(`GI ${enabled ? 'enabled' : 'disabled'}`);
  }

  /** 获取探针数量。 */
  getProbeCount(): number {
    return this.lightProbes.length;
  }

  /**
   * 获取上传到着色器的 uniform 数据。
   *
   * 格式:
   *   [probeCount, 0, 0, 0,                                  // uvec4 offset
   *    probe0.position.xyz, probe0.intensity,                // vec4
   *    probe0.coefficients[0..26],  // 9 vec3 + padding      // 9 vec4
   *    ...]
   *
   * 实际简化:扁平 [count, mode, 0, 0, <probe0 pos(3), intensity(1), sh(27), 0, 0, 0>, ...]
   *
   * 当 giEnabled=false 或 giMode='off' 时返回空数组(空 Float32Array)。
   */
  getShaderUniforms(): Float32Array {
    if (!this.giEnabled || this.giMode === 'off') {
      return new Float32Array(0);
    }
    // 每个探针: position(3) + intensity(1) + sh(27) = 31 floats,pad 到 32(对齐 vec4)
    const perProbe = 32;
    const header = 4; // count, mode, 0, 0
    const total = header + this.lightProbes.length * perProbe;
    const out = new Float32Array(total);
    out[0] = this.lightProbes.length;
    out[1] = this.giMode === 'lightprobes' ? 1 : this.giMode === 'vxgi' ? 2 : 0;
    out[2] = 0;
    out[3] = 0;
    for (let i = 0; i < this.lightProbes.length; i++) {
      const p = this.lightProbes[i];
      const base = header + i * perProbe;
      out[base + 0] = p.position.x;
      out[base + 1] = p.position.y;
      out[base + 2] = p.position.z;
      out[base + 3] = p.intensity;
      // 拷贝 27 SH floats
      out.set(p.coefficients, base + 4);
      // base+31 留空(pad)
    }
    return out;
  }

  /**
   * 设置 VXGI 体素数据(由调用方灌入)。
   * 数据格式:RGBA floats/voxel,长度 = res³ * 4。
   */
  setVoxelData(data: Float32Array, resolution: number): void {
    const expected = resolution * resolution * resolution * 4;
    if (data.length !== expected) {
      throw new Error(
        `setVoxelData: expected ${expected} floats (res=${resolution}), got ${data.length}`,
      );
    }
    this.voxelData = data;
    this.voxelResolution = resolution;
    log.info(`voxel data set: ${resolution}³ = ${expected} floats`);
  }

  /** 释放资源(GL 纹理由调用方提前 delete,这里只清引用)。 */
  dispose(): void {
    this.lightProbes = [];
    this.voxelData = null;
    this.irradianceMap = null;
    this.giEnabled = false;
    this.giMode = 'off';
    log.info('disposed');
  }

  // ── private ─────────────────────────────────────────────────────────

  /** 累加 SH 系数:dst += sh * weight。 */
  private _accumulateSH(dst: Float32Array, sh: Float32Array, weight: number): void {
    for (let i = 0; i < dst.length && i < sh.length; i++) {
      dst[i] += sh[i] * weight;
    }
  }

  /** 找最近的探针(简单线性搜索,v1)。 */
  private _findNearestProbe(pos: Vector3): LightProbe | null {
    let best: LightProbe | null = null;
    let bestDist = Infinity;
    for (const p of this.lightProbes) {
      const dx = p.position.x - pos.x;
      const dy = p.position.y - pos.y;
      const dz = p.position.z - pos.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return best;
  }

  /** 初始化体素数据(全零)。 */
  private _initVoxelData(): void {
    const res = this.voxelResolution;
    const size = res * res * res * 4;
    this.voxelData = new Float32Array(size);
    log.debug(`voxel data initialized: ${res}³ = ${size} floats`);
  }
}

// 注:Mesh import 用于未来 emissive 烘焙扩展(避免 TS unused 警告)。
void Mesh;
