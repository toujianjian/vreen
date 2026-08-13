// MathUtils — three.js MathUtils 全集函数测试。
// 覆盖:常量 / 插值族 / 幂与指数 / 随机族 / 角度换算 / 量化往返 / 四元数。

import { describe, it, expect, vi } from 'vitest';
import {
  DEG2RAD,
  RAD2DEG,
  generateUUID,
  clamp,
  euclideanModulo,
  mapLinear,
  inverseLerp,
  lerp,
  damp,
  pingpong,
  smoothstep,
  smootherstep,
  randInt,
  randFloat,
  randFloatSpread,
  seededRandom,
  degToRad,
  radToDeg,
  isPowerOfTwo,
  ceilPowerOfTwo,
  floorPowerOfTwo,
  setQuaternionFromProperEuler,
  normalize,
  denormalize,
  angleDelta,
  wrapAngle,
  toDb,
  fromDb,
} from './MathUtils';

describe('MathUtils 常量', () => {
  it('DEG2RAD / RAD2DEG 互为倒数', () => {
    expect(DEG2RAD).toBeCloseTo(Math.PI / 180, 12);
    expect(RAD2DEG).toBeCloseTo(180 / Math.PI, 12);
    expect(DEG2RAD * RAD2DEG).toBeCloseTo(1, 12);
  });
});

