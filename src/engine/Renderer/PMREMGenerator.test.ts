// PMREMGenerator 单元测试 — 预滤波 / 辐照度 / mip 链 / 方向 / 能量守恒。
//
// 覆盖维度:
//   1. 构造(默认/自定义 samples)
//   2. prefilter 输出结构(6 面 × mip 链,尺寸正确)
//   3. mip 0 = 直接拷贝(α=0 无卷积)
//   4. 高 mip = 平滑(能量守恒,粗糙表面更暗淡)
//   5. 均匀环境 → 均匀输出(所有 texel 相同)
//   6. diffuseIrradiance 结构 + 均匀环境验证
//   7. 方向一致性(cubeTexelDirection)
//   8. 错误处理(源过小)

import { describe, it, expect } from 'vitest';
import { PMREMGenerator, type PMREMGeneratorOptions } from './PMREMGenerator';
import { RoomEnvironment, type EnvironmentCubeData, type CubeFaceData } from './RoomEnvironment';

// ── 测试辅助 ──────────────────────────────────────────────────

/** 创建均匀颜色 cube 环境(所有 texel = color)。 */
function makeUniformCube(size: number, color: [number, number, number]): EnvironmentCubeData {
  const faces: CubeFaceData[] = [];
  const names = ['+x', '-x', '+y', '-y', '+z', '-z'];
  for (let f = 0; f < 6; f++) {
    const data = new Float32Array(size * size * 3);
    for (let i = 0; i < data.length; i += 3) {
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
    }
    faces.push({ face: names[f], data, width: size, height: size });
  }
  return { faces, size };
}

/** 创建单点光源 cube:中心 texel 为白色,其余为黑色。 */
function makePointLightCube(size: number): EnvironmentCubeData {
  const faces: CubeFaceData[] = [];
  const names = ['+x', '-x', '+y', '-y', '+z', '-z'];
  for (let f = 0; f < 6; f++) {
    const data = new Float32Array(size * size * 3);
    const cx = Math.floor(size / 2);
    const cy = Math.floor(size / 2);
    const idx = (cy * size + cx) * 3;
    data[idx] = 10;     // HDR 白色
    data[idx + 1] = 10;
    data[idx + 2] = 10;
    faces.push({ face: names[f], data, width: size, height: size });
  }
  return { faces, size };
}

// ── 测试 ──────────────────────────────────────────────────────

