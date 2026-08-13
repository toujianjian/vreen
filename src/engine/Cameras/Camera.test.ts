// Camera 单元测试(数据层,不依赖 WebGL)。
// 覆盖 updateMatrixWorld 覆写对 matrixWorldInverse 的同步,以及
// getWorldDirection 的 -Z 约定(VREEN 与 Object3D/SceneUtils 一致)。

import { describe, it, expect } from 'vitest';
import { PerspectiveCamera } from './PerspectiveCamera';
import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math';

describe('Camera', () => {
  it('syncs matrixWorldInverse from matrixWorld on updateMatrixWorld', () => {
    const cam = new PerspectiveCamera();
    cam.position.set(10, 20, 30);
    cam.updateMatrixWorld(true);
    // matrixWorldInverse = matrixWorld^-1 → 平移列应取负
    expect(cam.matrixWorldInverse.elements[12]).toBeCloseTo(-10, 5);
    expect(cam.matrixWorldInverse.elements[13]).toBeCloseTo(-20, 5);
    expect(cam.matrixWorldInverse.elements[14]).toBeCloseTo(-30, 5);
  });

  it('getWorldDirection returns -Z look axis and mutates target', () => {
    const cam = new PerspectiveCamera();
    cam.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const target = new Vector3();
    const dir = cam.getWorldDirection(target);
    // 绕 Y 转 180° → 局部 -Z 指向世界 +Z
    expect(dir).toBe(target);
    expect(target.x).toBeCloseTo(0, 5);
    expect(target.z).toBeCloseTo(1, 5);
  });

  it('getWorldDirection works from a parented camera', () => {
    const parent = new Object3D();
    parent.position.set(0, 0, 100);
    const cam = new PerspectiveCamera();
    parent.add(cam);
    const dir = cam.getWorldDirection(new Vector3());
    // 纯平移不影响朝向
    expect(dir.z).toBeCloseTo(-1, 5);
  });
});
