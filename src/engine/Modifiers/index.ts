// Modifiers barrel — 几何体修饰器 (细分 / 简化 / 边分裂 / 曲面细分)。
// 各修饰器从 three.js examples/jsm/modifiers 移植并适配 VREEN 引擎。

export { TessellateModifier, type TessellateOptions } from './TessellateModifier';
export { SimplifyModifier, type SimplifyOptions } from './SimplifyModifier';
// Catmull-Clark 细分曲面 — 平滑网格,适配 three.js SubdivisionModifier + o3de Atom。
// face point + edge point + vertex point 规则,边界规则保留锐边,UV 插值。
export { SubdivisionModifier, type SubdivisionOptions } from './SubdivisionModifier';
// 边分裂 — 在硬边处复制顶点产生锐利法线,适配 three.js EdgeSplitModifier + Blender。
// 面法线夹角超阈值 → 分裂, BFS 找平滑组, 逐组重算法线。
export { EdgeSplitModifier, type EdgeSplitOptions } from './EdgeSplitModifier';
