import { describe, it, expect } from 'vitest';
import { Blackboard } from './Blackboard';
import { BTNode, type BTStatus } from './BTNode';
import { Sequence, Selector, Parallel } from './BTComposite';
import { Inverter, Repeater, Succeeder, Failer, UntilFail } from './BTDecorator';
import { BTAction } from './BTAction';
import { BTCondition } from './BTCondition';
import { BehaviorTree } from './BehaviorTree';

// --- 辅助节点工厂 ---------------------------------------------------------

/** 计数动作:每次 tick 自增计数器,可指定返回状态。 */
class CountAction extends BTNode {
  count = 0;
  constructor(private result: BTStatus = 'success', name = 'count') {
    super(name);
  }
  tick(_blackboard?: Blackboard): BTStatus {
    this.count++;
    this._status = this.result;
    return this._status;
  }
}

/** 可控动作:通过外部变量切换返回状态。 */
class MutableAction extends BTNode {
  count = 0;
  result: BTStatus = 'success';
  constructor(name = 'mut', result: BTStatus = 'success') {
    super(name);
    this.result = result;
  }
  tick(_blackboard?: Blackboard): BTStatus {
    this.count++;
    this._status = this.result;
    return this._status;
  }
}

// --- BTNode 基类 ---------------------------------------------------------

describe('BTNode (基类行为)', () => {
  it('初始 status 为 failure', () => {
    const n = new CountAction();
    expect(n.getStatus()).toBe('failure');
  });

  it('tick 后更新 status', () => {
    const n = new CountAction('success');
    n.tick(new Blackboard());
    expect(n.getStatus()).toBe('success');
    expect(n.count).toBe(1);
  });

  it('reset 复位 status', () => {
    const n = new CountAction('success');
    n.tick(new Blackboard());
    n.reset();
    expect(n.getStatus()).toBe('failure');
  });

  it('abort 后 tick 直接返回 failure', () => {
    const n = new CountAction('success');
    n.abort();
    expect(n.isAborted()).toBe(true);
    const s = n.tick(new Blackboard());
    expect(s).toBe('failure');
    expect(n.count).toBe(0); // 未真正执行
  });

  it('abort 后 reset 才能恢复', () => {
    const n = new CountAction('success');
    n.abort();
    n.reset();
    expect(n.isAborted()).toBe(false);
    n.tick(new Blackboard());
    expect(n.getStatus()).toBe('success');
  });

  it('parent 默认为 null', () => {
    const n = new CountAction();
    expect(n.parent).toBeNull();
  });
});

// --- BTAction ------------------------------------------------------------

describe('BTAction', () => {
  it('执行注入函数并返回状态', () => {
    const a = new BTAction('a', () => 'success');
    expect(a.tick(new Blackboard())).toBe('success');
  });

  it('未设置 executeFn 返回 failure', () => {
    const a = new BTAction('a');
    expect(a.tick(new Blackboard())).toBe('failure');
  });

  it('setExecute 替换函数', () => {
    const a = new BTAction('a');
    a.setExecute(() => 'running');
    expect(a.tick(new Blackboard())).toBe('running');
  });

  it('可读取 blackboard', () => {
    const bb = new Blackboard();
    bb.set('hp', 50);
    const a = new BTAction('check', (b) => b.getNumber('hp') > 40 ? 'success' : 'failure');
    expect(a.tick(bb)).toBe('success');
  });
});

// --- BTCondition ---------------------------------------------------------

describe('BTCondition', () => {
  it('true → success', () => {
    const c = new BTCondition('c', () => true);
    expect(c.tick(new Blackboard())).toBe('success');
  });

  it('false → failure', () => {
    const c = new BTCondition('c', () => false);
    expect(c.tick(new Blackboard())).toBe('failure');
  });

  it('未设置 checkFn 返回 failure', () => {
    const c = new BTCondition('c');
    expect(c.tick(new Blackboard())).toBe('failure');
  });

  it('永不返回 running', () => {
    const c = new BTCondition('c', () => true);
    const s = c.tick(new Blackboard());
    expect(s === 'success' || s === 'failure').toBe(true);
  });

  it('setCheck 替换函数', () => {
    const c = new BTCondition('c', () => false);
    c.setCheck(() => true);
    expect(c.tick(new Blackboard())).toBe('success');
  });
});

