// FrustumCuller 单元测试。
// 验证视锥内/外对象判断、批量裁剪、统计计数。
//
// 测试视锥:相机在原点看向 -Z,fovY=90°,aspect=1,near=0.1,far=100。
// 该视锥在 z=-5 处截面为 ±5 正方形(90° fov → tan(45°)=1)。

import { describe, it, expect } from 'vitest';
import { FrustumCuller } from './FrustumCuller';
import { Object3D } from './Object3D';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';

/** 构造测试相机:原点看向 -Z,fov=90°。 */
function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(90, 1, 0.1, 100);
  cam.position.set(0, 0, 0);
  cam.updateMatrixWorld(true);
  return cam;
}

/** 构造位于 (x,y,z) 的对象,已更新世界矩阵。 */
function makeObjectAt(x: number, y: number, z: number): Object3D {
  const o = new Object3D();
  o.position.set(x, y, z);
  o.updateMatrixWorld(true);
  return o;
}

describe('FrustumCuller', () => {
  describe('setFromCamera', () => {
    it('从相机设置视锥不抛异常', () => {
      const culler = new FrustumCuller();
      expect(() => culler.setFromCamera(makeCamera())).not.toThrow();
    });

    it('重置裁剪统计', () => {
      const culler = new FrustumCuller();
      // 先做一次裁剪产生统计
      culler.setFromCamera(makeCamera());
      culler.cullSingle(makeObjectAt(0, 0, -5));
      expect(culler.getStats().tested).toBe(1);

      // 重新 setFromCamera 应清零统计
      culler.setFromCamera(makeCamera());
      expect(culler.getStats().tested).toBe(0);
      expect(culler.getStats().passed).toBe(0);
      expect(culler.getStats().rejected).toBe(0);
    });
  });

  describe('cullSingle — 视锥内/外判断', () => {
    const culler = new FrustumCuller();
    culler.setFromCamera(makeCamera());

    it('正前方(z=-5)的对象在视锥内', () => {
      expect(culler.cullSingle(makeObjectAt(0, 0, -5))).toBe(true);
    });

    it('相机后方(z=+5)的对象在视锥外', () => {
      expect(culler.cullSingle(makeObjectAt(0, 0, 5))).toBe(false);
    });

    it('远超右边界(x=10,z=-5)的对象在视锥外', () => {
      // z=-5 处视锥半宽为 5,x=10 超出
      expect(culler.cullSingle(makeObjectAt(10, 0, -5))).toBe(false);
    });

    it('右边界内(x=4,z=-5)的对象在视锥内', () => {
      // z=-5 处半宽 5,x=4 在内
      expect(culler.cullSingle(makeObjectAt(4, 0, -5))).toBe(true);
    });

    it('上边界内(y=4,z=-5)的对象在视锥内', () => {
      expect(culler.cullSingle(makeObjectAt(0, 4, -5))).toBe(true);
    });

    it('远平面外(z=-200)的对象在视锥外', () => {
      expect(culler.cullSingle(makeObjectAt(0, 0, -200))).toBe(false);
    });

    it('近平面内(z=-0.05 的对象在 near=0.1 之前)在视锥外', () => {
      // near=0.1,z=-0.05 在近平面之前(相机和近平面之间)
      expect(culler.cullSingle(makeObjectAt(0, 0, -0.05))).toBe(false);
    });

    it('原点(相机位置)在视锥外(near=0.1 之前)', () => {
      expect(culler.cullSingle(makeObjectAt(0, 0, 0))).toBe(false);
    });
  });

  describe('cull — 批量裁剪', () => {
    it('返回可见对象子集', () => {
      const culler = new FrustumCuller();
      culler.setFromCamera(makeCamera());

      const objects = [
        makeObjectAt(0, 0, -5),    // 可见
        makeObjectAt(0, 0, 5),     // 不可见(后方)
        makeObjectAt(0, 0, -10),   // 可见
        makeObjectAt(20, 0, -5),   // 不可见(右外)
        makeObjectAt(0, 0, -50),   // 可见
      ];

      const visible = culler.cull(objects);
      expect(visible.length).toBe(3);
      // 不修改原数组
      expect(objects.length).toBe(5);
    });

    it('空数组返回空数组', () => {
      const culler = new FrustumCuller();
      culler.setFromCamera(makeCamera());
      const visible = culler.cull([]);
      expect(visible.length).toBe(0);
    });
  });

  describe('getStats — 裁剪统计', () => {
    it('正确统计 tested/passed/rejected', () => {
      const culler = new FrustumCuller();
      culler.setFromCamera(makeCamera());

      culler.cullSingle(makeObjectAt(0, 0, -5));   // passed
      culler.cullSingle(makeObjectAt(0, 0, 5));    // rejected
      culler.cullSingle(makeObjectAt(0, 0, -10));  // passed

      const stats = culler.getStats();
      expect(stats.tested).toBe(3);
      expect(stats.passed).toBe(2);
      expect(stats.rejected).toBe(1);
    });

    it('tested = passed + rejected', () => {
      const culler = new FrustumCuller();
      culler.setFromCamera(makeCamera());

      culler.cullSingle(makeObjectAt(0, 0, -5));
      culler.cullSingle(makeObjectAt(0, 0, 5));
      culler.cullSingle(makeObjectAt(20, 0, -5));

      const stats = culler.getStats();
      expect(stats.tested).toBe(stats.passed + stats.rejected);
    });
  });

  describe('resetStats', () => {
    it('清零所有统计计数', () => {
      const culler = new FrustumCuller();
      culler.setFromCamera(makeCamera());
      culler.cullSingle(makeObjectAt(0, 0, -5));
      expect(culler.getStats().tested).toBe(1);

      culler.resetStats();
      const stats = culler.getStats();
      expect(stats.tested).toBe(0);
      expect(stats.passed).toBe(0);
      expect(stats.rejected).toBe(0);
    });
  });

  describe('frustumCulled 标志', () => {
    it('frustumCulled=false 的对象在 SceneGraphProcessor.collectVisible 中跳过裁剪',
      () => {
      // 此测试验证 FrustumCuller 本身不关心 frustumCulled 标志
      // (由 SceneGraphProcessor.collectVisible 控制);这里只验证 cullSingle
      // 对任意对象都做视锥判断。
      const culler = new FrustumCuller();
      culler.setFromCamera(makeCamera());
      const obj = makeObjectAt(0, 0, -5);
      obj.frustumCulled = false; // 不影响 cullSingle 的判断
      expect(culler.cullSingle(obj)).toBe(true);
    });
  });
});
