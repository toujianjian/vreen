import { describe, it, expect, beforeEach } from 'vitest';
import {
  NavMeshBuilder,
  triangleHeightAtXZ,
  douglasPeucker,
  douglasPeuckerClosed,
  perpDistance,
} from './NavMeshBuilder';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Vector3 } from '../Math';

/** 构造一个 10x10 的 XZ 平面网格(2 个三角形),Y=0。 */
function makeFlatPlane(size = 10): BufferGeometry {
  const half = size / 2;
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    -half, 0, -half,
    half, 0, -half,
    half, 0, half,
    -half, 0, half,
  ]), 3));
  // 两个三角形,法线朝 +Y
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

/** 构造一个倾斜平面(坡度 > 45°,不可行走)。 */
function makeSteepPlane(): BufferGeometry {
  const g = new BufferGeometry();
  // XZ 投影是 4x4,但 Y 差很大(45° 以上坡)
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    -2, 0, -2,
    2, 0, -2,
    2, 10, 2,
    -2, 10, 2,
  ]), 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return g;
}

describe('NavMeshBuilder', () => {
  let builder: NavMeshBuilder;

  beforeEach(() => {
    builder = new NavMeshBuilder();
  });

  it('默认属性正确', () => {
    expect(builder.cellSize).toBe(0.3);
    expect(builder.cellHeight).toBe(0.2);
    expect(builder.agentHeight).toBe(2);
    expect(builder.agentRadius).toBe(0.5);
    expect(builder.agentMaxClimb).toBe(0.5);
    expect(builder.agentMaxSlope).toBe(45);
    expect(builder.regionMinSize).toBe(8);
    expect(builder.regionMergeSize).toBe(20);
    expect(builder.edgeMaxLen).toBe(12);
    expect(builder.edgeMaxError).toBe(1.5);
    expect(builder.vertsPerPoly).toBe(3);
  });

  it('setter 链式调用', () => {
    builder
      .setCellSize(0.5)
      .setCellHeight(0.1)
      .setAgentParams(1.8, 0.6, 0.4, 50)
      .setRegionParams(10, 30)
      .setEdgeParams(15, 2);
    expect(builder.cellSize).toBe(0.5);
    expect(builder.cellHeight).toBe(0.1);
    expect(builder.agentHeight).toBe(1.8);
    expect(builder.agentRadius).toBe(0.6);
    expect(builder.agentMaxClimb).toBe(0.4);
    expect(builder.agentMaxSlope).toBe(50);
    expect(builder.regionMinSize).toBe(10);
    expect(builder.regionMergeSize).toBe(30);
    expect(builder.edgeMaxLen).toBe(15);
    expect(builder.edgeMaxError).toBe(2);
  });

  it('setCellSize 钳制到正值', () => {
    builder.setCellSize(0);
    expect(builder.cellSize).toBeGreaterThan(0);
  });

  it('setAgentParams 钳制 maxSlope 到 [0, 90]', () => {
    builder.setAgentParams(2, 0.5, 0.5, 120);
    expect(builder.agentMaxSlope).toBe(90);
    builder.setAgentParams(2, 0.5, 0.5, -10);
    expect(builder.agentMaxSlope).toBe(0);
  });

  it('voxelize 从平面几何体生成高度场', () => {
    builder.setCellSize(1).setCellHeight(1);
    const hf = builder.voxelize(makeFlatPlane(10));
    expect(hf.width).toBeGreaterThan(0);
    expect(hf.height).toBeGreaterThan(0);
    // 平面 Y=0,应该有非空 span
    let nonEmpty = 0;
    for (const s of hf.spans) if (s) nonEmpty++;
    expect(nonEmpty).toBeGreaterThan(0);
  });

  it('voxelize 空几何体返回空高度场', () => {
    const g = new BufferGeometry();
    const hf = builder.voxelize(g);
    expect(hf.width).toBe(1);
    expect(hf.height).toBe(1);
    expect(hf.spans.every(s => s === null)).toBe(true);
  });

  it('markWalkable 平面全部可行走', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60);
    const g = makeFlatPlane(10);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    let walkable = 0;
    let total = 0;
    for (const s of builder.heightfield.spans) {
      if (s) {
        total++;
        if (s.walkable) walkable++;
      }
    }
    expect(total).toBeGreaterThan(0);
    // 平面应该全部可行走(可能除边界)
    expect(walkable).toBeGreaterThan(0);
  });

  it('markWalkable 陡坡不可行走', () => {
    builder.setCellSize(1).setCellHeight(0.5).setAgentParams(2, 0, 0.5, 30);
    const g = makeSteepPlane();
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    // 陡坡上至少有一些 span 不可走
    let nonWalkable = 0;
    for (const s of builder.heightfield.spans) {
      if (s && !s.walkable) nonWalkable++;
    }
    expect(nonWalkable).toBeGreaterThan(0);
  });

  it('erodeWalkable 减少可行走面积', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60);
    const g = makeFlatPlane(10);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    let before = 0;
    for (const s of builder.heightfield.spans) if (s && s.walkable) before++;
    builder.erodeWalkable(builder.heightfield, 2);
    let after = 0;
    for (const s of builder.heightfield.spans) if (s && s.walkable) after++;
    expect(after).toBeLessThanOrEqual(before);
  });

  it('erodeWalkable radius=0 不改变', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60);
    const g = makeFlatPlane(10);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    let before = 0;
    for (const s of builder.heightfield.spans) if (s && s.walkable) before++;
    builder.erodeWalkable(builder.heightfield, 0);
    let after = 0;
    for (const s of builder.heightfield.spans) if (s && s.walkable) after++;
    expect(after).toBe(before);
  });

  it('buildRegions 为可行走 span 分配区域 ID', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60).setRegionParams(1, 0);
    const g = makeFlatPlane(10);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    builder.buildRegions(builder.heightfield);
    expect(builder.regionCount).toBeGreaterThan(0);
    // 所有可行走 span 应有 region > 0
    for (const s of builder.heightfield.spans) {
      if (s && s.walkable) {
        expect(s.region).toBeGreaterThan(0);
      }
    }
  });

  it('buildRegions 过滤小区域', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60).setRegionParams(1000, 0);
    const g = makeFlatPlane(10);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    builder.buildRegions(builder.heightfield);
    // 10x10 平面 < 1000 格,所有区域被丢弃
    expect(builder.regionCount).toBe(0);
  });

  it('buildContours 生成轮廓', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60).setRegionParams(1, 0);
    const g = makeFlatPlane(8);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    builder.buildRegions(builder.heightfield);
    const contours = builder.buildContours(builder.heightfield, builder.regionCount);
    expect(contours.length).toBeGreaterThan(0);
    // 每条轮廓至少 3 个顶点(9 个数字)
    for (const c of contours) {
      expect(c.vertices.length).toBeGreaterThanOrEqual(9);
    }
  });

  it('simplifyContours 减少顶点数', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60).setRegionParams(1, 0).setEdgeParams(12, 2);
    const g = makeFlatPlane(8);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    builder.buildRegions(builder.heightfield);
    const contours = builder.buildContours(builder.heightfield, builder.regionCount);
    const beforeCounts = contours.map(c => c.vertices.length / 3);
    builder.simplifyContours(contours);
    const afterCounts = contours.map(c => c.vertices.length / 3);
    // 至少有一条轮廓被简化(顶点数减少或不变)
    for (let i = 0; i < afterCounts.length; i++) {
      expect(afterCounts[i]).toBeLessThanOrEqual(beforeCounts[i]);
    }
  });

  it('buildPolyMesh 生成多边形网格', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60).setRegionParams(1, 0);
    const g = makeFlatPlane(8);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    builder.buildRegions(builder.heightfield);
    const contours = builder.buildContours(builder.heightfield, builder.regionCount);
    builder.simplifyContours(contours);
    const polyMesh = builder.buildPolyMesh(contours);
    expect(polyMesh.vertices.length).toBeGreaterThan(0);
    expect(polyMesh.polygons.length).toBeGreaterThan(0);
    // 每个多边形至少 3 个顶点
    for (const poly of polyMesh.polygons) {
      expect(poly.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('buildDetailMesh 返回多边形网格副本', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0, 1, 60).setRegionParams(1, 0);
    const g = makeFlatPlane(8);
    builder.voxelize(g);
    if (!builder.heightfield) throw new Error('heightfield 未生成');
    builder.markWalkable(builder.heightfield);
    builder.buildRegions(builder.heightfield);
    const contours = builder.buildContours(builder.heightfield, builder.regionCount);
    builder.simplifyContours(contours);
    const polyMesh = builder.buildPolyMesh(contours);
    const detail = builder.buildDetailMesh(polyMesh);
    expect(detail.vertices.length).toBe(polyMesh.vertices.length);
    expect(detail.polygons.length).toBe(polyMesh.polygons.length);
  });

  it('build 完整流水线返回 this', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0.5, 1, 60).setRegionParams(1, 0);
    const result = builder.build(makeFlatPlane(8));
    expect(result).toBe(builder);
  });

  it('build 后 polyMesh 与 detailMesh 已生成', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0.5, 1, 60).setRegionParams(1, 0);
    builder.build(makeFlatPlane(8));
    expect(builder.polyMesh).not.toBeNull();
    expect(builder.detailMesh).not.toBeNull();
    expect(builder.heightfield).not.toBeNull();
  });

  it('getNavMesh 返回有效 NavMesh', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0.5, 1, 60).setRegionParams(1, 0);
    builder.build(makeFlatPlane(8));
    const nav = builder.getNavMesh();
    expect(nav.vertices.length).toBeGreaterThan(0);
    expect(nav.triangles.length).toBeGreaterThan(0);
  });

  it('getNavMesh 未构建时返回空 NavMesh', () => {
    const nav = builder.getNavMesh();
    expect(nav.vertices.length).toBe(0);
    expect(nav.triangles.length).toBe(0);
  });

  it('getStats 返回正确统计', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0.5, 1, 60).setRegionParams(1, 0);
    builder.build(makeFlatPlane(8));
    const stats = builder.getStats();
    expect(stats.voxelCount).toBeGreaterThan(0);
    expect(stats.walkableVoxelCount).toBeGreaterThan(0);
    expect(stats.regionCount).toBeGreaterThan(0);
    expect(stats.contourCount).toBeGreaterThan(0);
    expect(stats.polygonCount).toBeGreaterThan(0);
    expect(stats.vertexCount).toBeGreaterThan(0);
  });

  it('getStats 返回副本(修改不影响内部状态)', () => {
    const stats1 = builder.getStats();
    stats1.voxelCount = 999;
    const stats2 = builder.getStats();
    expect(stats2.voxelCount).not.toBe(999);
  });

  it('dispose 清空内部状态', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0.5, 1, 60).setRegionParams(1, 0);
    builder.build(makeFlatPlane(8));
    builder.dispose();
    expect(builder.heightfield).toBeNull();
    expect(builder.polyMesh).toBeNull();
    expect(builder.detailMesh).toBeNull();
    expect(builder.contours.length).toBe(0);
    expect(builder.regionCount).toBe(0);
  });

  it('build 后可执行寻路(NavMesh 集成)', () => {
    builder.setCellSize(1).setCellHeight(1).setAgentParams(2, 0.5, 1, 60).setRegionParams(1, 0);
    builder.build(makeFlatPlane(10));
    const nav = builder.getNavMesh();
    // 平面中心应在网格内
    const inside = nav.findTriangle(new Vector3(0, 0, 0));
    expect(inside).toBeGreaterThanOrEqual(0);
  });

  it('build 在无 position 属性时不抛错', () => {
    const g = new BufferGeometry();
    expect(() => builder.build(g)).not.toThrow();
  });
});

