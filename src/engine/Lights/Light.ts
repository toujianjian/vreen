// Light — base for ambient / directional / point / spot.
// 自研 Light 继承 Object3D 这样可以 scene.add()、访问 userData、matrixWorld
// 跟 Mesh/Group 在一个 scene graph 里统一遍历（WebGL2Renderer 通过 children
// 自动发现灯光，不需要单独维护 lightList）。
//
// DirectionalLight 的 direction 是 *光传播方向*（three.js 约定）：
// 默认 (0, -1, 0) 意味着光从上往下照；EngineDemoPage 里改成 (4, 8, 5) 表示
// 光从右上前方斜射下来。

import { Object3D } from '../Core/Object3D';

export abstract class Light extends Object3D {
  override readonly type: string = 'Light';
  isLight: boolean = true;
  color: { r: number; g: number; b: number };
  intensity: number;

  constructor(color: number | string = 0xffffff, intensity = 1) {
    super();
    this.color = parseColor(color);
    this.intensity = intensity;
  }
}

/** Ambient light — uniform color, no spatial falloff. */
export class AmbientLight extends Light {
  override readonly type: string = 'AmbientLight';
}

/** Directional light — parallel rays (sun). */
export class DirectionalLight extends Light {
  override readonly type: string = 'DirectionalLight';
  /** Direction light TRAVELS in. Three.js convention. */
  direction: { x: number; y: number; z: number };

  // Shadow parameters
  castShadow: boolean = false;
  shadowMapSize: number = 1024;
  /** Orthographic frustum half-extents (left/right/top/bottom in light space). */
  shadowHalfSize: number = 4;
  shadowNear: number = 0.1;
  shadowFar: number = 50;
  shadowBias: number = 0.001;

  constructor(
    color: number | string = 0xffffff,
    intensity = 1,
    direction: { x: number; y: number; z: number } = { x: 0, y: -1, z: 0 },
  ) {
    super(color, intensity);
    this.direction = direction;
  }
}

function parseColor(c: number | string): { r: number; g: number; b: number } {
  if (typeof c === 'number') {
    return { r: ((c >> 16) & 0xff) / 255, g: ((c >> 8) & 0xff) / 255, b: (c & 0xff) / 255 };
  }
  // CSS color (hex).
  const hex = c.replace('#', '');
  const v = parseInt(hex.length === 3
    ? hex.split('').map((c2) => c2 + c2).join('')
    : hex, 16);
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}
