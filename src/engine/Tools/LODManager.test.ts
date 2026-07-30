// LODManager 单元测试。
//
// 验证:
//   • registerGroup / unregisterGroup / getGroup / getGroups
//   • addLOD / removeLOD
//   • setCamera / setLODDistances / setScreenSpaceThreshold
//   • 距离 LOD 选择(update + selectLOD)
//   • 屏幕占比 LOD 选择(computeScreenRatio + selectLOD)
//   • HLOD 启用/距离/隐藏逻辑
//   • getLODStats / getTotalDrawCalls
//   • setUseScreenSpace

import { describe, it, expect, beforeEach } from 'vitest';
import { LODManager, type LODGroup, type LODLevel } from './LODManager';
import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math/Vector3';
import { Camera } from '../Cameras/Camera';

/** 构造世界位置 (x,y,z) 的 camera(更新 matrixWorld)。 */
function makeCameraAt(x: number, y: number, z: number, fov = 50): Camera {
  class StubCam extends Camera {
    fov = fov;
    override updateProjectionMatrix(): void { /* noop */ }
  }
  const c = new StubCam();
  c.position.set(x, y, z);
  c.updateMatrixWorld(true);
  return c;
}

/** 构造一个简单 LODGroup:object 位于原点,bounds 中心在原点,3 级 LOD。 */
function makeGroup(id: number, opts: { useScreenSpace?: boolean; center?: [number, number, number] } = {}): LODGroup {
  const center = opts.center ?? [0, 0, 0];
  const lods: LODLevel[] = [
    { level: 0, geometry: { id: 'hi' }, material: { id: 'mhi' }, screenRatio: 0.5, distance: 10, drawCalls: 5 },
    { level: 1, geometry: { id: 'mid' }, material: { id: 'mmid' }, screenRatio: 0.2, distance: 25, drawCalls: 3 },
    { level: 2, geometry: { id: 'lo' }, material: { id: 'mlo' }, screenRatio: 0.05, distance: 50, drawCalls: 1 },
  ];
  return {
    id,
    object: new Object3D(),
    lods,
    currentLOD: 0,
    useScreenSpace: opts.useScreenSpace ?? false,
    bounds: {
      min: new Vector3(center[0] - 1, center[1] - 1, center[2] - 1),
      max: new Vector3(center[0] + 1, center[1] + 1, center[2] + 1),
    },
  };
}

describe('LODManager — 注册/查询', () => {
  let mgr: LODManager;
  beforeEach(() => {
    mgr = new LODManager();
  });

  it('registerGroup + getGroup + getGroups + getCurrentLOD', () => {
    const g = makeGroup(1);
    mgr.registerGroup(1, g);
    expect(mgr.getGroup(1)).toBe(g);
    expect(mgr.getGroups()).toHaveLength(1);
    expect(mgr.getCurrentLOD(1)).toBe(0);
    expect(mgr.getCurrentLOD(999)).toBe(-1);
  });

  it('registerGroup 覆盖已存在的 id', () => {
    const g1 = makeGroup(1);
    const g2 = makeGroup(1);
    mgr.registerGroup(1, g1);
    mgr.registerGroup(1, g2);
    expect(mgr.getGroup(1)).toBe(g2);
    expect(mgr.getGroups()).toHaveLength(1);
  });

  it('unregisterGroup', () => {
    mgr.registerGroup(1, makeGroup(1));
    expect(mgr.unregisterGroup(1)).toBe(true);
    expect(mgr.getGroup(1)).toBeUndefined();
    expect(mgr.unregisterGroup(999)).toBe(false);
  });

  it('addLOD / removeLOD', () => {
    const g = makeGroup(1);
    // 移除原来的 3 级,只留 1 级测试 addLOD
    g.lods = [g.lods[0]];
    mgr.registerGroup(1, g);
    const newLod: LODLevel = { level: 3, geometry: {}, material: {}, screenRatio: 0.01, distance: 100, drawCalls: 1 };
    expect(mgr.addLOD(1, newLod)).toBe(true);
    expect(mgr.getGroup(1)!.lods).toHaveLength(2);
    expect(mgr.getGroup(1)!.lods[1].level).toBe(3);
    expect(mgr.addLOD(999, newLod)).toBe(false);

    // removeLOD
    expect(mgr.removeLOD(1, 3)).toBe(true);
    expect(mgr.getGroup(1)!.lods).toHaveLength(1);
    expect(mgr.removeLOD(1, 99)).toBe(false);
    expect(mgr.removeLOD(999, 0)).toBe(false);
  });

  it('setUseScreenSpace', () => {
    mgr.registerGroup(1, makeGroup(1));
    expect(mgr.setUseScreenSpace(1, true)).toBe(true);
    expect(mgr.getGroup(1)!.useScreenSpace).toBe(true);
    expect(mgr.setUseScreenSpace(999, true)).toBe(false);
  });
});

