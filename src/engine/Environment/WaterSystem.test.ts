import { describe, it, expect } from 'vitest';
import { WaterSystem } from './WaterSystem';
import { Vector2 } from '../Math';
import { Vector3 } from '../Math';
import { Color } from '../Math';
import { WaterSimulation } from './WaterSimulation';

describe('WaterSystem', () => {
  it('默认状态:无网格,水位 0', () => {
    const ws = new WaterSystem();
    expect(ws.waterMesh).toBeNull();
    expect(ws.waterMaterial).toBeNull();
    expect(ws.waterLevel).toBe(0);
    expect(ws.time).toBe(0);
  });

  it('create 生成水面网格与材质', () => {
    const ws = new WaterSystem();
    ws.create(100, 16);
    expect(ws.waterMesh).not.toBeNull();
    expect(ws.waterMaterial).not.toBeNull();
    expect(ws.waterMesh!.name).toBe('WaterSurface');
  });

  it('create 后网格旋转使法线朝上', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    // 绕 X 轴旋转 -PI/2 → rotation.x ≈ -PI/2
    expect(ws.waterMesh!.rotation.x).toBeCloseTo(-Math.PI / 2, 4);
  });

  it('create 后网格 Y 位置等于水位', () => {
    const ws = new WaterSystem();
    ws.setHeight(5);
    ws.create(10, 4);
    expect(ws.waterMesh!.position.y).toBe(5);
  });

  it('setHeight 修改水位与网格 Y', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    ws.setHeight(7.5);
    expect(ws.waterLevel).toBe(7.5);
    expect(ws.waterMesh!.position.y).toBe(7.5);
  });

  it('setFlow 归一化流向', () => {
    const ws = new WaterSystem();
    ws.setFlow(new Vector2(3, 4));
    expect(ws.flowDirection.length()).toBeCloseTo(1, 5);
    expect(ws.flowDirection.x).toBeCloseTo(0.6, 4);
    expect(ws.flowDirection.y).toBeCloseTo(0.8, 4);
  });

  it('setFlow 零向量回退到默认', () => {
    const ws = new WaterSystem();
    ws.setFlow(new Vector2(0, 0));
    expect(ws.flowDirection.length()).toBeCloseTo(1, 5);
  });

  it('setWaveParams 设置波浪参数', () => {
    const ws = new WaterSystem();
    ws.setWaveParams(0.5, 8);
    expect(ws.waveHeight).toBe(0.5);
    expect(ws.waveLength).toBe(8);
  });

  it('setWaveParams 钳制负值', () => {
    const ws = new WaterSystem();
    ws.setWaveParams(-1, -2);
    expect(ws.waveHeight).toBe(0);
    expect(ws.waveLength).toBeGreaterThan(0);
  });

  it('getMesh 返回水面网格', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    expect(ws.getMesh()).toBe(ws.waterMesh);
  });

  it('isUnderwater 判断点是否在水下', () => {
    const ws = new WaterSystem();
    ws.setHeight(3);
    expect(ws.isUnderwater(new Vector3(0, 2, 0))).toBe(true);
    expect(ws.isUnderwater(new Vector3(0, 3, 0))).toBe(false);
    expect(ws.isUnderwater(new Vector3(0, 4, 0))).toBe(false);
  });

  it('getUnderwaterFog 水下返回参数,水外返回 null', () => {
    const ws = new WaterSystem();
    ws.setHeight(0);
    const underwater = ws.getUnderwaterFog(new Vector3(0, -1, 0));
    expect(underwater).not.toBeNull();
    expect(underwater!.density).toBeGreaterThan(0);
    const above = ws.getUnderwaterFog(new Vector3(0, 1, 0));
    expect(above).toBeNull();
  });

  it('getUnderwaterFog 返回的颜色是克隆', () => {
    const ws = new WaterSystem();
    const f1 = ws.getUnderwaterFog(new Vector3(0, -1, 0))!;
    f1.color.r = 999;
    expect(ws.underwaterFogColor.r).not.toBe(999);
  });

  it('update 推进时间', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    ws.update(0.5);
    expect(ws.time).toBe(0.5);
    ws.update(0.5);
    expect(ws.time).toBe(1.0);
  });

  it('update 推进 WaterMaterial.userData.time', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    ws.update(2);
    expect(ws.waterMaterial!.userData.time).toBe(2);
  });

  it('update 调用附加的 simulation', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    const sim = new WaterSimulation(8);
    ws.attachSimulation(sim);
    sim.addRipple(4, 4, 1);
    const before = sim.heightField[4 * 8 + 4];
    ws.update(2);
    const after = sim.heightField[4 * 8 + 4];
    expect(after).not.toBe(before);
  });

  it('setWaterColor 同步到材质', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    ws.setWaterColor(new Color(0.2, 0.4, 0.6));
    expect(ws.waterMaterial!.waterColor.r).toBeCloseTo(0.2, 4);
    expect(ws.waterMaterial!.waterColor.g).toBeCloseTo(0.4, 4);
    expect(ws.waterMaterial!.waterColor.b).toBeCloseTo(0.6, 4);
  });

  it('setTransparency 钳制到 [0,1] 并同步到材质', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    ws.setTransparency(2);
    expect(ws.transparency).toBe(1);
    expect(ws.waterMaterial!.opacity).toBe(1);
    ws.setTransparency(-1);
    expect(ws.transparency).toBe(0);
    expect(ws.waterMaterial!.opacity).toBe(0);
  });

  it('setUnderwaterFog 设置雾参数', () => {
    const ws = new WaterSystem();
    ws.setUnderwaterFog(new Color(0.1, 0.2, 0.3), 0.15);
    expect(ws.underwaterFogColor.r).toBeCloseTo(0.1, 4);
    expect(ws.underwaterFogDensity).toBe(0.15);
  });

  it('setReflectionTexture 同步到材质', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    ws.setReflectionTexture(null);
    expect(ws.reflectionTexture).toBeNull();
    expect(ws.waterMaterial!.reflectionMap).toBeNull();
  });

  it('attachSimulation(null) 解除关联', () => {
    const ws = new WaterSystem();
    ws.create(10, 4);
    const sim = new WaterSimulation(8);
    ws.attachSimulation(sim);
    expect(ws.simulation).not.toBeNull();
    ws.attachSimulation(null);
    expect(ws.simulation).toBeNull();
  });
});
