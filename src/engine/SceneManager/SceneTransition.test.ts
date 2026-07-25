// SceneTransition 测试 — 过渡状态机。
//
// 验证:
//   • Fade: 两阶段 (FadingOut → Swapping → FadingIn → Complete)
//   • Crossfade: 单阶段 (0→1)
//   • Slide / Wipe: 与 Fade 相同的两阶段时间模型
//   • None: 立即 Complete
//   • begin / reset / isComplete
//   • progress 在各阶段的取值范围
import { describe, it, expect } from 'vitest';
import { Color } from '../Math/Color';
import {
  SceneTransition,
  instantTransition,
  fadeTransition,
  type TransitionType,
} from './index';

describe('SceneTransition — 构造', () => {
  it('默认类型 Fade, 时长 1.0, 黑色, Left', () => {
    const t = new SceneTransition();
    expect(t.type).toBe('Fade');
    expect(t.duration).toBe(1.0);
    expect(t.color.getHex()).toBe(0x000000);
    expect(t.direction).toBe('Left');
    expect(t.phase).toBe('Idle');
    expect(t.progress).toBe(0);
  });

  it('自定义 type/duration/color/direction', () => {
    const t = new SceneTransition({
      type: 'Slide',
      duration: 2.0,
      color: 0xff8800,
      direction: 'Up',
    });
    expect(t.type).toBe('Slide');
    expect(t.duration).toBe(2.0);
    expect(t.color.getHex()).toBe(0xff8800);
    expect(t.direction).toBe('Up');
  });

  it('color 接受 Color 实例 (clone 而非引用)', () => {
    const c = new Color(0x123456);
    const t = new SceneTransition({ color: c });
    expect(t.color.getHex()).toBe(0x123456);
    // 修改原 Color 不影响 transition
    c.setHex(0xffffff);
    expect(t.color.getHex()).toBe(0x123456);
  });

  it('color 接受字符串', () => {
    const t = new SceneTransition({ color: '#ff0000' });
    expect(t.color.getHex()).toBe(0xff0000);
  });

  it('None 类型 duration 强制为 0', () => {
    const t = new SceneTransition({ type: 'None', duration: 5.0 });
    expect(t.duration).toBe(0);
  });

  it('负数 duration 被夹到 0', () => {
    const t = new SceneTransition({ type: 'Fade', duration: -1 });
    expect(t.duration).toBe(0);
  });
});

describe('SceneTransition — None 类型', () => {
  it('begin 后立即 Complete', () => {
    const t = new SceneTransition({ type: 'None' });
    t.begin();
    expect(t.phase).toBe('Complete');
    expect(t.isComplete()).toBe(true);
    expect(t.progress).toBe(1);
  });

  it('update 在 Complete 后不再变化', () => {
    const t = new SceneTransition({ type: 'None' });
    t.begin();
    t.update(1.0);
    expect(t.phase).toBe('Complete');
  });
});

describe('SceneTransition — Fade 两阶段', () => {
  it('begin 启动 FadingOut', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 2.0 });
    t.begin();
    expect(t.phase).toBe('FadingOut');
    expect(t.progress).toBe(0);
  });

  it('前半段时间 progress 0 → 1 (FadingOut)', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 2.0 });
    t.begin();
    t.update(0.5); // 1/4 of total → progress = 0.5
    expect(t.phase).toBe('FadingOut');
    expect(t.progress).toBeCloseTo(0.5, 5);
  });

  it('中点触发 Swapping', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 2.0 });
    t.begin();
    t.update(1.0); // 中点
    expect(t.phase).toBe('Swapping');
    expect(t.progress).toBe(1);
  });

  it('后半段 progress 1 → 0 (FadingIn)', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 2.0 });
    t.begin();
    t.update(1.0); // Swapping
    t.update(0.5); // 进入 FadingIn, 剩余 0.5s, half=1.0 → progress = 0.5
    expect(t.phase).toBe('FadingIn');
    expect(t.progress).toBeCloseTo(0.5, 5);
  });

  it('结束时 phase = Complete, progress = 0', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 2.0 });
    t.begin();
    t.update(1.0);
    t.update(1.0);
    expect(t.phase).toBe('Complete');
    expect(t.progress).toBe(0);
    expect(t.isComplete()).toBe(true);
  });

  it('update 超出 duration 后立即 Complete', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 1.0 });
    t.begin();
    t.update(2.0); // 一次跳过全程
    expect(t.phase).toBe('Complete');
  });
});

describe('SceneTransition — Crossfade 单阶段', () => {
  it('progress 单调 0 → 1', () => {
    const t = new SceneTransition({ type: 'Crossfade', duration: 2.0 });
    t.begin();
    t.update(0.5);
    expect(t.phase).toBe('FadingOut');
    expect(t.progress).toBeCloseTo(0.25, 5);
    t.update(0.5);
    expect(t.progress).toBeCloseTo(0.5, 5);
    t.update(1.0);
    expect(t.progress).toBe(1);
    expect(t.phase).toBe('Complete');
  });
});

describe('SceneTransition — Slide / Wipe', () => {
  // Slide 与 Wipe 时间模型与 Fade 一致 (两阶段)
  const types: TransitionType[] = ['Slide', 'Wipe'];
  for (const type of types) {
    it(`${type} 走两阶段时间模型`, () => {
      const t = new SceneTransition({ type, duration: 2.0 });
      t.begin();
      expect(t.phase).toBe('FadingOut');
      t.update(1.0);
      expect(t.phase).toBe('Swapping');
      t.update(1.0);
      expect(t.phase).toBe('Complete');
    });
  }

  it('direction 默认 Left', () => {
    const t = new SceneTransition({ type: 'Slide' });
    expect(t.direction).toBe('Left');
  });

  it('direction 接受 Up/Down/Left/Right', () => {
    for (const d of ['Up', 'Down', 'Left', 'Right'] as const) {
      const t = new SceneTransition({ type: 'Slide', direction: d });
      expect(t.direction).toBe(d);
    }
  });
});

describe('SceneTransition — reset / update 时机', () => {
  it('reset 把状态重置回 Idle', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 1.0 });
    t.begin();
    t.update(0.5);
    t.reset();
    expect(t.phase).toBe('Idle');
    expect(t.progress).toBe(0);
    expect(t.elapsedTime).toBe(0);
  });

  it('Idle 状态 update 不变化', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 1.0 });
    t.update(1.0);
    expect(t.phase).toBe('Idle');
  });

  it('dt <= 0 时 update 不推进', () => {
    const t = new SceneTransition({ type: 'Fade', duration: 1.0 });
    t.begin();
    t.update(0);
    t.update(-1);
    expect(t.elapsedTime).toBe(0);
    expect(t.phase).toBe('FadingOut');
  });

  it('render 是 no-op (不抛错)', () => {
    const t = new SceneTransition();
    expect(() => t.render(null as never)).not.toThrow();
  });
});

describe('SceneTransition — 工厂', () => {
  it('instantTransition 返回 None 类型', () => {
    const t = instantTransition();
    expect(t.type).toBe('None');
    expect(t.duration).toBe(0);
  });

  it('fadeTransition 默认 1.0s 黑色', () => {
    const t = fadeTransition();
    expect(t.type).toBe('Fade');
    expect(t.duration).toBe(1.0);
    expect(t.color.getHex()).toBe(0x000000);
  });

  it('fadeTransition 自定义参数', () => {
    const t = fadeTransition(2.0, 0xff0000);
    expect(t.duration).toBe(2.0);
    expect(t.color.getHex()).toBe(0xff0000);
  });
});
