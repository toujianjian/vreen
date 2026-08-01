// Gyroscope 单元测试 (陀螺仪对象)。
//
// 覆盖:
//   1. 构造 + 默认值
//   2. 父节点旋转不影响子节点朝向(matrixWorld 旋转 = 单位阵)
//   3. 位置跟随父节点(世界位置正确)
//   4. 父节点缩放不影响子节点 scale
//   5. worldOrientationOffset 应用自定义朝向
//   6. 多层嵌套(祖父旋转 → 孙子仍世界对齐)
//   7. 无父节点时行为
//   8. 子节点继承被重置的 matrixWorld

import { describe, it, expect } from 'vitest';
import { Gyroscope } from './Gyroscope';
import { Object3D } from './Object3D';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';
import { Matrix4 } from '../Math/Matrix4';

const Z_AXIS = new Vector3(0, 0, 1);
const Y_AXIS = new Vector3(0, 1, 0);

// ── 构造 ────────────────────────────────────────────────────────────

describe('Gyroscope construction', () => {
  it('is an Object3D', () => {
    const g = new Gyroscope();
    expect(g).toBeInstanceOf(Object3D);
    expect(g.worldOrientationOffset).toBeNull();
  });
});

// ── 父节点旋转不影响朝向 ──────────────────────────────────────────

describe('Gyroscope ignores parent rotation', () => {
  it('matrixWorld rotation = identity when parent rotates', () => {
    const parent = new Object3D();
    parent.rotation.setFromAxisAngle(Z_AXIS, Math.PI / 4); // 绕 Z 旋转 45°
    parent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    gyro.position.set(5, 0, 0);
    parent.add(gyro);
    parent.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    expect(e[0]).toBeCloseTo(1, 5);
    expect(e[1]).toBeCloseTo(0, 5);
    expect(e[5]).toBeCloseTo(1, 5);
    expect(e[10]).toBeCloseTo(1, 5);
  });

  it('matrixWorld rotation = identity when parent rotates 90° around Y', () => {
    const parent = new Object3D();
    parent.rotation.setFromAxisAngle(Y_AXIS, Math.PI / 2);
    parent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    gyro.position.set(1, 2, 3);
    parent.add(gyro);
    parent.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    expect(e[0]).toBeCloseTo(1, 5);
    expect(e[5]).toBeCloseTo(1, 5);
    expect(e[10]).toBeCloseTo(1, 5);
  });
});

// ── 位置跟随父节点 ─────────────────────────────────────────────────

describe('Gyroscope position follows parent', () => {
  it('world position is correct when parent is translated', () => {
    const parent = new Object3D();
    parent.position.set(10, 20, 30);
    parent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    gyro.position.set(1, 2, 3);
    parent.add(gyro);
    parent.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    expect(e[12]).toBeCloseTo(11, 5);
    expect(e[13]).toBeCloseTo(22, 5);
    expect(e[14]).toBeCloseTo(33, 5);
  });

  it('world position includes parent rotation (position transforms, orientation does not)', () => {
    const parent = new Object3D();
    parent.rotation.setFromAxisAngle(Y_AXIS, Math.PI / 2);
    parent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    gyro.position.set(1, 0, 0);
    parent.add(gyro);
    parent.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    const dist = Math.hypot(e[12], e[14]);
    expect(dist).toBeCloseTo(1, 5);
    expect(e[0]).toBeCloseTo(1, 5);
    expect(e[5]).toBeCloseTo(1, 5);
  });
});

// ── 父节点缩放不影响 ───────────────────────────────────────────────

describe('Gyroscope ignores parent scale', () => {
  it('matrixWorld has no scale from parent', () => {
    const parent = new Object3D();
    parent.scale.set(2, 2, 2);
    parent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    gyro.position.set(1, 0, 0);
    parent.add(gyro);
    parent.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    expect(e[0]).toBeCloseTo(1, 5);
    expect(e[5]).toBeCloseTo(1, 5);
    expect(e[10]).toBeCloseTo(1, 5);
  });
});

