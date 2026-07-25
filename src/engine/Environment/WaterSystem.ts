// WaterSystem — 水域系统(水面 + 水下 + 反射/折射)。
//
// 设计:
//   * create(size, resolution) 构建一个 XZ 平面网格(PlaneGeometry 旋转 -90° X)
//     作为水面,材质用 WaterMaterial
//   * update(dt) 推进时间,把 WaterMaterial.uniforms.time 之类的字段推进
//     (本实现把 time 存在 userData,WaterMaterial 自身读 time uniform 由
//      渲染器从 userData.time 注入)
//   * 可选 attachSimulation(sim) 接入 WaterSimulation,把高度场采样到
//     水面顶点 displacement(简化:仅作为 uniform,不在 CPU 顶点位移)
//   * isUnderwater(point) 判断 point.y < waterLevel
//   * getUnderwaterFog(point) 返回水下雾参数(颜色 + 密度)
//
// 与 WaterMaterial 的关系:
//   * WaterSystem 持有一个 WaterMaterial 实例并暴露其可调字段
//   * waveSpeed / waveScale / fresnelScale 等通过 WaterMaterial 字段直接修改
//   * flowDirection 影响 waveSpeed 方向

import { Vector2 } from '../Math';
import { Vector3 } from '../Math';
import { Color } from '../Math';
import { Mesh } from '../Core';
import { PlaneGeometry } from '../Geometries';
import { WaterMaterial } from '../Materials';
import type { Texture } from '../Core/Texture';
import { WaterSimulation } from './WaterSimulation';

/** 水下雾参数。 */
export interface UnderwaterFog {
  /** 雾颜色。 */
  color: Color;
  /** 雾密度(指数雾,越大越浓)。 */
  density: number;
}

/**
 * 水域系统 — 管理水面网格、材质、波动动画与水下判定。
 */
export class WaterSystem {
  /** 水面网格(旋转后的 PlaneGeometry + WaterMaterial)。 */
  waterMesh: Mesh | null = null;
  /** 水面材质。 */
  waterMaterial: WaterMaterial | null = null;
  /** 反射纹理(由外部 renderer 渲染后赋值)。 */
  reflectionTexture: Texture | null = null;
  /** 折射纹理(由外部 renderer 渲染后赋值)。 */
  refractionTexture: Texture | null = null;
  /** 波浪高度(米,用于位移幅度)。 */
  waveHeight: number = 0.2;
  /** 波浪波长(米)。 */
  waveLength: number = 5;
  /** 流向(XZ 平面)。 */
  flowDirection: Vector2;
  /** 水的固有色。 */
  waterColor: Color;
  /** 透明度(0..1)。 */
  transparency: number = 0.85;
  /** 水位高度(世界 Y)。 */
  waterLevel: number = 0;
  /** 当前模拟时间(秒)。 */
  time: number = 0;
  /** 可选波动模拟器。 */
  simulation: WaterSimulation | null = null;
  /** 水下雾颜色。 */
  underwaterFogColor: Color;
  /** 水下雾密度。 */
  underwaterFogDensity: number = 0.08;

  constructor() {
    this.flowDirection = new Vector2(1, 0);
    this.waterColor = new Color(0.1, 0.3, 0.5);
    this.underwaterFogColor = new Color(0.05, 0.15, 0.25);
  }

  /**
   * 创建水面网格。
   *
   * @param size 水面边长(世界单位,正方形)。
   * @param resolution 网格分段数(每边)。
   */
  create(size: number, resolution: number): this {
    const seg = Math.max(1, Math.floor(resolution));
    const geo = new PlaneGeometry(size, size, seg, seg);
    // PlaneGeometry 在 XY 平面(法线 +Z),旋转 -PI/2 绕 X 轴 → XZ 平面(法线 +Y)
    const mat = new WaterMaterial({
      waterColor: { r: this.waterColor.r, g: this.waterColor.g, b: this.waterColor.b },
      opacity: this.transparency,
      transparent: true,
      depthWrite: false,
    });
    this.waterMaterial = mat;
    const mesh = new Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = this.waterLevel;
    mesh.name = 'WaterSurface';
    this.waterMesh = mesh;
    return this;
  }

