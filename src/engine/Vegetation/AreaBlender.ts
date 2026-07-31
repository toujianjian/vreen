// AreaBlender — 区域混合器:管理多个 SpawnerArea,按优先级 (数组顺序) 依次 spawn。
// 参考 o3de Gems/Vegetation:AreaBlender 解决多个区域重叠时的优先级问题。

import type { SurfaceDataSystem } from '../SurfaceData/SurfaceDataSystem';
import type { SpawnedInstance } from './SpawnerArea';
import { SpawnerArea } from './SpawnerArea';

export class AreaBlender {
  areas: SpawnerArea[] = [];

  add(area: SpawnerArea): this {
    this.areas.push(area);
    return this;
  }

  remove(id: string): boolean {
    const idx = this.areas.findIndex((a) => a.config.id === id);
    if (idx === -1) return false;
    this.areas.splice(idx, 1);
    return true;
  }

  /** Run each area in priority order (array order), collect all spawned instances. */
  spawnAll(surfaceData: SurfaceDataSystem | null): SpawnedInstance[] {
    const all: SpawnedInstance[] = [];
    for (const area of this.areas) {
      const instances = area.spawn(surfaceData);
      for (const inst of instances) all.push(inst);
    }
    return all;
  }

  clearAll(): void {
    for (const a of this.areas) a.clear();
  }
}
