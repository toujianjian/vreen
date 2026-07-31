// WhiteBox barrel — half-edge mesh + primitive shapes + CSG for in-editor greyboxing.
//
// 参考 o3de Gems/WhiteBox。产出 HalfEdgeMesh (拓扑感知) + BufferGeometry (可渲染)。
// 与 Geometries/ (解析式基元) 互补:WhiteBox 面向编辑器 greyboxing,支持 CSG 与拓扑查询。

export * from './HalfEdgeMesh';
export * from './WhiteBoxShapes';
export * from './Csg';
