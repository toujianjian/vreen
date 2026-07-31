// UtilityAI 测试 — 效用理论驱动决策。
//
// 验证:
//   • 响应曲线计算(linear/quadratic/cubic/sqrt/logistic/logit/threshold/bell/constant)
//   • 归一化输入
//   • 合成策略(weighted-average/min/max/product)
//   • 决策:选最高效用动作
//   • 冷却时间
//   • 惯性阈值
//   • 最低执行分数
//   • 优先级
//   • 历史记录
//   • Considerations 工厂

import { describe, it, expect } from 'vitest';
import {
  UtilityAI,
  Considerations,
  type UtilityAction,
} from './UtilityAI';

describe('UtilityAI — 响应曲线', () => {
  // 通过构建单考虑因素动作,间接测试曲线
  function curveAction(curve: UtilityAction['considerations'][0]['curve'], inputVal: number): number {
    const ai = new UtilityAI();
    ai.addAction({
      name: 'test',
      considerations: [{
        name: 'x',
        getInput: () => inputVal,
        inputRange: [0, 1],
        curve,
      }],
    });
    const d = ai.decide({});
    return d.score;
  }

  it('linear: y = x', () => {
    expect(curveAction({ type: 'linear' }, 0)).toBeCloseTo(0, 5);
    expect(curveAction({ type: 'linear' }, 0.5)).toBeCloseTo(0.5, 5);
    expect(curveAction({ type: 'linear' }, 1)).toBeCloseTo(1, 5);
  });

  it('quadratic: y = x²', () => {
    expect(curveAction({ type: 'quadratic' }, 0.5)).toBeCloseTo(0.25, 5);
    expect(curveAction({ type: 'quadratic' }, 1)).toBeCloseTo(1, 5);
  });

  it('cubic: y = x³', () => {
    expect(curveAction({ type: 'cubic' }, 0.5)).toBeCloseTo(0.125, 5);
    expect(curveAction({ type: 'cubic' }, 1)).toBeCloseTo(1, 5);
  });

  it('sqrt: y = √x', () => {
    expect(curveAction({ type: 'sqrt' }, 0.25)).toBeCloseTo(0.5, 5);
    expect(curveAction({ type: 'sqrt' }, 1)).toBeCloseTo(1, 5);
  });

  it('threshold: x >= t → 1, else 0', () => {
    expect(curveAction({ type: 'threshold', threshold: 0.5 }, 0.4)).toBe(0);
    expect(curveAction({ type: 'threshold', threshold: 0.5 }, 0.5)).toBe(1);
    expect(curveAction({ type: 'threshold', threshold: 0.5 }, 0.9)).toBe(1);
  });

  it('constant: y = c', () => {
    expect(curveAction({ type: 'constant', value: 0.7 }, 0.3)).toBeCloseTo(0.7, 5);
  });

  it('bell: 中心 0.5 最高', () => {
    const mid = curveAction({ type: 'bell' }, 0.5);
    const edge = curveAction({ type: 'bell' }, 0);
    expect(mid).toBeCloseTo(1, 5);
    expect(edge).toBeLessThan(0.1);
  });

  it('logistic: S 形,0.5 处约 0.5', () => {
    const v = curveAction({ type: 'logistic', slope: 5 }, 0.5);
    expect(v).toBeCloseTo(0.5, 1);
    expect(curveAction({ type: 'logistic', slope: 5 }, 1)).toBeGreaterThan(0.9);
    expect(curveAction({ type: 'logistic', slope: 5 }, 0)).toBeLessThan(0.1);
  });

  it('输入超出范围被钳制到 [0,1]', () => {
    expect(curveAction({ type: 'linear' }, -1)).toBe(0);
    expect(curveAction({ type: 'linear' }, 2)).toBe(1);
  });
});