  /**
   * 推进波动动画。
   *
   * @param dt 流逝时间(秒)。
   */
  update(dt: number): this {
    this.time += dt;
    if (this.simulation) this.simulation.update(dt);
    if (this.waterMaterial) {
      // waveSpeed 沿流向推进
      const dir = this.flowDirection;
      const speed = 0.5; // 基础速度
      this.waterMaterial.waveSpeed = { x: dir.x * speed, y: dir.y * speed };
      // 把 time 存到 userData,渲染器读出后注入 u_time uniform
      this.waterMaterial.userData.time = this.time;
      // waveScale 与 waveHeight/waveLength 关联
      const ws = this.waveLength > 0 ? 1 / this.waveLength : 1;
      this.waterMaterial.waveScale = ws * (0.5 + this.waveHeight);
    }
    return this;
  }

  /** 设置水位高度(世界 Y)。 */
  setHeight(h: number): this {
    this.waterLevel = h;
    if (this.waterMesh) this.waterMesh.position.y = h;
    return this;
  }

  /** 设置流向(XZ 平面,会被归一化)。 */
  setFlow(dir: Vector2): this {
    const len = Math.hypot(dir.x, dir.y);
    if (len > 0) {
      this.flowDirection.set(dir.x / len, dir.y / len);
    } else {
      this.flowDirection.set(1, 0);
    }
    return this;
  }

  /** 设置波浪参数。 */
  setWaveParams(height: number, length: number): this {
    this.waveHeight = Math.max(0, height);
    this.waveLength = Math.max(0.001, length);
    return this;
  }

  /** 获取水面网格(可能为 null)。 */
  getMesh(): Mesh | null {
    return this.waterMesh;
  }

  /** 获取水下雾参数(若 point 在水下返回参数,否则返回 null)。 */
  getUnderwaterFog(point: Vector3): UnderwaterFog | null {
    if (!this.isUnderwater(point)) return null;
    return {
      color: this.underwaterFogColor.clone(),
      density: this.underwaterFogDensity,
    };
  }

  /** 判断点是否在水下(point.y < waterLevel)。 */
  isUnderwater(point: Vector3): boolean {
    return point.y < this.waterLevel;
  }

  /** 设置反射纹理。 */
  setReflectionTexture(tex: Texture | null): this {
    this.reflectionTexture = tex;
    if (this.waterMaterial) this.waterMaterial.reflectionMap = tex;
    return this;
  }

  /** 设置折射纹理(简化:复用 normalMap 槽位语义,此处仅记录引用)。 */
  setRefractionTexture(tex: Texture | null): this {
    this.refractionTexture = tex;
    // WaterMaterial 没有专门的 refractionMap 字段,存到 userData 供 shader 注入
    if (this.waterMaterial) this.waterMaterial.userData.refractionMap = tex;
    return this;
  }

  /** 设置水的固有色。 */
  setWaterColor(color: Color): this {
    this.waterColor.copy(color);
    if (this.waterMaterial) {
      this.waterMaterial.waterColor = { r: color.r, g: color.g, b: color.b };
    }
    return this;
  }

  /** 设置透明度。 */
  setTransparency(t: number): this {
    this.transparency = Math.max(0, Math.min(1, t));
    if (this.waterMaterial) this.waterMaterial.opacity = this.transparency;
    return this;
  }

  /** 设置水下雾参数。 */
  setUnderwaterFog(color: Color, density: number): this {
    this.underwaterFogColor.copy(color);
    this.underwaterFogDensity = Math.max(0, density);
    return this;
  }

  /** 接入波动模拟器(可选)。 */
  attachSimulation(sim: WaterSimulation | null): this {
    this.simulation = sim;
    return this;
  }
}
