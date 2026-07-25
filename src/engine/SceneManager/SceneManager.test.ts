// SceneManager 测试 — 多场景注册 / 加载 / 切换。
//
// 验证:
//   • register / unregister
//   • load / preload / unload
//   • switch (无过渡 / None 过渡) 立即切换
//   • switch (Fade 过渡) 两阶段切换,Swapping 时切换 activeScene
//   • 生命周期钩子 onEnter / onLeave / onUnload
//   • getActive / getScene / getLoadedScenes / getRegisteredScenes
//   • isTransitioning / getActiveTransition
import { describe, it, expect, beforeEach } from 'vitest';
import { Scene } from '../Core/Scene';
import { Group } from '../Core/Group';
import {
  SceneManager,
  SceneTransition,
  instantTransition,
  type SceneLifecycleHooks,
} from './index';

function makeScene(name: string = 'Scene'): Scene {
  const s = new Scene();
  s.name = name;
  const g = new Group();
  g.name = `${name}.Group`;
  s.add(g);
  return s;
}

describe('SceneManager — 注册', () => {
  it('register 添加场景工厂', () => {
    const m = new SceneManager();
    m.register('menu', () => makeScene('Menu'));
    expect(m.getRegisteredScenes()).toEqual(['menu']);
  });

  it('register 重名覆盖 (warn)', () => {
    const m = new SceneManager();
    m.register('menu', () => makeScene('A'));
    m.register('menu', () => makeScene('B'));
    expect(m.getRegisteredScenes()).toEqual(['menu']);
  });

  it('register 空 name 抛错', () => {
    const m = new SceneManager();
    expect(() => m.register('', () => makeScene())).toThrow(/non-empty/);
  });

  it('register factory 非函数抛错', () => {
    const m = new SceneManager();
    expect(() => m.register('x', null as never)).toThrow(/not a function/);
  });

  it('unregister 卸载已加载实例', () => {
    const m = new SceneManager();
    let unloaded = false;
    m.register('a', () => makeScene(), { onUnload: () => { unloaded = true; } });
    m.load('a');
    expect(m.unregister('a')).toBe(true);
    expect(unloaded).toBe(true);
    expect(m.getRegisteredScenes()).toEqual([]);
  });

  it('unregister 不存在的场景返回 false', () => {
    const m = new SceneManager();
    expect(m.unregister('missing')).toBe(false);
  });
});

describe('SceneManager — load / preload / unload', () => {
  let m: SceneManager;
  beforeEach(() => {
    m = new SceneManager();
    m.register('a', () => makeScene('A'));
    m.register('b', () => makeScene('B'));
  });

  it('load 调用工厂创建实例', () => {
    const s = m.load('a');
    expect(s).toBeInstanceOf(Scene);
    expect(m.getLoadedScenes()).toEqual(['a']);
  });

  it('load 已加载场景 no-op (返回同一实例)', () => {
    const s1 = m.load('a');
    const s2 = m.load('a');
    expect(s1).toBe(s2);
  });

  it('load 未注册场景抛错', () => {
    expect(() => m.load('missing')).toThrow(/not registered/);
  });

  it('preload 等价于 load (创建但不切换)', () => {
    const s = m.preload('a');
    expect(s).toBeInstanceOf(Scene);
    expect(m.getLoadedScenes()).toEqual(['a']);
    expect(m.activeScene).toBeNull();
  });

  it('unload 释放实例', () => {
    m.load('a');
    expect(m.unload('a')).toBe(true);
    expect(m.getLoadedScenes()).toEqual([]);
    expect(m.getScene('a')).toBeNull();
  });

  it('unload 未加载场景返回 false', () => {
    expect(m.unload('a')).toBe(false);
  });

  it('unload 当前 active 场景后 activeScene 为 null', () => {
    m.switch('a');
    m.unload('a');
    expect(m.activeScene).toBeNull();
    expect(m.getActive()).toBeNull();
  });

  it('unload 触发 onUnload 钩子', () => {
    let unloaded = false;
    m.register('c', () => makeScene(), { onUnload: () => { unloaded = true; } });
    m.load('c');
    m.unload('c');
    expect(unloaded).toBe(true);
  });
});

describe('SceneManager — switch (无过渡)', () => {
  let m: SceneManager;
  beforeEach(() => {
    m = new SceneManager();
    m.register('a', () => makeScene('A'));
    m.register('b', () => makeScene('B'));
  });

  it('switch 立即切换 activeScene', () => {
    m.switch('a');
    expect(m.activeScene).toBe('a');
    expect(m.getActive()).toBeInstanceOf(Scene);
  });

  it('switch 自动加载未加载场景', () => {
    expect(m.getLoadedScenes()).toEqual([]);
    m.switch('a');
    expect(m.getLoadedScenes()).toEqual(['a']);
  });

  it('switch 多次切换 activeScene', () => {
    m.switch('a');
    expect(m.activeScene).toBe('a');
    m.switch('b');
    expect(m.activeScene).toBe('b');
  });

  it('switch 未注册场景抛错', () => {
    expect(() => m.switch('missing')).toThrow(/not registered/);
  });

  it('switch 同名 + None 过渡 = no-op', () => {
    m.switch('a');
    let enterCount = 0;
    m.unregister('a');
    m.register('a', () => makeScene('A'), { onEnter: () => { enterCount++; } });
    // 重新加载同名 (因 unregister 后 activeScene 已 null)
    m.switch('a');
    enterCount = 0;
    m.switch('a', instantTransition()); // 同名 + None
    expect(enterCount).toBe(0);
  });
});

