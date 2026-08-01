// FBMNoise — 基于 Simplex 噪声的分形布朗运动(Fractal Brownian Motion)。
//
// 与 HeightmapGenerator(基于 Perlin)互补:Simplex 噪声无方向性伪影,
// 在高维空间中计算量更低,适合实时地形生成。
//
// 算法:多倍频叠加,每倍频频率 ×lacunarity、振幅 ×persistence,
// 输出归一化到 [-1, 1]。
//
// 参考:
//   - Ken Perlin "Improving Noise" (2002)
//   - Stefan Gustavson "Simplex noise demystified" (2005)
//   - three.js examples/jsm/math/SimplexNoise.js

import { SimplexNoise } from '../Math/SimplexNoise';

/** 高度函数:给定世界坐标 (x, z) 返回高度 y。 */
export type HeightFunction = (x: number, z: number) => number;

/**
 * FBM 噪声生成器(多倍频 Simplex 叠加)。
 *
 * 每个倍频频率 ×2、振幅 ×persistence,叠加 octaves 次。
 * 适用于程序化地形高度图生成。
 */
export class FBMNoise {
  private readonly noise: SimplexNoise;
  readonly octaves: number;
  readonly persistence: number;
  readonly lacunarity: number;
  readonly scale: number;

  /**
   * @param octaves     倍频数。默认 6。
   * @param persistence  振幅衰减比(每倍频振幅 × persistence)。默认 0.5。
   * @param lacunarity   频率增长比(每倍频频率 × lacunarity)。默认 2.0。
   * @param scale       输入坐标缩放(值越大地形越平缓)。默认 0.01。
   */
  constructor(
    octaves = 6,
    persistence = 0.5,
    lacunarity = 2.0,
    scale = 0.01,
  ) {
    this.noise = new SimplexNoise();
    this.octaves = octaves;
    this.persistence = persistence;
    this.lacunarity = lacunarity;
    this.scale = scale;
  }

  /**
   * 采样 2D FBM 噪声。
   *
   * @param x 世界 X
   * @param z 世界 Z
   * @returns 噪声值,范围约 [-1, 1]。
   */
  noise2D(x: number, z: number): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;

    for (let i = 0; i < this.octaves; i++) {
      const sx = x * this.scale * frequency;
      const sz = z * this.scale * frequency;
      value += this.noise.noise2D(sx, sz) * amplitude;
      maxValue += amplitude;
      amplitude *= this.persistence;
      frequency *= this.lacunarity;
    }

    return maxValue > 0 ? value / maxValue : 0;
  }

  /**
   * 生成地形高度函数。
   *
   * @param heightScale 高度缩放(噪声值 × heightScale = 世界高度)。默认 10。
   * @returns HeightFunction,可直接传给 TerrainSystem。
   */
  toHeightFunction(heightScale = 10): HeightFunction {
    return (x: number, z: number) => this.noise2D(x, z) * heightScale;
  }
}