// --- Sequence ------------------------------------------------------------

describe('Sequence', () => {
  it('全部 success → success', () => {
    const seq = new Sequence('seq', [
      new CountAction('success'),
      new CountAction('success'),
      new CountAction('success'),
    ]);
    expect(seq.tick(new Blackboard())).toBe('success');
  });

  it('任一 failure → failure,后续不执行', () => {
    const a1 = new CountAction('success');
    const a2 = new CountAction('failure');
    const a3 = new CountAction('success');
    const seq = new Sequence('seq', [a1, a2, a3]);
    expect(seq.tick(new Blackboard())).toBe('failure');
    expect(a1.count).toBe(1);
    expect(a2.count).toBe(1);
    expect(a3.count).toBe(0); // 未执行
  });

  it('任一 running → running,后续不执行', () => {
    const a1 = new CountAction('success');
    const a2 = new CountAction('running');
    const a3 = new CountAction('success');
    const seq = new Sequence('seq', [a1, a2, a3]);
    expect(seq.tick(new Blackboard())).toBe('running');
    expect(a3.count).toBe(0);
  });

  it('running 续跑:下一帧从 running 子节点开始', () => {
    const a1 = new CountAction('success');
    const a2 = new MutableAction('mut', 'running');
    const seq = new Sequence('seq', [a1, a2]);
    seq.tick(new Blackboard());
    expect(a1.count).toBe(1);
    // 第二帧 a2 仍 running
    seq.tick(new Blackboard());
    expect(a1.count).toBe(1); // 不应重新执行 a1
    expect(a2.count).toBe(2); // 但 MutableAction 没计数,改用直接断言
  });

  it('running 完成后继续后续节点', () => {
    const a1 = new CountAction('success');
    const a2 = new MutableAction('mut');
    const a3 = new CountAction('success');
    const seq = new Sequence('seq', [a1, a2, a3]);
    a2.result = 'running';
    expect(seq.tick(new Blackboard())).toBe('running');
    expect(a3.count).toBe(0);
    a2.result = 'success';
    expect(seq.tick(new Blackboard())).toBe('success');
    expect(a3.count).toBe(1);
  });

  it('空 children 直接 success', () => {
    const seq = new Sequence('empty');
    expect(seq.tick(new Blackboard())).toBe('success');
  });

  it('reset 重置 runningIndex 与子节点', () => {
    const a1 = new CountAction('success');
    const a2 = new MutableAction('mut', 'running');
    const seq = new Sequence('seq', [a1, a2]);
    seq.tick(new Blackboard());
    seq.reset();
    // reset 后从头开始
    expect(a1.getStatus()).toBe('failure');
    expect(seq.tick(new Blackboard())).toBe('running');
    expect(a1.count).toBe(2); // 第二次 tick 又执行了 a1
  });

  it('addChild/removeChild 管理 children', () => {
    const seq = new Sequence('seq');
    const a = new CountAction();
    const b = new CountAction();
    seq.addChild(a).addChild(b);
    expect(seq.childCount).toBe(2);
    expect(a.parent).toBe(seq);
    seq.removeChild(a);
    expect(seq.childCount).toBe(1);
    expect(a.parent).toBeNull();
  });

  it('getChildren 返回快照(不可影响内部)', () => {
    const seq = new Sequence('seq', [new CountAction()]);
    const arr = seq.getChildren();
    expect(arr.length).toBe(1);
    arr.push(new CountAction());
    expect(seq.childCount).toBe(1); // 内部不变
  });

  it('abort 级联到子节点', () => {
    const a1 = new CountAction();
    const seq = new Sequence('seq', [a1]);
    seq.abort();
    expect(a1.isAborted()).toBe(true);
    expect(seq.tick(new Blackboard())).toBe('failure');
  });
});

