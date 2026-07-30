// SceneTransitionSystem 单元测试。
//
// 覆盖:构造默认值、startTransition、update 推进、onComplete 回调、
// duration<=0 立即完成、minDisplayTime、6 种便捷工厂(fade/slide/zoom/dissolve/
// wipe/iris)、complete/cancel、isInTransition/getProgress/getTransitionType、
// setDuration/setLoadingScreen/setLoadingProgress/setMinDisplayTime、
// easingFunctions 5 个函数、getEasedProgress、getRenderData 各类型 alpha/offset、
// getStats、过渡中再 startTransition 先完成当前。

import { describe, it, expect, vi } from 'vitest';
import { Color } from '../Math/Color';
import {
  SceneTransitionSystem,
  type SceneTransitionSystemType,
} from './SceneTransition';

describe('SceneTransitionSystem — 构造与默认值', () => {
  it('默认字段初始化', () => {
    const sys = new SceneTransitionSystem();
    expect(sys.currentTransition).toBeNull();
    expect(sys.transitionProgress).toBe(0);
    expect(sys.transitionDuration).toBe(0);
    expect(sys.transitionType).toBe('fade');
    expect(sys.isTransitioning).toBe(false);
    expect(sys.onComplete).toBeNull();
    expect(sys.loadingScreen).toBe(false);
    expect(sys.loadingProgress).toBe(0);
    expect(sys.minDisplayTime).toBe(0);
    expect(sys.isInTransition()).toBe(false);
    expect(sys.getProgress()).toBe(0);
    expect(sys.getTransitionType()).toBeNull();
  });

  it('easingFunctions 包含 5 个函数', () => {
    const sys = new SceneTransitionSystem();
    expect(typeof sys.easingFunctions.line).toBe('function');
    expect(typeof sys.easingFunctions.easeIn).toBe('function');
    expect(typeof sys.easingFunctions.easeOut).toBe('function');
    expect(typeof sys.easingFunctions.easeInOut).toBe('function');
    expect(typeof sys.easingFunctions.bounceBack).toBe('function');
  });
});

describe('SceneTransitionSystem — easingFunctions', () => {
  const sys = new SceneTransitionSystem();
  it('line 线性', () => {
    expect(sys.easingFunctions.line(0)).toBe(0);
    expect(sys.easingFunctions.line(0.5)).toBe(0.5);
    expect(sys.easingFunctions.line(1)).toBe(1);
  });

  it('easeIn 二次方', () => {
    expect(sys.easingFunctions.easeIn(0)).toBe(0);
    expect(sys.easingFunctions.easeIn(0.5)).toBeCloseTo(0.25, 5);
    expect(sys.easingFunctions.easeIn(1)).toBe(1);
  });

  it('easeOut 二次方', () => {
    expect(sys.easingFunctions.easeOut(0)).toBe(0);
    expect(sys.easingFunctions.easeOut(0.5)).toBeCloseTo(0.75, 5);
    expect(sys.easingFunctions.easeOut(1)).toBe(1);
  });

  it('easeInOut S 曲线', () => {
    expect(sys.easingFunctions.easeInOut(0)).toBe(0);
    expect(sys.easingFunctions.easeInOut(0.5)).toBeCloseTo(0.5, 5);
    expect(sys.easingFunctions.easeInOut(1)).toBe(1);
  });

  it('bounceBack 端点为 0/1', () => {
    expect(sys.easingFunctions.bounceBack(0)).toBeCloseTo(0, 5);
    expect(sys.easingFunctions.bounceBack(1)).toBeCloseTo(1, 5);
  });
});

describe('SceneTransitionSystem — startTransition', () => {
  it('startTransition 设置状态', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 2.0, { color: new Color(0xff0000), easing: 'easeIn' });
    expect(sys.isTransitioning).toBe(true);
    expect(sys.transitionType).toBe('fade');
    expect(sys.transitionDuration).toBe(2.0);
    expect(sys.transitionProgress).toBe(0);
    expect(sys.currentTransition).not.toBeNull();
    expect(sys.currentTransition!.type).toBe('fade');
    expect(sys.getTransitionType()).toBe('fade');
  });

  it('startTransition duration<=0 立即完成', () => {
    const sys = new SceneTransitionSystem();
    const cb = vi.fn();
    sys.startTransition('fade', 0, { onComplete: cb });
    expect(sys.isTransitioning).toBe(false);
    expect(sys.transitionProgress).toBe(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('startTransition 负数 duration 夹到 0 并立即完成', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', -1);
    expect(sys.isTransitioning).toBe(false);
    expect(sys.transitionDuration).toBe(0);
  });

  it('过渡中 startTransition 新过渡先完成当前(触发回调)', () => {
    const sys = new SceneTransitionSystem();
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    sys.startTransition('fade', 2.0, { onComplete: cb1 });
    // 当前还在过渡中,启动新过渡
    sys.startTransition('slide', 1.0, { onComplete: cb2 });
    expect(cb1).toHaveBeenCalledTimes(1); // 旧过渡被完成
    expect(sys.transitionType).toBe('slide');
    expect(sys.isTransitioning).toBe(true);
    // cb2 尚未触发(新过渡未完成)
    expect(cb2).not.toHaveBeenCalled();
  });

  it('color 接受 Color/number/string', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0, { color: 0xff0000 });
    const data = sys.getRenderData();
    expect(data.color[0]).toBeCloseTo(1, 3);
    expect(data.color[1]).toBeCloseTo(0, 3);
  });
});

