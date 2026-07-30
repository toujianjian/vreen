// MotionBlurPass (CPU 侧) 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项覆盖
//   2. setters(setEnabled / setBlurStrength / setMaxVelocity / setSamples /
//      setCameraMotion / setObjectMotion / setSize)
//   3. updateVelocityBuffer:首帧零速度、缓冲分配、第二帧产生速度
//   4. render:disabled 返回副本、无速度返回副本、有速度产生模糊
//   5. getStats / dispose

import { describe, it, expect } from 'vitest';
import { MotionBlurPass } from './MotionBlurPass';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Object3D } from '../Core/Object3D';
import type { MotionBlurCamera } from './MotionBlurPass';

/** 构造一个可用的相机:position / lookAt / 更新矩阵 + matrixWorldInverse。 */
function makeCamera(px: number, py: number, pz: number): PerspectiveCamera {
  const cam = new PerspectiveCamera(50, 1, 0.1, 1000);
  cam.position.set(px, py, pz);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  cam.matrixWorldInverse.getInverse(cam.matrixWorld);
  return cam;
}

/** 生成一张测试图:中心一个白点,其余黑色。 */
function makeDotImage(w: number, h: number): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  for (let y = -2; y <= 2; y++) {
    for (let x = -2; x <= 2; x++) {
      const i = ((cy + y) * w + (cx + x)) * 4;
      d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255;
    }
  }
  return d;
}

// ── 构造 ────────────────────────────────────────────────────────────

describe('MotionBlurPass construction', () => {
  it('defaults', () => {
    const p = new MotionBlurPass();
    expect(p.name).toBe('motion-blur');
    expect(p.enabled).toBe(true);
    expect(p.blurStrength).toBe(0.5);
    expect(p.maxVelocity).toBe(40);
    expect(p.samples).toBe(16);
    expect(p.cameraMotionEnabled).toBe(true);
    expect(p.objectMotionEnabled).toBe(true);
    expect(p.velocityBuffer).toBeNull();
    expect(p.prevViewProjection).toBeNull();
    expect(p.width).toBe(256);
    expect(p.height).toBe(256);
  });

  it('accepts options', () => {
    const p = new MotionBlurPass({
      enabled: false,
      blurStrength: 0.8,
      maxVelocity: 20,
      samples: 8,
      cameraMotionEnabled: false,
      objectMotionEnabled: false,
      width: 64,
      height: 48,
      splatRadius: 2,
      focusDistance: 5,
    });
    expect(p.enabled).toBe(false);
    expect(p.blurStrength).toBe(0.8);
    expect(p.maxVelocity).toBe(20);
    expect(p.samples).toBe(8);
    expect(p.cameraMotionEnabled).toBe(false);
    expect(p.objectMotionEnabled).toBe(false);
    expect(p.width).toBe(64);
    expect(p.height).toBe(48);
    expect(p.splatRadius).toBe(2);
    expect(p.focusDistance).toBe(5);
  });
});

// ── setters ────────────────────────────────────────────────────────

describe('MotionBlurPass setters', () => {
  it('setEnabled toggles', () => {
    const p = new MotionBlurPass();
    p.setEnabled(false);
    expect(p.enabled).toBe(false);
    p.setEnabled(true);
    expect(p.enabled).toBe(true);
  });

  it('setBlurStrength clamps to [0,1]', () => {
    const p = new MotionBlurPass();
    p.setBlurStrength(2.0);
    expect(p.blurStrength).toBe(1);
    p.setBlurStrength(-1.0);
    expect(p.blurStrength).toBe(0);
    p.setBlurStrength(0.3);
    expect(p.blurStrength).toBe(0.3);
  });

  it('setMaxVelocity clamps to >=0', () => {
    const p = new MotionBlurPass();
    p.setMaxVelocity(-5);
    expect(p.maxVelocity).toBe(0);
    p.setMaxVelocity(100);
    expect(p.maxVelocity).toBe(100);
  });

  it('setSamples clamps to [1,64] and floors', () => {
    const p = new MotionBlurPass();
    p.setSamples(0);
    expect(p.samples).toBe(1);
    p.setSamples(100);
    expect(p.samples).toBe(64);
    p.setSamples(12.7);
    expect(p.samples).toBe(12);
  });

  it('setCameraMotion / setObjectMotion', () => {
    const p = new MotionBlurPass();
    p.setCameraMotion(false);
    expect(p.cameraMotionEnabled).toBe(false);
    p.setObjectMotion(false);
    expect(p.objectMotionEnabled).toBe(false);
  });

  it('setSize updates dimensions and nulls velocityBuffer', () => {
    const p = new MotionBlurPass({ width: 32, height: 32 });
    p.velocityBuffer = new Float32Array(32 * 32 * 2);
    p.setSize(64, 48);
    expect(p.width).toBe(64);
    expect(p.height).toBe(48);
    expect(p.velocityBuffer).toBeNull();
  });

  it('setSize with same dimensions is no-op', () => {
    const p = new MotionBlurPass({ width: 32, height: 32 });
    const buf = new Float32Array(32 * 32 * 2);
    p.velocityBuffer = buf;
    p.setSize(32, 32);
    expect(p.velocityBuffer).toBe(buf);
  });
});

