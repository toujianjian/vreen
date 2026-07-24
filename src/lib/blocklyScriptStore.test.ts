// blocklyScriptStore 测试 — Phase 3.5
//
// 验证:
//   • localStorage CRUD (saveScript/listSavedScripts/getScript/deleteScript/clearAllScripts)
//   • JSON 导出/导入 (exportScriptsToJson/importScriptsFromJson)
//   • serializeWorkspace / deserializeIntoWorkspace (用 mock Blockly)
//   • 边界:损坏数据/无效 entry 被过滤
//   • id 覆盖语义(同 id 更新而非新增)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { VreenScriptEntry } from '@/lib/vreenManifest';

// ── Mock Blockly (在 import blocklyScriptStore 前) ───────────────
// 只需 stub 出 serialization.workspaces.save/load 两个方法。
const mockSave = vi.fn<(ws: unknown) => unknown>();
const mockLoad = vi.fn<(state: unknown, ws: unknown) => void>();
vi.mock('blockly/core', () => ({
  serialization: {
    workspaces: {
      save: (ws: unknown) => mockSave(ws),
      load: (state: unknown, ws: unknown) => mockLoad(state, ws),
    },
  },
}));

// ── localStorage stub ──────────────────────────────────────────────
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

let memStore: MemStorage;

beforeEach(() => {
  memStore = new MemStorage();
  // localStorage 是 read-only 全局,需要 defineProperty
  Object.defineProperty(globalThis, 'localStorage', {
    value: memStore,
    configurable: true,
    writable: true,
  });
  mockSave.mockReset();
  mockLoad.mockReset();
});

// 延迟 import 以使 vi.mock 生效
async function loadStore() {
  return await import('./blocklyScriptStore');
}

// ── 工具 ─────────────────────────────────────────────────────────
function makeEntry(overrides: Partial<VreenScriptEntry> = {}): VreenScriptEntry {
  return {
    id: 'id1',
    name: 'script_a',
    workspace: { blocks: { blocks: [] } },
    updatedAt: '2026-07-23T00:00:00.000Z',
    ...overrides,
  };
}

// ── 测试 ─────────────────────────────────────────────────────────
describe('blocklyScriptStore — localStorage CRUD (Phase 3.5)', () => {
  it('listSavedScripts 空时返回 []', async () => {
    const s = await loadStore();
    expect(s.listSavedScripts()).toEqual([]);
  });

  it('saveScript 新增后 listSavedScripts 包含该条目', async () => {
    const s = await loadStore();
    s.saveScript(makeEntry());
    const list = s.listSavedScripts();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('id1');
    expect(list[0].name).toBe('script_a');
  });

  it('saveScript 同 id 覆盖(不新增)', async () => {
    const s = await loadStore();
    s.saveScript(makeEntry({ name: 'a' }));
    s.saveScript(makeEntry({ id: 'id1', name: 'b' }));
    const list = s.listSavedScripts();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('b');
  });

  it('saveScript 不同 id 追加', async () => {
    const s = await loadStore();
    s.saveScript(makeEntry({ id: 'id1', name: 'a' }));
    s.saveScript(makeEntry({ id: 'id2', name: 'b' }));
    expect(s.listSavedScripts()).toHaveLength(2);
  });

  it('saveScript 会更新 updatedAt', async () => {
    const s = await loadStore();
    const oldTs = '2020-01-01T00:00:00.000Z';
    s.saveScript(makeEntry({ updatedAt: oldTs }));
    const updated = s.listSavedScripts()[0];
    expect(updated.updatedAt).not.toBe(oldTs);
    // 应为合法 ISO 字符串
    expect(new Date(updated.updatedAt).getTime()).not.toBeNaN();
  });

  it('getScript 按 id 查找', async () => {
    const s = await loadStore();
    s.saveScript(makeEntry({ id: 'id1' }));
    s.saveScript(makeEntry({ id: 'id2', name: 'b' }));
    expect(s.getScript('id1')?.name).toBe('script_a');
    expect(s.getScript('id2')?.name).toBe('b');
    expect(s.getScript('not_exist')).toBeNull();
  });

  it('deleteScript 删除并返回 true;不存在返回 false', async () => {
    const s = await loadStore();
    s.saveScript(makeEntry({ id: 'id1' }));
    expect(s.deleteScript('id1')).toBe(true);
    expect(s.listSavedScripts()).toHaveLength(0);
    expect(s.deleteScript('id1')).toBe(false);
  });

  it('clearAllScripts 清空全部', async () => {
    const s = await loadStore();
    s.saveScript(makeEntry({ id: 'id1' }));
    s.saveScript(makeEntry({ id: 'id2' }));
    s.clearAllScripts();
    expect(s.listSavedScripts()).toEqual([]);
  });

  it('listSavedScripts 过滤损坏数据', async () => {
    // 直接塞入无效 JSON
    memStore.setItem('vreen.blockly.scripts', JSON.stringify([
      makeEntry(), // valid
      { id: 'x', name: 'no_workspace', updatedAt: '2026-01-01' }, // 无 workspace
      { id: 123, name: 'bad_id', workspace: {}, updatedAt: '2026' }, // id 非字符串
      'not-an-object',
      null,
    ]));
    const s = await loadStore();
    const list = s.listSavedScripts();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('id1');
  });

  it('listSavedScripts 损坏 JSON 返回 []', async () => {
    memStore.setItem('vreen.blockly.scripts', '{not json');
    const s = await loadStore();
    expect(s.listSavedScripts()).toEqual([]);
  });

  it('listSavedScripts 非数组 JSON 返回 []', async () => {
    memStore.setItem('vreen.blockly.scripts', JSON.stringify({ id: 'x' }));
    const s = await loadStore();
    expect(s.listSavedScripts()).toEqual([]);
  });
});

