import { describe, it, expect } from 'vitest';
import { BatchedMesh } from './BatchedMesh';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { BasicMaterial } from './Material';
import { Matrix4 } from '../Math/Matrix4';
import { Box3 } from '../Math/Box3';
import { Vector3 } from '../Math/Vector3';

// ── 辅助:创建简单三角形几何体 ──
function makeTriangle(x: number, z: number): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([
    x, 0, z,
    x + 1, 0, z,
    x + 0.5, 1, z,
  ]), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array([
    0, 0, 1, 0, 0.5, 1,
  ]), 2));
  geo.setIndex([0, 1, 2]);
  geo.computeBoundingBox();
  return geo;
}

// ── 辅助:创建四边形几何体 ──
function makeQuad(x: number, z: number): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([
    x, 0, z,
    x + 1, 0, z,
    x + 1, 1, z,
    x, 1, z,
  ]), 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  geo.computeBoundingBox();
  return geo;
}

// ── 辅助:创建无索引几何体 ──
function makeNonIndexed(x: number, z: number): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array([
    x, 0, z,
    x + 1, 0, z,
    x + 0.5, 1, z,
  ]), 3));
  geo.computeBoundingBox();
  return geo;
}

describe('BatchedMesh', () => {
  // ── 构造 ──

  it('默认构造:预分配缓冲区', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    expect(mesh.maxVertexCount).toBe(100);
    expect(mesh.maxIndexCount).toBe(300);
    expect(mesh.activeInstances).toBe(0);
    expect(mesh.batchCount).toBe(0);
  });

  it('内部几何体有 position / normal / uv / index 属性', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    expect(mesh.geometry.getAttribute('position')).toBeDefined();
    expect(mesh.geometry.getAttribute('normal')).toBeDefined();
    expect(mesh.geometry.getAttribute('uv')).toBeDefined();
    expect(mesh.geometry.index).toBeDefined();
  });

  it('maxIndexCount = 0 时不创建索引缓冲', () => {
    const mesh = new BatchedMesh(100, 0, new BasicMaterial());
    expect(mesh.geometry.index).toBeNull();
  });

  // ── addGeometry ──

  it('addGeometry 返回批次 ID', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id = mesh.addGeometry(makeTriangle(0, 0));
    expect(id).toBe(0);
    expect(mesh.activeInstances).toBe(1);
  });

  it('addGeometry 多个几何体,ID 递增', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id1 = mesh.addGeometry(makeTriangle(0, 0));
    const id2 = mesh.addGeometry(makeTriangle(2, 0));
    const id3 = mesh.addGeometry(makeTriangle(4, 0));
    expect(id1).toBe(0);
    expect(id2).toBe(1);
    expect(id3).toBe(2);
    expect(mesh.activeInstances).toBe(3);
  });

  it('addGeometry:顶点数据正确复制', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const geo = makeTriangle(5, 3);
    mesh.addGeometry(geo);

    const pos = mesh.geometry.getAttribute('position')!;
    // 第一个顶点应在 (5, 0, 3)
    expect(pos.array[0]).toBe(5);
    expect(pos.array[1]).toBe(0);
    expect(pos.array[2]).toBe(3);
  });

  it('addGeometry:索引偏移正确', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    mesh.addGeometry(makeTriangle(0, 0)); // 3 顶点, 3 索引
    mesh.addGeometry(makeTriangle(2, 0)); // 3 顶点, 3 索引

    const idx = mesh.geometry.index!;
    // 第二个三角形的索引应偏移 3(第一个三角形的顶点数)
    // 原始索引 [0,1,2] → 偏移后 [3,4,5]
    expect(idx.array[3]).toBe(3);
    expect(idx.array[4]).toBe(4);
    expect(idx.array[5]).toBe(5);
  });

  it('addGeometry:空间不足时抛错', () => {
    const mesh = new BatchedMesh(2, 10, new BasicMaterial());
    expect(() => mesh.addGeometry(makeTriangle(0, 0))).toThrow('vertex buffer overflow');
  });

  it('addGeometry:无 position 属性时抛错', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const empty = new BufferGeometry();
    expect(() => mesh.addGeometry(empty)).toThrow('position');
  });

  it('addGeometry:无索引几何体', () => {
    const mesh = new BatchedMesh(100, 10, new BasicMaterial());
    const id = mesh.addGeometry(makeNonIndexed(0, 0));
    expect(id).toBe(0);
    expect(mesh.activeInstances).toBe(1);
  });

  it('addGeometry:预留空间 > 实际空间', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const geo = makeTriangle(0, 0); // 3 顶点
    const id = mesh.addGeometry(geo, 10, 10); // 预留 10 顶点 / 10 索引
    expect(id).toBe(0);
    // 下一个几何体应从顶点 10 开始
    mesh.addGeometry(makeTriangle(1, 0));
    const pos = mesh.geometry.getAttribute('position')!;
    // 第二个几何体第一个顶点的 X 应为 1,位置在 array[10*3] = array[30]
    expect(pos.array[30]).toBe(1);
  });

  // ── deleteGeometry ──

  it('deleteGeometry:批次标记为删除', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id = mesh.addGeometry(makeTriangle(0, 0));
    mesh.deleteGeometry(id);
    expect(mesh.activeInstances).toBe(0);
    expect(mesh.getVisibleAt(id)).toBe(false);
  });

  it('deleteGeometry:删除后再添加复用 ID', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id1 = mesh.addGeometry(makeTriangle(0, 0));
    mesh.deleteGeometry(id1);
    const id2 = mesh.addGeometry(makeTriangle(1, 0));
    // 复用已删除的 ID
    expect(id2).toBe(id1);
  });

  it('deleteGeometry:删除不存在的 ID 无效果', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    mesh.deleteGeometry(999); // 不应抛错
    expect(mesh.activeInstances).toBe(0);
  });

  // ── setMatrixAt / getMatrixAt ──

  it('setMatrixAt / getMatrixAt:设置和获取变换矩阵', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id = mesh.addGeometry(makeTriangle(0, 0));
    const mat = new Matrix4().makeTranslation(5, 10, 15);
    mesh.setMatrixAt(id, mat);

    const out = mesh.getMatrixAt(id);
    // 平移矩阵的元素 [12, 13, 14] = (5, 10, 15)
    expect(out.elements[12]).toBe(5);
    expect(out.elements[13]).toBe(10);
    expect(out.elements[14]).toBe(15);
  });

  it('getMatrixAt:默认为单位矩阵', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id = mesh.addGeometry(makeTriangle(0, 0));
    const out = mesh.getMatrixAt(id);
    expect(out.elements[0]).toBe(1);
    expect(out.elements[5]).toBe(1);
    expect(out.elements[10]).toBe(1);
    expect(out.elements[15]).toBe(1);
  });

  it('getMatrixAt:可复用 out 参数', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id = mesh.addGeometry(makeTriangle(0, 0));
    const reuse = new Matrix4();
    const result = mesh.getMatrixAt(id, reuse);
    expect(result).toBe(reuse);
  });

  // ── setVisibleAt / getVisibleAt ──

  it('setVisibleAt / getVisibleAt', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id = mesh.addGeometry(makeTriangle(0, 0));
    expect(mesh.getVisibleAt(id)).toBe(true); // 默认可见
    mesh.setVisibleAt(id, false);
    expect(mesh.getVisibleAt(id)).toBe(false);
    mesh.setVisibleAt(id, true);
    expect(mesh.getVisibleAt(id)).toBe(true);
  });

  // ── setBoundingBoxAt / getBoundingBoxAt ──

  it('setBoundingBoxAt / getBoundingBoxAt', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id = mesh.addGeometry(makeTriangle(0, 0));
    const box = new Box3(new Vector3(-1, -2, -3), new Vector3(4, 5, 6));
    mesh.setBoundingBoxAt(id, box);
    const out = mesh.getBoundingBoxAt(id);
    expect(out.min.x).toBe(-1);
    expect(out.min.y).toBe(-2);
    expect(out.max.x).toBe(4);
    expect(out.max.y).toBe(5);
  });

  // ── getDrawRanges ──

  it('getDrawRanges:返回可见批次的 draw range', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    mesh.addGeometry(makeTriangle(0, 0)); // 3 索引
    mesh.addGeometry(makeTriangle(1, 0)); // 3 索引
    const ranges = mesh.getDrawRanges();
    expect(ranges.length).toBe(2);
    expect(ranges[0].start).toBe(0);
    expect(ranges[0].count).toBe(3);
    expect(ranges[1].start).toBe(3);
    expect(ranges[1].count).toBe(3);
  });

  it('getDrawRanges:隐藏的批次不返回', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id1 = mesh.addGeometry(makeTriangle(0, 0));
    mesh.addGeometry(makeTriangle(1, 0));
    mesh.setVisibleAt(id1, false);
    const ranges = mesh.getDrawRanges();
    expect(ranges.length).toBe(1);
  });

  it('getDrawRanges:删除的批次不返回', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id1 = mesh.addGeometry(makeTriangle(0, 0));
    mesh.addGeometry(makeTriangle(1, 0));
    mesh.deleteGeometry(id1);
    const ranges = mesh.getDrawRanges();
    expect(ranges.length).toBe(1);
  });

  it('getDrawRanges:无索引几何体使用顶点范围', () => {
    const mesh = new BatchedMesh(100, 10, new BasicMaterial());
    mesh.addGeometry(makeNonIndexed(0, 0)); // 3 顶点,无索引
    const ranges = mesh.getDrawRanges();
    expect(ranges.length).toBe(1);
    expect(ranges[0].count).toBe(3); // 顶点数
  });

  it('getDrawRanges:包含矩阵数据', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id = mesh.addGeometry(makeTriangle(0, 0));
    mesh.setMatrixAt(id, new Matrix4().makeTranslation(7, 8, 9));
    const ranges = mesh.getDrawRanges();
    expect(ranges[0].matrix[12]).toBe(7);
    expect(ranges[0].matrix[13]).toBe(8);
    expect(ranges[0].matrix[14]).toBe(9);
  });

  // ── getMatrixTextureData ──

  it('getMatrixTextureData:长度 = batchCount × 16', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    mesh.addGeometry(makeTriangle(0, 0));
    mesh.addGeometry(makeTriangle(1, 0));
    const data = mesh.getMatrixTextureData();
    expect(data.length).toBe(2 * 16);
  });

  it('getMatrixTextureData:已删除批次矩阵为全零', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id1 = mesh.addGeometry(makeTriangle(0, 0));
    mesh.addGeometry(makeTriangle(1, 0));
    mesh.deleteGeometry(id1);
    const data = mesh.getMatrixTextureData();
    // 第一个批次(已删除)的矩阵应为全零
    for (let i = 0; i < 16; i++) {
      expect(data[i]).toBe(0);
    }
    // 第二个批次(活跃)的矩阵应有单位矩阵对角线
    expect(data[16 + 0]).toBe(1);
    expect(data[16 + 5]).toBe(1);
    expect(data[16 + 10]).toBe(1);
    expect(data[16 + 15]).toBe(1);
  });

  // ── optimize ──

  it('optimize:压缩碎片,回收已删除空间', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    mesh.addGeometry(makeTriangle(0, 0)); // id=0, 3 顶点
    mesh.addGeometry(makeTriangle(1, 0)); // id=1, 3 顶点
    mesh.addGeometry(makeTriangle(2, 0)); // id=2, 3 顶点
    mesh.deleteGeometry(1); // 删除中间的
    expect(mesh.activeInstances).toBe(2);

    mesh.optimize();
    expect(mesh.activeInstances).toBe(2);
    expect(mesh.batchCount).toBe(2); // 压缩后只有 2 个批次
  });

  it('optimize:无删除时无效果', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    mesh.addGeometry(makeTriangle(0, 0));
    mesh.addGeometry(makeTriangle(1, 0));
    mesh.optimize();
    expect(mesh.batchCount).toBe(2);
    expect(mesh.activeInstances).toBe(2);
  });

  // ── geometry.groups ──

  it('geometry.groups:每个可见批次一个 group', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    mesh.addGeometry(makeTriangle(0, 0));
    mesh.addGeometry(makeTriangle(1, 0));
    mesh.addGeometry(makeTriangle(2, 0));
    expect(mesh.geometry.groups.length).toBe(3);
  });

  it('geometry.groups:隐藏的批次不生成 group', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    const id1 = mesh.addGeometry(makeTriangle(0, 0));
    mesh.addGeometry(makeTriangle(1, 0));
    mesh.setVisibleAt(id1, false);
    expect(mesh.geometry.groups.length).toBe(1);
  });

  // ── 集成测试 ──

  it('完整流程:添加 → 变换 → 隐藏 → 删除 → 优化', () => {
    const mesh = new BatchedMesh(1000, 3000, new BasicMaterial());

    // 添加 5 个几何体
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(mesh.addGeometry(makeTriangle(i, 0)));
    }
    expect(mesh.activeInstances).toBe(5);

    // 设置变换
    for (let i = 0; i < 5; i++) {
      mesh.setMatrixAt(ids[i], new Matrix4().makeTranslation(i * 10, 0, 0));
    }

    // 隐藏第 3 个
    mesh.setVisibleAt(ids[2], false);
    expect(mesh.getDrawRanges().length).toBe(4);

    // 删除第 1 和第 4 个(ids[2] 隐藏但未删除,仍计入 active)
    mesh.deleteGeometry(ids[1]);
    mesh.deleteGeometry(ids[4]);
    expect(mesh.activeInstances).toBe(3); // 5 - 2(deleted) = 3

    // 优化后压缩
    mesh.optimize();
    expect(mesh.batchCount).toBe(3); // 5 - 2 deleted = 3
    expect(mesh.activeInstances).toBe(3);

    // draw ranges 应只有可见的 2 个(ids[2] 仍隐藏)
    // 但 optimize 后 ID 已变化,需要重新检查
    const ranges = mesh.getDrawRanges();
    expect(ranges.length).toBe(2); // 3 active - 1 hidden = 2 visible
  });

  it('大量几何体:性能验证(100 个三角形)', () => {
    const mesh = new BatchedMesh(10000, 30000, new BasicMaterial());
    for (let i = 0; i < 100; i++) {
      mesh.addGeometry(makeTriangle(i * 2, 0));
    }
    expect(mesh.activeInstances).toBe(100);
    expect(mesh.getDrawRanges().length).toBe(100);
  });

  it('四边形(6 索引)与三角形(3 索引)混合', () => {
    const mesh = new BatchedMesh(100, 300, new BasicMaterial());
    mesh.addGeometry(makeTriangle(0, 0)); // 3 顶点, 3 索引
    mesh.addGeometry(makeQuad(2, 0));     // 4 顶点, 6 索引
    mesh.addGeometry(makeTriangle(4, 0)); // 3 顶点, 3 索引

    const ranges = mesh.getDrawRanges();
    expect(ranges.length).toBe(3);
    expect(ranges[0].count).toBe(3); // 三角形
    expect(ranges[1].count).toBe(6); // 四边形
    expect(ranges[2].count).toBe(3); // 三角形

    // 检查索引偏移
    // 三角形: 0-2, 四边形: 3-8, 三角形: 9-11
    expect(ranges[0].start).toBe(0);
    expect(ranges[1].start).toBe(3);
    expect(ranges[2].start).toBe(9);
  });
});
