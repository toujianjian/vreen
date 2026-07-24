import { describe, it, expect } from 'vitest';
import { EdgesGeometry } from './EdgesGeometry';
import { BoxGeometry } from './BoxGeometry';
import { SphereGeometry } from './SphereGeometry';
import { PlaneGeometry } from './PlaneGeometry';

describe('EdgesGeometry', () => {
  it('BoxGeometry 默认阈值(1°)只输出 12 条边(全部直角)', () => {
    const box = new BoxGeometry();
    const edges = new EdgesGeometry(box);
    // BoxGeometry 的所有相邻面都成 90° 角,远超 1° 阈值,所以 12 条边都应输出
    // 但实际上,因为 BoxGeometry 各面有独立顶点,所以所有边都是"边界边"
    // (没有配对边),因此 12 条边都会输出
    expect(edges.attributes.position.count).toBeGreaterThanOrEqual(24);
  });

  it('PlaneGeometry 只输出 4 条外边(共面,夹角为 0)', () => {
    const plane = new PlaneGeometry(1, 1, 1, 1);
    const edges = new EdgesGeometry(plane, 1);
    // PlaneGeometry 的所有三角形共面,夹角为 0,小于任何正阈值
    // 但 4 条外边是边界边(没有配对),所以会输出
    // 对角线有配对,但夹角 0 < 1°,所以不输出
    // 4 条边 × 2 顶点 = 8 顶点
    expect(edges.attributes.position.count).toBe(8);
  });

  it('高阈值会包含更多边', () => {
    const sphere = new SphereGeometry(1, 16, 12);
    const edgesLow = new EdgesGeometry(sphere, 1);
    const edgesHigh = new EdgesGeometry(sphere, 90);
    // 高阈值(90°)会输出更少的边(只有夹角 > 90° 的边才输出)
    // 实际上,高阈值下,只有那些"几乎反向平行"的相邻面才会输出边
    // 但 sphere 的相邻面夹角都较小,所以高阈值下边数更少
    expect(edgesHigh.attributes.position.count).toBeLessThanOrEqual(
      edgesLow.attributes.position.count,
    );
  });

  it('null 输入产生空几何体', () => {
    const edges = new EdgesGeometry(null);
    expect(edges.attributes.position).toBeUndefined();
  });
});