// --- Selector ------------------------------------------------------------

describe('Selector', () => {
  it('任一 success → success,后续不执行', () => {
    const a1 = new CountAction('failure');
    const a2 = new CountAction('success');
    const a3 = new CountAction('success');
    const sel = new Selector('sel', [a1, a2, a3]);
    expect(sel.tick(new Blackboard())).toBe('success');
    expect(a1.count).toBe(1);
    expect(a2.count).toBe(1);
    expect(a3.count).toBe(0);
  });

  it('全部 failure → failure', () => {
    const sel = new Selector('sel', [
      new CountAction('failure'),
      new CountAction('failure'),
    ]);
    expect(sel.tick(new Blackboard())).toBe('failure');
  });

  it('任一 running → running', () => {
    const a1 = new CountAction('failure');
    const a2 = new MutableAction('mut', 'running');
    const sel = new Selector('sel', [a1, a2]);
    expect(sel.tick(new Blackboard())).toBe('running');
  });

  it('running 续跑:下一帧从 running 子节点开始', () => {
    const a1 = new CountAction('failure');
    const a2 = new MutableAction('mut', 'running');
    const sel = new Selector('sel', [a1, a2]);
    sel.tick(new Blackboard());
    sel.tick(new Blackboard());
    expect(a1.count).toBe(1); // 不应重新执行 a1
  });

  it('空 children 直接 failure', () => {
    const sel = new Selector('empty');
    expect(sel.tick(new Blackboard())).toBe('failure');
  });

  it('reset 重置', () => {
    const a1 = new CountAction('failure');
    const a2 = new MutableAction('mut', 'running');
    const sel = new Selector('sel', [a1, a2]);
    sel.tick(new Blackboard());
    sel.reset();
    expect(sel.tick(new Blackboard())).toBe('running');
    expect(a1.count).toBe(2);
  });
});

// --- Parallel ------------------------------------------------------------

describe('Parallel', () => {
  it('默认策略:全部 success 才 success', () => {
    const p = new Parallel('p', [
      new CountAction('success'),
      new CountAction('success'),
    ]);
    expect(p.tick(new Blackboard())).toBe('success');
  });

  it('默认策略:任一 failure 即 failure', () => {
    const p = new Parallel('p', [
      new CountAction('success'),
      new CountAction('failure'),
    ]);
    expect(p.tick(new Blackboard())).toBe('failure');
  });

  it('有 running 但未达 failure 阈值 → running', () => {
    const p = new Parallel('p', [
      new CountAction('success'),
      new MutableAction('mut', 'running'),
    ]);
    expect(p.tick(new Blackboard())).toBe('running');
  });

  it('自定义策略:successThreshold=1 任一成功即成功', () => {
    const p = new Parallel('p', [
      new CountAction('success'),
      new CountAction('failure'),
    ], { successThreshold: 1, failureThreshold: 2 });
    expect(p.tick(new Blackboard())).toBe('success');
  });

  it('自定义策略:failureThreshold=2 两失败才失败', () => {
    const p = new Parallel('p', [
      new CountAction('failure'),
      new CountAction('failure'),
    ], { successThreshold: 1, failureThreshold: 2 });
    expect(p.tick(new Blackboard())).toBe('failure');
  });

  it('每帧重 tick 所有子节点(包括 running)', () => {
    const a1 = new CountAction('success');
    const a2 = new MutableAction('mut', 'running');
    const p = new Parallel('p', [a1, a2]);
    p.tick(new Blackboard());
    p.tick(new Blackboard());
    expect(a1.count).toBe(2); // 每帧都 tick
  });

  it('reset 重置子节点', () => {
    const a1 = new CountAction('success');
    const p = new Parallel('p', [a1]);
    p.tick(new Blackboard());
    p.reset();
    expect(a1.getStatus()).toBe('failure');
  });
});

// --- 装饰器 --------------------------------------------------------------

