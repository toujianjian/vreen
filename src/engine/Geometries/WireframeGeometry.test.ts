import { describe, it, expect } from 'vitest';
import { WireframeGeometry } from './WireframeGeometry';
import { BoxGeometry } from './BoxGeometry';
import { PlaneGeometry } from './PlaneGeometry';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';

describe('WireframeGeometry', () => {
  it('从 BoxGeometry 抽取 18 条不重复边(12 立方边 + 6 面对角线)', () => {
    const box = new BoxGeometry();
    const wf = new WireframeGeometry(box);
    // BoxGeometry 有 12 条立方边 + 每个面 1 条对角线 × 6 面 = 6 条对角线
    // 共 18 条不重复边,每条边 2 个顶点 = 36 顶点
    expect(wf.attributes.position.count).toBe(36);
  });

  it('从 PlaneGeometry 抽取 5 条不重复边(4 外边 + 1 对角线)', () => {
    const plane = new PlaneGeometry(1, 1, 1, 1);
    const wf = new WireframeGeometry(plane);
    // PlaneGeometry(1,1,1,1) 有 4 条外边 + 1 条对角线 = 5 条边
    expect(wf.attributes.position.count).toBe(10);
  });

  it('非索引几何体也能生成线框', () => {
    // 手工构造一个非索引几何体:两个三角形拼成方形
    const geom = new BufferGeometry();
    geom.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          0, 0, 0,
          1, 0, 0,
          1, 1, 0,
          0, 0, 0,
          1, 1, 0,
          0, 1, 0,
        ]),
        3,
      ),
    );
    const wf = new WireframeGeometry(geom);
    // 2 个三角形 × 3 边 = 6 条边,去重后剩 5 条(对角线重复)
    // 5 条 × 2 顶点 = 10 顶点
    expect(wf.attributes.position.count).toBe(10);
  });

  it('null 输入产生空几何体', () => {
    const wf = new WireframeGeometry(null);
    expect(wf.attributes.position).toBeUndefined();
  });
});
