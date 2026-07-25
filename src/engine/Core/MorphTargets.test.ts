// MorphTargets / MorphTargetAnimation 测试。

import { describe, it, expect } from 'vitest';
import { MorphTargets } from './MorphTargets';
import { MorphTargetAnimation, MorphTargetTrack } from './MorphTargetAnimation';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';

/** 构造一个 3 顶点的简单 geometry,位置 [0,0,0, 1,0,0, 0,1,0]。 */
function makeTriangleGeometry(): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(
    new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    3,
  ));
  return geo;
}

describe('MorphTargets', () => {
  it('addMorphTarget 设置 vertexCount 与 dictionary', () => {
    const m = new MorphTargets();
    m.addMorphTarget('smile', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(m.vertexCount).toBe(3);
    expect(m.morphTargetDictionary.get('smile')).toBe(0);
    expect(m.morphInfluences).toEqual([0]);
  });

  it('addMorphTarget 拒绝重复名称', () => {
    const m = new MorphTargets();
    m.addMorphTarget('smile', new Float32Array([0, 0, 0]));
    expect(() => m.addMorphTarget('smile', new Float32Array([0, 0, 0]))).toThrowError(/duplicate/);
  });

  it('addMorphTarget 拒绝长度不匹配', () => {
    const m = new MorphTargets();
    m.addMorphTarget('a', new Float32Array([0, 0, 0]));
    expect(() => m.addMorphTarget('b', new Float32Array([0, 0, 0, 1, 0, 0]))).toThrowError(/vertex count/);
  });

  it('addMorphTarget 拒绝非 3 倍数长度', () => {
    const m = new MorphTargets();
    expect(() => m.addMorphTarget('a', new Float32Array([0, 0]))).toThrowError(/multiple of 3/);
  });

  it('setMorphInfluence / getMorphInfluence 基本读写', () => {
    const m = new MorphTargets();
    m.addMorphTarget('smile', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    m.setMorphInfluence('smile', 0.5);
    expect(m.getMorphInfluence('smile')).toBeCloseTo(0.5);
  });

  it('getMorphInfluence 未知名称返回 0', () => {
    const m = new MorphTargets();
    expect(m.getMorphInfluence('missing')).toBe(0);
  });

  it('setMorphInfluence 未知名称抛错', () => {
    const m = new MorphTargets();
    expect(() => m.setMorphInfluence('missing', 1)).toThrowError(/unknown morph target/);
  });

  it('applyToGeometry 所有 influence 为 0 时复写 base position', () => {
    const m = new MorphTargets();
    m.addMorphTarget('smile', new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]));
    const geo = makeTriangleGeometry();
    // 首次 apply 建立 base 缓存(influence 全 0,position 保持原值)
    m.applyToGeometry(geo);
    // 污染 position
    const pos = geo.attributes.position;
    pos.array[0] = 99;
    pos.array[1] = 99;
    // 再次 apply(influence 仍为 0)应将 position 复位为 base
    m.applyToGeometry(geo);
    expect(pos.array[0]).toBeCloseTo(0);
    expect(pos.array[1]).toBeCloseTo(0);
  });

  it('applyToGeometry influence=1 写入 target position', () => {
    const m = new MorphTargets();
    m.addMorphTarget('smile', new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]));
    m.setMorphInfluence('smile', 1);
    const geo = makeTriangleGeometry();
    m.applyToGeometry(geo);
    const pos = geo.attributes.position;
    expect(pos.array[0]).toBeCloseTo(0);
    expect(pos.array[3]).toBeCloseTo(2); // x of vertex 1
    expect(pos.array[7]).toBeCloseTo(2); // y of vertex 2
  });

  it('applyToGeometry influence=0.5 线性插值', () => {
    const m = new MorphTargets();
    // base: [0,0,0, 1,0,0]; target: [0,0,0, 3,0,0]; delta on vertex 1 = 2
    m.addMorphTarget('move', new Float32Array([0, 0, 0, 3, 0, 0]));
    m.setMorphInfluence('move', 0.5);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0]), 3));
    m.applyToGeometry(geo);
    // result v1 = 1 + (3 - 1) * 0.5 = 2
    expect(geo.attributes.position.array[3]).toBeCloseTo(2);
  });

  it('applyToGeometry 多目标叠加', () => {
    const m = new MorphTargets();
    // base: [0,0,0]; target A: [2,0,0]; target B: [0,4,0]
    m.addMorphTarget('A', new Float32Array([2, 0, 0]));
    m.addMorphTarget('B', new Float32Array([0, 4, 0]));
    m.setMorphInfluence('A', 0.5);
    m.setMorphInfluence('B', 0.25);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    m.applyToGeometry(geo);
    // result = base + (A-base)*0.5 + (B-base)*0.25 = [1, 1, 0]
    expect(geo.attributes.position.array[0]).toBeCloseTo(1);
    expect(geo.attributes.position.array[1]).toBeCloseTo(1);
  });

  it('applyToGeometry 后 position.version 自增', () => {
    const m = new MorphTargets();
    m.addMorphTarget('A', new Float32Array([0, 0, 0]));
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    const v0 = geo.attributes.position.version;
    m.applyToGeometry(geo);
    expect(geo.attributes.position.version).toBeGreaterThan(v0);
  });

  it('applyToGeometry 切换 geometry 后重缓存 base', () => {
    const m = new MorphTargets();
    m.addMorphTarget('A', new Float32Array([1, 1, 1]));
    m.setMorphInfluence('A', 1);

    const geo1 = new BufferGeometry();
    geo1.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    m.applyToGeometry(geo1);
    expect(geo1.attributes.position.array[0]).toBeCloseTo(1);

    // 切换到 geo2,base 不同(应取 geo2 的 position,而非 geo1)
    const geo2 = new BufferGeometry();
    geo2.setAttribute('position', new BufferAttribute(new Float32Array([5, 5, 5]), 3));
    m.setMorphInfluence('A', 0); // 不形变,直接复写 base
    m.applyToGeometry(geo2);
    expect(geo2.attributes.position.array[0]).toBeCloseTo(5);
  });

  it('applyToGeometry 缺 position 抛错', () => {
    const m = new MorphTargets();
    m.addMorphTarget('A', new Float32Array([0, 0, 0]));
    const geo = new BufferGeometry();
    expect(() => m.applyToGeometry(geo)).toThrowError(/no position attribute/);
  });

  it('applyToGeometry vertex count 不匹配抛错', () => {
    const m = new MorphTargets();
    m.addMorphTarget('A', new Float32Array([0, 0, 0])); // 1 vertex
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 1, 1]), 3)); // 2 vertices
    expect(() => m.applyToGeometry(geo)).toThrowError(/vertex count/);
  });

  it('resetInfluences 全部归零', () => {
    const m = new MorphTargets();
    m.addMorphTarget('A', new Float32Array([0, 0, 0]));
    m.addMorphTarget('B', new Float32Array([0, 0, 0]));
    m.setMorphInfluence('A', 0.5);
    m.setMorphInfluence('B', 0.8);
    m.resetInfluences();
    expect(m.morphInfluences).toEqual([0, 0]);
  });

  it('update 是 applyToGeometry 别名', () => {
    const m = new MorphTargets();
    m.addMorphTarget('A', new Float32Array([0, 0, 0, 5, 0, 0]));
    m.setMorphInfluence('A', 1);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0]), 3));
    m.update(geo);
    expect(geo.attributes.position.array[3]).toBeCloseTo(5);
  });

  it('clone 深拷贝 targets / influences / dictionary', () => {
    const m = new MorphTargets();
    m.addMorphTarget('A', new Float32Array([1, 2, 3]));
    m.setMorphInfluence('A', 0.7);
    const c = m.clone();
    expect(c).not.toBe(m);
    expect(c.vertexCount).toBe(1);
    expect(c.getMorphInfluence('A')).toBeCloseTo(0.7);
    // 修改 clone 不影响原
    c.setMorphInfluence('A', 0.1);
    expect(m.getMorphInfluence('A')).toBeCloseTo(0.7);
    // 修改 clone 的 target 数组不影响原
    c.morphTargets.get('A')![0] = 99;
    expect(m.morphTargets.get('A')![0]).toBeCloseTo(1);
  });

  it('toJSON 输出顶点数 / targets / influences', () => {
    const m = new MorphTargets();
    m.addMorphTarget('A', new Float32Array([1, 2, 3]));
    m.setMorphInfluence('A', 0.5);
    const json = m.toJSON() as {
      vertexCount: number;
      morphTargets: Record<string, number[]>;
      morphInfluences: number[];
    };
    expect(json.vertexCount).toBe(1);
    expect(json.morphTargets.A).toEqual([1, 2, 3]);
    expect(json.morphInfluences).toEqual([0.5]);
  });
});

