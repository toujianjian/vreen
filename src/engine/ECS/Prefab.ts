// Prefab — 实体模板,可实例化为一组 Entity。
//
// 用途:
//   - 把"敌人小队" "粒子爆发源"等复用组合存为模板
//   - 关卡设计:Prefab 库 + 实例化位置 → 快速搭建场景
//   - 序列化:Prefab.toJSON() 可存入 .vreen 包;fromJSON() 还原
//
// 设计:
//   - 一个 Prefab 含多个 EntityTemplate(支持组合式 prefab,如"小队" = 1 队长 + N 士兵)
//   - 每个模板存:entity name、sceneNode TRS、POJO 组件数据(Record<name, POJO>)
//   - 实例化时通过 ComponentTypeRegistry.byName 查 type;POJO 组件数据被
//     structuredClone 复制,避免多次实例化共享引用污染
//   - 可选 parentSlot:模板可指定同 Prefab 内另一个 slot 作为父节点,
//     实例化时把子 entity 的 sceneNode 重挂到父 entity 下,形成层级
//   - NON_POJO 组件(MeshRef/SkinnedMeshRef/AnimState)在模板里跳过 — 它们
//     绑定运行时对象,不能在 Prefab 中持久化;调用方在 instantiate 后重新 attach

import { World, type EntityId, NON_POJO_COMPONENTS } from './World';
import { ComponentTypeRegistry, type ComponentType } from './ComponentType';
import { createLogger } from '@/lib/logger';

const log = createLogger('Prefab');

/** 单个 entity 模板。 */
export interface PrefabEntityTemplate {
  /** 模板内稳定 slot 索引(0..n-1);用作 parent 引用。 */
  slot: number;
  name: string;
  sceneNode: {
    position: [number, number, number];
    rotation: [number, number, number, number];
    scale: [number, number, number];
  };
  /** key = ComponentType.name,value = POJO 组件数据。
   *  NON_POJO 组件(MeshRef/SkinnedMeshRef/AnimState)会被跳过并 warn。 */
  components: Record<string, Record<string, unknown>>;
  /** 引用同 Prefab 内另一个 slot 作为 parent;不设 = 挂在 world.sceneRoot。 */
  parentSlot?: number;
}

/** Prefab 序列化形式。 */
export interface PrefabJson {
  version: '0.1.0';
  name: string;
  templates: PrefabEntityTemplate[];
}

/** instantiate() 选项。 */
export interface InstantiateOptions {
  /** 实例根节点世界位置偏移。 */
  position?: [number, number, number];
  /** 实例根节点旋转偏移(quaternion,后续版本组合;当前仅作锚点提示)。 */
  rotation?: [number, number, number, number];
  /** 实例根节点缩放,会乘到每个模板的 position / scale 上。 */
  scale?: [number, number, number];
  /** 实体名后缀,避免多次实例化撞名;不传则不加后缀。 */
  nameSuffix?: string;
  /** 名字计数起始;默认 0。 */
  nameStart?: number;
}

export class Prefab {
  name: string;
  private _templates: PrefabEntityTemplate[] = [];

  constructor(name: string = 'Prefab') {
    this.name = name;
  }

  /** 添加一个实体模板;返回其 slot index。
   *  传 NON_POJO 组件会触发 warn 并被忽略。 */
  addEntity(template: Omit<PrefabEntityTemplate, 'slot'>): number {
    // 过滤 NON_POJO 组件
    const filteredComps: Record<string, Record<string, unknown>> = {};
    for (const [k, v] of Object.entries(template.components)) {
      if (NON_POJO_COMPONENTS.has(k)) {
        log.warn(`addEntity: 组件 "${k}" 是 NON_POJO,Prefab 不持久化,已忽略`);
        continue;
      }
      filteredComps[k] = structuredClone(v);
    }
    const slot = this._templates.length;
    this._templates.push({
      slot,
      name: template.name,
      sceneNode: {
        position: [...template.sceneNode.position] as [number, number, number],
        rotation: [...template.sceneNode.rotation] as [number, number, number, number],
        scale: [...template.sceneNode.scale] as [number, number, number],
      },
      components: filteredComps,
      parentSlot: template.parentSlot,
    });
    return slot;
  }

  /** 模板数量。 */
  size(): number { return this._templates.length; }

  /** 取所有模板(只读)。 */
  templates(): readonly PrefabEntityTemplate[] { return this._templates; }

