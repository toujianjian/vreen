// InventorySystem — 物品栏系统。
//
// 设计:
//   * items: Map<id, InventoryItem> 持当前物品(以 item.id 为键)
//   * 可堆叠物品(stackable=true)自动合并 count;不可堆叠物品每个占一个 slot
//   * maxSlots 限制最大 slot 数;超出返回 false
//   * currency 为独立数值(金币),与物品分开存储
//   * swap(a, b) 交换两个 slot(由调用方维护 slot 索引,系统只按 id 索引)
//
// 不变量:
//   - items.size <= maxSlots(若 maxSlots <= 0 表示无限制)
//   - 可堆叠物品在 items 中只有一个条目,count 累加
//   - removeItem(id, count) 后若 count <= 0,从 items 删除
//   - spendCurrency(amount) 金额不足返回 false,不扣减

/** 物品类型(由调用方解释语义)。 */
export type ItemType = 'weapon' | 'armor' | 'consumable' | 'material' | 'quest' | 'misc';

/** 物品栏物品。 */
export interface InventoryItem {
  /** 物品唯一 ID(同 ID 视为同种物品,可堆叠前提)。 */
  id: string;
  /** 显示名(可本地化)。 */
  name: string;
  /** 当前数量。 */
  count: number;
  /** 物品类型。 */
  type: ItemType;
  /** 附加数据(由调用方解释,如装备属性 / 消耗品效果)。 */
  data: unknown;
  /** 是否可堆叠。true 时同 id 物品合并 count;false 时每个占一个 slot。 */
  stackable: boolean;
}

/** InventorySystem 构造参数。 */
export interface InventorySystemOptions {
  /** 最大 slot 数(<=0 表示无限制)。默认 30。 */
  maxSlots?: number;
  /** 初始货币。默认 0。 */
  initialCurrency?: number;
}

/**
 * 物品栏系统 — 管理玩家持有的物品与货币。
 *
 * 使用方式:
 *   const inv = new InventorySystem({ maxSlots: 30, initialCurrency: 100 });
 *   inv.addItem({ id: 'potion', name: 'HP Potion', count: 5, type: 'consumable', data: null, stackable: true });
 *   inv.spendCurrency(50);  // 买物品
 *   inv.removeItem('potion', 1);  // 用掉一瓶
 */
export class InventorySystem {
  /** 物品表:id → InventoryItem。 */
  readonly items: Map<string, InventoryItem> = new Map();
  /** 最大 slot 数(<=0 表示无限制)。 */
  maxSlots: number;
  /** 当前货币。 */
  currency: number;

  constructor(options: InventorySystemOptions = {}) {
    this.maxSlots = options.maxSlots ?? 30;
    this.currency = options.initialCurrency ?? 0;
  }

  /** 当前已用 slot 数。 */
  get usedSlots(): number {
    return this.items.size;
  }

  /** 是否还有空 slot(若 maxSlots<=0 总是 true)。 */
  hasFreeSlot(): boolean {
    if (this.maxSlots <= 0) return true;
    return this.items.size < this.maxSlots;
  }

  /** 添加物品。返回是否成功(超出 maxSlots 或 count<=0 返回 false)。
   *  可堆叠物品自动合并 count;不可堆叠物品需有 free slot。 */
  addItem(item: InventoryItem): boolean {
    if (item.count <= 0) return false;
    const existing = this.items.get(item.id);
    if (existing) {
      if (!existing.stackable || !item.stackable) {
        // 不可堆叠但同 id 已存在:当作新 slot(但同 id Map 会冲突)
        // 这里约定:不可堆叠物品的 id 必须唯一(调用方负责追加 -1/-2 后缀)
        if (!this.hasFreeSlot()) return false;
        // 同 id 但不可堆叠:覆盖(警告:会丢失原物品)
        // 推荐调用方对不可堆叠物品使用唯一 id
        this.items.set(item.id, { ...item });
      } else {
        existing.count += item.count;
      }
    } else {
      if (!this.hasFreeSlot()) return false;
      this.items.set(item.id, { ...item });
    }
    return true;
  }

  /** 移除物品。返回实际移除的数量(0 表示无此物品或 count<=0)。 */
  removeItem(id: string, count: number = 1): number {
    if (count <= 0) return 0;
    const item = this.items.get(id);
    if (!item) return 0;
    const removed = Math.min(count, item.count);
    item.count -= removed;
    if (item.count <= 0) {
      this.items.delete(id);
    }
    return removed;
  }

  /** 获取物品。不存在返回 undefined。 */
  getItem(id: string): InventoryItem | undefined {
    return this.items.get(id);
  }

  /** 是否持有某物品(可指定数量)。 */
  hasItem(id: string, count: number = 1): boolean {
    const item = this.items.get(id);
    if (!item) return count <= 0;
    return item.count >= count;
  }

  /** 交换两个物品栏 slot(按 id 索引)。
   *  返回是否成功(任一 id 不存在返回 false)。 */
  swap(a: string, b: string): boolean {
    if (!this.items.has(a) || !this.items.has(b)) return false;
    if (a === b) return true;
    const itemA = this.items.get(a)!;
    const itemB = this.items.get(b)!;
    this.items.set(a, itemB);
    this.items.set(b, itemA);
    return true;
  }

  /** 获取所有物品(数组快照)。 */
  getItems(): InventoryItem[] {
    return Array.from(this.items.values());
  }

  /** 获取当前货币。 */
  getCurrency(): number {
    return this.currency;
  }

  /** 增加货币。返回新余额。 */
  addCurrency(amount: number): number {
    if (amount <= 0) return this.currency;
    this.currency += amount;
    return this.currency;
  }

  /** 消费货币。返回是否成功(金额不足返回 false,不扣减)。 */
  spendCurrency(amount: number): boolean {
    if (amount < 0) return false;
    if (this.currency < amount) return false;
    this.currency -= amount;
    return true;
  }

  /** 清空物品栏(货币不变)。 */
  clearItems(): void {
    this.items.clear();
  }

  /** 清空物品栏并重置货币为 0。 */
  clear(): void {
    this.items.clear();
    this.currency = 0;
  }
}
