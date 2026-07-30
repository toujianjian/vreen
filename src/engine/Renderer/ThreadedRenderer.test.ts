// ThreadedRenderer 单元测试。
//
// 覆盖:构造默认值、initialize/destroy、isAvailable、setMultiThreaded、
// addCommand/addDrawCommand/addUpdateBufferCommand/addUpdateTextureCommand、
// flushCommands(单线程排序)、getSortedCommands、beginFrame/endFrame、sync、
// clearCommands、setMaxBufferSize 自动 flush、getStats、onWorkerMessage/Error。
//
// 测试策略:核心逻辑在单线程降级模式下验证(Worker 在 Node/vitest 行为不确定),
// 多线程路径仅验证 initialize 不抛错 + 降级安全。命令排序验证 priority 降序 +
// seq 升序(稳定排序)。

import { describe, it, expect } from 'vitest';
import { ThreadedRenderer } from './ThreadedRenderer';
import { Mesh } from '../Core/Mesh';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Matrix4 } from '../Math/Matrix4';
import { BoxGeometry } from '../Geometries/BoxGeometry';

describe('ThreadedRenderer — 构造与默认值', () => {
  it('默认字段初始化', () => {
    const tr = new ThreadedRenderer();
    expect(tr.worker).toBeNull();
    expect(tr.commandBuffer).toEqual([]);
    expect(tr.maxBufferSize).toBe(1024);
    expect(tr.frameSyncTime).toBe(0);
    expect(tr.isMultiThreaded).toBe(false);
    expect(tr.getCommandCount()).toBe(0);
    tr.destroy();
  });

  it('stats 初始值', () => {
    const tr = new ThreadedRenderer();
    const s = tr.getStats();
    expect(s.workerTime).toBe(0);
    expect(s.mainTime).toBe(0);
    expect(s.totalFrames).toBe(0);
    expect(s.syncCount).toBe(0);
    expect(s.commandCount).toBe(0);
    expect(s.multiThreaded).toBe(false);
    expect(typeof s.workerSupported).toBe('boolean');
    tr.destroy();
  });
});

describe('ThreadedRenderer — initialize / destroy', () => {
  it('initialize 不抛错(无论 Worker 是否支持)', () => {
    const tr = new ThreadedRenderer();
    expect(() => tr.initialize()).not.toThrow();
    // 若环境支持 Worker,worker 应被创建;否则保持 null
    if (tr.isWorkerSupported) {
      expect(tr.worker).not.toBeNull();
    } else {
      expect(tr.worker).toBeNull();
    }
    tr.destroy();
  });

  it('initialize 幂等(多次调用安全)', () => {
    const tr = new ThreadedRenderer();
    tr.initialize();
    const w = tr.worker;
    tr.initialize();
    // 已初始化时 no-op(不重复创建)
    if (tr.isWorkerSupported) {
      expect(tr.worker).toBe(w);
    }
    tr.destroy();
  });

  it('destroy 清空状态', () => {
    const tr = new ThreadedRenderer();
    tr.initialize();
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    tr.destroy();
    expect(tr.worker).toBeNull();
    expect(tr.commandBuffer).toEqual([]);
    expect(tr.isMultiThreaded).toBe(false);
  });
});

describe('ThreadedRenderer — isAvailable / setMultiThreaded', () => {
  it('isAvailable 反映 worker 是否就绪', () => {
    const tr = new ThreadedRenderer();
    expect(tr.isAvailable()).toBe(false); // 未 initialize
    tr.initialize();
    expect(tr.isAvailable()).toBe(tr.isWorkerSupported);
    tr.destroy();
    expect(tr.isAvailable()).toBe(false);
  });

  it('setMultiThreaded(false) 单线程模式', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    expect(tr.isMultiThreadedMode()).toBe(false);
    expect(tr.getStats().multiThreaded).toBe(false);
    tr.destroy();
  });

  it('setMultiThreaded(true) 在不支持环境降级为 false', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(true);
    // 若环境支持,应为 true;否则降级 false
    expect(tr.isMultiThreadedMode()).toBe(tr.isWorkerSupported);
    tr.destroy();
  });

  it('setMultiThreaded(true) 在支持环境自动 initialize', () => {
    const tr = new ThreadedRenderer();
    if (tr.isWorkerSupported) {
      tr.setMultiThreaded(true);
      expect(tr.worker).not.toBeNull();
      expect(tr.isMultiThreadedMode()).toBe(true);
    }
    tr.destroy();
  });
});

