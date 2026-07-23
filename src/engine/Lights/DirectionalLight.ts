// DirectionalLight — 平行光（太阳光）。
// 参考 three.js DirectionalLight：所有光线平行、无距离衰减、可投射阴影。
//
// 与 three.js 的差异：
//   - VREEN 额外保留显式 `direction`（光传播方向）字段，供 WebGL2Renderer
//     直接读取用于阴影相机定位与 u_lightDir uniform。three.js 是从
//     position → target 反推方向，这里保留显式方向以匹配现有渲染管线。
//   - `target` 字段同步保留（three.js 兼容，便于未来扩展或目标跟随）。
//
// 阴影参数集中在 `shadow: DirectionalLightShadow`（简化版正交相机配置），
// 取代了早期版本散落在光源上的 shadow* 平铺字段。

import { Light } from './Light';
import { Object3D } from '../Core/Object3D';
import { DirectionalLightShadow } from './DirectionalLightShadow';

export class DirectionalLight extends Light {
  override readonly type: string = 'DirectionalLight';
  /** 此标志可用于类型测试。 */
  isDirectionalLight: boolean = true;

  /** 光传播方向（three.js 约定：从光源指向被照物）。 */
  direction: { x: number; y: number; z: number };

  /** 光照指向的目标节点（three.js 兼容字段；VREEN 渲染管线目前直接用 direction）。 */
  target: Object3D;

  /** 是否投射阴影。 */
  castShadow: boolean = false;

  /** 阴影配置（正交相机参数 + 贴图分辨率 + bias）。 */
  shadow: DirectionalLightShadow;

  constructor(
    color: number | string = 0xffffff,
    intensity = 1,
    direction: { x: number; y: number; z: number } = { x: 0, y: -1, z: 0 },
  ) {
    super(color, intensity);
    this.direction = direction;
    this.target = new Object3D();
    this.shadow = new DirectionalLightShadow();
  }
}
