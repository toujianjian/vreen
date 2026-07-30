// SceneHierarchy — 场景树 / 对象层级面板。
// 显示场景中所有对象层级,支持展开 / 折叠 / 选择 / 拖拽排序 / 右键菜单 / 搜索过滤。
// 赛博朋克风格 (霓虹色 + 暗色背景),复用 HudPanel 框架。

import {
  Box,
  Camera,
  ChevronDown,
  ChevronRight,
  Circle,
  EyeOff,
  FolderTree,
  Lightbulb,
  Pencil,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { cn } from '@/lib/cn';

/** 归一化后的层级节点 (与引擎 Object3D / three.js 对象兼容)。 */
export interface HierarchyNode {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  children: HierarchyNode[];
}

interface SceneHierarchyProps {
  /** 场景对象:可以是单个根 / 数组 / Object3D-like (含 children) / null。 */
  scene: unknown;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (parentId: string | null) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (draggedId: string, targetId: string) => void;
}

/** 类型 → 图标 + 颜色。 */
const TYPE_STYLE: Record<string, { icon: typeof Box; color: string }> = {
  Scene: { icon: FolderTree, color: 'text-neon-cyan' },
  Group: { icon: FolderTree, color: 'text-neon-cyan' },
  Object3D: { icon: FolderTree, color: 'text-neon-cyan' },
  WorldRoot: { icon: FolderTree, color: 'text-neon-cyan' },
  Mesh: { icon: Box, color: 'text-neon-magenta' },
  SkinnedMesh: { icon: Box, color: 'text-neon-magenta' },
  InstancedMesh: { icon: Box, color: 'text-neon-magenta' },
  Bone: { icon: Circle, color: 'text-neon-amber' },
  Light: { icon: Lightbulb, color: 'text-emerald-300' },
  Camera: { icon: Camera, color: 'text-violet-300' },
  Sprite: { icon: Circle, color: 'text-mist' },
};

function styleFor(type: string): { icon: typeof Box; color: string } {
  return TYPE_STYLE[type] ?? { icon: Circle, color: 'text-mist' };
}

/** 把任意 scene 对象归一化为 HierarchyNode 树。兼容引擎 Object3D / three.js / 自定义树。 */
function normalize(scene: unknown): HierarchyNode[] {
  if (!scene) return [];
  const roots = Array.isArray(scene) ? scene : [scene];
  return roots.map(walk).filter((n): n is HierarchyNode => n !== null);
}

function walk(obj: unknown): HierarchyNode | null {
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const id = String(o.uuid ?? o.id ?? o.name ?? Math.random().toString(36).slice(2));
  const childrenRaw = Array.isArray(o.children) ? o.children : [];
  const children = childrenRaw
    .map(walk)
    .filter((n): n is HierarchyNode => n !== null);
  return {
    id,
    name: typeof o.name === 'string' && o.name ? o.name : '(unnamed)',
    type: typeof o.type === 'string' ? o.type : 'Object3D',
    visible: o.visible !== false,
    children,
  };
}

/** 递归过滤:保留命中自身或后代的节点 (搜索时展开命中子树)。 */
function filterTree(node: HierarchyNode, q: string): HierarchyNode | null {
  if (!q) return node;
  const matchSelf = node.name.toLowerCase().includes(q.toLowerCase());
  const matchedChildren = node.children
    .map((c) => filterTree(c, q))
    .filter((c): c is HierarchyNode => c !== null);
  if (matchSelf || matchedChildren.length > 0) {
    return { ...node, children: matchedChildren };
  }
  return null;
}

/** 深度优先查找节点。 */
function findNode(roots: HierarchyNode[], id: string): HierarchyNode | null {
  for (const r of roots) {
    if (r.id === id) return r;
    const f = findNode(r.children, id);
    if (f) return f;
  }
  return null;
}

export function SceneHierarchy({
  scene,
  selectedId,
  onSelect,
  onAdd,
  onDelete,
  onRename,
  onReorder,
}: SceneHierarchyProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId: string | null } | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const roots = useMemo(() => normalize(scene), [scene]);
  const filtered = useMemo(
    () =>
      roots
        .map((n) => filterTree(n, search.trim()))
        .filter((n): n is HierarchyNode => n !== null),
    [roots, search],
  );

  // 首次加载:默认展开根节点
  useEffect(() => {
    setExpanded((prev) => {
      if (prev.size > 0 || roots.length === 0) return prev;
      return new Set(roots.map((r) => r.id));
    });
  }, [roots]);

  // 点击外部 / Esc 关闭右键菜单
  useEffect(() => {
    if (!menu) return;
    const onDoc = () => setMenu(null);
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menu]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRename = (id: string, currentName: string) => {
    setEditingId(id);
    setEditValue(currentName);
  };

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  };

  const handleContext = (e: React.MouseEvent, nodeId: string | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, nodeId });
  };

  return (
    <HudPanel
      title={t('editor.sceneHierarchy')}
      tag="HIERARCHY"
      className="h-full flex flex-col"
      bodyClassName="flex-1 min-h-0 flex flex-col"
      headerExtra={
        <button
          onClick={() => onAdd(null)}
          className="hud-btn hud-btn-ghost !py-0.5 text-[9px]"
          title={t('editor.add')}
        >
          <Plus className="w-3 h-3" />
        </button>
      }
    >
      {/* 搜索框 */}
      <div className="shrink-0 px-3 py-2 border-b border-neon-cyan/10 flex items-center gap-2">
        <Search className="w-3 h-3 text-mist shrink-0" />
        <input
          className="hud-input !border-0 !bg-transparent !px-0 !py-0"
          placeholder={t('editor.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* 树 */}
      <div
        className="flex-1 min-h-0 overflow-y-auto py-1 text-[12px] font-mono"
        onContextMenu={(e) => handleContext(e, null)}
      >
        {filtered.length === 0 ? (
          <div className="px-4 py-6 text-mist text-center text-[11px]">
            {t('editor.noScene')}
          </div>
        ) : (
          filtered.map((node) => (
            <HierarchyRow
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              selectedId={selectedId}
              editingId={editingId}
              editValue={editValue}
              draggedId={draggedId}
              onToggle={toggle}
              onSelect={onSelect}
              onContext={handleContext}
              onStartRename={startRename}
              onEditChange={setEditValue}
              onCommitRename={commitRename}
              onDragStart={setDraggedId}
              onDragEnd={() => setDraggedId(null)}
              onDrop={onReorder}
            />
          ))
        )}
      </div>

      {/* 右键菜单 */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          nodeId={menu.nodeId}
          onAdd={() => {
            onAdd(menu.nodeId);
            setMenu(null);
          }}
          onDelete={() => {
            if (menu.nodeId) onDelete(menu.nodeId);
            setMenu(null);
          }}
          onRename={() => {
            if (menu.nodeId) {
              const n = findNode(roots, menu.nodeId);
              if (n) startRename(n.id, n.name);
            }
            setMenu(null);
          }}
        />
      )}
    </HudPanel>
  );
}

