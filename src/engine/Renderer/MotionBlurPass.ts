// MotionBlurPass — CPU 侧运动模糊后处理 Pass(基于速度缓冲)。
//
// 设计目标:
//   - 与 PostProcess/MotionBlurPass.ts(GPU 纹理版)互补:本 Pass 在 CPU
//     侧维护 Float32Array 速度缓冲,不依赖 WebGL 上下文,可在无头环境
//     (Node / 测试 / SSR)运行,适合离线渲染 / 截图 / 回放;
//   - 速度缓冲由 updateVelocityBuffer(objects, camera) 生成:对每个物体
//     用当前帧 / 上一帧 view-projection 投影到屏幕,取差值作为像素速度,
//     在物体投影点附近"splat"(涂抹)一定半径,填充速度缓冲;
//   - render(input, velocityBuffer, camera) 沿像素速度方向多次采样并平均,
//     产生方向性运动模糊;可选叠加摄像机运动(用 prev/curr VP 反投影像素
//     NDC 到世界再正投影,得到逐像素相机速度);
//   - 强度 blurStrength 控制原始与模糊结果的线性混合(0=无模糊,1=全模糊)。
//
// 不变量:
//   - 首帧(prevViewProjection === null)无运动模糊,输出 = 输入;
//   - velocityBuffer 长度 = width * height * 2(RG 逐像素,像素单位);
//   - render 不修改输入 data 与传入 velocityBuffer,返回新分配的 Uint8ClampedArray;
//   - updateVelocityBuffer 内部推进 prevViewProjection ← currViewProjection。
//
// 参考:
//   - GPU Pro 3 "Real-Time Camera Motion Blur"
//   - PostProcess/MotionBlurPass.ts(GPU 版,本类为其 CPU 回退)

import { Matrix4 } from '../Math/Matrix4';
import { Vector3 } from '../Math/Vector3';
import type { Object3D } from '../Core/Object3D';
import { createLogger } from '@/lib/logger';

const log = createLogger('MotionBlurPass');

/** 运动模糊统计(上次 render / updateVelocityBuffer 的指标)。 */
export interface MotionBlurStats {
  /** 上次 render 处理的像素数。 */
  pixelsProcessed: number;
  /** 上次 render 总采样数(所有像素采样之和)。 */
  totalSamples: number;
  /** 上次 render 被模糊的像素数(速度超过阈值的像素)。 */
  blurredPixels: number;
  /** 上次 updateVelocityBuffer 处理的物体数。 */
  objectsProcessed: number;
  /** 上次 updateVelocityBuffer 写入的非零速度像素数。 */
  velocityPixelsWritten: number;
  /** 上次 render 相机屏幕速度的最大幅值(像素)。 */
  maxCameraVelocity: number;
}

/** MotionBlurPass 构造选项。 */
export interface MotionBlurOptions {
  enabled?: boolean;
  /** 模糊强度(0..1,默认 0.5)。0=无模糊,1=全模糊。 */
  blurStrength?: number;
  /** 最大速度(像素,默认 40)。超过会被归一化裁剪。 */
  maxVelocity?: number;
  /** 采样数(1..64,默认 16)。 */
  samples?: number;
  /** 是否启用摄像机运动模糊(默认 true)。 */
  cameraMotionEnabled?: boolean;
  /** 是否启用物体运动模糊(默认 true)。 */
  objectMotionEnabled?: boolean;
  /** 速度缓冲宽度(默认 256)。 */
  width?: number;
  /** 速度缓冲高度(默认 256)。 */
  height?: number;
  /** 物体速度 splat 半径(像素,默认 4)。 */
  splatRadius?: number;
  /** 相机运动参考距离(世界单位,默认 10)。相机前方该距离处的参考点用于反投影。 */
  focusDistance?: number;
}