describe('UtilityAI — 合成策略', () => {
  function buildAction(strategy: UtilityAction['strategy'], scores: number[]): UtilityAction {
    return {
      name: 'test',
      strategy,
      considerations: scores.map((s, i) => ({
        name: `c${i}`,
        getInput: () => s,
        inputRange: [0, 1],
        curve: { type: 'linear' },
        weight: 1,
      })),
    };
  }

  it('weighted-average: 平均值', () => {
    const ai = new UtilityAI();
    ai.addAction(buildAction('weighted-average', [0.4, 0.8]));
    const d = ai.decide({});
    expect(d.score).toBeCloseTo(0.6, 5);
  });

  it('weighted-average: 带权重', () => {
    const ai = new UtilityAI();
    ai.addAction({
      name: 'test',
      strategy: 'weighted-average',
      considerations: [
        { name: 'a', getInput: () => 0.4, inputRange: [0, 1], curve: { type: 'linear' }, weight: 3 },
        { name: 'b', getInput: () => 0.8, inputRange: [0, 1], curve: { type: 'linear' }, weight: 1 },
      ],
    });
    const d = ai.decide({});
    // (0.4*3 + 0.8*1) / 4 = 2.0/4 = 0.5
    expect(d.score).toBeCloseTo(0.5, 5);
  });

  it('min: 取最小', () => {
    const ai = new UtilityAI();
    ai.addAction(buildAction('min', [0.4, 0.8]));
    const d = ai.decide({});
    expect(d.score).toBeCloseTo(0.4, 5);
  });

  it('max: 取最大', () => {
    const ai = new UtilityAI();
    ai.addAction(buildAction('max', [0.4, 0.8]));
    const d = ai.decide({});
    expect(d.score).toBeCloseTo(0.8, 5);
  });

  it('product: 乘积', () => {
    const ai = new UtilityAI();
    ai.addAction(buildAction('product', [0.4, 0.8]));
    const d = ai.decide({});
    expect(d.score).toBeCloseTo(0.32, 5);
  });
});

describe('UtilityAI — 决策', () => {
  it('选最高效用动作', () => {
    const ai = new UtilityAI();
    ai.addAction({
      name: 'attack',
      considerations: [{ name: 'x', getInput: () => 0.8, inputRange: [0, 1], curve: { type: 'linear' } }],
    });
    ai.addAction({
      name: 'flee',
      considerations: [{ name: 'x', getInput: () => 0.3, inputRange: [0, 1], curve: { type: 'linear' } }],
    });
    const d = ai.decide({});
    expect(d.action!.name).toBe('attack');
    expect(d.score).toBeCloseTo(0.8, 5);
  });

  it('allScores 按分数降序', () => {
    const ai = new UtilityAI();
    ai.addAction({ name: 'low', considerations: [{ name: 'x', getInput: () => 0.2, inputRange: [0, 1], curve: { type: 'linear' } }] });
    ai.addAction({ name: 'high', considerations: [{ name: 'x', getInput: () => 0.9, inputRange: [0, 1], curve: { type: 'linear' } }] });
    ai.addAction({ name: 'mid', considerations: [{ name: 'x', getInput: () => 0.5, inputRange: [0, 1], curve: { type: 'linear' } }] });
    const d = ai.decide({});
    expect(d.allScores[0].action.name).toBe('high');
    expect(d.allScores[1].action.name).toBe('mid');
    expect(d.allScores[2].action.name).toBe('low');
  });

  it('minScoreThreshold 过滤低分动作', () => {
    const ai = new UtilityAI({ minScoreThreshold: 0.5 });
    ai.addAction({ name: 'a', considerations: [{ name: 'x', getInput: () => 0.3, inputRange: [0, 1], curve: { type: 'linear' } }] });
    const d = ai.decide({});
    expect(d.action).toBeNull();
  });

  it('优先级:同分数时高优先级胜出', () => {
    const ai = new UtilityAI();
    ai.addAction({ name: 'low', priority: 1, considerations: [{ name: 'x', getInput: () => 0.5, inputRange: [0, 1], curve: { type: 'linear' } }] });
    ai.addAction({ name: 'high', priority: 10, considerations: [{ name: 'x', getInput: () => 0.5, inputRange: [0, 1], curve: { type: 'linear' } }] });
    const d = ai.decide({});
    expect(d.action!.name).toBe('high');
  });

  it('baseWeight 缩放最终分数', () => {
    const ai = new UtilityAI();
    ai.addAction({ name: 'a', baseWeight: 0.5, considerations: [{ name: 'x', getInput: () => 0.8, inputRange: [0, 1], curve: { type: 'linear' } }] });
    const d = ai.decide({});
    expect(d.score).toBeCloseTo(0.4, 5);
  });
});

