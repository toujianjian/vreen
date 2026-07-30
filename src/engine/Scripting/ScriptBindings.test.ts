// ScriptBindings 单元测试。
//
// 验证:
//   • registerFunction/registerProperty/registerClass/registerEnum + get/has
//   • unregister + 覆盖返回值
//   • getBindings / getBindingsByCategory / getCategories
//   • call 成功 / 失败 (未注册 / 非 function)
//   • initialize 幂等 + 注册全套核心 API
//   • registerEngineAPI (Math 类族 + 工具函数)
//   • registerSceneAPI (createEntity / destroyEntity / entityCount)
//   • registerPhysicsAPI / registerAudioAPI / registerInputAPI / registerRenderingAPI 占位
//   • getAPIInfo / exportAPIDocumentation
//   • getStats
//   • clear / 全局单例

import { describe, it, expect } from 'vitest';
import {
  ScriptBindings,
  getDefaultScriptBindings,
  resetDefaultScriptBindings,
} from './ScriptBindings';
import { Vector3 } from '../Math';
import { World } from '../ECS/World';

describe('ScriptBindings — register + get + has', () => {
  it('registerFunction + has + get', () => {
    const sb = new ScriptBindings();
    const overwritten = sb.registerFunction('add', (a: number, b: number) => a + b, 'Math', '加法');
    expect(overwritten).toBe(false);
    expect(sb.has('add')).toBe(true);
    expect(sb.has('missing')).toBe(false);
    const b = sb.get('add')!;
    expect(b.type).toBe('function');
    expect(b.category).toBe('Math');
    expect(b.description).toBe('加法');
  });

  it('registerProperty + get', () => {
    const sb = new ScriptBindings();
    sb.registerProperty('PI', Math.PI, 'Math', '圆周率');
    const b = sb.get('PI')!;
    expect(b.type).toBe('property');
    expect(b.value).toBeCloseTo(Math.PI);
  });

  it('registerClass + get', () => {
    const sb = new ScriptBindings();
    sb.registerClass('Vector3', Vector3, 'Math', '3D 向量');
    const b = sb.get('Vector3')!;
    expect(b.type).toBe('class');
    expect(b.value).toBe(Vector3);
  });

  it('registerEnum + get', () => {
    const sb = new ScriptBindings();
    sb.registerEnum('Color', { Red: 0, Green: 1, Blue: 2 }, 'General', '颜色枚举');
    const b = sb.get('Color')!;
    expect(b.type).toBe('enum');
    expect(b.value.Red).toBe(0);
    expect(b.value.Blue).toBe(2);
  });

  it('register overwrites existing and returns true', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('fn', () => 1);
    const overwritten = sb.registerFunction('fn', () => 2);
    expect(overwritten).toBe(true);
    expect(sb.call('fn')).toBe(2);
  });

  it('unregister removes a binding and returns true', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('fn', () => 1);
    expect(sb.unregister('fn')).toBe(true);
    expect(sb.has('fn')).toBe(false);
    expect(sb.unregister('fn')).toBe(false);
  });

  it('get on unknown returns undefined', () => {
    const sb = new ScriptBindings();
    expect(sb.get('nope')).toBeUndefined();
  });
});

describe('ScriptBindings — query', () => {
  it('getBindings returns snapshot array', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('a', () => 1, 'X');
    sb.registerFunction('b', () => 2, 'Y');
    const list = sb.getBindings();
    expect(list).toHaveLength(2);
    expect(list.map((b) => b.name).sort()).toEqual(['a', 'b']);
    // 快照: 修改不影响内部
    list.length = 0;
    expect(sb.getBindings()).toHaveLength(2);
  });

  it('getBindingsByCategory filters by category', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('a', () => 1, 'Math');
    sb.registerFunction('b', () => 2, 'Math');
    sb.registerFunction('c', () => 3, 'Scene');
    const math = sb.getBindingsByCategory('Math');
    expect(math).toHaveLength(2);
    expect(math.every((b) => b.category === 'Math')).toBe(true);
    expect(sb.getBindingsByCategory('NonExist')).toEqual([]);
  });

  it('getCategories returns sorted unique categories', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('a', () => 1, 'Math');
    sb.registerFunction('b', () => 2, 'Scene');
    sb.registerFunction('c', () => 3, 'Math');
    expect(sb.getCategories()).toEqual(['Math', 'Scene']);
  });
});

