// LensFlare — 镜头光晕效果(CPU 侧合成)。
//
// 设计目标:
//   - 模拟相机镜头在强光下产生的光晕:核心(highlight)、光环(halo)、
//     重影(ghosts)、光芒(streak)。所有元素沿"光源屏幕位置 → 屏幕中心"
//     的轴线分布,符合真实镜头光学规律;
//   - CPU 侧基于 Uint8ClampedArray 像素合成,不依赖 WebGL 上下文,
//     可在无头环境(Node / 测试 / SSR)运行,适合离线渲染 / 截图 / 回放;
//   - 可见性由两类判定控制:
//       a) 方向判定:光源位于相机后方时(dot < 0)不可见;
//       b) 遮挡判定:可选的 ray-sphere 相交测试,若光源被任意包围球遮挡,
//          光晕按距离衰减(完全遮挡 → 0,部分遮挡 → 线性插值);
//   - 与 MotionBlurPass.ts / TAAPass.ts 同构:CPU 侧 Pass,不持有 GL 资源,
//     可在 Node 环境 vitest 中直跑。
//
// 不变量:
//   - enabled=false 时 render 返回输入副本;
//   - 光源位于近平面之前(behind camera)时,visibility=0,输出 = 输入副本;
//   - render 不修改输入 data,返回新分配的 Uint8ClampedArray;
//   - flare 元素的 positionAlongAxis 范围任意:0.0 = 光源屏幕位置,
//     1.0 = 屏幕中心,>1.0 越过屏幕中心到对侧,<0.0 在光源外侧;
//   - additive 合成:flare.rgb * flare.opacity * visibility * intensity
//     叠加到 input,clamp 到 255。
//
// 参考:
//   - three.js Lensflare.js by Mugen87
//   - o3de Atom LensFlarePass
//   - GPU Pro "Real-Time Lens Flare Rendering"

import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import { createLogger } from '@/lib/logger';

const log = createLogger('LensFlare');

/** Flare 元素类型。 */
export type FlareKind = 'core' | 'halo' | 'ghost' | 'streak';

/** 单个 flare 元素描述。 */
export interface FlareElement {
  /** 元素类型。 */
  kind: FlareKind;
  /**
   * 沿轴线的归一化位置。
   * - 0.0 = 光源屏幕位置
   * - 1.0 = 屏幕中心
   * - >1.0 越过屏幕中心到对侧
   * - <0.0 在光源外侧
   */
  positionAlongAxis: number;
  /** 半径(像素)。 */
  size: number;
  /** 颜色 [r, g, b],0..1。 */
  color: [number, number, number];
  /** 不透明度 0..1。 */
  opacity: number;
  /** 仅 streak:光芒角度(弧度,0 = 水平)。 */
  angle?: number;
  /** 仅 ghost/halo:径向衰减幂(越大边缘越锐,默认 2)。 */
  falloff?: number;
}

/** LensFlare 构造选项。 */
export interface LensFlareOptions {
  /** 是否启用(默认 true)。禁用时 render 返回输入副本。 */
  enabled?: boolean;
  /** 全局强度倍率(默认 1.0)。 */
  intensity?: number;
  /** flare 元素列表(不传则使用默认预设)。 */
  flares?: FlareElement[];
  /** 遮挡测试采样数(0 = 禁用遮挡测试,默认 8)。 */
  occlusionSamples?: number;
  /** 遮挡采样半径(texel,默认 4)。 */
  occlusionRadius?: number;
  /** 光源位于相机后方的 dot 阈值(默认 0,即完全在后方才不可见)。 */
  behindThreshold?: number;
}

