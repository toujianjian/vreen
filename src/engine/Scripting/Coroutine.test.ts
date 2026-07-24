import { describe, it, expect } from 'vitest';
import { CoroutineSystem, type CoroutineHandle } from './Coroutine';

/** 构造一个记录段执行次数的协程：
 *  yield 1.0 → yield 0.5 → 结束。 */
function* countedCoroutine(counter: { steps: number }): Generator<number, void, unknown> {
  counter.steps++;           // segment 1
  yield 1.0;
  counter.steps++;           // segment 2
  yield 0.5;
  counter.steps++;           // segment 3 (then returns)
}

describe('CoroutineSystem', () => {
  it('start returns a handle and size reflects active coroutines', () => {
    const sys = new CoroutineSystem();
    const handle = sys.start(countedCoroutine({ steps: 0 }));
    expect(handle).toBeDefined();
    expect(handle.id).toBeGreaterThan(0);
    expect(handle.done).toBe(false);
    expect(sys.size()).toBe(1);
  });

  it('advances the generator on first update and respects yield seconds', () => {
    const sys = new CoroutineSystem();
    const counter = { steps: 0 };
    const handle = sys.start(countedCoroutine(counter));

    // first update: runs segment 1, yields 1.0 → wait=1.0
    sys.update(0.5);
    expect(counter.steps).toBe(1);
    expect(handle.done).toBe(false);

    // wait 0.5 remains, not enough → no progress
    sys.update(0.4);
    expect(counter.steps).toBe(1);

    // wait now 0.1, +0.6 = -0.5 → resume, runs segment 2, yields 0.5 → wait=0.5
    sys.update(0.6);
    expect(counter.steps).toBe(2);
    expect(handle.done).toBe(false);

    // wait 0.5 → 0.1, not enough
    sys.update(0.4);
    expect(counter.steps).toBe(2);

    // wait 0.1 → 0.0 → resume, runs segment 3, generator returns → done
    sys.update(0.1);
    expect(counter.steps).toBe(3);
    expect(handle.done).toBe(true);
  });

  it('done coroutines are removed from the system after update', () => {
    const sys = new CoroutineSystem();
    const counter = { steps: 0 };
    const handle = sys.start(countedCoroutine(counter));
    // run to completion: total wait 1.0 + 0.5 = 1.5s
    sys.update(2.0); // segment 1, yields 1.0
    sys.update(2.0); // segment 2, yields 0.5
    sys.update(2.0); // segment 3, done
    expect(handle.done).toBe(true);
    expect(sys.size()).toBe(0);
  });

  it('yield without a value waits exactly one frame', () => {
    const sys = new CoroutineSystem();
    const log: string[] = [];
    function* co(): Generator<void, void, unknown> {
      log.push('a');
      yield; // one frame
      log.push('b');
    }
    const handle = sys.start(co());
    sys.update(0.016);
    expect(log).toEqual(['a']);
    expect(handle.done).toBe(false);
    sys.update(0.016);
    expect(log).toEqual(['a', 'b']);
    expect(handle.done).toBe(true);
    expect(sys.size()).toBe(0);
  });

  it('multiple coroutines advance independently', () => {
    const sys = new CoroutineSystem();
    const log: string[] = [];
    function* a(): Generator<number, void, unknown> {
      log.push('a1');
      yield 1.0;
      log.push('a2');
    }
    function* b(): Generator<number, void, unknown> {
      log.push('b1');
      yield 0.5;
      log.push('b2');
    }
    sys.start(a());
    sys.start(b());
    sys.update(0.5); // a: wait 1.0 (after -0.5), b: -0.5→ resume b1, wait 0.5
    expect(log).toEqual(['a1', 'b1']);
    sys.update(0.5); // a: 1.0-0.5=0.5 skip; b: 0.5-0.5=0 → resume b2 done
    expect(log).toEqual(['a1', 'b1', 'b2']);
    sys.update(1.0); // a: 0.5-1.0=-0.5 → resume a2 done
    expect(log).toEqual(['a1', 'b1', 'b2', 'a2']);
    expect(sys.size()).toBe(0);
  });

  it('stop terminates a coroutine early and removes it', () => {
    const sys = new CoroutineSystem();
    const counter = { steps: 0 };
    const handle = sys.start(countedCoroutine(counter));
    sys.update(0.1); // runs segment 1
    expect(counter.steps).toBe(1);
    expect(sys.stop(handle)).toBe(true);
    expect(handle.done).toBe(true);
    expect(sys.size()).toBe(0);
    // further updates do not advance it
    sys.update(10);
    expect(counter.steps).toBe(1);
  });

  it('stop on an already-done coroutine returns false', () => {
    const sys = new CoroutineSystem();
    const handle = sys.start(countedCoroutine({ steps: 0 }));
    sys.update(10); // segment 1
    sys.update(10); // segment 2
    sys.update(10); // segment 3, done
    expect(handle.done).toBe(true);
    expect(sys.stop(handle)).toBe(false);
  });

  it('stop on an unknown handle returns false', () => {
    const sys = new CoroutineSystem();
    const foreign: CoroutineHandle = {
      id: 999,
      generator: (function* () { /* empty */ })(),
      done: false,
      wait: 0,
    };
    expect(sys.stop(foreign)).toBe(false);
  });

  it('generator that throws is marked done without crashing update', () => {
    const sys = new CoroutineSystem();
    function* bad(): Generator<number, void, unknown> {
      yield 0.1;
      throw new Error('boom');
    }
    function* good(): Generator<number, void, unknown> {
      yield 0.1;
    }
    const badHandle = sys.start(bad());
    const goodHandle = sys.start(good());
    sys.update(0.1); // both resume once
    sys.update(0.1); // bad throws → done; good returns → done
    expect(badHandle.done).toBe(true);
    expect(goodHandle.done).toBe(true);
    expect(sys.size()).toBe(0);
  });

  it('clear terminates and removes all coroutines', () => {
    const sys = new CoroutineSystem();
    const h1 = sys.start(countedCoroutine({ steps: 0 }));
    const h2 = sys.start(countedCoroutine({ steps: 0 }));
    expect(sys.size()).toBe(2);
    sys.clear();
    expect(sys.size()).toBe(0);
    expect(h1.done).toBe(true);
    expect(h2.done).toBe(true);
  });

  it('ids are unique and monotonically increasing', () => {
    const sys = new CoroutineSystem();
    const h1 = sys.start((function* () { yield 1; })());
    const h2 = sys.start((function* () { yield 1; })());
    const h3 = sys.start((function* () { yield 1; })());
    expect(h2.id).toBe(h1.id + 1);
    expect(h3.id).toBe(h2.id + 1);
  });
});
