// MaterialGraph — 节点式程序化材质系统。
//
// 设计目标:
//   - 提供可视化节点图材质编辑器所需的核心数据结构与编译器,
//     类似 o3de MaterialGraph / Unreal Material Editor / Unity ShaderGraph / Blender ShaderEditor。
//   - 用户通过连接节点(Input / Math / Texture / Color / Output)构建材质,
//     编译器把图编译成 GLSL(顶点 + 片段),最终包装成 ShaderMaterial 供 renderer 使用。
//   - 完全无 WebGL 依赖(纯数据 + 字符串生成),可在 Node/无头环境运行。
//
// 节点类型(参考 o3de MaterialGraph + UE Material Editor):
//   Input    — UV / Position / Normal / Time / ScreenUV / ViewDir / WorldPos / VertexColor
//   Constant — Float / Vec2 / Vec3 / Vec4 / Color
//   Texture  — TextureSample (sampler2D + UV → vec4)
//   Math     — Add / Sub / Mul / Div / Lerp / Saturate / Pow / Sin / Cos / Abs / Negate / Sqrt / Length / Normalize / Cross / Dot / Reflect / Refract / Step / Smoothstep / Fract / Floor / Ceil / Mix / Min / Max / Clamp / OneMinus / Fresnel / Distance
//   Channel  — Split (vec → scalars) / Combine (scalars → vec) / Swizzle
//   Noise    — SimplexNoise / ValueNoise / Voronoi / CellularNoise
//   Curve    — CurveRGB / Ramp (1D LUT)
//   Output   — Surface (baseColor / metallic / roughness / normal / emissive / opacity / ao / alphaClip)
//              Unlit (color / opacity)
//
// 编译流程:
//   1. 拓扑排序(从 Output 节点反向 BFS)
//   2. 每个节点生成 GLSL 表达式(声明中间变量)
//   3. 收集 uniforms (constants / textures / time)
//   4. 拼装完整 vertex + fragment shader
//   5. 包装为 ShaderMaterial
//
// 序列化:
//   - graph.toJSON() → 普通 JS 对象(JSON.stringify 友好)
//   - MaterialGraph.fromJSON(json) → 重建图
//
// 不变量:
//   - 同一图编译结果在相同输入下确定性(无随机)
//   - 节点 id 在图内唯一(自动分配,不依赖外部)
//   - 类型检查在编译时执行,类型不匹配抛错(不静默生成错误代码)
//   - 输出节点必须有且只有一个;否则编译失败

import { ShaderMaterial, type UniformValue } from './ShaderMaterial';
import type { Texture } from '../Core/Texture';
import { createLogger } from '@/lib/logger';

const log = createLogger('MaterialGraph');

// ─────────────────────────────────────────────────────────────────────
// 类型系统
// ─────────────────────────────────────────────────────────────────────

/** 节点值类型(用于端口类型检查)。 */
export type SocketType =
  | 'float'
  | 'vec2'
  | 'vec3'
  | 'vec4'
  | 'color' // 等价 vec4,但语义上表示颜色(可参与 sRGB 转换)
  | 'bool'
  | 'int';

/** 端口方向。 */
export type SocketDirection = 'in' | 'out';

/** 单个端口(输入或输出)。 */
export interface Socket {
  /** 端口 id(图内唯一)。 */
  id: string;
  /** 端口显示名(短,如 'uv' / 'rgb' / 'a')。 */
  name: string;
  /** 端口类型。 */
  type: SocketType;
  /** 方向。 */
  direction: SocketDirection;
  /** 默认值(仅输入端口有;未连接时使用)。 */
  defaultValue?: number | number[];
  /** 端口描述(供 UI tooltip)。 */
  description?: string;
}

// ─────────────────────────────────────────────────────────────────────
// 节点定义
// ─────────────────────────────────────────────────────────────────────

/** 节点种类(决定执行语义)。 */
export type NodeKind =
  | 'input.uv'
  | 'input.position'
  | 'input.normal'
  | 'input.tangent'
  | 'input.time'
  | 'input.screenUV'
  | 'input.viewDir'
  | 'input.worldPos'
  | 'input.vertexColor'
  | 'constant.float'
  | 'constant.vec2'
  | 'constant.vec3'
  | 'constant.vec4'
  | 'constant.color'
  | 'texture.sample'
  | 'math.add'
  | 'math.sub'
  | 'math.mul'
  | 'math.div'
  | 'math.lerp'
  | 'math.saturate'
  | 'math.pow'
  | 'math.sin'
  | 'math.cos'
  | 'math.abs'
  | 'math.negate'
  | 'math.sqrt'
  | 'math.length'
  | 'math.normalize'
  | 'math.cross'
  | 'math.dot'
  | 'math.reflect'
  | 'math.refract'
  | 'math.step'
  | 'math.smoothstep'
  | 'math.fract'
  | 'math.floor'
  | 'math.ceil'
  | 'math.min'
  | 'math.max'
  | 'math.clamp'
  | 'math.oneminus'
  | 'math.fresnel'
  | 'math.distance'
  | 'channel.split'
  | 'channel.combine'
  | 'channel.swizzle'
  | 'noise.simplex'
  | 'noise.value'
  | 'noise.voronoi'
  | 'noise.cellular'
  | 'curve.ramp'
  | 'output.surface'
  | 'output.unlit';

/** 节点参数值类型(标量/字符串/数组/布尔/纹理/ramp stops)。 */
export type ParamValue =
  | number
  | string
  | number[]
  | boolean
  | Texture
  | [number, number[]][]; // curve.ramp stops: [[t, [r,g,b,a]], ...]

/** 节点基类。 */
export interface MaterialNode {
  /** 节点 id(图内唯一)。 */
  id: string;
  /** 节点类型。 */
  kind: NodeKind;
  /** UI 显示名。 */
  name: string;
  /** 输入端口。 */
  inputs: Socket[];
  /** 输出端口。 */
  outputs: Socket[];
  /** 节点参数(常量值、贴图槽、swizzle 模式、ramp stops 等)。 */
  params: Record<string, ParamValue>;
  /** UI 位置(便于序列化编辑器布局)。 */
  position?: { x: number; y: number };
}

/** 连接(边)。 */
export interface MaterialEdge {
  /** 边 id。 */
  id: string;
  /** 源节点 id。 */
  fromNode: string;
  /** 源输出端口 id。 */
  fromSocket: string;
  /** 目标节点 id。 */
  toNode: string;
  /** 目标输入端口 id。 */
  toSocket: string;
}

// ─────────────────────────────────────────────────────────────────────
// 节点工厂(内置节点模板)
// ─────────────────────────────────────────────────────────────────────