/** LensFlare 统计信息(上次 render 的指标)。 */
export interface LensFlareStats {
  /** 累计 draw call 次数(每个 flare 元素 +1)。 */
  drawCalls: number;
  /** 上一帧渲染的可见 flare 数(visibility > 0)。 */
  visibleFlares: number;
  /** 上一帧渲染耗时(ms)。 */
  lastFrameTimeMs: number;
  /** 光源屏幕 X(NDC,-1..1,behind 时不定义)。 */
  lightScreenX: number;
  /** 光源屏幕 Y(NDC,-1..1,behind 时不定义)。 */
  lightScreenY: number;
  /** 上一帧可见性(0..1)。 */
  visibility: number;
  /** 上一帧光源是否在相机后方。 */
  behindCamera: boolean;
  /** 上一帧遮挡测试命中的遮挡物数量。 */
  occludersHit: number;
}

/** render 输入:RGBA 像素数据 + 尺寸。 */
export interface LensFlareInput {
  /** RGBA 字节流,长度 = width * height * 4。 */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 相机结构类型:任何带 position / projectionMatrix / matrixWorldInverse 的对象。 */
export interface LensFlareCamera {
  position: Vector3;
  projectionMatrix: Matrix4;
  matrixWorldInverse: Matrix4;
}

/** 遮挡球:简单的射线-球相交测试用包围球。 */
export interface OccluderSphere {
  center: Vector3;
  radius: number;
}

// ── 默认 flare 预设 ────────────────────────────────────────────────────

/**
 * 默认 flare 预设:1 个核心 + 1 个大光环 + 6 个重影 + 1 条水平光芒。
 * 模仿典型电影镜头光晕的视觉风格。
 */
export const DEFAULT_FLARES: FlareElement[] = [
  // 核心:位于光源处,小而亮
  { kind: 'core', positionAlongAxis: 0.0, size: 24, color: [1.0, 0.95, 0.85], opacity: 1.0, falloff: 1.5 },
  // 光环:位于光源处,大而淡
  { kind: 'halo', positionAlongAxis: 0.0, size: 96, color: [0.9, 0.8, 0.6], opacity: 0.35, falloff: 3.0 },
  // 光芒:水平方向贯穿核心
  { kind: 'streak', positionAlongAxis: 0.0, size: 180, color: [1.0, 0.9, 0.7], opacity: 0.5, angle: 0 },
  // 重影:沿轴线的彩色小圆
  { kind: 'ghost', positionAlongAxis: 0.32, size: 18, color: [0.3, 0.6, 1.0], opacity: 0.55, falloff: 2.0 },
  { kind: 'ghost', positionAlongAxis: 0.52, size: 26, color: [0.9, 0.4, 0.3], opacity: 0.45, falloff: 2.0 },
  { kind: 'ghost', positionAlongAxis: 0.72, size: 14, color: [0.5, 1.0, 0.5], opacity: 0.5, falloff: 2.0 },
  { kind: 'ghost', positionAlongAxis: 1.0, size: 40, color: [0.8, 0.7, 0.4], opacity: 0.4, falloff: 2.5 },
  { kind: 'ghost', positionAlongAxis: 1.32, size: 20, color: [0.4, 0.5, 1.0], opacity: 0.45, falloff: 2.0 },
  { kind: 'ghost', positionAlongAxis: 1.62, size: 12, color: [1.0, 0.3, 0.5], opacity: 0.4, falloff: 2.0 },
];

// ── 临时变量(避免每帧 GC 压力) ────────────────────────────────────────

const _lightDir = new Vector3();
const _lightClip = new Vector3();
const _camForward = new Vector3();
const _rayDir = new Vector3();
const _occluderVec = new Vector3();

// ── LensFlare 类 ──────────────────────────────────────────────────────

/**
 * 镜头光晕效果(CPU 侧)。
 *
 * 典型每帧用法:
 * ```ts
 * const lensFlare = new LensFlare({ intensity: 1.0 });
 * // 主场景渲染后,合成光晕:
 * const out = lensFlare.render(
 *   { data, width, height },
 *   sunWorldPos,
 *   camera,
 *   occluderSpheres,  // 可选,用于遮挡测试
 * );
 * ```
 */
export class LensFlare {
  readonly name = 'lens-flare';

  enabled: boolean = true;
  intensity: number = 1.0;
  /** flare 元素列表(可运行时替换)。 */
  flares: FlareElement[];
  occlusionSamples: number;
  occlusionRadius: number;
  behindThreshold: number;

