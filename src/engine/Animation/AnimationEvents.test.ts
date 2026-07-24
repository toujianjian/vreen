// Phase 2.5.2 — 动画事件回调测试。
//
// 覆盖:
//   - AnimationClip.addEvent / addEvents 保持 time 升序
//   - AnimationAction.onEvent 注册回调,update 穿越时触发
//   - 单次穿越(prevTime → newTime 跨过 event.time)
//   - 多事件批量穿越
//   - 通配回调 '*' 接收所有事件
//   - unsubscribe 函数取消回调
//   - offEvent 清除回调
//   - repeat loop wrap-around:跨越 duration 时正确触发两段
//   - once loop:停止时不触发后续事件
//   - payload 透传
//   - stop/reset 重置 lastTime(下次 update 不触发 0 时刻事件)

import { describe, it, expect, vi } from 'vitest';
import { Object3D } from '../Core/Object3D';
import { AnimationClip } from './AnimationClip';
import { VectorKeyframeTrack } from './KeyframeTrack';
import { AnimationAction } from './AnimationAction';

function makeClip(name: string, duration: number): AnimationClip {
  // 加一个 dummy track 让 update 有事可做
  const track = new VectorKeyframeTrack('Bone.position', [0, duration], [0, 0, 0, 0, 0, 0]);
  const clip = new AnimationClip(name, duration, [track]);
  return clip;
}

function bindClip(clip: AnimationClip): Object3D {
  const root = new Object3D();
  const bone = new Object3D();
  bone.name = 'Bone';
  root.add(bone);
  clip.bind(root);
  return root;
}