describe('Inverter', () => {
  it('success → failure', () => {
    const inv = new Inverter('inv', new CountAction('success'));
    expect(inv.tick(new Blackboard())).toBe('failure');
  });

  it('failure → success', () => {
    const inv = new Inverter('inv', new CountAction('failure'));
    expect(inv.tick(new Blackboard())).toBe('success');
  });

  it('running → running', () => {
    const inv = new Inverter('inv', new MutableAction('mut', 'running'));
    expect(inv.tick(new Blackboard())).toBe('running');
  });

  it('无子节点 → failure', () => {
    const inv = new Inverter('inv');
    expect(inv.tick(new Blackboard())).toBe('failure');
  });

  it('setChild 设置子节点并回填 parent', () => {
    const inv = new Inverter('inv');
    const child = new CountAction('success');
    inv.setChild(child);
    expect(inv.getChild()).toBe(child);
    expect(child.parent).toBe(inv);
  });
});

describe('Repeater', () => {
  it('count=3 子节点 success 三次后整体 success', () => {
    const child = new CountAction('success');
    const rep = new Repeater('rep', child, 3);
    expect(rep.tick(new Blackboard())).toBe('success');
    expect(child.count).toBe(3);
  });

  it('count=1 单次', () => {
    const child = new CountAction('success');
    const rep = new Repeater('rep', child, 1);
    expect(rep.tick(new Blackboard())).toBe('success');
    expect(child.count).toBe(1);
  });

  it('子节点 failure 立即整体 failure', () => {
    const child = new CountAction('failure');
    const rep = new Repeater('rep', child, 5);
    expect(rep.tick(new Blackboard())).toBe('failure');
    expect(child.count).toBe(1);
  });

  it('子节点 running 透传(且不算入次数)', () => {
    const child = new MutableAction('mut', 'running');
    const rep = new Repeater('rep', child, 3);
    expect(rep.tick(new Blackboard())).toBe('running');
  });

  it('多次 tick 累计完成', () => {
    let calls = 0;
    const child = new BTAction('a', () => {
      calls++;
      return calls < 2 ? 'success' : 'running';
    });
    const rep = new Repeater('rep', child, 3);
    expect(rep.tick(new Blackboard())).toBe('running');
    // calls=1 success + calls=2 running
    expect(calls).toBe(2);
  });

  it('reset 清零已完成计数', () => {
    const child = new MutableAction('mut', 'running');
    const rep = new Repeater('rep', child, 3);
    rep.tick(new Blackboard());
    rep.reset();
    // reset 后重新计数(此处子节点仍 running,行为不变)
    expect(rep.tick(new Blackboard())).toBe('running');
  });
});

describe('Succeeder', () => {
  it('子节点 failure → success', () => {
    const s = new Succeeder('s', new CountAction('failure'));
    expect(s.tick(new Blackboard())).toBe('success');
  });

  it('子节点 success → success', () => {
    const s = new Succeeder('s', new CountAction('success'));
    expect(s.tick(new Blackboard())).toBe('success');
  });

  it('子节点 running → running(透传)', () => {
    const s = new Succeeder('s', new MutableAction('mut', 'running'));
    expect(s.tick(new Blackboard())).toBe('running');
  });

  it('无子节点 → failure', () => {
    const s = new Succeeder('s');
    expect(s.tick(new Blackboard())).toBe('failure');
  });
});

describe('Failer', () => {
  it('子节点 success → failure', () => {
    const f = new Failer('f', new CountAction('success'));
    expect(f.tick(new Blackboard())).toBe('failure');
  });

  it('子节点 failure → failure', () => {
    const f = new Failer('f', new CountAction('failure'));
    expect(f.tick(new Blackboard())).toBe('failure');
  });

  it('子节点 running → running(透传)', () => {
    const f = new Failer('f', new MutableAction('mut', 'running'));
    expect(f.tick(new Blackboard())).toBe('running');
  });
});

