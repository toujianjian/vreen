// UtilityAI — 效用理论驱动的 AI 决策系统。
//
// 设计:
//   * UtilityAction:带 consider 集合(评分函数)+ 权重的动作
//   * Consideration:输入上下文 → 输出 [0,1] 评分的曲线函数(Response Curve)
//   * 决策器:对每个动作计算所有考虑因素的加权合成效用值,选最高者执行
//   * 支持:加权平均 / 取最小 / 取最大 / 乘积 合成策略
//   * 支持:惯性阈值(当前动作需被超过一定分数才切换)、冷却时间、动作优先级
//
// 与 BehaviorTree / GOAP 的区别:
//   * BT 是硬编码决策树(条件 → 动作),可预测但不灵活
//   * GOAP 是规划式(一次性生成动作序列),适合多步骤目标
//   * UtilityAI 是连续评分式(每个动作算一个 0-1 分数,选最高),
//     适合模糊决策(逃跑 vs 攻击 vs 救援),无明确目标序列
//   * 三者互补,可组合:UtilityAI 选目标,GOAP 规划路径,BT 执行细节
//
// 参考:
//   - Dave Mark, "Behavioral Mathematics for Game AI", 2009
//   - o3de ScriptCanvas Utility AI / Inflexion Black & White

/** 上下文:AI 对自身和世界的认知(任意键值对)。 */
export type UtilityContext = Record<string, number>;

/** 响应曲线:输入 [0,1] → 输出 [0,1]。常见曲线类型。 */
export type ResponseCurveType =
  | 'linear'      // 线性:y = x
  | 'quadratic'   // 二次:y = x²
  | 'cubic'       // 三次:y = x³
  | 'sqrt'        // 平方根:y = √x
  | 'logistic'    // 逻辑斯蒂:y = 1 / (1 + e^(-k*(x-0.5)))
  | 'logit'       // 对数几率:y = log(x/(1-x)) 归一化
  | 'threshold'   // 阈值:x < t → 0, x >= t → 1
  | 'bell'        // 钟形(高斯):y = e^(-((x-0.5)*2)²)
  | 'constant';   // 常数:y = c

/** 响应曲线参数。 */
export interface ResponseCurveParams {
  type: ResponseCurveType;
  /** 阈值(threshold 类型用,默认 0.5)。 */
  threshold?: number;
  /** 斜率(logistic 类型用,默认 5)。 */
  slope?: number;
  /** 常数值(constant 类型用,默认 0)。 */
  value?: number;
}

/** 考虑因素:从上下文取一个值,归一化到 [0,1],应用响应曲线。 */
export interface Consideration {
  /** 名称。 */
  name: string;
  /** 从上下文取值。 */
  getInput: (ctx: UtilityContext) => number;
  /** 输入归一化范围 [min, max](getInput 的输出会被映射到 [0,1])。 */
  inputRange: [number, number];
  /** 响应曲线。 */
  curve: ResponseCurveParams;
  /** 权重(加权合成时用,默认 1)。 */
  weight?: number;
}

/** 效用动作合成策略。 */
export type CompositeStrategy =
  | 'weighted-average'  // Σ(w_i * score_i) / Σw_i
  | 'min'               // min(score_i)
  | 'max'               // max(score_i)
  | 'product';          // Π score_i

/** 效用动作。 */
export interface UtilityAction {
  /** 动作名(唯一)。 */
  name: string;
  /** 考虑因素列表。 */
  considerations: Consideration[];
  /** 合成策略(默认 weighted-average)。 */
  strategy?: CompositeStrategy;
  /** 基础权重(与最终分数相乘,默认 1)。 */
  baseWeight?: number;
  /** 冷却时间(ms,执行后多长时间内不能再被选中,默认 0)。 */
  cooldown?: number;
  /** 优先级(同等分数下,优先级高的胜出,默认 0)。 */
  priority?: number;
  /** 上次执行时间戳(ms,内部维护)。 */
  lastExecuted?: number;
}

/** 决策结果。 */
export interface UtilityDecision {
  /** 选中的动作(null 表示无动作可选)。 */
  action: UtilityAction | null;
  /** 该动作的效用分数 [0,1]。 */
  score: number;
  /** 所有候选动作的分数(按分数降序)。 */
  allScores: Array<{ action: UtilityAction; score: number }>;
}

