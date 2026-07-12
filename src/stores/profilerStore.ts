// profilerStore — 共享 Profiler 实例 + 最近帧数据。
//
// 设计:Profiler 单例(由 CustomStage 在 mount 时注入),store 持有最近
// 一帧快照 + ring buffer 历史。HUD 通过 selector 订阅,CustomStage 渲染
// 循环里每帧 pushFrame() 一次。
//
// 这样 Profiler 不耦合 React;主循环是 useEffect 里的 rAF,tick 里收集
// 数据 → 推 store → HUD 自动 rerender。

import { create } from 'zustand';
import type { DrawCallSample, FrameSample, Profiler } from '@/engine';

interface ProfilerStoreState {
  /** 主 Profiler 实例(由 stage 注入)。 */
  profiler: Profiler | null;
  /** 最新一帧快照(snapshot() 返回值)。 */
  latest: FrameSample | null;
  /** 历史帧(老→新,最多 ringSize)。 */
  history: FrameSample[];
  /** 上一帧 system 时序(World.getSystemTimings)。 */
  systemTimings: { name: string; priority: number; duration: number; enabled: boolean }[];

  setProfiler: (p: Profiler | null) => void;
  pushFrame: (sample: FrameSample, systemTimings: ProfilerStoreState['systemTimings']) => void;
  reset: () => void;
}

export const useProfilerStore = create<ProfilerStoreState>((set) => ({
  profiler: null,
  latest: null,
  history: [],
  systemTimings: [],

  setProfiler: (p) => set({ profiler: p }),
  pushFrame: (sample, systemTimings) =>
    set((s) => {
      const ringSize = s.profiler?.ringSize ?? 60;
      const next = s.history.length >= ringSize
        ? [...s.history.slice(s.history.length - ringSize + 1), sample]
        : [...s.history, sample];
      return { latest: sample, history: next, systemTimings };
    }),
  reset: () => set({ latest: null, history: [], systemTimings: [] }),
}));

/** Convenience:直接拿到 Profiler 实例(可能为 null)。 */
export function getProfiler(): Profiler | null {
  return useProfilerStore.getState().profiler;
}

/** 取最近一帧的 draw call 拆解(HUD 渲染用)。 */
export function selectLatestDrawCallBreakdown(s: ProfilerStoreState): DrawCallSample | null {
  return s.latest?.drawCallBreakdown ?? null;
}
