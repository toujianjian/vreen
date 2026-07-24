import { describe, it, expect } from 'vitest';
import { Texture } from '../Core/Texture';
import { TerrainLayer } from './TerrainLayer';

describe('TerrainLayer', () => {
  it('使用默认值构造(仅 texture)', () => {
    const tex = new Texture('sand');
    const layer = new TerrainLayer({ texture: tex });
    expect(layer.texture).toBe(tex);
    expect(layer.scale).toBe(1);
    expect(layer.minHeight).toBe(-Infinity);
    expect(layer.maxHeight).toBe(Infinity);
    expect(layer.maxSlope).toBe(90);
  });

  it('接受自定义参数', () => {
    const tex = new Texture('grass');
    const layer = new TerrainLayer({
      texture: tex,
      scale: 4,
      minHeight: 1,
      maxHeight: 8,
      maxSlope: 35,
    });
    expect(layer.scale).toBe(4);
    expect(layer.minHeight).toBe(1);
    expect(layer.maxHeight).toBe(8);
    expect(layer.maxSlope).toBe(35);
  });
});