describe('ScriptBindings — call', () => {
  it('calls a registered function with args', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('add', (a: number, b: number) => a + b);
    expect(sb.call('add', [1, 2])).toBe(3);
    expect(sb.call('add')).toBe(NaN); // 无参数
  });

  it('call on unknown returns undefined', () => {
    const sb = new ScriptBindings();
    expect(sb.call('nope')).toBeUndefined();
  });

  it('call on non-function binding returns undefined', () => {
    const sb = new ScriptBindings();
    sb.registerProperty('PI', Math.PI);
    expect(sb.call('PI')).toBeUndefined();
  });

  it('call catches thrown errors and returns undefined', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('throw', () => { throw new Error('boom'); });
    expect(sb.call('throw')).toBeUndefined();
  });
});

describe('ScriptBindings — initialize', () => {
  it('initialize registers all core APIs and sets isInitialized', () => {
    const sb = new ScriptBindings();
    expect(sb.isInitialized).toBe(false);
    sb.initialize();
    expect(sb.isInitialized).toBe(true);
    // Math 类族
    expect(sb.has('Vector3')).toBe(true);
    expect(sb.has('Vector2')).toBe(true);
    expect(sb.has('Quaternion')).toBe(true);
    expect(sb.has('Color')).toBe(true);
    expect(sb.has('Matrix4')).toBe(true);
    // 工具函数
    expect(sb.has('clamp')).toBe(true);
    expect(sb.has('lerp')).toBe(true);
    expect(sb.has('radToDeg')).toBe(true);
    expect(sb.has('degToRad')).toBe(true);
    // Scene API
    expect(sb.has('createEntity')).toBe(true);
    expect(sb.has('destroyEntity')).toBe(true);
    expect(sb.has('entityCount')).toBe(true);
    // Physics / Audio / Input / Rendering 占位
    expect(sb.has('applyForce')).toBe(true);
    expect(sb.has('play')).toBe(true);
    expect(sb.has('isKeyDown')).toBe(true);
    expect(sb.has('setMaterial')).toBe(true);
  });

  it('initialize is idempotent', () => {
    const sb = new ScriptBindings();
    sb.initialize();
    const count1 = sb.getStats().total;
    sb.initialize(); // 第二次应跳过
    const count2 = sb.getStats().total;
    expect(count2).toBe(count1);
    expect(sb.isInitialized).toBe(true);
  });

  it('initialize with world enables scene API', () => {
    const sb = new ScriptBindings();
    const world = new World({ name: 'test' });
    sb.initialize(world);
    const id = sb.call('createEntity', ['Player']) as number;
    expect(id).toBeGreaterThanOrEqual(0);
    expect(sb.call('entityCount')).toBe(1);
    expect(sb.call('getEntityName', [id])).toBe('Player');
    sb.call('destroyEntity', [id]);
    expect(sb.call('entityCount')).toBe(0);
  });

  it('scene API returns undefined if no world provided (error caught)', () => {
    const sb = new ScriptBindings();
    sb.registerSceneAPI();
    // createEntity 内部调用 _requireWorld 抛错,被 call 的 try/catch 捕获返回 undefined。
    expect(sb.call('createEntity')).toBeUndefined();
  });
});

