import { describe, it, expect, beforeEach } from 'vitest';
import { Buoyancy } from './Buoyancy';
import type { BuoyantBody } from './Buoyancy';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 构造一个标准测试浮体。 */
function makeBody(id: string, overrides: Partial<BuoyantBody> = {}): BuoyantBody {
  const mass = overrides.mass ?? 10;
  const volume = overrides.volume ?? 1;
  return {
    id,
    mass,
    volume,
    centerOfMass: overrides.centerOfMass ?? new Vector3(0, 0, 0),
    density: mass / volume,
    position: overrides.position ?? new Vector3(0, -2, 0),
    velocity: overrides.velocity ?? new Vector3(0, 0, 0),
    angularVelocity: overrides.angularVelocity ?? new Vector3(0, 0, 0),
    rotation: overrides.rotation ?? new Quaternion(),
    halfExtents: overrides.halfExtents ?? new Vector3(1, 1, 1),
    submergedVolume: 0,
    buoyancyForce: new Vector3(),
  };
}

describe('Buoyancy', () => {
  describe('构造与默认值', () => {
    it('默认参数正确', () => {
      const b = new Buoyancy();
      expect(b.fluidDensity).toBe(1000);
      expect(b.fluidLevel).toBe(0);
      expect(b.gravity).toEqual(new Vector3(0, -9.81, 0));
      expect(b.linearDrag).toBe(0.5);
      expect(b.angularDrag).toBe(0.5);
      expect(b.voxelCount).toBe(256);
      expect(b.voxelSize).toBe(0.1);
      expect(b.stabilityCoefficient).toBe(1.0);
    });

    it('应用构造选项', () => {
      const b = new Buoyancy({
        fluidDensity: 800,
        fluidLevel: 5,
        gravity: new Vector3(0, -5, 0),
        linearDrag: 1.5,
        angularDrag: 0.8,
        voxelCount: 64,
        voxelSize: 0.2,
        stabilityCoefficient: 2.0,
      });
      expect(b.fluidDensity).toBe(800);
      expect(b.fluidLevel).toBe(5);
      expect(b.gravity.y).toBe(-5);
      expect(b.linearDrag).toBe(1.5);
      expect(b.angularDrag).toBe(0.8);
      expect(b.voxelCount).toBe(64);
      expect(b.voxelSize).toBe(0.2);
      expect(b.stabilityCoefficient).toBe(2.0);
    });

    it('参数钳制到非负', () => {
      const b = new Buoyancy({
        fluidDensity: -1,
        linearDrag: -1,
        angularDrag: -1,
        voxelCount: 0,
        voxelSize: -1,
        stabilityCoefficient: -1,
      });
      expect(b.fluidDensity).toBe(0);
      expect(b.linearDrag).toBe(0);
      expect(b.angularDrag).toBe(0);
      expect(b.voxelCount).toBeGreaterThanOrEqual(1);
      expect(b.voxelSize).toBeGreaterThan(0);
      expect(b.stabilityCoefficient).toBe(0);
    });
  });

  describe('registerBody / unregisterBody / getBody', () => {
    it('注册并获取浮体', () => {
      const b = new Buoyancy();
      const body = makeBody('boat');
      b.registerBody('boat', body);
      expect(b.getBodyCount()).toBe(1);
      expect(b.getBody('boat')).toBe(body);
    });

    it('重复注册覆盖', () => {
      const b = new Buoyancy();
      const body1 = makeBody('boat');
      const body2 = makeBody('boat', { mass: 20 });
      b.registerBody('boat', body1);
      b.registerBody('boat', body2);
      expect(b.getBodyCount()).toBe(1);
      expect(b.getBody('boat')?.mass).toBe(20);
    });

    it('注销浮体', () => {
      const b = new Buoyancy();
      b.registerBody('boat', makeBody('boat'));
      b.unregisterBody('boat');
      expect(b.getBodyCount()).toBe(0);
      expect(b.getBody('boat')).toBeUndefined();
    });

    it('getBodies 返回新数组', () => {
      const b = new Buoyancy();
      b.registerBody('a', makeBody('a'));
      b.registerBody('b', makeBody('b'));
      const arr1 = b.getBodies();
      const arr2 = b.getBodies();
      expect(arr1.length).toBe(2);
      expect(arr1).not.toBe(arr2);
    });

    it('getBody 不存在返回 undefined', () => {
      const b = new Buoyancy();
      expect(b.getBody('nope')).toBeUndefined();
    });
  });

  describe('voxelize', () => {
    it('返回 voxelCount 个采样点 (上限)', () => {
      const b = new Buoyancy({ voxelCount: 27 });
      const body = makeBody('test');
      const voxels = b.voxelize(body);
      expect(voxels.length).toBeLessThanOrEqual(27);
      expect(voxels.length).toBeGreaterThan(0);
    });

    it('采样点位于 halfExtents 范围内', () => {
      const b = new Buoyancy({ voxelCount: 64 });
      const body = makeBody('test', { halfExtents: new Vector3(2, 3, 4) });
      const voxels = b.voxelize(body);
      for (const v of voxels) {
        expect(Math.abs(v.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(v.y)).toBeLessThanOrEqual(3);
        expect(Math.abs(v.z)).toBeLessThanOrEqual(4);
      }
    });

    it('setVoxelCount 重新体素化所有已注册浮体', () => {
      const b = new Buoyancy({ voxelCount: 8 });
      b.registerBody('boat', makeBody('boat'));
      b.setVoxelCount(125);
      expect(b.voxelCount).toBe(125);
      // 重新体素化 (验证 update 时能正常计算淹没体积)
      b.update(0.01);
      expect(b.getBody('boat')!.submergedVolume).toBeGreaterThan(0);
    });
  });

  describe('computeSubmergedVolume', () => {
    it('完全淹没返回 volume', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      const body = makeBody('test', { position: new Vector3(0, -10, 0) });
      b.registerBody('test', body);
      const v = b.computeSubmergedVolume(body, 0);
      expect(v).toBeCloseTo(body.volume, 2);
    });

    it('完全出水返回 0', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      const body = makeBody('test', { position: new Vector3(0, 10, 0) });
      b.registerBody('test', body);
      const v = b.computeSubmergedVolume(body, 0);
      expect(v).toBeCloseTo(0, 6);
    });

    it('半淹没返回约 volume/2', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      // 质心在液面, halfExtents.y=1 → 上下一半淹没
      const body = makeBody('test', { position: new Vector3(0, 0, 0) });
      b.registerBody('test', body);
      const v = b.computeSubmergedVolume(body, 0);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(body.volume);
      // 大致接近一半 (允许体素离散误差)
      expect(v).toBeCloseTo(body.volume * 0.5, 1);
    });

    it('零体积返回 0', () => {
      const b = new Buoyancy();
      const body = makeBody('test', { volume: 0 });
      b.registerBody('test', body);
      expect(b.computeSubmergedVolume(body, 0)).toBe(0);
    });

    it('旋转后淹没体积正确变化', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      // 长条形 box: halfExtents (3, 0.2, 0.2)
      // 水平放置 (无旋转), position y=0, 大部分高于水面
      const body = makeBody('test', {
        position: new Vector3(0, 0.5, 0),
        halfExtents: new Vector3(3, 0.2, 0.2),
      });
      b.registerBody('test', body);
      const vFlat = b.computeSubmergedVolume(body, 0);
      // 旋转 90 度绕 x 轴: 让长边垂直
      body.rotation.setFromEuler(0, 0, Math.PI / 2);
      // 现在沿 y 方向延伸 ±3, 大部分淹没
      const vRotated = b.computeSubmergedVolume(body, 0);
      expect(vRotated).toBeGreaterThan(vFlat);
    });
  });

  describe('computeBuoyancy', () => {
    it('浮力方向与重力相反 (向上)', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      const body = makeBody('test', { position: new Vector3(0, -10, 0) });
      b.registerBody('test', body);
      const f = b.computeBuoyancy(body, 0);
      expect(f.y).toBeGreaterThan(0);
      expect(f.x).toBeCloseTo(0, 6);
      expect(f.z).toBeCloseTo(0, 6);
    });

    it('浮力大小 = ρ * V_sub * |g|', () => {
      const b = new Buoyancy({ fluidLevel: 0, fluidDensity: 1000, voxelCount: 512 });
      const body = makeBody('test', { position: new Vector3(0, -10, 0), volume: 2 });
      b.registerBody('test', body);
      const f = b.computeBuoyancy(body, 0);
      // 完全淹没 → V_sub ≈ 2
      expect(f.y).toBeCloseTo(1000 * 2 * 9.81, 1);
    });

    it('出水物体浮力为 0', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      const body = makeBody('test', { position: new Vector3(0, 10, 0) });
      b.registerBody('test', body);
      const f = b.computeBuoyancy(body, 0);
      expect(f.length()).toBeCloseTo(0, 4);
    });

    it('返回新 Vector3 不修改 gravity', () => {
      const b = new Buoyancy();
      const body = makeBody('test');
      b.registerBody('test', body);
      const gBefore = b.gravity.clone();
      b.computeBuoyancy(body, 0);
      expect(b.gravity.equals(gBefore)).toBe(true);
    });
  });

  describe('computeDrag', () => {
    it('阻力方向与速度相反', () => {
      const b = new Buoyancy({ linearDrag: 1.0 });
      const body = makeBody('test', { velocity: new Vector3(1, 0, 0) });
      body.submergedVolume = body.volume; // 完全淹没
      const f = b.computeDrag(body);
      expect(f.x).toBeLessThan(0);
      expect(Math.abs(f.y)).toBeCloseTo(0, 6);
    });

    it('阻力大小 = linearDrag * |v| * ratio', () => {
      const b = new Buoyancy({ linearDrag: 2.0 });
      const body = makeBody('test', { velocity: new Vector3(1, 0, 0) });
      body.submergedVolume = body.volume; // ratio = 1
      const f = b.computeDrag(body);
      expect(f.x).toBeCloseTo(-2.0, 6);
    });

    it('未淹没时阻力为 0', () => {
      const b = new Buoyancy();
      const body = makeBody('test', { velocity: new Vector3(1, 0, 0) });
      body.submergedVolume = 0;
      const f = b.computeDrag(body);
      expect(f.length()).toBeCloseTo(0, 6);
    });

    it('部分淹没阻力按比例', () => {
      const b = new Buoyancy({ linearDrag: 2.0 });
      const body = makeBody('test', { velocity: new Vector3(1, 0, 0) });
      body.submergedVolume = body.volume * 0.5;
      const f = b.computeDrag(body);
      expect(f.x).toBeCloseTo(-1.0, 6);
    });
  });

  describe('computeStability', () => {
    it('正立物体恢复力矩为 0', () => {
      const b = new Buoyancy();
      const body = makeBody('test');
      body.rotation.identity();
      body.submergedVolume = body.volume;
      const t = b.computeStability(body);
      expect(t.length()).toBeCloseTo(0, 6);
    });

    it('倾斜物体产生恢复力矩', () => {
      const b = new Buoyancy({ stabilityCoefficient: 1.0 });
      const body = makeBody('test');
      body.rotation.setFromEuler(0, 0, Math.PI / 6); // 倾斜 30 度
      body.submergedVolume = body.volume;
      const t = b.computeStability(body);
      expect(t.length()).toBeGreaterThan(0);
    });

    it('未淹没时力矩为 0', () => {
      const b = new Buoyancy();
      const body = makeBody('test');
      body.rotation.setFromEuler(0, 0, Math.PI / 6);
      body.submergedVolume = 0;
      const t = b.computeStability(body);
      expect(t.length()).toBeCloseTo(0, 6);
    });

    it('力矩随稳定性系数缩放', () => {
      const b1 = new Buoyancy({ stabilityCoefficient: 1.0 });
      const b2 = new Buoyancy({ stabilityCoefficient: 2.0 });
      const makeTilted = () => {
        const body = makeBody('test');
        body.rotation.setFromEuler(0, 0, Math.PI / 6);
        body.submergedVolume = body.volume;
        return body;
      };
      const t1 = b1.computeStability(makeTilted());
      const t2 = b2.computeStability(makeTilted());
      expect(t2.length()).toBeCloseTo(t1.length() * 2, 5);
    });
  });

  describe('update', () => {
    it('推进时间', () => {
      const b = new Buoyancy();
      b.registerBody('boat', makeBody('boat'));
      b.update(0.5);
      expect(b.getStats().time).toBeCloseTo(0.5, 6);
    });

    it('负 dt 被钳到 0', () => {
      const b = new Buoyancy();
      b.registerBody('boat', makeBody('boat'));
      expect(() => b.update(-1)).not.toThrow();
    });

    it('完全淹没的低密度物体向上加速 (浮力 > 重力)', () => {
      const b = new Buoyancy({ fluidLevel: 0, fluidDensity: 1000, voxelCount: 512 });
      // mass=10, volume=1 → 密度 10 << 1000 (水)
      const body = makeBody('boat', {
        mass: 10,
        volume: 1,
        position: new Vector3(0, -10, 0), // 完全淹没
        velocity: new Vector3(0, 0, 0),
      });
      b.registerBody('boat', body);
      b.update(0.01);
      // 浮力 ≈ 9810 N, 重力 = 98.1 N, 加速度 ≈ 971 m/s²
      // 0.01s 后 velocity.y ≈ 9.71
      expect(body.velocity.y).toBeGreaterThan(0);
      expect(body.position.y).toBeGreaterThan(-10);
    });

    it('出水物体仅受重力下落', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      const body = makeBody('boat', {
        mass: 10,
        volume: 1,
        position: new Vector3(0, 10, 0), // 完全出水
        velocity: new Vector3(0, 0, 0),
      });
      b.registerBody('boat', body);
      b.update(0.1);
      // v = -g * dt = -0.981, y = 10 + 0.5*(-9.81)*0.01 = 9.95
      expect(body.velocity.y).toBeCloseTo(-9.81 * 0.1, 4);
      expect(body.position.y).toBeLessThan(10);
    });

    it('update 写回 submergedVolume 与 buoyancyForce', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      const body = makeBody('boat', { position: new Vector3(0, -10, 0) });
      b.registerBody('boat', body);
      expect(body.submergedVolume).toBe(0);
      expect(body.buoyancyForce.y).toBe(0);
      b.update(0.01);
      expect(body.submergedVolume).toBeGreaterThan(0);
      expect(body.buoyancyForce.y).toBeGreaterThan(0);
    });

    it('update 链式返回 this', () => {
      const b = new Buoyancy();
      b.registerBody('boat', makeBody('boat'));
      expect(b.update(0.01)).toBe(b);
    });

    it('倾斜物体角速度被拉回正立方向', () => {
      const b = new Buoyancy({
        fluidLevel: 0,
        voxelCount: 512,
        stabilityCoefficient: 5.0,
        angularDrag: 0,
      });
      const body = makeBody('boat', { position: new Vector3(0, -10, 0) });
      body.rotation.setFromEuler(0, 0, Math.PI / 6); // 倾斜 +30°
      b.registerBody('boat', body);
      b.update(0.01);
      // 角速度应有 z 分量, 用于把倾斜拉回正立
      expect(Math.abs(body.angularVelocity.z)).toBeGreaterThan(0);
    });
  });

  describe('setter', () => {
    it('setFluidDensity', () => {
      const b = new Buoyancy();
      expect(b.setFluidDensity(800).fluidDensity).toBe(800);
      expect(b.setFluidDensity(-1).fluidDensity).toBe(0);
    });

    it('setFluidLevel', () => {
      const b = new Buoyancy();
      expect(b.setFluidLevel(5).fluidLevel).toBe(5);
    });

    it('setGravity', () => {
      const b = new Buoyancy();
      const g = new Vector3(0, -5, 0);
      b.setGravity(g);
      expect(b.gravity).toEqual(g);
      // 修改原 Vector3 不应影响 Buoyancy (因为是 copy)
      g.y = -10;
      expect(b.gravity.y).toBe(-5);
    });

    it('setLinearDrag', () => {
      const b = new Buoyancy();
      expect(b.setLinearDrag(1.5).linearDrag).toBe(1.5);
    });

    it('setAngularDrag', () => {
      const b = new Buoyancy();
      expect(b.setAngularDrag(0.8).angularDrag).toBe(0.8);
    });

    it('setVoxelCount 钳制下限', () => {
      const b = new Buoyancy();
      b.setVoxelCount(0);
      expect(b.voxelCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getSubmergedRatio / getStats', () => {
    beforeEach(() => {
      // noop 占位
    });

    it('getSubmergedRatio 在 update 后返回正确比例', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      const body = makeBody('boat', { position: new Vector3(0, -10, 0) });
      b.registerBody('boat', body);
      b.update(0.01);
      expect(b.getSubmergedRatio('boat')).toBeCloseTo(1, 1);
    });

    it('getSubmergedRatio 出水物体为 0', () => {
      const b = new Buoyancy({ fluidLevel: 0, voxelCount: 512 });
      const body = makeBody('boat', { position: new Vector3(0, 10, 0) });
      b.registerBody('boat', body);
      b.update(0.01);
      expect(b.getSubmergedRatio('boat')).toBeCloseTo(0, 1);
    });

    it('getSubmergedRatio 不存在 id 返回 0', () => {
      const b = new Buoyancy();
      expect(b.getSubmergedRatio('nope')).toBe(0);
    });

    it('getStats 包含正确字段', () => {
      const b = new Buoyancy({
        fluidDensity: 1025,
        fluidLevel: 3,
        linearDrag: 0.7,
        angularDrag: 0.3,
        voxelCount: 128,
        voxelSize: 0.15,
      });
      b.registerBody('a', makeBody('a'));
      b.registerBody('b', makeBody('b'));
      b.update(0.25);
      const s = b.getStats();
      expect(s.bodyCount).toBe(2);
      expect(s.fluidDensity).toBe(1025);
      expect(s.fluidLevel).toBe(3);
      expect(s.gravity).toEqual({ x: 0, y: -9.81, z: 0 });
      expect(s.linearDrag).toBe(0.7);
      expect(s.angularDrag).toBe(0.3);
      expect(s.voxelCount).toBe(128);
      expect(s.voxelSize).toBe(0.15);
      expect(s.time).toBeCloseTo(0.25, 6);
    });
  });
});
