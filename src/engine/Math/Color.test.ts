import { describe, it, expect, vi } from 'vitest';
import { Color, type HSL } from './Color';
import { Matrix3 } from './Matrix3';
import { BufferAttribute } from '../Core/BufferAttribute';

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

  describe('setStyle', () => {
    it('#rrggbb hex', () => {
      const c = new Color().setStyle('#ff8800');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0x88 / 255, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('#rgb short hex', () => {
      const c = new Color().setStyle('#f0f');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });

    it('rgb(255,0,0)', () => {
      const c = new Color().setStyle('rgb(255,0,0)');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('rgb with whitespace and 3-digit ints', () => {
      const c = new Color().setStyle('rgb(  0 , 128 , 255 )');
      expect(c.r).toBeCloseTo(0, 10);
      expect(c.g).toBeCloseTo(128 / 255, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });

    it('rgb with percentages', () => {
      const c = new Color().setStyle('rgb(100%,0%,50%)');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0.5, 10);
    });

    it('rgba with alpha 1 is accepted silently', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = new Color().setStyle('rgba(255,0,0,1)');
      expect(c.r).toBeCloseTo(1, 10);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('rgba with alpha != 1 warns that alpha is ignored', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = new Color().setStyle('rgba(255,0,0,0.5)');
      expect(c.r).toBeCloseTo(1, 10);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('alpha (0.5) is ignored for rgb/rgba'),
      );
      warn.mockRestore();
    });

    it('hsl(120,100%,50%) → green', () => {
      const c = new Color().setStyle('hsl(120,100%,50%)');
      expect(c.r).toBeCloseTo(0, 10);
      expect(c.g).toBeCloseTo(1, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('hsl with float hue and fractional values', () => {
      const c = new Color().setStyle('hsl(120, 50%, 25%)');
      const ref = new Color().setHSL(120 / 360, 0.5, 0.25);
      expect(c.r).toBeCloseTo(ref.r, 10);
      expect(c.g).toBeCloseTo(ref.g, 10);
      expect(c.b).toBeCloseTo(ref.b, 10);
    });

    it('hsla with alpha 1 is accepted silently', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = new Color().setStyle('hsla(0,100%,50%,1)');
      expect(c.r).toBeCloseTo(1, 10);
      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });

    it('unknown color model warns and returns this', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = new Color(1, 1, 1);
      const ret = c.setStyle('cmyk(0,1,0,0)');
      expect(ret).toBe(c);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown color model'));
      warn.mockRestore();
    });

    it('invalid hex length warns', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      new Color().setStyle('#12345');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('invalid hex color'));
      warn.mockRestore();
    });
  });

  describe('setColorName', () => {
    it('lowercase X11 name', () => {
      const c = new Color().setColorName('red');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('case-insensitive', () => {
      const c = new Color().setColorName('ReD');
      expect(c.r).toBeCloseTo(1, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('black', () => {
      const c = new Color().setColorName('black');
      expect(c.r).toBeCloseTo(0, 10);
      expect(c.g).toBeCloseTo(0, 10);
      expect(c.b).toBeCloseTo(0, 10);
    });

    it('unknown name warns and leaves color unchanged', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const c = new Color(0.1, 0.2, 0.3);
      c.setColorName('notacolor');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unknown color'));
      expect(c.r).toBeCloseTo(0.1, 10);
      warn.mockRestore();
    });

    it('set(string) routes through setStyle for color names', () => {
      const c = new Color().set('blue');
      expect(c.b).toBeCloseTo(1, 10);
      expect(c.r).toBeCloseTo(0, 10);
    });
  });

  describe('Color.NAMES', () => {
    it('is a populated static lookup table', () => {
      expect(typeof Color.NAMES).toBe('object');
      expect(Color.NAMES).not.toBeNull();
      expect(Color.NAMES.red).toBe(0xff0000);
      expect(Color.NAMES.white).toBe(0xffffff);
      expect(Color.NAMES.yellowgreen).toBe(0x9acd32);
    });

    it('contains the X11 keyword count used by three.js', () => {
      expect(Object.keys(Color.NAMES).length).toBeGreaterThanOrEqual(140);
    });
  });

  describe('getRGB', () => {
    it('writes channels into target and returns it', () => {
      const src = new Color(0.1, 0.2, 0.3);
      const target = new Color(1, 1, 1);
      const ret = src.getRGB(target);
      expect(ret).toBe(target);
      expect(target.r).toBeCloseTo(0.1, 10);
      expect(target.g).toBeCloseTo(0.2, 10);
      expect(target.b).toBeCloseTo(0.3, 10);
      // source unchanged
      expect(src.r).toBeCloseTo(0.1, 10);
    });
  });

  describe('getStyle', () => {
    it('formats as rgb() with rounded 0..255 channels', () => {
      expect(new Color(1, 0, 0).getStyle()).toBe('rgb(255,0,0)');
      expect(new Color(0, 0, 1).getStyle()).toBe('rgb(0,0,255)');
    });

    it('rounds fractional channels', () => {
      const c = new Color(0.5, 0.25, 0.75);
      expect(c.getStyle()).toBe('rgb(128,64,191)');
    });
  });

  describe('offsetHSL', () => {
    it('offsets h/s/l', () => {
      // red (0,1,0.5) → offset h +0.5 → cyan (0.5,1,0.5)
      const c = new Color(1, 0, 0).offsetHSL(0.5, 0, 0);
      const ref = new Color().setHSL(0.5, 1, 0.5);
      expect(c.r).toBeCloseTo(ref.r, 10);
      expect(c.g).toBeCloseTo(ref.g, 10);
      expect(c.b).toBeCloseTo(ref.b, 10);
    });

    it('returns this and mutates in place', () => {
      const c = new Color(1, 0, 0);
      const ret = c.offsetHSL(0.25, 0, 0);
      expect(ret).toBe(c);
    });
  });

  describe('sub', () => {
    it('subtracts component-wise', () => {
      const c = new Color(0.7, 0.6, 0.5).sub(new Color(0.2, 0.4, 0.1));
      expect(c.r).toBeCloseTo(0.5, 10);
      expect(c.g).toBeCloseTo(0.2, 10);
      expect(c.b).toBeCloseTo(0.4, 10);
    });

    it('clamps at zero (three.js semantics)', () => {
      const c = new Color(0.2, 0.2, 0.2).sub(new Color(0.9, 0.5, 0.3));
      expect(c.r).toBe(0);
      expect(c.g).toBe(0);
      expect(c.b).toBe(0);
    });
  });

  describe('lerpHSL', () => {
    it('alpha=0 keeps source, alpha=1 reaches target', () => {
      const a = new Color(1, 0, 0); // red
      const b = new Color(0, 1, 0); // green
      const at0 = a.clone().lerpHSL(b, 0);
      expect(at0.r).toBeCloseTo(1, 10);
      const at1 = a.clone().lerpHSL(b, 1);
      expect(at1.r).toBeCloseTo(0, 10);
      expect(at1.g).toBeCloseTo(1, 10);
    });

    it('alpha=0.5 crosses through yellow (hue midpoint, saturated)', () => {
      const c = new Color(1, 0, 0).lerpHSL(new Color(0, 1, 0), 0.5);
      // red h=0, green h=1/3 → mid h=1/6, s=1, l=0.5 → yellow
      const ref = new Color().setHSL(1 / 6, 1, 0.5);
      expect(c.r).toBeCloseTo(ref.r, 10);
      expect(c.g).toBeCloseTo(ref.g, 10);
      expect(c.b).toBeCloseTo(ref.b, 10);
    });

    it('returns this', () => {
      const a = new Color(1, 0, 0);
      const ret = a.lerpHSL(new Color(0, 1, 0), 0.5);
      expect(ret).toBe(a);
    });
  });

  describe('setFromVector3', () => {
    it('sets r/g/b from x/y/z', () => {
      const c = new Color().setFromVector3({ x: 0.1, y: 0.2, z: 0.3 });
      expect(c.r).toBeCloseTo(0.1, 10);
      expect(c.g).toBeCloseTo(0.2, 10);
      expect(c.b).toBeCloseTo(0.3, 10);
    });
  });

  describe('applyMatrix3', () => {
    it('applies a diagonal scale matrix', () => {
      // diagonal (1,1,2): r→r, g→g, b→2b
      const m = new Matrix3().set(1, 0, 0, 0, 1, 0, 0, 0, 2);
      const c = new Color(0.5, 0.25, 0.1).applyMatrix3(m);
      expect(c.r).toBeCloseTo(0.5, 10);
      expect(c.g).toBeCloseTo(0.25, 10);
      expect(c.b).toBeCloseTo(0.2, 10);
    });

    it('mixes channels via off-diagonal elements', () => {
      // row1: e[1]=1 (g adds to r), row2: e[5]=1 (b adds to g)
      const m = new Matrix3().set(1, 1, 0, 0, 1, 1, 0, 0, 1);
      const c = new Color(1, 1, 1).applyMatrix3(m);
      expect(c.r).toBeCloseTo(2, 10);
      expect(c.g).toBeCloseTo(2, 10);
      expect(c.b).toBeCloseTo(1, 10);
    });
  });

  describe('fromBufferAttribute', () => {
    it('reads x/y/z from attribute at index', () => {
      const attr = new BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6]), 3);
      const c = new Color().fromBufferAttribute(attr, 1);
      expect(c.r).toBeCloseTo(4, 10);
      expect(c.g).toBeCloseTo(5, 10);
      expect(c.b).toBeCloseTo(6, 10);
    });

    it('works with non-zero itemSize strides', () => {
      const attr = new BufferAttribute(new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]), 4);
      const c = new Color().fromBufferAttribute(attr, 1);
      expect(c.r).toBeCloseTo(5, 10);
      expect(c.g).toBeCloseTo(6, 10);
      expect(c.b).toBeCloseTo(7, 10);
    });
  });
});