describe('UtilityAI — 冷却与惯性', () => {
  it('冷却时间内分数为 0', () => {
    const ai = new UtilityAI();
    ai.addAction({
      name: 'a',
      cooldown: 1000,
      considerations: [{ name: 'x', getInput: () => 0.9, inputRange: [0, 1], curve: { type: 'linear' } }],
    });
    // 第一次决策 + 执行(t=0)
    ai.decideAndExecute({}, 0);
    // t=500(冷却中):分数为 0
    const d2 = ai.decide({}, 500);
    expect(d2.score).toBe(0);
    // t=1001(冷却结束):分数恢复
    const d3 = ai.decide({}, 1001);
    expect(d3.score).toBeCloseTo(0.9, 5);
  });

  it('惯性阈值:当前动作加成', () => {
    const ai = new UtilityAI({ inertiaThreshold: 0.2 });
    ai.addAction({ name: 'attack', considerations: [{ name: 'x', getInput: () => 0.5, inputRange: [0, 1], curve: { type: 'linear' } }] });
    ai.addAction({ name: 'flee', considerations: [{ name: 'x', getInput: () => 0.6, inputRange: [0, 1], curve: { type: 'linear' } }] });
    // 第一次:flee 分数更高
    const d1 = ai.decide({});
    expect(d1.action!.name).toBe('flee');
    ai.execute(d1.action!);
    // 第二次:flee 0.6 + 惯性 0.2 = 0.8 vs attack 0.5 → flee 仍胜出
    const d2 = ai.decide({});
    expect(d2.action!.name).toBe('flee');
    // 第三次:flee 0.4 + 惯性 0.2 = 0.6 vs attack 0.7 → attack 胜出
    ai.actions[0].considerations[0].getInput = () => 0.7; // attack
    ai.actions[1].considerations[0].getInput = () => 0.4; // flee
    const d3 = ai.decide({});
    expect(d3.action!.name).toBe('attack');
  });
});

describe('UtilityAI — 历史与重置', () => {
  it('history 记录执行过的动作', () => {
    const ai = new UtilityAI();
    ai.addAction({ name: 'a', considerations: [{ name: 'x', getInput: () => 0.9, inputRange: [0, 1], curve: { type: 'linear' } }] });
    ai.decideAndExecute({}, 0);
    ai.decideAndExecute({}, 100);
    expect(ai.history.length).toBe(2);
    expect(ai.history[0].action).toBe('a');
    expect(ai.history[1].action).toBe('a');
  });

  it('history 超过最大长度时丢弃最旧', () => {
    const ai = new UtilityAI({ historyMaxLen: 3 });
    ai.addAction({ name: 'a', considerations: [{ name: 'x', getInput: () => 0.9, inputRange: [0, 1], curve: { type: 'linear' } }] });
    for (let i = 0; i < 5; i++) ai.decideAndExecute({}, i * 100);
    expect(ai.history.length).toBe(3);
  });

  it('reset 清空状态', () => {
    const ai = new UtilityAI();
    ai.addAction({ name: 'a', considerations: [{ name: 'x', getInput: () => 0.9, inputRange: [0, 1], curve: { type: 'linear' } }] });
    ai.decideAndExecute({});
    expect(ai.currentAction).not.toBeNull();
    expect(ai.history.length).toBe(1);
    ai.reset();
    expect(ai.currentAction).toBeNull();
    expect(ai.history.length).toBe(0);
    expect(ai.actions[0].lastExecuted).toBeUndefined();
  });

  it('removeAction 移除动作', () => {
    const ai = new UtilityAI();
    ai.addAction({ name: 'a', considerations: [{ name: 'x', getInput: () => 1, inputRange: [0, 1], curve: { type: 'linear' } }] });
    expect(ai.removeAction('a')).toBe(true);
    expect(ai.actions.length).toBe(0);
    expect(ai.removeAction('nonexistent')).toBe(false);
  });

  it('clear 清空所有', () => {
    const ai = new UtilityAI();
    ai
      .addAction({ name: 'a', considerations: [{ name: 'x', getInput: () => 1, inputRange: [0, 1], curve: { type: 'linear' } }] })
      .addAction({ name: 'b', considerations: [{ name: 'x', getInput: () => 1, inputRange: [0, 1], curve: { type: 'linear' } }] });
    ai.clear();
    expect(ai.actions.length).toBe(0);
    expect(ai.currentAction).toBeNull();
  });
});

