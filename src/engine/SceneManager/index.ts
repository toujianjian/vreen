// SceneManager barrel —— 场景管理器统一导出。
//
// 模块职责：
//   - SceneManager     — 多场景注册 / 加载 / 切换管理器
//   - SceneTransition  — 场景过渡效果 (Fade/Crossfade/Slide/Wipe/None)

export {
  SceneManager,
  type SceneFactory,
  type SceneLifecycleHooks,
  type SceneManagerOptions,
} from './SceneManager';
export {
  SceneTransition,
  instantTransition,
  fadeTransition,
  type TransitionType,
  type TransitionPhase,
  type TransitionDirection,
  type SceneTransitionOptions,
} from './SceneTransition';
