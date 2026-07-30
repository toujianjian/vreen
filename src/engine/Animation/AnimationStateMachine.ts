// AnimationStateMachine — parameter-driven finite-state machine for animation
// control, with blend trees, conditions, triggers and timed transitions.
//
// 设计要点:
//   • 纯状态机:不持有 AnimationMixer / AnimationClip,只通过 clipName 字符串
//     引用动画。消费者(ECS 系统 / 脚本)读取 currentState.clipName 并在外部
//     驱动 mixer 播放。这使状态机与渲染层完全解耦。
//   • 参数驱动:外部通过 setParameter(name, value) 写入参数,转换条件
//     TransitionCondition 基于参数值判定,不再依赖 guard 回调读 ECS world。
//   • 触发器(Trigger):trigger(name) 设置布尔参数为 true,update() 结束后
//     自动重置为 false(一次性信号)。
//   • 过渡混合:transition.duration > 0 时启动倒计时过渡,isTransitioning=true,
//     过渡结束后切换 currentState。消费者可据 isTransitioning / transitionTime
//     计算交叉淡入淡出权重。
//   • exitTime:归一化 [0,1] 的退出时间,表示当前 clip 播放到该比例才允许
//     转换。需 AnimState.clipDuration > 0 才生效。
//   • exportGraph / importGraph:JSON 序列化整个状态图,便于存档与编辑器往返。
//
// 与 ECS AnimState 组件关系:
//   • AnimState (ECS 组件) 持 stateMachine: AnimationStateMachine | null
//   • AnimStateSystem 每帧:setParameter('speed', velocity) → update(dt)
//   • 读 getCurrentState()?.clipName 同步回 AnimState.clip + 驱动 mixer

import { Vector2 } from '../Math/Vector2';

// ── 类型定义 ────────────────────────────────────────────────────────

/** 混合树节点:一个 clip 在混合空间中的位置与权重。 */
export interface BlendNode {
  /** 此节点对应的 clip 名。 */
  clipName: string;
  /** 在混合空间中的阈值坐标(1D 用 x,2D 用 x/y)。 */
  threshold: Vector2;
  /** 当前权重(由混合树求值写入,消费者读取)。 */
  weight: number;
}

/** 混合树:在单个状态内根据参数在多个 clip 间平滑混合。 */
export interface BlendTree {
  /** 混合类型:'1d' 沿 x 轴线性插值;'2d' 在 x/y 平面双线性插值。 */
  type: '1d' | '2d';
  /** 子节点列表。 */
  children: BlendNode[];
  /** 驱动此混合树的参数名。 */
  parameter: string;
  /** 混合空间原点偏移(从参数值减去后再匹配阈值)。 */
  threshold: Vector2;
}

/** 状态机中的一个状态节点。 */
export interface AnimState {
  /** 状态名(唯一标识)。 */
  name: string;
  /** 此状态播放的 clip 名(引用外部 AnimationClip.name)。 */
  clipName: string;
  /** 播放速率(1 = 原速)。 */
  speed: number;
  /** 是否循环播放。 */
  loop: boolean;
  /** 可选混合树(替代单一 clipName,在多个 clip 间混合)。 */
  blendTree?: BlendTree;
  /** 可选 clip 时长(秒),用于 exitTime 归一化。0/undefined = 未知。 */
  clipDuration?: number;
}

/** 转换条件:基于参数值的判定。 */
export interface TransitionCondition {
  /** 参数名。 */
  parameter: string;
  /** 比较运算符。布尔参数用 '==' / '!=',数值参数支持全部六种。 */
  operator: '==' | '!=' | '>' | '<' | '>=' | '<=';
  /** 比较值。 */
  value: number | boolean;
}

/** 状态转换:从 from 到 to,满足全部 conditions 时触发。 */
export interface AnimTransition {
  /** 起始状态名。 */
  from: string;
  /** 目标状态名。 */
  to: string;
  /** 触发条件列表(全部满足才触发;空列表 = 无条件触发)。 */
  conditions: TransitionCondition[];
  /** 过渡时长(秒)。>0 时启动倒计时过渡;<=0 立即切换。 */
  duration: number;
  /** 归一化退出时间 [0,1]。>0 时需 clip 播放到此比例才允许转换。 */
  exitTime: number;
}

// ── 状态图 JSON 格式 ────────────────────────────────────────────────

/** exportGraph / importGraph 使用的 JSON 格式。 */
export interface AnimStateMachineGraph {
  states: AnimState[];
  transitions: AnimTransition[];
  parameters: Record<string, number | boolean>;
  currentState: string | null;
}

// ── 状态机 ──────────────────────────────────────────────────────────