describe('Considerations 工厂', () => {
  it('health: HP 低 → 高分', () => {
    const c = Considerations.health((ctx) => ctx.hp, 100);
    // HP=10:归一化 0.1,logistic slope=-8 → 高分
    const lowHpScore = c.getInput({ hp: 10 });
    expect(lowHpScore).toBe(10);
    // 验证曲线方向:低 HP → 高分
    const ai = new UtilityAI();
    ai.addAction({ name: 'flee', considerations: [c] });
    const lowScore = ai.decide({ hp: 10 }).score;
    const highScore = ai.decide({ hp: 90 }).score;
    expect(lowScore).toBeGreaterThan(highScore);
  });

  it('distance: 近 → 高分', () => {
    const c = Considerations.distance((ctx) => ctx.dist, 100);
    const ai = new UtilityAI();
    ai.addAction({ name: 'attack', considerations: [c] });
    const near = ai.decide({ dist: 10 }).score;
    const far = ai.decide({ dist: 90 }).score;
    expect(near).toBeGreaterThan(far);
  });

  it('ammo: 少 → 高分', () => {
    const c = Considerations.ammo((ctx) => ctx.ammo, 30);
    const ai = new UtilityAI();
    ai.addAction({ name: 'reload', considerations: [c] });
    const low = ai.decide({ ammo: 2 }).score;
    const high = ai.decide({ ammo: 28 }).score;
    expect(low).toBeGreaterThan(high);
  });

  it('constant: 固定值', () => {
    const c = Considerations.constant(0.5);
    const ai = new UtilityAI();
    ai.addAction({ name: 'idle', considerations: [c] });
    expect(ai.decide({}).score).toBeCloseTo(0.5, 5);
  });
});

describe('UtilityAI — 综合场景', () => {
  it('战斗 AI:HP 低 + 敌人远 → 逃跑;HP 高 + 敌人近 → 攻击', () => {
    const ai = new UtilityAI();
    ai.addAction({
      name: 'attack',
      strategy: 'weighted-average',
      considerations: [
        // HP 高 → 攻击倾向高
        { name: 'hp', getInput: (ctx) => ctx.hp, inputRange: [0, 100], curve: { type: 'linear' }, weight: 1 },
        // 距离近 → 攻击倾向高
        { name: 'dist', getInput: (ctx) => ctx.dist, inputRange: [0, 50], curve: { type: 'sqrt' }, weight: 1 },
      ],
    });
    ai.addAction({
      name: 'flee',
      strategy: 'weighted-average',
      considerations: [
        // HP 低 → 逃跑倾向高
        { name: 'hp', getInput: (ctx) => ctx.hp, inputRange: [0, 100], curve: { type: 'logistic', slope: -8 }, weight: 1 },
        // 距离远 → 逃跑倾向高
        { name: 'dist', getInput: (ctx) => ctx.dist, inputRange: [0, 50], curve: { type: 'logistic', slope: 8 }, weight: 1 },
      ],
    });

    // 场景 1:HP=90, dist=5(近)→ 攻击
    let d = ai.decide({ hp: 90, dist: 5 });
    expect(d.action!.name).toBe('attack');

    // 场景 2:HP=10, dist=45(远)→ 逃跑
    d = ai.decide({ hp: 10, dist: 45 });
    expect(d.action!.name).toBe('flee');
  });
});
