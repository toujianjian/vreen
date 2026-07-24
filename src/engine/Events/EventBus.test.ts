import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus';

describe('EventBus', () => {
  it('on + emit triggers listener with args', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('hit', fn);
    const count = bus.emit('hit', 1, 'a', { x: 2 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(1, 'a', { x: 2 });
    expect(count).toBe(1);
  });

  it('emit with no listeners returns 0 and is a no-op', () => {
    const bus = new EventBus();
    expect(bus.emit('noop', 1, 2)).toBe(0);
  });

  it('multiple listeners fire in registration order', () => {
    const bus = new EventBus();
    const order: string[] = [];
    bus.on('e', () => order.push('a'));
    bus.on('e', () => order.push('b'));
    bus.on('e', () => order.push('c'));
    bus.emit('e');
    expect(order).toEqual(['a', 'b', 'c']);
  });

  it('on returns an unsubscribe function', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    const off = bus.on('e', fn);
    expect(typeof off).toBe('function');
    bus.emit('e');
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    bus.emit('e');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('e')).toBe(0);
  });

  it('off removes a specific listener', () => {
    const bus = new EventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.on('e', a);
    bus.on('e', b);
    expect(bus.off('e', a)).toBe(true);
    bus.emit('e');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('off returns false for unknown callback / event', () => {
    const bus = new EventBus();
    bus.on('e', () => {});
    expect(bus.off('e', () => {})).toBe(false);
    expect(bus.off('missing', () => {})).toBe(false);
  });

  it('off cleans up empty event bucket', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('e', fn);
    bus.off('e', fn);
    expect(bus.eventNames()).toEqual([]);
    expect(bus.listenerCount('e')).toBe(0);
  });

  it('duplicate on with same callback is deduped (Set semantics)', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.on('e', fn);
    bus.on('e', fn);
    expect(bus.listenerCount('e')).toBe(1);
    bus.emit('e');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('once fires only on first emit', () => {
    const bus = new EventBus();
    const fn = vi.fn();
    bus.once('e', fn);
    expect(bus.listenerCount('e')).toBe(1);
    bus.emit('e');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('e')).toBe(0);
    bus.emit('e');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('once does not block other listeners', () => {
    const bus = new EventBus();
    const once = vi.fn();
    const persist = vi.fn();
    bus.once('e', once);
    bus.on('e', persist);
    bus.emit('e');
    bus.emit('e');
    expect(once).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('listener removed mid-emit is not called (snapshot safety)', () => {
    const bus = new EventBus();
    const b = vi.fn();
    // 'a' removes 'b' during emit; 'b' should be skipped.
    bus.on('e', () => bus.off('e', b));
    bus.on('e', b);
    bus.emit('e');
    expect(b).not.toHaveBeenCalled();
  });

  it('listener added mid-emit is not called in the same emit', () => {
    const bus = new EventBus();
    const late = vi.fn();
    bus.on('e', () => bus.on('e', late));
    bus.emit('e');
    expect(late).not.toHaveBeenCalled();
    bus.emit('e');
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('clear removes all listeners across all events', () => {
    const bus = new EventBus();
    bus.on('a', () => {});
    bus.on('b', () => {});
    bus.on('b', () => {});
    bus.clear();
    expect(bus.listenerCount('a')).toBe(0);
    expect(bus.listenerCount('b')).toBe(0);
    expect(bus.eventNames()).toEqual([]);
  });

  it('clearEvent removes only one event bucket', () => {
    const bus = new EventBus();
    bus.on('a', () => {});
    bus.on('b', () => {});
    expect(bus.clearEvent('a')).toBe(true);
    expect(bus.listenerCount('a')).toBe(0);
    expect(bus.listenerCount('b')).toBe(1);
    expect(bus.clearEvent('missing')).toBe(false);
  });

  it('eventNames returns a snapshot of registered event names', () => {
    const bus = new EventBus();
    bus.on('x', () => {});
    bus.on('y', () => {});
    const names = bus.eventNames();
    expect(names.sort()).toEqual(['x', 'y']);
    // mutating returned array should not affect bus
    names.push('z');
    expect(bus.eventNames().sort()).toEqual(['x', 'y']);
  });
});
