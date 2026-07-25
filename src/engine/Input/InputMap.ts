// InputMap — 输入映射表:管理多个 InputAction 并提供 JSON 往返。
//
// 典型用法:
//   const map = new InputMap();
//   map.addAction('jump', new InputAction('jump', [{ type: 'keyboard', code: 'Space' }]));
//   map.addAction('forward', new InputAction('forward', [{ type: 'keyboard', code: 'KeyW' }]));
//   // 每帧:
//   map.update(inputManager);
//   if (map.getAction('jump')!.isPressed()) player.jump();
//
// JSON 往返:loadFromJSON(saveToJSON()) 重建等价 map,便于存档 / 配置热重载。

import { InputAction, type InputBinding, type InputStateProvider } from './InputAction';

/** InputMap 的 JSON 序列化结构。 */
export interface InputMapJSON {
  actions: { name: string; bindings: InputBinding[] }[];
}

export class InputMap {
  /** 动作表 (name → InputAction)。 */
  readonly actions: Map<string, InputAction> = new Map();

  /** 添加 (或覆盖同名) 动作。返回 this 以便链式调用。 */
  addAction(name: string, action: InputAction): this {
    this.actions.set(name, action);
    return this;
  }

  /** 获取动作;不存在时返回 undefined。 */
  getAction(name: string): InputAction | undefined {
    return this.actions.get(name);
  }

  /** 移除动作。返回是否实际移除。 */
  removeAction(name: string): boolean {
    return this.actions.delete(name);
  }

  /** 当前动作数量。 */
  get size(): number {
    return this.actions.size;
  }

  /** 每帧调用 —— 评估所有动作。 */
  update(input: InputStateProvider): void {
    for (const a of this.actions.values()) a.evaluate(input);
  }

  /** 清空所有动作。 */
  clear(): void {
    this.actions.clear();
  }

  /** 序列化为 JSON 结构。 */
  saveToJSON(): InputMapJSON {
    const actions: { name: string; bindings: InputBinding[] }[] = [];
    for (const a of this.actions.values()) {
      actions.push({
        name: a.name,
        bindings: a.bindings.map((b) => ({ ...b })),
      });
    }
    return { actions };
  }

  /** 从 JSON 加载 —— 清空当前动作后重建 (覆盖式)。 */
  loadFromJSON(json: InputMapJSON): void {
    this.actions.clear();
    for (const a of json.actions ?? []) {
      const action = new InputAction(a.name, a.bindings);
      this.actions.set(a.name, action);
    }
  }
}