describe('MorphTargetTrack', () => {
  it('构造时校验 times/values 长度一致', () => {
    expect(() => new MorphTargetTrack('x', [0, 1], [0])).toThrowError(/times.length/);
  });

  it('sample 边界 clamp', () => {
    const t = new MorphTargetTrack('smile', [0, 1], [0, 1]);
    expect(t.sample(-1)).toBeCloseTo(0);
    expect(t.sample(2)).toBeCloseTo(1);
  });

  it('sample 线性插值', () => {
    const t = new MorphTargetTrack('smile', [0, 1], [0, 10]);
    expect(t.sample(0.5)).toBeCloseTo(5);
    expect(t.sample(0.25)).toBeCloseTo(2.5);
  });

  it('sample 单关键帧返回该值', () => {
    const t = new MorphTargetTrack('smile', [0], [7]);
    expect(t.sample(0)).toBeCloseTo(7);
    expect(t.sample(100)).toBeCloseTo(7);
  });

  it('sample 空轨道返回 0', () => {
    const t = new MorphTargetTrack('smile', [], []);
    expect(t.sample(0)).toBeCloseTo(0);
  });
});

describe('MorphTargetAnimation', () => {
  function makeMorph(): MorphTargets {
    const m = new MorphTargets();
    // base: [0,0,0]; target smile: [1,0,0]
    m.addMorphTarget('smile', new Float32Array([1, 0, 0]));
    return m;
  }

  it('addTrack 自动扩展 duration', () => {
    const m = makeMorph();
    const anim = new MorphTargetAnimation(m, 0);
    anim.addTrack('smile', [0, 2], [0, 1]);
    expect(anim.duration).toBeCloseTo(2);
  });

  it('addTrack 不缩短已设 duration', () => {
    const m = makeMorph();
    const anim = new MorphTargetAnimation(m, 5);
    anim.addTrack('smile', [0, 1], [0, 1]);
    expect(anim.duration).toBeCloseTo(5);
  });

  it('play / stop / reset 控制状态', () => {
    const m = makeMorph();
    const anim = new MorphTargetAnimation(m, 1);
    expect(anim.isPlaying).toBe(false);
    anim.play();
    expect(anim.isPlaying).toBe(true);
    anim.stop();
    expect(anim.isPlaying).toBe(false);
    anim.reset();
    expect(anim.time).toBe(0);
    expect(m.getMorphInfluence('smile')).toBe(0);
  });

  it('update 推进时间并写回 influence(once 模式到达末尾停止)', () => {
    const m = makeMorph();
    const anim = new MorphTargetAnimation(m, 1);
    anim.addTrack('smile', [0, 1], [0, 1]);
    anim.loop = 'once';
    anim.play();
    anim.update(0.5);
    expect(anim.time).toBeCloseTo(0.5);
    expect(m.getMorphInfluence('smile')).toBeCloseTo(0.5);
    anim.update(0.5);
    expect(anim.time).toBeCloseTo(1);
    expect(anim.isPlaying).toBe(false);
    expect(m.getMorphInfluence('smile')).toBeCloseTo(1);
  });

  it('update repeat 模式循环', () => {
    const m = makeMorph();
    const anim = new MorphTargetAnimation(m, 1);
    anim.addTrack('smile', [0, 1], [0, 1]);
    anim.loop = 'repeat';
    anim.play();
    anim.update(1.5);
    // 1.5 % 1 = 0.5
    expect(anim.time).toBeCloseTo(0.5);
    expect(anim.isPlaying).toBe(true);
  });

  it('update 不在播放时返回 false 且不推进', () => {
    const m = makeMorph();
    const anim = new MorphTargetAnimation(m, 1);
    anim.addTrack('smile', [0, 1], [0, 1]);
    const stillPlaying = anim.update(0.5);
    expect(stillPlaying).toBe(false);
    expect(anim.time).toBe(0);
  });

  it('timeScale 影响推进速率', () => {
    const m = makeMorph();
    const anim = new MorphTargetAnimation(m, 1);
    anim.addTrack('smile', [0, 1], [0, 1]);
    anim.timeScale = 2;
    anim.play();
    anim.update(0.25);
    expect(anim.time).toBeCloseTo(0.5);
  });

  it('applyToGeometry 跳转到指定时间并写回 position', () => {
    const m = makeMorph();
    const anim = new MorphTargetAnimation(m, 1);
    anim.addTrack('smile', [0, 1], [0, 1]);
    anim.time = 0.5;
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0]), 3));
    anim.applyToGeometry(geo);
    // smile influence = 0.5, target=[1,0,0], result = 0 + (1-0)*0.5 = 0.5
    expect(geo.attributes.position.array[0]).toBeCloseTo(0.5);
  });
});
