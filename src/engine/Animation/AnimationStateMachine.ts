// AnimationStateMachine — minimal finite-state machine for animation
// control. Each state owns a clip and a default loop mode; transitions
// are guarded by a callback that can read the ECS world + entity.
//
// 与 ECS AnimState 组件关系:
//   • AnimState (ECS 组件) 持 stateMachine: AnimationStateMachine | null
//   • AnimStateSystem 每帧调 stateMachine.tick(world, entityId, dt)
//   • tick 里: 评估当前 state 的所有 out-transition guards → 满足则触发
//   • transition 带 duration: 平滑过渡 (倒计时), 否则立即 mixer.play
//
// 命名说明: 这里 interface 叫 AnimMachineState 避免和 ECS 组件 AnimState
// 撞名。AnimationStateMachine 整台机器持有 mixer 引用。

import { AnimationClip } from './AnimationClip';
import { AnimationMixer } from './AnimationMixer';
import type { World } from '../ECS/World';

export interface AnimMachineState {
  name: string;
  clip: AnimationClip;
  loop: 'once' | 'repeat' | 'pingpong';
  timeScale?: number;
}

export interface AnimTransition {
  from: string;
  to: string;
  /** Guard: 读 world/entity 状态,返回 true 允许触发 transition。 */
  guard?: (world: World, entityId: number) => boolean;
  /** 过渡时长 (秒),0/undefined = 立即切换。 */
  duration?: number;
}

export class AnimationStateMachine {
  mixer: AnimationMixer;
  states: Map<string, AnimMachineState> = new Map();
  transitions: AnimTransition[] = [];
  current: AnimMachineState | null = null;
  /** 过渡倒计时;<=0 表示稳定态。 */
  transitionT: number = 0;
  /** 正在过渡到的目标 state。null = 稳定态。 */
  pendingState: AnimMachineState | null = null;

  constructor(mixer: AnimationMixer) {
    this.mixer = mixer;
  }

  add(state: AnimMachineState): this {
    this.states.set(state.name, state);
    return this;
  }

  on(trans: AnimTransition): this {
    this.transitions.push(trans);
    return this;
  }

  /** 立即进入 state (无过渡)。返回是否真的换 state。 */
  enter(name: string): boolean {
    const s = this.states.get(name);
    if (!s) return false;
    if (this.current?.name === name) return false;
    this.mixer.stopAll();
    this.mixer.play(s.clip, { loop: s.loop, timeScale: s.timeScale ?? 1 });
    this.current = s;
    this.transitionT = 0;
    this.pendingState = null;
    return true;
  }

  /** System 每帧调用:评估 guards、推进过渡计时、切换 mixer。
   *  这是把 state machine 真正接到 ECS 的入口。 */
  tick(world: World, entityId: number, dt: number): void {
    // 1) 过渡倒计时
    if (this.transitionT > 0 && this.pendingState) {
      this.transitionT -= dt;
      if (this.transitionT <= 0) {
        this.mixer.stopAll();
        this.mixer.play(this.pendingState.clip, {
          loop: this.pendingState.loop,
          timeScale: this.pendingState.timeScale ?? 1,
        });
        this.current = this.pendingState;
        this.pendingState = null;
      }
      return;
    }
    if (!this.current) return;

    // 2) 评估当前 state 的 out-transition
    for (const t of this.transitions) {
      if (t.from !== this.current.name) continue;
      if (t.guard && !t.guard(world, entityId)) continue;
      const target = this.states.get(t.to);
      if (!target) continue;
      if (t.duration && t.duration > 0) {
        // 平滑过渡:倒计时,期间保留旧 action 继续播
        this.pendingState = target;
        this.transitionT = t.duration;
      } else {
        this.enter(t.to);
      }
      return; // 一次 tick 只触发一个 transition
    }
  }

  /** 列出所有 state 名 (调试用)。 */
  listStateNames(): string[] {
    return Array.from(this.states.keys());
  }
}
