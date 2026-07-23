// InstancedMesh 单元测试(数据层,不依赖 WebGL)。

import { describe, it, expect } from 'vitest';
import { InstancedMesh } from './InstancedMesh';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Matrix4 } from '../Math/Matrix4';

function makeGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
  ]), 3));
  return g;
}

function makeMaterial(): StandardMaterial {
  return new StandardMaterial();
}

describe('InstancedMesh', () => {
  it('constructs with count and identity instance matrices', () => {
    const g = makeGeometry();
    const im = new InstancedMesh(g, makeMaterial(), 3);
    expect(im.count).toBe(3);
    expect(im.instanceMatrix.length).toBe(3 * 16);
    expect(im.isInstancedMesh).toBe(true);
    // Each instance is identity
    for (let i = 0; i < 3; i++) {
      const off = i * 16;
      expect(im.instanceMatrix[off + 0]).toBe(1);
      expect(im.instanceMatrix[off + 5]).toBe(1);
      expect(im.instanceMatrix[off + 10]).toBe(1);
      expect(im.instanceMatrix[off + 15]).toBe(1);
    }
  });

  it('clamps negative/zero count to 0', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), -5);
    expect(im.count).toBe(0);
    expect(im.instanceMatrix.length).toBe(0);
  });

  it('setMatrixAt writes a Matrix4 and bumps version', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const v0 = im.instanceMatrixVersion;
    const m = new Matrix4();
    m.elements[12] = 5; // translate x
    im.setMatrixAt(1, m);
    expect(im.instanceMatrixVersion).toBe(v0 + 1);
    expect(im.instanceMatrix[1 * 16 + 12]).toBe(5);
  });

  it('setMatrixAt accepts raw array', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const raw = new Array(16).fill(0);
    raw[0] = 2; raw[5] = 2; raw[10] = 2; raw[15] = 1; // scale 2
    im.setMatrixAt(0, raw);
    expect(im.instanceMatrix[0]).toBe(2);
    expect(im.instanceMatrix[5]).toBe(2);
  });

  it('setMatrixAt throws on out-of-range index', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    expect(() => im.setMatrixAt(2, new Matrix4())).toThrow(RangeError);
    expect(() => im.setMatrixAt(-1, new Matrix4())).toThrow(RangeError);
  });

  it('getMatrixAt reads back into out buffer', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const m = new Matrix4();
    m.elements[13] = 9; // translate y
    im.setMatrixAt(0, m);
    const out = new Float32Array(16);
    im.getMatrixAt(0, out);
    expect(out[13]).toBe(9);
  });

  it('getMatrixAt throws on out-of-range', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    expect(() => im.getMatrixAt(5, new Float32Array(16))).toThrow(RangeError);
  });

  it('setIdentityAt resets an instance to identity and bumps version', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const m = new Matrix4();
    m.elements[12] = 7;
    im.setMatrixAt(0, m);
    const v = im.instanceMatrixVersion;
    im.setIdentityAt(0);
    expect(im.instanceMatrixVersion).toBe(v + 1);
    expect(im.instanceMatrix[12]).toBe(0);
    expect(im.instanceMatrix[0]).toBe(1);
  });

  it('setCount grows, preserving existing instances and padding with identity', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const m = new Matrix4();
    m.elements[12] = 3;
    im.setMatrixAt(0, m);
    im.setCount(4);
    expect(im.count).toBe(4);
    expect(im.instanceMatrix.length).toBe(4 * 16);
    // instance 0 preserved
    expect(im.instanceMatrix[12]).toBe(3);
    // instance 2 (new) is identity
    expect(im.instanceMatrix[2 * 16 + 0]).toBe(1);
    expect(im.instanceMatrix[2 * 16 + 15]).toBe(1);
  });

  it('setCount shrinks, truncating instances', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 4);
    im.setCount(2);
    expect(im.count).toBe(2);
    expect(im.instanceMatrix.length).toBe(2 * 16);
  });

  it('setCount with same value is a no-op (no version bump)', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 3);
    const v = im.instanceMatrixVersion;
    im.setCount(3);
    expect(im.instanceMatrixVersion).toBe(v);
  });

  it('extends Mesh (isMesh compatibility)', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 1);
    expect(im.isMesh).toBe(true);
    expect(im.geometry).toBeDefined();
    expect(im.material).toBeDefined();
  });
});
