// SurfaceDataProvider — 表面数据提供者接口 + 全局注册表。
// 参考 o3de SurfaceDataModifier/SurfaceDataProvider:不同系统 (地形、水体、植被)
// 注册为 provider,SurfaceDataSystem 汇总所有 provider 的结果。

import { Vector3 } from '../Math/Vector3';
import type { SurfacePoint } from './SurfacePoint';

export interface SurfaceDataProvider {
  /** 提供者唯一 id。 */
  readonly id: string;
  /** 返回 worldPosition 附近最多 maxPoints 个表面点;无表面返回空数组。 */
  getSurfacePoints(worldPosition: Vector3, maxPoints: number): SurfacePoint[];
}

/** Provider 注册表:register/unregister/get/getAll/clear。 */
export class SurfaceDataProviderRegistry {
  private providers = new Map<string, SurfaceDataProvider>();

  register(provider: SurfaceDataProvider): void {
    this.providers.set(provider.id, provider);
  }

  unregister(id: string): void {
    this.providers.delete(id);
  }

  get(id: string): SurfaceDataProvider | undefined {
    return this.providers.get(id);
  }

  getAll(): SurfaceDataProvider[] {
    return Array.from(this.providers.values());
  }

  clear(): void {
    this.providers.clear();
  }
}

/** 进程级默认注册表。 */
export const defaultSurfaceDataRegistry = new SurfaceDataProviderRegistry();
