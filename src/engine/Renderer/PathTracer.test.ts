// PathTracer 单元测试。
//
// 覆盖:构造默认值、buffer 大小、reset、setBounces、setSamples、resize、
// dispose、getResult 长度、最小渲染场景(1x1, 1 spp, 1 bounce)不抛错。
// 不创建真实 WebGL 上下文(纯 CPU 模拟)。

import { describe, it, expect } from 'vitest';
import { PathTracer } from './PathTracer';
import { Scene } from '../Core/Scene';
import { Mesh } from '../Core/Mesh';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { DirectionalLight } from '../Lights/DirectionalLight';
import { AmbientLight } from '../Lights/AmbientLight';
import { Color } from '../Math/Color';

describe('PathTracer', () => {
  it('默认构造:maxBounces 8、spp 4、256x256、frameCount 0', () => {
    const pt = new PathTracer();
    expect(pt.maxBounces).toBe(8);
    expect(pt.samplesPerPixel).toBe(4);
    expect(pt.width).toBe(256);
    expect(pt.height).toBe(256);
    expect(pt.frameCount).toBe(0);
    expect(pt.accumulationBuffer.length).toBe(256 * 256 * 3);
  });

  it('选项覆盖生效', () => {
    const pt = new PathTracer({
      maxBounces: 4,
      samplesPerPixel: 2,
      width: 64,
      height: 48,
      shadowBias: 0.001,
      backgroundColor: new Color(0.5, 0.5, 0.5),
    });
    expect(pt.maxBounces).toBe(4);
    expect(pt.samplesPerPixel).toBe(2);
    expect(pt.width).toBe(64);
    expect(pt.height).toBe(48);
    expect(pt.shadowBias).toBeCloseTo(0.001, 6);
    expect(pt.backgroundColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(pt.accumulationBuffer.length).toBe(64 * 48 * 3);
  });

  it('backgroundColor 不跨实例共享', () => {
    const a = new PathTracer({ backgroundColor: new Color(0.1, 0.2, 0.3) });
    const b = new PathTracer({ backgroundColor: new Color(0.1, 0.2, 0.3) });
    a.backgroundColor.r = 0.9;
    expect(b.backgroundColor.r).toBeCloseTo(0.1, 6);
  });

  it('reset 清零 buffer 与 frameCount', () => {
    const pt = new PathTracer({ width: 4, height: 4 });
    // 模拟累积
    pt.accumulationBuffer[0] = 1;
    pt.accumulationBuffer[5] = 2;
    pt.frameCount = 5;
    pt.reset();
    expect(pt.frameCount).toBe(0);
    expect(pt.accumulationBuffer[0]).toBe(0);
    expect(pt.accumulationBuffer[5]).toBe(0);
  });

  it('setBounces 设置并 reset', () => {
    const pt = new PathTracer();
    pt.frameCount = 5;
    pt.setBounces(16);
    expect(pt.maxBounces).toBe(16);
    expect(pt.frameCount).toBe(0);
  });

  it('setBounces clamp 到 [1, 64]', () => {
    const pt = new PathTracer();
    pt.setBounces(0);
    expect(pt.maxBounces).toBe(1);
    pt.setBounces(100);
    expect(pt.maxBounces).toBe(64);
    pt.setBounces(-5);
    expect(pt.maxBounces).toBe(1);
  });

  it('setSamples 设置并 reset', () => {
    const pt = new PathTracer();
    pt.frameCount = 3;
    pt.setSamples(8);
    expect(pt.samplesPerPixel).toBe(8);
    expect(pt.frameCount).toBe(0);
  });

  it('setSamples clamp 到 [1, 256]', () => {
    const pt = new PathTracer();
    pt.setSamples(0);
    expect(pt.samplesPerPixel).toBe(1);
    pt.setSamples(1000);
    expect(pt.samplesPerPixel).toBe(256);
  });

  it('resize 调整 buffer 大小并 reset frameCount', () => {
    const pt = new PathTracer({ width: 16, height: 16 });
    pt.frameCount = 3;
    pt.resize(32, 24);
    expect(pt.width).toBe(32);
    expect(pt.height).toBe(24);
    expect(pt.accumulationBuffer.length).toBe(32 * 24 * 3);
    expect(pt.frameCount).toBe(0);
  });

  it('resize 至少 1x1', () => {
    const pt = new PathTracer();
    pt.resize(0, -5);
    expect(pt.width).toBe(1);
    expect(pt.height).toBe(1);
  });

  it('dispose 释放资源', () => {
    const pt = new PathTracer({ width: 16, height: 16 });
    pt.dispose();
    expect(pt.width).toBe(0);
    expect(pt.height).toBe(0);
    expect(pt.frameCount).toBe(0);
    expect(pt.accumulationBuffer.length).toBe(0);
  });

  it('getResult 返回 Uint8ClampedArray,长度 width*height*4', () => {
    const pt = new PathTracer({ width: 4, height: 3 });
    const out = pt.getResult();
    expect(out).toBeInstanceOf(Uint8ClampedArray);
    expect(out.length).toBe(4 * 3 * 4);
  });

  it('getResult frameCount=0 时返回全黑(除 alpha)', () => {
    const pt = new PathTracer({ width: 2, height: 2 });
    const out = pt.getResult();
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(0);
      expect(out[i + 1]).toBe(0);
      expect(out[i + 2]).toBe(0);
      expect(out[i + 3]).toBe(255);
    }
  });

  it('render 最小场景不抛错(1x1, 1 spp, 1 bounce)', () => {
    const pt = new PathTracer({
      width: 1,
      height: 1,
      samplesPerPixel: 1,
      maxBounces: 1,
    });
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    mesh.position.set(0, 0, -3);
    scene.add(mesh);

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -3);
    camera.updateWorldMatrix(true, false);

    expect(() => pt.render(scene, camera)).not.toThrow();
    expect(pt.frameCount).toBe(1);
  });

  it('render 累积 frameCount', () => {
    const pt = new PathTracer({
      width: 1,
      height: 1,
      samplesPerPixel: 1,
      maxBounces: 1,
    });
    const scene = new Scene();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    mesh.position.set(0, 0, -3);
    scene.add(mesh);
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -3);
    camera.updateWorldMatrix(true, false);

    pt.render(scene, camera);
    pt.render(scene, camera);
    pt.render(scene, camera);
    expect(pt.frameCount).toBe(3);
  });

  it('render 命中 mesh 后 getResult 非零(有光照)', () => {
    const pt = new PathTracer({
      width: 4,
      height: 4,
      samplesPerPixel: 1,
      maxBounces: 1,
    });
    const scene = new Scene();
    const mesh = new Mesh(
      new BoxGeometry(2, 2, 2),
      new StandardMaterial(),
    );
    // 标准材质:白色 baseColor
    (mesh.material as StandardMaterial).baseColor = { r: 1, g: 1, b: 1 };
    mesh.position.set(0, 0, -3);
    scene.add(mesh);
    // 方向光从右上前方照射(强度 1)
    const dir = new DirectionalLight(0xffffff, 1, { x: -0.5, y: -1, z: 0.5 });
    scene.add(dir);
    // 环境光抬升暗部
    scene.add(new AmbientLight(0xffffff, 0.3));

    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -3);
    camera.updateWorldMatrix(true, false);

    pt.render(scene, camera);
    const out = pt.getResult();
    // 至少有一个像素非零(命中 mesh + 有光照)
    let nonZero = false;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i] > 0 || out[i + 1] > 0 || out[i + 2] > 0) {
        nonZero = true;
        break;
      }
    }
    expect(nonZero).toBe(true);
  });

  it('render 空场景命中背景色', () => {
    const bgColor = new Color(0.2, 0.4, 0.6);
    const pt = new PathTracer({
      width: 1,
      height: 1,
      samplesPerPixel: 1,
      maxBounces: 1,
      backgroundColor: bgColor,
    });
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateWorldMatrix(true, false);

    pt.render(scene, camera);
    const out = pt.getResult();
    // 背景色经 sRGB 转换后应非零
    expect(out[0]).toBeGreaterThan(0);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[2]).toBeGreaterThan(0);
  });

  it('accumulate 是 render 的别名', () => {
    const pt = new PathTracer({
      width: 1,
      height: 1,
      samplesPerPixel: 1,
      maxBounces: 1,
    });
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateWorldMatrix(true, false);

    pt.accumulate(scene, camera);
    expect(pt.frameCount).toBe(1);
  });

  it('render 后 reset 使 getResult 全黑', () => {
    const pt = new PathTracer({
      width: 2,
      height: 2,
      samplesPerPixel: 1,
      maxBounces: 1,
      backgroundColor: new Color(1, 1, 1),
    });
    const scene = new Scene();
    const camera = new PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 0);
    camera.lookAt(0, 0, -1);
    camera.updateWorldMatrix(true, false);

    pt.render(scene, camera);
    pt.reset();
    const out = pt.getResult();
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(0);
      expect(out[i + 1]).toBe(0);
      expect(out[i + 2]).toBe(0);
      expect(out[i + 3]).toBe(255);
    }
  });
});
