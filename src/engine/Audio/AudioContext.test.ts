import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AudioContextManager } from './AudioContext';
import { createMockAudioContext, type MockAudioContext } from './audioContextMock';

describe('AudioContextManager', () => {
  let mock: MockAudioContext;

  beforeEach(() => {
    mock = createMockAudioContext();
    AudioContextManager.setContext(mock as unknown as AudioContext);
  });

  afterEach(() => {
    AudioContextManager.setContext(undefined);
  });

  it('getContext 返回注入的上下文', () => {
    expect(AudioContextManager.getContext()).toBe(mock);
  });

  it('setContext(undefined) 后下次 getContext 重新创建（取注入值）', () => {
    AudioContextManager.setContext(undefined);
    const next = createMockAudioContext();
    AudioContextManager.setContext(next as unknown as AudioContext);
    expect(AudioContextManager.getContext()).toBe(next);
  });

  it('单例：多次 getContext 返回同一实例', () => {
    expect(AudioContextManager.getContext()).toBe(AudioContextManager.getContext());
  });
});
