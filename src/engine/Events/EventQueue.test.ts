import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './EventBus';
import { EventQueue } from './EventQueue';
import { CollisionEvent, SpawnEvent } from './GameEvent';

describe('EventQueue', () => {
  it('enqueue does not dispatch immediately', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    const fn = vi.fn();
    bus.on('collision', fn);
    queue.enqueue(new CollisionEvent({
      selfId: 1, otherId: 2, normal: [0, 1, 0], depth: 0.1, point: [0, 0, 0],
    }));
    expect(fn).not.toHaveBeenCalled();
    expect(queue.size()).toBe(1);
    expect(queue.isEmpty()).toBe(false);
  });

  it('dispatch emits all queued events through the bus in FIFO order', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    const received: string[] = [];
    bus.on('collision', (e: CollisionEvent) => received.push(`collision:${e.data.selfId}`));
    bus.on('spawn', (e: SpawnEvent) => received.push(`spawn:${e.data.entityId}`));

    queue.enqueue(new CollisionEvent({ selfId: 1, otherId: 2, normal: [0, 0, 0], depth: 0, point: [0, 0, 0] }));
    queue.enqueue(new SpawnEvent({ entityId: 9 }));
    queue.enqueue(new CollisionEvent({ selfId: 3, otherId: 4, normal: [0, 0, 0], depth: 0, point: [0, 0, 0] }));

    const dispatched = queue.dispatch();
    expect(dispatched).toBe(3);
    expect(received).toEqual(['collision:1', 'spawn:9', 'collision:3']);
    expect(queue.size()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
  });

  it('dispatch on empty queue returns 0', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    expect(queue.dispatch()).toBe(0);
  });

  it('dispatch clears the queue even if no listeners are attached', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    queue.enqueue(new SpawnEvent({ entityId: 1 }));
    queue.enqueue(new SpawnEvent({ entityId: 2 }));
    const dispatched = queue.dispatch();
    expect(dispatched).toBe(2);
    expect(queue.size()).toBe(0);
  });

  it('flush discards pending events without dispatching', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    const fn = vi.fn();
    bus.on('spawn', fn);
    queue.enqueue(new SpawnEvent({ entityId: 1 }));
    queue.enqueue(new SpawnEvent({ entityId: 2 }));
    const dropped = queue.flush();
    expect(dropped).toBe(2);
    expect(fn).not.toHaveBeenCalled();
    expect(queue.size()).toBe(0);
  });

  it('flush on empty queue returns 0', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    expect(queue.flush()).toBe(0);
  });

  it('events enqueued by a listener during dispatch are NOT dispatched this round', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    const calls: number[] = [];
    bus.on('spawn', (e: SpawnEvent) => {
      calls.push(e.data.entityId);
      // first event triggers enqueueing a follow-up event
      if (e.data.entityId === 1) {
        queue.enqueue(new SpawnEvent({ entityId: 2 }));
      }
    });
    queue.enqueue(new SpawnEvent({ entityId: 1 }));
    expect(queue.dispatch()).toBe(1);
    expect(calls).toEqual([1]);
    // follow-up event remains in queue for the next dispatch
    expect(queue.size()).toBe(1);
    expect(queue.dispatch()).toBe(1);
    expect(calls).toEqual([1, 2]);
  });

  it('peek returns the front event without removing it', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    expect(queue.peek()).toBeUndefined();
    const first = new SpawnEvent({ entityId: 1 });
    queue.enqueue(first);
    queue.enqueue(new SpawnEvent({ entityId: 2 }));
    expect(queue.peek()).toBe(first);
    expect(queue.size()).toBe(2);
  });

  it('bus is exposed as a readonly property', () => {
    const bus = new EventBus();
    const queue = new EventQueue(bus);
    expect(queue.bus).toBe(bus);
  });
});