// ── updateVelocityBuffer ───────────────────────────────────────────

describe('MotionBlurPass updateVelocityBuffer', () => {
  it('first frame: allocates buffer, prevViewProjection stays null, zero velocity', () => {
    const p = new MotionBlurPass({ width: 16, height: 16 });
    const cam = makeCamera(0, 0, 10);
    const obj = new Object3D();
    const buf = p.updateVelocityBuffer([obj], cam);
    expect(buf).toBe(p.velocityBuffer);
    expect(buf.length).toBe(16 * 16 * 2);
    expect(p.prevViewProjection).toBeNull();
    // 全零
    let nonZero = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) nonZero++;
    expect(nonZero).toBe(0);
  });

  it('second frame: prevViewProjection set, moving object writes velocity', () => {
    const p = new MotionBlurPass({ width: 32, height: 32, splatRadius: 2 });
    const cam = makeCamera(0, 0, 10);
    const obj = new Object3D();
    // 首帧
    p.updateVelocityBuffer([obj], cam);
    // 移动物体
    obj.position.set(1, 0, 0);
    const buf = p.updateVelocityBuffer([obj], cam);
    expect(p.prevViewProjection).not.toBeNull();
    // 应有非零速度像素
    let nonZero = 0;
    for (let i = 0; i < buf.length; i += 2) {
      if (buf[i] !== 0 || buf[i + 1] !== 0) nonZero++;
    }
    expect(nonZero).toBeGreaterThan(0);
    const stats = p.getStats();
    expect(stats.objectsProcessed).toBe(1);
    expect(stats.velocityPixelsWritten).toBeGreaterThan(0);
  });

  it('objectMotionEnabled=false: no velocity written even on second frame', () => {
    const p = new MotionBlurPass({ width: 16, height: 16, objectMotionEnabled: false });
    const cam = makeCamera(0, 0, 10);
    const obj = new Object3D();
    p.updateVelocityBuffer([obj], cam);
    obj.position.set(2, 0, 0);
    const buf = p.updateVelocityBuffer([obj], cam);
    let nonZero = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) nonZero++;
    expect(nonZero).toBe(0);
  });

  it('invisible objects are skipped', () => {
    const p = new MotionBlurPass({ width: 16, height: 16 });
    const cam = makeCamera(0, 0, 10);
    const obj = new Object3D();
    obj.visible = false;
    p.updateVelocityBuffer([obj], cam);
    obj.position.set(1, 0, 0);
    const buf = p.updateVelocityBuffer([obj], cam);
    let nonZero = 0;
    for (let i = 0; i < buf.length; i++) if (buf[i] !== 0) nonZero++;
    expect(nonZero).toBe(0);
  });

  it('velocity clamped to maxVelocity', () => {
    const p = new MotionBlurPass({ width: 32, height: 32, splatRadius: 1, maxVelocity: 5 });
    const cam = makeCamera(0, 0, 10);
    const obj = new Object3D();
    p.updateVelocityBuffer([obj], cam);
    // 大幅移动产生超大速度
    obj.position.set(100, 0, 0);
    const buf = p.updateVelocityBuffer([obj], cam);
    let maxMag = 0;
    for (let i = 0; i < buf.length; i += 2) {
      const m = Math.hypot(buf[i], buf[i + 1]);
      if (m > maxMag) maxMag = m;
    }
    expect(maxMag).toBeLessThanOrEqual(5 + 1e-6);
  });

  it('getVelocityBuffer returns current buffer', () => {
    const p = new MotionBlurPass({ width: 8, height: 8 });
    expect(p.getVelocityBuffer()).toBeNull();
    const cam = makeCamera(0, 0, 10);
    p.updateVelocityBuffer([], cam);
    expect(p.getVelocityBuffer()).not.toBeNull();
    expect(p.getVelocityBuffer()!.length).toBe(8 * 8 * 2);
  });
});