  /** 在 world 中实例化所有模板,返回按 slot 顺序的 EntityId[]。
   *  流程:
   *    1. 按 slot 顺序 createEntity,应用 prefab 实例偏移 + 模板 TRS
   *    2. 处理 parentSlot:把子 sceneNode 重新挂到父 sceneNode 下
   *    3. 复制组件数据(structuredClone,避免共享引用) */
  instantiate(world: World, opts: InstantiateOptions = {}): EntityId[] {
    const ids: EntityId[] = [];
    const offset = opts.position ?? [0, 0, 0];
    const scaleOffset = opts.scale ?? [1, 1, 1];
    const suffix = opts.nameSuffix ?? '';
    const startIdx = opts.nameStart ?? 0;

    // 第一遍:createEntity + sceneNode TRS
    for (let i = 0; i < this._templates.length; i++) {
      const t = this._templates[i];
      const name = suffix
        ? `${t.name}_${suffix}_${startIdx + i}`
        : `${t.name}_${startIdx + i}`;
      const id = world.createEntity(name);
      ids.push(id);

      const node = world.getSceneNode(id);
      if (node) {
        // 应用 prefab 实例的整体偏移 + 模板自身 TRS。
        // 位置 = offset + template.position * scaleOffset
        // 旋转:模板 rotation 直接覆盖(组合 opts.rotation 需要 Quaternion.multiply,
        //   当前版本仅记录 anchor,留待后续完善)
        // 缩放:模板 scale * scaleOffset
        node.position.set(
          offset[0] + t.sceneNode.position[0] * scaleOffset[0],
          offset[1] + t.sceneNode.position[1] * scaleOffset[1],
          offset[2] + t.sceneNode.position[2] * scaleOffset[2],
        );
        node.rotation.set(
          t.sceneNode.rotation[0],
          t.sceneNode.rotation[1],
          t.sceneNode.rotation[2],
          t.sceneNode.rotation[3],
        );
        node.scale.set(
          t.sceneNode.scale[0] * scaleOffset[0],
          t.sceneNode.scale[1] * scaleOffset[1],
          t.sceneNode.scale[2] * scaleOffset[2],
        );
      }
    }

    // 处理 parentSlot:把子 entity 的 sceneNode 重新挂到父 entity 下。
    // Object3D.add 会自动从原 parent 移除,这里直接 add 即可。
    for (let i = 0; i < this._templates.length; i++) {
      const t = this._templates[i];
      if (t.parentSlot === undefined) continue;
      if (t.parentSlot < 0 || t.parentSlot >= ids.length) {
        log.warn(`instantiate: 模板 "${t.name}" 的 parentSlot=${t.parentSlot} 越界,已忽略`);
        continue;
      }
      const parentId = ids[t.parentSlot];
      const childId = ids[i];
      const parentNode = world.getSceneNode(parentId);
      const childNode = world.getSceneNode(childId);
      if (parentNode && childNode) {
        parentNode.add(childNode);
      }
    }

    // 第二遍:复制组件数据(deep-clone,避免共享引用)
    for (let i = 0; i < this._templates.length; i++) {
      const t = this._templates[i];
      const id = ids[i];
      for (const [compName, rawData] of Object.entries(t.components)) {
        if (NON_POJO_COMPONENTS.has(compName)) continue;
        const type = ComponentTypeRegistry.byName(compName);
        if (!type) {
          log.warn(`instantiate: 未知组件 "${compName}" — 跳过`);
          continue;
        }
        const cloned = structuredClone(rawData);
        (world.setComponent as (i: EntityId, t: ComponentType<unknown>, d: unknown) => void)
          (id, type as ComponentType<unknown>, cloned);
      }
    }

    log.debug(`instantiate: prefab="${this.name}", spawned ${ids.length} entities`);
    return ids;
  }

  toJSON(): PrefabJson {
    return {
      version: '0.1.0',
      name: this.name,
      templates: this._templates.map((t) => ({
        slot: t.slot,
        name: t.name,
        sceneNode: {
          position: [...t.sceneNode.position] as [number, number, number],
          rotation: [...t.sceneNode.rotation] as [number, number, number, number],
          scale: [...t.sceneNode.scale] as [number, number, number],
        },
        components: Object.fromEntries(
          Object.entries(t.components).map(([k, v]) => [k, structuredClone(v)]),
        ),
        parentSlot: t.parentSlot,
      })),
    };
  }

  static fromJSON(json: PrefabJson): Prefab {
    if (json.version !== '0.1.0') {
      throw new Error(`Prefab.fromJSON: unsupported version "${json.version}"`);
    }
    const p = new Prefab(json.name);
    for (const t of json.templates) {
      p._templates.push({
        slot: t.slot,
        name: t.name,
        sceneNode: {
          position: [...t.sceneNode.position] as [number, number, number],
          rotation: [...t.sceneNode.rotation] as [number, number, number, number],
          scale: [...t.sceneNode.scale] as [number, number, number],
        },
        components: Object.fromEntries(
          Object.entries(t.components).map(([k, v]) => [k, structuredClone(v)]),
        ),
        parentSlot: t.parentSlot,
      });
    }
    return p;
  }
}
