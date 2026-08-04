// DDGIDebugVisualizer — DDGI 探针网格调试可视化。
//
// 设计目标:
//   - 把 DDGIVolume 的内部状态(探针位置 / 有效性 / SH2 辐照度 / 遮挡深度)
//     绘制到 DebugRenderer,让美术 / 工程师能直观看到探针布局与 GI 质量。
//   - 不依赖 WebGL:所有绘制请求走 DebugRenderer 的数据 API,可在 Node /
//     无头环境测试,也兼容自研 WebGL2 / Three.js 两条渲染后端。
//   - 与 o3de Atom 的 `DiffuseGlobalIllumination` DebugDraw、UE5 Lumen 的
//     `Lumen.Visualize` 对标 —— 顶级引擎的 GI 调试标配。
//
// 可视化模式(可任意组合):
//   1. showBounds     — volume AABB 包围盒(12 边线框)
//   2. showProbes     — 每个探针一个点,颜色 = 该探针 SH2 在采样法线方向的
//                       辐照度(tonemapped);无效探针标红。
//   3. showIrradiance — 每个探针一个小线框球,染色同 showProbes,
//                       直观呈现辐照度的空间分布(彩色球阵)。
//   4. showDepthRays  — 从探针沿采样法线发射射线,长度 = probeDepth
//                       (探针最近命中距离),黄色;用于检查遮挡数据。
//   5. showGrid       — 连接相邻探针(+X/+Y/+Z 邻居)的线段,绘制 3D 网格。
//
// 不变量:
//   - visualize() 不修改 volume 状态(只读);
//   - DebugRenderer.enabled=false 时所有绘制静默跳过(由 DebugRenderer 保证);
//   - 纯函数 heatColor / tonemapColor / probeIrradianceColor 可独立测试;
//   - duration 默认 0(单帧),调用方需每帧重新 visualize()。
//
// 参考:
//   - o3de Atom `DiffuseGlobalIllumination` DebugDraw
//   - UE5 Lumen `Lumen.Visualize` ProbeView
//   - Zinke et al. 2020 "Dynamic Diffuse GI with Ray-Traced Irradiance Fields"

import { Vector3 } from '../Math/Vector3';
import { Box3 } from '../Math/Box3';
import { Sphere } from '../Math/Sphere';
import type { DebugColor, DebugRenderer } from '../Helpers/DebugRenderer';
import type { DDGIVolume } from './DDGIVolume';
import { evaluateSH, SH2_RGB_FLOATS } from './GlobalIllumination';
import { createLogger } from '@/lib/logger';

const log = createLogger('DDGIDebugVisualizer');

// ── 纯函数(无 GL,可独立测试) ─────────────────────────────────────

/**
 * 热力图色阶:把 [0,1] 标量映射到 RGB 颜色。
 *
 * 5 段线性插值:深蓝 → 青 → 绿 → 黄 → 红。
 * t<0 → 蓝;t>1 → 红。
 *
 * @param t 标量值(典型为归一化亮度)
 * @returns  RGB [0,1]
 */
