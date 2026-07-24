import { describe, it, expect } from 'vitest';
import {
  GameEvent,
  CollisionEvent,
  TriggerEvent,
  SpawnEvent,
  DestroyEvent,
  ScoreEvent,
  CustomEvent,
  GameEventType,
} from './GameEvent';

describe('GameEvent', () => {
  describe('base class', () => {
    it('stores type, data, and a default timestamp', () => {
      const before = Date.now();
      const ev = new GameEvent('foo', { n: 1 });
      const after = Date.now();
      expect(ev.type).toBe('foo');
      expect(ev.data).toEqual({ n: 1 });
      expect(ev.timestamp).toBeGreaterThanOrEqual(before);
      expect(ev.timestamp).toBeLessThanOrEqual(after);
    });

    it('accepts an explicit timestamp', () => {
      const ev = new GameEvent('foo', null, 12345);
      expect(ev.timestamp).toBe(12345);
    });

    it('toString includes type and timestamp', () => {
      const ev = new GameEvent('foo', 1, 100);
      expect(ev.toString()).toBe('GameEvent(foo)@100');
    });
  });

  describe('CollisionEvent', () => {
    it('has type "collision" and typed data', () => {
      const ev = new CollisionEvent({
        selfId: 1,
        otherId: 2,
        normal: [0, 1, 0],
        depth: 0.25,
        point: [1, 2, 3],
      });
      expect(ev.type).toBe(GameEventType.Collision);
      expect(ev.type).toBe('collision');
      expect(ev.data.selfId).toBe(1);
      expect(ev.data.normal).toEqual([0, 1, 0]);
    });
  });

  describe('TriggerEvent', () => {
    it('has type "trigger" and supports enter/exit/stay phases', () => {
      const enter = new TriggerEvent({ selfId: 1, otherId: 2, phase: 'enter' });
      const exit = new TriggerEvent({ selfId: 1, otherId: 2, phase: 'exit' });
      const stay = new TriggerEvent({ selfId: 1, otherId: 2, phase: 'stay' });
      expect(enter.type).toBe('trigger');
      expect(enter.data.phase).toBe('enter');
      expect(exit.data.phase).toBe('exit');
      expect(stay.data.phase).toBe('stay');
    });
  });

  describe('SpawnEvent', () => {
    it('has type "spawn" with optional fields', () => {
      const ev = new SpawnEvent({ entityId: 7, source: 'spawner-1', position: [0, 0, 0] });
      expect(ev.type).toBe('spawn');
      expect(ev.data.entityId).toBe(7);
      expect(ev.data.source).toBe('spawner-1');
    });

    it('works without optional fields', () => {
      const ev = new SpawnEvent({ entityId: 7 });
      expect(ev.data.source).toBeUndefined();
      expect(ev.data.position).toBeUndefined();
    });
  });

  describe('DestroyEvent', () => {
    it('has type "destroy" with optional reason', () => {
      const ev = new DestroyEvent({ entityId: 3, reason: 'killed' });
      expect(ev.type).toBe('destroy');
      expect(ev.data.reason).toBe('killed');
    });
  });

  describe('ScoreEvent', () => {
    it('has type "score" with delta and total', () => {
      const ev = new ScoreEvent({ entityId: 1, delta: 10, total: 110 });
      expect(ev.type).toBe('score');
      expect(ev.data).toEqual({ entityId: 1, delta: 10, total: 110 });
    });
  });

  describe('CustomEvent', () => {
    it('has type "custom" and carries a name + payload', () => {
      const ev = new CustomEvent({ name: 'wave-complete', payload: { wave: 5 } });
      expect(ev.type).toBe('custom');
      expect(ev.data.name).toBe('wave-complete');
      expect(ev.data.payload).toEqual({ wave: 5 });
    });
  });

  it('GameEventType const keys map to the expected string values', () => {
    expect(GameEventType.Collision).toBe('collision');
    expect(GameEventType.Trigger).toBe('trigger');
    expect(GameEventType.Spawn).toBe('spawn');
    expect(GameEventType.Destroy).toBe('destroy');
    expect(GameEventType.Score).toBe('score');
    expect(GameEventType.Custom).toBe('custom');
  });

  it('subclass instances are instanceof GameEvent', () => {
    expect(new CollisionEvent({ selfId: 1, otherId: 2, normal: [0, 0, 0], depth: 0, point: [0, 0, 0] })).toBeInstanceOf(GameEvent);
    expect(new ScoreEvent({ entityId: 0, delta: 0, total: 0 })).toBeInstanceOf(GameEvent);
  });
});
