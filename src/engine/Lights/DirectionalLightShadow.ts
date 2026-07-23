// DirectionalLightShadow — 平行光阴影配置（简化版）。
// 参考 three.js 的 DirectionalLightShadow + OrthographicCamera，
// 只保留 WebGL2Renderer 实际用到的正交相机参数，去掉完整的
// LightShadow/OrthographicCamera 抽象，避免引入多余依赖。
//
// 命名约定：
//   - mapSize          阴影贴图分辨率（正方形边长，像素）
//   - cameraHalfSize   正交相机左右/上下的半 extents（光空间单位）
//   - cameraNear/Far   正交相机近/远平面
//   - bias             阴影深度偏移（缓解 shadow acne）

export class DirectionalLightShadow {
  /** 此标志可用于类型测试。 */
  readonly isDirectionalLightShadow: boolean = true;

  /** 阴影贴图边长（正方形）。 */
  mapSize: number;
  /** 正交相机半 extents（left/right/top/bottom 共用）。 */
  cameraHalfSize: number;
  /** 正交相机近平面。 */
  cameraNear: number;
  /** 正交相机远平面。 */
  cameraFar: number;
  /** 阴影深度偏移。 */
  bias: number;

  constructor() {
    this.mapSize = 1024;
    this.cameraHalfSize = 4;
    this.cameraNear = 0.1;
    this.cameraFar = 50;
    this.bias = 0.001;
  }

  /** 浅拷贝自身（参数型对象，无需深拷贝）。 */
  copy(source: DirectionalLightShadow): this {
    this.mapSize = source.mapSize;
    this.cameraHalfSize = source.cameraHalfSize;
    this.cameraNear = source.cameraNear;
    this.cameraFar = source.cameraFar;
    this.bias = source.bias;
    return this;
  }

  /** 创建一个参数相同的副本。 */
  clone(): DirectionalLightShadow {
    return new DirectionalLightShadow().copy(this);
  }

  /** 序列化为 JSON（参数集合）。 */
  toJSON(): Record<string, unknown> {
    return {
      mapSize: this.mapSize,
      cameraHalfSize: this.cameraHalfSize,
      cameraNear: this.cameraNear,
      cameraFar: this.cameraFar,
      bias: this.bias,
    };
  }
}
