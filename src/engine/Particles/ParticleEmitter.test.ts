import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';
import { ParticleSystem2 } from './ParticleSystem2';
import { ParticleEmitter } from './ParticleEmitter';

describe('ParticleEmitter', () => {
  describe('point shape', () => {
    it('spawns particles at emitter position', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.shape = { type: 'point' };
      em.position.set(5, 0, 0);
      em.rate = 0; // disable rate-based spawning
      sys.addEmitter(em);
      sys.update(0.016);

      // rate=0 means no spawns from update
      expect(sys.aliveCount).toBe(0);

      // trigger spawns exactly burstCount particles at position
      em.trigger(sys, new Vector3(5, 0, 0), 3);
      expect(sys.aliveCount).toBe(3);
      for (const p of sys.particles) {
        expect(p.position.x).toBe(5);
        expect(p.position.y).toBe(0);
        expect(p.position.z).toBe(0);
      }
    });

    it('rate accumulates over time', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.shape = { type: 'point' };
      em.rate = 10; // 10 per second
      sys.addEmitter(em);
      // 0.5s should spawn ~5 particles
      sys.update(0.5);
      expect(sys.aliveCount).toBeGreaterThanOrEqual(4);
      expect(sys.aliveCount).toBeLessThanOrEqual(6);
    });
  });

  describe('box shape', () => {
    it('spawns particles within box half-extents', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'box', halfExtents: [2, 3, 4] };
      em.position.set(0, 0, 0);
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
        expect(p.position.z).toBeGreaterThanOrEqual(29);
        expect(p.position.z).toBeLessThanOrEqual(31);
      }
    });
  });

  describe('sphere shape', () => {
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
        // shell particles should be very close to radius=2
        expect(dist).toBeGreaterThan(1.5);
      }
    });
  });

  describe('cone shape', () => {
    it('spawns particles in the cone base disc', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'cone', height: 1, angle: Math.PI / 4 };
      em.position.set(0, 0, 0);
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 100);

      const expectedRadius = 1 * Math.tan(Math.PI / 4); // = 1
      for (const p of sys.particles) {
        const r = Math.hypot(p.position.x, p.position.z);
        expect(r).toBeLessThanOrEqual(expectedRadius + 1e-6);
        expect(p.position.y).toBe(0); // base on y=0 plane
      }
    });

    it('cone velocity points upward (positive y)', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'cone', height: 1, angle: 0.1 };
      em.rate = 0;
      em.speed = { min: 1, max: 1 };
      sys.addEmitter(em);
      em.trigger(sys, em.position, 50);

      for (const p of sys.particles) {
        expect(p.velocity.y).toBeGreaterThan(0);
      }
    });
  });

  describe('mesh shape', () => {
    it('spawns particles on a single triangle', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      // 单三角形 (0,0,0), (1,0,0), (0,1,0)
      em.shape = {
        type: 'mesh',
        positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 100);

      for (const p of sys.particles) {
        // 粒子必须在三角形内: x>=0, y>=0, x+y<=1, z=0
        expect(p.position.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.position.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.position.x + p.position.y).toBeLessThanOrEqual(1 + 1e-6);
        expect(p.position.z).toBe(0);
      }
    });

    it('falls back to base position when positions missing', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.shape = { type: 'mesh' }; // no positions
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

  describe('emitter config propagation', () => {
    it('applies startColor and endColor to spawned particles', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.startColor = new Color(1, 0, 0);
      em.endColor = new Color(0, 0, 1);
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 5);

      for (const p of sys.particles) {
        expect(p.startColor.r).toBe(1);
        expect(p.startColor.b).toBe(0);
        expect(p.endColor.r).toBe(0);
        expect(p.endColor.b).toBe(1);
        // initial color should equal startColor
        expect(p.color.r).toBe(1);
        expect(p.color.b).toBe(0);
      }
    });

    it('applies gravity to particle acceleration', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.gravity = -9.8;
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 1);

      const p = sys.particles[0];
      expect(p.acceleration.y).toBe(-9.8);
    });

    it('applies lifetime range', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.lifetime = { min: 0.5, max: 0.5 };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 10);

      for (const p of sys.particles) {
        expect(p.maxLife).toBe(0.5);
      }
    });

    it('applies startSize and endSize ranges', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.startSize = { min: 0.2, max: 0.2 };
      em.endSize = { min: 0, max: 0 };
      em.rate = 0;
      sys.addEmitter(em);
      em.trigger(sys, em.position, 10);

      for (const p of sys.particles) {
        expect(p.startSize).toBe(0.2);
        expect(p.endSize).toBe(0);
        expect(p.size).toBe(0.2);
      }
    });
  });

  describe('bursts', () => {
    it('fires burst at scheduled time', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.rate = 0;
      em.bursts = [{
        count: 5,
        time: 0.3,
        cycles: 1,
        interval: 0,
        fired: 0,
      }];
      sys.addEmitter(em);

      sys.update(0.1);
      expect(sys.aliveCount).toBe(0);

      sys.update(0.25); // total 0.35s, past 0.3s
      expect(sys.aliveCount).toBe(5);
    });

    it('respects cycles and interval for repeated bursts', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.rate = 0;
      em.lifetime = { min: 10, max: 10 }; // long lifetime so they accumulate
      em.bursts = [{
        count: 2,
        time: 0,
        cycles: 3,
        interval: 0.1,
        fired: 0,
      }];
      sys.addEmitter(em);

      sys.update(0.001);
      expect(sys.aliveCount).toBe(2); // first burst

      sys.update(0.1);
      expect(sys.aliveCount).toBe(4); // second burst

      sys.update(0.1);
      expect(sys.aliveCount).toBe(6); // third burst

      sys.update(0.1);
      expect(sys.aliveCount).toBe(6); // no more bursts
    });
  });

  describe('reset', () => {
    it('clears elapsed time and burst fired counts', () => {
      const em = new ParticleEmitter();
      em.rate = 0;
      em.bursts = [{ count: 1, time: 0, cycles: 1, interval: 0, fired: 1 }];
      em.reset();
      expect(em.bursts[0].fired).toBe(0);
    });
  });
});
