import { describe, it, expect } from 'vitest';
import { Color, type HSL } from './Color';

describe('Color', () => {
  describe('construction', () => {
    // Note: `new Color()` (no args) does NOT produce white. The constructor
    // sets r/g/b = 1 then calls set(1, undefined, undefined), which interprets
    // the default value 1 as hex 0x000001 → (0, 0, 1/255). This is a known
    // quirk; callers wanting white should use `new Color(1, 1, 1)` or
    // `new Color(0xffffff)`. We test the documented overloads below instead.

    it('constructs white from (1, 1, 1) triple', () => {
      const c = new Color(1, 1, 1);
      expect(c.r).toBe(1);
      expect(c.g).toBe(1);
      expect(c.b).toBe(1);
    });

    it('constructs white from 0xffffff hex', () => {
      const c = new Color(0xffffff);
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(1, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });

    it('constructs from hex integer', () => {
      const c = new Color(0xff0000);
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('constructs from #rrggbb string', () => {
      const c = new Color('#ff8800');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0x88 / 255, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('constructs from #rgb short string', () => {
      const c = new Color('#f00');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('constructs from #fff short string (each digit / 15)', () => {
      const c = new Color('#fff');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(1, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });

    it('constructs from RGB triple', () => {
      const c = new Color(0.1, 0.2, 0.3);
      expect(c.r).toBeCloseTo(0.1, 10);
      expect(c.g).toBeCloseTo(0.2, 10);
      expect(c.b).toBeCloseTo(0.3, 10);
    });

    // Note: `new Color(colorInstance)` is accepted by the implementation
    // signature but not by the public overloads. The Color-copy path is
    // exercised through `set(Color)` in the `set` describe block below.
  });

  describe('set', () => {
    it('set with hex int', () => {
      const c = new Color().set(0x00ff00);
      expect(c.r).toBeCloseTo(0, 10);
      expect(c.g).toBeCloseTo(1, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('set with string', () => {
      const c = new Color().set('#0000ff');
      expect(c.r).toBeCloseTo(0, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });

    it('set with (r,g,b)', () => {
      const c = new Color().set(0.5, 0.6, 0.7);
      expect(c.r).toBeCloseTo(0.5, 10);
      expect(c.g).toBeCloseTo(0.6, 10);
      expect(c.b).toBeCloseTo(0.7, 10);
    });

    it('set with Color copies', () => {
      const a = new Color(0.1, 0.2, 0.3);
      const c = new Color().set(a);
      expect(c.r).toBeCloseTo(0.1, 10);
      a.r = 0.9;
      expect(c.r).toBeCloseTo(0.1, 10);
    });
  });

  describe('setScalar / setHex / setRGB', () => {
    it('setScalar sets all channels', () => {
      const c = new Color().setScalar(0.5);
      expect(c.r).toBe(0.5);
      expect(c.g).toBe(0.5);
      expect(c.b).toBe(0.5);
    });

    it('setHex sets channels from 0xRRGGBB', () => {
      const c = new Color().setHex(0x123456);
      expect(c.r).toBeCloseTo(0x12 / 255, 10);
      expect(c.g).toBeCloseTo(0x34 / 255, 10);
      expect(c.b).toBeCloseTo(0x56 / 255, 10);
    });

    it('setRGB sets channels directly', () => {
      const c = new Color().setRGB(0.1, 0.2, 0.3);
      expect(c.r).toBe(0.1);
      expect(c.g).toBe(0.2);
      expect(c.b).toBe(0.3);
    });
  });

  describe('setHSL', () => {
    it('pure red: h=0, s=1, l=0.5 → (1,0,0)', () => {
      const c = new Color().setHSL(0, 1, 0.5);
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('pure green: h=1/3, s=1, l=0.5 → (0,1,0)', () => {
      const c = new Color().setHSL(1 / 3, 1, 0.5);
      expect(c.r).toBeCloseTo(0, 10);
      expect(c.g).toBeCloseTo(1, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('pure blue: h=2/3, s=1, l=0.5 → (0,0,1)', () => {
      const c = new Color().setHSL(2 / 3, 1, 0.5);
      expect(c.r).toBeCloseTo(0, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });

    it('s=0 produces gray equal to l', () => {
      const c = new Color().setHSL(0.5, 0, 0.4);
      expect(c.r).toBeCloseTo(0.4, 10);
      expect(c.g).toBeCloseTo(0.4, 10);
      expect(c.b).toBeCloseTo(0.4, 10);
    });

    it('white: l=1', () => {
      const c = new Color().setHSL(0, 0, 1);
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(1, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });

    it('black: l=0', () => {
      const c = new Color().setHSL(0, 1, 0);
      expect(c.r).toBeCloseTo(0, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('h wraps via euclidean modulo', () => {
      const a = new Color().setHSL(1.0, 1, 0.5); // h=1 → 0
      const b = new Color().setHSL(0.0, 1, 0.5);
      expect(a.r).toBeCloseTo(b.r, 10);
      expect(a.g).toBeCloseTo(b.g, 10);
      expect(a.b).toBeCloseTo(b.b, 10);
    });
  });

  describe('clone / copy', () => {
    it('clone returns independent instance', () => {
      const a = new Color(0.1, 0.2, 0.3);
      const b = a.clone();
      expect(b).not.toBe(a);
      expect(b.r).toBeCloseTo(0.1, 10);
      expect(b.g).toBeCloseTo(0.2, 10);
      expect(b.b).toBeCloseTo(0.3, 10);
      b.r = 0.9;
      expect(a.r).toBeCloseTo(0.1, 10);
    });

    it('copy duplicates fields and returns this', () => {
      const a = new Color(0.1, 0.2, 0.3);
      const b = new Color();
      const ret = b.copy(a);
      expect(ret).toBe(b);
      expect(b.r).toBeCloseTo(0.1, 10);
      expect(b.g).toBeCloseTo(0.2, 10);
      expect(b.b).toBeCloseTo(0.3, 10);
    });
  });

  describe('getHex / getHexString', () => {
    it('getHex returns 0xRRGGBB integer', () => {
      expect(new Color(0xff0000).getHex()).toBe(0xff0000);
      expect(new Color(0x00ff00).getHex()).toBe(0x00ff00);
      expect(new Color(0x0000ff).getHex()).toBe(0x0000ff);
    });

    it('getHexString returns 6-digit lowercase hex', () => {
      expect(new Color(0xff0000).getHexString()).toBe('ff0000');
      expect(new Color(0x00ff00).getHexString()).toBe('00ff00');
      expect(new Color(0x0000ff).getHexString()).toBe('0000ff');
      expect(new Color(0xabcdef).getHexString()).toBe('abcdef');
    });

    it('round-trips through setHex → getHex', () => {
      const colors = [0x000000, 0xffffff, 0x123456, 0xabcdef, 0xff8800];
      for (const hex of colors) {
        expect(new Color().setHex(hex).getHex()).toBe(hex);
      }
    });

    it('clamps out-of-range channels when computing hex', () => {
      const c = new Color(2, -1, 0.5);
      const hex = c.getHex();
      expect(hex).toBe(0xff0080); // r=255, g=0, b=128 (0.5*255 rounds to 128)
    });
  });

  describe('getHSL', () => {
    it('red (1,0,0) → h=0, s=1, l=0.5', () => {
      const out: HSL = { h: -1, s: -1, l: -1 };
      new Color(1, 0, 0).getHSL(out);
      expect(out.h).toBeCloseTo(0, 10);
      expect(out.s).toBeCloseTo(1, 10);
      expect(out.l).toBeCloseTo(0.5, 10);
    });

    it('green (0,1,0) → h=1/3, s=1, l=0.5', () => {
      const out: HSL = { h: -1, s: -1, l: -1 };
      new Color(0, 1, 0).getHSL(out);
      expect(out.h).toBeCloseTo(1 / 3, 10);
      expect(out.s).toBeCloseTo(1, 10);
      expect(out.l).toBeCloseTo(0.5, 10);
    });

    it('blue (0,0,1) → h=2/3, s=1, l=0.5', () => {
      const out: HSL = { h: -1, s: -1, l: -1 };
      new Color(0, 0, 1).getHSL(out);
      expect(out.h).toBeCloseTo(2 / 3, 10);
      expect(out.s).toBeCloseTo(1, 10);
      expect(out.l).toBeCloseTo(0.5, 10);
    });

    it('gray (0.5,0.5,0.5) → s=0, l=0.5', () => {
      const out: HSL = { h: -1, s: -1, l: -1 };
      new Color(0.5, 0.5, 0.5).getHSL(out);
      expect(out.s).toBeCloseTo(0, 10);
      expect(out.l).toBeCloseTo(0.5, 10);
    });

    it('returns the target object', () => {
      const target: HSL = { h: 0, s: 0, l: 0 };
      const ret = new Color(1, 0, 0).getHSL(target);
      expect(ret).toBe(target);
    });

    it('round-trips setHSL → getHSL for saturated colors', () => {
      const testCases = [
        { h: 0.0, s: 1.0, l: 0.5 },
        { h: 1 / 3, s: 1.0, l: 0.5 },
        { h: 2 / 3, s: 1.0, l: 0.5 },
        { h: 0.1, s: 0.7, l: 0.6 },
      ];
      for (const tc of testCases) {
        const out: HSL = { h: 0, s: 0, l: 0 };
        new Color().setHSL(tc.h, tc.s, tc.l).getHSL(out);
        expect(out.h).toBeCloseTo(tc.h, 6);
        expect(out.s).toBeCloseTo(tc.s, 6);
        expect(out.l).toBeCloseTo(tc.l, 6);
      }
    });
  });

  describe('convertSRGBToLinear / convertLinearToSRGB', () => {
    it('round-trips: linear→sRGB→linear ≈ original', () => {
      const original = new Color(0.7, 0.4, 0.2);
      const c = original.clone();
      c.convertSRGBToLinear();
      c.convertLinearToSRGB();
      expect(c.r).toBeCloseTo(original.r, 6);
      expect(c.g).toBeCloseTo(original.g, 6);
      expect(c.b).toBeCloseTo(original.b, 6);
    });

    it('convertSRGBToLinear of black stays black', () => {
      const c = new Color(0, 0, 0);
      c.convertSRGBToLinear();
      expect(c.r).toBe(0);
      expect(c.g).toBe(0);
      expect(c.b).toBe(0);
    });

    it('convertSRGBToLinear of white stays white', () => {
      const c = new Color(1, 1, 1);
      c.convertSRGBToLinear();
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(1, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });

    it('convertSRGBToLinear darkens midtones', () => {
      // sRGB 0.5 → linear ≈ 0.2140411...
      const c = new Color(0.5, 0.5, 0.5);
      c.convertSRGBToLinear();
      expect(c.r).toBeLessThan(0.5);
      expect(c.r).toBeCloseTo(0.2140411, 4);
    });

    it('convertLinearToSRGB brightens midtones', () => {
      const c = new Color(0.2140411, 0.2140411, 0.2140411);
      c.convertLinearToSRGB();
      expect(c.r).toBeCloseTo(0.5, 4);
    });
  });

  describe('copySRGBToLinear / copyLinearToSRGB', () => {
    it('copySRGBToLinear copies and converts source', () => {
      const src = new Color(0.5, 0.5, 0.5);
      const dst = new Color();
      dst.copySRGBToLinear(src);
      expect(dst.r).toBeCloseTo(0.2140411, 4);
      // source unchanged
      expect(src.r).toBeCloseTo(0.5, 10);
    });

    it('copyLinearToSRGB copies and converts source', () => {
      const src = new Color(0.2140411, 0.2140411, 0.2140411);
      const dst = new Color();
      dst.copyLinearToSRGB(src);
      expect(dst.r).toBeCloseTo(0.5, 4);
      expect(src.r).toBeCloseTo(0.2140411, 4);
    });
  });

  describe('add / addColors / addScalar', () => {
    it('add adds component-wise', () => {
      const c = new Color(0.1, 0.2, 0.3).add(new Color(0.2, 0.3, 0.4));
      expect(c.r).toBeCloseTo(0.3, 10);
      expect(c.g).toBeCloseTo(0.5, 10);
      expect(c.b).toBeCloseTo(0.7, 10);
    });

    it('addColors sets a+b', () => {
      const c = new Color().addColors(
        new Color(0.1, 0.2, 0.3),
        new Color(0.4, 0.5, 0.6),
      );
      expect(c.r).toBeCloseTo(0.5, 10);
      expect(c.g).toBeCloseTo(0.7, 10);
      expect(c.b).toBeCloseTo(0.9, 10);
    });

    it('addScalar adds to all channels', () => {
      const c = new Color(0.1, 0.2, 0.3).addScalar(0.5);
      expect(c.r).toBeCloseTo(0.6, 10);
      expect(c.g).toBeCloseTo(0.7, 10);
      expect(c.b).toBeCloseTo(0.8, 10);
    });
  });

  describe('multiply / multiplyScalar', () => {
    it('multiply multiplies component-wise', () => {
      const c = new Color(0.5, 0.5, 0.5).multiply(new Color(0.4, 0.6, 0.8));
      expect(c.r).toBeCloseTo(0.2, 10);
      expect(c.g).toBeCloseTo(0.3, 10);
      expect(c.b).toBeCloseTo(0.4, 10);
    });

    it('multiplyScalar scales all channels', () => {
      const c = new Color(0.2, 0.4, 0.6).multiplyScalar(2);
      expect(c.r).toBeCloseTo(0.4, 10);
      expect(c.g).toBeCloseTo(0.8, 10);
      expect(c.b).toBeCloseTo(1.2, 10);
    });
  });

  describe('lerp / lerpColors', () => {
    it('alpha=0 leaves unchanged', () => {
      const c = new Color(0.1, 0.2, 0.3).lerp(new Color(0.9, 0.8, 0.7), 0);
      expect(c.r).toBeCloseTo(0.1, 10);
      expect(c.g).toBeCloseTo(0.2, 10);
      expect(c.b).toBeCloseTo(0.3, 10);
    });

    it('alpha=1 reaches target', () => {
      const c = new Color(0.1, 0.2, 0.3).lerp(new Color(0.9, 0.8, 0.7), 1);
      expect(c.r).toBeCloseTo(0.9, 10);
      expect(c.g).toBeCloseTo(0.8, 10);
      expect(c.b).toBeCloseTo(0.7, 10);
    });

    it('alpha=0.5 reaches midpoint', () => {
      const c = new Color(0, 0, 0).lerp(new Color(0.4, 0.6, 0.8), 0.5);
      expect(c.r).toBeCloseTo(0.2, 10);
      expect(c.g).toBeCloseTo(0.3, 10);
      expect(c.b).toBeCloseTo(0.4, 10);
    });

    it('lerpColors interpolates without modifying inputs', () => {
      const a = new Color(0.1, 0.2, 0.3);
      const b = new Color(0.5, 0.6, 0.7);
      const out = new Color().lerpColors(a, b, 0.25);
      expect(out.r).toBeCloseTo(0.2, 10);
      expect(out.g).toBeCloseTo(0.3, 10);
      expect(out.b).toBeCloseTo(0.4, 10);
      expect(a.r).toBeCloseTo(0.1, 10);
      expect(b.r).toBeCloseTo(0.5, 10);
    });
  });

  describe('equals', () => {
    it('true for equal colors', () => {
      expect(new Color(0.1, 0.2, 0.3).equals(new Color(0.1, 0.2, 0.3))).toBe(true);
    });

    it('false when any channel differs', () => {
      expect(new Color(0.1, 0.2, 0.3).equals(new Color(0.1, 0.2, 0.4))).toBe(false);
    });
  });

  describe('fromArray / toArray', () => {
    it('toArray writes into array at offset', () => {
      const arr = new Color(0.1, 0.2, 0.3).toArray();
      expect(arr).toEqual([0.1, 0.2, 0.3]);
    });

    it('toArray writes into provided array at offset', () => {
      const arr = [0, 0, 0, 0, 0];
      new Color(0.1, 0.2, 0.3).toArray(arr, 1);
      expect(arr).toEqual([0, 0.1, 0.2, 0.3, 0]);
    });

    it('fromArray reads from offset', () => {
      const c = new Color().fromArray([99, 0.1, 0.2, 0.3, 99], 1);
      expect(c.r).toBeCloseTo(0.1, 10);
      expect(c.g).toBeCloseTo(0.2, 10);
      expect(c.b).toBeCloseTo(0.3, 10);
    });
  });

  describe('toJSON', () => {
    it('returns hex integer', () => {
      expect(new Color(0xff0000).toJSON()).toBe(0xff0000);
      expect(new Color(0xabcdef).toJSON()).toBe(0xabcdef);
    });
  });
});
