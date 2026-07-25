// TimelineTrack + TimelineClip 测试。
//
// 覆盖:
//   - TimelineClip: contains / getLocalTime / clone / end getter / speed 处理
//   - TimelineTrack: 构造 / addClip (保持升序) / removeClip / removeClipByName
//                   / getClipsAtTime / getDuration / update (data.update 调度) / enabled
//   - createClips 工厂
import { describe, it, expect, vi } from 'vitest';
import { TimelineClip } from './TimelineClip';
import { TimelineTrack, createClips } from './TimelineTrack';

describe('TimelineClip', () => {
  it('contains: [start, end) 左闭右开', () => {
    const clip = new TimelineClip({ start: 1, duration: 2 });
    expect(clip.contains(1)).toBe(true);
    expect(clip.contains(2.5)).toBe(true);
    expect(clip.contains(3)).toBe(false); // end 时刻不包含
    expect(clip.contains(0.9)).toBe(false);
  });

  it('end getter = start + duration', () => {
    const clip = new TimelineClip({ start: 1.5, duration: 2.5 });
    expect(clip.end).toBe(4);
  });

  it('getLocalTime: 边界 clamp + speed 缩放', () => {
    const clip = new TimelineClip({ start: 1, duration: 2, speed: 1 });
    expect(clip.getLocalTime(0.5)).toBe(0); // 早于 start
    expect(clip.getLocalTime(1)).toBe(0); // 恰好 start
    expect(clip.getLocalTime(2)).toBe(1); // 中点
    expect(clip.getLocalTime(3)).toBe(2); // end
    expect(clip.getLocalTime(4)).toBe(2); // 晚于 end
  });

  it('getLocalTime: speed=2 加速', () => {
    const clip = new TimelineClip({ start: 0, duration: 4, speed: 2 });
    // 0→0, 1→2 (本地 1s × speed 2 = 2s), 2→4 → clamp 到 4
    expect(clip.getLocalTime(0)).toBe(0);
    expect(clip.getLocalTime(1)).toBe(2);
    expect(clip.getLocalTime(2)).toBe(4); // clamp
    expect(clip.getLocalTime(3)).toBe(4);
  });

  it('getLocalTime: speed<=0 退化为 1', () => {
    const clip = new TimelineClip({ start: 1, duration: 2, speed: 0 });
    expect(clip.getLocalTime(2)).toBe(1);
    clip.speed = -1;
    expect(clip.getLocalTime(2)).toBe(1);
  });

  it('clone: 浅拷贝 (data 共享引用)', () => {
    const data = { foo: 'bar' };
    const clip = new TimelineClip({ start: 1, duration: 2, name: 'a', data, blendMode: 'mix', speed: 2 });
    const c = clip.clone();
    expect(c.start).toBe(1);
    expect(c.duration).toBe(2);
    expect(c.name).toBe('a');
    expect(c.data).toBe(data); // 引用共享
    expect(c.blendMode).toBe('mix');
    expect(c.speed).toBe(2);
    // 修改 clone 不影响原对象
    c.start = 99;
    expect(clip.start).toBe(1);
  });

  it('默认值: name="" / blendMode="none" / speed=1', () => {
    const clip = new TimelineClip({ start: 0, duration: 1 });
    expect(clip.name).toBe('');
    expect(clip.blendMode).toBe('none');
    expect(clip.speed).toBe(1);
  });

  it('toJSON 包含所有字段', () => {
    const clip = new TimelineClip({ start: 1, duration: 2, name: 'a', data: { x: 1 }, blendMode: 'crossfade', speed: 1.5 });
    const j = clip.toJSON();
    expect(j.start).toBe(1);
    expect(j.duration).toBe(2);
    expect(j.name).toBe('a');
    expect(j.blendMode).toBe('crossfade');
    expect(j.speed).toBe(1.5);
    expect(j.end).toBe(3);
  });
});

