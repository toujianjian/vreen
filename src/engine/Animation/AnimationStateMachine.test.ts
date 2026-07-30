import { describe, it, expect } from 'vitest';
import { AnimationStateMachine, type AnimTransition } from './AnimationStateMachine';

describe('AnimationStateMachine', () => {
  // ── 状态管理 ──────────────────────────────────────────────────────

  describe('addState / removeState', () => {
    it('addState registers a state', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      expect(sm.getStates()).toHaveLength(1);
      expect(sm.getStates()[0].name).toBe('idle');
    });

    it('addState overwrites same-name state', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'idle', clipName: 'Idle2', speed: 2, loop: false });
      expect(sm.getStates()).toHaveLength(1);
      expect(sm.getStates()[0].clipName).toBe('Idle2');
      expect(sm.getStates()[0].speed).toBe(2);
    });

    it('removeState removes the state and its transitions', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', conditions: [], duration: 0, exitTime: 0,
      });
      expect(sm.removeState('walk')).toBe(true);
      expect(sm.getStates()).toHaveLength(1);
      expect(sm.getTransitions()).toHaveLength(0);
    });

    it('removeState returns false for unknown state', () => {
      const sm = new AnimationStateMachine();
      expect(sm.removeState('nonexistent')).toBe(false);
    });

    it('removeState clears currentState if it was removed', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.changeState('idle', 0);
      expect(sm.getCurrentState()?.name).toBe('idle');
      sm.removeState('idle');
      expect(sm.getCurrentState()).toBeNull();
    });
  });

  // ── 转换管理 ──────────────────────────────────────────────────────

  describe('addTransition', () => {
    it('addTransition registers a transition', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', conditions: [], duration: 0, exitTime: 0,
      });
      expect(sm.getTransitions()).toHaveLength(1);
    });
  });

  // ── 参数管理 ──────────────────────────────────────────────────────

  describe('parameters', () => {
    it('setParameter / getParameter round-trip', () => {
      const sm = new AnimationStateMachine();
      sm.setParameter('speed', 1.5);
      expect(sm.getParameter('speed')).toBe(1.5);
    });

    it('getParameter returns undefined for unknown parameter', () => {
      const sm = new AnimationStateMachine();
      expect(sm.getParameter('unknown')).toBeUndefined();
    });

    it('setParameter accepts boolean', () => {
      const sm = new AnimationStateMachine();
      sm.setParameter('grounded', true);
      expect(sm.getParameter('grounded')).toBe(true);
    });
  });

  // ── 触发器 ────────────────────────────────────────────────────────

  describe('trigger', () => {
    it('trigger sets boolean param to true', () => {
      const sm = new AnimationStateMachine();
      sm.trigger('attack');
      expect(sm.getParameter('attack')).toBe(true);
    });

    it('trigger resets to false after update', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.changeState('idle', 0);
      sm.trigger('attack');
      expect(sm.getParameter('attack')).toBe(true);
      sm.update(0.016);
      expect(sm.getParameter('attack')).toBe(false);
    });

    it('trigger fires transition with == condition', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'attack', clipName: 'Attack', speed: 1, loop: false });
      sm.addTransition({
        from: 'idle', to: 'attack', duration: 0, exitTime: 0,
        conditions: [{ parameter: 'attack', operator: '==', value: true }],
      });
      sm.changeState('idle', 0);
      sm.trigger('attack');
      sm.update(0.016);
      expect(sm.getCurrentState()?.name).toBe('attack');
      // trigger consumed
      expect(sm.getParameter('attack')).toBe(false);
    });
  });

  // ── changeState ───────────────────────────────────────────────────

  describe('changeState', () => {
    it('changeState switches immediately with duration 0', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      expect(sm.changeState('walk', 0)).toBe(true);
      expect(sm.getCurrentState()?.name).toBe('walk');
    });

    it('changeState returns false for unknown state', () => {
      const sm = new AnimationStateMachine();
      expect(sm.changeState('unknown', 0)).toBe(false);
    });

    it('changeState returns false if already in that state (not transitioning)', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.changeState('idle', 0);
      expect(sm.changeState('idle', 0)).toBe(false);
    });

    it('changeState with duration > 0 starts transition', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.changeState('idle', 0);
      sm.changeState('walk', 0.5);
      expect(sm.isTransitioning).toBe(true);
      expect(sm.transitionTime).toBeGreaterThan(0);
      // current state still idle during transition
      expect(sm.getCurrentState()?.name).toBe('idle');
    });

    it('transition completes after duration elapses', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.changeState('idle', 0);
      sm.changeState('walk', 0.3);
      // halfway
      sm.update(0.15);
      expect(sm.isTransitioning).toBe(true);
      expect(sm.getCurrentState()?.name).toBe('idle');
      // complete
      sm.update(0.15);
      expect(sm.isTransitioning).toBe(false);
      expect(sm.getCurrentState()?.name).toBe('walk');
      expect(sm.previousState?.name).toBe('idle');
    });
  });

  // ── update / 条件转换 ─────────────────────────────────────────────

  describe('update with conditions', () => {
    it('transitions when numeric condition is met (>)', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', duration: 0, exitTime: 0,
        conditions: [{ parameter: 'speed', operator: '>', value: 0.5 }],
      });
      sm.changeState('idle', 0);
      sm.setParameter('speed', 0.3);
      sm.update(0.016);
      expect(sm.getCurrentState()?.name).toBe('idle');
      sm.setParameter('speed', 1.0);
      sm.update(0.016);
      expect(sm.getCurrentState()?.name).toBe('walk');
    });

    it('does not transition when condition is not met', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', duration: 0, exitTime: 0,
        conditions: [{ parameter: 'speed', operator: '>', value: 0.5 }],
      });
      sm.changeState('idle', 0);
      sm.setParameter('speed', 0.3);
      sm.update(0.016);
      expect(sm.getCurrentState()?.name).toBe('idle');
    });

    it('transitions with all operators', () => {
      const testOp = (
        operator: AnimTransition['conditions'][0]['operator'],
        paramVal: number,
        condVal: number,
        expected: boolean,
      ): void => {
        const sm = new AnimationStateMachine();
        sm.addState({ name: 'a', clipName: 'A', speed: 1, loop: true });
        sm.addState({ name: 'b', clipName: 'B', speed: 1, loop: true });
        sm.addTransition({
          from: 'a', to: 'b', duration: 0, exitTime: 0,
          conditions: [{ parameter: 'p', operator, value: condVal }],
        });
        sm.changeState('a', 0);
        sm.setParameter('p', paramVal);
        sm.update(0.016);
        expect(sm.getCurrentState()?.name).toBe(expected ? 'b' : 'a');
      };

      testOp('==', 1, 1, true);
      testOp('==', 1, 2, false);
      testOp('!=', 1, 2, true);
      testOp('!=', 1, 1, false);
      testOp('>', 2, 1, true);
      testOp('>', 1, 2, false);
      testOp('<', 1, 2, true);
      testOp('<', 2, 1, false);
      testOp('>=', 1, 1, true);
      testOp('>=', 0, 1, false);
      testOp('<=', 1, 1, true);
      testOp('<=', 2, 1, false);
    });

    it('empty conditions = always transition', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', conditions: [], duration: 0, exitTime: 0,
      });
      sm.changeState('idle', 0);
      sm.update(0.016);
      expect(sm.getCurrentState()?.name).toBe('walk');
    });

    it('multiple conditions (AND semantics)', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'run', clipName: 'Run', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'run', duration: 0, exitTime: 0,
        conditions: [
          { parameter: 'speed', operator: '>', value: 1.0 },
          { parameter: 'grounded', operator: '==', value: true },
        ],
      });
      sm.changeState('idle', 0);
      // only speed met
      sm.setParameter('speed', 2.0);
      sm.setParameter('grounded', false);
      sm.update(0.016);
      expect(sm.getCurrentState()?.name).toBe('idle');
      // both met
      sm.setParameter('grounded', true);
      sm.update(0.016);
      expect(sm.getCurrentState()?.name).toBe('run');
    });

    it('transition with duration > 0 starts timed transition', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'run', clipName: 'Run', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'run', duration: 0.2, exitTime: 0,
        conditions: [{ parameter: 'speed', operator: '>', value: 1.0 }],
      });
      sm.changeState('idle', 0);
      sm.setParameter('speed', 2.0);
      sm.update(0.016);
      expect(sm.isTransitioning).toBe(true);
      expect(sm.getCurrentState()?.name).toBe('idle');
      // wait for transition to complete
      sm.update(0.2);
      expect(sm.isTransitioning).toBe(false);
      expect(sm.getCurrentState()?.name).toBe('run');
    });

    it('does not evaluate transitions during an active transition', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'a', clipName: 'A', speed: 1, loop: true });
      sm.addState({ name: 'b', clipName: 'B', speed: 1, loop: true });
      sm.addState({ name: 'c', clipName: 'C', speed: 1, loop: true });
      // a → b with duration (timed)
      sm.addTransition({
        from: 'a', to: 'b', duration: 0.5, exitTime: 0,
        conditions: [{ parameter: 'go', operator: '==', value: true }],
      });
      // a → c immediate (should not fire during a→b transition)
      sm.addTransition({
        from: 'a', to: 'c', duration: 0, exitTime: 0,
        conditions: [{ parameter: 'jump', operator: '==', value: true }],
      });
      sm.changeState('a', 0);
      sm.setParameter('go', true);
      sm.update(0.016); // starts a→b transition
      expect(sm.isTransitioning).toBe(true);
      sm.setParameter('jump', true);
      sm.update(0.016); // still transitioning, should NOT fire a→c
      expect(sm.getCurrentState()?.name).toBe('a');
      expect(sm.isTransitioning).toBe(true);
    });
  });

  // ── exitTime ──────────────────────────────────────────────────────

  describe('exitTime', () => {
    it('exitTime delays transition until clip reaches that fraction', () => {
      const sm = new AnimationStateMachine();
      sm.addState({
        name: 'idle', clipName: 'Idle', speed: 1, loop: true, clipDuration: 2.0,
      });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', duration: 0, exitTime: 0.5,
        conditions: [], // unconditional but gated by exitTime
      });
      sm.changeState('idle', 0);
      // before 50% of 2s = 1s
      sm.update(0.5);
      expect(sm.getCurrentState()?.name).toBe('idle');
      // past 1s
      sm.update(0.6);
      expect(sm.getCurrentState()?.name).toBe('walk');
    });

    it('exitTime <= 0 means no exit time requirement', () => {
      const sm = new AnimationStateMachine();
      sm.addState({
        name: 'idle', clipName: 'Idle', speed: 1, loop: true, clipDuration: 2.0,
      });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', duration: 0, exitTime: 0,
        conditions: [],
      });
      sm.changeState('idle', 0);
      sm.update(0.01);
      expect(sm.getCurrentState()?.name).toBe('walk');
    });

    it('exitTime ignored when clipDuration is 0/undefined', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', duration: 0, exitTime: 0.9,
        conditions: [],
      });
      sm.changeState('idle', 0);
      sm.update(0.01);
      expect(sm.getCurrentState()?.name).toBe('walk');
    });
  });

  // ── 查询方法 ──────────────────────────────────────────────────────

  describe('queries', () => {
    it('getCurrentState returns null before any state is entered', () => {
      const sm = new AnimationStateMachine();
      expect(sm.getCurrentState()).toBeNull();
    });

    it('getStates returns array of all states', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      expect(sm.getStates()).toHaveLength(2);
    });

    it('getTransitions returns array of all transitions', () => {
      const sm = new AnimationStateMachine();
      sm.addTransition({ from: 'a', to: 'b', conditions: [], duration: 0, exitTime: 0 });
      sm.addTransition({ from: 'b', to: 'c', conditions: [], duration: 0, exitTime: 0 });
      expect(sm.getTransitions()).toHaveLength(2);
    });

    it('getTransitionProgress returns 1 when not transitioning', () => {
      const sm = new AnimationStateMachine();
      expect(sm.getTransitionProgress()).toBe(1);
    });

    it('getTransitionProgress returns progress during transition', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'a', clipName: 'A', speed: 1, loop: true });
      sm.addState({ name: 'b', clipName: 'B', speed: 1, loop: true });
      sm.changeState('a', 0);
      sm.changeState('b', 1.0);
      sm.update(0.5);
      expect(sm.getTransitionProgress()).toBeCloseTo(0.5, 1);
    });
  });

  // ── 序列化 ────────────────────────────────────────────────────────

  describe('exportGraph / importGraph', () => {
    it('exportGraph returns states, transitions, parameters, currentState', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm.addTransition({
        from: 'idle', to: 'walk', duration: 0.2, exitTime: 0,
        conditions: [{ parameter: 'speed', operator: '>', value: 0.5 }],
      });
      sm.setParameter('speed', 1.0);
      sm.changeState('idle', 0);

      const graph = sm.exportGraph();
      expect(graph.states).toHaveLength(2);
      expect(graph.transitions).toHaveLength(1);
      expect(graph.parameters.speed).toBe(1.0);
      expect(graph.currentState).toBe('idle');
    });

    it('importGraph restores states, transitions, parameters, currentState', () => {
      const sm1 = new AnimationStateMachine();
      sm1.addState({ name: 'idle', clipName: 'Idle', speed: 1, loop: true });
      sm1.addState({ name: 'walk', clipName: 'Walk', speed: 1, loop: true });
      sm1.addTransition({
        from: 'idle', to: 'walk', duration: 0.2, exitTime: 0,
        conditions: [{ parameter: 'speed', operator: '>', value: 0.5 }],
      });
      sm1.setParameter('speed', 1.0);
      sm1.changeState('idle', 0);

      const graph = sm1.exportGraph();

      const sm2 = new AnimationStateMachine();
      sm2.importGraph(graph);
      expect(sm2.getStates()).toHaveLength(2);
      expect(sm2.getTransitions()).toHaveLength(1);
      expect(sm2.getParameter('speed')).toBe(1.0);
      expect(sm2.getCurrentState()?.name).toBe('idle');
    });

    it('importGraph replaces existing data', () => {
      const sm = new AnimationStateMachine();
      sm.addState({ name: 'old', clipName: 'Old', speed: 1, loop: true });
      sm.changeState('old', 0);

      sm.importGraph({
        states: [{ name: 'new', clipName: 'New', speed: 1, loop: true }],
        transitions: [],
        parameters: {},
        currentState: 'new',
      });
      expect(sm.getStates()).toHaveLength(1);
      expect(sm.getStates()[0].name).toBe('new');
      expect(sm.getCurrentState()?.name).toBe('new');
    });
  });
});
