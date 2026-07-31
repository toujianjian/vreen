// RoomEnvironment 单元测试。
//
// 覆盖:
//   1. 构造默认值(size=256 / wallColor=0.5 / floorColor=0.3 / ceilingColor=0.8 / lightIntensity=3.0)
//   2. 自定义选项被尊重
//   3. generate() 返回 6 个面
//   4. 每个面尺寸正确 (size × size × 3)
//   5. 天花板面 (+y) 至少有一个像素比 ceilingColor 亮(light strip)
//   6. 地板面 (-y) 全部像素接近 floorColor
//   7. 墙面以 wallColor 为基底
//   8. HDR 值可超过 1.0(lightIntensity > 1)
//   9. size=16 最小值可用,小于 16 被钳制到 16
//  10. 面名为 '+x', '-x', '+y', '-y', '+z', '-z'

import { describe, it, expect } from 'vitest';
import {
  RoomEnvironment,
  type EnvironmentCubeData,
  type CubeFaceData,
} from './RoomEnvironment';

const FACE_NAMES = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;

/** 取一个面的第 (x, y) 个像素的 RGB(行优先,原点在左下)。 */
function px(face: CubeFaceData, x: number, y: number): [number, number, number] {
  const i = (y * face.width + x) * 3;
  return [face.data[i], face.data[i + 1], face.data[i + 2]];
}

function maxComponent(face: CubeFaceData): number {
  let m = 0;
  for (let i = 0; i < face.data.length; i++) {
    if (face.data[i] > m) m = face.data[i];
  }
  return m;
}