describe('TimelineTrack', () => {
  it('构造: 默认 type=animation / enabled=true / locked=false', () => {
    const track = new TimelineTrack({ name: 't1' });
    expect(track.type).toBe('animation');
    expect(track.enabled).toBe(true);
    expect(track.locked).toBe(false);
    expect(track.clips).toEqual([]);
  });

  it('构造: name 必填', () => {
    expect(() => new TimelineTrack({ name: '' })).toThrow();
  });

  it('构造: 传入 clips 按 start 升序排序', () => {
    const clips = [
      new TimelineClip({ start: 3, duration: 1 }),
      new TimelineClip({ start: 1, duration: 1 }),
      new TimelineClip({ start: 2, duration: 1 }),
    ];
    const track = new TimelineTrack({ name: 't', clips });
    expect(track.clips.map((c) => c.start)).toEqual([1, 2, 3]);
  });

  it('addClip: 保持升序', () => {
    const track = new TimelineTrack({ name: 't' });
    track.addClip(new TimelineClip({ start: 5, duration: 1 }));
    track.addClip(new TimelineClip({ start: 2, duration: 1 }));
    track.addClip(new TimelineClip({ start: 8, duration: 1 }));
    expect(track.clips.map((c) => c.start)).toEqual([2, 5, 8]);
  });

  it('removeClip: 按引用移除', () => {
    const c1 = new TimelineClip({ start: 1, duration: 1 });
    const c2 = new TimelineClip({ start: 2, duration: 1 });
    const track = new TimelineTrack({ name: 't', clips: [c1, c2] });
    expect(track.removeClip(c1)).toBe(true);
    expect(track.clips.length).toBe(1);
    expect(track.removeClip(c1)).toBe(false); // 已移除
  });

  it('removeClipByName: 同名全部移除', () => {
    const track = new TimelineTrack({
      name: 't',
      clips: [
        new TimelineClip({ start: 1, duration: 1, name: 'a' }),
        new TimelineClip({ start: 2, duration: 1, name: 'b' }),
        new TimelineClip({ start: 3, duration: 1, name: 'a' }),
      ],
    });
    expect(track.removeClipByName('a')).toBe(2);
    expect(track.clips.map((c) => c.name)).toEqual(['b']);
    expect(track.removeClipByName('missing')).toBe(0);
  });

  it('getClipsAtTime: 返回所有包含 time 的片段', () => {
    const track = new TimelineTrack({
      name: 't',
      clips: [
        new TimelineClip({ start: 0, duration: 2 }), // [0, 2)
        new TimelineClip({ start: 1, duration: 2 }), // [1, 3) (重叠)
        new TimelineClip({ start: 5, duration: 1 }), // [5, 6)
      ],
    });
    expect(track.getClipsAtTime(0.5).length).toBe(1);
    expect(track.getClipsAtTime(1.5).length).toBe(2); // 重叠区
    expect(track.getClipsAtTime(3).length).toBe(0); // 第一段已结束,第二段 [1,3) 也是左闭右开
    expect(track.getClipsAtTime(5.5).length).toBe(1);
  });

  it('getDuration: 取最大 end', () => {
    const track = new TimelineTrack({
      name: 't',
      clips: [
        new TimelineClip({ start: 0, duration: 2 }),
        new TimelineClip({ start: 1, duration: 5 }), // end=6
        new TimelineClip({ start: 3, duration: 1 }),
      ],
    });
    expect(track.getDuration()).toBe(6);
  });

  it('getDuration: 空轨道为 0', () => {
    const track = new TimelineTrack({ name: 't' });
    expect(track.getDuration()).toBe(0);
  });

  it('update: 调用活跃片段 data.update(localTime, dt)', () => {
    const updateA = vi.fn();
    const updateB = vi.fn();
    const track = new TimelineTrack({
      name: 't',
      clips: [
        new TimelineClip({ start: 0, duration: 2, data: { update: updateA } }),
        new TimelineClip({ start: 5, duration: 1, data: { update: updateB } }),
      ],
    });
    // time=1: A 活跃 (本地 1), B 未活跃
    track.update(1, 0.016);
    expect(updateA).toHaveBeenCalledWith(1, 0.016);
    expect(updateB).not.toHaveBeenCalled();
    // time=5.5: A 已结束,B 活跃
    updateA.mockClear();
    track.update(5.5, 0.016);
    expect(updateA).not.toHaveBeenCalled();
    expect(updateB).toHaveBeenCalledWith(0.5, 0.016);
  });

  it('update: enabled=false 时跳过', () => {
    const update = vi.fn();
    const track = new TimelineTrack({
      name: 't',
      clips: [new TimelineClip({ start: 0, duration: 2, data: { update } })],
    });
    track.enabled = false;
    track.update(1, 0.016);
    expect(update).not.toHaveBeenCalled();
  });

  it('update: data 无 update 方法时不抛错', () => {
    const track = new TimelineTrack({
      name: 't',
      clips: [new TimelineClip({ start: 0, duration: 2, data: { foo: 'bar' } })],
    });
    expect(() => track.update(1, 0.016)).not.toThrow();
  });

  it('toJSON: 包含 name / type / enabled / locked / clips', () => {
    const track = new TimelineTrack({
      name: 'anim',
      type: 'animation',
      clips: [new TimelineClip({ start: 1, duration: 2, name: 'c1' })],
    });
    track.enabled = false;
    track.locked = true;
    const j = track.toJSON();
    expect(j.name).toBe('anim');
    expect(j.type).toBe('animation');
    expect(j.enabled).toBe(false);
    expect(j.locked).toBe(true);
    expect(j.clips.length).toBe(1);
    expect(j.clips[0].name).toBe('c1');
  });
});

describe('createClips 工厂', () => {
  it('从选项数组构造 TimelineClip 列表', () => {
    const clips = createClips([
      { start: 0, duration: 1, name: 'a' },
      { start: 2, duration: 1, name: 'b' },
    ]);
    expect(clips.length).toBe(2);
    expect(clips[0]).toBeInstanceOf(TimelineClip);
    expect(clips[0].name).toBe('a');
    expect(clips[1].name).toBe('b');
  });
});
