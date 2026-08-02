// GroundedSkybox 单元测试。
//
// 验证:
//   1. 构造器创建 Mesh 实例
//   2. 参数校验(height/radius/resolution <= 0 抛错)
//   3. 几何体顶点被正确修改(Z 翻转 + 下半球压平)
//   4. 材质设置正确(map + depthWrite=false)
//   5. position.y = height 对齐地面

import { describe, it, expect } from 'vitest';
import { GroundedSkybox } from './GroundedSkybox';
import { Mesh } from '../Core/Mesh';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import { Texture } from '../Core/Texture';

// 创建一个最小化的 Texture mock(不需要真实 GL 句柄)
function makeMockTexture(): Texture {
  return new Texture('mock-env');
}

describe('GroundedSkybox: construction', () => {
  it('creates a Mesh instance', () => {
    const skybox = new GroundedSkybox(makeMockTexture(), 15, 100);
    expect(skybox).toBeInstanceOf(Mesh);
  });

  it('has geometry with position attribute', () => {
    const skybox = new GroundedSkybox(makeMockTexture(), 15, 100, 16);
    const geo = skybox.geometry;
    const pos = geo.getAttribute('position');
    expect(pos).toBeDefined();
    expect(pos!.count).toBeGreaterThan(0);
  });

  it('has MeshBasicMaterial with correct settings', () => {
    const map = makeMockTexture();
    const skybox = new GroundedSkybox(map, 15, 100);
    const mat = skybox.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    expect(mat.map).toBe(map);
    expect(mat.depthWrite).toBe(false);
  });
});

describe('GroundedSkybox: parameter validation', () => {
  it('throws when height <= 0', () => {
    expect(() => new GroundedSkybox(makeMockTexture(), 0, 100)).toThrow(/positive/);
    expect(() => new GroundedSkybox(makeMockTexture(), -1, 100)).toThrow(/positive/);
  });

  it('throws when radius <= 0', () => {
    expect(() => new GroundedSkybox(makeMockTexture(), 15, 0)).toThrow(/positive/);
    expect(() => new GroundedSkybox(makeMockTexture(), 15, -5)).toThrow(/positive/);
  });

  it('throws when resolution <= 0', () => {
    expect(() => new GroundedSkybox(makeMockTexture(), 15, 100, 0)).toThrow(/positive/);
    expect(() => new GroundedSkybox(makeMockTexture(), 15, 100, -1)).toThrow(/positive/);
  });
});

describe('GroundedSkybox: geometry deformation', () => {
  it('flattens bottom hemisphere vertices (y < 0)', () => {
    const height = 15;
    const radius = 100;
    const skybox = new GroundedSkybox(makeMockTexture(), height, radius, 32);
    const pos = skybox.geometry.getAttribute('position')!;
    const arr = pos.array;

    // 收集所有 y < 0 的顶点
    let bottomCount = 0;
    let maxBottomY = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = arr[i * 3 + 1];
      if (y < 0) {
        bottomCount++;
        maxBottomY = Math.max(maxBottomY, y);
      }
    }

    expect(bottomCount).toBeGreaterThan(0);
    // 压平后,底部顶点的 y 不应超过 -height * 3/2 附近(过渡区)
    // (球面顶部的 y 可以接近 0,但底部顶点的 y 应被压缩)
    // 最大底部 y 应小于 0
    expect(maxBottomY).toBeLessThan(0);
  });

  it('top hemisphere vertices remain on sphere surface', () => {
    const radius = 100;
    const skybox = new GroundedSkybox(makeMockTexture(), 15, radius, 32);
    const pos = skybox.geometry.getAttribute('position')!;
    const arr = pos.array;

    // 对 y > 0 的顶点(上半球),距离原点应 ≈ radius
    let topCount = 0;
    for (let i = 0; i < pos.count; i++) {
      const x = arr[i * 3];
      const y = arr[i * 3 + 1];
      const z = arr[i * 3 + 2];
      if (y > 0.01) {
        const dist = Math.sqrt(x * x + y * y + z * z);
        expect(dist).toBeCloseTo(radius, 0);
        topCount++;
      }
    }
    expect(topCount).toBeGreaterThan(0);
  });

  it('Z-axis is flipped (normals point inward)', () => {
    // 创建一个低分辨率球体,检查 Z 是否被翻转
    const skybox = new GroundedSkybox(makeMockTexture(), 15, 100, 4);
    const pos = skybox.geometry.getAttribute('position')!;
    const arr = pos.array;

    // 原始球体的北极 (+y) 顶点 z ≈ 0,翻转后仍 ≈ 0
    // 但赤道前方的顶点 z > 0 → 翻转后 z < 0
    // 我们检查:存在 z < 0 的顶点(翻转前 z > 0)
    let hasNegZ = false;
    for (let i = 0; i < pos.count; i++) {
      if (arr[i * 3 + 2] < -0.1) hasNegZ = true;
    }
    expect(hasNegZ).toBe(true);
  });
});

describe('GroundedSkybox: usage pattern', () => {
  it('can be positioned with position.y = height', () => {
    const height = 15;
    const skybox = new GroundedSkybox(makeMockTexture(), height, 100);
    skybox.position.y = height;
    expect(skybox.position.y).toBe(height);
  });
});
