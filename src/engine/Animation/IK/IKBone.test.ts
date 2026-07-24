// IKBone 单元测试:覆盖构造、世界变换计算(getWorldPosition/Rotation、
// setWorldPosition/Rotation 往返)与关节约束(applyConstraints)。
//
// 数学约定:
//   • 右手坐标系,绕 Y 轴 +90° 把 (1,0,0) 旋转到 (0,0,-1)
//   • 单位四元数 q = (sin(θ/2)·axis, cos(θ/2))

import { describe, it, expect } from 'vitest';
import { IKBone } from './IKBone';
import { Vector3 } from '../../Math/Vector3';
import { Quaternion } from '../../Math/Quaternion';

describe('IKBone', () => {
  describe('constructor', () => {
    it('default 构造:identity 位置/旋转、length=0、无 parent/constraints', () => {
      const b = new IKBone('test');
      expect(b.name).toBe('test');
      expect(b.position.equals(new Vector3(0, 0, 0))).toBe(true);
      expect(b.rotation.x).toBe(0);
      expect(b.rotation.y).toBe(0);
      expect(b.rotation.z).toBe(0);
      expect(b.rotation.w).toBe(1);
      expect(b.length).toBe(0);
      expect(b.parent).toBeNull();
      expect(b.constraints).toBeNull();
    });

    it('克隆 position/rotation,不与传入引用共享', () => {
      const pos = new Vector3(1, 2, 3);
      const rot = new Quaternion(0.1, 0.2, 0.3, 0.4);
      const b = new IKBone('test', pos, rot, 5);
      expect(b.position).not.toBe(pos);
      expect(b.position.equals(pos)).toBe(true);
      expect(b.rotation).not.toBe(rot);
      // 修改原始对象不影响 bone
      pos.x = 99;
      rot.x = 99;
      expect(b.position.x).toBe(1);
      expect(b.rotation.x).toBe(0.1);
    });
  });

  describe('getWorldPosition', () => {
    it('root: world == local', () => {
      const b = new IKBone('root', new Vector3(1, 2, 3));
      const wp = b.getWorldPosition();
      expect(wp.equals(new Vector3(1, 2, 3))).toBe(true);
    });

    it('链式无旋转:位置累加', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0));
      const mid = new IKBone('mid', new Vector3(1, 0, 0), undefined, 1, root);
      const end = new IKBone('end', new Vector3(1, 0, 0), undefined, 0, mid);
      const wp = end.getWorldPosition();
      expect(wp.x).toBeCloseTo(2, 5);
      expect(wp.y).toBeCloseTo(0, 5);
      expect(wp.z).toBeCloseTo(0, 5);
    });

    it('父级旋转会旋转子级 offset:绕 Y +90° 把 (1,0,0) 偏移旋到 (0,0,-1)', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0));
      root.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      const child = new IKBone('child', new Vector3(1, 0, 0), undefined, 1, root);
      const wp = child.getWorldPosition();
      expect(wp.x).toBeCloseTo(0, 5);
      expect(wp.y).toBeCloseTo(0, 5);
      expect(wp.z).toBeCloseTo(-1, 5);
    });

    it('写入 target 不污染内部缓存(每次返回新对象)', () => {
      const b = new IKBone('root', new Vector3(1, 0, 0));
      const out = new Vector3(99, 99, 99);
      const wp = b.getWorldPosition(out);
      expect(wp).toBe(out); // 同一引用
      expect(out.x).toBe(1);
      // 再次调用应覆盖
      b.position.set(2, 0, 0);
      b.getWorldPosition(out);
      expect(out.x).toBe(2);
    });
  });

  describe('getWorldRotation', () => {
    it('root: world == local', () => {
      const b = new IKBone('root');
      b.rotation.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 4);
      const wr = b.getWorldRotation();
      const half = Math.PI / 8;
      expect(wr.x).toBeCloseTo(0, 5);
      expect(wr.y).toBeCloseTo(0, 5);
      expect(wr.z).toBeCloseTo(Math.sin(half), 5);
      expect(wr.w).toBeCloseTo(Math.cos(half), 5);
    });

    it('链式累乘:两个 +90° Y 合成 +180° Y', () => {
      const root = new IKBone('root');
      root.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      const child = new IKBone('child', new Vector3(1, 0, 0), undefined, 1, root);
      child.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      const wr = child.getWorldRotation();
      // 180° around Y → q = (0, sin(90°), 0, cos(90°)) = (0, 1, 0, 0)
      expect(wr.x).toBeCloseTo(0, 5);
      expect(wr.y).toBeCloseTo(1, 5);
      expect(wr.z).toBeCloseTo(0, 5);
      expect(wr.w).toBeCloseTo(0, 5);
    });
  });

  describe('setWorldPosition', () => {
    it('root: 直接写 local', () => {
      const b = new IKBone('root', new Vector3(0, 0, 0));
      b.setWorldPosition(new Vector3(5, 5, 5));
      expect(b.position.equals(new Vector3(5, 5, 5))).toBe(true);
    });

    it('往返:父级无旋转,set 后 get 返回相同值', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0));
      const child = new IKBone('child', new Vector3(1, 0, 0), undefined, 1, root);
      child.setWorldPosition(new Vector3(2, 3, 4));
      const wp = child.getWorldPosition();
      expect(wp.x).toBeCloseTo(2, 5);
      expect(wp.y).toBeCloseTo(3, 5);
      expect(wp.z).toBeCloseTo(4, 5);
    });

    it('往返:父级有旋转,set 后 get 仍返回相同世界位置', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0));
      root.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4); // 45° Y
      const child = new IKBone('child', new Vector3(1, 0, 0), undefined, 1, root);
      const target = new Vector3(2, 3, -1);
      child.setWorldPosition(target);
      const wp = child.getWorldPosition();
      expect(wp.x).toBeCloseTo(2, 5);
      expect(wp.y).toBeCloseTo(3, 5);
      expect(wp.z).toBeCloseTo(-1, 5);
    });
  });

  describe('setWorldRotation', () => {
    it('往返:父级有旋转,set 后 get 返回相同世界旋转', () => {
      const root = new IKBone('root', new Vector3(0, 0, 0));
      root.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4); // 45° Y
      const child = new IKBone('child', new Vector3(1, 0, 0), undefined, 1, root);
      const target = new Quaternion();
      target.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2); // 90° Y
      child.setWorldRotation(target);
      const wr = child.getWorldRotation();
      expect(wr.x).toBeCloseTo(target.x, 5);
      expect(wr.y).toBeCloseTo(target.y, 5);
      expect(wr.z).toBeCloseTo(target.z, 5);
      expect(wr.w).toBeCloseTo(target.w, 5);
    });
  });

  describe('applyConstraints (关节约束)', () => {
    it('无约束:返回 false,不改旋转', () => {
      const b = new IKBone('test');
      b.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      expect(b.applyConstraints()).toBe(false);
      // 旋转不变
      expect(b.rotation.y).toBeCloseTo(Math.sin(Math.PI / 4), 5);
    });

    it('超过 maxAngle:被钳制到上限', () => {
      const b = new IKBone('test');
      b.constraints = {
        minAngle: 0,
        maxAngle: Math.PI / 4, // 45°
        axis: new Vector3(0, 1, 0),
      };
      // 设为 90°(超过 45° 上限)
      b.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      const modified = b.applyConstraints();
      expect(modified).toBe(true);
      // 应被钳制到 45°
      const half = Math.PI / 8; // 22.5°
      expect(b.rotation.x).toBeCloseTo(0, 5);
      expect(b.rotation.y).toBeCloseTo(Math.sin(half), 5);
      expect(b.rotation.z).toBeCloseTo(0, 5);
      expect(b.rotation.w).toBeCloseTo(Math.cos(half), 5);
    });

    it('低于 minAngle:被钳制到下限', () => {
      const b = new IKBone('test');
      b.constraints = {
        minAngle: -Math.PI / 4, // -45°
        maxAngle: 0,
        axis: new Vector3(0, 1, 0),
      };
      // 设为 -90°(低于 -45° 下限)
      b.rotation.setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
      const modified = b.applyConstraints();
      expect(modified).toBe(true);
      // 应被钳制到 -45°
      const half = -Math.PI / 8;
      expect(b.rotation.y).toBeCloseTo(Math.sin(half), 5);
      expect(b.rotation.w).toBeCloseTo(Math.cos(half), 5);
    });

    it('范围内:不修改旋转,返回 false', () => {
      const b = new IKBone('test');
      b.constraints = {
        minAngle: -Math.PI / 2,
        maxAngle: Math.PI / 2,
        axis: new Vector3(0, 1, 0),
      };
      // 设为 30°(在 [-90°, 90°] 范围内)
      b.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 6);
      const modified = b.applyConstraints();
      expect(modified).toBe(false);
      // 旋转不变
      const half = Math.PI / 12; // 15°
      expect(b.rotation.y).toBeCloseTo(Math.sin(half), 5);
      expect(b.rotation.w).toBeCloseTo(Math.cos(half), 5);
    });

    it('将离轴旋转投影到铰链轴:绕 X 的旋转被丢弃,只剩 Y 分量', () => {
      const b = new IKBone('test');
      b.constraints = {
        minAngle: -Math.PI,
        maxAngle: Math.PI,
        axis: new Vector3(0, 1, 0),
      };
      // 绕 X 旋转 90°(完全离轴)
      b.rotation.setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
      const modified = b.applyConstraints();
      expect(modified).toBe(true);
      // 投影到 Y 轴后角度为 0(因为旋转的 Y 分量是 0)
      expect(b.rotation.x).toBeCloseTo(0, 5);
      expect(b.rotation.y).toBeCloseTo(0, 5);
      expect(b.rotation.z).toBeCloseTo(0, 5);
      expect(b.rotation.w).toBeCloseTo(1, 5);
    });

    it('axis 无需归一化:内部自动归一化', () => {
      const b = new IKBone('test');
      b.constraints = {
        minAngle: 0,
        maxAngle: Math.PI / 4,
        axis: new Vector3(0, 2, 0), // 非单位向量
      };
      b.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
      b.applyConstraints();
      // 应被钳制到 45°,与 axis=(0,1,0) 的结果一致
      const half = Math.PI / 8;
      expect(b.rotation.y).toBeCloseTo(Math.sin(half), 5);
      expect(b.rotation.w).toBeCloseTo(Math.cos(half), 5);
    });
  });
});
