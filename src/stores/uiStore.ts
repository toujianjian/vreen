import { create } from 'zustand';
import type { EnvironmentState, PostFXState, EnvironmentPreset } from '@/types';

export interface LogEntry {
  id: number;
  ts: string;
  level: 'INFO' | 'OK' | 'WARN' | 'ERR';
  /** Pre-rendered log text. */
  text: string;
  /** Optional i18n key. When present, the TerminalLog prefers t(textKey) over text. */
  textKey?: string;
}

interface UIState {
  environment: EnvironmentState;
  postFX: PostFXState;
  /** Drawer states (outliner, inspector) */
  showOutliner: boolean;
  showInspector: boolean;
  /** Log entries for the terminal-style footer on home */
  logs: LogEntry[];

  setEnvironment: (patch: Partial<EnvironmentState>) => void;
  setPreset: (preset: EnvironmentPreset) => void;
  setPostFX: (patch: Partial<PostFXState>) => void;
  toggleOutliner: () => void;
  toggleInspector: () => void;
  pushLog: (level: 'INFO' | 'OK' | 'WARN' | 'ERR', text: string, textKey?: string) => void;
  clearLogs: () => void;
}

export const useUIStore = create<UIState>((set) => ({
  environment: {
    preset: 'studio',
    exposure: 1.05,
    background: 'envmap',
    backgroundColor: '#05070d',
  },
  postFX: {
    bloom: true,
    bloomIntensity: 0.55,
    chromaticAberration: true,
    vignette: true,
    ssao: false,
  },
  showOutliner: true,
  showInspector: true,
  logs: [
    { id: 0, ts: '00:00:00', level: 'INFO', text: 'VREEN kernel v0.1.0 boot sequence initiated...', textKey: 'terminal.boot.k1' },
    { id: 1, ts: '00:00:01', level: 'OK', text: 'Shader pipeline online. 3D context verified.', textKey: 'terminal.boot.k2' },
    { id: 2, ts: '00:00:02', level: 'OK', text: 'Asset index loaded. 6 preset archetypes ready.', textKey: 'terminal.boot.k3' },
    { id: 3, ts: '00:00:03', level: 'INFO', text: 'Awaiting operator input.', textKey: 'terminal.boot.k4' },
  ],

  setEnvironment: (patch) => set((s) => ({ environment: { ...s.environment, ...patch } })),
  setPreset: (preset) => set((s) => ({ environment: { ...s.environment, preset } })),
  setPostFX: (patch) => set((s) => ({ postFX: { ...s.postFX, ...patch } })),
  toggleOutliner: () => set((s) => ({ showOutliner: !s.showOutliner })),
  toggleInspector: () => set((s) => ({ showInspector: !s.showInspector })),
  pushLog: (level, text, textKey) =>
    set((s) => {
      const now = new Date();
      const ts = `${now.getHours().toString().padStart(2, '0')}:${now
        .getMinutes()
        .toString()
        .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      const nextId = (s.logs[s.logs.length - 1]?.id ?? 0) + 1;
      const next = [...s.logs, { id: nextId, ts, level, text, textKey }];
      // Cap to last 60 entries
      return { logs: next.slice(-60) };
    }),
  clearLogs: () => set({ logs: [] }),
}));