/** render 输入:RGBA 像素数据 + 尺寸。 */
export interface MotionBlurInput {
  /** RGBA 字节流,长度 = width * height * 4。 */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** 相机的结构类型:任何带 position 的对象都可接受(解耦具体 Camera 类)。 */
export interface MotionBlurCamera {
  position: Vector3;
  projectionMatrix: Matrix4;
  matrixWorldInverse: Matrix4;
}

/**
 * CPU 侧运动模糊 Pass。维护 Float32Array 速度缓冲,不依赖 WebGL。
 *
 * 典型每帧用法:
 *   1. motionBlur.updateVelocityBuffer(objects, camera);  // 生成速度缓冲
 *   2. const out = motionBlur.render({ data, width, height }, null, camera);
 */
export class MotionBlurPass {
  readonly name = 'motion-blur';

  enabled: boolean = true;
  blurStrength: number = 0.5;
  maxVelocity: number = 40;
  samples: number = 16;
  cameraMotionEnabled: boolean = true;
  objectMotionEnabled: boolean = true;
  /** 当前速度缓冲(RG 逐像素,像素单位);null 表示未分配。 */
  velocityBuffer: Float32Array | null = null;
  /** 上一帧 view-projection(首帧为 null)。 */
  prevViewProjection: Matrix4 | null = null;

  /** 速度缓冲宽度。 */
  width: number = 256;
  /** 速度缓冲高度。 */
  height: number = 256;
  /** 物体速度 splat 半径(像素)。 */
  splatRadius: number = 4;
  /** 相机运动参考距离(世界单位,相机前方 focusDistance 处的参考点)。 */
  focusDistance: number = 10;

  /** 当前帧 view-projection(updateVelocityBuffer 推进)。 */
  private _currViewProjection: Matrix4 = new Matrix4();
  /** 是否已有上一帧 VP(首帧为 false)。 */
  private _hasPrev: boolean = false;
  /** 各物体上一帧的世界位置(按 object.id 索引),用于计算物体速度。 */
  private _prevPositions: Map<number, Vector3> = new Map();
  private _stats: MotionBlurStats = {
    pixelsProcessed: 0,
    totalSamples: 0,
    blurredPixels: 0,
    objectsProcessed: 0,
    velocityPixelsWritten: 0,
    maxCameraVelocity: 0,
  };

  constructor(opts: MotionBlurOptions = {}) {
    if (opts.enabled !== undefined) this.enabled = opts.enabled;
    if (opts.blurStrength !== undefined) this.blurStrength = opts.blurStrength;
    if (opts.maxVelocity !== undefined) this.maxVelocity = opts.maxVelocity;
    if (opts.samples !== undefined) this.samples = opts.samples;
    if (opts.cameraMotionEnabled !== undefined) this.cameraMotionEnabled = opts.cameraMotionEnabled;
    if (opts.objectMotionEnabled !== undefined) this.objectMotionEnabled = opts.objectMotionEnabled;
    if (opts.width !== undefined) this.width = Math.max(1, Math.floor(opts.width));
    if (opts.height !== undefined) this.height = Math.max(1, Math.floor(opts.height));
    if (opts.splatRadius !== undefined) this.splatRadius = Math.max(0, Math.floor(opts.splatRadius));
    if (opts.focusDistance !== undefined) this.focusDistance = Math.max(0.001, opts.focusDistance);
  }

  // ── setters ────────────────────────────────────────────────────────

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setBlurStrength(strength: number): void {
    this.blurStrength = Math.max(0, Math.min(1, strength));
  }

  setMaxVelocity(max: number): void {
    this.maxVelocity = Math.max(0, max);
  }

  setSamples(samples: number): void {
    this.samples = Math.max(1, Math.min(64, Math.floor(samples)));
  }

  setCameraMotion(enabled: boolean): void {
    this.cameraMotionEnabled = enabled;
  }

  setObjectMotion(enabled: boolean): void {
    this.objectMotionEnabled = enabled;
  }

