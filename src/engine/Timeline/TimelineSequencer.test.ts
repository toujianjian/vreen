// TimelineSequencer 测试。
//
// 覆盖:
//   - 构造 / 默认值 / setEventBus
//   - play / pause / stop / seek (含 clamp)
//   - addTrack / removeTrack / getTrack
//   - update: 推进 time / 不播放时不推进 / 到达 duration 自动 pause
//   - loop: 回绕 + EventTrack 两段触发
//   - speed: 全局倍速
//   - EventTrack 集成: 触发区间事件
//   - PropertyTrack 集成: 写回 target
//   - TimelineTrack 集成: data.update 调度
//   - getDuration: 显式 + 自动计算
//   - export / import 往返
import { describe, it, expect, vi } from 'vitest';
import { TimelineSequencer } from './TimelineSequencer';
import { TimelineTrack } from './TimelineTrack';
import { EventTrack } from './EventTrack';
import { PropertyTrack } from './PropertyTrack';
import { TimelineClip } from './TimelineClip';
import { EventBus } from '../Events/EventBus';

describe('TimelineSequencer', () => {
  describe('构造与默认值', () => {
    it('默认 duration=0 / loop=false / speed=1 / isPlaying=false / eventBus=null', () => {
      const seq = new TimelineSequencer();
      expect(seq.duration).toBe(0);
      expect(seq.loop).toBe(false);
      expect(seq.speed).toBe(1);
      expect(seq.isPlaying).toBe(false);
      expect(seq.eventBus).toBeNull();
      expect(seq.tracks).toEqual([]);
      expect(seq.time).toBe(0);
    });

    it('传入选项生效', () => {
      const bus = new EventBus();
      const seq = new TimelineSequencer({ duration: 5, loop: true, speed: 2, eventBus: bus });
      expect(seq.duration).toBe(5);
      expect(seq.loop).toBe(true);
      expect(seq.speed).toBe(2);
      expect(seq.eventBus).toBe(bus);
    });

    it('setEventBus: 替换 bus', () => {
      const seq = new TimelineSequencer();
      const bus = new EventBus();
      expect(seq.eventBus).toBeNull();
      seq.setEventBus(bus);
      expect(seq.eventBus).toBe(bus);
      seq.setEventBus(null);
      expect(seq.eventBus).toBeNull();
    });
  });

  describe('play / pause / stop / seek', () => {
    it('play 设置 isPlaying=true', () => {
      const seq = new TimelineSequencer({ duration: 5 });
      seq.play();
      expect(seq.isPlaying).toBe(true);
    });

    it('play 到达 duration 后自动 seek(0) (非 loop)', () => {
      const seq = new TimelineSequencer({ duration: 5 });
      seq.time = 5;
      seq.play();
      expect(seq.time).toBe(0);
      expect(seq.isPlaying).toBe(true);
    });

    it('play 到达 duration 后 loop 不 seek', () => {
      const seq = new TimelineSequencer({ duration: 5, loop: true });
      seq.time = 3;
      seq.play();
      expect(seq.time).toBe(3);
    });

    it('pause 设置 isPlaying=false 且保持 time', () => {
      const seq = new TimelineSequencer({ duration: 5 });
      seq.play();
      seq.time = 2.5;
      seq.pause();
      expect(seq.isPlaying).toBe(false);
      expect(seq.time).toBe(2.5);
    });

    it('pause 未播放时为 no-op', () => {
      const seq = new TimelineSequencer({ duration: 5 });
      seq.pause();
      expect(seq.isPlaying).toBe(false);
    });

    it('stop: 暂停 + 回到 0', () => {
      const seq = new TimelineSequencer({ duration: 5 });
      seq.play();
      seq.time = 3;
      seq.stop();
      expect(seq.isPlaying).toBe(false);
      expect(seq.time).toBe(0);
    });

    it('seek: clamp 到 [0, duration]', () => {
      const seq = new TimelineSequencer({ duration: 5 });
      seq.seek(3);
      expect(seq.time).toBe(3);
      seq.seek(-1);
      expect(seq.time).toBe(0);
      seq.seek(100);
      expect(seq.time).toBe(5);
    });

    it('seek 后 lastTime = time (避免触发区间事件)', () => {
      const seq = new TimelineSequencer({ duration: 5 });
      seq.time = 4;
      seq.lastTime = 4;
      seq.seek(1);
      expect(seq.lastTime).toBe(1);
    });
  });

  describe('addTrack / removeTrack / getTrack', () => {
    it('addTrack: 添加轨道并扩展 duration', () => {
      const seq = new TimelineSequencer();
      const track = new TimelineTrack({
        name: 't1',
        clips: [new TimelineClip({ start: 0, duration: 5 })],
      });
      seq.addTrack(track);
      expect(seq.tracks.length).toBe(1);
      expect(seq.duration).toBe(5);
    });

    it('addTrack: 不缩小 duration', () => {
      const seq = new TimelineSequencer({ duration: 10 });
      const track = new TimelineTrack({
        name: 't1',
        clips: [new TimelineClip({ start: 0, duration: 3 })],
      });
      seq.addTrack(track);
      expect(seq.duration).toBe(10);
    });

    it('removeTrack: 按名移除 + 重新计算 duration', () => {
      const seq = new TimelineSequencer();
      const t1 = new TimelineTrack({
        name: 't1',
        clips: [new TimelineClip({ start: 0, duration: 3 })],
      });
      const t2 = new TimelineTrack({
        name: 't2',
        clips: [new TimelineClip({ start: 0, duration: 8 })],
      });
      seq.addTrack(t1);
      seq.addTrack(t2);
      expect(seq.duration).toBe(8);
      expect(seq.removeTrack('t2')).toBe(1);
      expect(seq.tracks.length).toBe(1);
      expect(seq.duration).toBe(3);
    });

    it('removeTrack: 同名全部移除', () => {
      const seq = new TimelineSequencer();
      seq.addTrack(new TimelineTrack({ name: 'dup' }));
      seq.addTrack(new TimelineTrack({ name: 'dup' }));
      expect(seq.removeTrack('dup')).toBe(2);
      expect(seq.tracks.length).toBe(0);
    });

    it('removeTrack: 未知名返回 0', () => {
      const seq = new TimelineSequencer();
      expect(seq.removeTrack('missing')).toBe(0);
    });

    it('getTrack: 按名查找', () => {
      const seq = new TimelineSequencer();
      const t = new TimelineTrack({ name: 'find' });
      seq.addTrack(t);
      expect(seq.getTrack('find')).toBe(t);
      expect(seq.getTrack('missing')).toBeNull();
    });
  });

  describe('getDuration', () => {
    it('显式 duration 优先 (若大于轨道)', () => {
      const seq = new TimelineSequencer({ duration: 10 });
      seq.addTrack(new TimelineTrack({
        name: 't',
        clips: [new TimelineClip({ start: 0, duration: 3 })],
      }));
      expect(seq.getDuration()).toBe(10);
    });

    it('自动计算轨道最大时长', () => {
      const seq = new TimelineSequencer();
      seq.addTrack(new TimelineTrack({
        name: 't1',
        clips: [new TimelineClip({ start: 0, duration: 5 })],
      }));
      seq.addTrack(new TimelineTrack({
        name: 't2',
        clips: [new TimelineClip({ start: 0, duration: 8 })],
      }));
      expect(seq.getDuration()).toBe(8);
    });

    it('显式 duration + 轨道时长取最大', () => {
      const seq = new TimelineSequencer({ duration: 5 });
      seq.addTrack(new TimelineTrack({
        name: 't',
        clips: [new TimelineClip({ start: 0, duration: 10 })],
      }));
      expect(seq.getDuration()).toBe(10);
    });
  });

  describe('update — 基础推进', () => {
    it('update 推进 time = dt * speed', () => {
      const seq = new TimelineSequencer({ duration: 10, speed: 2 });
      seq.play();
      seq.update(0.5);
      expect(seq.time).toBeCloseTo(1, 5);
    });

    it('update: 未播放时不推进', () => {
      const seq = new TimelineSequencer({ duration: 10 });
      seq.update(0.5);
      expect(seq.time).toBe(0);
    });

    it('update: 到达 duration (非 loop) 自动 pause', () => {
      const seq = new TimelineSequencer({ duration: 2 });
      seq.play();
      seq.update(1.5);
      expect(seq.isPlaying).toBe(true);
      expect(seq.time).toBeCloseTo(1.5, 5);
      seq.update(1.0); // 1.5 + 1.0 = 2.5 → clamp 到 2
      expect(seq.time).toBe(2);
      expect(seq.isPlaying).toBe(false);
    });

    it('update: 恰好到达 duration 仍 pause', () => {
      const seq = new TimelineSequencer({ duration: 2 });
      seq.play();
      seq.update(2);
      expect(seq.time).toBe(2);
      expect(seq.isPlaying).toBe(false);
    });

    it('update: lastTime 同步更新', () => {
      const seq = new TimelineSequencer({ duration: 10 });
      seq.play();
      seq.update(1);
      expect(seq.lastTime).toBeCloseTo(1, 5);
      seq.update(1);
      expect(seq.lastTime).toBeCloseTo(2, 5);
    });
  });

  describe('update — loop 回绕', () => {
    it('loop=true: 超过 duration 回绕到 0', () => {
      const seq = new TimelineSequencer({ duration: 2, loop: true });
      seq.play();
      seq.update(1.5); // time = 1.5
      expect(seq.time).toBeCloseTo(1.5, 5);
      seq.update(1.0); // 1.5 + 1.0 = 2.5 → wrap to 0.5
      expect(seq.time).toBeCloseTo(0.5, 5);
      expect(seq.isPlaying).toBe(true);
    });

    it('loop=true: 恰好到达 duration 回绕到 0', () => {
      const seq = new TimelineSequencer({ duration: 2, loop: true });
      seq.play();
      seq.update(2);
      expect(seq.time).toBe(0);
      expect(seq.isPlaying).toBe(true);
    });

    it('loop=true: EventTrack 触发两段事件', () => {
      const bus = new EventBus();
      const fn = vi.fn();
      bus.on('hit', fn);
      const seq = new TimelineSequencer({ duration: 2, loop: true, eventBus: bus });
      seq.addTrack(new EventTrack({
        name: 'evt',
        events: [
          { time: 0.5, eventName: 'hit' }, // 第二段触发
          { time: 1.8, eventName: 'hit' }, // 第一段触发 (在 [prevTime, duration] 区间)
        ],
      }));
      seq.play();
      seq.update(1.9); // time = 1.9, 触发 0.5 和 1.8 (都在 (0, 1.9] 区间)
      expect(fn).toHaveBeenCalledTimes(2);
      fn.mockClear();
      // 1.9 + 0.5 = 2.4 → wrap to 0.4
      // 第一段 (1.9, +∞): 1.8 < 1.9, 不触发
      // 第二段 [0, 0.4]: 0.5 > 0.4, 不触发
      seq.update(0.5);
      // 期望 0 次触发 (回绕后两段都无事件)
      expect(fn).toHaveBeenCalledTimes(0);
    });

    it('loop=true: 完整 wrap 触发两段', () => {
      const bus = new EventBus();
      const triggered: string[] = [];
      bus.on('early', () => triggered.push('early'));
      bus.on('late', () => triggered.push('late'));
      const seq = new TimelineSequencer({ duration: 2, loop: true, eventBus: bus });
      seq.addTrack(new EventTrack({
        name: 'evt',
        events: [
          { time: 0.2, eventName: 'early' },
          { time: 1.8, eventName: 'late' },
        ],
      }));
      seq.play();
      seq.update(1.5); // time = 1.5, 触发 early (0.2)
      expect(triggered).toEqual(['early']);
      triggered.length = 0;
      // 1.5 + 1.0 = 2.5 → wrap to 0.5
      // 第一段 (1.5, 2.0]: 触发 late (1.8)
      // 第二段 (0, 0.5]: 触发 early (0.2)
      seq.update(1.0);
      expect(triggered).toEqual(['late', 'early']);
    });
  });

  describe('update — 轨道集成', () => {
    it('TimelineTrack: data.update 被调用', () => {
      const update = vi.fn();
      const seq = new TimelineSequencer({ duration: 5 });
      seq.addTrack(new TimelineTrack({
        name: 't',
        clips: [new TimelineClip({ start: 0, duration: 5, data: { update } })],
      }));
      seq.play();
      seq.update(1);
      expect(update).toHaveBeenCalledTimes(1);
      // localTime = 1, dt = 1
      expect(update).toHaveBeenCalledWith(1, 1);
    });

    it('EventTrack: 触发区间事件', () => {
      const bus = new EventBus();
      const fn = vi.fn();
      bus.on('hit', fn);
      const seq = new TimelineSequencer({ duration: 5, eventBus: bus });
      seq.addTrack(new EventTrack({
        name: 'evt',
        events: [{ time: 1.5, eventName: 'hit' }],
      }));
      seq.play();
      seq.update(1); // time = 1, 不触发
      expect(fn).not.toHaveBeenCalled();
      seq.update(1); // time = 2, 触发 (穿越 1.5)
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('PropertyTrack: 写回 target', () => {
      const target = { x: 0 };
      const seq = new TimelineSequencer({ duration: 5 });
      seq.addTrack(new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        target,
        keyframes: [
          { time: 0, value: 0 },
          { time: 2, value: 20 },
        ],
      }));
      seq.play();
      seq.update(1); // time = 1, x = 10
      expect(target.x).toBe(10);
    });

    it('enabled=false 的轨道不被 update', () => {
      const update = vi.fn();
      const seq = new TimelineSequencer({ duration: 5 });
      const track = new TimelineTrack({
        name: 't',
        clips: [new TimelineClip({ start: 0, duration: 5, data: { update } })],
      });
      track.enabled = false;
      seq.addTrack(track);
      seq.play();
      seq.update(1);
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('export / import', () => {
    it('export: 包含所有字段', () => {
      const seq = new TimelineSequencer({ duration: 5, loop: true, speed: 2 });
      seq.addTrack(new TimelineTrack({
        name: 't',
        clips: [new TimelineClip({ start: 0, duration: 3, name: 'c1' })],
      }));
      seq.addTrack(new EventTrack({
        name: 'e',
        events: [{ time: 1, eventName: 'hit' }],
      }));
      seq.addTrack(new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        keyframes: [{ time: 0, value: 1 }],
      }));
      seq.time = 2;
      const j = seq.export();
      expect(j.version).toBe('0.1.0');
      expect(j.time).toBe(2);
      expect(j.duration).toBe(5);
      expect(j.loop).toBe(true);
      expect(j.speed).toBe(2);
      expect(j.tracks.length).toBe(3);
    });

    it('import: 恢复 time/duration/loop/speed', () => {
      const seq = new TimelineSequencer();
      seq.import({
        version: '0.1.0',
        time: 1.5,
        duration: 4,
        loop: true,
        speed: 1.5,
        tracks: [],
      });
      expect(seq.time).toBe(1.5);
      expect(seq.duration).toBe(4);
      expect(seq.loop).toBe(true);
      expect(seq.speed).toBe(1.5);
      expect(seq.lastTime).toBe(1.5);
    });

    it('import: 按 kind 重建轨道', () => {
      const seq = new TimelineSequencer();
      seq.import({
        version: '0.1.0',
        time: 0,
        duration: 5,
        loop: false,
        speed: 1,
        tracks: [
          { name: 'anim', type: 'animation', enabled: true, locked: false, clips: [] },
          { kind: 'event', name: 'evt', enabled: true, locked: false, events: [{ time: 1, eventName: 'hit' }] },
          { kind: 'property', name: 'prop', propertyPath: 'x', enabled: true, locked: false, keyframes: [{ time: 0, value: 1 }] },
        ],
      });
      expect(seq.tracks.length).toBe(3);
      expect(seq.getTrack('anim')).toBeInstanceOf(TimelineTrack);
      expect(seq.getTrack('evt')).toBeInstanceOf(EventTrack);
      expect(seq.getTrack('prop')).toBeInstanceOf(PropertyTrack);
    });

    it('import: 跳过无 name 的轨道', () => {
      const seq = new TimelineSequencer();
      seq.import({
        version: '0.1.0',
        time: 0,
        duration: 0,
        loop: false,
        speed: 1,
        tracks: [{ kind: 'event' }], // 无 name
      });
      expect(seq.tracks.length).toBe(0);
    });

    it('export → import 往返: 字段一致', () => {
      const seq1 = new TimelineSequencer({ duration: 5, loop: true, speed: 1.5 });
      seq1.addTrack(new EventTrack({
        name: 'evt',
        events: [{ time: 1, eventName: 'hit', data: { x: 1 } }],
      }));
      const json = seq1.export();
      const seq2 = new TimelineSequencer();
      seq2.import(json);
      expect(seq2.duration).toBe(5);
      expect(seq2.loop).toBe(true);
      expect(seq2.speed).toBe(1.5);
      expect(seq2.tracks.length).toBe(1);
      const t = seq2.getTrack('evt') as EventTrack;
      expect(t).toBeInstanceOf(EventTrack);
      expect(t.events.length).toBe(1);
      expect(t.events[0].eventName).toBe('hit');
    });
  });

  describe('完整场景', () => {
    it('播放期间 EventTrack + PropertyTrack 协同', () => {
      const bus = new EventBus();
      const events: string[] = [];
      bus.on('start', () => events.push('start'));
      bus.on('end', () => events.push('end'));

      const target = { x: 0 };
      const seq = new TimelineSequencer({ duration: 2, eventBus: bus });
      seq.addTrack(new EventTrack({
        name: 'evt',
        events: [
          { time: 0.5, eventName: 'start' },
          { time: 1.5, eventName: 'end' },
        ],
      }));
      seq.addTrack(new PropertyTrack({
        name: 'p',
        propertyPath: 'x',
        target,
        keyframes: [
          { time: 0, value: 0 },
          { time: 2, value: 100 },
        ],
      }));

      seq.play();
      seq.update(0.6); // time = 0.6, 触发 start, x = 30
      expect(events).toEqual(['start']);
      expect(target.x).toBeCloseTo(30, 5);

      seq.update(1.0); // time = 1.6, 触发 end, x = 80
      expect(events).toEqual(['start', 'end']);
      expect(target.x).toBeCloseTo(80, 5);

      seq.update(0.4); // time = 2.0, 自动 pause, x = 100
      expect(seq.isPlaying).toBe(false);
      expect(target.x).toBeCloseTo(100, 5);
    });
  });
});