describe('generateUUID', () => {
  it('产出 36 位小写 uuid v4 格式', () => {
    const u = generateUUID();
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('多次调用不重复', () => {
    const set = new Set(Array.from({ length: 100 }, () => generateUUID()));
    expect(set.size).toBe(100);
  });
});

describe('clamp / euclideanModulo / mapLinear', () => {
  it('clamp 双向钳制', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it('euclideanModulo 对负数返回非负余数', () => {
    expect(euclideanModulo(7, 4)).toBe(3);
    expect(euclideanModulo(-1, 4)).toBe(3);
    expect(euclideanModulo(-7, 4)).toBe(1);
    expect(euclideanModulo(0, 4)).toBe(0);
  });

  it('mapLinear 把值从 [a1,a2] 线性映射到 [b1,b2]', () => {
    expect(mapLinear(0, 0, 1, 100, 200)).toBe(100);
    expect(mapLinear(1, 0, 1, 100, 200)).toBe(200);
    expect(mapLinear(0.5, 0, 1, 100, 200)).toBe(150);
    expect(mapLinear(2, 0, 10, 0, 5)).toBe(1);
  });
});

describe('lerp / inverseLerp / damp', () => {
  it('lerp 端点与中点', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('inverseLerp 反解参数', () => {
    expect(inverseLerp(0, 10, 5)).toBe(0.5);
    expect(inverseLerp(0, 10, 0)).toBe(0);
    expect(inverseLerp(0, 10, 10)).toBe(1);
  });

  it('inverseLerp 区间重合返回 0 (无除零)', () => {
    expect(inverseLerp(3, 3, 5)).toBe(0);
  });

  it('damp 帧率无关阻尼:dt=0 回到起点,dt 大逼近目标', () => {
    expect(damp(0, 10, 1, 0)).toBe(0);
    expect(damp(0, 10, 1, 1)).toBeCloseTo(10 * (1 - Math.exp(-1)), 12);
    expect(damp(0, 10, 1, 100)).toBeCloseTo(10, 6);
  });
});

describe('pingpong / smoothstep / smootherstep', () => {
  it('pingpong 三角波在 [0, length] 内往返', () => {
    expect(pingpong(0)).toBe(0);
    expect(pingpong(0.25)).toBe(0.25);
    expect(pingpong(0.5)).toBe(0.5);
    expect(pingpong(0.75)).toBe(0.75);
    expect(pingpong(1)).toBe(1);
    expect(pingpong(1.25)).toBe(0.75);
    expect(pingpong(3.5)).toBe(0.5);
  });

  it('pingpong 支持自定义长度', () => {
    expect(pingpong(1, 2)).toBe(1);
    expect(pingpong(3, 2)).toBe(1);
  });

  it('smoothstep 边界与中点', () => {
    expect(smoothstep(-1, 0, 1)).toBe(0);
    expect(smoothstep(2, 0, 1)).toBe(1);
    expect(smoothstep(0.5, 0, 1)).toBe(0.5);
    // 对称性:smoothstep(x) + smoothstep(1-x) = 1
    expect(smoothstep(0.3, 0, 1) + smoothstep(0.7, 0, 1)).toBeCloseTo(1, 12);
  });

  it('smootherstep 边界与中点', () => {
    expect(smootherstep(-1, 0, 1)).toBe(0);
    expect(smootherstep(2, 0, 1)).toBe(1);
    expect(smootherstep(0.5, 0, 1)).toBe(0.5);
    // 端点斜率应为 0 (六次多项式的一阶导数在端点归零)
    const h = 1e-6;
    const slope0 = smootherstep(h, 0, 1) / h;
    const slope1 = (1 - smootherstep(1 - h, 0, 1)) / h;
    expect(Math.abs(slope0)).toBeLessThan(1e-6);
    expect(Math.abs(slope1)).toBeLessThan(1e-6);
    // 对称性:smootherstep(x) + smootherstep(1-x) = 1
    expect(smootherstep(0.3, 0, 1) + smootherstep(0.7, 0, 1)).toBeCloseTo(1, 12);
  });
});

describe('随机族', () => {
  it('randInt 落在 [low, high] 闭区间', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0);
    expect(randInt(2, 5)).toBe(2);
    vi.spyOn(Math, 'random').mockImplementation(() => 0.999999);
    expect(randInt(2, 5)).toBe(5);
    vi.restoreAllMocks();
  });

  it('randFloat 落在 [low, high) 区间', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0);
    expect(randFloat(1, 3)).toBe(1);
    vi.spyOn(Math, 'random').mockImplementation(() => 0.5);
    expect(randFloat(1, 3)).toBe(2);
    vi.restoreAllMocks();
  });

  it('randFloatSpread 落在 [-range/2, range/2]', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => 0);
    expect(randFloatSpread(4)).toBe(2);
    vi.spyOn(Math, 'random').mockImplementation(() => 1);
    expect(randFloatSpread(4)).toBe(-2);
    vi.restoreAllMocks();
  });

  it('seededRandom 同种子确定性且落在 [0,1)', () => {
    const a1 = seededRandom(42);
    const a2 = seededRandom(42);
    expect(a1).toBe(a2);
    expect(a1).toBeGreaterThanOrEqual(0);
    expect(a1).toBeLessThan(1);
    // 重置种子后第一个值相同
    expect(seededRandom(7)).toBe(seededRandom(7));
    // 同一种子序列逐次推进产生新值
    const r1 = seededRandom(7);
    const r2 = seededRandom();
    const r3 = seededRandom();
    expect(r2).not.toBe(r1);
    expect(r3).not.toBe(r2);
  });
});

describe('角度换算', () => {
  it('degToRad / radToDeg 往返', () => {
    expect(degToRad(180)).toBeCloseTo(Math.PI, 12);
    expect(degToRad(90)).toBeCloseTo(Math.PI / 2, 12);
    expect(radToDeg(Math.PI)).toBeCloseTo(180, 12);
    expect(radToDeg(degToRad(37))).toBeCloseTo(37, 12);
  });
});

describe('幂与二次幂', () => {
  it('isPowerOfTwo 判断', () => {
    expect(isPowerOfTwo(0)).toBe(false);
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(2)).toBe(true);
    expect(isPowerOfTwo(3)).toBe(false);
    expect(isPowerOfTwo(1024)).toBe(true);
    expect(isPowerOfTwo(2049)).toBe(false);
  });

  it('ceilPowerOfTwo / floorPowerOfTwo', () => {
    expect(ceilPowerOfTwo(3)).toBe(4);
    expect(ceilPowerOfTwo(4)).toBe(4);
    expect(ceilPowerOfTwo(5)).toBe(8);
    expect(floorPowerOfTwo(3)).toBe(2);
    expect(floorPowerOfTwo(4)).toBe(4);
    expect(floorPowerOfTwo(5)).toBe(4);
  });
});

