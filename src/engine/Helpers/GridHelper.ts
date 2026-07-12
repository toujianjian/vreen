// GridHelper — 简化的网格平面。
//
// 做法：在一个 NxN 平面片元着色器中,根据世界坐标的 xz 计算 cellSection + fade。
// 整个 grid 是单个 Mesh + 自定义 ShaderProgram,内部走通用 PBR path
// 即可。颜色 (cellColor/sectionColor) 通过 uniform 注入。
//
// 不挂在 _drawMesh 上,所以走专用的"unlit" 程序。提供给 CustomStage
// 直接调用 renderer 即可。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { ShaderProgram } from '../Renderer/ShaderProgram';
import { createLogger } from '@/lib/logger';

const log = createLogger('Grid');

export interface GridHelperOptions {
  /** total plane side length in world units. */
  size?: number;
  /** minor cell size. */
  cellSize?: number;
  /** major section size (multiples of cellSize). */
  sectionSize?: number;
  /** minor line color. */
  cellColor?: [number, number, number];
  /** major line color. */
  sectionColor?: [number, number, number];
  /** fade distance from origin. */
  fadeDistance?: number;
  /** fade falloff exponent. */
  fadeStrength?: number;
  /** y position of the grid. */
  y?: number;
}

const GRID_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 2) in vec2 a_uv;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
out vec2 v_uv;
out vec3 v_local;
void main() {
  v_uv = a_uv;
  v_local = a_position;
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

const GRID_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_local;
uniform float u_cellSize;
uniform float u_sectionSize;
uniform vec3 u_cellColor;
uniform vec3 u_sectionColor;
uniform float u_fadeDistance;
uniform float u_fadeStrength;
out vec4 fragColor;

float gridLine(vec2 uv, float size) {
  // 抗锯齿:对线宽 ~1 像素
  vec2 g = abs(fract(uv / size - 0.5) - 0.5);
  vec2 d = fwidth(uv / size);
  float line = smoothstep(d.x * 1.5, d.x * 0.0, g.x) +
              smoothstep(d.y * 1.5, d.y * 0.0, g.y);
  return clamp(line, 0.0, 1.0);
}

void main() {
  // 偶数条线为 section(粗),奇数为 cell(细)
  vec2 worldXZ = v_local.xz;
  float cellLine = gridLine(worldXZ, u_cellSize);
  float sectionLine = gridLine(worldXZ, u_sectionSize);
  // 优先级:section > cell
  float cellMask = cellLine * (1.0 - sectionLine);
  float sectionMask = sectionLine;

  vec3 col = u_cellColor * cellMask + u_sectionColor * sectionMask;

  // 距离衰减
  float d = length(worldXZ);
  float fade = 1.0 - smoothstep(u_fadeDistance * 0.4, u_fadeDistance, d);
  fade = pow(fade, u_fadeStrength);
  col *= fade;

  // 极远处不画
  if (d > u_fadeDistance) discard;

  fragColor = vec4(col, max(max(cellMask, sectionMask), 0.0) * fade);
}
`;

/** 程序缓存(单例)。 */
let _gridProgram: ShaderProgram | null = null;
function getGridProgram(gl: WebGL2RenderingContext): ShaderProgram {
  if (_gridProgram && _gridProgram.gl === gl) return _gridProgram;
  _gridProgram = new ShaderProgram(gl, GRID_VERT, GRID_FRAG);
  log.debug('compiled grid program');
  return _gridProgram;
}

/** 创建一个网格 Mesh + 返回该 mesh 以便挂到 scene。 */
export function createGridMesh(
  renderer: WebGL2Renderer,
  opts: GridHelperOptions = {},
): Mesh {
  const size = opts.size ?? 20;
  const cellSize = opts.cellSize ?? 0.4;
  const sectionSize = opts.sectionSize ?? 2;
  const cellColor = opts.cellColor ?? [0.1, 0.225, 0.29];
  const sectionColor = opts.sectionColor ?? [0, 0.94, 1];
  const fadeDistance = opts.fadeDistance ?? 18;
  const fadeStrength = opts.fadeStrength ?? 1.4;
  const y = opts.y ?? 0;

  // 大平面:从 -size/2 到 +size/2
  const geom = new BufferGeometry();
  const half = size / 2;
  const positions = new Float32Array([
    -half, 0, -half,
     half, 0, -half,
     half, 0,  half,
    -half, 0,  half,
  ]);
  const uvs = new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]);
  const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
  geom.setAttribute('position', new BufferAttribute(positions, 3));
  geom.setAttribute('uv', new BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  geom.computeBoundingBox();

  const mesh = new Mesh(geom, { type: 'Basic', renderOrder: 0 } as unknown as import('../Core/Material').Material);
  // 绕 x 轴转 -90 度让平面贴地
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = y;

  // 走 Renderer 的 helper 旁路(userData.__helper)
  mesh.userData = {
    __helper: 'grid',
    program: getGridProgram(renderer.gl),
    uniforms: {
      u_cellSize: cellSize,
      u_sectionSize: sectionSize,
      u_cellColor: cellColor,
      u_sectionColor: sectionColor,
      u_fadeDistance: fadeDistance,
      u_fadeStrength: fadeStrength,
    },
  };

  return mesh;
}
