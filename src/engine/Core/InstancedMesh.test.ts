// InstancedMesh 单元测试(数据层,不依赖 WebGL)。

import { describe, it, expect } from 'vitest';
import { InstancedMesh } from './InstancedMesh';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Matrix4 } from '../Math/Matrix4';
import { Color } from '../Math/Color';

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

  // ── 新增 API:instanceColor / setColorAt / getColorAt / updateInstanceMatrix ──
  // ── / updateInstanceColor / dispose / copy / clone / perInstanceFrustumCulled ─

  it('perInstanceFrustumCulled defaults to false', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    expect(im.perInstanceFrustumCulled).toBe(false);
    im.perInstanceFrustumCulled = true;
    expect(im.perInstanceFrustumCulled).toBe(true);
  });

  it('instanceColor defaults to null', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    expect(im.instanceColor).toBeNull();
    expect(im.instanceColorVersion).toBe(0);
  });

  it('setColorAt lazily allocates instanceColor (initialized to white)', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 3);
    expect(im.instanceColor).toBeNull();
    const v0 = im.instanceColorVersion;
    im.setColorAt(1, new Color(0xff0000));
    // 首次分配:instanceColor 非空,count*3 长度,全 1(白)打底
    expect(im.instanceColor).not.toBeNull();
    expect(im.instanceColor!.length).toBe(3 * 3);
    // instance 0 / 2 仍是白色 (1,1,1)
    expect(im.instanceColor![0]).toBe(1);
    expect(im.instanceColor![1]).toBe(1);
    expect(im.instanceColor![2]).toBe(1);
    expect(im.instanceColor![6]).toBe(1);
    // instance 1 是红色 (1,0,0)
    expect(im.instanceColor![3]).toBe(1);
    expect(im.instanceColor![4]).toBe(0);
    expect(im.instanceColor![5]).toBe(0);
    // version 增加
    expect(im.instanceColorVersion).toBe(v0 + 1);
  });

  it('setColorAt writes RGB from Color object', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    im.setColorAt(0, new Color(0.1, 0.2, 0.3));
    im.setColorAt(1, new Color(0.4, 0.5, 0.6));
    expect(im.instanceColor![0]).toBeCloseTo(0.1, 6);
    expect(im.instanceColor![1]).toBeCloseTo(0.2, 6);
    expect(im.instanceColor![2]).toBeCloseTo(0.3, 6);
    expect(im.instanceColor![3]).toBeCloseTo(0.4, 6);
    expect(im.instanceColor![4]).toBeCloseTo(0.5, 6);
    expect(im.instanceColor![5]).toBeCloseTo(0.6, 6);
  });

  it('setColorAt bumps version on each call', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    im.setColorAt(0, new Color(1, 0, 0));
    const v1 = im.instanceColorVersion;
    im.setColorAt(1, new Color(0, 1, 0));
    expect(im.instanceColorVersion).toBe(v1 + 1);
  });

  it('setColorAt throws on out-of-range index', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    expect(() => im.setColorAt(2, new Color())).toThrow(RangeError);
    expect(() => im.setColorAt(-1, new Color())).toThrow(RangeError);
  });

  it('getColorAt returns white (1,1,1) when instanceColor is null', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const out = new Color(0, 0, 0);
    const ret = im.getColorAt(0, out);
    expect(ret).toBe(out);
    expect(out.r).toBe(1);
    expect(out.g).toBe(1);
    expect(out.b).toBe(1);
  });

  it('getColorAt reads back what setColorAt wrote', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    im.setColorAt(0, new Color(0.25, 0.5, 0.75));
    im.setColorAt(1, new Color(0.8, 0.6, 0.4));
    const c0 = new Color();
    const c1 = new Color();
    im.getColorAt(0, c0);
    im.getColorAt(1, c1);
    expect(c0.r).toBeCloseTo(0.25, 6);
    expect(c0.g).toBeCloseTo(0.5, 6);
    expect(c0.b).toBeCloseTo(0.75, 6);
    expect(c1.r).toBeCloseTo(0.8, 6);
    expect(c1.g).toBeCloseTo(0.6, 6);
    expect(c1.b).toBeCloseTo(0.4, 6);
  });

  it('getColorAt throws on out-of-range index', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    expect(() => im.getColorAt(5, new Color())).toThrow(RangeError);
    expect(() => im.getColorAt(-1, new Color())).toThrow(RangeError);
  });

  it('updateInstanceMatrix bumps instanceMatrixVersion', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const v = im.instanceMatrixVersion;
    im.updateInstanceMatrix();
    expect(im.instanceMatrixVersion).toBe(v + 1);
  });

  it('updateInstanceColor bumps instanceColorVersion only if instanceColor allocated', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    // 未分配时为 no-op
    const v0 = im.instanceColorVersion;
    im.updateInstanceColor();
    expect(im.instanceColorVersion).toBe(v0);
    // 分配后生效
    im.setColorAt(0, new Color(1, 0, 0));
    const v1 = im.instanceColorVersion;
    im.updateInstanceColor();
    expect(im.instanceColorVersion).toBe(v1 + 1);
  });

  it('setCount preserves instanceColor and pads new instances with white', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    im.setColorAt(0, new Color(0.1, 0.2, 0.3));
    im.setColorAt(1, new Color(0.4, 0.5, 0.6));
    const vColor = im.instanceColorVersion;
    const vMat = im.instanceMatrixVersion;
    im.setCount(4);
    expect(im.instanceColor).not.toBeNull();
    expect(im.instanceColor!.length).toBe(4 * 3);
    // 旧实例颜色保留
    expect(im.instanceColor![0]).toBeCloseTo(0.1, 6);
    expect(im.instanceColor![3]).toBeCloseTo(0.4, 6);
    // 新实例(2,3)是白色
    expect(im.instanceColor![6]).toBe(1);
    expect(im.instanceColor![7]).toBe(1);
    expect(im.instanceColor![8]).toBe(1);
    expect(im.instanceColor![9]).toBe(1);
    // version 双双 bump
    expect(im.instanceColorVersion).toBe(vColor + 1);
    expect(im.instanceMatrixVersion).toBe(vMat + 1);
  });

  it('setCount shrinks instanceColor along with instanceMatrix', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 4);
    im.setColorAt(0, new Color(0.1, 0.2, 0.3));
    im.setColorAt(3, new Color(0.9, 0.8, 0.7));
    im.setCount(2);
    expect(im.count).toBe(2);
    expect(im.instanceColor!.length).toBe(2 * 3);
    // instance 0 颜色保留
    expect(im.instanceColor![0]).toBeCloseTo(0.1, 6);
  });

  it('dispose clears instanceColor and resets count to 0', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 3);
    im.setColorAt(0, new Color(1, 0, 0));
    expect(im.instanceColor).not.toBeNull();
    const vColor = im.instanceColorVersion;
    im.dispose();
    expect(im.instanceColor).toBeNull();
    expect(im.count).toBe(0);
    expect(im.instanceColorVersion).toBe(vColor + 1);
  });

  it('dispose on already-disposed instance is safe (idempotent)', () => {
    const im = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    im.dispose();
    const v = im.instanceColorVersion;
    expect(() => im.dispose()).not.toThrow();
    expect(im.instanceColorVersion).toBe(v + 1);
  });

  it('copy duplicates instanceMatrix, instanceColor, and transform from source', () => {
    const src = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const m = new Matrix4();
    m.elements[12] = 5;
    src.setMatrixAt(0, m);
    src.setColorAt(1, new Color(0.5, 0.5, 0.5));
    src.position.set(2, 3, 4);
    src.name = 'src';
    src.perInstanceFrustumCulled = true;

    // target 用不同 count 的 InstancedMesh 接收 copy
    const dst = new InstancedMesh(makeGeometry(), makeMaterial(), 5);
    dst.copy(src);

    expect(dst.count).toBe(2);
    expect(dst.instanceMatrix.length).toBe(2 * 16);
    // instance 0 matrix 拷贝过来
    expect(dst.instanceMatrix[12]).toBe(5);
    // instanceColor 拷贝
    expect(dst.instanceColor).not.toBeNull();
    expect(dst.instanceColor!.length).toBe(2 * 3);
    expect(dst.instanceColor![3]).toBeCloseTo(0.5, 6);
    // transform / name / 标志
    expect(dst.position.toArray()).toEqual([2, 3, 4]);
    expect(dst.name).toBe('src');
    expect(dst.perInstanceFrustumCulled).toBe(true);
  });

  it('copy handles source with null instanceColor', () => {
    const src = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    // 不调用 setColorAt → instanceColor 为 null
    const dst = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    dst.setColorAt(0, new Color(1, 0, 0)); // dst 有 instanceColor
    expect(dst.instanceColor).not.toBeNull();
    dst.copy(src);
    expect(dst.instanceColor).toBeNull();
  });

  it('clone returns a new InstancedMesh sharing geometry/material, copying data', () => {
    const src = new InstancedMesh(makeGeometry(), makeMaterial(), 3);
    const m = new Matrix4();
    m.elements[13] = 7;
    src.setMatrixAt(0, m);
    src.setColorAt(1, new Color(0.2, 0.4, 0.6));
    src.name = 'src';
    src.perInstanceFrustumCulled = true;

    const c = src.clone();
    expect(c).not.toBe(src);
    expect(c.isInstancedMesh).toBe(true);
    expect(c.count).toBe(3);
    // 共享 geometry / material 引用(three.js 行为)
    expect(c.geometry).toBe(src.geometry);
    expect(c.material).toBe(src.material);
    // instanceMatrix 数据独立拷贝
    expect(c.instanceMatrix).not.toBe(src.instanceMatrix);
    expect(c.instanceMatrix[13]).toBe(7);
    // 修改 clone 不影响 src
    c.instanceMatrix[13] = 99;
    expect(src.instanceMatrix[13]).toBe(7);
    // instanceColor 同样独立
    expect(c.instanceColor).not.toBeNull();
    expect(c.instanceColor).not.toBe(src.instanceColor);
    expect(c.instanceColor![3]).toBeCloseTo(0.2, 6);
    // name / 标志
    expect(c.name).toBe('src');
    expect(c.perInstanceFrustumCulled).toBe(true);
  });

  it('clone of InstancedMesh without instanceColor yields null instanceColor', () => {
    const src = new InstancedMesh(makeGeometry(), makeMaterial(), 2);
    const c = src.clone();
    expect(c.instanceColor).toBeNull();
  });
});