describe('ScriptBindings — registerEngineAPI', () => {
  it('registered Vector3 class is constructable', () => {
    const sb = new ScriptBindings();
    sb.registerEngineAPI();
    const V3 = sb.get('Vector3')!.value as typeof Vector3;
    const v = new V3(1, 2, 3);
    expect(v.x).toBe(1);
    expect(v.y).toBe(2);
    expect(v.z).toBe(3);
  });

  it('clamp/lerp/radToDeg/degToRad work correctly', () => {
    const sb = new ScriptBindings();
    sb.registerEngineAPI();
    expect(sb.call('clamp', [5, 0, 10])).toBe(5);
    expect(sb.call('clamp', [-1, 0, 10])).toBe(0);
    expect(sb.call('clamp', [11, 0, 10])).toBe(10);
    expect(sb.call('lerp', [0, 100, 0.5])).toBe(50);
    expect(sb.call('radToDeg', [Math.PI])).toBeCloseTo(180);
    expect(sb.call('degToRad', [180])).toBeCloseTo(Math.PI);
  });

  it('MathUtils is exposed as a property', () => {
    const sb = new ScriptBindings();
    sb.registerEngineAPI();
    const utils = sb.get('MathUtils')!.value as any;
    expect(typeof utils.clamp).toBe('function');
    expect(typeof utils.lerp).toBe('function');
  });
});

describe('ScriptBindings — registerSceneAPI', () => {
  it('createEntity / destroyEntity / entityCount / isAlive', () => {
    const sb = new ScriptBindings();
    const world = new World();
    sb.initialize(world);
    const id = sb.call('createEntity', ['E1']) as number;
    expect(sb.call('isAlive', [id])).toBe(true);
    expect(sb.call('entityCount')).toBe(1);
    sb.call('destroyEntity', [id]);
    expect(sb.call('isAlive', [id])).toBe(false);
    expect(sb.call('entityCount')).toBe(0);
  });

  it('setEntityName / getEntityName', () => {
    const sb = new ScriptBindings();
    const world = new World();
    sb.initialize(world);
    const id = sb.call('createEntity', ['Old']) as number;
    sb.call('setEntityName', [id, 'New']);
    expect(sb.call('getEntityName', [id])).toBe('New');
  });

  it('listEntities returns array', () => {
    const sb = new ScriptBindings();
    const world = new World();
    sb.initialize(world);
    sb.call('createEntity', ['A']);
    sb.call('createEntity', ['B']);
    const list = sb.call('listEntities') as any[];
    expect(list).toHaveLength(2);
  });

  it('getSceneNode returns Object3D', () => {
    const sb = new ScriptBindings();
    const world = new World();
    sb.initialize(world);
    const id = sb.call('createEntity', ['N']) as number;
    const node = sb.call('getSceneNode', [id]);
    expect(node).toBeDefined();
    expect(node.name).toBe('N');
  });
});

describe('ScriptBindings — placeholder APIs', () => {
  it('physics API returns placeholder values without throwing', () => {
    const sb = new ScriptBindings();
    sb.registerPhysicsAPI();
    expect(sb.call('applyForce', [1, 0, 0, 0])).toBeUndefined();
    expect(sb.call('setVelocity', [1, 0, 0, 0])).toBeUndefined();
    const v = sb.call('getVelocity', [1]) as Vector3;
    expect(v).toBeInstanceOf(Vector3);
    expect(v.x).toBe(0);
  });

  it('audio API returns false (placeholder)', () => {
    const sb = new ScriptBindings();
    sb.registerAudioAPI();
    expect(sb.call('play', ['clip'])).toBe(false);
    expect(sb.call('pause', ['clip'])).toBe(false);
    expect(sb.call('stop', ['clip'])).toBe(false);
    expect(sb.call('setVolume', ['clip', 0.5])).toBe(false);
  });

  it('input API returns false / zero (placeholder)', () => {
    const sb = new ScriptBindings();
    sb.registerInputAPI();
    expect(sb.call('isKeyDown', ['KeyA'])).toBe(false);
    expect(sb.call('isKeyPressed', ['KeyA'])).toBe(false);
    expect(sb.call('isMouseDown', [0])).toBe(false);
    const pos = sb.call('getMousePosition') as { x: number; y: number };
    expect(pos).toEqual({ x: 0, y: 0 });
  });

  it('rendering API returns false (placeholder)', () => {
    const sb = new ScriptBindings();
    sb.registerRenderingAPI();
    expect(sb.call('setMaterial', [1, null])).toBe(false);
    expect(sb.call('setCamera', [null])).toBe(false);
    expect(sb.call('setBackgroundColor', [0, 0, 0])).toBe(false);
    expect(sb.call('setFog', [null, 0, 100])).toBe(false);
  });
});