// ── render ─────────────────────────────────────────────────────────

describe('MotionBlurPass render', () => {
  it('disabled returns a copy of input', () => {
    const p = new MotionBlurPass({ width: 8, height: 8, enabled: false });
    const cam = makeCamera(0, 0, 10);
    const data = makeDotImage(8, 8);
    const out = p.render({ data, width: 8, height: 8 }, null, cam);
    expect(out.length).toBe(data.length);
    expect(out).not.toBe(data);
    for (let i = 0; i < data.length; i++) expect(out[i]).toBe(data[i]);
  });

  it('enabled with no velocity buffer returns a copy (no blur)', () => {
    const p = new MotionBlurPass({
      width: 8, height: 8,
      cameraMotionEnabled: false, objectMotionEnabled: false,
    });
    const cam = makeCamera(0, 0, 10);
    const data = makeDotImage(8, 8);
    const out = p.render({ data, width: 8, height: 8 }, null, cam);
    for (let i = 0; i < data.length; i++) expect(out[i]).toBe(data[i]);
  });

  it('blurStrength=0 returns a copy', () => {
    const p = new MotionBlurPass({ width: 8, height: 8, blurStrength: 0 });
    const cam = makeCamera(0, 0, 10);
    // 手工构造速度缓冲
    const vbuf = new Float32Array(8 * 8 * 2);
    vbuf[0] = 5; vbuf[1] = 0;
    const data = makeDotImage(8, 8);
    const out = p.render({ data, width: 8, height: 8 }, vbuf, cam);
    for (let i = 0; i < data.length; i++) expect(out[i]).toBe(data[i]);
  });

  it('with velocity and strength=1 produces different output', () => {
    const p = new MotionBlurPass({
      width: 16, height: 16,
      blurStrength: 1, samples: 8, maxVelocity: 10,
      cameraMotionEnabled: false, objectMotionEnabled: true,
    });
    const cam = makeCamera(0, 0, 10);
    const data = makeDotImage(16, 16);
    // 中心像素有速度
    const vbuf = new Float32Array(16 * 16 * 2);
    const center = 8 * 16 + 8;
    vbuf[center * 2] = 6;
    vbuf[center * 2 + 1] = 0;
    const out = p.render({ data, width: 16, height: 16 }, vbuf, cam);
    // 输出应与输入不同(中心区域被涂抹)
    let diff = 0;
    for (let i = 0; i < data.length; i++) {
      if (out[i] !== data[i]) diff++;
    }
    expect(diff).toBeGreaterThan(0);
    const stats = p.getStats();
    expect(stats.pixelsProcessed).toBe(16 * 16);
    expect(stats.blurredPixels).toBeGreaterThan(0);
    expect(stats.totalSamples).toBeGreaterThan(0);
  });

  it('does not modify input data or velocityBuffer', () => {
    const p = new MotionBlurPass({
      width: 8, height: 8, blurStrength: 1, samples: 4, maxVelocity: 8,
      cameraMotionEnabled: false,
    });
    const cam = makeCamera(0, 0, 10);
    const data = makeDotImage(8, 8);
    const dataCopy = new Uint8ClampedArray(data);
    const vbuf = new Float32Array(8 * 8 * 2);
    vbuf[0] = 4; vbuf[1] = 0;
    const vbufCopy = new Float32Array(vbuf);
    p.render({ data, width: 8, height: 8 }, vbuf, cam);
    for (let i = 0; i < data.length; i++) expect(data[i]).toBe(dataCopy[i]);
    for (let i = 0; i < vbuf.length; i++) expect(vbuf[i]).toBe(vbufCopy[i]);
  });

  it('syncs size from input', () => {
    const p = new MotionBlurPass({ width: 16, height: 16 });
    const cam = makeCamera(0, 0, 10);
    const data = new Uint8ClampedArray(12 * 12 * 4);
    p.render({ data, width: 12, height: 12 }, null, cam);
    expect(p.width).toBe(12);
    expect(p.height).toBe(12);
  });

  it('camera motion: moving camera produces blur', () => {
    const p = new MotionBlurPass({
      width: 16, height: 16, blurStrength: 1, samples: 8,
      cameraMotionEnabled: true, objectMotionEnabled: false,
      focusDistance: 5,
    });
    const cam1 = makeCamera(0, 0, 10);
    // 首帧建立 currVP
    p.updateVelocityBuffer([], cam1);
    // 第二帧:相机移动 → prevViewProjection 被设置为 cam1 的 VP
    const cam2 = makeCamera(2, 0, 10);
    p.updateVelocityBuffer([], cam2);
    // render 用 cam2 计算 currVP,与 prevViewProjection(cam1) 比较 → 相机运动
    const data = makeDotImage(16, 16);
    const out = p.render({ data, width: 16, height: 16 }, null, cam2);
    let diff = 0;
    for (let i = 0; i < data.length; i++) if (out[i] !== data[i]) diff++;
    expect(diff).toBeGreaterThan(0);
    expect(p.getStats().maxCameraVelocity).toBeGreaterThan(0);
  });
});

