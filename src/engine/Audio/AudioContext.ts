// AudioContext — 引擎内全局原生 AudioContext 的单例管理。
//
// 浏览器要求 AudioContext 由用户手势触发创建（autoplay 政策），
// 因此把 getContext() 推迟到首次调用，避免模块导入时即创建上下文。
// 同时允许通过 setContext() 注入外部上下文（例如 OfflineAudioContext
// 离线渲染、或测试 mock）。
//
// 本类只是上下文的搬运工，不包含 Web Audio 节点本身。

type NativeAudioContextCtor = typeof AudioContext;

/** 浏览器可能提供 webkitAudioContext (老 Safari) 作为前缀别名。 */
interface WindowWithWebkit {
  AudioContext?: NativeAudioContextCtor;
  webkitAudioContext?: NativeAudioContextCtor;
}

let _context: AudioContext | undefined;

export class AudioContextManager {
  /**
   * 返回全局原生 AudioContext。首次调用时按浏览器能力创建实例。
   * 测试环境通过 setContext() 注入 mock 后，本方法返回该 mock。
   */
  static getContext(): AudioContext {
    if (_context === undefined) {
      const w = globalThis as unknown as WindowWithWebkit;
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) {
        throw new Error(
          'AudioContextManager: 当前环境没有 AudioContext / webkitAudioContext。' +
          '浏览器需 https 或用户手势；Node 测试需通过 setContext() 注入 mock。',
        );
      }
      _context = new Ctor();
    }
    return _context;
  }

  /** 显式覆盖全局上下文（供测试或离线渲染使用）。传 undefined 复位。 */
  static setContext(value: AudioContext | undefined): void {
    _context = value;
  }
}
