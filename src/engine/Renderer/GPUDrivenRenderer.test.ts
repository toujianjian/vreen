// GPUDrivenRenderer 单元测试。
//
// 覆盖:
//   1. 构造默认值与选项(maxDrawCommands / cullingEnabled / occlusionCulling)
//   2. addDrawCommand / removeDrawCommand / clearDrawCommands
//   3. addDrawCommand 超出 maxDrawCommands 抛错
//   4. addDrawCommand 重复 drawId 抛错
//   5. cull 视锥剔除(可见 / 不可见场景)
//   6. occlusionCull 远距离剔除
//   7. sortCommands 按 materialIndex 排序 + visible 在前
//   8. buildIndirectBuffer / getIndirectBuffer 布局正确
//   9. update 串联(cull → sort → build)
//  10. setCulling / setOcclusionCulling / setMaxDrawCommands
//  11. instanceBuffers get/set/remove
//  12. getVisibilityBuffer
//  13. getStats
//  14. dispose

import { describe, it, expect, beforeEach } from 'vitest';
import { GPUDrivenRenderer, INDIRECT_COMMAND_FLOATS } from './GPUDrivenRenderer';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Vector3 } from '../Math/Vector3';

// ── 构造 ────────────────────────────────────────────────────────

describe('GPUDrivenRenderer construction', () => {
  it('defaults: maxDrawCommands=4096, culling=true, occlusion=false', () => {
    const r = new GPUDrivenRenderer();
    expect(r.maxDrawCommands).toBe(4096);
    expect(r.cullingEnabled).toBe(true);
    expect(r.occlusionCulling).toBe(false);
    expect(r.drawCommands).toHaveLength(0);
    expect(r.indirectBuffer).not.toBeNull();
    expect(r.indirectBuffer!.length).toBe(4096 * INDIRECT_COMMAND_FLOATS);
    expect(r.visibilityBuffer).not.toBeNull();
    expect(r.visibilityBuffer!.length).toBe(4096);
  });

  it('accepts options', () => {
    const r = new GPUDrivenRenderer({ maxDrawCommands: 64, cullingEnabled: false, occlusionCulling: true });
    expect(r.maxDrawCommands).toBe(64);
    expect(r.cullingEnabled).toBe(false);
    expect(r.occlusionCulling).toBe(true);
    expect(r.indirectBuffer!.length).toBe(64 * INDIRECT_COMMAND_FLOATS);
  });

  it('clamps maxDrawCommands to >=1', () => {
    const r = new GPUDrivenRenderer({ maxDrawCommands: 0 });
    expect(r.maxDrawCommands).toBe(1);
  });
});

// ── addDrawCommand / removeDrawCommand ─────────────────────────