describe('UntilFail', () => {
  it('子节点立即 failure → 整体 success', () => {
    const uf = new UntilFail('uf', new CountAction('failure'));
    expect(uf.tick(new Blackboard())).toBe('success');
  });

  it('子节点一直 success → running(等下一帧)', () => {
    const uf = new UntilFail('uf', new CountAction('success'));
    expect(uf.tick(new Blackboard())).toBe('running');
    expect(uf.tick(new Blackboard())).toBe('running');
  });

  it('子节点 success 几次后 failure → success', () => {
    let calls = 0;
    const child = new BTAction('a', () => {
      calls++;
      return calls >= 3 ? 'failure' : 'success';
    });
    const uf = new UntilFail('uf', child);
    expect(uf.tick(new Blackboard())).toBe('running');
    expect(uf.tick(new Blackboard())).toBe('running');
    expect(uf.tick(new Blackboard())).toBe('success');
  });

  it('子节点 running 透传', () => {
    const uf = new UntilFail('uf', new MutableAction('mut', 'running'));
    expect(uf.tick(new Blackboard())).toBe('running');
  });

  it('maxIterations 限制最大迭代', () => {
    const child = new CountAction('success'); // 永不 failure
    const uf = new UntilFail('uf', child, 5);
    expect(uf.tick(new Blackboard())).toBe('running');
    expect(child.count).toBe(5);
  });
});

// --- BehaviorTree 主控 --------------------------------------------------

describe('BehaviorTree', () => {
  it('默认无 root tick 返回 failure', () => {
    const bt = new BehaviorTree();
    expect(bt.tick()).toBe('failure');
  });

  it('默认创建一个空 Blackboard', () => {
    const bt = new BehaviorTree();
    expect(bt.getBlackboard()).toBeInstanceOf(Blackboard);
    expect(bt.getBlackboard().size).toBe(0);
  });

  it('setRoot 设置根节点', () => {
    const bt = new BehaviorTree();
    const root = new CountAction('success');
    bt.setRoot(root);
    expect(bt.getRoot()).toBe(root);
    expect(root.parent).toBeNull(); // 根节点 parent 为 null
  });

  it('tick 执行 root 并返回状态', () => {
    const bt = new BehaviorTree();
    bt.setRoot(new CountAction('success'));
    expect(bt.tick()).toBe('success');
  });

  it('blackboard 传递到节点', () => {
    const bt = new BehaviorTree();
    bt.getBlackboard().set('flag', true);
    bt.setRoot(new BTCondition('c', (bb) => bb.getBool('flag')));
    expect(bt.tick()).toBe('success');
  });

  it('interrupt 中断后 tick 返回 failure', () => {
    const bt = new BehaviorTree();
    bt.setRoot(new CountAction('success'));
    bt.interrupt();
    expect(bt.isInterrupted()).toBe(true);
    expect(bt.tick()).toBe('failure');
  });

  it('interrupt 级联 abort root', () => {
    const bt = new BehaviorTree();
    const root = new CountAction('success');
    bt.setRoot(root);
    bt.interrupt();
    expect(root.isAborted()).toBe(true);
  });

  it('reset 后可恢复 tick', () => {
    const bt = new BehaviorTree();
    bt.setRoot(new CountAction('success'));
    bt.interrupt();
    bt.reset();
    expect(bt.isInterrupted()).toBe(false);
    expect(bt.tick()).toBe('success');
  });

  it('getLastStatus 返回最近 tick 状态', () => {
    const bt = new BehaviorTree();
    bt.setRoot(new CountAction('success'));
    bt.tick();
    expect(bt.getLastStatus()).toBe('success');
    bt.interrupt();
    bt.tick();
    expect(bt.getLastStatus()).toBe('failure');
  });

  it('setBlackboard 替换黑板', () => {
    const bt = new BehaviorTree();
    const bb = new Blackboard();
    bb.set('x', 42);
    bt.setBlackboard(bb);
    expect(bt.getBlackboard()).toBe(bb);
    expect(bt.getBlackboard().getNumber('x')).toBe(42);
  });

  it('构造时传入 root 与 blackboard', () => {
    const bb = new Blackboard();
    const root = new CountAction('success');
    const bt = new BehaviorTree(root, bb);
    expect(bt.getRoot()).toBe(root);
    expect(bt.getBlackboard()).toBe(bb);
  });

  it('复杂树:Selector + Sequence + Decorator 集成', () => {
    // 决策:有目标 → 追击;无目标 → 漫游
    const bb = new Blackboard();
    const bt = new BehaviorTree();
    bt.setBlackboard(bb);
    const checkHasTarget = new BTCondition('hasTarget', (b) => b.has('target'));
    const chase = new CountAction('success');
    const wander = new CountAction('success');
    bt.setRoot(new Selector('root', [
      new Sequence('ifHasTarget', [checkHasTarget, chase]),
      wander,
    ]));

    // 无目标 → 走 wander 分支
    expect(bt.tick()).toBe('success');
    expect(chase.count).toBe(0);
    expect(wander.count).toBe(1);

    // 设置目标 → 走 chase 分支
    bb.set('target', 'enemy');
    chase.count = 0;
    wander.count = 0;
    expect(bt.tick()).toBe('success');
    expect(chase.count).toBe(1);
    expect(wander.count).toBe(0);
  });

  it('Inverter + Condition 实现"非"条件', () => {
    const bb = new Blackboard();
    bb.set('alive', true);
    const bt = new BehaviorTree();
    bt.setBlackboard(bb);
    bt.setRoot(new Inverter('notAlive', new BTCondition('alive', (b) => b.getBool('alive'))));
    // alive=true → cond success → inverter failure
    expect(bt.tick()).toBe('failure');
    bb.set('alive', false);
    expect(bt.tick()).toBe('success');
  });
});

