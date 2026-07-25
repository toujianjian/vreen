// PropertyTrack 测试。
//
// 覆盖:
//   - 构造 / name / propertyPath 必填
//   - addKeyframe / removeKeyframe (保持升序)
//   - addTarget
//   - evaluate: 数值线性插值 / step / 边界 clamp / 对象插值 / 空关键帧
//   - update: 写回 target.propertyPath (含嵌套路径)
//   - enabled=false / target=null 不写回
//   - getDuration / toJSON
import { describe, it, expect } from 'vitest';
import { PropertyTrack, type Keyframe } from './PropertyTrack';

describe('PropertyTrack', () => {
  it('构造: 默认 enabled=true / locked=false / 空关键帧', () => {
    const track = new PropertyTrack({ name: 'p', propertyPath: 'x' });
    expect(track.enabled).toBe(true);
    expect(track.locked).toBe(false);
    expect(track.keyframes).toEqual([]);
    expect(track.target).toBeNull();
  });

  it('构造: name 必填', () => {
    expect(() => new PropertyTrack({ name: '', propertyPath: 'x' })).toThrow();
  });

  it('构造: propertyPath 必填', () => {
    expect(() => new PropertyTrack({ name: 'p', propertyPath: '' })).toThrow();
  });

  it('构造: 传入 keyframes 按 time 升序', () => {
    const kfs = [
      { time: 3, value: 3 },
      { time: 1, value: 1 },
      { time: 2, value: 2 },
    ];
    const track = new PropertyTrack({ name: 'p', propertyPath: 'x', keyframes: kfs });
    expect(track.keyframes.map((k) => k.time)).toEqual([1, 2, 3]);
  });

  it('addKeyframe: 保持升序', () => {
    const track = new PropertyTrack({ name: 'p', propertyPath: 'x' });
    track.addKeyframe({ time: 3, value: 3 });
    track.addKeyframe({ time: 1, value: 1 });
    track.addKeyframe({ time: 2, value: 2 });
    expect(track.keyframes.map((k) => k.time)).toEqual([1, 2, 3]);
  });

  it('removeKeyframe: 按引用移除', () => {
    const k1: Keyframe = { time: 1, value: 1 };
    const k2: Keyframe = { time: 2, value: 2 };
    const track = new PropertyTrack({ name: 'p', propertyPath: 'x', keyframes: [k1, k2] });
    expect(track.removeKeyframe(k1)).toBe(true);
    expect(track.keyframes.length).toBe(1);
    expect(track.removeKeyframe(k1)).toBe(false);
  });

  it('addTarget: 设置 target', () => {
    const track = new PropertyTrack({ name: 'p', propertyPath: 'x' });
    const obj = { x: 0 };
    track.addTarget(obj);
    expect(track.target).toBe(obj);
    track.addTarget(null);
    expect(track.target).toBeNull();
  });

  describe('evaluate — 数值', () => {
    it('线性插值', () => {
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        keyframes: [
          { time: 0, value: 0 },
          { time: 1, value: 10 },
          { time: 2, value: 20 },
        ],
      });
      expect(track.evaluate(0)).toBe(0);
      expect(track.evaluate(0.5)).toBe(5);
      expect(track.evaluate(1)).toBe(10);
      expect(track.evaluate(1.5)).toBe(15);
      expect(track.evaluate(2)).toBe(20);
    });

    it('早于第一帧返回第一帧值', () => {
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        keyframes: [{ time: 1, value: 5 }],
      });
      expect(track.evaluate(0)).toBe(5);
    });

    it('晚于最后一帧返回最后一帧值', () => {
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        keyframes: [{ time: 1, value: 5 }],
      });
      expect(track.evaluate(10)).toBe(5);
    });

    it('step 插值: 取左端值', () => {
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        keyframes: [
          { time: 0, value: 0 },
          { time: 1, value: 10, interp: 'step' },
          { time: 2, value: 20 },
        ],
      });
      // [0,1): step→0; [1,2): linear→10..20
      expect(track.evaluate(0.5)).toBe(0); // step at 1
      expect(track.evaluate(1.5)).toBe(15);
    });

    it('单关键帧返回该值', () => {
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        keyframes: [{ time: 1, value: 42 }],
      });
      expect(track.evaluate(0)).toBe(42);
      expect(track.evaluate(1)).toBe(42);
      expect(track.evaluate(2)).toBe(42);
    });
  });

  describe('evaluate — 对象', () => {
    it('对象线性插值 (逐字段)', () => {
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'pos',
        keyframes: [
          { time: 0, value: { x: 0, y: 0, z: 0 } },
          { time: 1, value: { x: 10, y: 20, z: 30 } },
        ],
      });
      const v = track.evaluate(0.5) as Record<string, number>;
      expect(v.x).toBe(5);
      expect(v.y).toBe(10);
      expect(v.z).toBe(15);
    });

    it('对象 step 插值: 取左端', () => {
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'pos',
        keyframes: [
          { time: 0, value: { x: 0 } },
          { time: 1, value: { x: 10 }, interp: 'step' },
        ],
      });
      const v = track.evaluate(0.5) as Record<string, number>;
      expect(v.x).toBe(0);
    });
  });

  it('evaluate: 空关键帧返回 null', () => {
    const track = new PropertyTrack({ name: 'p', propertyPath: 'x' });
    expect(track.evaluate(0)).toBeNull();
  });

  describe('update — 写回 target', () => {
    it('数值路径写回', () => {
      const target = { x: 0 };
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        target,
        keyframes: [
          { time: 0, value: 0 },
          { time: 1, value: 100 },
        ],
      });
      track.update(0.5);
      expect(target.x).toBe(50);
    });

    it('嵌套路径写回 (a.b.c)', () => {
      const target = { a: { b: { c: 0 } } };
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'a.b.c',
        target,
        keyframes: [
          { time: 0, value: 0 },
          { time: 1, value: 10 },
        ],
      });
      track.update(0.5);
      expect(target.a.b.c).toBe(5);
    });

    it('嵌套路径自动创建中间对象', () => {
      const target: Record<string, unknown> = {};
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'a.b.c',
        target,
        keyframes: [{ time: 0, value: 42 }],
      });
      track.update(0);
      expect((target.a as any).b.c).toBe(42);
    });

    it('对象值写回', () => {
      const target = { pos: { x: 0, y: 0 } };
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'pos',
        target,
        keyframes: [
          { time: 0, value: { x: 0, y: 0 } },
          { time: 1, value: { x: 10, y: 20 } },
        ],
      });
      track.update(0.5);
      expect(target.pos.x).toBe(5);
      expect(target.pos.y).toBe(10);
    });

    it('enabled=false 不写回', () => {
      const target = { x: 0 };
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        target,
        keyframes: [{ time: 0, value: 100 }],
      });
      track.enabled = false;
      track.update(0);
      expect(target.x).toBe(0);
    });

    it('target=null 不抛错', () => {
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        keyframes: [{ time: 0, value: 100 }],
      });
      expect(() => track.update(0)).not.toThrow();
    });

    it('空关键帧不写回', () => {
      const target = { x: 0 };
      const track = new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        target,
      });
      expect(() => track.update(0)).not.toThrow();
      expect(target.x).toBe(0);
    });
  });

  it('getDuration: 取最大 time', () => {
    const track = new PropertyTrack({
      name: 'p',
      propertyPath: 'x',
      keyframes: [
        { time: 1, value: 0 },
        { time: 5, value: 0 },
        { time: 3, value: 0 },
      ],
    });
    expect(track.getDuration()).toBe(5);
  });

  it('getDuration: 空关键帧为 0', () => {
    const track = new PropertyTrack({ name: 'p', propertyPath: 'x' });
    expect(track.getDuration()).toBe(0);
  });

  it('toJSON: kind="property" + 字段完整', () => {
    const track = new PropertyTrack({
      name: 'p',
      propertyPath: 'x',
      keyframes: [{ time: 1, value: 10 }],
    });
    const j = track.toJSON();
    expect(j.kind).toBe('property');
    expect(j.name).toBe('p');
    expect(j.propertyPath).toBe('x');
    expect(j.keyframes.length).toBe(1);
    expect(j.keyframes[0]).toEqual({ time: 1, value: 10 });
  });
});
