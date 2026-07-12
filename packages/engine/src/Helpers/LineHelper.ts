// LineHelper — 通用线段 Mesh(unlit,单色)。
//
// 走 Renderer 的 helper 旁路(userData.__helper === 'line'),在
// _drawHelper 里用 gl.LINES 画。每帧通过 updateVertices() 改 position
// 缓冲,适合 debug / 物理可视化等需要高频刷新顶点但不重建几何的场景。
//
// 用法:
//   const lines = createLineMesh(renderer, 1024, [0, 1, 1]);
//   scene.add(lines);
//   // 每帧:
//   lines.updateVertices(new Float32Array([0,0,0, 1,1,1, ...]));

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Mesh } from '../Core/Mesh';
import type { WebGL2Renderer } from '../Renderer/WebGL2Renderer';
import { ShaderProgram } from '../Renderer/ShaderProgram';
import { createLogger } from '../logger';

const log = createLogger('LineHelper');

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

let _program: ShaderProgram | null = null;
function getLineProgram(gl: WebGL2RenderingContext): ShaderProgram {
  if (_program && _program.gl === gl) return _program;
  _program = new ShaderProgram(gl, LINE_VERT, LINE_FRAG);
  log.debug('compiled line program');
  return _program;
}

export class LineMesh extends Mesh {
  /** 最大段数(每段 2 顶点 = 6 floats)。 */
  readonly maxSegments: number;
  /** 当前写入的段数。 */
  segmentCount: number = 0;

  constructor(renderer: WebGL2Renderer, maxSegments: number, color: [number, number, number], alpha: number = 1) {
    const geom = new BufferGeometry();
    const positions = new Float32Array(maxSegments * 2 * 3);
    const attr = new BufferAttribute(positions, 3);
    attr.setUsage('Dynamic');
    geom.setAttribute('position', attr);
    geom.computeBoundingSphere();

    super(geom, { type: 'Basic', renderOrder: 1 } as unknown as import('../Core/Material').Material);
    this.maxSegments = maxSegments;
    this.frustumCulled = false; // lines often move outside bounding sphere

    this.userData = {
      __helper: 'line',
      program: getLineProgram(renderer.gl),
      uniforms: {
        u_color: color,
        u_alpha: alpha,
      },
    };
  }

  /**
   * 覆盖顶点缓冲。`verts` 长度必须是 6 的倍数(每段 2 顶点 × 3 floats)。
   * 自动 clamp 到 maxSegments。
   */
  updateVertices(verts: Float32Array): void {
    const attr = this.geometry.getAttribute('position') as BufferAttribute | undefined;
    if (!attr) return;
    const dst = attr.array as Float32Array;
    const segs = Math.floor(verts.length / 6);
    const n = Math.min(segs, this.maxSegments);
    dst.set(verts.subarray(0, n * 6));
    attr.needsUpdate = true;
    this.segmentCount = n;
  }
}

export function createLineMesh(
  renderer: WebGL2Renderer,
  maxSegments: number,
  color: [number, number, number],
  alpha?: number,
): LineMesh {
  return new LineMesh(renderer, maxSegments, color, alpha);
}