// --- 集成场景 -----------------------------------------------------------

describe('BehaviorTree 集成场景', () => {
  it('模拟"巡逻-遇敌-攻击"决策', () => {
    const bb = new Blackboard();
    bb.set('enemyInSight', false);
    bb.set('hp', 100);

    let attackCount = 0;
    let patrolCount = 0;

    const bt = new BehaviorTree();
    bt.setBlackboard(bb);
    bt.setRoot(new Selector('root', [
      // 敌人在视野 + HP 充足 → 攻击
      new Sequence('attack', [
        new BTCondition('seeEnemy', (b) => b.getBool('enemyInSight')),
        new BTCondition('hpOk', (b) => b.getNumber('hp') > 30),
        new BTAction('doAttack', () => { attackCount++; return 'success'; }),
      ]),
      // 否则巡逻
      new BTAction('patrol', () => { patrolCount++; return 'success'; }),
    ]));

    // 帧1:无敌 → 巡逻
    bt.tick();
    expect(attackCount).toBe(0);
    expect(patrolCount).toBe(1);

    // 帧2:发现敌人 → 攻击
    bb.set('enemyInSight', true);
    bt.tick();
    expect(attackCount).toBe(1);
    expect(patrolCount).toBe(1);

    // 帧3:HP 不足 → 回到巡逻
    bb.set('hp', 10);
    bt.tick();
    expect(attackCount).toBe(1);
    expect(patrolCount).toBe(2);
  });

  it('Running 跨帧续跑', () => {
    let progress = 0;
    const bt = new BehaviorTree();
    bt.setRoot(new Sequence('seq', [
      new BTAction('step1', () => 'success'),
      new BTAction('longTask', () => {
        progress++;
        return progress >= 3 ? 'success' : 'running';
      }),
      new BTAction('step3', () => 'success'),
    ]));

    expect(bt.tick()).toBe('running');
    expect(progress).toBe(1);
    expect(bt.tick()).toBe('running');
    expect(progress).toBe(2);
    expect(bt.tick()).toBe('success');
    expect(progress).toBe(3);
  });

  it('interrupt 中断正在 running 的子树', () => {
    let aborted = false;
    const longAction = new BTAction('long', () => 'running');
    const bt = new BehaviorTree();
    bt.setRoot(new Sequence('seq', [longAction]));
    bt.tick();
    expect(bt.getLastStatus()).toBe('running');
    bt.interrupt();
    expect(longAction.isAborted()).toBe(true);
    expect(bt.tick()).toBe('failure');
    aborted = true;
    expect(aborted).toBe(true);
  });
});
