// GroundedSkybox — 地面投影天空盒。
//
// 适配自 three.js `examples/jsm/objects/GroundedSkybox.js` (r159+)。
//
// 原理:
//   将环境贴图(equirectangular 或 cube)投影到一个半球几何体上,但将
//   下半部分"压平"到地面平面,形成无缝的天-地过渡。相机置于 skybox 内部,
//   看到的是环境贴图在穹顶和地面上的连续投影——没有传统天空盒的"夹角"。
//
//   几何变形算法(three.js 原始实现):
//     1. 创建一个半径为 `radius` 的球体(2*resolution × resolution 分段)
//     2. 翻转 Z(scale -1)使法线朝内(从内部观察)
//     3. 对 y < 0 的顶点(下半球)做平滑压平:
//        - y1 = -height * 3/2  (过渡阈值)
//        - y < y1: f = -height / y  (远端完全压平到 y = -height)
//        - y >= y1: f = 1 - y² / (3 * y1²)  (平滑过渡)
//        - 顶点 *= f
//     4. 使用 MeshBasicMaterial(map = envMap, depthWrite = false)
//
// 用法:
//   const skybox = new GroundedSkybox(envTexture, 15, 100);
//   skybox.position.y = 15;  // 地面对齐到 y=0
//   scene.add(skybox);
//
// 参数:
//   - map: 环境贴图纹理(equirectangular 或 cube)
//   - height: 相机离地高度(控制地面部分的放大程度)
//   - radius: 天空盒半径(需足够大以包含场景相机)
//   - resolution: 球体几何分辨率(默认 128)
//
// 参考:
//   - three.js GroundedSkybox.js
//   - o3de Atom SkyBox 组件(地面投影模式)

import { Mesh } from '../Core/Mesh';
import { SphereGeometry } from '../Geometries/SphereGeometry';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import type { Texture } from '../Core/Texture';

/**
 * 地面投影天空盒 — 将环境贴图无缝投影到穹顶 + 地面。
 *
 * 默认以原点为中心;设置 `position.y = height` 可将地面对齐到 y=0。
 */
export class GroundedSkybox extends Mesh {
  /**
   * @param map 环境贴图(equirectangular 或 cube map)
   * @param height 相机离地高度(>0,控制地面放大)
   * @param radius 天空盒半径(>0,需包含场景相机)
   * @param resolution 球体几何分段(默认 128)
   */
  constructor(
    map: Texture,
    height: number,
    radius: number,
    resolution: number = 128,
  ) {
    if (height <= 0 || radius <= 0 || resolution <= 0) {
      throw new Error('GroundedSkybox: height, radius, and resolution must be positive.');
    }

    // 1. 创建球体(法线朝内: Z 翻转 + 下半球压平一次完成)
    const geometry = new SphereGeometry(radius, 2 * resolution, resolution);

    // 2. 翻转 Z(scale -1)使法线朝内 + 压平下半球
    const pos = geometry.getAttribute('position');
    if (pos) {
      const arr = pos.array;
      const y1 = -height * 3 / 2;

      for (let i = 0; i < pos.count; i++) {
        const ox = i * 3;
        const oy = ox + 1;
        const oz = oy + 1;

        // Z 翻转(法线朝内,从内部观察)
        arr[oz] = -arr[oz];

        const y = arr[oy];
        if (y < 0) {
          // 平滑过渡: 远端压平,近端保持球形
          const f = y < y1
            ? -height / y
            : 1 - (y * y) / (3 * y1 * y1);
          arr[ox] *= f;
          arr[oy] *= f;
          arr[oz] *= f;
        }
      }
      pos.version++;
    }

    // 3. 创建材质(无深度写入,渲染在最远)
    const material = new MeshBasicMaterial({
      map,
      depthWrite: false,
    });

    super(geometry, material);
  }
}