describe('SceneManager — switch (带过渡)', () => {
  let m: SceneManager;
  beforeEach(() => {
    m = new SceneManager();
    m.register('a', () => makeScene('A'));
    m.register('b', () => makeScene('B'));
  });

  it('switch 带 Fade 过渡进入 transitioning 状态', () => {
    m.switch('a'); // 先有 active
    m.switch('b', new SceneTransition({ type: 'Fade', duration: 2.0 }));
    expect(m.isTransitioning()).toBe(true);
    expect(m.activeScene).toBe('a'); // 过渡中尚未切换
    expect(m.getActiveTransition()).not.toBeNull();
  });

  it('过渡前半段 activeScene 仍为旧值', () => {
    m.switch('a');
    m.switch('b', new SceneTransition({ type: 'Fade', duration: 2.0 }));
    m.update(0.5); // FadingOut 中
    expect(m.activeScene).toBe('a');
  });

  it('Swapping 阶段切换 activeScene', () => {
    m.switch('a');
    m.switch('b', new SceneTransition({ type: 'Fade', duration: 2.0 }));
    m.update(1.0); // Swapping 中点
    expect(m.activeScene).toBe('b');
  });

  it('过渡结束 isTransitioning=false', () => {
    m.switch('a');
    m.switch('b', new SceneTransition({ type: 'Fade', duration: 2.0 }));
    m.update(2.0); // 跳过全程
    expect(m.isTransitioning()).toBe(false);
    expect(m.activeScene).toBe('b');
    expect(m.getActiveTransition()).toBeNull();
  });

  it('SceneTransitionOptions 对象作为过渡参数', () => {
    m.switch('a');
    m.switch('b', { type: 'Fade', duration: 1.0 });
    expect(m.isTransitioning()).toBe(true);
  });

  it('Crossfade 过渡单阶段完成', () => {
    m.switch('a');
    m.switch('b', { type: 'Crossfade', duration: 1.0 });
    m.update(0.5);
    // Crossfade 在中点不会切换 activeScene (因为没 Swapping 阶段)
    // 但实际 SceneManager 在 Swapping 时切换 — Crossfade 没 Swapping
    // 我们的设计:Crossfade 完成时 (phase=Complete) 才视为切换
    // 但 SceneManager 检测 phase === 'Swapping' 才切;Crossfade 永远不会进入 Swapping
    // 因此 Crossfade 完成时 activeScene 应已切换 (因 isComplete 后 SceneManager 处理)
    m.update(0.6); // 完成
    expect(m.isTransitioning()).toBe(false);
    expect(m.activeScene).toBe('b');
  });
});

describe('SceneManager — 生命周期钩子', () => {
  it('onEnter / onLeave 在切换时触发', () => {
    const events: string[] = [];
    const m = new SceneManager();
    m.register('a', () => makeScene('A'), {
      onEnter: () => events.push('enter:a'),
      onLeave: () => events.push('leave:a'),
    });
    m.register('b', () => makeScene('B'), {
      onEnter: () => events.push('enter:b'),
      onLeave: () => events.push('leave:b'),
    });
    m.switch('a');
    expect(events).toEqual(['enter:a']);
    m.switch('b');
    expect(events).toEqual(['enter:a', 'leave:a', 'enter:b']);
  });

  it('globalHooks 与单场景钩子叠加调用', () => {
    const events: string[] = [];
    const globalHooks: SceneLifecycleHooks = {
      onEnter: (_s, name) => events.push(`global:enter:${name}`),
      onLeave: (_s, name) => events.push(`global:leave:${name}`),
    };
    const m = new SceneManager({ globalHooks });
    m.register('a', () => makeScene('A'), {
      onEnter: () => events.push('local:enter:a'),
    });
    m.switch('a');
    expect(events).toEqual(['local:enter:a', 'global:enter:a']);
  });

  it('onUnload 在 unload 时触发', () => {
    let unloaded = false;
    const m = new SceneManager();
    m.register('a', () => makeScene(), {
      onUnload: () => { unloaded = true; },
    });
    m.load('a');
    m.unload('a');
    expect(unloaded).toBe(true);
  });

  it('切走时触发 onLeave,切回时再触发 onEnter', () => {
    const events: string[] = [];
    const m = new SceneManager();
    m.register('a', () => makeScene('A'), {
      onEnter: () => events.push('enter:a'),
      onLeave: () => events.push('leave:a'),
    });
    m.register('b', () => makeScene('B'));
    m.switch('a');
    m.switch('b');
    m.switch('a');
    expect(events).toEqual(['enter:a', 'leave:a', 'enter:a']);
  });
});

describe('SceneManager — 查询 API', () => {
  it('getActive 返回当前 Scene', () => {
    const m = new SceneManager();
    m.register('a', () => makeScene('A'));
    m.switch('a');
    const active = m.getActive();
    expect(active).toBeInstanceOf(Scene);
    expect(active!.name).toBe('A');
  });

  it('无 active 时 getActive 返回 null', () => {
    const m = new SceneManager();
    expect(m.getActive()).toBeNull();
  });

  it('getScene 返回指定场景实例', () => {
    const m = new SceneManager();
    m.register('a', () => makeScene('A'));
    m.load('a');
    expect(m.getScene('a')).toBeInstanceOf(Scene);
    expect(m.getScene('missing')).toBeNull();
  });

  it('getLoadedScenes 只返回已加载的', () => {
    const m = new SceneManager();
    m.register('a', () => makeScene('A'));
    m.register('b', () => makeScene('B'));
    m.load('a');
    expect(m.getLoadedScenes()).toEqual(['a']);
    m.load('b');
    expect(m.getLoadedScenes().sort()).toEqual(['a', 'b']);
  });

  it('getRegisteredScenes 返回所有注册名', () => {
    const m = new SceneManager();
    m.register('a', () => makeScene());
    m.register('b', () => makeScene());
    expect(m.getRegisteredScenes().sort()).toEqual(['a', 'b']);
  });
});