interface HierarchyRowProps {
  node: HierarchyNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  editingId: string | null;
  editValue: string;
  draggedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  onContext: (e: React.MouseEvent, nodeId: string | null) => void;
  onStartRename: (id: string, name: string) => void;
  onEditChange: (v: string) => void;
  onCommitRename: () => void;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  onDrop: (draggedId: string, targetId: string) => void;
}

function HierarchyRow(props: HierarchyRowProps) {
  const {
    node,
    depth,
    expanded,
    selectedId,
    editingId,
    editValue,
    draggedId,
    onToggle,
    onSelect,
    onContext,
    onStartRename,
    onEditChange,
    onCommitRename,
    onDragStart,
    onDragEnd,
    onDrop,
  } = props;
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const isEditing = editingId === node.id;
  const isDragging = draggedId === node.id;
  const style = styleFor(node.type);
  const Icon = style.icon;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors',
          isSelected ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-haze/85 hover:bg-neon-cyan/5 hover:text-haze',
          isDragging && 'opacity-40',
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        draggable={!isEditing}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          onDragStart(node.id);
        }}
        onDragEnd={onDragEnd}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (draggedId && draggedId !== node.id) {
            onDrop(draggedId, node.id);
          }
        }}
        onClick={() => {
          onSelect(node.id);
          if (hasChildren) onToggle(node.id);
        }}
        onContextMenu={(e) => onContext(e, node.id)}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onStartRename(node.id, node.name);
        }}
      >
        <span className="w-3 h-3 flex items-center justify-center text-mist shrink-0">
          {hasChildren ? (
            isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
          ) : (
            <span className="w-1 h-1 rounded-full bg-mist/40" />
          )}
        </span>
        <Icon className={cn('w-3 h-3 shrink-0', style.color)} />
        {isEditing ? (
          <input
            autoFocus
            value={editValue}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onCommitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onCommitRename();
              if (e.key === 'Escape') {
                onEditChange(node.name);
                onCommitRename();
              }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-space-900/60 border border-neon-cyan/40 px-1 text-[11px] text-haze focus:outline-none"
          />
        ) : (
          <span className="truncate flex-1">{node.name}</span>
        )}
        <span className="text-[9px] text-mist/60 tracking-[0.16em] shrink-0 uppercase">
          {node.type}
        </span>
        {!node.visible && <EyeOff className="w-3 h-3 text-mist/50 shrink-0" />}
      </div>
      {hasChildren && isOpen && (
        <div>
          {node.children.map((c) => (
            <HierarchyRow key={c.id} {...props} node={c} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function ContextMenu({
  x,
  y,
  nodeId,
  onAdd,
  onDelete,
  onRename,
}: {
  x: number;
  y: number;
  nodeId: string | null;
  onAdd: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed z-50 min-w-[140px] bg-space-900/95 border border-neon-cyan/30 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-md py-1"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={onAdd}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono text-haze hover:bg-neon-cyan/10 hover:text-neon-cyan"
      >
        <Plus className="w-3 h-3" /> {t('editor.addChild')}
      </button>
      {nodeId && (
        <>
          <button
            onClick={onRename}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono text-haze hover:bg-neon-cyan/10 hover:text-neon-cyan"
          >
            <Pencil className="w-3 h-3" /> {t('editor.rename')}
          </button>
          <button
            onClick={onDelete}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono text-haze hover:bg-neon-magenta/10 hover:text-neon-magenta"
          >
            <Trash2 className="w-3 h-3" /> {t('editor.delete')}
          </button>
        </>
      )}
    </div>
  );
}