describe('LODManager — 配置', () => {
  it('默认 lodDistances 为 4 级', () => {
    const mgr = new LODManager();
    expect(mgr.lodDistances).toEqual([10, 25, 50, 100]);
  });

  it('setLODDistances 排序', () => {
    const mgr = new LODManager();
    mgr.setLODDistances([100, 10, 50]);
    expect(mgr.lodDistances).toEqual([10, 50, 100]);
  });

  it('setScreenSpaceThreshold clamp 到 [0,1]', () => {
    const mgr = new LODManager();
    mgr.setScreenSpaceThreshold(-1);
    expect(mgr.screenSpaceThreshold).toBe(0);
    mgr.setScreenSpaceThreshold(2);
    expect(mgr.screenSpaceThreshold).toBe(1);
    mgr.setScreenSpaceThreshold(0.3);
    expect(mgr.screenSpaceThreshold).toBeCloseTo(0.3, 6);
  });

  it('setCamera / setHLODDistance', () => {
    const mgr = new LODManager();
    const cam = makeCameraAt(0, 0, 0);
    mgr.setCamera(cam);
    expect(mgr.camera).toBe(cam);
    mgr.setCamera(null);
    expect(mgr.camera).toBeNull();

    mgr.setHLODDistance(500);
    expect(mgr.hlodDistance).toBe(500);
    mgr.setHLODDistance(-10);
    expect(mgr.hlodDistance).toBe(0);
  });

  it('enableHLOD 方法切换 hlodEnabled 标志', () => {
    const mgr = new LODManager();
    expect(mgr.hlodEnabled).toBe(false);
    mgr.enableHLOD(true);
    expect(mgr.hlodEnabled).toBe(true);
    mgr.enableHLOD(false);
    expect(mgr.hlodEnabled).toBe(false);
  });

  it('构造参数 enableHLOD', () => {
    const mgr = new LODManager({ enableHLOD: true, hlodDistance: 300, screenSpaceThreshold: 0.1 });
    expect(mgr.hlodEnabled).toBe(true);
    expect(mgr.hlodDistance).toBe(300);
    expect(mgr.screenSpaceThreshold).toBeCloseTo(0.1, 6);
  });
});

describe('LODManager — 距离 LOD', () => {
  let mgr: LODManager;
  beforeEach(() => {
    mgr = new LODManager();
    mgr.registerGroup(1, makeGroup(1));
  });

  it('近距离 → level 0(高精度)', () => {
    mgr.setCamera(makeCameraAt(5, 0, 0));
    mgr.update(0);
    expect(mgr.getCurrentLOD(1)).toBe(0);
  });

  it('中距离 → level 1', () => {
    mgr.setCamera(makeCameraAt(30, 0, 0));
    mgr.update(0);
    expect(mgr.getCurrentLOD(1)).toBe(1);
  });

  it('远距离 → level 2(低精度)', () => {
    mgr.setCamera(makeCameraAt(80, 0, 0));
    mgr.update(0);
    expect(mgr.getCurrentLOD(1)).toBe(2);
  });

  it('selectLOD 无 camera 时返回 0(默认)', () => {
    const g = mgr.getGroup(1)!;
    // camera=null,selectLOD 走距离策略,_distanceToGroup 返回 0 → 始终命中 level 0。
    expect(mgr.selectLOD(g)).toBe(0);
  });

  it('selectLOD 空 lods 返回 -1', () => {
    const g = makeGroup(2);
    g.lods = [];
    mgr.registerGroup(2, g);
    mgr.setCamera(makeCameraAt(5, 0, 0));
    expect(mgr.selectLOD(g)).toBe(-1);
  });

  it('update 无 camera 时不修改 currentLOD', () => {
    const before = mgr.getCurrentLOD(1);
    mgr.update(0);
    expect(mgr.getCurrentLOD(1)).toBe(before);
  });

  it('Group 自定义 distance 优先于全局 lodDistances', () => {
    // 全局 lodDistances=[10,25,50,100],自定义=[0,5,15]。
    // 相机 dist=20:自定义 → level 2(20>=15);全局 → level 1(20>=10,<25)。
    const g = makeGroup(7);
    g.lods[0].distance = 0;
    g.lods[1].distance = 5;
    g.lods[2].distance = 15;
    mgr.registerGroup(7, g);
    mgr.setCamera(makeCameraAt(20, 0, 0));
    mgr.update(0);
    expect(mgr.getCurrentLOD(7)).toBe(2);
  });
});

