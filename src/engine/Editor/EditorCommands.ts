// EditorCommands — 编辑器预定义命令工厂。
// 把常见编辑操作(移动/旋转/缩放/添加/删除/属性修改)封装成 UndoCommand,
// 供 UndoRedoSystem.execute() 直接消费。
//
// 设计:
//   * 每个工厂方法返回 UndoCommand(不执行),由调用方决定何时 execute。
//     execute() 内部会调用 command.execute() 应用副作用,因此工厂方法不再预执行。
//   * 命令快照:创建时读取 oldValue,execute 时写入 newValue,undo 时写回 oldValue。
//   * 添加/删除命令:undo 时反向操作(添加的撤回=删除,删除的撤回=添加)。
//   * 属性命令:通过 keyof 取对象任意属性,值的拷贝由调用方保证(对 Vector3
//     等引用类型,调用方应传入 clone())。

import type { UndoCommand } from './UndoRedoSystem';
import type { Object3D } from '../Core/Object3D';
import type { Scene } from '../Core/Scene';
import { Vector3 } from '../Math/Vector3';
import { Quaternion } from '../Math/Quaternion';

/** 命令 id 自增计数器 (进程级)。 */
let _nextCommandId = 0;

/** 分配下一个命令 id。 */
function genId(): number {
  return ++_nextCommandId;
}

/**
 * 创建"移动对象"命令。
 * @param object 目标对象
 * @param oldPos 变更前位置(快照)
 * @param newPos 变更后位置
 */
export function createMoveCommand(
  object: Object3D,
  oldPos: Vector3,
  newPos: Vector3,
): UndoCommand {
  // 复制快照避免外部后续修改影响命令
  const oldV = oldPos.clone();
  const newV = newPos.clone();
  return {
    id: genId(),
    description: `Move ${object.name || object.type}`,
    undo(): void {
      object.position.copy(oldV);
    },
    execute(): void {
      object.position.copy(newV);
    },
  };
}

/**
 * 创建"旋转对象"命令。
 * @param object 目标对象
 * @param oldRot 变更前旋转(快照)
 * @param newRot 变更后旋转
 */
export function createRotateCommand(
  object: Object3D,
  oldRot: Quaternion,
  newRot: Quaternion,
): UndoCommand {
  const oldQ = oldRot.clone();
  const newQ = newRot.clone();
  return {
    id: genId(),
    description: `Rotate ${object.name || object.type}`,
    undo(): void {
      object.rotation.copy(oldQ);
    },
    execute(): void {
      object.rotation.copy(newQ);
    },
  };
}

/**
 * 创建"缩放对象"命令。
 * @param object 目标对象
 * @param oldScale 变更前缩放(快照)
 * @param newScale 变更后缩放
 */
export function createScaleCommand(
  object: Object3D,
  oldScale: Vector3,
  newScale: Vector3,
): UndoCommand {
  const oldV = oldScale.clone();
  const newV = newScale.clone();
  return {
    id: genId(),
    description: `Scale ${object.name || object.type}`,
    undo(): void {
      object.scale.copy(oldV);
    },
    execute(): void {
      object.scale.copy(newV);
    },
  };
}

/**
 * 创建"添加对象到场景"命令。
 * undo 时把对象从父节点移除;execute 时重新加回。
 * @param scene   目标场景(对象将被 add 到 scene)
 * @param object  要添加的对象
 */
export function createAddCommand(
  scene: Scene,
  object: Object3D,
): UndoCommand {
  // 记录原始父节点,undo 时还原(支持从其他父节点移动到 scene 的场景)
  const originalParent = object.parent;
  return {
    id: genId(),
    description: `Add ${object.name || object.type}`,
    undo(): void {
      // 从 scene 移除并还原原父节点(null 表示原本无父节点)
      if (object.parent === scene) {
        scene.remove(object);
      }
      if (originalParent !== null && originalParent !== scene) {
        originalParent.add(object);
      }
    },
    execute(): void {
      scene.add(object);
    },
  };
}

/**
 * 创建"从场景删除对象"命令。
 * undo 时把对象加回 scene;execute 时再次移除。
 * 注意:此命令假设对象当前已在 scene 中。若对象有非 scene 的父节点,
 * 删除后父节点关系丢失,undo 会把它加回 scene(而非原父节点)。
 * @param scene  目标场景
 * @param object 要删除的对象
 */
export function createRemoveCommand(
  scene: Scene,
  object: Object3D,
): UndoCommand {
  return {
    id: genId(),
    description: `Remove ${object.name || object.type}`,
    undo(): void {
      if (object.parent !== scene) {
        scene.add(object);
      }
    },
    execute(): void {
      if (object.parent === scene) {
        scene.remove(object);
      }
    },
  };
}

/**
 * 创建"修改对象属性"命令(泛型)。
 * @param object    目标对象
 * @param property  属性名(keyof Object3D)
 * @param oldValue  变更前值(快照,引用类型由调用方 clone)
 * @param newValue  变更后值
 *
 * 注意:对 Vector3/Quaternion 等引用类型,调用方应传入 clone() 后的值,
 * 否则外部后续修改会影响快照。基础类型(string/number/boolean)无此问题。
 */
export function createPropertyCommand<T extends Object3D, K extends keyof T>(
  object: T,
  property: K,
  oldValue: T[K],
  newValue: T[K],
): UndoCommand {
  return {
    id: genId(),
    description: `Set ${object.name || object.type}.${String(property)}`,
    undo(): void {
      object[property] = oldValue;
    },
    execute(): void {
      object[property] = newValue;
    },
  };
}
