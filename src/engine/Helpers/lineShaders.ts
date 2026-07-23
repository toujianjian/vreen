// lineShaders — Helper 专用的线段着色器程序缓存。
//
// 提供两种线段 shader:
//   1. 单色 (u_color + u_alpha) —— 用于 BoxHelper / ArrowHelper / GridHelper3D
//   2. 顶点色 (a_color attribute) —— 用于 AxesHelper / CameraHelper
//
// 走 Renderer 的 helper 旁路 (userData.__helper === 'line'),在 _drawHelper
// 里用 gl.LINES 绘制。程序按 WebGL2RenderingContext 缓存,同一 context 只编译一次。

import { ShaderProgram } from '../Renderer/ShaderProgram';
import { createLogger } from '@/lib/logger';

/** RGB 三元组类型别名(与 LineHelper 的 [r, g, b] 约定一致)。
 *  注意:Core/Material 的 RGB 是 interface {r,g,b},这里是 tuple,不兼容。 */
export type RGBTuple = [number, number, number];

const log = createLogger('LineShaders');

// ─── 单色线段 shader ───────────────────────────────────────────
const LINE_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
void main() {
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

const LINE_FRAG = /* glsl */ `#version 300 es
precision highp float;
uniform vec3 u_color;
uniform float u_alpha;
out vec4 fragColor;
void main() {
  fragColor = vec4(u_color, u_alpha);
}
`;

// ─── 顶点色线段 shader ─────────────────────────────────────────
const LINE_VC_VERT = /* glsl */ `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 2) in vec3 a_color;
uniform mat4 u_model;
uniform mat4 u_view;
uniform mat4 u_projection;
out vec3 v_color;
void main() {
  v_color = a_color;
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
`;

const LINE_VC_FRAG = /* glsl */ `#version 300 es
precision highp float;
in vec3 v_color;
uniform float u_alpha;
out vec4 fragColor;
void main() {
  fragColor = vec4(v_color, u_alpha);
}
`;

// ─── 程序缓存 ─────────────────────────────────────────────────
let _lineProgram: ShaderProgram | null = null;
let _lineVCProgram: ShaderProgram | null = null;

/** 获取单色线段程序(同一 gl 只编译一次)。 */
export function getLineProgram(gl: WebGL2RenderingContext): ShaderProgram {
  if (_lineProgram && _lineProgram.gl === gl) return _lineProgram;
  _lineProgram = new ShaderProgram(gl, LINE_VERT, LINE_FRAG);
  log.debug('compiled line program');
  return _lineProgram;
}

/** 获取顶点色线段程序(同一 gl 只编译一次)。 */
export function getVertexColorLineProgram(gl: WebGL2RenderingContext): ShaderProgram {
  if (_lineVCProgram && _lineVCProgram.gl === gl) return _lineVCProgram;
  _lineVCProgram = new ShaderProgram(gl, LINE_VC_VERT, LINE_VC_FRAG);
  log.debug('compiled vertex-color line program');
  return _lineVCProgram;
}
