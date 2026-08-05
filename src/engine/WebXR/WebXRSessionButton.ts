// WebXRSessionButton —— 进入/退出 VR/AR 会话的 DOM 按钮工厂。
//
// 适配自 three.js `VRButton` / `ARButton` / `XRButton`
// (examples/jsm/webxr/VRButton.js, ARButton.js, XRButton.js)。
// three.js 直接调 `renderer.xr.setSession`;VREEN 改为调 `WebXRManager.startSession`。
//
// 功能:
//   * 特征检测 (navigator.xr 是否存在 + isSessionSupported)。
//   * 安全上下文检测 (WebXR 需 HTTPS)。
//   * 会话切换 (ENTER ↔ EXIT),点击退出时 end() 当前会话。
//   * offerSession (设备主动授予会话,如头显自动接管)。
//   * sessiongranted 自动进入 (头显佩戴即进入)。
//   * 赛博朋克风格样式 (与 VREEN 主题一致)。

import type { WebXRManager } from './WebXRManager';
import type { XRSessionMode, XRSessionOptions } from './WebXRTypes';

/** 按钮样式选项。 */
export interface XRButtonStyleOptions {
  /** 位置 (default: bottom center)。 */
  position?: 'bottom-center' | 'bottom-right' | 'top-right' | 'custom';
  /** 文本 (VR 模式)。 */
  enterText?: string;
  exitText?: string;
  /** 不支持时的文本。 */
  notSupportedText?: string;
  notAllowedText?: string;
  /** 自定义样式 (CSS 字符串注入)。 */
  customStyle?: string;
}

const DEFAULT_STYLE: Required<Omit<XRButtonStyleOptions, 'position' | 'customStyle'>> = {
  enterText: 'ENTER VR',
  exitText: 'EXIT VR',
  notSupportedText: 'VR NOT SUPPORTED',
  notAllowedText: 'VR NOT ALLOWED',
};

/**
 * 创建进入/退出 VR 会话的按钮。
 *
 * ```ts
 * import { WebXRManager, createVRButton } from '@/engine/WebXR';
 * const button = createVRButton(manager, { enterText: 'ENTER VR' });
 * document.body.appendChild(button);
 * ```
 */
export function createVRButton(
  manager: WebXRManager,
  sessionInit: XRSessionOptions = {},
  style?: XRButtonStyleOptions,
): HTMLElement {
  return createXRButton(manager, 'immersive-vr', sessionInit, style);
}

/**
 * 创建进入/退出 AR 会话的按钮。
 */
export function createARButton(
  manager: WebXRManager,
  sessionInit: XRSessionOptions = {},
  style?: XRButtonStyleOptions,
): HTMLElement {
  const arStyle: XRButtonStyleOptions = {
    enterText: 'ENTER AR',
    exitText: 'EXIT AR',
    notSupportedText: 'AR NOT SUPPORTED',
    notAllowedText: 'AR NOT ALLOWED',
    ...style,
  };
  return createXRButton(manager, 'immersive-ar', sessionInit, arStyle);
}

/**
 * 创建通用 XR 会话按钮 (VR 或 AR)。
 *
 * 适配 three.js `XRButton.createButton` —— 统一 VR/AR 入口。
 */
export function createXRButton(
  manager: WebXRManager,
  mode: XRSessionMode,
  sessionInit: XRSessionOptions = {},
  style?: XRButtonStyleOptions,
): HTMLElement {
  const opts = { ...DEFAULT_STYLE, ...style };
  const isAR = mode === 'immersive-ar';

  // 检测 navigator.xr 是否存在。
  if (!manager.provider.available) {
    return createUnavailableMessage(isAR ? 'AR' : 'VR');
  }

  const button = document.createElement('button');
  button.id = isAR ? 'ARButton' : 'VRButton';
  button.style.display = 'none';
  applyDefaultStyle(button);

  if (style?.customStyle) {
    appendCustomStyle(button, style.customStyle);
  }

  // 应用位置。
  applyPosition(button, style?.position ?? 'bottom-center');

  let currentSessionActive = false;

  const sessionOptions: XRSessionOptions = {
    ...sessionInit,
    optionalFeatures: [
      isAR ? 'local-floor' : 'local-floor',
      'bounded-floor',
      'layers',
      ...(sessionInit.optionalFeatures || []),
    ],
  };

  // AR 默认需要 dom-overlay (可选)。
  if (isAR && sessionInit.domOverlay === undefined) {
    // 不强制 dom-overlay,保留默认。
  }

  /** 进入会话。 */
  async function onEnter(): Promise<void> {
    try {
      await manager.startSession(mode, sessionOptions);
      button.textContent = opts.exitText;
      currentSessionActive = true;
    } catch (err) {
      console.warn(`${mode} session failed:`, err);
      disableButton(button, opts.notAllowedText);
    }
  }

  /** 退出会话。 */
  async function onExit(): Promise<void> {
    await manager.end();
    button.textContent = opts.enterText;
    currentSessionActive = false;

    // 尝试 offerSession (设备主动授予)。
    if (manager.provider.offerSession) {
      try {
        const handle = await manager.provider.offerSession(mode, sessionOptions);
        await manager.setSession(handle);
        button.textContent = opts.exitText;
        currentSessionActive = true;
      } catch (err) {
        console.warn('offerSession failed:', err);
      }
    }
  }

  button.onclick = (): void => {
    if (currentSessionActive) {
      void onExit();
    } else {
      void onEnter();
    }
  };

  button.onmouseenter = (): void => { button.style.opacity = '1.0'; };
  button.onmouseleave = (): void => { button.style.opacity = '0.5'; };

  // 特征检测。
  manager.isSessionSupported(mode).then((supported: boolean) => {
    if (supported) {
      button.style.display = '';
      button.style.cursor = 'pointer';
      button.textContent = opts.enterText;

      // sessiongranted 自动进入。
      if (XRButtonState.sessionGranted) {
        button.click();
      }
    } else {
      disableButton(button, opts.notSupportedText);
    }
  }).catch(() => {
    disableButton(button, opts.notAllowedText);
  });

  // 会话被外部结束 (如用户在头显中退出)。
  manager.addEventListener('sessionend', (): void => {
    button.textContent = opts.enterText;
    currentSessionActive = false;
  });
  manager.addEventListener('sessionstart', (): void => {
    button.textContent = opts.exitText;
    currentSessionActive = true;
  });

  return button;
}