describe('SceneTransitionSystem — update 推进', () => {
  it('update 线性推进进度', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 2.0, { easing: 'line' });
    sys.update(0.5);
    expect(sys.getProgress()).toBeCloseTo(0.25, 5);
    sys.update(0.5);
    expect(sys.getProgress()).toBeCloseTo(0.5, 5);
  });

  it('update 完成时触发 onComplete', () => {
    const sys = new SceneTransitionSystem();
    const cb = vi.fn();
    sys.startTransition('fade', 1.0, { onComplete: cb });
    sys.update(1.0);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(sys.isTransitioning).toBe(false);
  });

  it('update 超出 duration 立即完成', () => {
    const sys = new SceneTransitionSystem();
    const cb = vi.fn();
    sys.startTransition('fade', 1.0, { onComplete: cb });
    sys.update(2.0);
    expect(sys.getProgress()).toBe(1);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(sys.isTransitioning).toBe(false);
  });

  it('update dt<=0 不推进', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0);
    sys.update(0);
    sys.update(-1);
    expect(sys.getProgress()).toBe(0);
    expect(sys.isTransitioning).toBe(true);
  });

  it('update 非过渡状态 no-op', () => {
    const sys = new SceneTransitionSystem();
    sys.update(1.0);
    expect(sys.getProgress()).toBe(0);
    expect(sys.isTransitioning).toBe(false);
  });

  it('onComplete 字段回调与 effect.onComplete 都触发', () => {
    const sys = new SceneTransitionSystem();
    const cbEffect = vi.fn();
    const cbField = vi.fn();
    sys.startTransition('fade', 1.0, { onComplete: cbEffect });
    sys.onComplete = cbField;
    sys.update(1.0);
    expect(cbEffect).toHaveBeenCalledTimes(1);
    expect(cbField).toHaveBeenCalledTimes(1);
  });

  it('回调异常不影响状态机', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0, {
      onComplete: () => { throw new Error('cb error'); },
    });
    expect(() => sys.update(1.0)).not.toThrow();
    expect(sys.isTransitioning).toBe(false);
  });
});