/** 应用响应曲线到归一化输入。 */
function applyCurve(x: number, params: ResponseCurveParams): number {
  // 钳制到 [0,1]
  const t = Math.max(0, Math.min(1, x));
  switch (params.type) {
    case 'linear':
      return t;
    case 'quadratic':
      return t * t;
    case 'cubic':
      return t * t * t;
    case 'sqrt':
      return Math.sqrt(t);
    case 'logistic': {
      const k = params.slope ?? 5;
      return 1 / (1 + Math.exp(-k * (t - 0.5)));
    }
    case 'logit': {
      // y = logit(x) 归一化到 [0,1]
      const eps = 1e-6;
      const xc = Math.max(eps, Math.min(1 - eps, t));
      const logit = Math.log(xc / (1 - xc));
      // logit 范围约 [-∞, +∞],映射 [-5, 5] → [0, 1]
      return Math.max(0, Math.min(1, (logit + 5) / 10));
    }
    case 'threshold': {
      const th = params.threshold ?? 0.5;
      return t >= th ? 1 : 0;
    }
    case 'bell': {
      // y = exp(-((x-0.5)*4)^2),中心 0.5 最高,边缘快速衰减
      const d = (t - 0.5) * 4;
      return Math.exp(-d * d);
    }
    case 'constant':
      return params.value ?? 0;
    default:
      return t;
  }
}

/** 归一化输入到 [0,1]。 */
function normalizeInput(value: number, range: [number, number]): number {
  const [min, max] = range;
  if (max === min) return 0;
  return (value - min) / (max - min);
}

/** 计算单个考虑因素的分数(归一化 + 曲线 + 钳制)。 */
function scoreConsideration(c: Consideration, ctx: UtilityContext): number {
  const raw = c.getInput(ctx);
  const norm = normalizeInput(raw, c.inputRange);
  const curved = applyCurve(norm, c.curve);
  return Math.max(0, Math.min(1, curved));
}

/** 合成所有考虑因素的分数。 */
function compositeScore(action: UtilityAction, ctx: UtilityContext): number {
  const cs = action.considerations;
  if (cs.length === 0) return 0;
  const strategy = action.strategy ?? 'weighted-average';
  if (strategy === 'weighted-average') {
    let sum = 0, wSum = 0;
    for (const c of cs) {
      const w = c.weight ?? 1;
      sum += scoreConsideration(c, ctx) * w;
      wSum += w;
    }
    return wSum > 0 ? sum / wSum : 0;
  }
  if (strategy === 'min') {
    let m = Infinity;
    for (const c of cs) m = Math.min(m, scoreConsideration(c, ctx));
    return m === Infinity ? 0 : m;
  }
  if (strategy === 'max') {
    let m = -Infinity;
    for (const c of cs) m = Math.max(m, scoreConsideration(c, ctx));
    return m === -Infinity ? 0 : m;
  }
  if (strategy === 'product') {
    let p = 1;
    for (const c of cs) p *= scoreConsideration(c, ctx);
    return p;
  }
  return 0;
}

export class UtilityAI {
  /** 候选动作集。 */
  actions: UtilityAction[] = [];
  /** 惯性阈值:当前动作的分数需被其他动作超过此值才切换(默认 0)。 */
  inertiaThreshold: number = 0;
  /** 当前正在执行的动作(用于惯性计算)。 */
  currentAction: UtilityAction | null = null;
  /** 最低执行分数:低于此分数的动作不被选中(默认 0)。 */
  minScoreThreshold: number = 0;
  /** 决策历史(最近 N 次)。 */
  history: Array<{ time: number; action: string; score: number }> = [];
  /** 历史最大长度(默认 20)。 */
  historyMaxLen: number = 20;

  constructor(opts: { inertiaThreshold?: number; minScoreThreshold?: number; historyMaxLen?: number } = {}) {
    this.inertiaThreshold = opts.inertiaThreshold ?? 0;
    this.minScoreThreshold = opts.minScoreThreshold ?? 0;
    this.historyMaxLen = opts.historyMaxLen ?? 20;
  }

  /** 添加动作。 */
  addAction(action: UtilityAction): this {
    this.actions.push(action);
    return this;
  }

