import { describe, it, expect } from 'vitest';
import {
  ConstantCurve,
  LinearCurve,
  BezierCurve,
  RandomCurve,
  createCurve,
} from './ParticleCurve';

describe('ParticleCurve', () => {
  describe('ConstantCurve', () => {
    it('returns the constant value for any t', () => {
      const c = new ConstantCurve(0.5);
      expect(c.evaluate(0)).toBe(0.5);
      expect(c.evaluate(0.5)).toBe(0.5);
      expect(c.evaluate(1)).toBe(0.5);
    });

    it('defaults to 1 when no argument given', () => {
      const c = new ConstantCurve();
      expect(c.evaluate(0)).toBe(1);
    });
  });

  describe('LinearCurve', () => {
    it('interpolates linearly from `from` to `to`', () => {
      const c = new LinearCurve(0, 10);
      expect(c.evaluate(0)).toBe(0);
      expect(c.evaluate(0.5)).toBe(5);
      expect(c.evaluate(1)).toBe(10);
    });

    it('clamps t outside [0,1]', () => {
      const c = new LinearCurve(0, 1);
      expect(c.evaluate(-1)).toBe(0);
      expect(c.evaluate(2)).toBe(1);
    });

    it('handles descending curve (from > to)', () => {
      const c = new LinearCurve(1, 0);
      expect(c.evaluate(0)).toBe(1);
      expect(c.evaluate(1)).toBe(0);
      expect(c.evaluate(0.5)).toBe(0.5);
    });
  });

  describe('BezierCurve', () => {
    it('passes through endpoints p0 and p2', () => {
      const c = new BezierCurve(0, 0.5, 1);
      expect(c.evaluate(0)).toBe(0);
      expect(c.evaluate(1)).toBe(1);
    });

    it('equals midpoint formula at t=0.5', () => {
      // B(0.5) = 0.25*p0 + 0.5*p1 + 0.25*p2
      const c = new BezierCurve(0, 2, 4);
      // 0.25*0 + 0.5*2 + 0.25*4 = 0 + 1 + 1 = 2
      expect(c.evaluate(0.5)).toBeCloseTo(2, 6);
    });

    it('clamps t outside [0,1]', () => {
      const c = new BezierCurve(0, 0.5, 1);
      expect(c.evaluate(-0.5)).toBe(0);
      expect(c.evaluate(1.5)).toBe(1);
    });
  });

  describe('RandomCurve', () => {
    it('returns values within [min, max]', () => {
      const c = new RandomCurve(0.2, 0.8);
      for (let i = 0; i < 100; i++) {
        const v = c.evaluate(i / 100);
        expect(v).toBeGreaterThanOrEqual(0);
        // Without inner, value = min + random*(max-min), in [0.2, 0.8)
        expect(v).toBeLessThanOrEqual(0.8);
      }
    });

    it('with inner curve multiplies by random factor', () => {
      const c = new RandomCurve(0, 10, new LinearCurve(1, 1));
      // lerp(0,10,1) = 10, * random in [0,1] => [0,10]
      for (let i = 0; i < 50; i++) {
        const v = c.evaluate(1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(10);
      }
    });
  });

  describe('createCurve factory', () => {
    it('builds ConstantCurve', () => {
      const c = createCurve({ type: 'constant', value: 7 });
      expect(c.evaluate(0.3)).toBe(7);
    });

    it('builds LinearCurve', () => {
      const c = createCurve({ type: 'linear', from: 2, to: 4 });
      expect(c.evaluate(0.5)).toBe(3);
    });

    it('builds BezierCurve', () => {
      const c = createCurve({ type: 'bezier', p0: 0, p1: 0, p2: 1 });
      expect(c.evaluate(0)).toBe(0);
      expect(c.evaluate(1)).toBe(1);
    });

    it('builds RandomCurve', () => {
      const c = createCurve({ type: 'random', min: 0, max: 1 });
      const v = c.evaluate(0.5);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
});