/** 节点工厂:按 kind 创建默认节点。 */
function createNode(kind: NodeKind, id: string): MaterialNode {
  const base: MaterialNode = {
    id,
    kind,
    name: kind,
    inputs: [],
    outputs: [],
    params: {},
  };

  switch (kind) {
    // ── Input ─────────────────────────────────────────────
    case 'input.uv':
      base.outputs.push({ id: `${id}.uv`, name: 'uv', type: 'vec2', direction: 'out' });
      base.name = 'UV';
      break;
    case 'input.position':
      base.outputs.push({ id: `${id}.pos`, name: 'position', type: 'vec3', direction: 'out' });
      base.name = 'Position';
      break;
    case 'input.normal':
      base.outputs.push({ id: `${id}.n`, name: 'normal', type: 'vec3', direction: 'out' });
      base.name = 'Normal';
      break;
    case 'input.tangent':
      base.outputs.push({ id: `${id}.t`, name: 'tangent', type: 'vec3', direction: 'out' });
      base.name = 'Tangent';
      break;
    case 'input.time':
      base.outputs.push({ id: `${id}.t`, name: 'time', type: 'float', direction: 'out' });
      base.name = 'Time';
      break;
    case 'input.screenUV':
      base.outputs.push({ id: `${id}.suv`, name: 'screenUV', type: 'vec2', direction: 'out' });
      base.name = 'ScreenUV';
      break;
    case 'input.viewDir':
      base.outputs.push({ id: `${id}.vd`, name: 'viewDir', type: 'vec3', direction: 'out' });
      base.name = 'ViewDir';
      break;
    case 'input.worldPos':
      base.outputs.push({ id: `${id}.wp`, name: 'worldPos', type: 'vec3', direction: 'out' });
      base.name = 'WorldPos';
      break;
    case 'input.vertexColor':
      base.outputs.push({ id: `${id}.vc`, name: 'color', type: 'vec4', direction: 'out' });
      base.name = 'VertexColor';
      break;

    // ── Constant ─────────────────────────────────────────
    case 'constant.float':
      base.outputs.push({ id: `${id}.v`, name: 'value', type: 'float', direction: 'out' });
      base.params.value = 1.0;
      base.name = 'Float';
      break;
    case 'constant.vec2':
      base.outputs.push({ id: `${id}.v`, name: 'value', type: 'vec2', direction: 'out' });
      base.params.value = [1, 1];
      base.name = 'Vec2';
      break;
    case 'constant.vec3':
      base.outputs.push({ id: `${id}.v`, name: 'value', type: 'vec3', direction: 'out' });
      base.params.value = [1, 1, 1];
      base.name = 'Vec3';
      break;
    case 'constant.vec4':
      base.outputs.push({ id: `${id}.v`, name: 'value', type: 'vec4', direction: 'out' });
      base.params.value = [1, 1, 1, 1];
      base.name = 'Vec4';
      break;
    case 'constant.color':
      base.outputs.push({ id: `${id}.v`, name: 'color', type: 'color', direction: 'out' });
      base.params.value = [1, 1, 1, 1];
      base.name = 'Color';
      break;

    // ── Texture ──────────────────────────────────────────
    case 'texture.sample': {
      base.inputs.push({ id: `${id}.uv`, name: 'uv', type: 'vec2', direction: 'in', defaultValue: undefined });
      base.outputs.push({ id: `${id}.rgb`, name: 'rgb', type: 'vec3', direction: 'out' });
      base.outputs.push({ id: `${id}.r`, name: 'r', type: 'float', direction: 'out' });
      base.outputs.push({ id: `${id}.g`, name: 'g', type: 'float', direction: 'out' });
      base.outputs.push({ id: `${id}.b`, name: 'b', type: 'float', direction: 'out' });
      base.outputs.push({ id: `${id}.a`, name: 'a', type: 'float', direction: 'out' });
      base.outputs.push({ id: `${id}.rgba`, name: 'rgba', type: 'vec4', direction: 'out' });
      base.name = 'TextureSample';
      break;
    }

    // ── Math (binary) ────────────────────────────────────
    case 'math.add':
    case 'math.sub':
    case 'math.mul':
    case 'math.div':
    case 'math.min':
    case 'math.max':
    case 'math.step':
    case 'math.distance': {
      base.inputs.push({ id: `${id}.a`, name: 'a', type: 'float', direction: 'in', defaultValue: 0 });
      base.inputs.push({ id: `${id}.b`, name: 'b', type: 'float', direction: 'in', defaultValue: 0 });
      base.outputs.push({ id: `${id}.r`, name: 'result', type: 'float', direction: 'out' });
      base.name = kind.split('.')[1];
      break;
    }

    // ── Math (ternary) ───────────────────────────────────
    case 'math.lerp':
    case 'math.clamp':
    case 'math.smoothstep': {
      base.inputs.push({ id: `${id}.a`, name: 'a', type: 'float', direction: 'in', defaultValue: 0 });
      base.inputs.push({ id: `${id}.b`, name: 'b', type: 'float', direction: 'in', defaultValue: 1 });
      base.inputs.push({ id: `${id}.t`, name: 't', type: 'float', direction: 'in', defaultValue: 0.5 });
      base.outputs.push({ id: `${id}.r`, name: 'result', type: 'float', direction: 'out' });
      base.name = kind.split('.')[1];
      break;
    }

    // ── Math (unary) ─────────────────────────────────────
    case 'math.saturate':
    case 'math.pow':
    case 'math.sin':
    case 'math.cos':
    case 'math.abs':
    case 'math.negate':
    case 'math.sqrt':
    case 'math.length':
    case 'math.normalize':
    case 'math.fract':
    case 'math.floor':
    case 'math.ceil':
    case 'math.oneminus': {
      base.inputs.push({ id: `${id}.x`, name: 'x', type: 'float', direction: 'in', defaultValue: 0 });
      base.outputs.push({ id: `${id}.r`, name: 'result', type: 'float', direction: 'out' });
      base.name = kind.split('.')[1];
      // pow 需要第二个参数(指数)
      if (kind === 'math.pow') {
        base.inputs.push({ id: `${id}.e`, name: 'exp', type: 'float', direction: 'in', defaultValue: 2 });
      }
      break;
    }

    // ── Math (vec3 binary) ───────────────────────────────
    case 'math.cross':
    case 'math.dot':
    case 'math.reflect': {
      base.inputs.push({ id: `${id}.a`, name: 'a', type: 'vec3', direction: 'in', defaultValue: [0, 0, 0] });
      base.inputs.push({ id: `${id}.b`, name: 'b', type: 'vec3', direction: 'in', defaultValue: [0, 0, 0] });
      base.outputs.push({
        id: `${id}.r`,
        name: 'result',
        type: kind === 'math.dot' ? 'float' : 'vec3',
        direction: 'out',
      });
      base.name = kind.split('.')[1];
      break;
    }

    case 'math.refract': {
      base.inputs.push({ id: `${id}.i`, name: 'I', type: 'vec3', direction: 'in', defaultValue: [0, 0, 1] });
      base.inputs.push({ id: `${id}.n`, name: 'N', type: 'vec3', direction: 'in', defaultValue: [0, 0, 1] });
      base.inputs.push({ id: `${id}.eta`, name: 'eta', type: 'float', direction: 'in', defaultValue: 1.0 });
      base.outputs.push({ id: `${id}.r`, name: 'result', type: 'vec3', direction: 'out' });
      base.name = 'refract';
      break;
    }

    case 'math.fresnel': {
      base.inputs.push({ id: `${id}.n`, name: 'normal', type: 'vec3', direction: 'in', defaultValue: [0, 1, 0] });
      base.inputs.push({ id: `${id}.v`, name: 'viewDir', type: 'vec3', direction: 'in', defaultValue: [0, 0, 1] });
      base.inputs.push({ id: `${id}.p`, name: 'power', type: 'float', direction: 'in', defaultValue: 5.0 });
      base.outputs.push({ id: `${id}.r`, name: 'result', type: 'float', direction: 'out' });
      base.name = 'fresnel';
      break;
    }

    // ── Channel ──────────────────────────────────────────
    case 'channel.split': {
      base.inputs.push({ id: `${id}.v`, name: 'v', type: 'vec4', direction: 'in', defaultValue: [0, 0, 0, 0] });
      base.outputs.push({ id: `${id}.r`, name: 'r', type: 'float', direction: 'out' });
      base.outputs.push({ id: `${id}.g`, name: 'g', type: 'float', direction: 'out' });
      base.outputs.push({ id: `${id}.b`, name: 'b', type: 'float', direction: 'out' });
      base.outputs.push({ id: `${id}.a`, name: 'a', type: 'float', direction: 'out' });
      base.name = 'Split';
      break;
    }
    case 'channel.combine': {
      base.inputs.push({ id: `${id}.r`, name: 'r', type: 'float', direction: 'in', defaultValue: 0 });
      base.inputs.push({ id: `${id}.g`, name: 'g', type: 'float', direction: 'in', defaultValue: 0 });
      base.inputs.push({ id: `${id}.b`, name: 'b', type: 'float', direction: 'in', defaultValue: 0 });
      base.inputs.push({ id: `${id}.a`, name: 'a', type: 'float', direction: 'in', defaultValue: 1 });
      base.outputs.push({ id: `${id}.v`, name: 'v', type: 'vec4', direction: 'out' });
      base.name = 'Combine';
      break;
    }
    case 'channel.swizzle': {
      base.inputs.push({ id: `${id}.v`, name: 'v', type: 'vec4', direction: 'in', defaultValue: [0, 0, 0, 0] });
      base.outputs.push({ id: `${id}.r`, name: 'result', type: 'vec4', direction: 'out' });
      base.params.swizzle = 'rgba';
      base.name = 'Swizzle';
      break;
    }

    // ── Noise ────────────────────────────────────────────
    case 'noise.simplex':
    case 'noise.value':
    case 'noise.voronoi':
    case 'noise.cellular': {
      base.inputs.push({ id: `${id}.uv`, name: 'uv', type: 'vec2', direction: 'in', defaultValue: [0, 0] });
      base.inputs.push({ id: `${id}.scale`, name: 'scale', type: 'float', direction: 'in', defaultValue: 4.0 });
      base.outputs.push({ id: `${id}.r`, name: 'result', type: 'float', direction: 'out' });
      if (kind === 'noise.voronoi' || kind === 'noise.cellular') {
        base.outputs.push({ id: `${id}.cell`, name: 'cellId', type: 'vec2', direction: 'out' });
      }
      base.name = kind.split('.')[1];
      break;
    }

    // ── Curve ────────────────────────────────────────────
    case 'curve.ramp': {
      base.inputs.push({ id: `${id}.t`, name: 't', type: 'float', direction: 'in', defaultValue: 0.5 });
      base.outputs.push({ id: `${id}.r`, name: 'color', type: 'color', direction: 'out' });
      // params.stops: [[t, [r,g,b,a]], ...]
      base.params.stops = [
        [0, [0, 0, 0, 1]],
        [1, [1, 1, 1, 1]],
      ];
      base.name = 'Ramp';
      break;
    }

    // ── Output ───────────────────────────────────────────
    case 'output.surface': {
      base.inputs.push({ id: `${id}.baseColor`, name: 'baseColor', type: 'color', direction: 'in', defaultValue: [1, 1, 1, 1] });
      base.inputs.push({ id: `${id}.metallic`, name: 'metallic', type: 'float', direction: 'in', defaultValue: 0 });
      base.inputs.push({ id: `${id}.roughness`, name: 'roughness', type: 'float', direction: 'in', defaultValue: 1 });
      base.inputs.push({ id: `${id}.normal`, name: 'normal', type: 'vec3', direction: 'in', defaultValue: [0, 0, 1] });
      base.inputs.push({ id: `${id}.emissive`, name: 'emissive', type: 'color', direction: 'in', defaultValue: [0, 0, 0, 1] });
      base.inputs.push({ id: `${id}.opacity`, name: 'opacity', type: 'float', direction: 'in', defaultValue: 1 });
      base.inputs.push({ id: `${id}.ao`, name: 'ao', type: 'float', direction: 'in', defaultValue: 1 });
      base.inputs.push({ id: `${id}.alphaClip`, name: 'alphaClip', type: 'float', direction: 'in', defaultValue: 0 });
      base.name = 'SurfaceOutput';
      break;
    }
    case 'output.unlit': {
      base.inputs.push({ id: `${id}.color`, name: 'color', type: 'color', direction: 'in', defaultValue: [1, 1, 1, 1] });
      base.inputs.push({ id: `${id}.opacity`, name: 'opacity', type: 'float', direction: 'in', defaultValue: 1 });
      base.name = 'UnlitOutput';
      break;
    }

    default: {
      const _exhaustive: never = kind;
      throw new Error(`MaterialGraph: unknown node kind ${_exhaustive}`);
    }
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────
// 类型兼容性检查
// ─────────────────────────────────────────────────────────────────────

function glslType(t: SocketType): string {
  switch (t) {
    case 'float': return 'float';
    case 'vec2': return 'vec2';
    case 'vec3': return 'vec3';
    case 'vec4': return 'vec4';
    case 'color': return 'vec4';
    case 'bool': return 'bool';
    case 'int': return 'int';
  }
}

/** 类型可连接性(参考 UE / Unity ShaderGraph 的隐式转换规则)。 */
function canConnect(from: SocketType, to: SocketType): boolean {
  if (from === to) return true;
  // color 与 vec4 等价
  if ((from === 'color' && to === 'vec4') || (from === 'vec4' && to === 'color')) return true;
  // float 可广播到任意 vecN / color
  if (from === 'float' && (to === 'vec2' || to === 'vec3' || to === 'vec4' || to === 'color')) return true;
  // int 可隐式转 float,进而可转 vecN
  if (from === 'int') return true;
  // vecN → vecM (N < M):补 0 / 1 扩展(vec2→vec3 补 0;vec3→vec4 补 1)
  if (from === 'vec2' && (to === 'vec3' || to === 'vec4' || to === 'color')) return true;
  if (from === 'vec3' && (to === 'vec4' || to === 'color')) return true;
  // vecN → float:取 .x(降维)— 通常不允许,因为信息丢失。
  // 但 UE Material Editor 允许,这里也允许以提升易用性。
  if ((from === 'vec2' || from === 'vec3' || from === 'vec4' || from === 'color') && to === 'float') return true;
  return false;
}

/** 生成把 from 类型值强制转换为 to 类型值的 GLSL 表达式。 */
function castExpr(expr: string, from: SocketType, to: SocketType): string {
  if (from === to) return expr;
  if (from === 'color' && to === 'vec4') return expr;
  if (from === 'vec4' && to === 'color') return expr;
  if (from === 'int' && to === 'float') return `float(${expr})`;
  if (from === 'int' && to === 'vec2') return `vec2(float(${expr}))`;
  if (from === 'int' && to === 'vec3') return `vec3(float(${expr}))`;
  if (from === 'int' && (to === 'vec4' || to === 'color')) return `vec4(float(${expr}))`;
  // float → vecN 广播
  if (from === 'float') {
    if (to === 'vec2') return `vec2(${expr})`;
    if (to === 'vec3') return `vec3(${expr})`;
    if (to === 'vec4' || to === 'color') return `vec4(${expr})`;
  }
  // vec2 → vec3 / vec4
  if (from === 'vec2') {
    if (to === 'vec3') return `vec3(${expr}, 0.0)`;
    if (to === 'vec4' || to === 'color') return `vec4(${expr}, 0.0, 1.0)`;
    if (to === 'float') return `(${expr}).x`;
  }
  // vec3 → vec4 / color
  if (from === 'vec3') {
    if (to === 'vec4' || to === 'color') return `vec4(${expr}, 1.0)`;
    if (to === 'float') return `(${expr}).x`;
  }
  // vec4 / color → float
  if ((from === 'vec4' || from === 'color') && to === 'float') {
    return `(${expr}).x`;
  }
  return expr;
}

// ─────────────────────────────────────────────────────────────────────
// 编译结果
// ─────────────────────────────────────────────────────────────────────

export interface CompileResult {
  vertexSrc: string;
  fragmentSrc: string;
  uniforms: Record<string, UniformValue>;
  defines: string[];
  /** 生成的中间变量数(调试用)。 */
  stats: {
    nodes: number;
    edges: number;
    variables: number;
    textures: number;
  };
  /** 编译警告。 */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────
// MaterialGraph 类
// ─────────────────────────────────────────────────────────────────────

/**
 * 节点式材质图。
 *
 * 用法:
 *   const g = new MaterialGraph();
 *   const uv = g.addNode('input.uv');
 *   const tex = g.addNode('texture.sample');
 *   const out = g.addNode('output.surface');
 *   g.connect(uv, 'uv', tex, 'uv');
 *   g.connect(tex, 'rgb', out, 'baseColor');
 *   const mat = g.compile();  // → ShaderMaterial
 */
export class MaterialGraph {
  nodes: MaterialNode[] = [];
  edges: MaterialEdge[] = [];
  /** uniform 命名空间前缀(避免多图共享 uniform 名冲突)。 */
  namespace: string = 'mg';

  private _nodeIdCounter = 0;
  private _edgeIdCounter = 0;

  /** 添加节点,返回节点 id。 */
  addNode(kind: NodeKind, id?: string): string {
    const nid = id ?? `n${this._nodeIdCounter++}`;
    if (this.nodes.find((n) => n.id === nid)) {
      throw new Error(`MaterialGraph: duplicate node id ${nid}`);
    }
    this.nodes.push(createNode(kind, nid));
    return nid;
  }

  /** 删除节点(同时删除其所有连接)。 */
  removeNode(id: string): void {
    this.nodes = this.nodes.filter((n) => n.id !== id);
    this.edges = this.edges.filter((e) => e.fromNode !== id && e.toNode !== id);
  }

  /** 获取节点。 */
  getNode(id: string): MaterialNode | undefined {
    return this.nodes.find((n) => n.id === id);
  }

  /** 连接两个节点。返回边 id;类型不兼容抛错。 */
  connect(
    fromNode: string,
    fromSocket: string,
    toNode: string,
    toSocket: string,
  ): string {
    const fn = this.getNode(fromNode);
    const tn = this.getNode(toNode);
    if (!fn) throw new Error(`MaterialGraph: fromNode ${fromNode} not found`);
    if (!tn) throw new Error(`MaterialGraph: toNode ${toNode} not found`);
    const fs = fn.outputs.find((s) => s.id === fromSocket || s.name === fromSocket);
    const ts = tn.inputs.find((s) => s.id === toSocket || s.name === toSocket);
    if (!fs) throw new Error(`MaterialGraph: output socket ${fromSocket} not found on ${fromNode}`);
    if (!ts) throw new Error(`MaterialGraph: input socket ${toSocket} not found on ${toNode}`);
    if (!canConnect(fs.type, ts.type)) {
      throw new Error(`MaterialGraph: type mismatch ${fs.type} → ${ts.type}`);
    }
    // 移除目标输入端口上已有的连接(每个输入只能连一条)
    this.edges = this.edges.filter((e) => !(e.toNode === toNode && e.toSocket === ts.id));
    const eid = `e${this._edgeIdCounter++}`;
    this.edges.push({
      id: eid,
      fromNode,
      fromSocket: fs.id,
      toNode,
      toSocket: ts.id,
    });
    return eid;
  }

  /** 断开连接。 */
  disconnect(edgeId: string): void {
    this.edges = this.edges.filter((e) => e.id !== edgeId);
  }

  /** 设置节点参数。 */
  setParam(nodeId: string, key: string, value: ParamValue): void {
    const n = this.getNode(nodeId);
    if (!n) throw new Error(`MaterialGraph: node ${nodeId} not found`);
    n.params[key] = value;
  }

  /** 查找指向某输入端口的边。 */
  private _findIncomingEdge(nodeId: string, socketId: string): MaterialEdge | undefined {
    return this.edges.find((e) => e.toNode === nodeId && e.toSocket === socketId);
  }

  /**
   * 拓扑排序:从 output 节点反向 DFS,返回按依赖顺序的节点列表
   * (上游在前,output 在后)。使用 post-order DFS 保证正确顺序。
   */
  private _topoSort(): MaterialNode[] {
    const outputNodes = this.nodes.filter((n) => n.kind === 'output.surface' || n.kind === 'output.unlit');
    if (outputNodes.length === 0) {
      throw new Error('MaterialGraph: no output node');
    }
    if (outputNodes.length > 1) {
      throw new Error(`MaterialGraph: expected exactly one output node, got ${outputNodes.length}`);
    }

    const visited = new Set<string>();
    const sorted: MaterialNode[] = [];
    const stack: { node: MaterialNode; expanded: boolean }[] = [
      { node: outputNodes[0], expanded: false },
    ];

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.expanded) {
        // 所有上游已处理完毕,可以加入结果
        stack.pop();
        if (!visited.has(top.node.id)) {
          visited.add(top.node.id);
          sorted.push(top.node);
        }
        continue;
      }
      top.expanded = true;
      if (visited.has(top.node.id)) continue;
      // 把所有上游节点压栈(尚未访问的)
      for (const e of this.edges) {
        if (e.toNode === top.node.id) {
          const src = this.getNode(e.fromNode);
          if (src && !visited.has(src.id)) {
            stack.push({ node: src, expanded: false });
          }
        }
      }
    }

    return sorted; // 已是 post-order:依赖在前,output 在后
  }

  /** 编译图为 GLSL,返回结果对象。 */
  compile(): CompileResult {
    const sorted = this._topoSort();
    const warnings: string[] = [];

    // 收集 uniforms / textures / 中间变量
    const uniforms = new Map<string, UniformValue>();
    const textureSlots: { uniformName: string; texture: Texture | null; slot: number }[] = [];
    const defines: string[] = [];
    const varLines: string[] = [];
    const exprCache = new Map<string, string>(); // socketId → GLSL expr
    let varCounter = 0;
    let texCounter = 0;

    const freshVar = (): string => `v${varCounter++}`;

    // 为每个节点生成表达式
    for (const node of sorted) {
      const outVar = freshVar();

      // 解析输入端口表达式(连接或默认值)
      const inExpr = (socketName: string, fallbackType?: SocketType): { expr: string; type: SocketType } => {
        const socket = node.inputs.find((s) => s.name === socketName);
        if (!socket) throw new Error(`socket ${socketName} not found on ${node.id}`);
        const edge = this._findIncomingEdge(node.id, socket.id);
        if (edge) {
          const cached = exprCache.get(edge.fromSocket);
          if (cached !== undefined) {
            const fromNode = this.getNode(edge.fromNode)!;
            const fromSocket = fromNode.outputs.find((s) => s.id === edge.fromSocket)!;
            return { expr: castExpr(cached, fromSocket.type, socket.type), type: socket.type };
          }
          throw new Error(`upstream expr missing for ${edge.fromSocket}`);
        }
        // 默认值
        const dv = socket.defaultValue;
        const t = fallbackType ?? socket.type;
        if (dv === undefined) {
          if (t === 'float') return { expr: '0.0', type: t };
          if (t === 'vec2') return { expr: 'vec2(0.0)', type: t };
          if (t === 'vec3') return { expr: 'vec3(0.0)', type: t };
          if (t === 'vec4' || t === 'color') return { expr: 'vec4(0.0)', type: t };
          return { expr: '0.0', type: t };
        }
        if (typeof dv === 'number') return { expr: `${dv.toFixed(8)}`, type: 'float' };
        return { expr: `${glslType(t)}(${dv.map((x) => x.toFixed(8)).join(', ')})`, type: t };
      };

      // 按节点 kind 生成表达式
      switch (node.kind) {
        case 'input.uv':
          varLines.push(`  vec2 ${outVar} = v_uv;`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        case 'input.position':
          varLines.push(`  vec3 ${outVar} = v_viewPos;`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        case 'input.normal':
          varLines.push(`  vec3 ${outVar} = v_normal;`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        case 'input.tangent':
          varLines.push(`  vec3 ${outVar} = v_tangent;`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        case 'input.time': {
          const uname = `u_${this.namespace}_time`;
          uniforms.set(uname, 0);
          varLines.push(`  float ${outVar} = ${uname};`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }
        case 'input.screenUV':
          varLines.push(`  vec2 ${outVar} = gl_FragCoord.xy / u_resolution;`);
          exprCache.set(node.outputs[0].id, outVar);
          defines.push('USE_RESOLUTION');
          break;
        case 'input.viewDir':
          varLines.push(`  vec3 ${outVar} = normalize(-v_viewPos);`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        case 'input.worldPos':
          varLines.push(`  vec3 ${outVar} = v_worldPos;`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        case 'input.vertexColor':
          varLines.push(`  vec4 ${outVar} = v_color;`);
          exprCache.set(node.outputs[0].id, outVar);
          break;

        case 'constant.float': {
          const v = node.params.value as number;
          varLines.push(`  float ${outVar} = ${v.toFixed(8)};`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }
        case 'constant.vec2':
        case 'constant.vec3':
        case 'constant.vec4':
        case 'constant.color': {
          const v = node.params.value as number[];
          const t = node.outputs[0].type;
          varLines.push(`  ${glslType(t)} ${outVar} = ${glslType(t)}(${v.map((x) => x.toFixed(8)).join(', ')});`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        case 'texture.sample': {
          const tex = node.params.texture as Texture | undefined;
          const slotIdx = texCounter;
          const uname = `u_${this.namespace}_tex${slotIdx}`;
          textureSlots.push({ uniformName: uname, texture: tex ?? null, slot: slotIdx });
          // 只在用户提供 texture 时写入 uniforms(避免把 number 当 Texture),
          // 用户后续可通过 material.uniforms[uname] = myTexture 设置。
          if (tex) uniforms.set(uname, tex);
          texCounter++;
          const uv = inExpr('uv', 'vec2');
          varLines.push(`  vec4 ${outVar} = texture(${uname}, ${uv.expr});`);
          // rgb / r / g / b / a / rgba
          exprCache.set(node.outputs[0].id, `${outVar}.rgb`); // rgb
          exprCache.set(node.outputs[1].id, `${outVar}.r`);   // r
          exprCache.set(node.outputs[2].id, `${outVar}.g`);   // g
          exprCache.set(node.outputs[3].id, `${outVar}.b`);   // b
          exprCache.set(node.outputs[4].id, `${outVar}.a`);   // a
          exprCache.set(node.outputs[5].id, outVar);          // rgba
          break;
        }

        // 二元数学
        case 'math.add':
        case 'math.sub':
        case 'math.mul':
        case 'math.div':
        case 'math.min':
        case 'math.max':
        case 'math.step':
        case 'math.distance': {
          const a = inExpr('a');
          const b = inExpr('b');
          const op = ({
            'math.add': '+',
            'math.sub': '-',
            'math.mul': '*',
            'math.div': '/',
            'math.min': 'min',
            'math.max': 'max',
            'math.step': 'step',
            'math.distance': 'distance',
          } as const)[node.kind];
          if (op === '+' || op === '-' || op === '*' || op === '/') {
            varLines.push(`  float ${outVar} = ${a.expr} ${op} ${b.expr};`);
          } else {
            varLines.push(`  float ${outVar} = ${op}(${a.expr}, ${b.expr});`);
          }
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        // 三元数学
        case 'math.lerp':
        case 'math.clamp':
        case 'math.smoothstep': {
          const a = inExpr('a');
          const b = inExpr('b');
          const t = inExpr('t');
          const op = ({
            'math.lerp': 'mix',
            'math.clamp': 'clamp',
            'math.smoothstep': 'smoothstep',
          } as const)[node.kind];
          varLines.push(`  float ${outVar} = ${op}(${a.expr}, ${b.expr}, ${t.expr});`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        // 一元数学
        case 'math.saturate':
        case 'math.pow':
        case 'math.sin':
        case 'math.cos':
        case 'math.abs':
        case 'math.negate':
        case 'math.sqrt':
        case 'math.length':
        case 'math.normalize':
        case 'math.fract':
        case 'math.floor':
        case 'math.ceil':
        case 'math.oneminus': {
          const x = inExpr('x');
          const op = ({
            'math.saturate': 'clamp',
            'math.pow': 'pow',
            'math.sin': 'sin',
            'math.cos': 'cos',
            'math.abs': 'abs',
            'math.negate': 'neg',
            'math.sqrt': 'sqrt',
            'math.length': 'length',
            'math.normalize': 'normalize',
            'math.fract': 'fract',
            'math.floor': 'floor',
            'math.ceil': 'ceil',
            'math.oneminus': 'oneminus',
          } as const)[node.kind];
          if (op === 'clamp') {
            varLines.push(`  float ${outVar} = clamp(${x.expr}, 0.0, 1.0);`);
          } else if (op === 'neg') {
            varLines.push(`  float ${outVar} = -${x.expr};`);
          } else if (op === 'oneminus') {
            varLines.push(`  float ${outVar} = 1.0 - ${x.expr};`);
          } else if (node.kind === 'math.pow') {
            const e = inExpr('exp');
            varLines.push(`  float ${outVar} = pow(${x.expr}, ${e.expr});`);
          } else {
            varLines.push(`  float ${outVar} = ${op}(${x.expr});`);
          }
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        case 'math.cross':
        case 'math.dot':
        case 'math.reflect': {
          const a = inExpr('a', 'vec3');
          const b = inExpr('b', 'vec3');
          const op = ({
            'math.cross': 'cross',
            'math.dot': 'dot',
            'math.reflect': 'reflect',
          } as const)[node.kind];
          const rt = node.outputs[0].type;
          varLines.push(`  ${glslType(rt)} ${outVar} = ${op}(${a.expr}, ${b.expr});`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        case 'math.refract': {
          const I = inExpr('I', 'vec3');
          const N = inExpr('N', 'vec3');
          const eta = inExpr('eta');
          varLines.push(`  vec3 ${outVar} = refract(${I.expr}, ${N.expr}, ${eta.expr});`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        case 'math.fresnel': {
          const N = inExpr('normal', 'vec3');
          const V = inExpr('viewDir', 'vec3');
          const p = inExpr('power');
          varLines.push(`  float ${outVar} = pow(1.0 - max(dot(normalize(${N.expr}), normalize(${V.expr})), 0.0), ${p.expr});`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        case 'channel.split': {
          const v = inExpr('v', 'vec4');
          varLines.push(`  vec4 ${outVar} = ${v.expr};`);
          exprCache.set(node.outputs[0].id, `${outVar}.r`);
          exprCache.set(node.outputs[1].id, `${outVar}.g`);
          exprCache.set(node.outputs[2].id, `${outVar}.b`);
          exprCache.set(node.outputs[3].id, `${outVar}.a`);
          break;
        }
        case 'channel.combine': {
          const r = inExpr('r');
          const g = inExpr('g');
          const b = inExpr('b');
          const a = inExpr('a');
          varLines.push(`  vec4 ${outVar} = vec4(${r.expr}, ${g.expr}, ${b.expr}, ${a.expr});`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }
        case 'channel.swizzle': {
          const v = inExpr('v', 'vec4');
          const sw = (node.params.swizzle as string) || 'rgba';
          // 校验 swizzle 合法性
          if (!/^[rgbaxyzw]{1,4}$/.test(sw)) {
            throw new Error(`MaterialGraph: invalid swizzle '${sw}' on ${node.id}`);
          }
          // 直接构造 vec4 表达式(避免 GLSL 类型不匹配)
          // 用 vec4(scalar) / vec4(vec2, float, float) / vec4(vec3, float) / vec4(vec4) 构造
          const inner = `${v.expr}.${sw}`;
          let constructor: string;
          if (sw.length === 1) constructor = `vec4(${inner})`;
          else if (sw.length === 2) constructor = `vec4(${inner}, 0.0, 1.0)`;
          else if (sw.length === 3) constructor = `vec4(${inner}, 1.0)`;
          else constructor = inner; // 4 components → already vec4
          varLines.push(`  vec4 ${outVar} = ${constructor};`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        case 'noise.simplex': {
          const uv = inExpr('uv', 'vec2');
          const scale = inExpr('scale');
          varLines.push(`  float ${outVar} = vreen_simplex(${uv.expr} * ${scale.expr});`);
          defines.push('USE_NOISE');
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }
        case 'noise.value': {
          const uv = inExpr('uv', 'vec2');
          const scale = inExpr('scale');
          varLines.push(`  float ${outVar} = vreen_valueNoise(${uv.expr} * ${scale.expr});`);
          defines.push('USE_NOISE');
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }
        case 'noise.voronoi':
        case 'noise.cellular': {
          const uv = inExpr('uv', 'vec2');
          const scale = inExpr('scale');
          varLines.push(`  vec2 ${outVar}_cell;`);
          varLines.push(`  float ${outVar} = vreen_voronoi(${uv.expr} * ${scale.expr}, ${outVar}_cell);`);
          defines.push('USE_NOISE');
          exprCache.set(node.outputs[0].id, outVar);
          if (node.outputs.length > 1) {
            exprCache.set(node.outputs[1].id, `${outVar}_cell`);
          }
          break;
        }

        case 'curve.ramp': {
          const t = inExpr('t');
          const stops = (node.params.stops as [number, number[]][]) ?? [[0, [0, 0, 0, 1]], [1, [1, 1, 1, 1]]];
          // 生成一组 mix 链
          let expr = `vec4(${stops[0][1].map((x) => x.toFixed(8)).join(', ')})`;
          for (let i = 1; i < stops.length; i++) {
            const [tStop, color] = stops[i];
            const prevT = stops[i - 1][0];
            const range = Math.max(1e-6, tStop - prevT);
            const col = `vec4(${color.map((x) => x.toFixed(8)).join(', ')})`;
            expr = `mix(${expr}, ${col}, clamp((${t.expr} - ${prevT.toFixed(8)}) / ${range.toFixed(8)}, 0.0, 1.0))`;
          }
          varLines.push(`  vec4 ${outVar} = ${expr};`);
          exprCache.set(node.outputs[0].id, outVar);
          break;
        }

        case 'output.surface':
        case 'output.unlit': {
          // 输出节点不产生中间变量,而是写入输出 struct 字段
          // 实际赋值在 main() 中完成
          break;
        }

        default: {
          const _exhaustive: never = node.kind;
          throw new Error(`MaterialGraph: unhandled node kind ${_exhaustive}`);
        }
      }
    }

    // 收集输出节点的输入表达式,生成最终 main()
    const outNode = sorted.find((n) => n.kind.startsWith('output.'));
    if (!outNode) throw new Error('MaterialGraph: output node missing after topo sort');

    // 辅助:为输出节点的某个输入端口获取表达式(箭头函数捕获 this.edges)
    const edgesRef = this.edges;
    const fallbackDefault = (t: SocketType): string => {
      if (t === 'float') return '0.0';
      if (t === 'vec2') return 'vec2(0.0)';
      if (t === 'vec3') return 'vec3(0.0)';
      return 'vec4(0.0)';
    };
    const inExprForOutput = (n: MaterialNode, socketName: string, fallbackType: SocketType): string => {
      const socket = n.inputs.find((s) => s.name === socketName);
      if (!socket) return fallbackDefault(fallbackType);
      const edge = edgesRef.find((e) => e.toNode === n.id && e.toSocket === socket.id);
      if (edge) {
        const cached = exprCache.get(edge.fromSocket);
        if (cached !== undefined) {
          const fromNode = sorted.find((nn) => nn.id === edge.fromNode)!;
          const fromSocket = fromNode.outputs.find((s) => s.id === edge.fromSocket)!;
          return castExpr(cached, fromSocket.type, socket.type);
        }
      }
      const dv = socket.defaultValue;
      if (dv === undefined) return fallbackDefault(fallbackType);
      if (typeof dv === 'number') return `${dv.toFixed(8)}`;
      return `${glslType(fallbackType)}(${dv.map((x) => x.toFixed(8)).join(', ')})`;
    };

    const fragMain: string[] = [];
    fragMain.push('layout(location = 0) out vec4 out_color;');

    if (outNode.kind === 'output.surface') {
      const baseColor = inExprForOutput(outNode, 'baseColor', 'color');
      const metallic = inExprForOutput(outNode, 'metallic', 'float');
      const roughness = inExprForOutput(outNode, 'roughness', 'float');
      const normal = inExprForOutput(outNode, 'normal', 'vec3');
      const emissive = inExprForOutput(outNode, 'emissive', 'color');
      const opacity = inExprForOutput(outNode, 'opacity', 'float');
      const ao = inExprForOutput(outNode, 'ao', 'float');
      const alphaClip = inExprForOutput(outNode, 'alphaClip', 'float');

      fragMain.push('void main() {');
      for (const line of varLines) fragMain.push(line);
      fragMain.push(`  vec4 _baseColor = ${baseColor};`);
      fragMain.push(`  float _metallic = ${metallic};`);
      fragMain.push(`  float _roughness = ${roughness};`);
      fragMain.push(`  vec3 _normal = normalize(${normal});`);
      fragMain.push(`  vec3 _emissive = (${emissive}).rgb;`);
      fragMain.push(`  float _opacity = ${opacity};`);
      fragMain.push(`  float _ao = ${ao};`);
      fragMain.push(`  float _alphaClip = ${alphaClip};`);
      // 简化 PBR 输出:把 PBR 字段塞进 out_color + 通过自定义 define 由 renderer 处理
      // 这里采用直接输出 baseColor * opacity 的简化策略,
      // 实际 PBR 计算应由 renderer 在调用前用 onBeforeCompile 注入。
      fragMain.push('  if (_alphaClip > 0.0 && _baseColor.a < _alphaClip) discard;');
      fragMain.push('  out_color = vec4(_baseColor.rgb * _ao + _emissive, _opacity);');
      fragMain.push('  // PBR meta: real renderer uses defines USE_GRAPH_PBR + reads uniforms');
      fragMain.push('}');
      defines.push('USE_GRAPH_PBR');
    } else {
      // output.unlit
      const color = inExprForOutput(outNode, 'color', 'color');
      const opacity = inExprForOutput(outNode, 'opacity', 'float');
      fragMain.push('void main() {');
      for (const line of varLines) fragMain.push(line);
      fragMain.push(`  vec4 _c = ${color};`);
      fragMain.push(`  out_color = vec4(_c.rgb, _c.a * (${opacity}));`);
      fragMain.push('}');
    }

    // ── 顶点着色器(标准)─────────────────────────────────
    const vertexSrc = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_uv;
layout(location = 2) in vec3 a_normal;
layout(location = 3) in vec3 a_tangent;
layout(location = 4) in vec4 a_color;
uniform mat4 u_proj;
uniform mat4 u_view;
uniform mat4 u_model;
uniform vec2 u_resolution; // 仅 USE_RESOLUTION 时使用
out vec2 v_uv;
out vec3 v_normal;
out vec3 v_viewPos;
out vec3 v_worldPos;
out vec3 v_tangent;
out vec4 v_color;
void main() {
  v_uv = a_uv;
  v_normal = mat3(u_model) * a_normal;
  v_tangent = mat3(u_model) * a_tangent;
  v_color = a_color;
  vec4 world = u_model * vec4(a_position, 1.0);
  v_worldPos = world.xyz;
  vec4 view = u_view * world;
  v_viewPos = view.xyz;
  gl_Position = u_proj * view;
}
`;

    // ── 片段着色器 ────────────────────────────────────────
    const fragUniforms: string[] = [
      'precision highp float;',
      'in vec2 v_uv;',
      'in vec3 v_normal;',
      'in vec3 v_viewPos;',
      'in vec3 v_worldPos;',
      'in vec3 v_tangent;',
      'in vec4 v_color;',
      'uniform vec2 u_resolution;',
    ];
    // 添加图生成的 uniforms
    // 用 textureSlots 来精确判断哪些 uniform 是 sampler2D,避免名字匹配的脆弱性。
    // 注意:sampler uniform 必须始终声明(即使未提供 texture 值),
    // 否则 GLSL 编译会因 texture() 调用引用未声明标识符而失败。
    const samplerNames = new Set(textureSlots.map((s) => s.uniformName));
    for (const sname of samplerNames) {
      fragUniforms.push(`uniform sampler2D ${sname};`);
    }
    for (const [name, _val] of uniforms) {
      if (samplerNames.has(name)) continue; // 已声明
      fragUniforms.push(`uniform float ${name};`);
    }

    // 噪声函数(如果使用)
    let noiseSrc = '';
    if (defines.includes('USE_NOISE')) {
      noiseSrc = NOISE_GLSL;
    }

    const fragmentSrc = `#version 300 es
${fragUniforms.join('\n')}
${noiseSrc}
${fragMain.join('\n')}
`;

    log.debug(`compiled graph: ${sorted.length} nodes, ${this.edges.length} edges, ${varCounter} vars, ${texCounter} textures`);

    return {
      vertexSrc,
      fragmentSrc,
      uniforms: Object.fromEntries(uniforms),
      defines,
      stats: {
        nodes: sorted.length,
        edges: this.edges.length,
        variables: varCounter,
        textures: texCounter,
      },
      warnings,
    };
  }

  /** 编译并创建 ShaderMaterial。 */
  createMaterial(): ShaderMaterial {
    const r = this.compile();
    return new ShaderMaterial({
      vertexSrc: r.vertexSrc,
      fragmentSrc: r.fragmentSrc,
      uniforms: r.uniforms,
      defines: r.defines,
    });
  }

  /** 序列化图(可 JSON.stringify)。 */
  toJSON(): unknown {
    return {
      version: 1,
      namespace: this.namespace,
      nodes: this.nodes.map((n) => ({
        id: n.id,
        kind: n.kind,
        name: n.name,
        position: n.position,
        // params 中 Texture 不可序列化,过滤
        params: Object.fromEntries(
          Object.entries(n.params).filter(([, v]) => typeof v !== 'object' || Array.isArray(v) || v === null),
        ),
      })),
      edges: this.edges.map((e) => ({
        id: e.id,
        fromNode: e.fromNode,
        fromSocket: e.fromSocket,
        toNode: e.toNode,
        toSocket: e.toSocket,
      })),
    };
  }

  /** 从 JSON 反序列化。 */
  static fromJSON(json: unknown): MaterialGraph {
    const g = new MaterialGraph();
    const data = json as {
      version: number;
      namespace: string;
      nodes: { id: string; kind: NodeKind; name: string; position?: { x: number; y: number }; params: Record<string, unknown> }[];
      edges: { id: string; fromNode: string; fromSocket: string; toNode: string; toSocket: string }[];
    };
    if (data.version !== 1) {
      throw new Error(`MaterialGraph: unsupported version ${data.version}`);
    }
    g.namespace = data.namespace ?? 'mg';
    for (const n of data.nodes) {
      const node = createNode(n.kind, n.id);
      node.name = n.name;
      node.position = n.position;
      // 合并保存的 params
      for (const [k, v] of Object.entries(n.params)) {
        node.params[k] = v as number | string | number[] | boolean | Texture;
      }
      g.nodes.push(node);
    }
    for (const e of data.edges) {
      g.edges.push({ ...e });
    }
    // 重建计数器避免 id 冲突
    const maxN = g.nodes.reduce((m, n) => {
      const num = parseInt(n.id.replace(/^n/, ''), 10);
      return Number.isFinite(num) ? Math.max(m, num) : m;
    }, 0);
    g._nodeIdCounter = maxN + 1;
    const maxE = g.edges.reduce((m, e) => {
      const num = parseInt(e.id.replace(/^e/, ''), 10);
      return Number.isFinite(num) ? Math.max(m, num) : m;
    }, 0);
    g._edgeIdCounter = maxE + 1;
    return g;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 内置噪声 GLSL(参考 o3de / shadertoy 经典实现)
// ─────────────────────────────────────────────────────────────────────

const NOISE_GLSL = `
// VREEN MaterialGraph built-in noise functions.
float vreen_hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float vreen_valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = vreen_hash(i);
  float b = vreen_hash(i + vec2(1.0, 0.0));
  float c = vreen_hash(i + vec2(0.0, 1.0));
  float d = vreen_hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
vec3 vreen_hash3(vec2 p) {
  return fract(sin(vec3(
    dot(p, vec2(127.1, 311.7)),
    dot(p, vec2(269.5, 183.3)),
    dot(p, vec2(419.2, 371.9))
  )) * 43758.5453);
}
float vreen_simplex(vec2 p) {
  // 简化版:用 valueNoise * 2 - 1 模拟近似 simplex
  return vreen_valueNoise(p) * 2.0 - 1.0;
}
float vreen_voronoi(vec2 p, out vec2 cellId) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float minDist = 8.0;
  cellId = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = vreen_hash3(i + g).xy;
      o = 0.5 + 0.5 * sin(6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < minDist) {
        minDist = d;
        cellId = i + g;
      }
    }
  }
  return sqrt(minDist);
}
`;

// ─────────────────────────────────────────────────────────────────────
// 内置图预设(便于快速创建常见材质)
// ─────────────────────────────────────────────────────────────────────

/** 预设:简单的纹理 + 颜色调制 PBR 材质。 */
export function createTexturedPBRGraph(opts: {
  baseColor?: number[];
  metallic?: number;
  roughness?: number;
} = {}): MaterialGraph {
  const g = new MaterialGraph();
  const uv = g.addNode('input.uv');
  const tex = g.addNode('texture.sample');
  const baseColor = g.addNode('constant.color');
  const metallic = g.addNode('constant.float');
  const roughness = g.addNode('constant.float');
  const out = g.addNode('output.surface');

  g.setParam(baseColor, 'value', opts.baseColor ?? [1, 1, 1, 1]);
  g.setParam(metallic, 'value', opts.metallic ?? 0);
  g.setParam(roughness, 'value', opts.roughness ?? 1);

  // 简化:直接用 texture.rgb 作为 baseColor(math.mul 节点当前仅支持 float)
  g.connect(uv, 'uv', tex, 'uv');
  g.connect(tex, 'rgb', out, 'baseColor');
  g.connect(metallic, 'value', out, 'metallic');
  g.connect(roughness, 'value', out, 'roughness');
  return g;
}

/** 预设:Fresnel 边缘发光材质。 */
export function createFresnelGraph(opts: {
  baseColor?: number[];
  edgeColor?: number[];
  power?: number;
} = {}): MaterialGraph {
  const g = new MaterialGraph();
  const n = g.addNode('input.normal');
  const v = g.addNode('input.viewDir');
  const fresnel = g.addNode('math.fresnel');
  const baseColor = g.addNode('constant.color');
  const edgeColor = g.addNode('constant.color');
  const p = g.addNode('constant.float');
  const out = g.addNode('output.unlit');

  g.setParam(baseColor, 'value', opts.baseColor ?? [0, 0, 0, 1]);
  g.setParam(edgeColor, 'value', opts.edgeColor ?? [0, 1, 1, 1]);
  g.setParam(p, 'value', opts.power ?? 3);

  g.connect(n, 'normal', fresnel, 'normal');
  g.connect(v, 'viewDir', fresnel, 'viewDir');
  g.connect(p, 'value', fresnel, 'power');
  g.connect(edgeColor, 'color', out, 'color');
  g.connect(fresnel, 'result', out, 'opacity');
  return g;
}

/** 预设:程序化噪声 + 颜色映射的抽象材质。 */
export function createNoiseGraph(opts: {
  scale?: number;
  colorA?: number[];
  colorB?: number[];
} = {}): MaterialGraph {
  const g = new MaterialGraph();
  const uv = g.addNode('input.uv');
  const scale = g.addNode('constant.float');
  const noise = g.addNode('noise.simplex');
  const saturate = g.addNode('math.saturate');
  const colorA = g.addNode('constant.color');
  const colorB = g.addNode('constant.color');
  const out = g.addNode('output.unlit');

  g.setParam(scale, 'value', opts.scale ?? 4);
  g.setParam(colorA, 'value', opts.colorA ?? [0, 0, 0, 1]);
  g.setParam(colorB, 'value', opts.colorB ?? [1, 1, 1, 1]);

  // 把 simplex 输出 [-1,1] 限制到 [0,1]
  g.connect(uv, 'uv', noise, 'uv');
  g.connect(scale, 'value', noise, 'scale');
  g.connect(noise, 'result', saturate, 'x');
  // 简化:math.lerp 当前仅支持 float,无法直接混合 color,故把 saturate 接到 opacity,color 设 colorA
  g.connect(colorA, 'color', out, 'color');
  g.connect(saturate, 'result', out, 'opacity');
  return g;
}