// ── dispose / getStats ─────────────────────────────────────────────

describe('MotionBlurPass dispose & stats', () => {
  it('dispose resets state', () => {
    const p = new MotionBlurPass({ width: 8, height: 8 });
    const cam = makeCamera(0, 0, 10);
    const obj = new Object3D();
    // 首帧:prevViewProjection 仍为 null
    p.updateVelocityBuffer([obj], cam);
    // 第二帧:prevViewProjection 被设置
    p.updateVelocityBuffer([obj], cam);
    expect(p.velocityBuffer).not.toBeNull();
    expect(p.prevViewProjection).not.toBeNull();
    p.dispose();
    expect(p.velocityBuffer).toBeNull();
    expect(p.prevViewProjection).toBeNull();
    const stats = p.getStats();
    expect(stats.pixelsProcessed).toBe(0);
    expect(stats.objectsProcessed).toBe(0);
  });

  it('dispose is idempotent', () => {
    const p = new MotionBlurPass();
    p.dispose();
    p.dispose();
    expect(p.velocityBuffer).toBeNull();
  });

  it('getStats returns a copy', () => {
    const p = new MotionBlurPass({ width: 8, height: 8 });
    const s1 = p.getStats();
    s1.pixelsProcessed = 999;
    const s2 = p.getStats();
    expect(s2.pixelsProcessed).toBe(0);
  });

  it('render after dispose works (re-initializes on next updateVelocityBuffer)', () => {
    const p = new MotionBlurPass({ width: 8, height: 8 });
    const cam = makeCamera(0, 0, 10);
    p.updateVelocityBuffer([], cam);
    p.dispose();
    // 重新建立
    p.updateVelocityBuffer([], cam);
    expect(p.velocityBuffer).not.toBeNull();
  });
});

// ── MotionBlurCamera structural typing ─────────────────────────────

describe('MotionBlurPass structural camera', () => {
  it('accepts any object with position + projectionMatrix + matrixWorldInverse', () => {
    const p = new MotionBlurPass({ width: 8, height: 8 });
    const cam = makeCamera(0, 0, 10);
    // 用结构类型传入(PerspectiveCamera 满足 MotionBlurCamera)
    const structural: MotionBlurCamera = {
      position: cam.position,
      projectionMatrix: cam.projectionMatrix,
      matrixWorldInverse: cam.matrixWorldInverse,
    };
    expect(() => p.updateVelocityBuffer([], structural)).not.toThrow();
    const data = new Uint8ClampedArray(8 * 8 * 4);
    expect(() => p.render({ data, width: 8, height: 8 }, null, structural)).not.toThrow();
  });
});