  /** 上次 render 的统计。 */
  stats: LensFlareStats = {
    drawCalls: 0,
    visibleFlares: 0,
    lastFrameTimeMs: 0,
    lightScreenX: 0,
    lightScreenY: 0,
    visibility: 0,
    behindCamera: false,
    occludersHit: 0,
  };

  constructor(opts: LensFlareOptions = {}) {
    this.enabled = opts.enabled ?? true;
    this.intensity = opts.intensity ?? 1.0;
    this.flares = opts.flares
      ? opts.flares.map((f) => ({ ...f, color: [...f.color] as [number, number, number] }))
      : DEFAULT_FLARES.map((f) => ({ ...f, color: [...f.color] as [number, number, number] }));
    this.occlusionSamples = opts.occlusionSamples ?? 8;
    this.occlusionRadius = opts.occlusionRadius ?? 4;
    this.behindThreshold = opts.behindThreshold ?? 0;
  }

  /**
   * 设置全局强度(链式 API)。
   */
  setIntensity(intensity: number): this {
    this.intensity = Math.max(0, intensity);
    return this;
  }

  /**
   * 替换 flare 元素列表。
   */
  setFlares(flares: FlareElement[]): this {
    this.flares = flares.map((f) => ({ ...f, color: [...f.color] as [number, number, number] }));
    return this;
  }

  /**
   * 添加单个 flare 元素。
   */
  addFlare(flare: FlareElement): this {
    this.flares.push({ ...flare, color: [...flare.color] as [number, number, number] });
    return this;
  }

  /**
   * 清空 flare 元素列表。
   */
  clearFlares(): this {
    this.flares.length = 0;
    return this;
  }

  /**
   * 计算光源的屏幕空间位置与可见性。
   *
   * @param lightWorldPos 光源世界坐标
   * @param camera 相机
   * @param occluders 可选遮挡球列表
   * @returns `{ screenX, screenY, visibility, behindCamera, occludersHit }`
   *   - screenX/Y:NDC -1..1(behindCamera=true 时为 0)
   *   - visibility:0..1
   */
  computeLightScreen(
    lightWorldPos: Vector3,
    camera: LensFlareCamera,
    occluders?: OccluderSphere[],
  ): {
    screenX: number;
    screenY: number;
    visibility: number;
    behindCamera: boolean;
    occludersHit: number;
  } {
    // 1. 计算光源相对相机的方向(世界空间)
    _lightDir.copy(lightWorldPos).sub(camera.position);
    const lightDist = _lightDir.length();
    if (lightDist < 1e-8) {
      // 光源在相机位置,不可见
      return { screenX: 0, screenY: 0, visibility: 0, behindCamera: true, occludersHit: 0 };
    }
    _lightDir.divideScalar(lightDist);

    // 2. 计算相机前向(从矩阵世界逆的第 3 列,即 -Z 轴)
    // matrixWorldInverse 的第 3 列(z 轴)取负 = 前向
    const invE = camera.matrixWorldInverse.elements;
    _camForward.set(-invE[8], -invE[9], -invE[10]).normalize();

    // 3. 方向判定:dot < behindThreshold 表示光源在相机后方
    const dot = _lightDir.dot(_camForward);
    if (dot < this.behindThreshold) {
      return { screenX: 0, screenY: 0, visibility: 0, behindCamera: true, occludersHit: 0 };
    }

    // 4. 投影到裁剪空间:clip = projection * view * worldPos
    //    view * worldPos = matrixWorldInverse * lightWorldPos
    //    再用 projectionMatrix 变换
    // 我们复用 _lightClip:先 view 变换再 projection 变换
    _lightClip.copy(lightWorldPos).applyMatrix4(camera.matrixWorldInverse);
    _lightClip.applyMatrix4(camera.projectionMatrix);

    // 5. NDC(透视除法后)
    const w = 1; // applyMatrix4 已做透视除法
    void w;
    const ndcX = _lightClip.x;
    const ndcY = _lightClip.y;

    // 6. 遮挡测试:ray-sphere 相交
    let occludersHit = 0;
    let occlusionFactor = 1.0;
    if (occluders && occluders.length > 0 && this.occlusionSamples > 0) {
      _rayDir.copy(lightWorldPos).sub(camera.position); // 未归一化,保留距离信息
      const rayLen = _rayDir.length();
      if (rayLen > 1e-8) {
        _rayDir.divideScalar(rayLen);
        for (const occ of occluders) {
          // ray-sphere: |(sphereCenter - rayOrigin) - dot(sphereCenter - rayOrigin, rayDir) * rayDir|^2 <= r^2
          // 且交点距离 < lightDist(遮挡物在光源前)
          _occluderVec.copy(occ.center).sub(camera.position);
          const projDist = _occluderVec.dot(_rayDir); // 沿射线方向的投影距离
          if (projDist < 0 || projDist >= lightDist) continue; // 在相机后方或光源后方
          // 垂直距离
          const perpSq = _occluderVec.lengthSq() - projDist * projDist;
          if (perpSq <= occ.radius * occ.radius) {
            occludersHit++;
            // 按距离衰减:遮挡物越靠近光源,影响越小(更可能只是擦边)
            const t = projDist / lightDist; // 0..1
            const occlusionStrength = 1.0 - t * 0.5; // 0.5..1.0
            occlusionFactor *= 1.0 - occlusionStrength;
            if (occlusionFactor < 0) occlusionFactor = 0;
          }
        }
      }
    }

    // 7. 综合 visibility:方向因子 * 遮挡因子
    // 方向因子:光源越靠前(dot → 1)越亮,越靠侧(dot → 0)越暗
    const directionFactor = Math.max(0, dot);
    const visibility = directionFactor * occlusionFactor;

    return {
      screenX: ndcX,
      screenY: ndcY,
      visibility,
      behindCamera: false,
      occludersHit,
    };
  }

