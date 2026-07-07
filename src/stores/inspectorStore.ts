import { create } from 'zustand';
import type { MaterialState, TransformState } from '@/types';

/** Pre-computed geometry statistics for a selected mesh. */
export interface GeometryStats {
  vertexCount: number;
  faceCount: number;
  hasPosition: boolean;
  hasNormal: boolean;
  hasUV: boolean;
  hasColor: boolean;
  hasTangent: boolean;
  bbox: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] } | null;
  indexed: boolean;
  groupCount: number;
  /** Names of textures referenced by the material (map / normalMap / etc.). */
  textures: string[];
}

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
  /** Geometry stats of the currently selected mesh. Null when nothing
   *  with geometry is selected, or when the selection is non-mesh
   *  (e.g. a Group). */
  geometryStats: GeometryStats | null;

  setSelection: (
    uuid: string | null,
    name: string,
    type: string,
    triCount: number,
    geometryStats?: GeometryStats | null,
  ) => void;
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
  geometryStats: null,

  setSelection: (uuid, name, type, triCount, geometryStats) =>
    set({
      selectedUuid: uuid,
      selectedName: name,
      selectedType: type,
      triCount,
      // Allow explicit null to clear, undefined to leave alone (back-compat).
      geometryStats: geometryStats === undefined ? undefined : geometryStats,
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
      geometryStats: null,
    }),
}));