/**
 * 动画状态机(ASM)。
 *
 * 参数驱动的有限状态机,支持条件转换、触发器、混合树和定时过渡。
 * 不持有 AnimationMixer;消费者读取 currentState 在外部驱动播放。
 */
export class AnimationStateMachine {
  /** 全部状态(按 name 索引)。 */
  states: Map<string, AnimState> = new Map();
  /** 全部转换。 */
  transitions: AnimTransition[] = [];
  /** 当前状态(null = 尚未进入任何状态)。 */
  currentState: AnimState | null = null;
  /** 前一个状态(过渡完成后保留,供消费者做交叉淡出)。 */
  previousState: AnimState | null = null;
  /** 参数表(名 → 数值或布尔)。 */
  parameters: Map<string, number | boolean> = new Map();
  /** 当前过渡剩余时间(秒)。>0 表示正在过渡。 */
  transitionTime: number = 0;
  /** 是否正在过渡。 */
  isTransitioning: boolean = false;

  /** 过渡目标(过渡进行中暂存,倒计时归零后成为 currentState)。 */
  private _pendingState: AnimState | null = null;
  /** 当前过渡总时长(用于计算权重)。 */
  private _transitionDuration: number = 0;
  /** 已注册的触发器名集合(update 结束后自动重置)。 */
  private _triggers: Set<string> = new Set();
  /** 当前状态累计时间(秒)。 */
  private _stateTime: number = 0;

  // ── 状态管理 ──────────────────────────────────────────────────────

  /** 添加一个状态。同名状态会被覆盖。 */
  addState(state: AnimState): this {
    this.states.set(state.name, state);
    return this;
  }

  /** 移除状态。同时移除所有引用它的转换。返回是否找到并移除。 */
  removeState(name: string): boolean {
    const existed = this.states.delete(name);
    if (existed) {
      // 移除所有引用此状态的转换
      this.transitions = this.transitions.filter(
        (t) => t.from !== name && t.to !== name,
      );
      // 如果当前状态被移除,清空
      if (this.currentState?.name === name) {
        this.currentState = null;
        this._stateTime = 0;
      }
      if (this._pendingState?.name === name) {
        this._pendingState = null;
        this.isTransitioning = false;
        this.transitionTime = 0;
      }
    }
    return existed;
  }

  // ── 转换管理 ──────────────────────────────────────────────────────

  /** 添加一条转换。 */
  addTransition(transition: AnimTransition): this {
    this.transitions.push(transition);
    return this;
  }

  // ── 参数管理 ──────────────────────────────────────────────────────

  /** 设置参数值。 */
  setParameter(name: string, value: number | boolean): void {
    this.parameters.set(name, value);
  }

  /** 获取参数值。不存在返回 undefined。 */
  getParameter(name: string): number | boolean | undefined {
    return this.parameters.get(name);
  }

  /** 触发一个触发器(布尔参数设为 true,本帧 update 结束后自动重置为 false)。 */
  trigger(name: string): void {
    this.parameters.set(name, true);
    this._triggers.add(name);
  }

  // ── 状态切换 ──────────────────────────────────────────────────────

  /** 强制切换状态。duration > 0 启动过渡;<=0 立即切换。返回是否成功。 */
  changeState(name: string, duration: number): boolean {
    const target = this.states.get(name);
    if (!target) return false;
    if (this.currentState?.name === name && !this.isTransitioning) return false;

    if (duration > 0) {
      // 启动过渡
      this._pendingState = target;
      this._transitionDuration = duration;
      this.transitionTime = duration;
      this.isTransitioning = true;
    } else {
      // 立即切换
      this.previousState = this.currentState;
      this.currentState = target;
      this._stateTime = 0;
      this.isTransitioning = false;
      this.transitionTime = 0;
      this._pendingState = null;
    }
    return true;
  }

  // ── 查询 ──────────────────────────────────────────────────────────

  /** 获取当前状态。 */
  getCurrentState(): AnimState | null {
    return this.currentState;
  }

  /** 获取过渡目标状态(过渡进行中有效;稳定态返回 null)。 */
  getPendingState(): AnimState | null {
    return this._pendingState;
  }

  /** 获取所有状态(数组形式)。 */
  getStates(): AnimState[] {
    return Array.from(this.states.values());
  }

  /** 获取所有转换。 */
  getTransitions(): AnimTransition[] {
    return this.transitions;
  }

  /** 获取当前状态累计时间(秒)。 */
  getStateTime(): number {
    return this._stateTime;
  }

