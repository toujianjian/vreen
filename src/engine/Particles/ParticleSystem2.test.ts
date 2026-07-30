import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';
import { ParticleSystem2 } from './ParticleSystem2';
import { ParticleEmitter } from './ParticleEmitter';
import {
  ForceFieldModifier,
  ColorOverLifeModifier,
  SubEmittersModifier,
} from './ParticleModifier';
import { TrailModule } from './TrailModule';

describe('ParticleSystem2', () => {
  describe('construction', () => {
    it('constructs with default maxParticles', () => {
      const sys = new ParticleSystem2();
      expect(sys.maxParticles).toBe(1000);
      expect(sys.particles.length).toBe(0);
      expect(sys.emitters.length).toBe(0);
      expect(sys.modifiers.length).toBe(0);
      expect(sys.aliveCount).toBe(0);
    });

    it('accepts custom maxParticles', () => {
      const sys = new ParticleSystem2(50);
      expect(sys.maxParticles).toBe(50);
    });

    it('defaults: loop=true, duration=5', () => {
      const sys = new ParticleSystem2();
      expect(sys.loop).toBe(true);
      expect(sys.duration).toBe(5);
      expect(sys.time).toBe(0);
    });
  });

  describe('spawn', () => {
    it('creates the requested number of particles', () => {
      const sys = new ParticleSystem2(100);
      const spawned = sys.spawn(5, new Vector3(0, 0, 0), new Vector3(1, 0, 0));
      expect(spawned.length).toBe(5);
      expect(sys.aliveCount).toBe(5);
    });

    it('respects maxParticles cap', () => {
      const sys = new ParticleSystem2(3);
      const spawned = sys.spawn(10, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      expect(spawned.length).toBe(3);
      expect(sys.aliveCount).toBe(3);
    });

    it('assigns position and velocity from arguments', () => {
      const sys = new ParticleSystem2(10);
      const spawned = sys.spawn(2, new Vector3(1, 2, 3), new Vector3(4, 5, 6));
      for (const p of spawned) {
        expect(p.position.x).toBe(1);
        expect(p.position.y).toBe(2);
        expect(p.position.z).toBe(3);
        expect(p.velocity.x).toBe(4);
        expect(p.velocity.y).toBe(5);
        expect(p.velocity.z).toBe(6);
      }
    });

    it('uses system defaults for color/size/lifetime', () => {
      const sys = new ParticleSystem2(100);
      sys.defaults.startColor = new Color(1, 0, 0);
      sys.defaults.endColor = new Color(0, 1, 0);
      sys.defaults.lifetime = { min: 2, max: 2 };
      sys.defaults.startSize = { min: 0.5, max: 0.5 };
      sys.defaults.endSize = { min: 0.1, max: 0.1 };

      const spawned = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      const p = spawned[0];
      expect(p.startColor.r).toBe(1);
      expect(p.endColor.g).toBe(1);
      expect(p.maxLife).toBe(2);
      expect(p.startSize).toBe(0.5);
      expect(p.endSize).toBe(0.1);
    });

    it('returns empty array when count is 0', () => {
      const sys = new ParticleSystem2(100);
      const spawned = sys.spawn(0, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      expect(spawned.length).toBe(0);
    });
  });

  describe('update — integration', () => {
    it('advances particle life over time', () => {
      const sys = new ParticleSystem2(100);
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.maxLife = 2;
      sys.update(0.5);
      expect(p.life).toBeCloseTo(0.5, 6);
    });

    it('moves particle by velocity * dt', () => {
      const sys = new ParticleSystem2(100);
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(1, 0, 0))[0];
      p.maxLife = 10;
      sys.update(0.5);
      expect(p.position.x).toBeCloseTo(0.5, 6);
    });

    it('applies acceleration to velocity', () => {
      const sys = new ParticleSystem2(100);
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.acceleration.set(0, -10, 0);
      p.maxLife = 10;
      sys.update(0.5);
      expect(p.velocity.y).toBeCloseTo(-5, 6);
      expect(p.position.y).toBeCloseTo(-2.5, 6); // 0.5 * (-5) * 0.5
    });

    it('marks particle dead when life exceeds maxLife', () => {
      const sys = new ParticleSystem2(100);
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.maxLife = 1;
      sys.update(1.5);
      expect(p.alive).toBe(false);
    });

    it('removes dead particles after update', () => {
      const sys = new ParticleSystem2(100);
      sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0].maxLife = 1;
      sys.update(1.5);
      expect(sys.aliveCount).toBe(0);
    });

    it('applies drag to velocity', () => {
      const sys = new ParticleSystem2(100);
      sys.defaults.drag = 1; // 1 per second
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(10, 0, 0))[0];
      p.maxLife = 10;
      // Note: drag is read from sys.defaults.drag during update
      sys.update(1);
      // drag = 1, dt = 1, factor = max(0, 1 - 1*1) = 0
      expect(p.velocity.x).toBe(0);
    });
  });

  describe('update — color/size over life (default)', () => {
    it('lerps color from startColor to endColor by default', () => {
      const sys = new ParticleSystem2(100);
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.startColor = new Color(1, 0, 0);
      p.endColor = new Color(0, 1, 0);
      p.maxLife = 2;
      p.life = 0;
      sys.update(1); // life -> 1, t=0.5
      expect(p.color.r).toBeCloseTo(0.5, 6);
      expect(p.color.g).toBeCloseTo(0.5, 6);
    });

    it('lerps size from startSize to endSize by default', () => {
      const sys = new ParticleSystem2(100);
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.startSize = 2;
      p.endSize = 4;
      p.maxLife = 1;
      p.life = 0;
      sys.update(0.5); // life -> 0.5, t=0.5
      expect(p.size).toBeCloseTo(3, 6);
    });

    it('ColorOverLifeModifier overrides default lerp', () => {
      const sys = new ParticleSystem2(100);
      sys.addModifier(new ColorOverLifeModifier(
        new Color(0, 0, 0),
        new Color(1, 1, 1),
      ));
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.startColor = new Color(1, 0, 0); // would normally lerp to red
      p.endColor = new Color(1, 0, 0);
      p.maxLife = 1;
      p.life = 0;
      sys.update(0.5); // t=0.5, modifier says gray (0.5,0.5,0.5)
      expect(p.color.r).toBeCloseTo(0.5, 6);
      expect(p.color.g).toBeCloseTo(0.5, 6);
    });
  });

  describe('update — emitter integration', () => {
    it('runs emitters each frame', () => {
      const sys = new ParticleSystem2(1000);
      const em = new ParticleEmitter();
      em.rate = 100; // 100/s
      sys.addEmitter(em);
      sys.update(0.1);
      expect(sys.aliveCount).toBeGreaterThanOrEqual(5);
      expect(sys.aliveCount).toBeLessThanOrEqual(15);
    });

    it('stops spawning when maxParticles reached', () => {
      const sys = new ParticleSystem2(20);
      const em = new ParticleEmitter();
      em.rate = 1000;
      em.lifetime = 10; // 长寿命,粒子不会死亡
      sys.addEmitter(em);
      // 多次 update 累积
      for (let i = 0; i < 10; i++) sys.update(0.05);
      expect(sys.aliveCount).toBeLessThanOrEqual(20);
    });
  });

  describe('update — modifier integration', () => {
    it('ForceFieldModifier pulls particles toward center', () => {
      const sys = new ParticleSystem2(100);
      sys.addModifier(new ForceFieldModifier(new Vector3(10, 0, 0), 5, 0.1));
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.maxLife = 100;
      sys.update(0.1);
      expect(p.velocity.x).toBeGreaterThan(0);
      expect(p.position.x).toBeGreaterThan(0);
    });

    it('modifiers run in priority order', () => {
      const sys = new ParticleSystem2(100);
      // 两个 modifier,低 priority 先执行
      const order: string[] = [];
      const m1 = new ForceFieldModifier(new Vector3(0, 0, 0), 0, 1);
      m1.priority = 10;
      const m1Apply = m1.apply.bind(m1);
      m1.apply = (p, dt, s) => { order.push('M1'); m1Apply(p, dt, s); };
      const m2 = new ForceFieldModifier(new Vector3(0, 0, 0), 0, 1);
      m2.priority = 5;
      const m2Apply = m2.apply.bind(m2);
      m2.apply = (p, dt, s) => { order.push('M2'); m2Apply(p, dt, s); };
      sys.addModifier(m1);
      sys.addModifier(m2);
      sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0].maxLife = 10;
      sys.update(0.1);
      expect(order).toEqual(['M2', 'M1']); // priority 5 before 10
    });
  });

  describe('update — sub-emitter spawning during iteration', () => {
    it('does not visit newly spawned particles in the same frame', () => {
      const sys = new ParticleSystem2(1000);
      // 添加 SubEmittersModifier
      const subEm = new ParticleEmitter();
      subEm.rate = 0;
      subEm.lifetime = 100;
      const m = new SubEmittersModifier();
      m.onDeathEmitter = subEm;
      m.spawnCount = 1;
      sys.addModifier(m);

      const parent = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      parent.maxLife = 0.5;
      // 一帧内父粒子死亡并触发 sub-emitter
      sys.update(1);
      // 子粒子应该存在,但本帧不会被进一步 update
      expect(sys.aliveCount).toBe(1); // 1 sub-particle
      // 子粒子的 life 应该是 0(本帧没有积分)
      expect(sys.particles[0].life).toBe(0);
    });
  });

  describe('render', () => {
    it('returns Float32Arrays of correct length', () => {
      const sys = new ParticleSystem2(100);
      sys.spawn(3, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      const data = sys.render();
      expect(data.count).toBe(3);
      expect(data.positions.length).toBe(9);
      expect(data.colors.length).toBe(9);
      expect(data.sizes.length).toBe(3);
    });

    it('returns empty arrays for empty system', () => {
      const sys = new ParticleSystem2();
      const data = sys.render();
      expect(data.count).toBe(0);
      expect(data.positions.length).toBe(0);
    });

    it('positions match particle state', () => {
      const sys = new ParticleSystem2(100);
      sys.spawn(1, new Vector3(1, 2, 3), new Vector3(0, 0, 0));
      const data = sys.render();
      expect(data.positions[0]).toBe(1);
      expect(data.positions[1]).toBe(2);
      expect(data.positions[2]).toBe(3);
    });
  });

  describe('reset / clear', () => {
    it('reset clears particles and time, keeps emitters', () => {
      const sys = new ParticleSystem2(100);
      const em = new ParticleEmitter();
      em.rate = 0; // 禁用 rate,避免 update 时额外 spawn
      sys.addEmitter(em);
      sys.spawn(5, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      sys.update(0.5);
      expect(sys.aliveCount).toBe(5);
      expect(sys.time).toBe(0.5);

      sys.reset();
      expect(sys.aliveCount).toBe(0);
      expect(sys.time).toBe(0);
      expect(sys.emitters.length).toBe(1); // emitters 保留
    });

    it('clear empties particles and pool', () => {
      const sys = new ParticleSystem2(100);
      sys.spawn(5, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      sys.reset(); // particles -> pool
      sys.clear();
      sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0));
      expect(sys.aliveCount).toBe(1);
    });
  });

  describe('object pool', () => {
    it('reuses particle instances after death', () => {
      const sys = new ParticleSystem2(10);
      const p1 = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p1.maxLife = 1;
      sys.update(1.5); // p1 死亡,回收到 pool
      expect(sys.aliveCount).toBe(0);

      const p2 = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      // 应该复用同一个实例
      expect(p2).toBe(p1);
    });
  });

  describe('trail integration', () => {
    it('updates trail module each frame', () => {
      const sys = new ParticleSystem2(100);
      const trail = new TrailModule(5);
      sys.setTrail(trail);
      sys.spawn(1, new Vector3(0, 0, 0), new Vector3(1, 0, 0))[0].maxLife = 10;
      sys.update(0.1);
      sys.update(0.1);
      expect(trail.trailCount).toBe(1);
      const data = trail.getTrailData();
      expect(data.counts[0]).toBe(2);
    });
  });

  describe('loop wrapping', () => {
    it('wraps time when loop=true and time exceeds duration', () => {
      const sys = new ParticleSystem2();
      sys.loop = true;
      sys.duration = 2;
      sys.update(1.5);
      expect(sys.time).toBe(1.5);
      sys.update(1); // total 2.5, wraps to 0.5
      expect(sys.time).toBeCloseTo(0.5, 6);
    });

    it('does not wrap when loop=false', () => {
      const sys = new ParticleSystem2();
      sys.loop = false;
      sys.duration = 2;
      sys.update(3);
      expect(sys.time).toBe(3);
    });
  });
});