describe('blocklyScriptStore — JSON 导出/导入 (Phase 3.5)', () => {
  it('exportScriptsToJson 生成合法 JSON 数组', async () => {
    const s = await loadStore();
    const e1 = makeEntry({ id: 'id1' });
    const e2 = makeEntry({ id: 'id2', name: 'b' });
    const json = s.exportScriptsToJson([e1, e2]);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('id1');
    expect(parsed[1].name).toBe('b');
  });

  it('importScriptsFromJson 解析合法 JSON', async () => {
    const s = await loadStore();
    const e1 = makeEntry({ id: 'id1' });
    const e2 = makeEntry({ id: 'id2' });
    const json = JSON.stringify([e1, e2]);
    const result = s.importScriptsFromJson(json);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('id1');
  });

  it('importScriptsFromJson 过滤无效 entry', async () => {
    const s = await loadStore();
    const json = JSON.stringify([
      makeEntry(),
      { id: 'x', name: 'no_ws', updatedAt: '2026' },
      null,
      'string',
    ]);
    const result = s.importScriptsFromJson(json);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('id1');
  });

  it('importScriptsFromJson 损坏 JSON 返回 []', async () => {
    const s = await loadStore();
    expect(s.importScriptsFromJson('{not json')).toEqual([]);
  });

  it('importScriptsFromJson 非数组返回 []', async () => {
    const s = await loadStore();
    expect(s.importScriptsFromJson(JSON.stringify({ id: 'x' }))).toEqual([]);
  });

  it('export→import 往返保持数据一致', async () => {
    const s = await loadStore();
    const e = makeEntry({
      id: 'roundtrip',
      name: 'roundtrip_script',
      workspace: { blocks: { blocks: [{ type: 'vreen_entity_create' }] } },
      generatedCode: 'VREEN.entityCreate();',
    });
    const json = s.exportScriptsToJson([e]);
    const back = s.importScriptsFromJson(json);
    expect(back).toHaveLength(1);
    expect(back[0]).toEqual(e);
  });
});