export function heatColor(t: number): DebugColor {
  // clamp 到 [0,1] 后做 5 段插值
  const x = Math.max(0, Math.min(1, t));
  // 色阶断点
  const stops: Array<[number, DebugColor]> = [
    [0.0, [0.05, 0.0, 0.35]],   // 深蓝
    [0.25, [0.0, 0.55, 0.95]],  // 青
    [0.5, [0.0, 0.85, 0.35]],   // 绿
    [0.75, [0.98, 0.85, 0.05]], // 黄
    [1.0, [0.95, 0.1, 0.1]],    // 红
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (x <= t1) {
      const a = (x - t0) / (t1 - t0);
      return [
        c0[0] + (c1[0] - c0[0]) * a,
        c0[1] + (c1[1] - c0[1]) * a,
        c0[2] + (c1[2] - c0[2]) * a,
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Reinhard 色调映射 + 曝光 + clamp 到 [0,1]。
 *
 * 用于把线性 HDR 辐照度(RGB,可能 >1)映射到调试显示颜色。
 *   mapped = c / (1 + c)   (Reinhard)
 *
 * @param rgb     线性 RGB(各分量 >=0)
 * @param exposure 曝光倍数(默认 1)
 * @returns        [0,1] RGB
 */
export function tonemapColor(
  rgb: { r: number; g: number; b: number },
  exposure: number = 1,
): DebugColor {
  const e = Math.max(0, exposure);
  const r = rgb.r * e;
  const g = rgb.g * e;
  const b = rgb.b * e;
  return [
    Math.min(1, r / (1 + r)),
    Math.min(1, g / (1 + g)),
    Math.min(1, b / (1 + b)),
  ];
}

/**
 * 计算单个探针在指定法线方向的辐照度显示颜色。
 *
 * 取探针的 SH2 系数 → evaluateSH(normal) → tonemap → 返回 [0,1] RGB。
 * 无效探针返回红色(标识未更新)。
 *
 * @param volume   DDGIVolume
 * @param probeIdx 探针 1D 索引
 * @param normal   采样法线(归一化)
 * @param exposure 曝光(默认 1)
 * @returns         [0,1] RGB;无效探针返回 [1, 0.15, 0.15]
 */
export function probeIrradianceColor(
  volume: DDGIVolume,
  probeIdx: number,
  normal: Vector3,
  exposure: number = 1,
): DebugColor {
  if (probeIdx < 0 || probeIdx >= volume.totalProbes) return [0, 0, 0];
  if (volume.probeValidity[probeIdx] === 0) return [1, 0.15, 0.15];
  const offset = probeIdx * SH2_RGB_FLOATS;
  const sh = volume.probes.subarray(offset, offset + SH2_RGB_FLOATS);
  const irr = evaluateSH(sh, normal);
  return tonemapColor(irr, exposure);
}

/**
 * 计算探针有效性的双色显示(有效=青绿,无效=红)。
 * @param valid 是否有效
 */
export function probeValidityColor(valid: boolean): DebugColor {
  return valid ? [0.2, 1.0, 0.5] : [1.0, 0.15, 0.15];
}

// ── DDGIDebugVisualizer 类 ─────────────────────────────────────────

export interface DDGIDebugOptions {
  /** 显示 volume AABB 包围盒。默认 true。 */
  showBounds?: boolean;
  /** 显示探针位置点(颜色 = SH2 辐照度)。默认 true。 */
  showProbes?: boolean;
  /** 显示每探针的辐照度预览球(线框,染色同 showProbes)。默认 false。 */
  showIrradiance?: boolean;
  /** 显示遮挡深度射线(沿采样法线,长度 = probeDepth)。默认 false。 */
  showDepthRays?: boolean;
  /** 显示探针 3D 网格连线(+X/+Y/+Z 邻居)。默认 false。 */
  showGrid?: boolean;
  /** 探针点大小(像素)。默认 6。 */
  probeSize?: number;
  /** 辐照度预览球半径(世界单位)。默认 0 = 自动取 cellSize 最小轴 × 0.18。 */
  irradianceRadius?: number;
  /** 深度射线颜色。默认黄色。 */
  depthRayColor?: DebugColor;
  /** 网格连线颜色。默认暗青。 */
  gridColor?: DebugColor;
  /** 包围盒颜色。默认青色。 */
  boundsColor?: DebugColor;
  /** 辐照度采样法线(默认 +Y 上方向)。 */
  irradianceNormal?: Vector3;
  /** 曝光(辐照度 tonemap 倍数)。默认 1。 */
  exposure?: number;
  /** 显示时长(秒);0=单帧,需每帧调用;Infinity=永久。默认 0。 */
  duration?: number;
}

const DEFAULTS: Required<Omit<DDGIDebugOptions, 'irradianceRadius' | 'irradianceNormal'>> = {
  showBounds: true,
  showProbes: true,
  showIrradiance: false,
  showDepthRays: false,
  showGrid: false,
  probeSize: 6,
  depthRayColor: [1.0, 0.85, 0.0],
  gridColor: [0.2, 0.6, 0.7],
  boundsColor: [0.0, 1.0, 1.0],
  exposure: 1,
  duration: 0,
};

/**
 * DDGI 调试可视化器。
 *
 * 把 DDGIVolume 的探针网格绘制到 DebugRenderer。无 GL 依赖,可在 Node 测试。
 *
 * 典型用法:
 * ```ts
 * const viz = new DDGIDebugVisualizer({ showIrradiance: true, exposure: 1.5 });
 * // 每帧:
 * viz.visualize(ddgiVolume, debugRenderer);
 * ```
 */
export class DDGIDebugVisualizer {
  showBounds: boolean;
  showProbes: boolean;
  showIrradiance: boolean;
  showDepthRays: boolean;
  showGrid: boolean;
  probeSize: number;
  /** 预览球半径;null = 自动。 */
  irradianceRadius: number | null;
  depthRayColor: DebugColor;
  gridColor: DebugColor;
  boundsColor: DebugColor;
  irradianceNormal: Vector3;
  exposure: number;
  duration: number;

  constructor(opts: DDGIDebugOptions = {}) {
    this.showBounds = opts.showBounds ?? DEFAULTS.showBounds;
    this.showProbes = opts.showProbes ?? DEFAULTS.showProbes;
    this.showIrradiance = opts.showIrradiance ?? DEFAULTS.showIrradiance;
    this.showDepthRays = opts.showDepthRays ?? DEFAULTS.showDepthRays;
    this.showGrid = opts.showGrid ?? DEFAULTS.showGrid;
    this.probeSize = opts.probeSize ?? DEFAULTS.probeSize;
    this.irradianceRadius = opts.irradianceRadius ?? null;
    this.depthRayColor = opts.depthRayColor ?? DEFAULTS.depthRayColor;
    this.gridColor = opts.gridColor ?? DEFAULTS.gridColor;
    this.boundsColor = opts.boundsColor ?? DEFAULTS.boundsColor;
    this.irradianceNormal = opts.irradianceNormal
      ? opts.irradianceNormal.clone()
      : new Vector3(0, 1, 0);
    this.exposure = opts.exposure ?? DEFAULTS.exposure;
    this.duration = opts.duration ?? DEFAULTS.duration;
  }

  /** 批量更新选项。 */
  setOptions(opts: Partial<DDGIDebugOptions>): void {
    if (opts.showBounds !== undefined) this.showBounds = opts.showBounds;
    if (opts.showProbes !== undefined) this.showProbes = opts.showProbes;
    if (opts.showIrradiance !== undefined) this.showIrradiance = opts.showIrradiance;
    if (opts.showDepthRays !== undefined) this.showDepthRays = opts.showDepthRays;
    if (opts.showGrid !== undefined) this.showGrid = opts.showGrid;
    if (opts.probeSize !== undefined) this.probeSize = opts.probeSize;
    if (opts.irradianceRadius !== undefined) this.irradianceRadius = opts.irradianceRadius;
    if (opts.depthRayColor !== undefined) this.depthRayColor = opts.depthRayColor;
    if (opts.gridColor !== undefined) this.gridColor = opts.gridColor;
    if (opts.boundsColor !== undefined) this.boundsColor = opts.boundsColor;
    if (opts.irradianceNormal !== undefined) this.irradianceNormal = opts.irradianceNormal.clone();
    if (opts.exposure !== undefined) this.exposure = opts.exposure;
    if (opts.duration !== undefined) this.duration = opts.duration;
  }

  /**
   * 把 DDGIVolume 的调试可视化绘制到 DebugRenderer。
   *
   * @param volume DDGIVolume(只读)
   * @param debug  DebugRenderer(绘制目标)
   */
  visualize(volume: DDGIVolume, debug: DebugRenderer): void {
    if (!debug.enabled) return;
    const dur = this.duration;
    const n = this.irradianceNormal;

    // ── 包围盒 ────────────────────────────────────────────────
    if (this.showBounds) {
      const box = new Box3(volume.origin.clone(), volume.maxCorner.clone());
      debug.drawBox(box, this.boundsColor, dur);
    }

    // 自动预览球半径
    const autoR =
      Math.min(volume.cellSize.x, volume.cellSize.y, volume.cellSize.z) * 0.18;
    const sphereR = this.irradianceRadius ?? autoR;

    const lineStart = debug.lines.length;
    const pointStart = debug.points.length;

    // ── 遍历探针 ──────────────────────────────────────────────
    for (let i = 0; i < volume.totalProbes; i++) {
      const pos = volume.getProbePosition(i);
      const valid = volume.probeValidity[i] === 1;

      if (this.showProbes) {
        const col = valid
          ? probeIrradianceColor(volume, i, n, this.exposure)
          : probeValidityColor(false);
        debug.drawPoint(pos, col, this.probeSize, dur);
      }

      if (this.showIrradiance && valid) {
        const col = probeIrradianceColor(volume, i, n, this.exposure);
        debug.drawSphere(new Sphere(pos, sphereR), col, dur, 8);
      }

      if (this.showDepthRays && valid) {
        const depth = volume.probeDepths[i];
        if (depth > 0) {
          debug.drawRay(pos, n, this.depthRayColor, depth, dur);
        }
      }
    }

    // ── 网格连线(+X/+Y/+Z 邻居) ────────────────────────────────
    if (this.showGrid) {
      this._drawGrid(volume, debug, dur);
    }

    const drawnLines = debug.lines.length - lineStart;
    const drawnPoints = debug.points.length - pointStart;
    log.debug(`visualized ${volume.totalProbes} probes (+${drawnLines} lines, +${drawnPoints} points)`);
  }

  /** 绘制探针 3D 网格连线(每探针连 +X/+Y/+Z 邻居)。 */
  private _drawGrid(volume: DDGIVolume, debug: DebugRenderer, dur: number): void {
    const dims = volume.probeCount;
    const col = this.gridColor;
    for (let iz = 0; iz < dims.z; iz++) {
      for (let iy = 0; iy < dims.y; iy++) {
        for (let ix = 0; ix < dims.x; ix++) {
          const a = volume.getProbePosition(
            ix + iy * dims.x + iz * dims.x * dims.y,
          );
          // +X 邻居
          if (ix + 1 < dims.x) {
            const b = volume.getProbePosition(
              (ix + 1) + iy * dims.x + iz * dims.x * dims.y,
            );
            debug.drawLine(a, b, col, dur);
          }
          // +Y 邻居
          if (iy + 1 < dims.y) {
            const b = volume.getProbePosition(
              ix + (iy + 1) * dims.x + iz * dims.x * dims.y,
            );
            debug.drawLine(a, b, col, dur);
          }
          // +Z 邻居
          if (iz + 1 < dims.z) {
            const b = volume.getProbePosition(
              ix + iy * dims.x + (iz + 1) * dims.x * dims.y,
            );
            debug.drawLine(a, b, col, dur);
          }
        }
      }
    }
  }
}