describe('PMREMGenerator', () => {

  // ── 构造 ────────────────────────────────────────────────────

  describe('构造', () => {
    it('默认 samples=32', () => {
      const gen = new PMREMGenerator();
      expect(gen.samples).toBe(32);
    });

    it('自定义 samples', () => {
      const gen = new PMREMGenerator({ samples: 64 });
      expect(gen.samples).toBe(64);
    });

    it('samples 最小为 1', () => {
      const gen = new PMREMGenerator({ samples: 0 });
      expect(gen.samples).toBe(1);
    });

    it('samples 向下取整', () => {
      const gen = new PMREMGenerator({ samples: 32.7 });
      expect(gen.samples).toBe(32);
    });

    it('接受空选项', () => {
      const gen = new PMREMGenerator({} as PMREMGeneratorOptions);
      expect(gen.samples).toBe(32);
    });
  });

  // ── prefilter 输出结构 ─────────────────────────────────────

  describe('prefilter 结构', () => {
    it('返回 6 面', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      expect(result.faces).toHaveLength(6);
    });

    it('面名顺序 +x, -x, +y, -y, +z, -z', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      expect(result.faces.map(f => f.face)).toEqual(['+x', '-x', '+y', '-y', '+z', '-z']);
    });

    it('每面有 mip 链', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      for (const face of result.faces) {
        expect(face.mips.length).toBe(result.mipCount);
        expect(face.mips.length).toBeGreaterThan(0);
      }
    });

    it('mip 尺寸逐级减半(到最小 4)', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      const mips = result.faces[0].mips;
      expect(mips[0].width).toBe(32);
      expect(mips[1].width).toBe(16);
      expect(mips[2].width).toBe(8);
      expect(mips[3].width).toBe(4);
    });

    it('mipCount = log2(srcSize) - log2(4) + 1', () => {
      const cube = makeUniformCube(64, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      // 64 → 64, 32, 16, 8, 4 = 5 mips
      expect(result.mipCount).toBe(5);
    });

    it('mip data 长度 = width * height * 3', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      for (const face of result.faces) {
        for (const mip of face.mips) {
          expect(mip.data.length).toBe(mip.width * mip.height * 3);
        }
      }
    });

    it('size 字段 = 源尺寸', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      expect(result.size).toBe(32);
    });
  });

  // ── mip 0 = 直接拷贝 ───────────────────────────────────────

  describe('mip 0 (α=0, 直接拷贝)', () => {
    it('均匀环境 mip 0 = 源颜色', () => {
      const cube = makeUniformCube(32, [0.5, 0.6, 0.7]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      const mip0 = result.faces[0].mips[0];
      // 采样中心 texel
      const cx = Math.floor(mip0.width / 2);
      const cy = Math.floor(mip0.height / 2);
      const idx = (cy * mip0.width + cx) * 3;
      expect(mip0.data[idx]).toBeCloseTo(0.5, 4);
      expect(mip0.data[idx + 1]).toBeCloseTo(0.6, 4);
      expect(mip0.data[idx + 2]).toBeCloseTo(0.7, 4);
    });

    it('单点光源 mip 0 中心 texel = 源中心值', () => {
      const cube = makePointLightCube(32);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      const mip0 = result.faces[0].mips[0];
      const cx = Math.floor(mip0.width / 2);
      const cy = Math.floor(mip0.height / 2);
      const idx = (cy * mip0.width + cx) * 3;
      // mip 0 直接采样源中心,源中心 = 10(HDR 白)
      expect(mip0.data[idx]).toBeCloseTo(10, 1);
    });
  });

  // ── 高 mip = 平滑(能量守恒) ─────────────────────────────

  describe('高 mip (粗糙度 > 0, 平滑)', () => {
    it('单点光源:高 mip 中心值 < mip 0 中心值(扩散)', () => {
      const cube = makePointLightCube(32);
      const gen = new PMREMGenerator({ samples: 32 });
      const result = gen.prefilter(cube);

      const mip0Center = sampleMipCenter(result.faces[0].mips[0]);
      const mipLastCenter = sampleMipCenter(result.faces[0].mips[result.mipCount - 1]);

      // 粗糙表面:点光源被扩散到更大范围,中心值降低
      expect(mipLastCenter[0]).toBeLessThan(mip0Center[0]);
    });

    it('均匀环境:所有 mip 值相同(无方向性)', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);

      // 均匀环境下所有 mip 所有 texel 应 = 1
      for (const face of result.faces) {
        for (const mip of face.mips) {
          for (let i = 0; i < mip.data.length; i += 3) {
            expect(mip.data[i]).toBeCloseTo(1, 1);
            expect(mip.data[i + 1]).toBeCloseTo(1, 1);
            expect(mip.data[i + 2]).toBeCloseTo(1, 1);
          }
        }
      }
    });

    it('高 mip 无 NaN', () => {
      const cube = makePointLightCube(32);
      const gen = new PMREMGenerator({ samples: 16 });
      const result = gen.prefilter(cube);
      for (const face of result.faces) {
        for (let m = 1; m < face.mips.length; m++) {
          const mip = face.mips[m];
          for (let i = 0; i < mip.data.length; i++) {
            expect(Number.isNaN(mip.data[i])).toBe(false);
          }
        }
      }
    });
  });

  // ── diffuseIrradiance ──────────────────────────────────────

  describe('diffuseIrradiance', () => {
    it('返回 6 面', () => {
      const cube = makeUniformCube(16, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.diffuseIrradiance(cube);
      expect(result.faces).toHaveLength(6);
    });

    it('每面数据长度 = size * size * 3', () => {
      const cube = makeUniformCube(16, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.diffuseIrradiance(cube);
      for (const face of result.faces) {
        expect(face.data.length).toBe(result.size * result.size * 3);
      }
    });

    it('均匀环境:所有 texel = 源颜色(余弦加权平均 = 均匀)', () => {
      const cube = makeUniformCube(16, [0.8, 0.4, 0.2]);
      const gen = new PMREMGenerator({ samples: 16 });
      const result = gen.diffuseIrradiance(cube);
      for (const face of result.faces) {
        for (let i = 0; i < face.data.length; i += 3) {
          expect(face.data[i]).toBeCloseTo(0.8, 1);
          expect(face.data[i + 1]).toBeCloseTo(0.4, 1);
          expect(face.data[i + 2]).toBeCloseTo(0.2, 1);
        }
      }
    });

    it('自定义输出尺寸', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.diffuseIrradiance(cube, 16);
      expect(result.size).toBe(16);
      for (const face of result.faces) {
        expect(face.width).toBe(16);
        expect(face.height).toBe(16);
      }
    });

    it('输出尺寸最小为 4', () => {
      const cube = makeUniformCube(32, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.diffuseIrradiance(cube, 2);
      expect(result.size).toBe(4);
    });

    it('无 NaN', () => {
      const cube = makePointLightCube(16);
      const gen = new PMREMGenerator({ samples: 16 });
      const result = gen.diffuseIrradiance(cube);
      for (const face of result.faces) {
        for (let i = 0; i < face.data.length; i++) {
          expect(Number.isNaN(face.data[i])).toBe(false);
        }
      }
    });
  });

  // ── 错误处理 ────────────────────────────────────────────────

  describe('错误处理', () => {
    it('源尺寸 < 4 时抛错', () => {
      const cube = makeUniformCube(2, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 8 });
      expect(() => gen.prefilter(cube)).toThrow();
    });

    it('源尺寸 = 4 可以工作', () => {
      const cube = makeUniformCube(4, [1, 1, 1]);
      const gen = new PMREMGenerator({ samples: 4 });
      expect(() => gen.prefilter(cube)).not.toThrow();
    });
  });

  // ── RoomEnvironment 集成 ───────────────────────────────────

  describe('RoomEnvironment 集成', () => {
    it('消费 RoomEnvironment 输出', () => {
      const room = new RoomEnvironment({ size: 32 });
      const cube = room.generate();
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      expect(result.faces).toHaveLength(6);
      expect(result.mipCount).toBeGreaterThan(0);
    });

    it('RoomEnvironment + diffuseIrradiance', () => {
      const room = new RoomEnvironment({ size: 16 });
      const cube = room.generate();
      const gen = new PMREMGenerator({ samples: 16 });
      const result = gen.diffuseIrradiance(cube);
      expect(result.faces).toHaveLength(6);
      // 房间环境有天花板灯,辐照度 > 0
      for (const face of result.faces) {
        let hasPositive = false;
        for (let i = 0; i < face.data.length; i++) {
          if (face.data[i] > 0) { hasPositive = true; break; }
        }
        expect(hasPositive).toBe(true);
      }
    });
  });

  // ── 数值合理性 ──────────────────────────────────────────────

  describe('数值合理性', () => {
    it('HDR 环境输出仍为 HDR(可 > 1)', () => {
      const cube = makeUniformCube(32, [3, 3, 3]); // HDR 均匀
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      const mip0 = result.faces[0].mips[0];
      expect(mip0.data[0]).toBeCloseTo(3, 1);
    });

    it('黑色环境 → 全零输出', () => {
      const cube = makeUniformCube(16, [0, 0, 0]);
      const gen = new PMREMGenerator({ samples: 8 });
      const result = gen.prefilter(cube);
      for (const face of result.faces) {
        for (const mip of face.mips) {
          for (let i = 0; i < mip.data.length; i++) {
            expect(mip.data[i]).toBe(0);
          }
        }
      }
    });

    it('所有值有限(无 Infinity)', () => {
      const cube = makePointLightCube(32);
      const gen = new PMREMGenerator({ samples: 16 });
      const result = gen.prefilter(cube);
      for (const face of result.faces) {
        for (const mip of face.mips) {
          for (let i = 0; i < mip.data.length; i++) {
            expect(Number.isFinite(mip.data[i])).toBe(true);
          }
        }
      }

      // prefilter 生成 6 面×mip 链,蒙地卡罗采样量大,慢机器 + 全量并发可能超过默认 5s。
    }, 30000);
  });
});

// ── 辅助函数 ──────────────────────────────────────────────────

/** 采样 mip 中心的 RGB。 */
function sampleMipCenter(mip: { width: number; data: Float32Array }): [number, number, number] {
  const cx = Math.floor(mip.width / 2);
  const cy = Math.floor(mip.width / 2);
  const idx = (cy * mip.width + cx) * 3;
  return [mip.data[idx], mip.data[idx + 1], mip.data[idx + 2]];
}
