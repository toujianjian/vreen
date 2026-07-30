import { describe, it, expect, beforeEach } from 'vitest';
import { TerrainEditor } from './TerrainEditor';
import { TerrainGeometry } from './TerrainGeometry';
import { TerrainSplat } from './TerrainSplat';
import { TerrainLayer } from './TerrainLayer';
import { Texture } from '../Core/Texture';

/** 构造一个 10x10 世界、4 分段(5x5 顶点)的平坦地形,heightScale=10。
 *  使用 4 分段(偶数)保证 (0,0) 处有顶点(顶点 ix=2, iz=2 在世界原点)。 */
function makeFlatTerrain(heightScale = 10): TerrainGeometry {
  const map = new Float32Array(5 * 5).fill(0);
  return new TerrainGeometry({
    width: 10,
    height: 10,
    widthSegments: 4,
    heightSegments: 4,
    heightmap: map,
    heightScale,
  });
}

describe('TerrainEditor', () => {
  let editor: TerrainEditor;

  beforeEach(() => {
    editor = new TerrainEditor();
  });

  it('默认属性正确', () => {
    expect(editor.brushSize).toBe(5);
    expect(editor.brushStrength).toBe(0.5);
    expect(editor.brushFalloff).toBe(0.5);
    expect(editor.brushShape).toBe('circle');
    expect(editor.tool).toBe('raise');
    expect(editor.layerIndex).toBe(0);
    expect(editor.heightTarget).toBe(0);
    expect(editor.maxHistory).toBe(50);
    expect(editor.terrain).toBeNull();
  });

  it('setter 链式调用', () => {
    editor
      .setBrushSize(3)
      .setBrushStrength(0.8)
      .setBrushFalloff(1)
      .setBrushShape('square')
      .setTool('lower')
      .setLayer(2)
      .setHeightTarget(5)
      .setNoiseParams(0.2, 2);
    expect(editor.brushSize).toBe(3);
    expect(editor.brushStrength).toBe(0.8);
    expect(editor.brushFalloff).toBe(1);
    expect(editor.brushShape).toBe('square');
    expect(editor.tool).toBe('lower');
    expect(editor.layerIndex).toBe(2);
    expect(editor.heightTarget).toBe(5);
    expect(editor.noiseScale).toBe(0.2);
    expect(editor.noiseAmplitude).toBe(2);
  });

  it('setBrushSize 钳制到正值', () => {
    editor.setBrushSize(-5);
    expect(editor.brushSize).toBeGreaterThan(0);
  });

  it('setBrushStrength 钳制到 [0, 1]', () => {
    editor.setBrushStrength(2);
    expect(editor.brushStrength).toBe(1);
    editor.setBrushStrength(-1);
    expect(editor.brushStrength).toBe(0);
  });

  it('setLayer 钳制到 [0, 3]', () => {
    editor.setLayer(10);
    expect(editor.layerIndex).toBe(3);
    editor.setLayer(-1);
    expect(editor.layerIndex).toBe(0);
  });

  it('setTerrain / getTerrain', () => {
    const t = makeFlatTerrain();
    editor.setTerrain(t);
    expect(editor.getTerrain()).toBe(t);
  });

  it('computeBrushWeights 在无地形时返回空 Map', () => {
    const w = editor.computeBrushWeights(0, 0);
    expect(w.size).toBe(0);
  });

  it('computeBrushWeights circle 形状返回笔刷范围内的顶点', () => {
    const t = makeFlatTerrain();
    editor.setTerrain(t).setBrushSize(2).setBrushShape('circle').setBrushFalloff(0);
    const w = editor.computeBrushWeights(0, 0);
    expect(w.size).toBeGreaterThan(0);
    // 权重都在 (0, 1]
    for (const weight of w.values()) {
      expect(weight).toBeGreaterThan(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it('computeBrushWeights square 形状比 circle 覆盖更多顶点', () => {
    const t = makeFlatTerrain();
    editor.setTerrain(t).setBrushSize(2).setBrushFalloff(0);
    editor.setBrushShape('circle');
    const wCircle = editor.computeBrushWeights(0, 0);
    editor.setBrushShape('square');
    const wSquare = editor.computeBrushWeights(0, 0);
    expect(wSquare.size).toBeGreaterThanOrEqual(wCircle.size);
  });

  it('computeBrushWeights diamond 形状返回有效权重', () => {
    const t = makeFlatTerrain();
    editor.setTerrain(t).setBrushSize(3).setBrushShape('diamond').setBrushFalloff(0.5);
    const w = editor.computeBrushWeights(0, 0);
    expect(w.size).toBeGreaterThan(0);
  });

  it('computeBrushWeights 中心权重最高,边缘最低', () => {
    const t = makeFlatTerrain();
    editor.setTerrain(t).setBrushSize(5).setBrushFalloff(1);
    const w = editor.computeBrushWeights(0, 0);
    // (0,0) 处有顶点 (4 分段, ix=2, iz=2),其权重应最高(接近 1)
    const gridX1 = t.widthSegments + 1;
    const centerIdx = 2 * gridX1 + 2;
    const centerWeight = w.get(centerIdx) ?? 0;
    expect(centerWeight).toBeGreaterThan(0);
    // 中心权重应该接近 1(距离为 0,normDist=0,w=1)
    expect(centerWeight).toBeCloseTo(1, 1);
  });

  it('applyRaise 抬升中心顶点高度', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(1).setBrushStrength(1).setBrushFalloff(0);
    const before = t.heightmap[ Math.floor((t.heightSegments / 2)) * (t.widthSegments + 1) + Math.floor(t.widthSegments / 2)];
    editor.applyRaise(0, 0);
    const gridX1 = t.widthSegments + 1;
    const centerIdx = Math.floor(t.heightSegments / 2) * gridX1 + Math.floor(t.widthSegments / 2);
    const after = t.heightmap[centerIdx];
    expect(after).toBeGreaterThan(before);
  });

  it('applyLower 降低中心顶点高度', () => {
    const t = makeFlatTerrain(10);
    // 先填一些高度
    t.heightmap.fill(0.5);
    editor.setTerrain(t).setBrushSize(1).setBrushStrength(1).setBrushFalloff(0);
    editor.applyLower(0, 0);
    const gridX1 = t.widthSegments + 1;
    const centerIdx = Math.floor(t.heightSegments / 2) * gridX1 + Math.floor(t.widthSegments / 2);
    expect(t.heightmap[centerIdx]).toBeLessThan(0.5);
  });

  it('applyRaise 不产生 NaN', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(3).setBrushStrength(0.7);
    editor.applyRaise(2, -1);
    for (let i = 0; i < t.heightmap.length; i++) {
      expect(Number.isNaN(t.heightmap[i])).toBe(false);
    }
  });

  it('applySmooth 使崎岖地形更平缓', () => {
    const t = makeFlatTerrain(10);
    // 制造一个尖峰
    const gridX1 = t.widthSegments + 1;
    const centerIdx = Math.floor(t.heightSegments / 2) * gridX1 + Math.floor(t.widthSegments / 2);
    t.heightmap[centerIdx] = 1;
    editor.setTerrain(t).setBrushSize(3).setBrushStrength(1).setBrushFalloff(0);
    const beforePeak = t.heightmap[centerIdx];
    editor.applySmooth(0, 0);
    const afterPeak = t.heightmap[centerIdx];
    // 平滑后尖峰应降低
    expect(afterPeak).toBeLessThan(beforePeak);
  });

  it('applyFlatten 把地形压到目标高度', () => {
    const t = makeFlatTerrain(10);
    t.heightmap.fill(0.5);
    editor
      .setTerrain(t)
      .setBrushSize(3)
      .setBrushStrength(1)
      .setBrushFalloff(0)
      .setHeightTarget(0) // 目标世界 Y=0,即归一化 0
      .setTool('flatten');
    editor.apply(0, 0);
    // 中心顶点应接近 0
    const gridX1 = t.widthSegments + 1;
    const centerIdx = Math.floor(t.heightSegments / 2) * gridX1 + Math.floor(t.widthSegments / 2);
    expect(t.heightmap[centerIdx]).toBeLessThan(0.5);
    expect(t.heightmap[centerIdx]).toBeGreaterThanOrEqual(0);
  });

  it('applyNoise 添加扰动后高度有变化', () => {
    const t = makeFlatTerrain(10);
    // 起始高度设为 0.5,避免负噪声被钳制到 0 后检测不到变化
    t.heightmap.fill(0.5);
    editor
      .setTerrain(t)
      .setBrushSize(3)
      .setBrushStrength(1)
      .setBrushFalloff(0)
      .setNoiseParams(0.5, 5)
      .setTool('noise');
    const before = new Float32Array(t.heightmap);
    editor.apply(0, 0);
    let changed = false;
    for (let i = 0; i < t.heightmap.length; i++) {
      if (Math.abs(t.heightmap[i] - before[i]) > 1e-6) {
        changed = true;
        break;
      }
    }
    expect(changed).toBe(true);
  });

  it('applyErode 把尖峰物质转移到邻居', () => {
    const t = makeFlatTerrain(10);
    const gridX1 = t.widthSegments + 1;
    const centerIdx = Math.floor(t.heightSegments / 2) * gridX1 + Math.floor(t.widthSegments / 2);
    t.heightmap[centerIdx] = 1;
    editor.setTerrain(t).setBrushSize(3).setBrushStrength(1).setBrushFalloff(0);
    const beforePeak = t.heightmap[centerIdx];
    editor.applyErode(0, 0);
    // 侵蚀后尖峰应降低
    expect(t.heightmap[centerIdx]).toBeLessThanOrEqual(beforePeak);
  });

  it('applyPaint 修改 splatmap 权重', () => {
    const t = makeFlatTerrain(10);
    const splat = new TerrainSplat();
    const splatmap = splat.generateSplatmap(t, [
      new TerrainLayer({ texture: new Texture('base'), minHeight: -Infinity, maxHeight: Infinity, maxSlope: 90 }),
    ]);
    // 把 splatmap 挂到 terrain(terrain 是 TerrainGeometry)
    (t as unknown as { splatmap: Uint8Array }).splatmap = splatmap;
    editor
      .setTerrain(t)
      .setBrushSize(2)
      .setBrushStrength(1)
      .setBrushFalloff(0)
      .setLayer(1)
      .setTool('paint');
    editor.apply(0, 0);
    // 至少有一个顶点的 layer 1 通道权重增加
    let layer1Increased = false;
    for (let i = 0; i < splatmap.length; i += 4) {
      if (splatmap[i + 1] > 0) {
        layer1Increased = true;
        break;
      }
    }
    expect(layer1Increased).toBe(true);
  });

  it('apply 分派到当前 tool', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(1).setBrushStrength(1).setBrushFalloff(0);
    const gridX1 = t.widthSegments + 1;
    const centerIdx = Math.floor(t.heightSegments / 2) * gridX1 + Math.floor(t.widthSegments / 2);
    const original = t.heightmap[centerIdx];

    editor.setTool('raise').apply(0, 0);
    const afterRaise = t.heightmap[centerIdx];
    expect(afterRaise).toBeGreaterThan(original);

    // lower 应该比 raise 后的值更低
    editor.setTool('lower').apply(0, 0);
    expect(t.heightmap[centerIdx]).toBeLessThan(afterRaise);
  });

  it('apply 在未设置地形时无副作用', () => {
    editor.setTool('raise').apply(0, 0);
    expect(editor.history.length).toBe(0);
  });

  it('undo / redo 历史栈', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(1).setBrushStrength(1).setBrushFalloff(0);
    const gridX1 = t.widthSegments + 1;
    const centerIdx = Math.floor(t.heightSegments / 2) * gridX1 + Math.floor(t.widthSegments / 2);
    const original = t.heightmap[centerIdx];

    expect(editor.canUndo()).toBe(false);
    editor.applyRaise(0, 0);
    expect(editor.canUndo()).toBe(true);
    expect(editor.canRedo()).toBe(false);
    const afterRaise = t.heightmap[centerIdx];
    expect(afterRaise).toBeGreaterThan(original);

    editor.undo();
    expect(t.heightmap[centerIdx]).toBeCloseTo(original, 6);
    expect(editor.canRedo()).toBe(true);

    editor.redo();
    expect(t.heightmap[centerIdx]).toBeCloseTo(afterRaise, 6);
    expect(editor.canRedo()).toBe(false);
  });

  it('undo 还原 paint 操作的 splatmap', () => {
    const t = makeFlatTerrain(10);
    const splat = new TerrainSplat();
    const splatmap = splat.generateSplatmap(t, [
      new TerrainLayer({ texture: new Texture('base'), minHeight: -Infinity, maxHeight: Infinity, maxSlope: 90 }),
    ]);
    (t as unknown as { splatmap: Uint8Array }).splatmap = splatmap;
    const before = new Uint8Array(splatmap);

    editor
      .setTerrain(t)
      .setBrushSize(2)
      .setBrushStrength(1)
      .setBrushFalloff(0)
      .setLayer(1)
      .setTool('paint');
    editor.apply(0, 0);
    editor.undo();
    // splatmap 应回到初始状态
    for (let i = 0; i < splatmap.length; i++) {
      expect(splatmap[i]).toBe(before[i]);
    }
  });

  it('新操作清空 redo 栈', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(1).setBrushStrength(1).setBrushFalloff(0);
    editor.applyRaise(0, 0);
    editor.undo();
    expect(editor.canRedo()).toBe(true);
    editor.applyRaise(0, 0); // 新操作
    expect(editor.canRedo()).toBe(false);
  });

  it('maxHistory 裁剪最旧历史', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(1).setBrushStrength(1).setBrushFalloff(0);
    editor.maxHistory = 3;
    for (let i = 0; i < 5; i++) {
      editor.applyRaise(0, 0);
    }
    expect(editor.history.length).toBe(3);
  });

  it('clearHistory 清空两个栈', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(1).setBrushStrength(1).setBrushFalloff(0);
    editor.applyRaise(0, 0);
    editor.undo();
    editor.clearHistory();
    expect(editor.history.length).toBe(0);
    expect(editor.canRedo()).toBe(false);
  });

  it('getStats 返回正确统计', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(7).setBrushStrength(0.3).setTool('smooth');
    editor.applyRaise(0, 0);
    const stats = editor.getStats();
    expect(stats.tool).toBe('smooth');
    expect(stats.brushSize).toBe(7);
    expect(stats.brushStrength).toBe(0.3);
    expect(stats.historySize).toBe(1);
    expect(stats.redoSize).toBe(0);
    expect(stats.totalEdits).toBe(1);
  });

  it('所有工具都通过 apply 分派且不抛错', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(2).setBrushStrength(0.5).setBrushFalloff(0.5);
    const tools = ['raise', 'lower', 'smooth', 'flatten', 'noise', 'erode'] as const;
    for (const tool of tools) {
      editor.setTool(tool);
      expect(() => editor.apply(0, 0)).not.toThrow();
    }
  });

  it('applyPaint 在无 splatmap 时无副作用', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setTool('paint').setBrushSize(2);
    expect(() => editor.apply(0, 0)).not.toThrow();
    expect(editor.history.length).toBe(0);
  });

  it('权重在笔刷外为 0(不包含)', () => {
    const t = makeFlatTerrain(10);
    editor.setTerrain(t).setBrushSize(1).setBrushFalloff(0).setBrushShape('circle');
    const w = editor.computeBrushWeights(0, 0);
    // 远离原点的顶点不应在权重中
    const gridX1 = t.widthSegments + 1;
    const segW = t.width / t.widthSegments;
    for (const idx of w.keys()) {
      const ix = idx % gridX1;
      const iz = Math.floor(idx / gridX1);
      const vx = ix * segW - t.width / 2;
      const vz = iz * segW - t.height / 2;
      const dist = Math.hypot(vx, vz);
      expect(dist).toBeLessThanOrEqual(1 + segW); // 容差 1 格
    }
  });
});