describe('ScriptBindings — metadata', () => {
  it('getAPIInfo returns info for all bindings', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('add', (a: number, b: number) => a + b, 'Math', '加法');
    sb.registerProperty('PI', Math.PI, 'Math', '圆周率');
    sb.registerClass('V3', Vector3, 'Math', '3D 向量');
    sb.registerEnum('C', { Red: 0 }, 'Color', '颜色');
    const info = sb.getAPIInfo();
    expect(info).toHaveLength(4);
    const addInfo = info.find((i) => i.name === 'add')!;
    expect(addInfo.type).toBe('function');
    expect(addInfo.category).toBe('Math');
    expect(addInfo.description).toBe('加法');
    // 参数名推断 (最佳努力)
    expect(addInfo.params).toBeDefined();
    expect(addInfo.params!.length).toBeGreaterThanOrEqual(2);
  });

  it('exportAPIDocumentation groups by category', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('a', () => 1, 'Math', 'A');
    sb.registerFunction('b', () => 2, 'Scene', 'B');
    sb.registerFunction('c', () => 3, 'Math', 'C');
    const doc = sb.exportAPIDocumentation();
    expect(doc.totalBindings).toBe(3);
    expect(doc.categories).toHaveLength(2);
    const mathCat = doc.categories.find((c) => c.category === 'Math')!;
    expect(mathCat.bindings).toHaveLength(2);
  });

  it('getStats returns correct counts', () => {
    const sb = new ScriptBindings();
    sb.registerFunction('fn1', () => 1, 'Math');
    sb.registerFunction('fn2', () => 2, 'Math');
    sb.registerProperty('PI', 3.14, 'Math');
    sb.registerClass('V3', Vector3, 'Math');
    sb.registerEnum('C', { R: 0 }, 'Color');
    const stats = sb.getStats();
    expect(stats.total).toBe(5);
    expect(stats.byType.function).toBe(2);
    expect(stats.byType.property).toBe(1);
    expect(stats.byType.class).toBe(1);
    expect(stats.byType.enum).toBe(1);
    expect(stats.categoryCount).toBe(2);
    expect(stats.byCategory.Math).toBe(4);
    expect(stats.byCategory.Color).toBe(1);
    expect(stats.isInitialized).toBe(false);
  });
});

describe('ScriptBindings — clear + singleton', () => {
  it('clear removes all bindings and resets isInitialized', () => {
    const sb = new ScriptBindings();
    sb.initialize();
    expect(sb.bindings.size).toBeGreaterThan(0);
    sb.clear();
    expect(sb.bindings.size).toBe(0);
    expect(sb.isInitialized).toBe(false);
  });

  it('getDefaultScriptBindings returns same instance', () => {
    resetDefaultScriptBindings();
    const a = getDefaultScriptBindings();
    const b = getDefaultScriptBindings();
    expect(a).toBe(b);
  });

  it('resetDefaultScriptBindings clears and resets singleton', () => {
    const a = getDefaultScriptBindings();
    a.registerFunction('temp', () => 1);
    resetDefaultScriptBindings();
    const b = getDefaultScriptBindings();
    expect(b).not.toBe(a);
    expect(b.has('temp')).toBe(false);
  });
});
