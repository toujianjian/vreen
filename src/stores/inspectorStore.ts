import { create } from 'zustand';
import type { MaterialState, TransformState } from '@/types';

interface InspectorState {
  /** Currently selected object UUID, or null */
  selectedUuid: string | null;
  selectedName: string;
  selectedType: string;
  /** All materials keyed by id, across the loaded scene */
  materials: Record<string, MaterialState>;
  /** Currently focused material id (Inspector shows this) */
  focusedMaterialId: string | null;
  /** Current transform of selected object */
  transform: TransformState;
  /** Tri count of selected object */
  triCount: number;

  setSelection: (uuid: string | null, name: string, type: string, triCount: number) => void;
  setMaterials: (mats: Record<string, MaterialState>) => void;
  updateMaterial: (id: string, patch: Partial<MaterialState>) => void;
  setFocusedMaterial: (id: string | null) => void;
  setTransform: (t: TransformState) => void;
  clear: () => void;
}

const DEFAULT_TRANSFORM: TransformState = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

export const useInspectorStore = create<InspectorState>((set) => ({
  selectedUuid: null,
  selectedName: '—',
  selectedType: '—',
  materials: {},
  focusedMaterialId: null,
  transform: { ...DEFAULT_TRANSFORM },
  triCount: 0,

  setSelection: (uuid, name, type, triCount) =>
    set({
      selectedUuid: uuid,
      selectedName: name,
      selectedType: type,
      triCount,
    }),
  setMaterials: (mats) => set({ materials: mats }),
  updateMaterial: (id, patch) =>
    set((s) => {
      const existing = s.materials[id];
      if (!existing) return s;
      return { materials: { ...s.materials, [id]: { ...existing, ...patch } } };
    }),
  setFocusedMaterial: (id) => set({ focusedMaterialId: id }),
  setTransform: (t) => set({ transform: t }),
  clear: () =>
    set({
      selectedUuid: null,
      selectedName: '—',
      selectedType: '—',
      materials: {},
      focusedMaterialId: null,
      transform: { ...DEFAULT_TRANSFORM },
      triCount: 0,
    }),
}));
