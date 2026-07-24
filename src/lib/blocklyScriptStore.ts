// blocklyScriptStore — Blockly 脚本的序列化/反序列化与 localStorage 持久化。
//
// Phase 3.5: Blockly 脚本保存/加载
//
// 功能:
//   • workspace ↔ VreenScriptEntry 互转
//   • localStorage 持久化(简单方案,不依赖 .vreen 包)
//   • 列出/删除已保存脚本
//   • 导出/导入为 JSON 文件(可嵌入 .vreen 包的 scene.scripts)

import * as Blockly from 'blockly/core';
import type { VreenScriptEntry } from '@/lib/vreenManifest';

const STORAGE_KEY = 'vreen.blockly.scripts';

/** 从 Blockly workspace 序列化为 VreenScriptEntry。 */
export function serializeWorkspace(ws: Blockly.WorkspaceSvg, name: string, id?: string): VreenScriptEntry {
  // Blockly 原生序列化 API
  const workspaceJson = Blockly.serialization.workspaces.save(ws);
  return {
    id: id ?? cryptoRandId(),
    name,
    workspace: workspaceJson,
    updatedAt: new Date().toISOString(),
  };
}

/** 把 VreenScriptEntry 反序列化到 Blockly workspace。
 *  返回是否成功(脚本 workspace 数据无效时返回 false)。 */
export function deserializeIntoWorkspace(entry: VreenScriptEntry, ws: Blockly.WorkspaceSvg): boolean {
  if (!entry.workspace || typeof entry.workspace !== 'object') return false;
  try {
    ws.clear();
    // Blockly.serialization.workspaces.load 接受 `{ [key: string]: any }` 形式的 state 对象。
    Blockly.serialization.workspaces.load(
      entry.workspace as { [key: string]: unknown },
      ws,
    );
    return true;
  } catch {
    return false;
  }
}

// ── localStorage 持久化 ─────────────────────────────────────

/** 列出 localStorage 中已保存的所有脚本。 */
export function listSavedScripts(): VreenScriptEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isValidEntry);
  } catch {
    return [];
  }
}

/** 保存/更新一个脚本到 localStorage。
 *  如果 id 已存在则覆盖,否则新增。返回最终 entry。 */
export function saveScript(entry: VreenScriptEntry): VreenScriptEntry {
  const scripts = listSavedScripts();
  const idx = scripts.findIndex((s) => s.id === entry.id);
  const updated: VreenScriptEntry = { ...entry, updatedAt: new Date().toISOString() };
  if (idx >= 0) {
    scripts[idx] = updated;
  } else {
    scripts.push(updated);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  return updated;
}

/** 从 localStorage 删除指定 id 的脚本。返回是否删除了。 */
export function deleteScript(id: string): boolean {
  const scripts = listSavedScripts();
  const idx = scripts.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  scripts.splice(idx, 1);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  return true;
}

/** 按 id 查找已保存的脚本。 */
export function getScript(id: string): VreenScriptEntry | null {
  return listSavedScripts().find((s) => s.id === id) ?? null;
}

/** 清空所有已保存脚本。 */
export function clearAllScripts(): void {
  localStorage.removeItem(STORAGE_KEY);
}

// ── 导出/导入 JSON ───────────────────────────────────────────

/** 把脚本列表导出为 JSON 字符串(可保存为文件或嵌入 .vreen)。 */
export function exportScriptsToJson(scripts: VreenScriptEntry[]): string {
  return JSON.stringify(scripts, null, 2);
}

/** 从 JSON 字符串导入脚本列表。返回解析后的数组(无效时返回空)。 */
export function importScriptsFromJson(json: string): VreenScriptEntry[] {
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

// ── 辅助 ─────────────────────────────────────────────────────

function isValidEntry(x: unknown): x is VreenScriptEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Partial<VreenScriptEntry>;
  return typeof e.id === 'string'
    && typeof e.name === 'string'
    && e.workspace !== undefined
    && typeof e.updatedAt === 'string';
}

/** 生成一个 8 字符的随机 ID。 */
function cryptoRandId(): string {
  const bytes = new Uint8Array(4);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    // Fallback (非加密场景)
    for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}