  /**
   * 合成光晕到输入像素。
   *
   * @param input RGBA 像素 + 尺寸
   * @param lightWorldPos 光源世界坐标
   * @param camera 相机
   * @param occluders 可选遮挡球列表
   * @returns 新分配的 Uint8ClampedArray(含光晕合成结果)
   */
  render(
    input: LensFlareInput,
    lightWorldPos: Vector3,
    camera: LensFlareCamera,
    occluders?: OccluderSphere[],
  ): Uint8ClampedArray {
    const startTime = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const { data, width, height } = input;
    // 复制输入作为输出基底
    const output = new Uint8ClampedArray(data);

    // 禁用或光源在相机后方:直接返回输入副本
    if (!this.enabled) {
      this._updateStats(0, 0, 0, 0, 0, false, 0, startTime);
      return output;
    }

    const { screenX, screenY, visibility, behindCamera, occludersHit } = this.computeLightScreen(
      lightWorldPos,
      camera,
      occluders,
    );

    if (behindCamera || visibility <= 0) {
      this._updateStats(0, 0, screenX, screenY, 0, behindCamera, occludersHit, startTime);
      return output;
    }

    // 屏幕中心(NDC 0,0 → 像素 width/2, height/2)
    const centerX = width * 0.5;
    const centerY = height * 0.5;
    // 光源屏幕像素位置(NDC → 像素)
    const lightPx = (screenX * 0.5 + 0.5) * width;
    const lightPy = (-screenY * 0.5 + 0.5) * height; // Y 翻转

    // 轴向:从光源到屏幕中心
    const axisX = centerX - lightPx;
    const axisY = centerY - lightPy;

    let drawCalls = 0;
    let visibleFlares = 0;

    for (const flare of this.flares) {
      const flareIntensity = flare.opacity * visibility * this.intensity;
      if (flareIntensity <= 0) continue;
      visibleFlares++;

      // flare 中心位置(像素)
      const px = lightPx + axisX * flare.positionAlongAxis;
      const py = lightPy + axisY * flare.positionAlongAxis;

      this._drawFlare(output, width, height, px, py, flare, flareIntensity);
      drawCalls++;
    }

    this._updateStats(drawCalls, visibleFlares, screenX, screenY, visibility, false, occludersHit, startTime);
    return output;
  }

