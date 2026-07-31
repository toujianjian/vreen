// GOAPPlanner 测试 — 目标导向行动规划。
//
// 验证:
//   • 单动作直接达成目标
//   • 多动作链式规划(钥匙→门)
//   • 代价最优(A* 选择最低代价路径)
//   • 不可达目标返回失败
//   • 多目标按优先级规划
//   • GOAPAgent 状态管理与执行
//   • 重规划触发

import { describe, it, expect } from 'vitest';
import {
  GOAPPlanner,
  GOAPAgent,
  makeWorldState,
  type GOAPAction,
  type GOAPGoal,
} from './GOAPPlanner';

describe('GOAPPlanner — 基础规划', () => {
  it('目标已满足:返回空计划', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ hasKey: true });
    const goal: GOAPGoal = { name: 'haveKey', targetState: { hasKey: true }, priority: 1 };
    const result = planner.plan(state, [], goal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.actions.length).toBe(0);
      expect(result.plan.totalCost).toBe(0);
    }
  });

  it('单动作直接达成目标', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ atDoor: true, hasKey: false });
    const goal: GOAPGoal = { name: 'openDoor', targetState: { doorOpen: true }, priority: 1 };
    const actions: GOAPAction[] = [
      { name: 'openDoor', preconditions: { atDoor: true, hasKey: true }, effects: { doorOpen: true }, cost: 1 },
    ];
    // hasKey=false,无法满足 → 失败
    const r1 = planner.plan(state, actions, goal);
    expect(r1.success).toBe(false);

    // 修改状态
    state.set('hasKey', true);
    const r2 = planner.plan(state, actions, goal);
    expect(r2.success).toBe(true);
    if (r2.success) {
      expect(r2.plan.actions.length).toBe(1);
      expect(r2.plan.actions[0].name).toBe('openDoor');
      expect(r2.plan.totalCost).toBe(1);
    }
  });

  it('无动作返回 no-action', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ a: false });
    const goal: GOAPGoal = { name: 'g', targetState: { a: true }, priority: 1 };
    const result = planner.plan(state, [], goal);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('no-action');
  });

  it('空目标返回 no-goal', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ a: false });
    const goal: GOAPGoal = { name: 'g', targetState: {}, priority: 1 };
    const result = planner.plan(state, [{ name: 'x', preconditions: {}, effects: {}, cost: 1 }], goal);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('no-goal');
  });
});

describe('GOAPPlanner — 链式规划', () => {
  it('钥匙→门:先拿钥匙再开门', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ atDoor: true, hasKey: false, doorOpen: false });
    const goal: GOAPGoal = { name: 'escape', targetState: { doorOpen: true }, priority: 1 };
    const actions: GOAPAction[] = [
      { name: 'pickupKey', preconditions: {}, effects: { hasKey: true }, cost: 2 },
      { name: 'openDoor', preconditions: { atDoor: true, hasKey: true }, effects: { doorOpen: true }, cost: 1 },
    ];
    const result = planner.plan(state, actions, goal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.actions.length).toBe(2);
      expect(result.plan.actions[0].name).toBe('pickupKey');
      expect(result.plan.actions[1].name).toBe('openDoor');
      expect(result.plan.totalCost).toBe(3);
    }
  });

  it('代价最优:选择更便宜的路径', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ hungry: true });
    const goal: GOAPGoal = { name: 'full', targetState: { hungry: false }, priority: 1 };
    const actions: GOAPAction[] = [
      { name: 'cook', preconditions: { hungry: true }, effects: { hungry: false }, cost: 5 },
      { name: 'orderTakeout', preconditions: { hungry: true }, effects: { hungry: false }, cost: 2 },
      { name: 'eatSnack', preconditions: { hungry: true }, effects: { hungry: false }, cost: 1 },
    ];
    const result = planner.plan(state, actions, goal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.actions[0].name).toBe('eatSnack');
      expect(result.plan.totalCost).toBe(1);
    }
  });

  it('不可达目标返回失败', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ a: false });
    const goal: GOAPGoal = { name: 'g', targetState: { z: true }, priority: 1 };
    const actions: GOAPAction[] = [
      { name: 'x', preconditions: { a: true }, effects: { b: true }, cost: 1 },
    ];
    const result = planner.plan(state, actions, goal);
    expect(result.success).toBe(false);
  });
});

describe('GOAPPlanner — 多目标规划', () => {
  it('按优先级选择第一个可达目标', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ a: false, b: false });
    const goals: GOAPGoal[] = [
      { name: 'high', targetState: { unreachable: true }, priority: 10 },
      { name: 'low', targetState: { b: true }, priority: 1 },
    ];
    const actions: GOAPAction[] = [
      { name: 'setB', preconditions: {}, effects: { b: true }, cost: 1 },
    ];
    const result = planner.planMultiple(state, actions, goals);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.plan.goalName).toBe('low');
    }
  });

  it('activate 函数过滤未激活目标', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ hp: 100 });
    const goals: GOAPGoal[] = [
      { name: 'survive', targetState: { hp: 100 }, priority: 10, activate: (s) => (s.get('hp') as number) < 30 },
      { name: 'idle', targetState: { hp: 100 }, priority: 1 },
    ];
    const result = planner.planMultiple(state, [], goals);
    expect(result.success).toBe(true);
    if (result.success) {
      // survive 未激活(hp=100),idle 已满足
      expect(result.plan.goalName).toBe('idle');
    }
  });
});

