// DirectionalLight 单元测试：构造、默认值、继承关系、阴影配置。

import { describe, it, expect } from 'vitest';
import { DirectionalLight } from './DirectionalLight';
import { DirectionalLightShadow } from './DirectionalLightShadow';
import { Light } from './Light';
import { Object3D } from '../Core/Object3D';

describe('DirectionalLight', () => {
  it('默认构造：白光、强度 1、方向 (0,-1,0)', () => {
    const d = new DirectionalLight();
    expect(d.color).toEqual({ r: 1, g: 1, b: 1 });
    expect(d.intensity).toBe(1);
    expect(d.direction).toEqual({ x: 0, y: -1, z: 0 });
    expect(d.type).toBe('DirectionalLight');
    expect(d.isDirectionalLight).toBe(true);
    expect(d.isLight).toBe(true);
    expect(d.castShadow).toBe(false);
  });

  it('接受 (color, intensity, direction) 构造签名（与现有调用方一致）', () => {
    const d = new DirectionalLight(0xfff2d9, 1.0, { x: 4, y: 8, z: 5 });
    expect(d.color.r).toBeCloseTo(1, 4);
    expect(d.color.g).toBeCloseTo(0xf2 / 255, 4);
    expect(d.color.b).toBeCloseTo(0xd9 / 255, 4);
    expect(d.intensity).toBe(1.0);
    expect(d.direction).toEqual({ x: 4, y: 8, z: 5 });
  });

  it('拥有 target: Object3D（three.js 兼容）', () => {
    const d = new DirectionalLight();
    expect(d.target).toBeInstanceOf(Object3D);
    // target 默认位于原点
    expect(d.target.position.toArray()).toEqual([0, 0, 0]);
  });

  it('继承自 Light 与 Object3D', () => {
    const d = new DirectionalLight();
    expect(d).toBeInstanceOf(Light);
    expect(d).toBeInstanceOf(Object3D);
  });

  it('shadow 为 DirectionalLightShadow 实例且默认值匹配 WebGL2Renderer 预期', () => {
    const d = new DirectionalLight();
    expect(d.shadow).toBeInstanceOf(DirectionalLightShadow);
    expect(d.shadow.mapSize).toBe(1024);
    expect(d.shadow.cameraHalfSize).toBe(4);
    expect(d.shadow.cameraNear).toBeCloseTo(0.1, 5);
    expect(d.shadow.cameraFar).toBe(50);
    expect(d.shadow.bias).toBeCloseTo(0.001, 5);
  });

  it('castShadow 可独立开启，不影响 shadow 参数', () => {
    const d = new DirectionalLight();
    d.castShadow = true;
    expect(d.castShadow).toBe(true);
    expect(d.shadow.mapSize).toBe(1024);
  });

  it('shadow 参数可调整并被渲染管线读取', () => {
    const d = new DirectionalLight();
    d.shadow.mapSize = 2048;
    d.shadow.cameraHalfSize = 10;
    d.shadow.cameraNear = 1;
    d.shadow.cameraFar = 100;
    d.shadow.bias = 0.0005;
    expect(d.shadow.mapSize).toBe(2048);
    expect(d.shadow.cameraHalfSize).toBe(10);
    expect(d.shadow.cameraNear).toBe(1);
    expect(d.shadow.cameraFar).toBe(100);
    expect(d.shadow.bias).toBeCloseTo(0.0005, 6);
  });
});

describe('DirectionalLightShadow', () => {
  it('clone 产生参数相同但独立的新实例', () => {
    const s = new DirectionalLightShadow();
    s.mapSize = 512;
    s.cameraHalfSize = 8;
    const c = s.clone();
    expect(c).not.toBe(s);
    expect(c.mapSize).toBe(512);
    expect(c.cameraHalfSize).toBe(8);
    // 修改副本不影响原件
    c.mapSize = 1024;
    expect(s.mapSize).toBe(512);
  });

  it('toJSON 包含全部阴影相机参数', () => {
    const s = new DirectionalLightShadow();
    const json = s.toJSON();
    expect(json.mapSize).toBe(1024);
    expect(json.cameraHalfSize).toBe(4);
    expect(json.cameraNear).toBeCloseTo(0.1, 5);
    expect(json.cameraFar).toBe(50);
    expect(json.bias).toBeCloseTo(0.001, 5);
  });
});
