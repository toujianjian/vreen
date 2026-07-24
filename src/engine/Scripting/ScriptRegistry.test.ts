import { describe, it, expect } from 'vitest';
import { ScriptRegistry } from './ScriptRegistry';
import type { ScriptInstance } from './ScriptComponent';

function makeScript(tag: string): ScriptInstance {
  return {
    onStart: () => {},
    onUpdate: () => {},
    tag, // extra field allowed by structural typing for identification
  } as unknown as ScriptInstance;
}

describe('ScriptRegistry', () => {
  it('register + has + create round-trip', () => {
    const reg = new ScriptRegistry();
    reg.register('PlayerController', () => makeScript('player'));
    expect(reg.has('PlayerController')).toBe(true);
    expect(reg.has('Missing')).toBe(false);
    const inst = reg.create('PlayerController');
    expect(inst).toBeDefined();
    expect((inst as any).tag).toBe('player');
  });

  it('create for unknown name returns undefined', () => {
    const reg = new ScriptRegistry();
    expect(reg.create('nope')).toBeUndefined();
  });

  it('create returns a fresh instance each call (factory invoked)', () => {
    const reg = new ScriptRegistry();
    let calls = 0;
    reg.register('s', () => {
      calls++;
      return makeScript(`n${calls}`);
    });
    const a = reg.create('s');
    const b = reg.create('s');
    expect(a).not.toBe(b);
    expect(calls).toBe(2);
    expect((a as any).tag).toBe('n1');
    expect((b as any).tag).toBe('n2');
  });

  it('register overwrites existing and returns true', () => {
    const reg = new ScriptRegistry();
    reg.register('s', () => makeScript('v1'));
    const overwritten = reg.register('s', () => makeScript('v2'));
    expect(overwritten).toBe(true);
    const inst = reg.create('s');
    expect((inst as any).tag).toBe('v2');
  });

  it('register on a new name returns false', () => {
    const reg = new ScriptRegistry();
    expect(reg.register('s', () => makeScript('v1'))).toBe(false);
  });

  it('getRegistered lists all registered names', () => {
    const reg = new ScriptRegistry();
    reg.register('a', () => makeScript('a'));
    reg.register('b', () => makeScript('b'));
    reg.register('c', () => makeScript('c'));
    expect(reg.getRegistered().sort()).toEqual(['a', 'b', 'c']);
  });

  it('getRegistered returns a snapshot (mutating result does not affect registry)', () => {
    const reg = new ScriptRegistry();
    reg.register('a', () => makeScript('a'));
    const list = reg.getRegistered();
    list.push('fake');
    expect(reg.getRegistered()).toEqual(['a']);
  });

  it('unregister removes a name and returns true', () => {
    const reg = new ScriptRegistry();
    reg.register('a', () => makeScript('a'));
    expect(reg.unregister('a')).toBe(true);
    expect(reg.has('a')).toBe(false);
    expect(reg.create('a')).toBeUndefined();
  });

  it('unregister on unknown name returns false', () => {
    const reg = new ScriptRegistry();
    expect(reg.unregister('nope')).toBe(false);
  });

  it('size reflects registered count', () => {
    const reg = new ScriptRegistry();
    expect(reg.size()).toBe(0);
    reg.register('a', () => makeScript('a'));
    reg.register('b', () => makeScript('b'));
    expect(reg.size()).toBe(2);
    reg.unregister('a');
    expect(reg.size()).toBe(1);
  });

  it('clear removes all registrations', () => {
    const reg = new ScriptRegistry();
    reg.register('a', () => makeScript('a'));
    reg.register('b', () => makeScript('b'));
    reg.clear();
    expect(reg.size()).toBe(0);
    expect(reg.getRegistered()).toEqual([]);
  });

  it('factory can return a class instance implementing ScriptInstance', () => {
    class Rotator implements ScriptInstance {
      speed = 1;
      onStart() {}
      onUpdate() {}
    }
    const reg = new ScriptRegistry();
    reg.register('Rotator', () => new Rotator());
    const inst = reg.create('Rotator') as Rotator;
    expect(inst).toBeInstanceOf(Rotator);
    expect(inst.speed).toBe(1);
  });
});