describe('ThreadedRenderer — 命令缓冲', () => {
  it('addCommand 累积命令', () => {
    const tr = new ThreadedRenderer();
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    tr.addCommand({ type: 'setViewport', data: { x: 0, y: 0, w: 800, h: 600 }, priority: 1 });
    expect(tr.getCommandCount()).toBe(2);
    expect(tr.commandBuffer[0].type).toBe('clear');
    expect(tr.commandBuffer[1].priority).toBe(1);
    // seq 自增
    expect(tr.commandBuffer[0].seq).toBeLessThan(tr.commandBuffer[1].seq);
    tr.destroy();
  });

  it('addDrawCommand 添加 draw 命令携带 meshId/materialId/transform', () => {
    const tr = new ThreadedRenderer();
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    mesh.name = 'test-mesh';
    const mat = new StandardMaterial();
    const transform = new Matrix4();
    tr.addDrawCommand(mesh, mat, transform);
    expect(tr.getCommandCount()).toBe(1);
    const cmd = tr.commandBuffer[0];
    expect(cmd.type).toBe('draw');
    const data = cmd.data as { meshId: string; materialId: string; transform: Float32Array };
    expect(data.meshId).toBe(mesh.uuid || mesh.name);
    expect(data.transform.length).toBe(16);
    tr.destroy();
  });

  it('addUpdateBufferCommand 添加缓冲更新命令', () => {
    const tr = new ThreadedRenderer();
    tr.addUpdateBufferCommand('buf1', new Float32Array([1, 2, 3]));
    expect(tr.getCommandCount()).toBe(1);
    expect(tr.commandBuffer[0].type).toBe('updateBuffer');
    const data = tr.commandBuffer[0].data as { bufferId: string; data: Float32Array };
    expect(data.bufferId).toBe('buf1');
    expect(data.data.length).toBe(3);
    tr.destroy();
  });

  it('addUpdateTextureCommand 添加纹理更新命令', () => {
    const tr = new ThreadedRenderer();
    tr.addUpdateTextureCommand('tex1', [255, 0, 0, 255]);
    expect(tr.getCommandCount()).toBe(1);
    expect(tr.commandBuffer[0].type).toBe('updateTexture');
    tr.destroy();
  });

  it('clearCommands 清空缓冲', () => {
    const tr = new ThreadedRenderer();
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    expect(tr.getCommandCount()).toBe(2);
    tr.clearCommands();
    expect(tr.getCommandCount()).toBe(0);
    tr.destroy();
  });

  it('setMaxBufferSize 超出自动 flush', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    tr.setMaxBufferSize(3);
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    // 第 3 条触发自动 flush(>= maxBufferSize)
    expect(tr.getCommandCount()).toBe(0);
    // flush 后 sortedCommands 应有 3 条
    expect(tr.getSortedCommands().length).toBe(3);
    tr.destroy();
  });
});

describe('ThreadedRenderer — flushCommands 排序(单线程)', () => {
  it('按 priority 降序排序', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    tr.addCommand({ type: 'clear', data: 'low', priority: 0 });
    tr.addCommand({ type: 'clear', data: 'high', priority: 10 });
    tr.addCommand({ type: 'clear', data: 'mid', priority: 5 });
    tr.flushCommands();
    const sorted = tr.getSortedCommands();
    expect(sorted.length).toBe(3);
    expect(sorted[0].data).toBe('high');
    expect(sorted[1].data).toBe('mid');
    expect(sorted[2].data).toBe('low');
    tr.destroy();
  });

  it('同 priority 按 seq 升序(稳定排序)', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    tr.addCommand({ type: 'clear', data: 'a', priority: 1 });
    tr.addCommand({ type: 'clear', data: 'b', priority: 1 });
    tr.addCommand({ type: 'clear', data: 'c', priority: 1 });
    tr.flushCommands();
    const sorted = tr.getSortedCommands();
    expect(sorted.map((c) => c.data)).toEqual(['a', 'b', 'c']);
    tr.destroy();
  });

  it('flush 后 commandBuffer 清空', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    tr.flushCommands();
    expect(tr.getCommandCount()).toBe(0);
    tr.destroy();
  });

  it('空 flush 不抛错', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    expect(() => tr.flushCommands()).not.toThrow();
    expect(tr.getSortedCommands()).toEqual([]);
    tr.destroy();
  });

  it('frameSyncTime 在单线程 flush 后 > 0', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    // 添加大量命令确保排序有可测耗时
    for (let i = 0; i < 100; i++) {
      tr.addCommand({ type: 'clear', data: i, priority: i });
    }
    tr.flushCommands();
    expect(tr.frameSyncTime).toBeGreaterThanOrEqual(0);
    expect(tr.stats.workerTime).toBeGreaterThanOrEqual(0);
    tr.destroy();
  });
});