// ── worldOrientationOffset ─────────────────────────────────────────

describe('Gyroscope worldOrientationOffset', () => {
  it('applies custom orientation offset', () => {
    const parent = new Object3D();
    parent.rotation.setFromAxisAngle(Z_AXIS, Math.PI / 4);
    parent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    const offset = new Matrix4();
    const q = new Quaternion();
    q.setFromAxisAngle(Z_AXIS, Math.PI / 6); // 30°
    offset.makeRotationFromQuaternion(q);
    gyro.worldOrientationOffset = offset;
    gyro.position.set(0, 0, 0);
    parent.add(gyro);
    parent.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    expect(e[0]).toBeCloseTo(0.866, 3);
    expect(e[1]).toBeCloseTo(0.5, 3);
    expect(e[4]).toBeCloseTo(-0.5, 3);
    expect(e[5]).toBeCloseTo(0.866, 3);
  });

  it('null offset = identity rotation (default)', () => {
    const parent = new Object3D();
    parent.rotation.setFromAxisAngle(Z_AXIS, Math.PI / 3);
    parent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    parent.add(gyro);
    parent.updateMatrixWorld(true);

    expect(gyro.worldOrientationOffset).toBeNull();
    const e = gyro.matrixWorld.elements;
    expect(e[0]).toBeCloseTo(1, 5);
    expect(e[5]).toBeCloseTo(1, 5);
  });
});

// ── 多层嵌套 ───────────────────────────────────────────────────────

describe('Gyroscope nested hierarchy', () => {
  it('grandparent rotation does not affect gyroscope orientation', () => {
    const grandparent = new Object3D();
    grandparent.rotation.setFromAxisAngle(Y_AXIS, Math.PI / 3);
    grandparent.updateMatrixWorld(true);

    const parent = new Object3D();
    parent.position.set(2, 0, 0);
    grandparent.add(parent);
    grandparent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    gyro.position.set(1, 1, 1);
    parent.add(gyro);
    grandparent.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    expect(e[0]).toBeCloseTo(1, 5);
    expect(e[5]).toBeCloseTo(1, 5);
    expect(e[10]).toBeCloseTo(1, 5);
  });
});

// ── 无父节点 ────────────────────────────────────────────────────────

describe('Gyroscope without parent', () => {
  it('behaves like Object3D (no rotation cancellation needed)', () => {
    const gyro = new Gyroscope();
    gyro.position.set(5, 0, 0);
    gyro.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    expect(e[12]).toBeCloseTo(5, 5);
    expect(e[0]).toBeCloseTo(1, 5);
  });

  it('own rotation is reset to identity (Gyroscope design)', () => {
    const gyro = new Gyroscope();
    gyro.position.set(0, 0, 0);
    gyro.rotation.setFromAxisAngle(Z_AXIS, Math.PI / 4);
    gyro.updateMatrixWorld(true);

    const e = gyro.matrixWorld.elements;
    expect(e[0]).toBeCloseTo(1, 5);
    expect(e[5]).toBeCloseTo(1, 5);
  });
});

// ── 子节点继承 ──────────────────────────────────────────────────────

describe('Gyroscope children', () => {
  it('children inherit the reset matrixWorld', () => {
    const parent = new Object3D();
    parent.rotation.setFromAxisAngle(Z_AXIS, Math.PI / 2);
    parent.updateMatrixWorld(true);

    const gyro = new Gyroscope();
    gyro.position.set(0, 0, 0);
    parent.add(gyro);

    const child = new Object3D();
    child.position.set(1, 0, 0);
    gyro.add(child);
    parent.updateMatrixWorld(true);

    const e = child.matrixWorld.elements;
    expect(e[12]).toBeCloseTo(1, 5);
    expect(e[13]).toBeCloseTo(0, 5);
  });
});