describe('setQuaternionFromProperEuler', () => {
  function makeQuat() {
    let v = { x: 0, y: 0, z: 0, w: 0 };
    return {
      set(x: number, y: number, z: number, w: number) {
        v = { x, y, z, w };
      },
      get() {
        return v;
      },
    };
  }

  it('b=π 的 XYX 等效绕 Y 转 180°', () => {
    const q = makeQuat();
    setQuaternionFromProperEuler(q, 0, Math.PI, 0, 'XYX');
    const v = q.get();
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(1, 12);
    expect(v.z).toBeCloseTo(0, 12);
    expect(v.w).toBeCloseTo(0, 12);
  });

  it('ZYZ 的 a=π/2 等效绕 Z 转 90°', () => {
    const q = makeQuat();
    setQuaternionFromProperEuler(q, Math.PI / 2, 0, 0, 'ZYZ');
    const v = q.get();
    expect(v.x).toBeCloseTo(0, 12);
    expect(v.y).toBeCloseTo(0, 12);
    expect(v.z).toBeCloseTo(Math.SQRT1_2, 12);
    expect(v.w).toBeCloseTo(Math.SQRT1_2, 12);
  });

  it('全零角产出单位四元数', () => {
    for (const order of ['XYX', 'YZY', 'ZXZ', 'XZX', 'YXY', 'ZYZ']) {
      const q = makeQuat();
      setQuaternionFromProperEuler(q, 0, 0, 0, order);
      expect(q.get()).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    }
  });

  it('未知 order 打印警告且不改写', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const q = makeQuat();
    setQuaternionFromProperEuler(q, 1, 1, 1, 'BAD');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(q.get()).toEqual({ x: 0, y: 0, z: 0, w: 0 });
    warn.mockRestore();
  });
});

describe('normalize / denormalize 量化往返', () => {
  it('Float32Array 恒等', () => {
    expect(normalize(0.5, new Float32Array(1))).toBe(0.5);
    expect(denormalize(0.5, new Float32Array(1))).toBe(0.5);
  });

  it('Uint8Array 往返近似', () => {
    const n = normalize(0.5, new Uint8Array(1));
    expect(n).toBe(128);
    expect(denormalize(n, new Uint8Array(1))).toBeCloseTo(0.5, 2);
    expect(normalize(1, new Uint8Array(1))).toBe(255);
    expect(normalize(0, new Uint8Array(1))).toBe(0);
  });

  it('Uint16Array / Uint32Array 归一', () => {
    expect(normalize(1, new Uint16Array(1))).toBe(65535);
    expect(normalize(1, new Uint32Array(1))).toBe(4294967295);
    expect(denormalize(32767, new Uint16Array(1))).toBeCloseTo(0.5, 4);
  });

  it('Int8Array 负值钳制到 -1', () => {
    expect(denormalize(-128, new Int8Array(1))).toBe(-1);
    expect(normalize(-1, new Int8Array(1))).toBe(-127);
    expect(denormalize(-127, new Int8Array(1))).toBeCloseTo(-1, 5);
  });

  it('非法类型抛错', () => {
    expect(() => normalize(1, [] as unknown as Float32Array)).toThrow('Invalid component type.');
    expect(() => denormalize(1, [] as unknown as Float32Array)).toThrow('Invalid component type.');
  });
});

describe('VREEN 扩展工具', () => {
  it('angleDelta 最短角距离', () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2, 12);
    expect(angleDelta(0, Math.PI * 1.75)).toBeCloseTo(-Math.PI / 4, 12);
    expect(angleDelta(1, 1)).toBe(0);
  });

  it('wrapAngle 折叠到 [-π, π]', () => {
    expect(wrapAngle(Math.PI * 2.5)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(-Math.PI * 0.5)).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('toDb / fromDb 往返', () => {
    expect(fromDb(toDb(1))).toBeCloseTo(1, 12);
    expect(toDb(10)).toBeCloseTo(20, 12);
    expect(toDb(0)).toBeCloseTo(-240, 6); // 钳制到 1e-12
    expect(fromDb(0)).toBe(1);
  });
});