  /** 获取过渡进度 [0,1](0 = 刚开始,1 = 完成)。非过渡态返回 1。 */
  getTransitionProgress(): number {
    if (!this.isTransitioning || this._transitionDuration <= 0) return 1;
    return 1 - this.transitionTime / this._transitionDuration;
  }

  // ── 主循环 ────────────────────────────────────────────────────────

  /** 每帧更新:推进过渡计时、评估转换条件、切换状态。 */
  update(dt: number): void {
    // 1) 推进过渡倒计时
    if (this.isTransitioning && this._pendingState) {
      this.transitionTime -= dt;
      if (this.transitionTime <= 0) {
        // 过渡完成
        this.previousState = this.currentState;
        this.currentState = this._pendingState;
        this._pendingState = null;
        this.isTransitioning = false;
        this.transitionTime = 0;
        this._stateTime = 0;
      } else {
        // 过渡进行中,不评估新转换
        this._resetTriggers();
        return;
      }
    }

    // 2) 累计状态时间
    this._stateTime += dt;

    // 3) 评估当前状态的出转换
    if (this.currentState) {
      for (const trans of this.transitions) {
        if (trans.from !== this.currentState.name) continue;
        if (!this._checkExitTime(trans)) continue;
        if (!this._checkConditions(trans)) continue;

        // 转换触发
        const target = this.states.get(trans.to);
        if (!target) continue;

        if (trans.duration > 0) {
          // 启动过渡
          this._pendingState = target;
          this._transitionDuration = trans.duration;
          this.transitionTime = trans.duration;
          this.isTransitioning = true;
        } else {
          // 立即切换
          this.previousState = this.currentState;
          this.currentState = target;
          this._stateTime = 0;
        }
        break; // 每帧只触发一个转换
      }
    }

    // 4) 重置触发器
    this._resetTriggers();
  }

  // ── 序列化 ────────────────────────────────────────────────────────

  /** 导出状态图为 JSON 可序列化对象。 */
  exportGraph(): AnimStateMachineGraph {
    return {
      states: this.getStates(),
      transitions: this.transitions.slice(),
      parameters: Object.fromEntries(this.parameters),
      currentState: this.currentState?.name ?? null,
    };
  }

  /** 从 JSON 导入状态图(替换现有 states / transitions / parameters)。 */
  importGraph(data: AnimStateMachineGraph): void {
    this.states.clear();
    this.transitions.length = 0;
    this.parameters.clear();

    for (const s of data.states ?? []) this.states.set(s.name, s);
    for (const t of data.transitions ?? []) this.transitions.push(t);
    if (data.parameters) {
      for (const [k, v] of Object.entries(data.parameters)) {
        this.parameters.set(k, v);
      }
    }

    // 恢复当前状态
    if (data.currentState) {
      this.currentState = this.states.get(data.currentState) ?? null;
    } else {
      this.currentState = null;
    }
    this.previousState = null;
    this._pendingState = null;
    this.isTransitioning = false;
    this.transitionTime = 0;
    this._stateTime = 0;
    this._triggers.clear();
  }

  // ── 内部方法 ──────────────────────────────────────────────────────

  /** 检查 exitTime 条件:clip 播放进度是否达到 exitTime。 */
  private _checkExitTime(trans: AnimTransition): boolean {
    if (trans.exitTime <= 0) return true;
    const clipDuration = this.currentState?.clipDuration;
    if (!clipDuration || clipDuration <= 0) return true; // 无时长信息,跳过
    const required = trans.exitTime * clipDuration;
    return this._stateTime >= required;
  }

  /** 检查全部条件(AND 语义)。空 conditions = 无条件通过。 */
  private _checkConditions(trans: AnimTransition): boolean {
    for (const cond of trans.conditions) {
      if (!this._evaluateCondition(cond)) return false;
    }
    return true;
  }

  /** 评估单个条件。 */
  private _evaluateCondition(cond: TransitionCondition): boolean {
    const param = this.parameters.get(cond.parameter);
    if (param === undefined) return false;

    switch (cond.operator) {
      case '==':
        return param === cond.value;
      case '!=':
        return param !== cond.value;
      case '>':
        return typeof param === 'number' && typeof cond.value === 'number' && param > cond.value;
      case '<':
        return typeof param === 'number' && typeof cond.value === 'number' && param < cond.value;
      case '>=':
        return typeof param === 'number' && typeof cond.value === 'number' && param >= cond.value;
      case '<=':
        return typeof param === 'number' && typeof cond.value === 'number' && param <= cond.value;
      default:
        return false;
    }
  }

  /** 重置所有触发器参数为 false。 */
  private _resetTriggers(): void {
    for (const name of this._triggers) {
      this.parameters.set(name, false);
    }
    this._triggers.clear();
  }
}
