// Editor — 编辑器系统。
// 整体分层:
//   SelectionSystem  — 选择/悬停/射线拾取,管理选中集合
//   TransformGizmo   — 变换手柄(移动/旋转/缩放),处理鼠标拖拽
//   UndoRedoSystem   — 撤销/重做栈 + 操作组(beginGroup/endGroup)
//   EditorCommands   — 预定义 HistoryAction 工厂(Move/Rotate/Scale/Add/Remove/Property)
//   SnapSystem       — 网格/角度/缩放吸附
//
// 各组件零耦合:SelectionSystem 不依赖 Gizmo,Gizmo 不依赖 UndoRedoSystem。
// 调用方(编辑器 UI 层)负责把它们串起来:
//   鼠标点击 → SelectionSystem.pick → 选中对象 → Gizmo.setTarget
//   拖拽 Gizmo → SnapSystem.snap* → EditorCommands.create* → UndoRedoSystem.execute

export { SelectionSystem, type SelectionChangeEvent } from './SelectionSystem';
export {
  TransformGizmo,
  type GizmoMode,
  type GizmoAxis,
  type GizmoMeshData,
} from './TransformGizmo';
export {
  UndoRedoSystem,
  type HistoryAction,
  type HistoryEntryView,
} from './UndoRedoSystem';
export {
  createMoveCommand,
  createRotateCommand,
  createScaleCommand,
  createAddCommand,
  createRemoveCommand,
  createPropertyCommand,
} from './EditorCommands';
export { SnapSystem } from './SnapSystem';