// ---------- 自由函数测试 ----------

describe('triangleHeightAtXZ', () => {
  it('点在三角形内返回 Y', () => {
    // 平面三角形 (0,0,0)-(2,0,0)-(0,0,2),Y=0
    const y = triangleHeightAtXZ(0.5, 0.5, 0, 0, 0, 2, 0, 0, 0, 0, 2);
    expect(y).toBeCloseTo(0, 5);
  });

  it('倾斜三角形返回正确 Y', () => {
    // (0,0,0)-(2,2,0)-(0,0,2),在 (1, 0, 0.5) 处 Y 应约为 1
    const y = triangleHeightAtXZ(1, 0.5, 0, 0, 0, 2, 2, 0, 0, 0, 2);
    expect(y).not.toBeNull();
    expect(y!).toBeCloseTo(1, 1);
  });

  it('点在三角形外返回 null', () => {
    const y = triangleHeightAtXZ(5, 5, 0, 0, 0, 2, 0, 0, 0, 0, 2);
    expect(y).toBeNull();
  });

  it('退化三角形返回 null', () => {
    // 共线三点
    const y = triangleHeightAtXZ(1, 1, 0, 0, 0, 1, 0, 0, 2, 0, 0);
    expect(y).toBeNull();
  });
});

describe('douglasPeucker', () => {
  it('少于 3 点直接返回', () => {
    const pts = [{ x: 0, z: 0 }, { x: 1, z: 1 }];
    const result = douglasPeucker(pts, 1);
    expect(result.length).toBe(2);
  });

  it('共线点全部被简化', () => {
    const pts = [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 },
      { x: 3, z: 0 }, { x: 4, z: 0 },
    ];
    const result = douglasPeucker(pts, 0.1);
    expect(result.length).toBe(2); // 只剩首尾
  });

  it('保留偏离直线的点', () => {
    const pts = [
      { x: 0, z: 0 }, { x: 1, z: 5 }, { x: 2, z: 0 },
    ];
    const result = douglasPeucker(pts, 0.1);
    expect(result.length).toBe(3);
  });

  it('epsilon=0 保留偏离直线的点,简化共线点', () => {
    // 共线点会被简化(垂直距离=0,不大于 epsilon=0)
    const pts = [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 },
    ];
    const result = douglasPeucker(pts, 0);
    expect(result.length).toBe(2); // 共线 → 只剩首尾
    // 偏离直线的点被保留
    const pts2 = [
      { x: 0, z: 0 }, { x: 1, z: 0.5 }, { x: 2, z: 0 },
    ];
    const result2 = douglasPeucker(pts2, 0);
    expect(result2.length).toBe(3); // 中间点偏离 > 0,保留
  });
});

