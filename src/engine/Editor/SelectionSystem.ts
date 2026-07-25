// SelectionSystem — 编辑器选择系统。
// 管理当前选中的 Object3D 集合、悬停对象,以及射线拾取入口。
//
// 设计:
//   * `selected` 用 Set<Object3D> 存储选中集合,支持单选/追加多选/全选/全清。
//   * `hover` 单独跟踪鼠标悬停对象(不参与选中),供 UI 高亮。
//   * `pick(raycaster, scene)` 调 Raycaster.intersectObject 取最近命中,
//     命中则按 multiSelect/additive 决定是替换、追加还是切换选择。
//   * 不持有 Scene 引用,调用方传入,避免与 SceneManager 耦合。

import type { Object3D } from '../Core/Object3D';
import type { Scene } from '../Core/Scene';
import type { Raycaster, Intersection } from '../Core/Raycaster';

/** 选择变化事件,供 UI 监听刷新大纲/属性面板。 */
export interface SelectionChangeEvent {
  /** 当前选中的所有对象(顺序不保证,按 Set 迭代序)。 */
  selected: Object3D[];
  /** 触发此次变化的"主"对象(如刚被点选的对象),可能为 null(如 deselectAll)。 */
  primary: Object3D | null;
  /** 变化类型,便于监听方区分增量与全量刷新。 */
  kind: 'select' | 'deselect' | 'deselectAll' | 'clear' | 'hover';
}

type SelectionListener = (e: SelectionChangeEvent) => void;

export class SelectionSystem {
  /** 当前选中的对象集合。 */
  readonly selected: Set<Object3D> = new Set();
  /** 鼠标悬停对象(null 表示无)。 */
  hover: Object3D | null = null;
  /** 是否启用多选模式(按住 Shift/Ctrl 时设为 true)。 */
  multiSelect: boolean = false;

  private listeners: Set<SelectionListener> = new Set();

  /**
   * 选择一个对象。
   * @param object   要选择的对象
   * @param additive 是否追加到现有选择(默认 false = 替换)。
   *                 additive=false 时先清空再选择;additive=true 时追加。
   */
  select(object: Object3D, additive: boolean = false): void {
    if (!additive) {
      this.selected.clear();
    }
    this.selected.add(object);
    this.emit({ selected: this.getSelected(), primary: object, kind: 'select' });
  }

  /** 取消选择指定对象。若对象未选中则无操作。 */
  deselect(object: Object3D): void {
    if (!this.selected.has(object)) return;
    this.selected.delete(object);
    this.emit({ selected: this.getSelected(), primary: object, kind: 'deselect' });
  }

  /** 取消所有选择。 */
  deselectAll(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.emit({ selected: [], primary: null, kind: 'deselectAll' });
  }

  /** alias for deselectAll,语义化命名(供 clear button 调用)。 */
  clear(): void {
    this.deselectAll();
    this.emit({ selected: [], primary: null, kind: 'clear' });
  }

  /** 查询对象是否被选中。 */
  isSelected(object: Object3D): boolean {
    return this.selected.has(object);
  }

  /** 获取选中对象数组(按 Set 迭代序)。返回新数组,外部修改不影响内部状态。 */
  getSelected(): Object3D[] {
    return Array.from(this.selected);
  }

  /** 选中数量。 */
  get count(): number {
    return this.selected.size;
  }

  /**
   * 设置悬停对象。传入 null 清除悬停。相同对象不触发事件。
   */
  setHover(object: Object3D | null): void {
    if (this.hover === object) return;
    this.hover = object;
    this.emit({
      selected: this.getSelected(),
      primary: object,
      kind: 'hover',
    });
  }

  /** 获取当前悬停对象。 */
  getHover(): Object3D | null {
    return this.hover;
  }

  /**
   * 射线拾取:对 scene 子树求交,取最近命中并按 multiSelect 决定选择策略。
   * - 无命中:非多选时清空选择;多选时不变。
   * - 有命中:
   *   - multiSelect=true 且目标已选中 → 取消选择(toggle)
   *   - multiSelect=true 且目标未选中 → 追加选择
   *   - multiSelect=false → 替换为该对象
   * @returns 命中结果(可能为 null),便于调用方读取命中点
   */
  pick(raycaster: Raycaster, scene: Scene): Intersection | null {
    const hits = raycaster.intersectObject(scene, true);
    if (hits.length === 0) {
      if (!this.multiSelect) this.deselectAll();
      return null;
    }
    const hit = hits[0];
    const obj = hit.object;
    if (this.multiSelect && this.isSelected(obj)) {
      this.deselect(obj);
    } else {
      this.select(obj, this.multiSelect);
    }
    return hit;
  }

  /** 监听选择变化。返回取消监听函数。 */
  on(listener: SelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 内部:派发事件给所有监听者。 */
  private emit(e: SelectionChangeEvent): void {
    // 复制一份避免监听器在回调里 on/off 导致迭代异常
    const snapshot = Array.from(this.listeners);
    for (const l of snapshot) {
      try {
        l(e);
      } catch {
        // 单个监听器出错不影响其他
      }
    }
  }
}
