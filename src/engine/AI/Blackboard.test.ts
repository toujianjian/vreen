import { describe, it, expect } from 'vitest';
import { Blackboard } from './Blackboard';
import { Vector3 } from '../Math';

describe('Blackboard', () => {
  it('默认空黑板 size 为 0', () => {
    const bb = new Blackboard();
    expect(bb.size).toBe(0);
  });

  it('set/get 读写值', () => {
    const bb = new Blackboard();
    bb.set('hp', 100);
    expect(bb.get('hp')).toBe(100);
  });

  it('get 不存在的键返回 undefined', () => {
    const bb = new Blackboard();
    expect(bb.get('nope')).toBeUndefined();
  });

  it('has 检查键存在', () => {
    const bb = new Blackboard();
    bb.set('a', 1);
    expect(bb.has('a')).toBe(true);
    expect(bb.has('b')).toBe(false);
  });

  it('remove 移除键', () => {
    const bb = new Blackboard();
    bb.set('a', 1);
    bb.remove('a');
    expect(bb.has('a')).toBe(false);
    expect(bb.size).toBe(0);
  });

  it('remove 不存在的键不报错', () => {
    const bb = new Blackboard();
    expect(() => bb.remove('nope')).not.toThrow();
  });

  it('clear 清空所有键', () => {
    const bb = new Blackboard();
    bb.set('a', 1);
    bb.set('b', 2);
    bb.clear();
    expect(bb.size).toBe(0);
    expect(bb.has('a')).toBe(false);
  });

  it('set 覆盖已有值', () => {
    const bb = new Blackboard();
    bb.set('a', 1);
    bb.set('a', 2);
    expect(bb.get('a')).toBe(2);
    expect(bb.size).toBe(1);
  });

  it('keys 返回所有键快照', () => {
    const bb = new Blackboard();
    bb.set('x', 1);
    bb.set('y', 2);
    const keys = bb.keys();
    expect(keys.length).toBe(2);
    expect(keys).toContain('x');
    expect(keys).toContain('y');
  });

  it('set 链式调用', () => {
    const bb = new Blackboard();
    bb.set('a', 1).set('b', 2).set('c', 3);
    expect(bb.size).toBe(3);
  });

  it('getNumber 类型安全获取', () => {
    const bb = new Blackboard();
    bb.set('hp', 100);
    bb.set('name', 'abc');
    bb.set('nan', NaN);
    expect(bb.getNumber('hp')).toBe(100);
    expect(bb.getNumber('name')).toBe(0); // 类型不符返回 fallback
    expect(bb.getNumber('nan')).toBe(0); // NaN 不算有限数
    expect(bb.getNumber('nope', -1)).toBe(-1); // 不存在返回 fallback
  });

  it('getString 类型安全获取', () => {
    const bb = new Blackboard();
    bb.set('name', 'hero');
    bb.set('hp', 100);
    expect(bb.getString('name')).toBe('hero');
    expect(bb.getString('hp')).toBe(''); // 类型不符
    expect(bb.getString('nope', 'default')).toBe('default');
  });

  it('getBool 类型安全获取', () => {
    const bb = new Blackboard();
    bb.set('alive', true);
    bb.set('hp', 100);
    expect(bb.getBool('alive')).toBe(true);
    expect(bb.getBool('hp')).toBe(false); // 类型不符
    expect(bb.getBool('nope', true)).toBe(true);
  });

  it('getVector3 类型安全获取', () => {
    const bb = new Blackboard();
    const v = new Vector3(1, 2, 3);
    bb.set('pos', v);
    bb.set('hp', 100);
    const got = bb.getVector3('pos');
    expect(got).toBe(v); // 同一引用
    expect(got?.x).toBe(1);
    expect(got?.y).toBe(2);
    expect(got?.z).toBe(3);
    expect(bb.getVector3('hp')).toBeUndefined(); // 类型不符
    const fb = new Vector3(0, 0, 0);
    expect(bb.getVector3('nope', fb)).toBe(fb);
  });

  it('getVector3 接受鸭子类型 Vector3', () => {
    const bb = new Blackboard();
    bb.set('pos', { x: 4, y: 5, z: 6 });
    const got = bb.getVector3('pos');
    expect(got?.x).toBe(4);
    expect(got?.y).toBe(5);
    expect(got?.z).toBe(6);
  });

  it('getVector3 拒绝缺字段对象', () => {
    const bb = new Blackboard();
    bb.set('bad', { x: 1, y: 2 }); // 缺 z
    expect(bb.getVector3('bad')).toBeUndefined();
  });

  it('get<T> 泛型获取', () => {
    const bb = new Blackboard();
    interface Foo { a: number }
    const foo: Foo = { a: 42 };
    bb.set('foo', foo);
    const v = bb.get<Foo>('foo');
    expect(v?.a).toBe(42);
  });
});
