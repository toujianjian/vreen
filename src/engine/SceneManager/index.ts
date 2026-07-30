// SceneManager barrel —— 场景管理器统一导出。
//
// 模块职责：
//   - SceneManager     — 多场景注册 / 加载 / 切换管理器
//   - SceneTransition  — 场景过渡效果 (Fade/Crossfade/Slide/Wipe/None)
//   - SceneStreaming   — 场景流式加载(分块加载/卸载 + 预加载 + 优先级)

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
  // 高级场景过渡系统(管理器风格:6 种过渡 + 加载屏 + 缓动 + 渲染数据输出)。
  // 与基础 SceneTransition 类互补:基础类是单次过渡值对象(SceneManager 内部用),
  // SceneTransitionSystem 是管理器,持 currentTransition,适合上层 UI 需要加载屏 /
  // 多类型切换 / getRenderData() 输出覆盖层渲染数据的场景。
  SceneTransitionSystem,
  type SceneTransitionSystemType,
  type TransitionSystemDirection,
  type EasingName,
  type EasingFn,
  type TransitionEffect,
  type TransitionRenderData,
  type SceneTransitionSystemStats,
} from './SceneTransition';
export {
  SceneStreaming,
  createSceneChunk,
  type SceneChunk,
  type SceneChunkBounds,
  type SceneChunkRequest,
  type StreamingStats,
  type StreamCamera,
  type SceneStreamingOptions,
} from './SceneStreaming';
