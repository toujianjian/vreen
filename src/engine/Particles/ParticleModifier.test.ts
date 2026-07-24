import { describe, it, expect } from 'vitest';
import { Vector3 } from '../Math/Vector3';
import { Color } from '../Math/Color';
import { ParticleData } from './ParticleData';
import { ParticleSystem2 } from './ParticleSystem2';
import {
  ForceFieldModifier,
  VortexModifier,
  TurbulenceModifier,
  ColorOverLifeModifier,
  SizeOverLifeModifier,
  VelocityOverLifeModifier,
  SubEmittersModifier,
} from './ParticleModifier';
import { ParticleEmitter } from './ParticleEmitter';
import { LinearCurve, ConstantCurve } from './ParticleCurve';

describe('ParticleModifier', () => {
  describe('ForceFieldModifier', () => {
    it('attracts particle toward center (strength > 0)', () => {
      const sys = new ParticleSystem2();
      const m = new ForceFieldModifier(new Vector3(10, 0, 0), 1, 0.1);
      const p = new ParticleData();
      p.position.set(0, 0, 0);
      p.velocity.set(0, 0, 0);
      p.maxLife = 10;
      m.apply(p, 0.1, sys);
      // 粒子被拉向 +x
      expect(p.velocity.x).toBeGreaterThan(0);
      expect(p.velocity.y).toBe(0);
      expect(p.velocity.z).toBe(0);
    });

    it('repels particle away from center (strength < 0)', () => {
      const sys = new ParticleSystem2();
      const m = new ForceFieldModifier(new Vector3(10, 0, 0), -1, 0.1);
      const p = new ParticleData();
      p.position.set(0, 0, 0);
      p.velocity.set(0, 0, 0);
      p.maxLife = 10;
      m.apply(p, 0.1, sys);
      expect(p.velocity.x).toBeLessThan(0);
    });

    it('respects minRadius to avoid singularity', () => {
      const sys = new ParticleSystem2();
      const m = new ForceFieldModifier(new Vector3(0, 0, 0), 1, 1);
      const p = new ParticleData();
      p.position.set(0, 0, 0);
      p.velocity.set(0, 0, 0);
      p.maxLife = 10;
      m.apply(p, 0.1, sys);
      // 不应产生 NaN 或 Infinity
      expect(Number.isFinite(p.velocity.x)).toBe(true);
      expect(Number.isFinite(p.velocity.y)).toBe(true);
      expect(Number.isFinite(p.velocity.z)).toBe(true);
    });

    it('force is stronger when particle is closer', () => {
      const sys = new ParticleSystem2();
      const m = new ForceFieldModifier(new Vector3(0, 0, 0), 1, 0.01);
      const near = new ParticleData();
      near.position.set(0.5, 0, 0);
      near.velocity.set(0, 0, 0);
      near.maxLife = 10;
      const far = new ParticleData();
      far.position.set(5, 0, 0);
      far.velocity.set(0, 0, 0);
      far.maxLife = 10;
      m.apply(near, 0.1, sys);
      m.apply(far, 0.1, sys);
      expect(Math.abs(near.velocity.x)).toBeGreaterThan(Math.abs(far.velocity.x));
    });
  });

  describe('VortexModifier', () => {
    it('applies tangential force around axis', () => {
      const sys = new ParticleSystem2();
      const m = new VortexModifier(new Vector3(0, 1, 0), 1, new Vector3(0, 0, 0));
      const p = new ParticleData();
      p.position.set(1, 0, 0); // 在 X 轴上
      p.velocity.set(0, 0, 0);
      p.maxLife = 10;
      m.apply(p, 0.1, sys);
      // 绕 Y 轴,位置在 +X,切线方向应该是 +Z 或 -Z
      expect(p.velocity.x).toBe(0); // X 分量不变(切线垂直于半径)
      expect(Math.abs(p.velocity.z)).toBeGreaterThan(0);
    });

    it('does not move particle exactly on axis', () => {
      const sys = new ParticleSystem2();
      const m = new VortexModifier(new Vector3(0, 1, 0), 1, new Vector3(0, 0, 0));
      const p = new ParticleData();
      p.position.set(0, 1, 0); // 在 Y 轴上(轴线上)
      p.velocity.set(0, 0, 0);
      p.maxLife = 10;
      m.apply(p, 0.1, sys);
      // 在轴线上时 r=0,切线为 0
      expect(p.velocity.x).toBe(0);
      expect(p.velocity.y).toBe(0);
      expect(p.velocity.z).toBe(0);
    });
  });

  describe('TurbulenceModifier', () => {
    it('adds non-zero velocity perturbation', () => {
      const sys = new ParticleSystem2();
      const m = new TurbulenceModifier(2, 1, 1);
      const p = new ParticleData();
      p.position.set(1, 1, 1);
      p.velocity.set(0, 0, 0);
      p.maxLife = 10;
      const initialVx = p.velocity.x;
      m.apply(p, 0.1, sys);
      // 至少一个分量应该有变化(通常所有都有)
      const changed = p.velocity.x !== initialVx ||
        p.velocity.y !== initialVx ||
        p.velocity.z !== initialVx;
      expect(changed).toBe(true);
    });

    it('larger strength produces larger perturbation', () => {
      const sys = new ParticleSystem2();
      const mWeak = new TurbulenceModifier(0.1, 1, 1);
      const mStrong = new TurbulenceModifier(10, 1, 1);
      const p1 = new ParticleData();
      p1.position.set(1, 1, 1);
      p1.velocity.set(0, 0, 0);
      p1.maxLife = 10;
      const p2 = new ParticleData();
      p2.position.set(1, 1, 1);
      p2.velocity.set(0, 0, 0);
      p2.maxLife = 10;
      mWeak.apply(p1, 0.1, sys);
      mStrong.apply(p2, 0.1, sys);
      const mag1 = Math.hypot(p1.velocity.x, p1.velocity.y, p1.velocity.z);
      const mag2 = Math.hypot(p2.velocity.x, p2.velocity.y, p2.velocity.z);
      expect(mag2).toBeGreaterThan(mag1);
    });
  });

  describe('ColorOverLifeModifier', () => {
    it('interpolates from start to end over life', () => {
      const sys = new ParticleSystem2();
      const m = new ColorOverLifeModifier(
        new Color(1, 0, 0),
        new Color(0, 0, 1),
      );
      const p = new ParticleData();
      p.maxLife = 2;
      p.life = 0;
      m.apply(p, 0, sys);
      expect(p.color.r).toBeCloseTo(1, 6);
      expect(p.color.b).toBeCloseTo(0, 6);

      p.life = 1; // t=0.5
      m.apply(p, 0, sys);
      expect(p.color.r).toBeCloseTo(0.5, 6);
      expect(p.color.b).toBeCloseTo(0.5, 6);

      p.life = 2; // t=1
      m.apply(p, 0, sys);
      expect(p.color.r).toBeCloseTo(0, 6);
      expect(p.color.b).toBeCloseTo(1, 6);
    });

    it('clamps t outside [0,1]', () => {
      const sys = new ParticleSystem2();
      const m = new ColorOverLifeModifier(new Color(0, 0, 0), new Color(1, 1, 1));
      const p = new ParticleData();
      p.maxLife = 1;
      p.life = 2; // t > 1
      m.apply(p, 0, sys);
      expect(p.color.r).toBe(1);
    });
  });

  describe('SizeOverLifeModifier', () => {
    it('scales size by curve over life', () => {
      const sys = new ParticleSystem2();
      // curve: linear from 1 to 0
      const m = new SizeOverLifeModifier(new LinearCurve(1, 0));
      const p = new ParticleData();
      p.startSize = 1;
      p.endSize = 0;
      p.maxLife = 1;
      p.life = 0;
      m.apply(p, 0, sys);
      // k = curve(0) = 1, size = lerp(1, 0, 1) = 0... wait, that's wrong
      // Actually: size = lerp(startSize, endSize, k)
      // k(0) = 1, so size = lerp(1, 0, 1) = 0
      // Hmm that means at t=0 size=endSize. Let me re-check.
      // curve from 1 to 0: at t=0, k=1; at t=1, k=0
      // So size = lerp(startSize, endSize, k):
      //   t=0: k=1, size = endSize = 0
      //   t=1: k=0, size = startSize = 1
      // That's inverted from what one might expect, but it's consistent.
      // Let me use a constant curve = 0.5 for clarity instead.
      expect(p.size).toBe(0); // lerp(1, 0, 1) = 0
    });

    it('with constant curve returns lerp(start, end, k)', () => {
      const sys = new ParticleSystem2();
      const m = new SizeOverLifeModifier(new ConstantCurve(0.5));
      const p = new ParticleData();
      p.startSize = 0;
      p.endSize = 10;
      p.maxLife = 1;
      p.life = 0.5;
      m.apply(p, 0, sys);
      // k = 0.5, size = lerp(0, 10, 0.5) = 5
      expect(p.size).toBe(5);
    });

    it('with linear curve 0->1 progresses start to end', () => {
      const sys = new ParticleSystem2();
      const m = new SizeOverLifeModifier(new LinearCurve(0, 1));
      const p = new ParticleData();
      p.startSize = 2;
      p.endSize = 8;
      p.maxLife = 1;
      p.life = 0.5;
      m.apply(p, 0, sys);
      // k = 0.5, size = lerp(2, 8, 0.5) = 5
      expect(p.size).toBe(5);
    });
  });

  describe('VelocityOverLifeModifier', () => {
    it('caches initial velocity on first apply', () => {
      const sys = new ParticleSystem2();
      const m = new VelocityOverLifeModifier(new ConstantCurve(0.5));
      const p = new ParticleData();
      p.velocity.set(10, 0, 0);
      p.maxLife = 2;
      p.life = 0;
      m.apply(p, 0, sys);
      // 缓存的初始速度应存在
      expect(p.customData[0]).toBe(10);
      expect(p.customData[1]).toBe(0);
      expect(p.customData[2]).toBe(0);
      // scale=0.5, so velocity should be 5
      expect(p.velocity.x).toBe(5);
    });

    it('preserves initial velocity across applies even when current changes', () => {
      const sys = new ParticleSystem2();
      const m = new VelocityOverLifeModifier(new ConstantCurve(1)); // always scale=1
      const p = new ParticleData();
      p.velocity.set(10, 0, 0);
      p.maxLife = 2;
      p.life = 0;
      m.apply(p, 0, sys);
      expect(p.velocity.x).toBe(10);

      // 外部修改速度
      p.velocity.set(99, 0, 0);
      m.apply(p, 0, sys);
      // 应该恢复到缓存值 * 1 = 10
      expect(p.velocity.x).toBe(10);
    });

    it('scales velocity to zero at end of life with linear 1->0', () => {
      const sys = new ParticleSystem2();
      const m = new VelocityOverLifeModifier(new LinearCurve(1, 0));
      const p = new ParticleData();
      p.velocity.set(10, 0, 0);
      p.maxLife = 1;
      p.life = 0;
      m.apply(p, 0, sys);
      expect(p.velocity.x).toBe(10); // scale=1

      p.life = 1;
      m.apply(p, 0, sys);
      expect(p.velocity.x).toBe(0); // scale=0
    });
  });

  describe('SubEmittersModifier', () => {
    it('spawns sub-particles when particle is about to die', () => {
      const sys = new ParticleSystem2(1000);
      const subEm = new ParticleEmitter();
      subEm.rate = 0;
      const m = new SubEmittersModifier();
      m.onDeathEmitter = subEm;
      m.spawnCount = 3;
      sys.addModifier(m);

      // 创建一个父粒子
      const parent = sys.spawn(1, new Vector3(1, 2, 3), new Vector3(0, 0, 0))[0];
      parent.maxLife = 1;
      parent.life = 0.95;

      const before = sys.aliveCount;
      sys.update(0.1); // 父粒子 life 从 0.95 -> 1.05, 触发 sub-emitter
      // 父粒子可能已死,但 sub-emitter 应该 spawn 了 3 个新粒子
      // aliveCount = before - 1 (父死亡) + 3 (子粒子) = before + 2
      expect(sys.aliveCount).toBe(before + 2);
    });

    it('only triggers once per particle', () => {
      const sys = new ParticleSystem2(1000);
      const subEm = new ParticleEmitter();
      subEm.rate = 0;
      const m = new SubEmittersModifier();
      m.onDeathEmitter = subEm;
      m.spawnCount = 2;
      sys.addModifier(m);

      const parent = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      parent.maxLife = 1;

      // 第一帧:life=0,willDie = 0+dt >= 1? dt=1.5, yes -> trigger
      sys.update(1.5);
      const countAfterFirst = sys.aliveCount;

      // 第二帧:父粒子已死,不应再触发
      // (alive=false 的粒子在 update 中跳过)
      sys.update(0.1);
      // 没有新的 sub-particles
      expect(sys.aliveCount).toBeLessThanOrEqual(countAfterFirst);
    });

    it('does nothing when no onDeathEmitter set', () => {
      const sys = new ParticleSystem2(1000);
      const m = new SubEmittersModifier();
      // onDeathEmitter 未设置
      sys.addModifier(m);
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.maxLife = 1;
      p.life = 0.99;
      const before = sys.aliveCount;
      sys.update(0.1);
      // 父粒子死亡,但无 sub-emitter 触发
      expect(sys.aliveCount).toBe(before - 1);
    });
  });

  describe('modifier enabled flag', () => {
    it('disabled modifier is skipped by system', () => {
      const sys = new ParticleSystem2();
      const m = new ColorOverLifeModifier(new Color(0, 0, 0), new Color(1, 1, 1));
      m.enabled = false;
      sys.addModifier(m);
      const p = sys.spawn(1, new Vector3(0, 0, 0), new Vector3(0, 0, 0))[0];
      p.startColor = new Color(0.2, 0.2, 0.2);
      p.endColor = new Color(0.2, 0.2, 0.2);
      // 系统默认 color lerp 会把 color 设为 startColor (t=0)
      sys.update(0);
      // modifier 被禁用,color 应保持系统默认 lerp 结果
      expect(p.color.r).toBeCloseTo(0.2, 6);
    });
  });
});