describe('LODManager — 屏幕占比 LOD', () => {
  let mgr: LODManager;

  it('computeScreenRatio 远距离 → 小占比', () => {
    mgr = new LODManager();
    const g = makeGroup(1, { useScreenSpace: true });
    mgr.registerGroup(1, g);
    mgr.setCamera(makeCameraAt(100, 0, 0));
    const r = mgr.computeScreenRatio(g);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(0.1);
  });

  it('computeScreenRatio 近距离 → 大占比', () => {
    mgr = new LODManager();
    const g = makeGroup(1, { useScreenSpace: true });
    mgr.registerGroup(1, g);
    mgr.setCamera(makeCameraAt(2, 0, 0));
    const r = mgr.computeScreenRatio(g);
    expect(r).toBeGreaterThan(0.1);
  });

  it('selectLOD 屏幕占比策略:高占比 → level 0', () => {
    mgr = new LODManager();
    const g = makeGroup(1, { useScreenSpace: true });
    mgr.registerGroup(1, g);
    mgr.setCamera(makeCameraAt(2, 0, 0));
    expect(mgr.selectLOD(g)).toBe(0);
  });

  it('selectLOD 屏幕占比策略:低占比 → 最低精度', () => {
    mgr = new LODManager();
    const g = makeGroup(1, { useScreenSpace: true });
    mgr.registerGroup(1, g);
    mgr.setCamera(makeCameraAt(500, 0, 0));
    const idx = mgr.selectLOD(g);
    expect(idx).toBe(g.lods.length - 1);
  });

  it('update 切到屏幕占比模式后正确选择级别', () => {
    mgr = new LODManager();
    const g = makeGroup(1, { useScreenSpace: true });
    mgr.registerGroup(1, g);
    mgr.setCamera(makeCameraAt(500, 0, 0));
    mgr.update(0);
    expect(mgr.getCurrentLOD(1)).toBe(g.lods.length - 1);
  });
});

describe('LODManager — HLOD', () => {
  let mgr: LODManager;
  beforeEach(() => {
    mgr = new LODManager({ enableHLOD: true, hlodDistance: 100 });
    mgr.registerGroup(1, makeGroup(1));
  });

  it('超过 hlodDistance 的 Group 进入 HLOD(currentLOD=-1)', () => {
    mgr.setCamera(makeCameraAt(200, 0, 0));
    mgr.update(0);
    expect(mgr.getCurrentLOD(1)).toBe(-1);
  });

  it('HLOD 禁用时 Group 不进入隐藏状态', () => {
    mgr.enableHLOD(false);
    mgr.setCamera(makeCameraAt(200, 0, 0));
    mgr.update(0);
    expect(mgr.getCurrentLOD(1)).toBeGreaterThanOrEqual(0);
  });

  it('HLOD 边界:正好等于 hlodDistance 不触发', () => {
    mgr.setCamera(makeCameraAt(100, 0, 0));
    mgr.update(0);
    // 距离 == hlodDistance,不进入 HLOD(条件是 > hlodDistance)。
    expect(mgr.getCurrentLOD(1)).toBeGreaterThanOrEqual(0);
  });

  it('getLODStats 反映 hlodActiveCount', () => {
    mgr.registerGroup(2, makeGroup(2));
    mgr.setCamera(makeCameraAt(200, 0, 0));
    mgr.update(0);
    const stats = mgr.getLODStats();
    expect(stats.hlodEnabled).toBe(true);
    expect(stats.hlodActiveCount).toBe(2);
    expect(stats.hiddenCount).toBe(2);
  });
});

describe('LODManager — 统计 / DrawCall', () => {
  it('getLODStats 反映 groupCount / groupsPerLevel', () => {
    const mgr = new LODManager();
    mgr.registerGroup(1, makeGroup(1));
    mgr.registerGroup(2, makeGroup(2));
    mgr.setCamera(makeCameraAt(5, 0, 0));
    mgr.update(0);
    const stats = mgr.getLODStats();
    expect(stats.groupCount).toBe(2);
    expect(stats.groupsPerLevel[0] ?? 0).toBe(2);
    expect(stats.hiddenCount).toBe(0);
    expect(stats.totalDrawCalls).toBe(10); // 两个 group 都在 level 0,drawCalls=5
    expect(stats.screenSpaceGroups).toBe(0);
    expect(stats.hlodEnabled).toBe(false);
  });

  it('getTotalDrawCalls 等于 stats.totalDrawCalls', () => {
    const mgr = new LODManager();
    mgr.registerGroup(1, makeGroup(1));
    mgr.setCamera(makeCameraAt(30, 0, 0));
    mgr.update(0);
    expect(mgr.getTotalDrawCalls()).toBe(mgr.getLODStats().totalDrawCalls);
  });

  it('隐藏的 group 不计入 drawCalls', () => {
    const mgr = new LODManager({ enableHLOD: true, hlodDistance: 50 });
    mgr.registerGroup(1, makeGroup(1));
    mgr.setCamera(makeCameraAt(200, 0, 0));
    mgr.update(0);
    expect(mgr.getTotalDrawCalls()).toBe(0);
    expect(mgr.getLODStats().hiddenCount).toBe(1);
  });
});