describe('RoomEnvironment', () => {
  describe('constructor defaults', () => {
    it('uses default size=256 and default colors', () => {
      const env = new RoomEnvironment();
      expect(env.size).toBe(256);
      expect(env.wallColor).toEqual([0.5, 0.5, 0.5]);
      expect(env.floorColor).toEqual([0.3, 0.3, 0.3]);
      expect(env.ceilingColor).toEqual([0.8, 0.8, 0.8]);
      expect(env.lightIntensity).toBe(3.0);
    });

    it('honors custom options', () => {
      const env = new RoomEnvironment({
        size: 64,
        wallColor: [0.4, 0.5, 0.6],
        floorColor: [0.1, 0.2, 0.3],
        ceilingColor: [0.9, 0.9, 1.0],
        lightIntensity: 5.5,
      });
      expect(env.size).toBe(64);
      expect(env.wallColor).toEqual([0.4, 0.5, 0.6]);
      expect(env.floorColor).toEqual([0.1, 0.2, 0.3]);
      expect(env.ceilingColor).toEqual([0.9, 0.9, 1.0]);
      expect(env.lightIntensity).toBe(5.5);
    });
  });

  describe('generate()', () => {
    const env = new RoomEnvironment({ size: 32 });
    const result: EnvironmentCubeData = env.generate();

    it('returns exactly 6 faces', () => {
      expect(result.faces).toHaveLength(6);
    });

    it('reports the cube size', () => {
      expect(result.size).toBe(32);
    });

    it('returns faces in three.js cube-map order', () => {
      expect(result.faces.map(f => f.face)).toEqual([...FACE_NAMES]);
    });

    it('each face has correct dimensions (size × size × 3)', () => {
      for (const face of result.faces) {
        expect(face.width).toBe(32);
        expect(face.height).toBe(32);
        expect(face.data.length).toBe(32 * 32 * 3);
      }
    });

    it('each face data is a Float32Array', () => {
      for (const face of result.faces) {
        expect(face.data).toBeInstanceOf(Float32Array);
      }
    });
  });

  describe('ceiling face (+y)', () => {
    const env = new RoomEnvironment();
    const ceiling = env.generate().faces.find(f => f.face === '+y')!;

    it('has at least one pixel brighter than ceilingColor', () => {
      const bright = maxComponent(ceiling);
      expect(bright).toBeGreaterThan(Math.max(...env.ceilingColor));
    });

    it('light-strip pixels equal lightIntensity (HDR)', () => {
      // u≈0.2 (inside first strip), any v → x≈0.2*(size-1)
      const x = Math.round(0.2 * (env.size - 1));
      const y = 0;
      const [r, g, b] = px(ceiling, x, y);
      expect(r).toBeCloseTo(env.lightIntensity, 5);
      expect(g).toBeCloseTo(env.lightIntensity, 5);
      expect(b).toBeCloseTo(env.lightIntensity, 5);
    });
  });

  describe('floor face (-y)', () => {
    const env = new RoomEnvironment({ size: 24 });
    const floor = env.generate().faces.find(f => f.face === '-y')!;

    it('all pixels are close to floorColor', () => {
      const [fr, fg, fb] = env.floorColor;
      for (let i = 0; i < floor.data.length; i += 3) {
        expect(floor.data[i]).toBeCloseTo(fr, 5);
        expect(floor.data[i + 1]).toBeCloseTo(fg, 5);
        expect(floor.data[i + 2]).toBeCloseTo(fb, 5);
      }
    });
  });

  describe('wall faces', () => {
    const env = new RoomEnvironment();
    const cube = env.generate();
    const walls = ['+x', '-x', '+z', '-z'] as const;

    it('use wallColor as the base (corner pixel outside lights)', () => {
      const [wr, wg, wb] = env.wallColor;
      for (const name of walls) {
        const face = cube.faces.find(f => f.face === name)!;
        // corner (0,0): u=0, v=0 → never inside a strip (v≥0.7) or window (u≥0.3)
        const [r, g, b] = px(face, 0, 0);
        expect(r).toBeCloseTo(wr, 5);
        expect(g).toBeCloseTo(wg, 5);
        expect(b).toBeCloseTo(wb, 5);
      }
    });

    it('+x/-x walls have a bright horizontal strip', () => {
      for (const name of ['+x', '-x'] as const) {
        const face = cube.faces.find(f => f.face === name)!;
        // v≈0.75 (inside strip), any u
        const y = Math.round(0.75 * (env.size - 1));
        const [r] = px(face, 0, y);
        expect(r).toBeGreaterThan(Math.max(...env.wallColor));
      }
    });

    it('+z/-z walls have a bright window rectangle', () => {
      for (const name of ['+z', '-z'] as const) {
        const face = cube.faces.find(f => f.face === name)!;
        // centre of window: u≈0.5, v≈0.6
        const x = Math.round(0.5 * (env.size - 1));
        const y = Math.round(0.6 * (env.size - 1));
        const [r, g, b] = px(face, x, y);
        expect(r).toBeCloseTo(env.lightIntensity, 5);
        expect(g).toBeCloseTo(env.lightIntensity, 5);
        expect(b).toBeCloseTo(env.lightIntensity, 5);
      }
    });
  });

  describe('HDR', () => {
    it('values can exceed 1.0 when lightIntensity > 1', () => {
      const env = new RoomEnvironment({ lightIntensity: 4.0 });
      const cube = env.generate();
      let globalMax = 0;
      for (const face of cube.faces) {
        const m = maxComponent(face);
        if (m > globalMax) globalMax = m;
      }
      expect(globalMax).toBeGreaterThan(1.0);
      expect(globalMax).toBeCloseTo(4.0, 5);
    });

    it('stays ≤ 1.0 everywhere when lightIntensity ≤ 1', () => {
      const env = new RoomEnvironment({ lightIntensity: 0.5, ceilingColor: [0.9, 0.9, 0.9] });
      const cube = env.generate();
      for (const face of cube.faces) {
        expect(maxComponent(face)).toBeLessThanOrEqual(1.0);
      }
    });
  });

  describe('size clamping', () => {
    it('size=16 minimum works and produces 16×16 faces', () => {
      const env = new RoomEnvironment({ size: 16 });
      const cube = env.generate();
      expect(cube.size).toBe(16);
      for (const face of cube.faces) {
        expect(face.data.length).toBe(16 * 16 * 3);
      }
    });

    it('size below 16 is clamped up to 16', () => {
      const env = new RoomEnvironment({ size: 4 });
      expect(env.size).toBe(16);
      const cube = env.generate();
      expect(cube.size).toBe(16);
    });
  });
});
