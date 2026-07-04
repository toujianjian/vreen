// Pre-set asset definitions. VREEN renders these procedurally with primitive geometry
// so we don't depend on external binary downloads. Each preset is a recognizable archetype.

import type { PresetAsset } from '@/types';

export const PRESETS: PresetAsset[] = [
  {
    id: 'mech-walker',
    name: 'MECH-WALKER // MX-09',
    tag: 'MECH',
    format: 'glb',
    generator: 'mech',
    description: 'Bipedal combat chassis with reactive armor plating.',
    polyCount: 24800,
  },
  {
    id: 'crystal-shard',
    name: 'CRYSTAL // NULLGEM-7',
    tag: 'CRYSTAL',
    format: 'glb',
    generator: 'crystal',
    description: 'Volumetric refractive mineral, used for energy conduits.',
    polyCount: 4200,
  },
  {
    id: 'lowpoly-tree',
    name: 'BIO // LUMEN-TREE',
    tag: 'ORGANIC',
    format: 'glb',
    generator: 'tree',
    description: 'Stylized low-poly bioluminescent flora specimen.',
    polyCount: 6800,
  },
  {
    id: 'scout-ship',
    name: 'VESSEL // ARROW-3',
    tag: 'VESSEL',
    format: 'glb',
    generator: 'ship',
    description: 'Atmospheric reconnaissance craft, modular fin array.',
    polyCount: 18600,
  },
  {
    id: 'creature-drake',
    name: 'CREATURE // VERMILLION',
    tag: 'CREATURE',
    format: 'glb',
    generator: 'creature',
    description: 'Quadrupedal drake, rigged with idle motion loop.',
    polyCount: 22400,
  },
  {
    id: 'totem-idol',
    name: 'RELIC // OBSIDIAN-IDOL',
    tag: 'RELIC',
    format: 'glb',
    generator: 'totem',
    description: 'Ancient ceremonial relic with emissive glyph channels.',
    polyCount: 9400,
  },
];

export function getPresetById(id: string): PresetAsset | undefined {
  return PRESETS.find((p) => p.id === id);
}