describe('blocklyScriptStore — serialize/deserialize (Phase 3.5)', () => {
  it('serializeWorkspace 调用 Blockly.serialization.workspaces.save', async () => {
    const s = await loadStore();
    const fakeWs = { id: 'ws1' } as unknown as import('blockly/core').WorkspaceSvg;
    const savedState = { blocks: { blocks: [] } };
    mockSave.mockReturnValue(savedState);

    const entry = s.serializeWorkspace(fakeWs, 'my_script');
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave).toHaveBeenCalledWith(fakeWs);
    expect(entry.name).toBe('my_script');
    expect(entry.workspace).toEqual(savedState);
    expect(entry.id).toBeTruthy();
    expect(typeof entry.id).toBe('string');
    expect(new Date(entry.updatedAt).getTime()).not.toBeNaN();
  });

  it('serializeWorkspace 用传入的 id', async () => {
    const s = await loadStore();
    const fakeWs = {} as unknown as import('blockly/core').WorkspaceSvg;
    mockSave.mockReturnValue({});
    const entry = s.serializeWorkspace(fakeWs, 'x', 'fixed_id_123');
    expect(entry.id).toBe('fixed_id_123');
  });

  it('serializeWorkspace 不传 id 时自动生成', async () => {
    const s = await loadStore();
    const fakeWs = {} as unknown as import('blockly/core').WorkspaceSvg;
    mockSave.mockReturnValue({});
    const e1 = s.serializeWorkspace(fakeWs, 'a');
    const e2 = s.serializeWorkspace(fakeWs, 'b');
    expect(e1.id).toBeTruthy();
    expect(e2.id).toBeTruthy();
    expect(e1.id).not.toBe(e2.id);
  });

  it('deserializeIntoWorkspace 调用 Blockly load 并返回 true', async () => {
    const s = await loadStore();
    const fakeWs = { clear: vi.fn() } as unknown as import('blockly/core').WorkspaceSvg;
    const entry = makeEntry({ workspace: { blocks: { blocks: [] } } });
    mockLoad.mockImplementation(() => {});

    const ok = s.deserializeIntoWorkspace(entry, fakeWs);
    expect(ok).toBe(true);
    expect(mockLoad).toHaveBeenCalledTimes(1);
    expect(mockLoad).toHaveBeenCalledWith(entry.workspace, fakeWs);
  });

  it('deserializeIntoWorkspace 先 clear workspace', async () => {
    const s = await loadStore();
    const clearSpy = vi.fn();
    const fakeWs = { clear: clearSpy } as unknown as import('blockly/core').WorkspaceSvg;
    mockLoad.mockImplementation(() => {});
    s.deserializeIntoWorkspace(makeEntry(), fakeWs);
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('deserializeIntoWorkspace workspace 为 undefined 返回 false', async () => {
    const s = await loadStore();
    const fakeWs = { clear: vi.fn() } as unknown as import('blockly/core').WorkspaceSvg;
    const entry = makeEntry({ workspace: undefined as unknown });
    expect(s.deserializeIntoWorkspace(entry, fakeWs)).toBe(false);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('deserializeIntoWorkspace workspace 不是对象返回 false', async () => {
    const s = await loadStore();
    const fakeWs = { clear: vi.fn() } as unknown as import('blockly/core').WorkspaceSvg;
    expect(s.deserializeIntoWorkspace(makeEntry({ workspace: 'string' }), fakeWs)).toBe(false);
    expect(s.deserializeIntoWorkspace(makeEntry({ workspace: 123 }), fakeWs)).toBe(false);
    expect(s.deserializeIntoWorkspace(makeEntry({ workspace: null }), fakeWs)).toBe(false);
    expect(mockLoad).not.toHaveBeenCalled();
  });

  it('deserializeIntoWorkspace load 抛错时返回 false', async () => {
    const s = await loadStore();
    const fakeWs = { clear: vi.fn() } as unknown as import('blockly/core').WorkspaceSvg;
    mockLoad.mockImplementation(() => { throw new Error('bad state'); });
    expect(s.deserializeIntoWorkspace(makeEntry(), fakeWs)).toBe(false);
  });
});