describe('SceneTransitionSystem — minDisplayTime', () => {
  it('minDisplayTime 延迟完成', () => {
    const sys = new SceneTransitionSystem();
    const cb = vi.fn();
    sys.setMinDisplayTime(2.0);
    sys.startTransition('fade', 1.0, { onComplete: cb });
    sys.update(1.0); // progress=1 但 _elapsed(1) < minDisplayTime(2)
    expect(sys.isTransitioning).toBe(true);
    expect(cb).not.toHaveBeenCalled();
    sys.update(1.0); // _elapsed=2 >= minDisplayTime
    expect(sys.isTransitioning).toBe(false);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('setMinDisplayTime 负数夹到 0', () => {
    const sys = new SceneTransitionSystem();
    sys.setMinDisplayTime(-1);
    expect(sys.minDisplayTime).toBe(0);
  });
});

describe('SceneTransitionSystem — 便捷工厂方法', () => {
  const types: SceneTransitionSystemType[] = ['fade', 'slide', 'zoom', 'dissolve', 'wipe', 'iris'];
  for (const t of types) {
    it(`${t} 工厂方法启动对应类型`, () => {
      const sys = new SceneTransitionSystem();
      switch (t) {
        case 'fade': sys.fade(1.0); break;
        case 'slide': sys.slide(1.0, 'left'); break;
        case 'zoom': sys.zoom(1.0, 'in'); break;
        case 'dissolve': sys.dissolve(1.0, 'noiseTex'); break;
        case 'wipe': sys.wipe(1.0, 'right'); break;
        case 'iris': sys.iris(1.0, 'in'); break;
      }
      expect(sys.transitionType).toBe(t);
      expect(sys.isTransitioning).toBe(true);
      expect(sys.transitionDuration).toBe(1.0);
    });
  }

  it('dissolve 传递 texture 标识', () => {
    const sys = new SceneTransitionSystem();
    sys.dissolve(1.0, 'myNoiseTex');
    const data = sys.getRenderData();
    expect(data.texture).toBe('myNoiseTex');
  });

  it('fade 接受 number 颜色', () => {
    const sys = new SceneTransitionSystem();
    sys.fade(1.0, 0xff0000);
    const data = sys.getRenderData();
    expect(data.color[0]).toBeCloseTo(1, 3);
  });

  it('fade 接受 string 颜色', () => {
    const sys = new SceneTransitionSystem();
    sys.fade(1.0, '#00ff00');
    const data = sys.getRenderData();
    expect(data.color[1]).toBeCloseTo(1, 3);
  });
});

describe('SceneTransitionSystem — complete / cancel', () => {
  it('complete 提前完成触发回调', () => {
    const sys = new SceneTransitionSystem();
    const cb = vi.fn();
    sys.startTransition('fade', 2.0, { onComplete: cb });
    sys.complete();
    expect(sys.isTransitioning).toBe(false);
    expect(sys.getProgress()).toBe(1);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('complete 无过渡时 no-op', () => {
    const sys = new SceneTransitionSystem();
    expect(() => sys.complete()).not.toThrow();
    expect(sys.isTransitioning).toBe(false);
  });

  it('cancel 不触发回调', () => {
    const sys = new SceneTransitionSystem();
    const cb = vi.fn();
    sys.startTransition('fade', 2.0, { onComplete: cb });
    sys.cancel();
    expect(sys.isTransitioning).toBe(false);
    expect(sys.getProgress()).toBe(0);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancel 无过渡时 no-op', () => {
    const sys = new SceneTransitionSystem();
    expect(() => sys.cancel()).not.toThrow();
  });

  it('complete 后再 update 不推进', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 2.0);
    sys.complete();
    const p = sys.getProgress();
    sys.update(1.0);
    expect(sys.getProgress()).toBe(p);
  });
});

describe('SceneTransitionSystem — setter 方法', () => {
  it('setDuration 更新当前过渡时长', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 2.0);
    sys.setDuration(5.0);
    expect(sys.transitionDuration).toBe(5.0);
    expect(sys.currentTransition!.duration).toBe(5.0);
  });

  it('setDuration 负数夹到 0', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 2.0);
    sys.setDuration(-1);
    expect(sys.transitionDuration).toBe(0);
  });

  it('setLoadingScreen 开关', () => {
    const sys = new SceneTransitionSystem();
    sys.setLoadingScreen(true);
    expect(sys.loadingScreen).toBe(true);
    sys.setLoadingScreen(false);
    expect(sys.loadingScreen).toBe(false);
  });

  it('setLoadingProgress 夹到 0..1', () => {
    const sys = new SceneTransitionSystem();
    sys.setLoadingProgress(0.5);
    expect(sys.loadingProgress).toBe(0.5);
    sys.setLoadingProgress(-1);
    expect(sys.loadingProgress).toBe(0);
    sys.setLoadingProgress(2);
    expect(sys.loadingProgress).toBe(1);
  });
});

describe('SceneTransitionSystem — getEasedProgress', () => {
  it('使用指定缓动函数', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0, { easing: 'easeIn' });
    sys.update(0.5); // progress=0.5
    // easeIn(0.5) = 0.25
    expect(sys.getEasedProgress()).toBeCloseTo(0.25, 5);
  });

  it('默认 line 缓动等于原始进度', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0);
    sys.update(0.3);
    expect(sys.getEasedProgress()).toBeCloseTo(0.3, 5);
  });
});

