import { describe, it, expect, beforeEach } from 'vitest';
import { WaterInteraction } from './WaterInteraction';
import { Vector3 } from '../Math/Vector3';

describe('WaterInteraction', () => {
  describe('构造与默认值', () => {
    it('默认参数正确', () => {
      const wi = new WaterInteraction();
      expect(wi.maxRipples).toBe(64);
      expect(wi.maxSplashes).toBe(32);
      expect(wi.interactionRadius).toBe(50);
      expect(wi.waveDamping).toBe(0.5);
      expect(wi.splashThreshold).toBe(2.0);
      expect(wi.foamDecay).toBe(1.0);
      expect(wi.defaultWavelength).toBe(1.5);
      expect(wi.defaultSpeed).toBe(2.0);
      expect(wi.defaultMaxAge).toBe(4.0);
      expect(wi.defaultSplashMaxAge).toBe(1.5);
      expect(wi.maxAmplitude).toBe(1.0);
    });

    it('应用构造选项', () => {
      const wi = new WaterInteraction({
        maxRipples: 8,
        maxSplashes: 4,
        interactionRadius: 20,
        waveDamping: 0.2,
        splashThreshold: 5,
        foamDecay: 0.5,
        defaultWavelength: 2.0,
        defaultSpeed: 3.0,
        defaultMaxAge: 6,
        defaultSplashMaxAge: 2,
        maxAmplitude: 0.5,
      });
      expect(wi.maxRipples).toBe(8);
      expect(wi.maxSplashes).toBe(4);
      expect(wi.interactionRadius).toBe(20);
      expect(wi.waveDamping).toBe(0.2);
      expect(wi.splashThreshold).toBe(5);
      expect(wi.foamDecay).toBe(0.5);
      expect(wi.defaultWavelength).toBe(2.0);
      expect(wi.defaultSpeed).toBe(3.0);
      expect(wi.defaultMaxAge).toBe(6);
      expect(wi.defaultSplashMaxAge).toBe(2);
      expect(wi.maxAmplitude).toBe(0.5);
    });

    it('参数钳制到非负', () => {
      const wi = new WaterInteraction({
        maxRipples: -1,
        maxSplashes: -1,
        interactionRadius: -1,
        waveDamping: -1,
        splashThreshold: -1,
        foamDecay: -1,
        defaultWavelength: -1,
        defaultSpeed: -1,
        defaultMaxAge: -1,
        defaultSplashMaxAge: -1,
        maxAmplitude: -1,
      });
      expect(wi.maxRipples).toBe(0);
      expect(wi.maxSplashes).toBe(0);
      expect(wi.interactionRadius).toBe(0);
      expect(wi.waveDamping).toBe(0);
      expect(wi.splashThreshold).toBe(0);
      expect(wi.foamDecay).toBe(0);
      expect(wi.defaultWavelength).toBeGreaterThan(0);
      expect(wi.defaultSpeed).toBe(0);
      expect(wi.defaultMaxAge).toBeGreaterThan(0);
      expect(wi.defaultSplashMaxAge).toBeGreaterThan(0);
      expect(wi.maxAmplitude).toBe(0);
    });
  });

  describe('addRipple', () => {
    it('添加涟漪并返回 id', () => {
      const wi = new WaterInteraction();
      const id = wi.addRipple({ x: 1, z: 2 }, 0.5);
      expect(id).toBeGreaterThan(0);
      expect(wi.getRippleCount()).toBe(1);
      const r = wi.getRipples()[0];
      expect(r.position).toEqual({ x: 1, z: 2 });
      expect(r.amplitude).toBe(0.5);
      expect(r.age).toBe(0);
      expect(r.damping).toBe(wi.waveDamping);
    });

    it('支持 Vector3 输入', () => {
      const wi = new WaterInteraction();
      const id = wi.addRipple(new Vector3(3, 99, 4), 0.2);
      expect(id).toBeGreaterThan(0);
      const r = wi.getRipples()[0];
      expect(r.position).toEqual({ x: 3, z: 4 });
    });

    it('零振幅返回 -1 不创建', () => {
      const wi = new WaterInteraction();
      const id = wi.addRipple({ x: 0, z: 0 }, 0);
      expect(id).toBe(-1);
      expect(wi.getRippleCount()).toBe(0);
    });

    it('负振幅被钳到 0 返回 -1', () => {
      const wi = new WaterInteraction();
      expect(wi.addRipple({ x: 0, z: 0 }, -1)).toBe(-1);
      expect(wi.getRippleCount()).toBe(0);
    });

    it('振幅超过 maxAmplitude 被钳制', () => {
      const wi = new WaterInteraction({ maxAmplitude: 0.3 });
      wi.addRipple({ x: 0, z: 0 }, 5);
      expect(wi.getRipples()[0].amplitude).toBe(0.3);
    });

    it('超过 maxRipples 淘汰最旧', () => {
      const wi = new WaterInteraction({ maxRipples: 2 });
      wi.addRipple({ x: 0, z: 0 }, 0.1);
      wi.update(0.1);
      wi.addRipple({ x: 1, z: 0 }, 0.1);
      wi.update(0.1);
      wi.addRipple({ x: 2, z: 0 }, 0.1);
      expect(wi.getRippleCount()).toBe(2);
      // 第一个 ripple 应被淘汰
      expect(wi.getRipples().find((r) => r.position.x === 0)).toBeUndefined();
    });

    it('自定义波长生效', () => {
      const wi = new WaterInteraction();
      wi.addRipple({ x: 0, z: 0 }, 0.1, 3.5);
      expect(wi.getRipples()[0].wavelength).toBe(3.5);
    });
  });

  describe('addSplash', () => {
    it('添加飞溅并返回 id', () => {
      const wi = new WaterInteraction();
      const pos = new Vector3(1, 0, 2);
      const vel = new Vector3(0, 5, 0);
      const id = wi.addSplash(pos, vel, 10);
      expect(id).toBeGreaterThan(0);
      expect(wi.getSplashCount()).toBe(1);
      const s = wi.getSplashes()[0];
      expect(s.position.equals(pos)).toBe(true);
      expect(s.velocity.equals(vel)).toBe(true);
      expect(s.particles).toBe(10);
    });

    it('零粒子返回 -1', () => {
      const wi = new WaterInteraction();
      expect(wi.addSplash(new Vector3(), new Vector3(), 0)).toBe(-1);
      expect(wi.getSplashCount()).toBe(0);
    });

    it('超过 maxSplashes 淘汰最旧', () => {
      const wi = new WaterInteraction({ maxSplashes: 1 });
      wi.addSplash(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 5);
      wi.update(0.1);
      wi.addSplash(new Vector3(1, 0, 0), new Vector3(0, 1, 0), 5);
      expect(wi.getSplashCount()).toBe(1);
      expect(wi.getSplashes()[0].position.x).toBe(1);
    });
  });

  describe('update', () => {
    it('推进涟漪年龄', () => {
      const wi = new WaterInteraction();
      wi.addRipple({ x: 0, z: 0 }, 0.1);
      wi.update(0.5);
      expect(wi.getRipples()[0].age).toBeCloseTo(0.5, 6);
    });

    it('涟漪超过寿命被移除', () => {
      const wi = new WaterInteraction({ defaultMaxAge: 1.0 });
      wi.addRipple({ x: 0, z: 0 }, 0.1);
      wi.update(1.5);
      expect(wi.getRippleCount()).toBe(0);
    });

    it('飞溅位置受重力下落', () => {
      const wi = new WaterInteraction();
      wi.addSplash(new Vector3(0, 5, 0), new Vector3(0, 5, 0), 10);
      wi.update(1.0);
      const s = wi.getSplashes()[0];
      // 显式 Euler: position += v_old * dt; velocity -= g * dt
      // y = 5 + 5*1 = 10, v_y = 5 - 9.81 = -4.81
      expect(s.position.y).toBeCloseTo(10, 4);
      expect(s.velocity.y).toBeCloseTo(5 - 9.81, 4);
    });

    it('飞溅粒子数随时间衰减', () => {
      const wi = new WaterInteraction({ defaultSplashMaxAge: 2.0 });
      wi.addSplash(new Vector3(), new Vector3(0, 1, 0), 100);
      wi.update(1.0); // lifeRatio = 0.5
      expect(wi.getSplashes()[0].particles).toBe(50);
    });

    it('飞溅超过寿命被移除', () => {
      const wi = new WaterInteraction({ defaultSplashMaxAge: 1.0 });
      wi.addSplash(new Vector3(), new Vector3(0, 1, 0), 5);
      wi.update(1.5);
      expect(wi.getSplashCount()).toBe(0);
    });

    it('负 dt 被钳到 0 不报错', () => {
      const wi = new WaterInteraction();
      wi.addRipple({ x: 0, z: 0 }, 0.1);
      expect(() => wi.update(-1)).not.toThrow();
      expect(wi.getRipples()[0].age).toBe(0);
    });

    it('update 链式返回 this', () => {
      const wi = new WaterInteraction();
      expect(wi.update(0.1)).toBe(wi);
    });
  });

  describe('computeRippleHeight', () => {
    it('涟漪中心在 t=0 时高度为 0 (sin(0)=0)', () => {
      const wi = new WaterInteraction();
      wi.addRipple({ x: 0, z: 0 }, 1.0, 1.0);
      const r = wi.getRipples()[0];
      // r=0, time=0 → phase=0, sin=0
      const h = wi.computeRippleHeight(r, 0, 0, 0);
      expect(h).toBeCloseTo(0, 6);
    });

    it('在波前位置附近贡献最大', () => {
      const wi = new WaterInteraction({ defaultSpeed: 2.0, defaultWavelength: 1.0, waveDamping: 0 });
      wi.addRipple({ x: 0, z: 0 }, 1.0);
      const r = wi.getRipples()[0];
      r.age = 1.0; // 波前 radius = speed * age = 2
      // 在波前位置 r=2 处, delta=0, envelope=1, lifeFactor=0.75, ageDecay=1
      // phase = k * 2 - omega * time = 2π/1 * 2 - 2π/1 * 2 * time = 4π - 4π*time
      // time=0 时 phase=4π, sin=0
      const h = wi.computeRippleHeight(r, 2, 0, 0);
      expect(h).toBeCloseTo(0, 6);
      // time=0.25 时 phase=4π-π=3π, sin=0; time=0.125 phase=4π-0.5π=3.5π sin=-1
      // 但 waveDamping=0 + ageDecay=1 + lifeFactor=0.75 → 振幅 * 0.75 * 1 * 1 = 0.75 * sin
      const h2 = wi.computeRippleHeight(r, 2, 0, 0.125);
      expect(Math.abs(h2)).toBeGreaterThan(0.5);
    });

    it('远离波前贡献衰减', () => {
      const wi = new WaterInteraction({ waveDamping: 0 });
      wi.addRipple({ x: 0, z: 0 }, 1.0, 1.0);
      const r = wi.getRipples()[0];
      r.age = 1.0; // 波前在 r=2
      const near = Math.abs(wi.computeRippleHeight(r, 2, 0, 0.5));
      const far = Math.abs(wi.computeRippleHeight(r, 100, 0, 0.5));
      expect(far).toBeLessThan(near);
      expect(far).toBeLessThan(1e-3);
    });

    it('age >= maxAge 返回 0', () => {
      const wi = new WaterInteraction({ defaultMaxAge: 1.0 });
      wi.addRipple({ x: 0, z: 0 }, 1.0);
      const r = wi.getRipples()[0];
      r.age = 1.5;
      expect(wi.computeRippleHeight(r, 0, 0, 0)).toBe(0);
    });
  });

  describe('sampleHeight / sampleNormal', () => {
    it('空涟漪时高度为 0', () => {
      const wi = new WaterInteraction();
      expect(wi.sampleHeight(0, 0, 0)).toBe(0);
    });

    it('叠加多个涟漪', () => {
      const wi = new WaterInteraction({ waveDamping: 0 });
      wi.addRipple({ x: 0, z: 0 }, 1.0, 1.0);
      wi.addRipple({ x: 0, z: 0 }, 0.5, 1.0);
      // 两个涟漪在波前附近同相位 → 高度应近似于单个 ripple 相加
      // 但波前位置相同, envelope=1, 应相加
      const r0 = wi.getRipples()[0];
      r0.age = 1.0;
      const r1 = wi.getRipples()[1];
      r1.age = 1.0;
      const hSingle0 = wi.computeRippleHeight(r0, 2, 0, 0.125);
      const hSingle1 = wi.computeRippleHeight(r1, 2, 0, 0.125);
      const hTotal = wi.sampleHeight(2, 0, 0.125);
      expect(hTotal).toBeCloseTo(hSingle0 + hSingle1, 5);
    });

    it('sampleNormal 返回归一化向量', () => {
      const wi = new WaterInteraction({ waveDamping: 0 });
      wi.addRipple({ x: 0, z: 0 }, 1.0, 1.0);
      const r = wi.getRipples()[0];
      r.age = 1.0;
      const n = wi.sampleNormal(2, 0, 0.125, 0.05);
      const len = Math.hypot(n.x, n.y, n.z);
      expect(len).toBeCloseTo(1, 4);
    });

    it('sampleNormal 平坦水面近似 (0,1,0)', () => {
      const wi = new WaterInteraction();
      const n = wi.sampleNormal(0, 0, 0);
      expect(n.x).toBeCloseTo(0, 4);
      expect(n.y).toBeCloseTo(1, 4);
      expect(n.z).toBeCloseTo(0, 4);
    });
  });

  describe('computeSplashForce', () => {
    it('反作用力方向与速度相反', () => {
      const wi = new WaterInteraction();
      const pos = new Vector3(0, 0, 0);
      const vel = new Vector3(0, 5, 0);
      wi.addSplash(pos, vel, 10);
      const f = wi.computeSplashForce(wi.getSplashes()[0]);
      expect(f.y).toBeLessThan(0);
      expect(Math.abs(f.y)).toBeCloseTo(5 * 10 * 0.01, 6);
    });

    it('返回新 Vector3 不修改原 splash', () => {
      const wi = new WaterInteraction();
      wi.addSplash(new Vector3(), new Vector3(1, 2, 3), 5);
      const s = wi.getSplashes()[0];
      const origVel = s.velocity.clone();
      wi.computeSplashForce(s);
      expect(s.velocity.equals(origVel)).toBe(true);
    });
  });

  describe('interact', () => {
    it('低速只生成涟漪不生成飞溅', () => {
      const wi = new WaterInteraction({ splashThreshold: 5 });
      const result = wi.interact(
        new Vector3(0, 0, 0),
        new Vector3(1, 0, 0),
        10,
      );
      expect(result.rippleId).toBeGreaterThan(0);
      expect(result.splashId).toBe(-1);
      expect(wi.getSplashCount()).toBe(0);
      expect(wi.getRippleCount()).toBe(1);
    });

    it('高速生成涟漪 + 飞溅', () => {
      const wi = new WaterInteraction({ splashThreshold: 2 });
      const result = wi.interact(
        new Vector3(0, 0, 0),
        new Vector3(10, 0, 0),
        10,
      );
      expect(result.rippleId).toBeGreaterThan(0);
      expect(result.splashId).toBeGreaterThan(0);
      expect(wi.getSplashCount()).toBe(1);
    });

    it('超出交互半径不生成', () => {
      const wi = new WaterInteraction({ interactionRadius: 5 });
      const result = wi.interact(
        new Vector3(100, 0, 0),
        new Vector3(0, 10, 0),
        10,
      );
      expect(result.rippleId).toBe(-1);
      expect(result.splashId).toBe(-1);
    });

    it('涟漪振幅随动量缩放并钳制', () => {
      const wi = new WaterInteraction({ maxAmplitude: 0.5, splashThreshold: 100 });
      wi.interact(new Vector3(0, 0, 0), new Vector3(1, 0, 0), 1);
      const amp1 = wi.getRipples()[0].amplitude;
      wi.clear();
      wi.interact(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 100);
      const amp2 = wi.getRipples()[0].amplitude;
      expect(amp2).toBeGreaterThan(amp1);
      expect(amp2).toBeLessThanOrEqual(0.5);
    });

    it('零速度不生成涟漪', () => {
      const wi = new WaterInteraction();
      const result = wi.interact(new Vector3(0, 0, 0), new Vector3(0, 0, 0), 10);
      expect(result.rippleId).toBe(-1);
      expect(result.splashId).toBe(-1);
    });
  });

  describe('setter', () => {
    it('setInteractionRadius', () => {
      const wi = new WaterInteraction();
      expect(wi.setInteractionRadius(100).interactionRadius).toBe(100);
      expect(wi.setInteractionRadius(-1).interactionRadius).toBe(0);
    });

    it('setWaveDamping', () => {
      const wi = new WaterInteraction();
      expect(wi.setWaveDamping(1.5).waveDamping).toBe(1.5);
    });

    it('setSplashThreshold', () => {
      const wi = new WaterInteraction();
      expect(wi.setSplashThreshold(5).splashThreshold).toBe(5);
    });

    it('setFoamDecay', () => {
      const wi = new WaterInteraction();
      expect(wi.setFoamDecay(0.5).foamDecay).toBe(0.5);
    });
  });

  describe('clear / getStats', () => {
    beforeEach(() => {
      // noop 占位 (测试结构清晰)
    });

    it('clear 清空所有涟漪与飞溅', () => {
      const wi = new WaterInteraction();
      wi.addRipple({ x: 0, z: 0 }, 0.1);
      wi.addSplash(new Vector3(), new Vector3(0, 1, 0), 5);
      wi.clear();
      expect(wi.getRippleCount()).toBe(0);
      expect(wi.getSplashCount()).toBe(0);
    });

    it('getStats 返回累计创建数', () => {
      const wi = new WaterInteraction();
      wi.addRipple({ x: 0, z: 0 }, 0.1);
      wi.addRipple({ x: 1, z: 0 }, 0.1);
      wi.addSplash(new Vector3(), new Vector3(0, 1, 0), 5);
      const s = wi.getStats();
      expect(s.rippleCount).toBe(2);
      expect(s.splashCount).toBe(1);
      expect(s.totalRipplesCreated).toBe(2);
      expect(s.totalSplashesCreated).toBe(1);
    });

    it('getStats 包含时间字段', () => {
      const wi = new WaterInteraction();
      wi.update(0.5);
      expect(wi.getStats().time).toBeCloseTo(0.5, 6);
    });
  });
});