describe('Phase 2.5.2 — 动画事件回调', () => {
  describe('AnimationClip.addEvent', () => {
    it('addEvent 保持 time 升序', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvent({ time: 1.5, name: 'b' });
      clip.addEvent({ time: 0.5, name: 'a' });
      clip.addEvent({ time: 1.0, name: 'mid' });
      expect(clip.events.map(e => e.time)).toEqual([0.5, 1.0, 1.5]);
      expect(clip.events.map(e => e.name)).toEqual(['a', 'mid', 'b']);
    });

    it('addEvents 批量添加并排序', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvents([
        { time: 1.0, name: 'b' },
        { time: 0.2, name: 'a' },
        { time: 1.5, name: 'c' },
      ]);
      expect(clip.events.map(e => e.time)).toEqual([0.2, 1.0, 1.5]);
    });
  });

  describe('AnimationAction 事件触发', () => {
    it('update 穿越事件时间时触发回调', () => {
      const clip = makeClip('walk', 2.0);
      clip.addEvent({ time: 0.5, name: 'footstep' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cb = vi.fn();
      action.onEvent('footstep', cb);

      // 第一次 update:0 → 0.3,未穿越 0.5
      action.update(0.3);
      expect(cb).not.toHaveBeenCalled();

      // 第二次 update:0.3 → 0.6,穿越 0.5
      action.update(0.3);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].name).toBe('footstep');
      expect(cb.mock.calls[0][0].time).toBe(0.5);
      expect(cb.mock.calls[0][1]).toBe(action);
    });

    it('同一区间内多个事件按 time 升序触发', () => {
      const clip = makeClip('attack', 2.0);
      clip.addEvents([
        { time: 0.3, name: 'windup' },
        { time: 0.5, name: 'hit' },
        { time: 0.8, name: 'recover' },
      ]);
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const names: string[] = [];
      action.onEvent('*', (e) => names.push(e.name));

      // 0 → 1.0,穿越 3 个事件
      action.update(1.0);
      expect(names).toEqual(['windup', 'hit', 'recover']);
    });

    it('通配回调 * 接收所有事件', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvents([
        { time: 0.3, name: 'a' },
        { time: 0.6, name: 'b' },
      ]);
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const all = vi.fn();
      action.onEvent('*', all);

      action.update(0.8);
      expect(all).toHaveBeenCalledTimes(2);
    });

    it('payload 透传给回调', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvent({ time: 0.5, name: 'spawn', payload: { vfx: 'fireball', damage: 42 } });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cb = vi.fn();
      action.onEvent('spawn', cb);

      action.update(0.6);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0].payload).toEqual({ vfx: 'fireball', damage: 42 });
    });

    it('unsubscribe 函数取消回调', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvent({ time: 0.5, name: 'hit' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cb = vi.fn();
      const unsub = action.onEvent('hit', cb);

      action.update(0.6);
      expect(cb).toHaveBeenCalledTimes(1);

      unsub();
      // wrap 到第二圈,再次穿越 0.5
      action.update(2.0);
      expect(cb).toHaveBeenCalledTimes(1); // 没有再触发
    });

    it('offEvent(name) 清除特定事件回调', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvent({ time: 0.5, name: 'hit' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cb = vi.fn();
      action.onEvent('hit', cb);

      action.update(0.6);
      expect(cb).toHaveBeenCalledTimes(1);

      action.offEvent('hit');
      action.update(2.0); // 第二圈
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('offEvent() 无参数清除所有回调', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvents([
        { time: 0.3, name: 'a' },
        { time: 0.6, name: 'b' },
      ]);
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cbA = vi.fn();
      const cbB = vi.fn();
      action.onEvent('a', cbA);
      action.onEvent('b', cbB);

      action.offEvent();
      action.update(0.8);
      expect(cbA).not.toHaveBeenCalled();
      expect(cbB).not.toHaveBeenCalled();
    });
  });

  describe('repeat loop wrap-around', () => {
    it('wrap 时触发 [prevTime, duration] 和 [0, newTime] 两段事件', () => {
      const clip = makeClip('walk', 1.0);
      clip.addEvents([
        { time: 0.2, name: 'early' },
        { time: 0.8, name: 'late' },
      ]);
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const names: string[] = [];
      action.onEvent('*', (e) => names.push(e.name));

      // 0 → 0.5(穿越 0.2 'early')
      action.update(0.5);
      expect(names).toEqual(['early']);
      names.length = 0;

      // 0.5 → 0.9 → wrap → 0.3(穿越 0.8 'late',再穿越 0.2 'early')
      action.update(0.8); // 0.5 + 0.8 = 1.3, wrap 到 0.3
      expect(names).toEqual(['late', 'early']);
    });

    it('恰好落在 duration 的 wrap 检测', () => {
      const clip = makeClip('test', 1.0);
      clip.addEvent({ time: 0.999, name: 'edge' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cb = vi.fn();
      action.onEvent('edge', cb);

      // 0.5 → 1.5 → wrap 到 0.5,穿越 0.999
      action.update(0.5); // 先到 0.5
      action.update(1.0); // 0.5 + 1.0 = 1.5 → wrap 到 0.5
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('once loop', () => {
    it('once loop 停止在 duration,触发区间内事件', () => {
      const clip = makeClip('attack', 1.0);
      clip.addEvent({ time: 0.5, name: 'hit' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'once';
      action.play();

      const cb = vi.fn();
      action.onEvent('hit', cb);

      action.update(0.6); // 穿越 0.5,但 0.6 < 1.0,仍在播放
      expect(cb).toHaveBeenCalledTimes(1);
      expect(action.isPlaying).toBe(true);

      // 继续推进到达 duration
      action.update(0.5); // 0.6 + 0.5 = 1.1 → clamp 到 1.0,停止
      expect(action.isPlaying).toBe(false);
    });

    it('once loop 到达 duration 后不再触发事件', () => {
      const clip = makeClip('attack', 1.0);
      clip.addEvent({ time: 0.5, name: 'hit' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'once';
      action.play();

      const cb = vi.fn();
      action.onEvent('hit', cb);

      action.update(1.5); // 到达 duration,停止
      expect(cb).toHaveBeenCalledTimes(1);
      expect(action.isPlaying).toBe(false);

      // 再 update 不应触发(isPlaying=false)
      action.update(0.5);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop / reset 重置事件检测', () => {
    it('stop 后重新 play,第一帧不触发 0 时刻事件', () => {
      const clip = makeClip('test', 1.0);
      clip.addEvent({ time: 0.0, name: 'start' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cb = vi.fn();
      action.onEvent('start', cb);

      // 第一次 update:0 → 0.1,不触发 time=0 的事件(因为 lastTime=-1)
      action.update(0.1);
      expect(cb).not.toHaveBeenCalled();

      // stop + play + update 到 wrap
      action.stop();
      action.play();
      action.update(0.1);
      expect(cb).not.toHaveBeenCalled(); // 仍然不触发 0 时刻
    });

    it('reset 后第一帧不触发 0 时刻事件', () => {
      const clip = makeClip('test', 1.0);
      clip.addEvent({ time: 0.0, name: 'start' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cb = vi.fn();
      action.onEvent('start', cb);

      action.update(0.5); // 到 0.5
      cb.mockClear();

      action.reset(); // time → 0, lastTime → -1
      action.update(0.1);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('边界情况', () => {
    it('没有事件的 clip:update 不抛错', () => {
      const clip = makeClip('test', 1.0);
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      expect(() => action.update(0.5)).not.toThrow();
    });

    it('timeScale 影响事件触发时机', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvent({ time: 1.0, name: 'mid' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.timeScale = 2; // 2倍速
      action.play();

      const cb = vi.fn();
      action.onEvent('mid', cb);

      // 实际时间推进 0.6s,但 timeScale=2 → clip 时间推进 1.2s,穿越 1.0
      action.update(0.6);
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('同一事件名多个回调都触发', () => {
      const clip = makeClip('test', 2.0);
      clip.addEvent({ time: 0.5, name: 'hit' });
      bindClip(clip);

      const action = new AnimationAction(clip);
      action.loop = 'repeat';
      action.play();

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      action.onEvent('hit', cb1);
      action.onEvent('hit', cb2);

      action.update(0.6);
      expect(cb1).toHaveBeenCalledTimes(1);
      expect(cb2).toHaveBeenCalledTimes(1);
    });
  });
});