describe('SceneTransitionSystem — getRenderData', () => {
  it('无过渡时 active=false', () => {
    const sys = new SceneTransitionSystem();
    const data = sys.getRenderData();
    expect(data.active).toBe(false);
    expect(data.shouldSwap).toBe(false);
  });

  it('fade alpha 中点峰值', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0, { easing: 'line' });
    sys.update(0.5); // progress=0.5
    const data = sys.getRenderData();
    // alpha = 1 - |2*0.5 - 1| = 1
    expect(data.alpha).toBeCloseTo(1, 5);
    expect(data.shouldSwap).toBe(true);
  });

  it('fade progress=0 时 alpha=0', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0);
    const data = sys.getRenderData();
    expect(data.alpha).toBeCloseTo(0, 5);
  });

  it('slide 覆盖层 alpha=1', () => {
    const sys = new SceneTransitionSystem();
    sys.slide(1.0, 'left');
    sys.update(0.5);
    const data = sys.getRenderData();
    expect(data.alpha).toBe(1);
    expect(data.direction).toBe('left');
  });

  it('dissolve alpha = easedProgress', () => {
    const sys = new SceneTransitionSystem();
    sys.dissolve(1.0, 'tex');
    sys.update(0.5);
    const data = sys.getRenderData();
    expect(data.alpha).toBeCloseTo(0.5, 5);
    expect(data.texture).toBe('tex');
  });

  it('wipe alpha=1 + offset 随进度', () => {
    const sys = new SceneTransitionSystem();
    sys.wipe(1.0, 'left');
    sys.update(0.5);
    const data = sys.getRenderData();
    expect(data.alpha).toBe(1);
    // left 方向 sign=1, offset = 1 * 0.5 = 0.5
    expect(data.offset).toBeCloseTo(0.5, 5);
  });

  it('zoom alpha 中点峰值', () => {
    const sys = new SceneTransitionSystem();
    sys.zoom(1.0, 'in');
    sys.update(0.5);
    const data = sys.getRenderData();
    expect(data.alpha).toBeCloseTo(1, 5);
  });

  it('iris alpha 中点峰值', () => {
    const sys = new SceneTransitionSystem();
    sys.iris(1.0, 'in');
    sys.update(0.5);
    const data = sys.getRenderData();
    expect(data.alpha).toBeCloseTo(1, 5);
  });

  it('shouldSwap 在 progress>=0.5 时为 true', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0);
    sys.update(0.4);
    expect(sys.getRenderData().shouldSwap).toBe(false);
    sys.update(0.2); // progress=0.6
    expect(sys.getRenderData().shouldSwap).toBe(true);
  });

  it('loadingScreen/loadingProgress 透传到 renderData', () => {
    const sys = new SceneTransitionSystem();
    sys.setLoadingScreen(true);
    sys.setLoadingProgress(0.7);
    sys.startTransition('fade', 1.0);
    const data = sys.getRenderData();
    expect(data.loadingScreen).toBe(true);
    expect(data.loadingProgress).toBe(0.7);
  });

  it('color 透传为 [r,g,b]', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0, { color: new Color(0.2, 0.4, 0.6) });
    const data = sys.getRenderData();
    expect(data.color[0]).toBeCloseTo(0.2, 3);
    expect(data.color[1]).toBeCloseTo(0.4, 3);
    expect(data.color[2]).toBeCloseTo(0.6, 3);
  });

  it('color 不跨实例共享(clone)', () => {
    const c = new Color(0x112233);
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0, { color: c });
    c.setHex(0xffffff);
    const data = sys.getRenderData();
    expect(data.color[0]).toBeCloseTo(0x11 / 255, 3);
  });
});

describe('SceneTransitionSystem — getStats', () => {
  it('初始统计', () => {
    const sys = new SceneTransitionSystem();
    const s = sys.getStats();
    expect(s.transitioning).toBe(false);
    expect(s.type).toBeNull();
    expect(s.progress).toBe(0);
    expect(s.totalTransitions).toBe(0);
    expect(s.completedTransitions).toBe(0);
    expect(s.cancelledTransitions).toBe(0);
    expect(s.loadingScreen).toBe(false);
    expect(s.loadingProgress).toBe(0);
  });

  it('startTransition 累计 totalTransitions', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0);
    sys.startTransition('slide', 1.0);
    expect(sys.getStats().totalTransitions).toBe(2);
  });

  it('完成累计 completedTransitions', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 1.0);
    sys.update(1.0);
    expect(sys.getStats().completedTransitions).toBe(1);
  });

  it('cancel 累计 cancelledTransitions', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 2.0);
    sys.cancel();
    expect(sys.getStats().cancelledTransitions).toBe(1);
    expect(sys.getStats().completedTransitions).toBe(0);
  });

  it('complete 累计 completedTransitions', () => {
    const sys = new SceneTransitionSystem();
    sys.startTransition('fade', 2.0);
    sys.complete();
    expect(sys.getStats().completedTransitions).toBe(1);
  });

  it('进行中 stats 反映当前状态', () => {
    const sys = new SceneTransitionSystem();
    sys.setLoadingScreen(true);
    sys.setLoadingProgress(0.5);
    sys.startTransition('zoom', 2.0);
    sys.update(1.0);
    const s = sys.getStats();
    expect(s.transitioning).toBe(true);
    expect(s.type).toBe('zoom');
    expect(s.progress).toBeCloseTo(0.5, 5);
    expect(s.loadingScreen).toBe(true);
    expect(s.loadingProgress).toBe(0.5);
  });
});