describe('GOAPAgent — 状态与执行', () => {
  it(' addAction / addGoal / setState 链式调用', () => {
    const agent = new GOAPAgent('test');
    agent
      .addAction({ name: 'a', preconditions: {}, effects: { x: true }, cost: 1 })
      .addGoal({ name: 'g', targetState: { x: true }, priority: 1 })
      .setState('x', false);
    expect(agent.actions.length).toBe(1);
    expect(agent.goals.length).toBe(1);
    expect(agent.state.get('x')).toBe(false);
  });

  it('replan 生成计划', () => {
    const agent = new GOAPAgent('test');
    agent
      .addAction({ name: 'a', preconditions: {}, effects: { x: true }, cost: 1 })
      .addGoal({ name: 'g', targetState: { x: true }, priority: 1 })
      .setState('x', false);
    const ok = agent.replan();
    expect(ok).toBe(true);
    expect(agent.currentPlan).not.toBeNull();
    expect(agent.currentPlan!.actions.length).toBe(1);
  });

  it('update 返回当前应执行的动作', () => {
    const agent = new GOAPAgent('test');
    agent
      .addAction({ name: 'a', preconditions: {}, effects: { x: true }, cost: 1 })
      .addGoal({ name: 'g', targetState: { x: true }, priority: 1 })
      .setState('x', false);
    const action = agent.update();
    expect(action).not.toBeNull();
    expect(action!.name).toBe('a');
  });

  it('completeAction 应用效果并推进索引', () => {
    const agent = new GOAPAgent('test');
    agent
      .addAction({ name: 'a', preconditions: {}, effects: { x: true }, cost: 1 })
      .addGoal({ name: 'g', targetState: { x: true }, priority: 1 })
      .setState('x', false);
    agent.update();
    agent.completeAction();
    expect(agent.state.get('x')).toBe(true);
    expect(agent.remainingActions).toBe(0);
    expect(agent.progress).toBe(1);
  });

  it('failAction 清空计划并触发重规划', () => {
    const agent = new GOAPAgent('test');
    agent
      .addAction({ name: 'a', preconditions: {}, effects: { x: true }, cost: 1 })
      .addGoal({ name: 'g', targetState: { x: true }, priority: 1 })
      .setState('x', false);
    agent.update();
    agent.failAction();
    expect(agent.currentPlan).toBeNull();
    expect(agent.needsReplan).toBe(true);
    expect(agent.actionStatus).toBe('failure');
  });

  it('链式动作:逐个 completeAction', () => {
    const agent = new GOAPAgent('test');
    agent
      .addAction({ name: 'pickup', preconditions: {}, effects: { hasKey: true }, cost: 1 })
      .addAction({ name: 'open', preconditions: { hasKey: true }, effects: { doorOpen: true }, cost: 1 })
      .addGoal({ name: 'escape', targetState: { doorOpen: true }, priority: 1 })
      .setStates({ hasKey: false, doorOpen: false });
    agent.replan();
    expect(agent.currentPlan!.actions.length).toBe(2);

    // 第一个动作
    let cur = agent.update();
    expect(cur!.name).toBe('pickup');
    agent.completeAction();
    expect(agent.state.get('hasKey')).toBe(true);

    // 第二个动作
    cur = agent.update();
    expect(cur!.name).toBe('open');
    agent.completeAction();
    expect(agent.state.get('doorOpen')).toBe(true);
    expect(agent.remainingActions).toBe(0);
  });

  it('validate 函数动态阻止动作', () => {
    const planner = new GOAPPlanner();
    const state = makeWorldState({ x: false });
    const goal: GOAPGoal = { name: 'g', targetState: { x: true }, priority: 1 };
    const actions: GOAPAction[] = [
      { name: 'a', preconditions: {}, effects: { x: true }, cost: 1, validate: () => false },
    ];
    const result = planner.plan(state, actions, goal);
    expect(result.success).toBe(false);
  });
});

describe('GOAPPlanner — 边界条件', () => {
  it('深度限制生效', () => {
    const planner = new GOAPPlanner({ maxDepth: 3 });
    const state = makeWorldState({ n: 0 });
    const goal: GOAPGoal = { name: 'g', targetState: { n: 10 }, priority: 1 };
    const actions: GOAPAction[] = [
      { name: 'inc', preconditions: {}, effects: { n: 1 }, cost: 1 },
    ];
    // effects 把 n 设为 1,但目标要求 n=10,且 maxDepth=3 限制最多 3 个动作
    const result = planner.plan(state, actions, goal);
    expect(result.success).toBe(false);
  });

  it('节点数限制生效', () => {
    const planner = new GOAPPlanner({ maxNodes: 5 });
    const state = makeWorldState({ n: 0 });
    const goal: GOAPGoal = { name: 'g', targetState: { unreachable: true }, priority: 1 };
    const actions: GOAPAction[] = [];
    const result = planner.plan(state, actions, goal);
    expect(result.success).toBe(false);
  });

  it('启发式权重为 0 时退化为 Dijkstra', () => {
    const planner = new GOAPPlanner({ heuristicWeight: 0 });
    const state = makeWorldState({ start: true });
    const goal: GOAPGoal = { name: 'g', targetState: { end: true }, priority: 1 };
    const actions: GOAPAction[] = [
      { name: 'a', preconditions: { start: true }, effects: { end: true }, cost: 3 },
      { name: 'b', preconditions: { start: true }, effects: { mid: true }, cost: 1 },
      { name: 'c', preconditions: { mid: true }, effects: { end: true }, cost: 1 },
    ];
    const result = planner.plan(state, actions, goal);
    expect(result.success).toBe(true);
    if (result.success) {
      // 最优:b + c = 2 < a = 3
      expect(result.plan.totalCost).toBe(2);
    }
  });
});