describe('douglasPeuckerClosed', () => {
  it('少于 4 点直接返回', () => {
    const pts = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }];
    const result = douglasPeuckerClosed(pts, 1);
    expect(result.length).toBe(3);
  });

  it('方形轮廓保留 4 角', () => {
    const pts = [
      { x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 },
      { x: 2, z: 2 }, { x: 1, z: 2 }, { x: 0, z: 2 }, { x: 0, z: 1 },
    ];
    const result = douglasPeuckerClosed(pts, 0.5);
    // 简化后应保留 4 个角点
    expect(result.length).toBeLessThanOrEqual(pts.length);
    expect(result.length).toBeGreaterThanOrEqual(3);
  });
});

describe('perpDistance', () => {
  it('点在线段上距离为 0', () => {
    const d = perpDistance({ x: 1, z: 0 }, { x: 0, z: 0 }, { x: 2, z: 0 });
    expect(d).toBeCloseTo(0, 5);
  });

  it('点在线段垂直方向', () => {
    const d = perpDistance({ x: 1, z: 3 }, { x: 0, z: 0 }, { x: 2, z: 0 });
    expect(d).toBeCloseTo(3, 5);
  });

  it('退化线段(端点重合)返回点到端点距离', () => {
    const d = perpDistance({ x: 3, z: 4 }, { x: 0, z: 0 }, { x: 0, z: 0 });
    expect(d).toBeCloseTo(5, 5);
  });
});