  /** 设置速度缓冲尺寸(下次 updateVelocityBuffer 重新分配)。 */
  setSize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w !== this.width || h !== this.height) {
      this.width = w;
      this.height = h;
      this.velocityBuffer = null; // 强制下次 update 重新分配
    }
  }

  // ── 速度缓冲 ───────────────────────────────────────────────────────

  /**
   * 更新速度缓冲。对每个物体用当前帧 VP 投影其"当前位置"与"上一帧位置",
   * 取屏幕差值作为纯物体速度(不含相机运动),在投影点附近 splat 到 velocityBuffer。
   * 相机运动由 render() 单独计算,避免重复。
   *
   * 首帧(_hasPrev === false)不计算物体速度,仅记录 currVP 与各物体位置供下帧使用。
   *
   * @returns 当前速度缓冲(也同步赋值给 this.velocityBuffer)
   */
  updateVelocityBuffer(objects: Object3D[], camera: MotionBlurCamera): Float32Array {
    const w = this.width;
    const h = this.height;
    const need = w * h * 2;
    if (!this.velocityBuffer || this.velocityBuffer.length !== need) {
      this.velocityBuffer = new Float32Array(need);
      log.debug(`velocityBuffer allocated: ${w}x${h} (${need} floats)`);
    }
    const vbuf = this.velocityBuffer;
    vbuf.fill(0);

    // 当前帧 VP = projection * view。
    // 注意:VREEN 的 multiplyMatrices(a, b) 计算 b * a(与 three.js 相反),
    // 因此为得到 P * V,参数顺序应为 (V, P)。
    const currVP = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, camera.projectionMatrix);

    let objectsProcessed = 0;
    let pixelsWritten = 0;

    if (!this._hasPrev) {
      // 首帧:记录 currVP + 各物体位置,不计算速度
      this._currViewProjection.copy(currVP);
      this._hasPrev = true;
      this.prevViewProjection = null;
      for (let i = 0; i < objects.length; i++) {
        const o = objects[i];
        this._prevPositions.set(o.id, new Vector3(o.position.x, o.position.y, o.position.z));
      }
    } else {
      // 推进:prev ← curr(上一帧),curr ← 新值
      const prevVP = new Matrix4().copy(this._currViewProjection);
      this._currViewProjection.copy(currVP);
      this.prevViewProjection = prevVP;

      if (this.objectMotionEnabled) {
        const splatR = this.splatRadius;
        for (let i = 0; i < objects.length; i++) {
          const obj = objects[i];
          if (!obj.visible) continue;
          const currPos = obj.position;
          // 上一帧位置(首次见到的物体用当前位置 → 速度 0)
          const prevPos = this._prevPositions.get(obj.id);
          // 用当前帧 VP 投影两个位置 → 纯物体运动(相机运动由 render 计算)
          const cur = projectToNDC(currPos, currVP);
          if (cur === null) continue;
          const prv = prevPos ? projectToNDC(prevPos, currVP) : cur;
          if (prv === null) continue;

          // 像素速度(NDC 差 → 像素,Y 翻转)
          const vx = (cur.x - prv.x) * 0.5 * w;
          const vy = -(cur.y - prv.y) * 0.5 * h;
          // 裁剪到 maxVelocity
          const mag = Math.hypot(vx, vy);
          let sx = vx;
          let sy = vy;
          if (mag > this.maxVelocity && mag > 0) {
            const k = this.maxVelocity / mag;
            sx = vx * k;
            sy = vy * k;
          }

          // splat 到投影点附近
          const px = (cur.x + 1) * 0.5 * w;
          const py = (1 - cur.y) * 0.5 * h;
          const x0 = Math.max(0, Math.floor(px - splatR));
          const x1 = Math.min(w - 1, Math.floor(px + splatR));
          const y0 = Math.max(0, Math.floor(py - splatR));
          const y1 = Math.min(h - 1, Math.floor(py + splatR));
          for (let yy = y0; yy <= y1; yy++) {
            for (let xx = x0; xx <= x1; xx++) {
              const idx = (yy * w + xx) * 2;
              // 取较大幅值(避免被后续 0 覆盖)
              if (Math.hypot(vbuf[idx], vbuf[idx + 1]) < Math.hypot(sx, sy)) {
                vbuf[idx] = sx;
                vbuf[idx + 1] = sy;
                pixelsWritten++;
              }
            }
          }
          objectsProcessed++;
          // 记录当前位置供下帧使用
          this._prevPositions.set(obj.id, new Vector3(currPos.x, currPos.y, currPos.z));
        }
      } else {
        // objectMotion 禁用:仍更新位置记录(避免重新启用时跨帧跳跃)
        for (let i = 0; i < objects.length; i++) {
          const o = objects[i];
          this._prevPositions.set(o.id, new Vector3(o.position.x, o.position.y, o.position.z));
        }
      }
    }

    this._stats.objectsProcessed = objectsProcessed;
    this._stats.velocityPixelsWritten = pixelsWritten;
    return vbuf;
  }

  getVelocityBuffer(): Float32Array | null {
    return this.velocityBuffer;
  }

  // ── render ─────────────────────────────────────────────────────────

  /**
   * 执行运动模糊。
   *
   * @param input          输入像素(RGBA)
   * @param velocityBuffer 速度缓冲(null 时使用 this.velocityBuffer)
   * @param camera         当前相机(用于摄像机运动模糊)
   * @returns              模糊后的 RGBA(新分配)
   */
  render(
    input: MotionBlurInput,
    velocityBuffer: Float32Array | null,
    camera: MotionBlurCamera,
  ): Uint8ClampedArray {
    const { data, width: iw, height: ih } = input;
    const out = new Uint8ClampedArray(data.length);

    if (!this.enabled) {
      out.set(data);
      this._stats.pixelsProcessed = 0;
      this._stats.totalSamples = 0;
      this._stats.blurredPixels = 0;
      this._stats.maxCameraVelocity = 0;
      return out;
    }

    // 同步尺寸
    if (iw !== this.width || ih !== this.height) {
      this.setSize(iw, ih);
    }

    const vbuf = velocityBuffer !== null ? velocityBuffer : this.velocityBuffer;
    const samples = Math.max(1, Math.min(64, Math.floor(this.samples)));
    const maxV = Math.max(0, this.maxVelocity);
    const strength = Math.max(0, Math.min(1, this.blurStrength));

    // 摄像机运动:逐像素反投影。对每个像素,沿相机光线在 focusDistance 处取参考点,
    // 用 prevVP 正投影得到上一帧屏幕位置,差值即相机运动速度。
    let camVelData: Float32Array | null = null;
    let maxCamVel = 0;
    if (this.cameraMotionEnabled && this.prevViewProjection !== null) {
      const currVP = new Matrix4().multiplyMatrices(camera.matrixWorldInverse, camera.projectionMatrix);
      const invCurr = new Matrix4().getInverse(currVP);
      const prevVP = this.prevViewProjection;
      camVelData = new Float32Array(iw * ih * 2);
      const focusDist = this.focusDistance;
      const camPosX = camera.position.x;
      const camPosY = camera.position.y;
      const camPosZ = camera.position.z;
      for (let py = 0; py < ih; py++) {
        for (let px = 0; px < iw; px++) {
          const ndcX = (px / iw) * 2 - 1;
          const ndcY = 1 - (py / ih) * 2;
          // 反投影远点得到相机光线方向(从相机位置出发)
          const farWP = unproject(ndcX, ndcY, 1, invCurr);
          if (farWP === null) continue;
          // 从相机位置沿像素方向行进 focusDist 距离,得到参考世界点
          const dx = farWP.x - camPosX;
          const dy = farWP.y - camPosY;
          const dz = farWP.z - camPosZ;
          const dlen = Math.hypot(dx, dy, dz);
          if (dlen < 1e-6) continue;
          const k = focusDist / dlen;
          const wpX = camPosX + dx * k;
          const wpY = camPosY + dy * k;
          const wpZ = camPosZ + dz * k;
          // 用 prevVP 正投影
          const prevNdc = projectToNDC({ x: wpX, y: wpY, z: wpZ }, prevVP);
          if (prevNdc === null) continue;
          const cvx = (ndcX - prevNdc.x) * 0.5 * iw;
          const cvy = -(ndcY - prevNdc.y) * 0.5 * ih;
          const idx = (py * iw + px) * 2;
          camVelData[idx] = cvx;
          camVelData[idx + 1] = cvy;
          const m = Math.hypot(cvx, cvy);
          if (m > maxCamVel) maxCamVel = m;
        }
      }
    }

    let blurredPixels = 0;
    let totalSamples = 0;
    const halfMaxV = maxV * 0.5 + 1e-6;

    for (let py = 0; py < ih; py++) {
      for (let px = 0; px < iw; px++) {
        const pi = py * iw + px;
        const di = pi * 4;
        // 合并物体速度 + 相机速度
        let vx = 0;
        let vy = 0;
        if (this.objectMotionEnabled && vbuf) {
          const vi = pi * 2;
          vx += vbuf[vi];
          vy += vbuf[vi + 1];
        }
        if (camVelData) {
          const ci = pi * 2;
          vx += camVelData[ci];
          vy += camVelData[ci + 1];
        }
        // 裁剪到 maxVelocity
        const mag = Math.hypot(vx, vy);
        if (mag > maxV && mag > 0) {
          const k = maxV / mag;
          vx *= k;
          vy *= k;
        }

        if (mag < 0.5) {
          // 速度过小,直接拷贝
          out[di] = data[di];
          out[di + 1] = data[di + 1];
          out[di + 2] = data[di + 2];
          out[di + 3] = data[di + 3];
          continue;
        }

        blurredPixels++;
        // 沿速度方向采样
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        // 采样范围 [-0.5*v, +0.5*v]
        for (let s = 0; s < samples; s++) {
          const t = samples === 1 ? 0 : (s / (samples - 1)) - 0.5;
          const sx = px + vx * t;
          const sy = py + vy * t;
          const sxi = Math.max(0, Math.min(iw - 1, Math.round(sx)));
          const syi = Math.max(0, Math.min(ih - 1, Math.round(sy)));
          const sdi = (syi * iw + sxi) * 4;
          r += data[sdi];
          g += data[sdi + 1];
          b += data[sdi + 2];
          a += data[sdi + 3];
          totalSamples++;
        }
        r /= samples;
        g /= samples;
        b /= samples;
        a /= samples;
        // 按强度混合
        out[di] = data[di] * (1 - strength) + r * strength;
        out[di + 1] = data[di + 1] * (1 - strength) + g * strength;
        out[di + 2] = data[di + 2] * (1 - strength) + b * strength;
        out[di + 3] = data[di + 3] * (1 - strength) + a * strength;
        void halfMaxV;
      }
    }

    this._stats.pixelsProcessed = iw * ih;
    this._stats.totalSamples = totalSamples;
    this._stats.blurredPixels = blurredPixels;
    this._stats.maxCameraVelocity = maxCamVel;
    return out;
  }

  getStats(): MotionBlurStats {
    return { ...this._stats };
  }

  /** 重置状态:清空速度缓冲与 prevVP(下次 update 视为首帧)。 */
  dispose(): void {
    this.velocityBuffer = null;
    this.prevViewProjection = null;
    this._hasPrev = false;
    this._currViewProjection.identity();
    this._prevPositions.clear();
    this._stats = {
      pixelsProcessed: 0,
      totalSamples: 0,
      blurredPixels: 0,
      objectsProcessed: 0,
      velocityPixelsWritten: 0,
      maxCameraVelocity: 0,
    };
    log.debug('disposed');
  }
}

// ── helpers ───────────────────────────────────────────────────────────

/** 把世界点用 VP 矩阵投影到 NDC(-1..1);w<=0(在相机后方)返回 null。 */
function projectToNDC(
  pos: { x: number; y: number; z: number },
  vp: Matrix4,
): { x: number; y: number; z: number } | null {
  const e = vp.elements;
  const x = pos.x;
  const y = pos.y;
  const z = pos.z;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (w <= 1e-6) return null;
  const ndcX = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
  const ndcY = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
  const ndcZ = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
  return { x: ndcX, y: ndcY, z: ndcZ };
}

/** 把 NDC(ndcX, ndcY, ndcZ)用 inverse VP 反投影到世界坐标。 */
function unproject(
  ndcX: number,
  ndcY: number,
  ndcZ: number,
  invVP: Matrix4,
): Vector3 | null {
  const e = invVP.elements;
  const x = ndcX;
  const y = ndcY;
  const z = ndcZ;
  const w = e[3] * x + e[7] * y + e[11] * z + e[15];
  if (Math.abs(w) < 1e-6) return null;
  const wx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
  const wy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
  const wz = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
  return new Vector3(wx, wy, wz);
}