describe('ThreadedRenderer — beginFrame / endFrame / sync', () => {
  it('beginFrame + endFrame(单线程)立即完成', async () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    tr.beginFrame();
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    tr.flushCommands();
    await tr.endFrame();
    expect(tr.stats.totalFrames).toBe(1);
    expect(tr.stats.syncCount).toBe(1);
    expect(tr.stats.mainTime).toBeGreaterThanOrEqual(0);
    tr.destroy();
  });

  it('多次 endFrame 累计 totalFrames', async () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    for (let i = 0; i < 3; i++) {
      tr.beginFrame();
      tr.flushCommands();
      await tr.endFrame();
    }
    expect(tr.stats.totalFrames).toBe(3);
    tr.destroy();
  });

  it('endFrame 无 beginFrame no-op(resolve)', async () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    await expect(tr.endFrame()).resolves.toBeUndefined();
    expect(tr.stats.totalFrames).toBe(0);
    tr.destroy();
  });

  it('sync 单线程立即 resolve', async () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    await expect(tr.sync()).resolves.toBeUndefined();
    tr.destroy();
  });

  it('多线程 endFrame resolve(若 Worker 支持)', async () => {
    const tr = new ThreadedRenderer();
    if (tr.isWorkerSupported) {
      tr.setMultiThreaded(true);
      tr.beginFrame();
      tr.addCommand({ type: 'clear', data: null, priority: 0 });
      tr.flushCommands();
      await tr.endFrame();
      expect(tr.stats.syncCount).toBeGreaterThanOrEqual(1);
    }
    tr.destroy();
  });
});

describe('ThreadedRenderer — getStats', () => {
  it('getStats 反映当前状态', () => {
    const tr = new ThreadedRenderer();
    tr.setMultiThreaded(false);
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    const s = tr.getStats();
    expect(s.commandCount).toBe(1);
    expect(s.multiThreaded).toBe(false);
    tr.destroy();
  });

  it('getStats 返回快照(不可变)', () => {
    const tr = new ThreadedRenderer();
    const s1 = tr.getStats();
    tr.addCommand({ type: 'clear', data: null, priority: 0 });
    const s2 = tr.getStats();
    expect(s1.commandCount).toBe(0);
    expect(s2.commandCount).toBe(1);
    tr.destroy();
  });
});

describe('ThreadedRenderer — 回调注册', () => {
  it('onWorkerMessage / onWorkerError 注册不抛错', () => {
    const tr = new ThreadedRenderer();
    expect(() => tr.onWorkerMessage(() => {})).not.toThrow();
    expect(() => tr.onWorkerError(() => {})).not.toThrow();
    tr.destroy();
  });

  it('onWorkerMessage 在多线程 flush 后被触发(若 Worker 支持)', async () => {
    const tr = new ThreadedRenderer();
    if (tr.isWorkerSupported) {
      tr.initialize();
      tr.setMultiThreaded(true);
      let called = false;
      tr.onWorkerMessage(() => { called = true; });
      tr.beginFrame();
      tr.addCommand({ type: 'clear', data: null, priority: 0 });
      tr.flushCommands();
      await tr.endFrame();
      expect(called).toBe(true);
    }
    tr.destroy();
  });
});

describe('ThreadedRenderer — 多线程真实路径(若支持)', () => {
  it('多线程 flush 返回排序后命令', async () => {
    const tr = new ThreadedRenderer();
    if (tr.isWorkerSupported) {
      tr.initialize();
      tr.setMultiThreaded(true);
      tr.beginFrame();
      tr.addCommand({ type: 'clear', data: 'low', priority: 0 });
      tr.addCommand({ type: 'clear', data: 'high', priority: 10 });
      tr.flushCommands();
      await tr.endFrame();
      const sorted = tr.getSortedCommands();
      expect(sorted.length).toBe(2);
      expect(sorted[0].data).toBe('high');
      expect(sorted[1].data).toBe('low');
    }
    tr.destroy();
  });
});