  /**
   * 释放资源(本类无 GL 资源,仅为 API 一致性)。
   */
  dispose(): void {
    log.debug('LensFlare disposed');
  }

  // ── 内部方法 ──────────────────────────────────────────────────────────

  /** 绘制单个 flare 元素到 output(additive 合成)。 */
  private _drawFlare(
    output: Uint8ClampedArray,
    width: number,
    height: number,
    cx: number,
    cy: number,
    flare: FlareElement,
    intensity: number,
  ): void {
    const [r, g, b] = flare.color;
    const radius = flare.size;

    if (flare.kind === 'streak') {
      this._drawStreak(output, width, height, cx, cy, flare, intensity);
      return;
    }

    // core/halo/ghost:圆形径向衰减
    const falloff = flare.falloff ?? 2.0;
    // 包围盒(裁剪到屏幕)
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(height - 1, Math.ceil(cy + radius));

    const invR = 1 / radius;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const distSq = dx * dx + dy * dy;
        if (distSq > radius * radius) continue;
        const dist = Math.sqrt(distSq);
        const t = dist * invR; // 0..1
        // 径向衰减:(1 - t)^falloff
        const falloffVal = Math.pow(1 - t, falloff);
        const add = falloffVal * intensity;
        if (add <= 0) continue;
        const idx = (y * width + x) * 4;
        output[idx] = Math.min(255, output[idx] + r * add * 255);
        output[idx + 1] = Math.min(255, output[idx + 1] + g * add * 255);
        output[idx + 2] = Math.min(255, output[idx + 2] + b * add * 255);
        // alpha 不变
      }
    }
  }

  /** 绘制 streak(光芒):沿角度方向的椭圆高斯衰减。 */
  private _drawStreak(
    output: Uint8ClampedArray,
    width: number,
    height: number,
    cx: number,
    cy: number,
    flare: FlareElement,
    intensity: number,
  ): void {
    const [r, g, b] = flare.color;
    const length = flare.size; // 光芒长度(半长轴)
    const thickness = flare.size * 0.08; // 厚度(半短轴)
    const angle = flare.angle ?? 0;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);

    const minX = Math.max(0, Math.floor(cx - length));
    const maxX = Math.min(width - 1, Math.ceil(cx + length));
    const minY = Math.max(0, Math.floor(cy - length));
    const maxY = Math.min(height - 1, Math.ceil(cy + length));

    const invL = 1 / length;
    const invT = 1 / thickness;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        // 旋转到光芒本地坐标系
        const u = dx * cosA + dy * sinA; // 沿光芒方向
        const v = -dx * sinA + dy * cosA; // 垂直光芒方向
        const tu = u * invL;
        const tv = v * invT;
        const d2 = tu * tu + tv * tv;
        if (d2 > 1) continue;
        // 高斯衰减
        const falloffVal = Math.exp(-d2 * 3.0);
        const add = falloffVal * intensity;
        if (add <= 0) continue;
        const idx = (y * width + x) * 4;
        output[idx] = Math.min(255, output[idx] + r * add * 255);
        output[idx + 1] = Math.min(255, output[idx + 1] + g * add * 255);
        output[idx + 2] = Math.min(255, output[idx + 2] + b * add * 255);
      }
    }
  }

  /** 更新统计字段。 */
  private _updateStats(
    drawCalls: number,
    visibleFlares: number,
    screenX: number,
    screenY: number,
    visibility: number,
    behindCamera: boolean,
    occludersHit: number,
    startTime: number,
  ): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.stats.drawCalls = drawCalls;
    this.stats.visibleFlares = visibleFlares;
    this.stats.lastFrameTimeMs = now - startTime;
    this.stats.lightScreenX = screenX;
    this.stats.lightScreenY = screenY;
    this.stats.visibility = visibility;
    this.stats.behindCamera = behindCamera;
    this.stats.occludersHit = occludersHit;
  }
}
