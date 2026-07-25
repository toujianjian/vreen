// EventTrack 测试。
//
// 覆盖:
//   - 构造 / name 必填 / events 按 time 升序
//   - addEvent / removeEvent / removeEventByName
//   - getEventsBetween: 普通区间 + 循环回绕
//   - trigger: 通过 EventBus 触发事件 + payload 透传 + enabled=false 跳过
//   - getDuration / toJSON
import { describe, it, expect, vi } from 'vitest';
import { EventTrack, type TimedEvent } from './EventTrack';
import { EventBus } from '../Events/EventBus';

describe('EventTrack', () => {
  it('构造: 默认 enabled=true / locked=false / events 空', () => {
    const track = new EventTrack({ name: 'evt' });
    expect(track.enabled).toBe(true);
    expect(track.locked).toBe(false);
    expect(track.events).toEqual([]);
  });

  it('构造: name 必填', () => {
    expect(() => new EventTrack({ name: '' })).toThrow();
  });

  it('构造: 传入 events 按 time 升序', () => {
    const events = [
      { time: 3, eventName: 'c' },
      { time: 1, eventName: 'a' },
      { time: 2, eventName: 'b' },
    ];
    const track = new EventTrack({ name: 'evt', events });
    expect(track.events.map((e) => e.time)).toEqual([1, 2, 3]);
    expect(track.events.map((e) => e.eventName)).toEqual(['a', 'b', 'c']);
  });

  it('addEvent: 保持升序', () => {
    const track = new EventTrack({ name: 'evt' });
    track.addEvent({ time: 3, eventName: 'c' });
    track.addEvent({ time: 1, eventName: 'a' });
    track.addEvent({ time: 2, eventName: 'b' });
    expect(track.events.map((e) => e.eventName)).toEqual(['a', 'b', 'c']);
  });

  it('removeEvent: 按引用移除', () => {
    const e1: TimedEvent = { time: 1, eventName: 'a' };
    const e2: TimedEvent = { time: 2, eventName: 'b' };
    const track = new EventTrack({ name: 'evt', events: [e1, e2] });
    expect(track.removeEvent(e1)).toBe(true);
    expect(track.events.length).toBe(1);
    expect(track.removeEvent(e1)).toBe(false);
  });

  it('removeEventByName: 同名全部移除', () => {
    const track = new EventTrack({
      name: 'evt',
      events: [
        { time: 1, eventName: 'hit' },
        { time: 2, eventName: 'miss' },
        { time: 3, eventName: 'hit' },
      ],
    });
    expect(track.removeEventByName('hit')).toBe(2);
    expect(track.events.map((e) => e.eventName)).toEqual(['miss']);
    expect(track.removeEventByName('missing')).toBe(0);
  });

  describe('getEventsBetween', () => {
    it('普通区间: (lastTime, time] 左开右闭', () => {
      const track = new EventTrack({
        name: 'evt',
        events: [
          { time: 0.5, eventName: 'a' },
          { time: 1.0, eventName: 'b' },
          { time: 1.5, eventName: 'c' },
          { time: 2.0, eventName: 'd' },
        ],
      });
      // (0.5, 1.5] → b (1.0), c (1.5)
      const evts = track.getEventsBetween(0.5, 1.5);
      expect(evts.map((e) => e.eventName)).toEqual(['b', 'c']);
    });

    it('lastTime === time: 区间为空 (无穿越)', () => {
      const track = new EventTrack({
        name: 'evt',
        events: [{ time: 1, eventName: 'a' }],
      });
      expect(track.getEventsBetween(1, 1)).toEqual([]);
    });

    it('循环回绕: lastTime > time 触发两段 (lastTime,∞) ∪ [0,time]', () => {
      const track = new EventTrack({
        name: 'evt',
        events: [
          { time: 0.2, eventName: 'early' },
          { time: 1.8, eventName: 'late' },
          { time: 1.5, eventName: 'mid' },
        ],
      });
      // duration=2, 回绕: prevTime=0.9, nextTime=0.3 (wrap)
      // 第一段 (0.9, ∞): mid (1.5 ✓), late (1.8 ✓) — 按 event-time 升序
      // 第二段 [0, 0.3]: early (0.2 ✓)
      // 期望按时间顺序: mid, late, early
      const evts = track.getEventsBetween(0.9, 0.3);
      expect(evts.map((e) => e.eventName)).toEqual(['mid', 'late', 'early']);
    });

    it('循环回绕: 已触发的事件不重复触发', () => {
      const track = new EventTrack({
        name: 'evt',
        events: [
          { time: 0.2, eventName: 'early' },
          { time: 0.8, eventName: 'late' },
        ],
      });
      // 回绕: prevTime=0.9, nextTime=0.3 (wrap)
      // 第一段 (0.9, ∞): 无 (late=0.8 < 0.9, 已在上一帧触发)
      // 第二段 [0, 0.3]: early (0.2 ✓)
      const evts = track.getEventsBetween(0.9, 0.3);
      expect(evts.map((e) => e.eventName)).toEqual(['early']);
    });

    it('空事件列表返回空数组', () => {
      const track = new EventTrack({ name: 'evt' });
      expect(track.getEventsBetween(0, 1)).toEqual([]);
    });
  });

  describe('trigger', () => {
    it('触发区间内事件 + payload 透传', () => {
      const bus = new EventBus();
      const fn = vi.fn();
      bus.on('hit', fn);
      const track = new EventTrack({
        name: 'evt',
        events: [
          { time: 0.5, eventName: 'hit', data: { damage: 10 } },
          { time: 1.5, eventName: 'hit', data: { damage: 20 } },
        ],
      });
      const count = track.trigger(1.0, 0, bus);
      expect(count).toBe(1);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith({ damage: 10 });
    });

    it('区间内多事件按 time 升序触发', () => {
      const bus = new EventBus();
      const order: string[] = [];
      bus.on('a', () => order.push('a'));
      bus.on('b', () => order.push('b'));
      bus.on('c', () => order.push('c'));
      const track = new EventTrack({
        name: 'evt',
        events: [
          { time: 0.3, eventName: 'a' },
          { time: 0.5, eventName: 'b' },
          { time: 0.8, eventName: 'c' },
        ],
      });
      track.trigger(1.0, 0, bus);
      expect(order).toEqual(['a', 'b', 'c']);
    });

    it('bus=null 时返回 0 不抛错', () => {
      const track = new EventTrack({
        name: 'evt',
        events: [{ time: 0.5, eventName: 'hit' }],
      });
      expect(track.trigger(1, 0, null)).toBe(0);
    });

    it('enabled=false 时返回 0', () => {
      const bus = new EventBus();
      const fn = vi.fn();
      bus.on('hit', fn);
      const track = new EventTrack({
        name: 'evt',
        events: [{ time: 0.5, eventName: 'hit' }],
      });
      track.enabled = false;
      expect(track.trigger(1, 0, bus)).toBe(0);
      expect(fn).not.toHaveBeenCalled();
    });

    it('循环回绕: 触发两段事件', () => {
      const bus = new EventBus();
      const triggered: string[] = [];
      bus.on('early', () => triggered.push('early'));
      bus.on('late', () => triggered.push('late'));
      const track = new EventTrack({
        name: 'evt',
        events: [
          { time: 0.2, eventName: 'early' },  // 第二段 [0, 0.3]
          { time: 0.95, eventName: 'late' },  // 第一段 (0.9, +∞)
        ],
      });
      // prevTime=0.9, nextTime=0.3 (wrap)
      // 第一段 (0.9, +∞): late (0.95 ✓)
      // 第二段 [0, 0.3]: early (0.2 ✓)
      track.trigger(0.3, 0.9, bus);
      expect(triggered.sort()).toEqual(['early', 'late']);
    });
  });

  it('getDuration: 取最大 time', () => {
    const track = new EventTrack({
      name: 'evt',
      events: [
        { time: 1, eventName: 'a' },
        { time: 5, eventName: 'b' },
        { time: 3, eventName: 'c' },
      ],
    });
    expect(track.getDuration()).toBe(5);
  });

  it('getDuration: 空事件为 0', () => {
    const track = new EventTrack({ name: 'evt' });
    expect(track.getDuration()).toBe(0);
  });

  it('toJSON: kind="event" + events 拷贝', () => {
    const track = new EventTrack({
      name: 'evt',
      events: [{ time: 1, eventName: 'hit', data: { x: 1 } }],
    });
    const j = track.toJSON();
    expect(j.kind).toBe('event');
    expect(j.name).toBe('evt');
    expect(j.events.length).toBe(1);
    expect(j.events[0]).toEqual({ time: 1, eventName: 'hit', data: { x: 1 } });
  });
});
