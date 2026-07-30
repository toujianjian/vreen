// ParticleEmitter 单元测试。
//
// 覆盖双模式:
//   1. ParticleSystem2 兼容模式: shape/rate/bursts/trigger, 字段已适配新类型
//      (lifetime: number, startColor: {r,g,b,a}, gravity: Vector3, startSize/endSize: number, startSpeed)。
//   2. 自包含模式: emit/emitFromShape/update(dt)/曲线/子发射器/拖尾/setter。

import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { ParticleSystem2 } from './ParticleSystem2';
import { ParticleEmitter } from './ParticleEmitter';

describe('ParticleEmitter', () => {
  // ════════════════════════════════════════════════════════════════
  // ParticleSystem2 兼容模式
  // ════════════════════════════════════════════════════════════════
  describe('compat mode: point shape', () => {
    it('spawns particles at emitter position via trigger', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.shape = { type: 'point' };
      em.position.set(5, 0, 0);
      em.rate = 0;
      sys.addEmitter(em);
      sys.update(0.016);
      expect(sys.aliveCount).toBe(0);
      em.trigger(sys, new Vector3(5, 0, 0), 3);
      expect(sys.aliveCount).toBe(3);
      for (const p of sys.particles) {
        expect(p.position.x).toBe(5);
      }
    });

    it('rate accumulates over time', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.shape = { type: 'point' };
      em.rate = 10;
      sys.addEmitter(em);
      sys.update(0.5);
      expect(sys.aliveCount).toBeGreaterThanOrEqual(4);
      expect(sys.aliveCount).toBeLessThanOrEqual(6);
    });
  });

  describe('compat mode: box shape', () => {
    it('spawns particles within box half-extents', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'box', halfExtents: [2, 3, 4] };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 50);
      for (const p of sys.particles) {
        expect(Math.abs(p.position.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(p.position.y)).toBeLessThanOrEqual(3);
        expect(Math.abs(p.position.z)).toBeLessThanOrEqual(4);
      }
    });

    it('respects emitter position offset', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'box', halfExtents: [1, 1, 1] };
      em.position.set(10, 20, 30);
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 20);
      for (const p of sys.particles) {
        expect(p.position.x).toBeGreaterThanOrEqual(9);
        expect(p.position.x).toBeLessThanOrEqual(11);
        expect(p.position.y).toBeGreaterThanOrEqual(19);
        expect(p.position.y).toBeLessThanOrEqual(21);
      }
    });
  });

  describe('compat mode: sphere shape', () => {
    it('spawns particles within sphere radius', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'sphere', radius: 2 };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 100);
      for (const p of sys.particles) {
        const dist = Math.hypot(p.position.x, p.position.y, p.position.z);
        expect(dist).toBeLessThanOrEqual(2 + 1e-6);
      }
    });

    it('shellOnly spawns particles near the shell', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'sphere', radius: 2, shellOnly: true };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 100);
      for (const p of sys.particles) {
        const dist = Math.hypot(p.position.x, p.position.y, p.position.z);
        expect(dist).toBeGreaterThan(1.5);
      }
    });
  });

  describe('compat mode: cone shape', () => {
    it('spawns particles in the cone base disc', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'cone', height: 1, angle: Math.PI / 4 };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 100);
      const expectedRadius = 1 * Math.tan(Math.PI / 4);
      for (const p of sys.particles) {
        const r = Math.hypot(p.position.x, p.position.z);
        expect(r).toBeLessThanOrEqual(expectedRadius + 1e-6);
        expect(p.position.y).toBe(0);
      }
    });

    it('cone velocity points upward (positive y)', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'cone', height: 1, angle: 0.1 };
      em.rate = 0;
      em.startSpeed = 1;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 50);
      for (const p of sys.particles) {
        expect(p.velocity.y).toBeGreaterThan(0);
      }
    });
  });

  describe('compat mode: circle & hemisphere shapes', () => {
    it('circle spawns within radius on XZ plane', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'circle', radius: 2 };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 100);
      for (const p of sys.particles) {
        const r = Math.hypot(p.position.x, p.position.z);
        expect(r).toBeLessThanOrEqual(2 + 1e-6);
        expect(p.position.y).toBe(0);
      }
    });

    it('hemisphere spawns in upper half (y >= 0 after offset)', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'hemisphere', radius: 2 };
      em.position.set(0, 0, 0);
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 100);
      for (const p of sys.particles) {
        const dist = Math.hypot(p.position.x, p.position.y, p.position.z);
        expect(dist).toBeLessThanOrEqual(2 + 1e-6);
        // hemisphere 法线 +Y, 采样翻转后 y >= 0
        expect(p.position.y).toBeGreaterThanOrEqual(-1e-6);
      }
    });
  });

  describe('compat mode: mesh shape', () => {
    it('spawns particles on a single triangle', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = {
        type: 'mesh',
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 100);
      for (const p of sys.particles) {
        expect(p.position.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.position.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.position.x + p.position.y).toBeLessThanOrEqual(1 + 1e-6);
        expect(p.position.z).toBe(0);
      }
    });

    it('falls back to base position when positions missing', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'mesh' };
      em.position.set(1, 2, 3);
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 5);
      for (const p of sys.particles) {
        expect(p.position.x).toBe(1);
        expect(p.position.y).toBe(2);
        expect(p.position.z).toBe(3);
      }
    });
  });

  describe('compat mode: config propagation', () => {
    it('applies startColor and endColor (RGBA → Color RGB)', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.startColor = { r: 1, g: 0, b: 0, a: 1 };
      em.endColor = { r: 0, g: 0, b: 1, a: 0 };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 5);
      for (const p of sys.particles) {
        expect(p.startColor.r).toBe(1);
        expect(p.startColor.b).toBe(0);
        expect(p.endColor.r).toBe(0);
        expect(p.endColor.b).toBe(1);
        expect(p.color.r).toBe(1);
      }
    });

    it('applies gravity (Vector3) to particle acceleration', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.gravity = new Vector3(0, -9.8, 0);
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 1);
      const p = sys.particles[0];
      expect(p.acceleration.y).toBe(-9.8);
    });

    it('applies lifetime (number) to maxLife', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.lifetime = 0.5;
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 10);
      for (const p of sys.particles) {
        expect(p.maxLife).toBe(0.5);
      }
    });

    it('applies startSize and endSize (number)', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.startSize = 0.2;
      em.endSize = 0;
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 10);
      for (const p of sys.particles) {
        expect(p.startSize).toBe(0.2);
        expect(p.endSize).toBe(0);
        expect(p.size).toBe(0.2);
      }
    });

    it('stores startColor alpha in customData[0]', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.startColor = { r: 1, g: 1, b: 1, a: 0.5 };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 1);
      expect(sys.particles[0].customData[0]).toBe(0.5);
    });
  });

  describe('compat mode: bursts', () => {
    it('fires burst at scheduled time', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.rate = 0;
      em.bursts = [{ count: 5, time: 0.3, cycles: 1, interval: 0, fired: 0 }];
      sys.addEmitter(em);
      sys.update(0.1);
      expect(sys.aliveCount).toBe(0);
      sys.update(0.25);
      expect(sys.aliveCount).toBe(5);
    });

    it('respects cycles and interval for repeated bursts', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.rate = 0;
      em.lifetime = 10;
      em.bursts = [{ count: 2, time: 0, cycles: 3, interval: 0.1, fired: 0 }];
      sys.addEmitter(em);
      sys.update(0.001);
      expect(sys.aliveCount).toBe(2);
      sys.update(0.1);
      expect(sys.aliveCount).toBe(4);
      sys.update(0.1);
      expect(sys.aliveCount).toBe(6);
      sys.update(0.1);
      expect(sys.aliveCount).toBe(6);
    });
  });

  describe('compat mode: reset', () => {
    it('clears elapsed time and burst fired counts', () => {
      const em = new ParticleEmitter();
      em.rate = 0;
      em.bursts = [{ count: 1, time: 0, cycles: 1, interval: 0, fired: 1 }];
      em.reset();
      expect(em.bursts[0].fired).toBe(0);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // 自包含模式
  // ════════════════════════════════════════════════════════════════
  describe('self-contained: emit', () => {
    it('emit creates particles in this.particles', () => {
      const em = new ParticleEmitter();
      em.emit(5);
      expect(em.getParticleCount()).toBe(5);
      expect(em.getParticles().length).toBe(5);
    });

    it('emit respects maxParticles limit', () => {
      const em = new ParticleEmitter();
      em.maxParticles = 3;
      em.emit(10);
      expect(em.getParticleCount()).toBe(3);
    });

    it('point shape spawns at emitter position', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'point';
      em.position.set(7, 8, 9);
      em.emit(3);
      for (const p of em.getParticles()) {
        expect(p.position.x).toBe(7);
        expect(p.position.y).toBe(8);
        expect(p.position.z).toBe(9);
      }
    });

    it('sphere shape spawns within radius', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'sphere';
      em.shapeParams = { radius: 2 };
      em.emit(100);
      for (const p of em.getParticles()) {
        const d = Math.hypot(p.position.x, p.position.y, p.position.z);
        expect(d).toBeLessThanOrEqual(2 + 1e-6);
      }
    });

    it('box shape spawns within extents', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'box';
      em.shapeParams = { extents: [2, 3, 4] };
      em.emit(100);
      for (const p of em.getParticles()) {
        expect(Math.abs(p.position.x)).toBeLessThanOrEqual(2);
        expect(Math.abs(p.position.y)).toBeLessThanOrEqual(3);
        expect(Math.abs(p.position.z)).toBeLessThanOrEqual(4);
      }
    });

    it('circle shape spawns within radius on XZ plane', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'circle';
      em.shapeParams = { radius: 2 };
      em.emit(100);
      for (const p of em.getParticles()) {
        const r = Math.hypot(p.position.x, p.position.z);
        expect(r).toBeLessThanOrEqual(2 + 1e-6);
        expect(p.position.y).toBe(0);
      }
    });

    it('hemisphere shape spawns in upper half', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'hemisphere';
      em.shapeParams = { radius: 2, normal: new Vector3(0, 1, 0) };
      em.emit(100);
      for (const p of em.getParticles()) {
        const d = Math.hypot(p.position.x, p.position.y, p.position.z);
        expect(d).toBeLessThanOrEqual(2 + 1e-6);
        expect(p.position.y).toBeGreaterThanOrEqual(-1e-6);
      }
    });

    it('emitFromShape uses given shape without changing config', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'point';
      em.emitFromShape('sphere', 50);
      expect(em.emissionShape).toBe('point'); // 未改变
      for (const p of em.getParticles()) {
        const d = Math.hypot(p.position.x, p.position.y, p.position.z);
        expect(d).toBeLessThanOrEqual(0.5 + 1e-6); // 默认 radius 0.5
      }
    });
  });

  describe('self-contained: update', () => {
    it('update integrates position by velocity', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'point';
      em.startSpeed = 0; // velocity = 0
      em.lifetime = 10;
      em.emissionRate = 0;
      em.emit(1);
      // 手动设速度
      em.getParticles()[0].velocity.set(1, 0, 0);
      em.update(0.5);
      expect(em.getParticles()[0].position.x).toBeCloseTo(0.5, 5);
    });

    it('update applies gravity (Vector3)', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'point';
      em.startSpeed = 0;
      em.lifetime = 10;
      em.emissionRate = 0;
      em.gravity = new Vector3(0, -10, 0);
      em.emit(1);
      em.update(1);
      // vel.y = 0 + (-10)*1 = -10; pos.y = 0 + (-10)*1 = -10
      expect(em.getParticles()[0].position.y).toBeCloseTo(-10, 5);
    });

    it('update applies drag', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'point';
      em.startSpeed = 10;
      em.lifetime = 10;
      em.emissionRate = 0;
      em.drag = 1;
      em.emit(1);
      const v0 = em.getParticles()[0].velocity.length();
      em.update(0.5);
      const v1 = em.getParticles()[0].velocity.length();
      expect(v1).toBeLessThan(v0);
      // drag=1, dt=0.5 → factor 0.5
      expect(v1).toBeCloseTo(v0 * 0.5, 4);
    });

    it('update removes dead particles (age >= lifetime)', () => {
      const em = new ParticleEmitter();
      em.lifetime = 0.1;
      em.emissionRate = 0;
      em.emit(5);
      expect(em.getParticleCount()).toBe(5);
      em.update(0.2);
      expect(em.getParticleCount()).toBe(0);
    });

    it('update accumulates emission by emissionRate', () => {
      const em = new ParticleEmitter();
      em.emissionRate = 100; // 100/s
      em.lifetime = 10; // 长寿命, 不清理
      em.update(0.1);
      expect(em.getParticleCount()).toBeGreaterThanOrEqual(9);
      expect(em.getParticleCount()).toBeLessThanOrEqual(11);
    });

    it('update interpolates size linearly without curve', () => {
      const em = new ParticleEmitter();
      em.startSize = 1;
      em.endSize = 0;
      em.lifetime = 1;
      em.emissionRate = 0;
      em.emit(1);
      em.update(0.5);
      expect(em.getParticles()[0].size).toBeCloseTo(0.5, 5);
    });

    it('update interpolates color linearly without curve', () => {
      const em = new ParticleEmitter();
      em.startColor = { r: 1, g: 1, b: 1, a: 1 };
      em.endColor = { r: 0, g: 0, b: 0, a: 0 };
      em.lifetime = 1;
      em.emissionRate = 0;
      em.emit(1);
      em.update(0.5);
      const c = em.getParticles()[0].color;
      expect(c.r).toBeCloseTo(0.5, 5);
      expect(c.a).toBeCloseTo(0.5, 5);
    });

    it('update uses sizeCurve when set', () => {
      const em = new ParticleEmitter();
      em.startSize = 1;
      em.endSize = 0;
      em.lifetime = 1;
      em.emissionRate = 0;
      em.sizeCurve = [1, 0]; // 均匀关键帧
      em.emit(1);
      em.update(0.5);
      // sampleCurve([1,0], 0.5) = 0.5; size = lerp(1, 0, 0.5) = 0.5
      expect(em.getParticles()[0].size).toBeCloseTo(0.5, 5);
    });

    it('update uses colorCurve when set', () => {
      const em = new ParticleEmitter();
      em.startColor = { r: 1, g: 0, b: 0, a: 1 };
      em.endColor = { r: 0, g: 0, b: 0, a: 0 };
      em.lifetime = 1;
      em.emissionRate = 0;
      em.colorCurve = [0, 1, 0]; // 中间峰值
      em.emit(1);
      em.update(0.5);
      // sampleCurve([0,1,0], 0.5) = 1; color.r = lerp(1, 0, 1) = 0
      expect(em.getParticles()[0].color.r).toBeCloseTo(0, 5);
    });
  });

  describe('self-contained: sub-emitters', () => {
    it('triggers sub-emitter on particle death', () => {
      const parent = new ParticleEmitter();
      const child = new ParticleEmitter();
      child.burstCount = 3;
      parent.lifetime = 0.1;
      parent.emissionRate = 0;
      parent.addSubEmitter(child);
      parent.emit(1);
      expect(child.getParticleCount()).toBe(0);
      parent.update(0.2);
      expect(child.getParticleCount()).toBe(3);
    });
  });

  describe('self-contained: trails', () => {
    it('trails enabled appends position history on update', () => {
      const em = new ParticleEmitter();
      em.emissionShape = 'point';
      em.startSpeed = 0;
      em.lifetime = 10;
      em.emissionRate = 0;
      em.setTrails(true, 5);
      em.emit(1);
      expect(em.getParticles()[0].trail).toBeDefined();
      expect(em.getParticles()[0].trail!.length).toBe(1);
      em.update(0.1);
      expect(em.getParticles()[0].trail!.length).toBe(2);
      em.update(0.1);
      expect(em.getParticles()[0].trail!.length).toBe(3);
    });

    it('trail caps at trailLifetime', () => {
      const em = new ParticleEmitter();
      em.startSpeed = 0;
      em.lifetime = 100;
      em.emissionRate = 0;
      em.setTrails(true, 3);
      em.emit(1);
      for (let i = 0; i < 10; i++) em.update(0.1);
      expect(em.getParticles()[0].trail!.length).toBeLessThanOrEqual(3);
    });

    it('trails disabled does not create trail array', () => {
      const em = new ParticleEmitter();
      em.emissionRate = 0;
      em.emit(1);
      expect(em.getParticles()[0].trail).toBeUndefined();
    });
  });

  describe('self-contained: setters', () => {
    it('setEmissionShape updates emissionShape', () => {
      const em = new ParticleEmitter();
      em.setEmissionShape('cone');
      expect(em.emissionShape).toBe('cone');
    });

    it('setEmissionRate updates emissionRate (clamped to 0)', () => {
      const em = new ParticleEmitter();
      em.setEmissionRate(50);
      expect(em.emissionRate).toBe(50);
      em.setEmissionRate(-5);
      expect(em.emissionRate).toBe(0);
    });

    it('setLifetime updates lifetime (clamped to 0)', () => {
      const em = new ParticleEmitter();
      em.setLifetime(3);
      expect(em.lifetime).toBe(3);
      em.setLifetime(-1);
      expect(em.lifetime).toBe(0);
    });

    it('setStartSpeed updates startSpeed', () => {
      const em = new ParticleEmitter();
      em.setStartSpeed(5);
      expect(em.startSpeed).toBe(5);
    });

    it('setColors updates startColor and endColor (copies)', () => {
      const em = new ParticleEmitter();
      const start = { r: 1, g: 0, b: 0, a: 1 };
      const end = { r: 0, g: 0, b: 1, a: 0 };
      em.setColors(start, end);
      expect(em.startColor.r).toBe(1);
      expect(em.endColor.b).toBe(1);
      // 应是拷贝, 修改原对象不影响
      start.r = 0.5;
      expect(em.startColor.r).toBe(1);
    });

    it('setSizes updates startSize and endSize', () => {
      const em = new ParticleEmitter();
      em.setSizes(2, 0.5);
      expect(em.startSize).toBe(2);
      expect(em.endSize).toBe(0.5);
    });

    it('setGravity copies gravity vector', () => {
      const em = new ParticleEmitter();
      const g = new Vector3(0, -9.8, 0);
      em.setGravity(g);
      expect(em.gravity.y).toBe(-9.8);
      g.y = -5;
      expect(em.gravity.y).toBe(-9.8); // 拷贝, 不共享
    });

    it('setDrag updates drag (clamped to 0)', () => {
      const em = new ParticleEmitter();
      em.setDrag(0.5);
      expect(em.drag).toBe(0.5);
      em.setDrag(-1);
      expect(em.drag).toBe(0);
    });

    it('setSizeCurve copies curve', () => {
      const em = new ParticleEmitter();
      const c = [0, 1, 0];
      em.setSizeCurve(c);
      expect(em.sizeCurve).toEqual([0, 1, 0]);
      c.push(99);
      expect(em.sizeCurve.length).toBe(3); // 拷贝
    });

    it('setColorCurve copies curve', () => {
      const em = new ParticleEmitter();
      em.setColorCurve([1, 0]);
      expect(em.colorCurve).toEqual([1, 0]);
    });

    it('addSubEmitter appends to subEmitters', () => {
      const em = new ParticleEmitter();
      const sub = new ParticleEmitter();
      em.addSubEmitter(sub);
      expect(em.subEmitters.length).toBe(1);
      expect(em.subEmitters[0]).toBe(sub);
    });

    it('setTrails updates trails and trailLifetime', () => {
      const em = new ParticleEmitter();
      em.setTrails(true, 10);
      expect(em.trails).toBe(true);
      expect(em.trailLifetime).toBe(10);
    });
  });

  describe('self-contained: queries', () => {
    it('clear empties particles array', () => {
      const em = new ParticleEmitter();
      em.emit(5);
      em.clear();
      expect(em.getParticleCount()).toBe(0);
    });

    it('getMaxParticles returns maxParticles', () => {
      const em = new ParticleEmitter();
      em.maxParticles = 500;
      expect(em.getMaxParticles()).toBe(500);
    });

    it('getParticles returns reference to particles array', () => {
      const em = new ParticleEmitter();
      em.emit(2);
      const arr = em.getParticles();
      expect(arr).toBe(em.particles);
      expect(arr.length).toBe(2);
    });
  });

  // ════════════════════════════════════════════════════════════════
  // sampleCurve
  // ════════════════════════════════════════════════════════════════
  describe('sampleCurve', () => {
    it('empty curve returns t (linear)', () => {
      const em = new ParticleEmitter();
      expect(em.sampleCurve([], 0.5)).toBeCloseTo(0.5, 5);
      expect(em.sampleCurve([], 0)).toBe(0);
      expect(em.sampleCurve([], 1)).toBe(1);
    });

    it('single element returns constant', () => {
      const em = new ParticleEmitter();
      expect(em.sampleCurve([5], 0)).toBe(5);
      expect(em.sampleCurve([5], 0.5)).toBe(5);
      expect(em.sampleCurve([5], 1)).toBe(5);
    });

    it('two elements linearly interpolate', () => {
      const em = new ParticleEmitter();
      expect(em.sampleCurve([0, 1], 0)).toBe(0);
      expect(em.sampleCurve([0, 1], 0.5)).toBeCloseTo(0.5, 5);
      expect(em.sampleCurve([0, 1], 1)).toBe(1);
    });

    it('three elements interpolate across keyframes', () => {
      const em = new ParticleEmitter();
      // curve = [0, 1, 0]: t=0→0, t=0.5→1, t=1→0
      expect(em.sampleCurve([0, 1, 0], 0)).toBe(0);
      expect(em.sampleCurve([0, 1, 0], 0.5)).toBeCloseTo(1, 5);
      expect(em.sampleCurve([0, 1, 0], 1)).toBe(0);
      expect(em.sampleCurve([0, 1, 0], 0.25)).toBeCloseTo(0.5, 5);
    });

    it('clamps t outside [0,1]', () => {
      const em = new ParticleEmitter();
      expect(em.sampleCurve([0, 1], -1)).toBe(0);
      expect(em.sampleCurve([0, 1], 2)).toBe(1);
    });
  });
});