// ─── sessiongranted 全局状态 ───────────────────────────────────────────

/** 按钮全局状态 (sessiongranted 跟踪)。 */
const XRButtonState = {
  /** 是否被设备授予会话 (头显佩戴即进入)。 */
  sessionGranted: false,
  /** 是否已注册 sessiongranted 监听。 */
  registered: false,
};

/**
 * 注册 sessiongranted 事件监听 (头显佩戴自动进入)。
 * 适配 three.js `VRButton.registerSessionGrantedListener`。
 * 应在应用启动时调用一次。
 */
export function registerSessionGrantedListener(provider: { available: boolean; addEventListener?: (type: string, listener: () => void) => void }): void {
  if (XRButtonState.registered || !provider.available) return;
  // WebXRViewer (Firefox) 有 addEventListener 静默异常 bug。
  if (typeof navigator !== 'undefined' && /WebXRViewer\//i.test(navigator.userAgent)) return;

  provider.addEventListener?.('sessiongranted', (): void => {
    XRButtonState.sessionGranted = true;
  });
  XRButtonState.registered = true;
}

/** 重置 sessiongranted 状态 (测试用)。 */
export function resetXRButtonState(): void {
  XRButtonState.sessionGranted = false;
  XRButtonState.registered = false;
}

// ─── 样式工具 ──────────────────────────────────────────────────────────

/** 默认赛博朋克风格 (与 VREEN 主题一致)。 */
function applyDefaultStyle(el: HTMLElement): void {
  el.style.position = 'absolute';
  el.style.bottom = '20px';
  el.style.padding = '12px 24px';
  el.style.border = '1px solid #00f0ff';
  el.style.borderRadius = '2px';
  el.style.background = 'rgba(0, 12, 20, 0.75)';
  el.style.color = '#00f0ff';
  el.style.font = '700 11px/1 "JetBrains Mono", monospace';
  el.style.letterSpacing = '0.22em';
  el.style.textAlign = 'center';
  el.style.opacity = '0.5';
  el.style.outline = 'none';
  el.style.zIndex = '999';
  el.style.cursor = 'pointer';
  el.style.textTransform = 'uppercase';
  el.style.transition = 'opacity 0.2s, border-color 0.2s, box-shadow 0.2s';
  el.style.boxShadow = '0 0 12px rgba(0, 240, 255, 0.25)';
}

/** 应用位置。 */
function applyPosition(el: HTMLElement, position: NonNullable<XRButtonStyleOptions['position']>): void {
  switch (position) {
    case 'bottom-center':
      el.style.left = 'calc(50% - 60px)';
      el.style.width = '120px';
      break;
    case 'bottom-right':
      el.style.right = '20px';
      el.style.bottom = '20px';
      break;
    case 'top-right':
      el.style.top = '60px';
      el.style.right = '20px';
      el.style.bottom = 'auto';
      break;
    case 'custom':
      // 不设置位置,由调用方控制。
      break;
  }
}

/** 追加自定义样式。 */
function appendCustomStyle(_el: HTMLElement, css: string): void {
  const styleEl = document.createElement('style');
  styleEl.textContent = `${css}`;
  document.head.appendChild(styleEl);
}

/** 禁用按钮 (不支持/不允许)。 */
function disableButton(el: HTMLButtonElement, text: string): void {
  el.style.display = '';
  el.style.cursor = 'auto';
  el.style.opacity = '0.4';
  el.style.borderColor = '#ff2a6d';
  el.style.color = '#ff2a6d';
  el.style.boxShadow = '0 0 12px rgba(255, 42, 109, 0.25)';
  el.onmouseenter = null;
  el.onmouseleave = null;
  el.onclick = null;
  el.textContent = text;
}

/** 创建不可用消息 (无 navigator.xr)。 */
function createUnavailableMessage(mode: 'VR' | 'AR'): HTMLElement {
  const message = document.createElement('a');

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    message.href = typeof document !== 'undefined' ? document.location.href.replace(/^http:/, 'https:') : '#';
    message.innerHTML = 'WEBXR NEEDS HTTPS';
  } else {
    message.href = 'https://immersiveweb.dev/';
    message.innerHTML = `${mode} NOT AVAILABLE`;
  }

  message.style.position = 'absolute';
  message.style.bottom = '20px';
  message.style.left = 'calc(50% - 90px)';
  message.style.width = '180px';
  message.style.padding = '12px 6px';
  message.style.border = '1px solid #ff2a6d';
  message.style.borderRadius = '2px';
  message.style.background = 'rgba(0, 12, 20, 0.75)';
  message.style.color = '#ff2a6d';
  message.style.font = '700 11px/1 "JetBrains Mono", monospace';
  message.style.letterSpacing = '0.22em';
  message.style.textAlign = 'center';
  message.style.textDecoration = 'none';
  message.style.zIndex = '999';
  message.style.textTransform = 'uppercase';

  return message;
}