describe('GPUDrivenRenderer addDrawCommand / removeDrawCommand', () => {
  let r: GPUDrivenRenderer;
  beforeEach(() => {
    r = new GPUDrivenRenderer({ maxDrawCommands: 8 });
  });

  it('addDrawCommand stores command and assigns drawId', () => {
    const cmd = r.addDrawCommand({
      indexCount: 36, instanceCount: 1, firstIndex: 0,
      vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(0, 0, 0), boundingRadius: 1,
    });
    expect(cmd.drawId).toBe(0);
    expect(cmd.visible).toBe(true);
    expect(r.getDrawCommandCount()).toBe(1);
    expect(r.drawCommands[0]).toBe(cmd);
  });

  it('addDrawCommand clones position', () => {
    const pos = new Vector3(1, 2, 3);
    const cmd = r.addDrawCommand({
      indexCount: 6, instanceCount: 1, firstIndex: 0,
      vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: pos, boundingRadius: 1,
    });
    expect(cmd.position).not.toBe(pos);
    expect(cmd.position.x).toBe(1);
    pos.set(9, 9, 9);
    expect(cmd.position.x).toBe(1); // 不受外部修改影响
  });

  it('addDrawCommand accepts explicit drawId', () => {
    const cmd = r.addDrawCommand({
      drawId: 42, indexCount: 6, instanceCount: 1, firstIndex: 0,
      vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(0, 0, 0), boundingRadius: 1,
    });
    expect(cmd.drawId).toBe(42);
  });

  it('addDrawCommand throws on duplicate drawId', () => {
    r.addDrawCommand({
      drawId: 5, indexCount: 6, instanceCount: 1, firstIndex: 0,
      vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(0, 0, 0), boundingRadius: 1,
    });
    expect(() => r.addDrawCommand({
      drawId: 5, indexCount: 6, instanceCount: 1, firstIndex: 0,
      vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(0, 0, 0), boundingRadius: 1,
    })).toThrow(/already exists/);
  });

  it('addDrawCommand throws when maxDrawCommands exceeded', () => {
    const small = new GPUDrivenRenderer({ maxDrawCommands: 2 });
    small.addDrawCommand({ indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    small.addDrawCommand({ indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    expect(() => small.addDrawCommand({ indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 }))
      .toThrow(/maxDrawCommands/);
  });

  it('removeDrawCommand removes by drawId', () => {
    r.addDrawCommand({ drawId: 1, indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ drawId: 2, indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    expect(r.removeDrawCommand(1)).toBe(true);
    expect(r.getDrawCommandCount()).toBe(1);
    expect(r.drawCommands[0].drawId).toBe(2);
  });

  it('removeDrawCommand unknown drawId returns false', () => {
    expect(r.removeDrawCommand(999)).toBe(false);
  });

  it('clearDrawCommands empties all', () => {
    r.addDrawCommand({ indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.clearDrawCommands();
    expect(r.getDrawCommandCount()).toBe(0);
    expect(r.getVisibleCount()).toBe(0);
  });
});

// ── cull ────────────────────────────────────────────────────────

describe('GPUDrivenRenderer cull', () => {
  it('marks visible=true for in-frustum commands', () => {
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({
      indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(0, 0, -5), boundingRadius: 1,
    });
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    r.cull(cam);
    expect(r.drawCommands[0].visible).toBe(true);
  });

  it('marks visible=false for out-of-frustum commands', () => {
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({
      indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(100, 0, -5), boundingRadius: 0.5,
    });
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    r.cull(cam);
    expect(r.drawCommands[0].visible).toBe(false);
  });

  it('large bounding sphere remains visible even when center is offset', () => {
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({
      indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(2, 0, -5), boundingRadius: 10,
    });
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    r.cull(cam);
    expect(r.drawCommands[0].visible).toBe(true);
  });
});

// ── occlusionCull ───────────────────────────────────────────────

describe('GPUDrivenRenderer occlusionCull', () => {
  it('culls commands beyond far*0.95 along view direction', () => {
    const r = new GPUDrivenRenderer();
    // far=100, threshold=95; 命令在 -100 处,沿视线距离 100 > 95
    r.addDrawCommand({
      indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(0, 0, -100), boundingRadius: 1,
    });
    r.addDrawCommand({
      indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(0, 0, -10), boundingRadius: 1,
    });
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    r.cull(cam); // 先全部标记可见
    r.occlusionCull(cam);
    expect(r.drawCommands[0].visible).toBe(false); // 远
    expect(r.drawCommands[1].visible).toBe(true);  // 近
  });

  it('does not occlude commands behind camera (distAlongView < 0)', () => {
    // 注意:命令在相机后方 (0,0,+5),cull 会先剔除它(视锥外)。
    // 此测试验证 occlusionCull 在独立调用时不会处理已经被 cull 标记为
    // 不可见的命令(即不会错误地把 visible=false 改成 true 或反复操作)。
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({
      indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0,
      materialIndex: 0, lodLevel: 0,
      position: new Vector3(0, 0, 5), boundingRadius: 1, // 相机后方
    });
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    // 手动标记为 visible=true(模拟"未经过 cull"的场景)
    r.drawCommands[0].visible = true;
    r.occlusionCull(cam);
    // distAlongView = (0,0,5)·(0,0,-1) = -5 < threshold,不应被遮挡剔除
    expect(r.drawCommands[0].visible).toBe(true);
  });
});

// ── sortCommands ────────────────────────────────────────────────

describe('GPUDrivenRenderer sortCommands', () => {
  it('places visible commands before invisible', () => {
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(0, 0, -5), boundingRadius: 1 }); // visible (later)
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(100, 0, -5), boundingRadius: 0.5 }); // invisible
    r.drawCommands[0].visible = true;
    r.drawCommands[1].visible = false;
    r.sortCommands();
    expect(r.drawCommands[0].visible).toBe(true);
    expect(r.drawCommands[1].visible).toBe(false);
  });

  it('sorts visible commands by materialIndex ascending', () => {
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 3, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 1, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 2, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.sortCommands();
    expect(r.drawCommands.map(c => c.materialIndex)).toEqual([1, 2, 3]);
  });

  it('rebuilds drawIdToIndex after sort', () => {
    const r = new GPUDrivenRenderer();
    const a = r.addDrawCommand({ drawId: 10, indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 5, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    const b = r.addDrawCommand({ drawId: 20, indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 1, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    void a; void b;
    r.sortCommands();
    // 排序后 drawId=20 在前
    expect(r.drawCommands[0].drawId).toBe(20);
    expect(r.drawCommands[1].drawId).toBe(10);
    // removeDrawCommand 仍能按 drawId 找到
    expect(r.removeDrawCommand(10)).toBe(true);
    expect(r.getDrawCommandCount()).toBe(1);
  });
});

// ── buildIndirectBuffer ─────────────────────────────────────────

describe('GPUDrivenRenderer buildIndirectBuffer', () => {
  it('writes visible commands into indirectBuffer in 5-float stride', () => {
    const r = new GPUDrivenRenderer({ maxDrawCommands: 4 });
    r.addDrawCommand({ indexCount: 36, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 24, instanceCount: 4, firstIndex: 12, vertexOffset: 100, firstInstance: 7, materialIndex: 1, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    // 第 2 个标记不可见
    r.drawCommands[1].visible = false;
    const count = r.buildIndirectBuffer();
    expect(count).toBe(1);
    const buf = r.getIndirectBuffer()!;
    expect(buf[0]).toBe(36); // indexCount
    expect(buf[1]).toBe(1);  // instanceCount
    expect(buf[2]).toBe(0);  // firstIndex
    expect(buf[3]).toBe(0);  // vertexOffset
    expect(buf[4]).toBe(0);  // firstInstance
  });

  it('skips commands with indexCount=0 or instanceCount=0', () => {
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({ indexCount: 0, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 0, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    const count = r.buildIndirectBuffer();
    expect(count).toBe(1);
  });

  it('getVisibleCount matches last build', () => {
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.buildIndirectBuffer();
    expect(r.getVisibleCount()).toBe(2);
  });
});

// ── update ──────────────────────────────────────────────────────

describe('GPUDrivenRenderer update', () => {
  it('runs cull → sort → build pipeline with culling enabled', () => {
    const r = new GPUDrivenRenderer({ cullingEnabled: true });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 2, lodLevel: 0, position: new Vector3(0, 0, -5), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 1, lodLevel: 0, position: new Vector3(0, 0, -5), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(100, 0, -5), boundingRadius: 0.5 }); // 视锥外
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    r.update(0, cam);
    expect(r.getVisibleCount()).toBe(2);
    // 排序后 materialIndex 升序
    expect(r.drawCommands[0].materialIndex).toBe(1);
    expect(r.drawCommands[1].materialIndex).toBe(2);
    expect(r.drawCommands[2].visible).toBe(false);
  });

  it('skips culling when cullingEnabled=false (all visible)', () => {
    const r = new GPUDrivenRenderer({ cullingEnabled: false });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(1000, 0, -5), boundingRadius: 0.1 });
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    r.update(0, cam);
    expect(r.getVisibleCount()).toBe(1);
  });
});

// ── setters ─────────────────────────────────────────────────────

describe('GPUDrivenRenderer setters', () => {
  it('setCulling / setOcclusionCulling toggle flags', () => {
    const r = new GPUDrivenRenderer();
    r.setCulling(false);
    expect(r.cullingEnabled).toBe(false);
    r.setOcclusionCulling(true);
    expect(r.occlusionCulling).toBe(true);
  });

  it('setMaxDrawCommands reallocates buffers', () => {
    const r = new GPUDrivenRenderer({ maxDrawCommands: 16 });
    r.setMaxDrawCommands(32);
    expect(r.maxDrawCommands).toBe(32);
    expect(r.indirectBuffer!.length).toBe(32 * INDIRECT_COMMAND_FLOATS);
    expect(r.visibilityBuffer!.length).toBe(32);
  });

  it('setMaxDrawCommands throws when new max < current command count', () => {
    const r = new GPUDrivenRenderer({ maxDrawCommands: 16 });
    r.addDrawCommand({ indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 1, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    expect(() => r.setMaxDrawCommands(1)).toThrow(/current command count/);
  });
});

// ── instanceBuffers ─────────────────────────────────────────────

describe('GPUDrivenRenderer instanceBuffers', () => {
  it('set / get / remove instance buffer', () => {
    const r = new GPUDrivenRenderer();
    const buf = new Float32Array(16);
    r.setInstanceBuffer('instanceMatrix', buf);
    expect(r.getInstanceBuffer('instanceMatrix')).toBe(buf);
    expect(r.removeInstanceBuffer('instanceMatrix')).toBe(true);
    expect(r.getInstanceBuffer('instanceMatrix')).toBeUndefined();
    expect(r.removeInstanceBuffer('missing')).toBe(false);
  });
});

// ── getVisibilityBuffer ─────────────────────────────────────────

describe('GPUDrivenRenderer getVisibilityBuffer', () => {
  it('writes 0/1 per command visibility', () => {
    const r = new GPUDrivenRenderer({ maxDrawCommands: 4 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.drawCommands[0].visible = true;
    r.drawCommands[1].visible = false;
    const vb = r.getVisibilityBuffer()!;
    expect(vb[0]).toBe(1);
    expect(vb[1]).toBe(0);
    expect(vb[2]).toBe(0); // 未使用槽位为零
    expect(vb[3]).toBe(0);
  });
});

// ── getStats ────────────────────────────────────────────────────

describe('GPUDrivenRenderer getStats', () => {
  it('reports stats after update', () => {
    const r = new GPUDrivenRenderer({ maxDrawCommands: 8, cullingEnabled: true });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(0, 0, -5), boundingRadius: 1 });
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(1000, 0, -5), boundingRadius: 0.1 });
    const cam = new PerspectiveCamera(60, 1, 0.1, 1000);
    cam.position.set(0, 0, 0);
    cam.updateMatrixWorld(true);
    r.update(0, cam);
    const stats = r.getStats();
    expect(stats.totalCommands).toBe(2);
    expect(stats.visibleCount).toBe(1);
    expect(stats.culledCount).toBe(1);
    expect(stats.indirectCommandCount).toBe(1);
    expect(stats.indirectBufferSize).toBe(1 * INDIRECT_COMMAND_FLOATS * 4);
    expect(stats.cullingEnabled).toBe(true);
    expect(stats.occlusionCulling).toBe(false);
    expect(stats.maxDrawCommands).toBe(8);
  });
});

// ── dispose ─────────────────────────────────────────────────────

describe('GPUDrivenRenderer dispose', () => {
  it('clears all state', () => {
    const r = new GPUDrivenRenderer();
    r.addDrawCommand({ indexCount: 6, instanceCount: 1, firstIndex: 0, vertexOffset: 0, firstInstance: 0, materialIndex: 0, lodLevel: 0, position: new Vector3(), boundingRadius: 1 });
    r.setInstanceBuffer('m', new Float32Array(16));
    r.dispose();
    expect(r.drawCommands).toHaveLength(0);
    expect(r.indirectBuffer).toBeNull();
    expect(r.visibilityBuffer).toBeNull();
    expect(r.instanceBuffers.size).toBe(0);
    expect(r.getVisibleCount()).toBe(0);
  });
});