  /** 移除动作(按名)。 */
  removeAction(name: string): boolean {
    const i = this.actions.findIndex((a) => a.name === name);
    if (i < 0) return false;
    this.actions.splice(i, 1);
    if (this.currentAction?.name === name) this.currentAction = null;
    return true;
  }

  /** 清空所有动作。 */
  clear(): this {
    this.actions = [];
    this.currentAction = null;
    this.history = [];
    return this;
  }

  /** 决策:选最高效用的动作。 */
  decide(ctx: UtilityContext, now?: number): UtilityDecision {
    const t = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const allScores: Array<{ action: UtilityAction; score: number }> = [];

    for (const action of this.actions) {
      // 冷却检查
      const cd = action.cooldown ?? 0;
      if (cd > 0 && action.lastExecuted !== undefined) {
        if (t - action.lastExecuted < cd) {
          allScores.push({ action, score: 0 });
          continue;
        }
      }
      let score = compositeScore(action, ctx);
      score *= (action.baseWeight ?? 1);
      // 惯性:当前动作加成
      if (this.currentAction === action && this.inertiaThreshold > 0) {
        score += this.inertiaThreshold;
      }
      // 钳制到 [0,1]
      score = Math.max(0, Math.min(1, score));
      allScores.push({ action, score });
    }

    // 按分数降序,分数相同时按优先级降序
    allScores.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.action.priority ?? 0) - (a.action.priority ?? 0);
    });

    // 低于阈值 → 不执行
    const top = allScores[0];
    if (!top || top.score < this.minScoreThreshold) {
      return { action: null, score: 0, allScores };
    }

    return { action: top.action, score: top.score, allScores };
  }

  /** 执行选中的动作(标记 lastExecuted + 写入历史 + 更新 currentAction)。 */
  execute(action: UtilityAction, now?: number): void {
    const t = now ?? (typeof performance !== 'undefined' ? performance.now() : Date.now());
    action.lastExecuted = t;
    this.currentAction = action;
    this.history.push({ time: t, action: action.name, score: 0 });
    if (this.history.length > this.historyMaxLen) this.history.shift();
  }

  /** 决策 + 执行(便捷方法)。 */
  decideAndExecute(ctx: UtilityContext, now?: number): UtilityDecision {
    const decision = this.decide(ctx, now);
    if (decision.action) this.execute(decision.action, now);
    return decision;
  }

  /** 重置(清空当前动作 + 历史 + 冷却)。 */
  reset(): this {
    this.currentAction = null;
    this.history = [];
    for (const a of this.actions) a.lastExecuted = undefined;
    return this;
  }
}

/** 工厂:创建常用 Consideration。 */
export const Considerations = {
  /** 健康分数:HP 低 → 高分(逃跑倾向)。 */
  health: (getHp: (ctx: UtilityContext) => number, maxHp: number): Consideration => ({
    name: 'health',
    getInput: getHp,
    inputRange: [0, maxHp],
    // HP 低 → 1(需要逃跑),HP 高 → 0
    curve: { type: 'logistic', slope: -8 },
  }),

  /** 距离分数:近 → 高分(攻击倾向)。 */
  distance: (getDist: (ctx: UtilityContext) => number, maxDist: number): Consideration => ({
    name: 'distance',
    getInput: getDist,
    inputRange: [0, maxDist],
    // 近 → 1,远 → 0(logistic 负斜率,近=0→高分,远=1→低分)
    curve: { type: 'logistic', slope: -8 },
  }),

  /** 弹药分数:少 → 高分(换弹倾向)。 */
  ammo: (getAmmo: (ctx: UtilityContext) => number, maxAmmo: number): Consideration => ({
    name: 'ammo',
    getInput: getAmmo,
    inputRange: [0, maxAmmo],
    // 少 → 1(需要换弹),多 → 0
    curve: { type: 'logistic', slope: -10 },
  }),

  /** 敌人威胁分数:敌人多 → 高分(防御倾向)。 */
  threat: (getThreat: (ctx: UtilityContext) => number, maxThreat: number): Consideration => ({
    name: 'threat',
    getInput: getThreat,
    inputRange: [0, maxThreat],
    curve: { type: 'quadratic' },
  }),

  /** 常数分数。 */
  constant: (value: number): Consideration => ({
    name: 'constant',
    getInput: () => value,
    inputRange: [0, 1],
    curve: { type: 'constant', value },
  }),
};
