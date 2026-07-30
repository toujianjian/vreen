// AssetBrowser — 资源浏览器组件。
// 浏览资源文件夹结构,支持网格 / 列表视图切换、搜索过滤、拖拽到场景、
// 资源缩略图 / 图标显示、导入资源、右键菜单(导入 / 删除 / 重命名)。
// 赛博朋克风格(霓虹色 + 暗色背景),复用 HudPanel 框架。

import {
  Box,
  ChevronDown,
  ChevronRight,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  Music,
  Palette,
  Pencil,
  Boxes,
  Search,
  Trash2,
  Upload,
  File as FileIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { cn } from '@/lib/cn';

/** 资源类型。 */
export type AssetType = 'mesh' | 'texture' | 'audio' | 'animation' | 'material' | 'scene' | 'folder';

/** 资源项。 */
export interface AssetItem {
  id: string;
  name: string;
  type: AssetType;
  path: string;
  size: number;
  thumbnailUrl?: string;
  children?: AssetItem[];
}

interface AssetBrowserProps {
  /** 资源列表(根级,文件夹通过 children 递归)。 */
  assets: AssetItem[];
  /** 导入文件回调。 */
  onImport: (files: File[]) => void;
  /** 拖拽到场景回调(拖拽开始时触发)。 */
  onDragToScene: (asset: AssetItem) => void;
  /** 选中资源回调(null 表示取消选中)。 */
  onSelect: (asset: AssetItem | null) => void;
  /** 删除资源回调。 */
  onDelete: (asset: AssetItem) => void;
  /** 重命名资源回调(可选,默认走内部编辑态)。 */
  onRename?: (asset: AssetItem, newName: string) => void;
}

/** 类型 → 图标 + 颜色。 */
const TYPE_STYLE: Record<AssetType, { icon: typeof Box; color: string }> = {
  folder: { icon: Folder, color: 'text-neon-cyan' },
  mesh: { icon: Box, color: 'text-neon-magenta' },
  texture: { icon: ImageIcon, color: 'text-emerald-300' },
  audio: { icon: Music, color: 'text-violet-300' },
  animation: { icon: Film, color: 'text-neon-amber' },
  material: { icon: Palette, color: 'text-pink-300' },
  scene: { icon: Boxes, color: 'text-sky-300' },
};

function styleFor(type: AssetType): { icon: typeof Box; color: string } {
  return TYPE_STYLE[type] ?? { icon: FileIcon, color: 'text-mist' };
}

/** 格式化文件大小。 */
function formatSize(bytes: number): string {
  if (bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 深度优先查找资源。 */
function findAsset(assets: AssetItem[], id: string): AssetItem | null {
  for (const a of assets) {
    if (a.id === id) return a;
    if (a.children) {
      const f = findAsset(a.children, id);
      if (f) return f;
    }
  }
  return null;
}

/** 收集所有文件夹(递归),用于左侧树。 */
function collectFolders(assets: AssetItem[], depth = 0): { node: AssetItem; depth: number }[] {
  const out: { node: AssetItem; depth: number }[] = [];
  for (const a of assets) {
    if (a.type === 'folder') {
      out.push({ node: a, depth });
      if (a.children) out.push(...collectFolders(a.children, depth + 1));
    }
  }
  return out;
}

/** 递归过滤:返回命中自身或后代的非文件夹资源 + 保留命中子树的文件夹。 */
function filterAssets(assets: AssetItem[], q: string): AssetItem[] {
  if (!q) return assets;
  const ql = q.toLowerCase();
  const out: AssetItem[] = [];
  for (const a of assets) {
    const matchSelf = a.name.toLowerCase().includes(ql);
    if (a.type === 'folder' && a.children) {
      const filteredChildren = filterAssets(a.children, q);
      if (matchSelf || filteredChildren.length > 0) {
        out.push({ ...a, children: filteredChildren });
      }
    } else if (matchSelf) {
      out.push(a);
    }
  }
  return out;
}

export function AssetBrowser({
  assets,
  onImport,
  onDragToScene,
  onSelect,
  onDelete,
  onRename,
}: AssetBrowserProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [menu, setMenu] = useState<{ x: number; y: number; asset: AssetItem | null } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const folders = useMemo(() => collectFolders(assets), [assets]);
  const filtered = useMemo(() => filterAssets(assets, search.trim()), [assets, search]);

  // 当前文件夹内容:若 currentFolderId 为 null 显示根级,否则显示该文件夹 children
  const currentContents = useMemo(() => {
    if (search.trim()) return filtered;
    if (currentFolderId === null) return assets;
    const folder = findAsset(assets, currentFolderId);
    return folder?.children ?? [];
  }, [assets, filtered, search, currentFolderId]);

  // 首次加载:默认展开第一层文件夹
  useEffect(() => {
    setExpandedFolders((prev) => {
      if (prev.size > 0) return prev;
      const next = new Set<string>();
      for (const a of assets) {
        if (a.type === 'folder') next.add(a.id);
      }
      return next;
    });
  }, [assets]);

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

  const toggleFolder = (id: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelect = (asset: AssetItem) => {
    setSelectedId(asset.id);
    onSelect(asset);
    if (asset.type === 'folder') {
      setCurrentFolderId(asset.id);
      if (!expandedFolders.has(asset.id)) toggleFolder(asset.id);
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onImport(Array.from(files));
    }
    // 重置 input 以便相同文件可再次选择
    e.target.value = '';
  };

  const startRename = (asset: AssetItem) => {
    setEditingId(asset.id);
    setEditValue(asset.name);
  };

  const commitRename = (asset: AssetItem) => {
    if (editValue.trim() && onRename) {
      onRename(asset, editValue.trim());
    }
    setEditingId(null);
    setEditValue('');
  };

  const handleDragStart = (e: React.DragEvent, asset: AssetItem) => {
    if (asset.type === 'folder') return;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/asset-id', asset.id);
    onDragToScene(asset);
  };

  const handleContext = (e: React.MouseEvent, asset: AssetItem | null) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, asset });
  };

  return (
    <HudPanel
      title={t('assetBrowser.title')}
      tag="ASSETS"
      className="h-full flex flex-col"
      bodyClassName="flex-1 min-h-0 flex flex-col"
      headerExtra={
        <button
          onClick={handleImportClick}
          className="hud-btn hud-btn-ghost !py-0.5 text-[9px]"
          title={t('assetBrowser.import')}
        >
          <Upload className="w-3 h-3" />
        </button>
      }
    >
      {/* 隐藏文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {/* 顶部工具栏 */}
      <div className="shrink-0 px-3 py-2 border-b border-neon-cyan/10 flex items-center gap-2">
        <Search className="w-3 h-3 text-mist shrink-0" />
        <input
          className="hud-input !border-0 !bg-transparent !px-0 !py-0 flex-1"
          placeholder={t('assetBrowser.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setViewMode('grid')}
            className={cn(
              'p-1 transition-colors',
              viewMode === 'grid' ? 'text-neon-cyan' : 'text-mist hover:text-haze',
            )}
            title={t('assetBrowser.gridView')}
          >
            <LayoutGrid className="w-3 h-3" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'p-1 transition-colors',
              viewMode === 'list' ? 'text-neon-cyan' : 'text-mist hover:text-haze',
            )}
            title={t('assetBrowser.listView')}
          >
            <ListIcon className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 主体:左侧文件夹树 + 右侧资源网格/列表 */}
      <div className="flex-1 min-h-0 flex">
        {/* 左侧文件夹树 */}
        <div
          className="w-40 shrink-0 border-r border-neon-cyan/10 overflow-y-auto py-1 text-[12px] font-mono"
          onContextMenu={(e) => handleContext(e, null)}
        >
          {/* 根级 */}
          <FolderRow
            node={{ id: '__root__', name: t('assetBrowser.root'), type: 'folder', path: '/', size: 0, children: assets }}
            depth={0}
            isRoot
            isOpen={currentFolderId === null}
            expanded={expandedFolders}
            currentFolderId={currentFolderId}
            onToggle={() => setCurrentFolderId(null)}
          />
          {folders.map(({ node, depth }) => (
            <FolderRow
              key={node.id}
              node={node}
              depth={depth}
              isOpen={expandedFolders.has(node.id)}
              expanded={expandedFolders}
              currentFolderId={currentFolderId}
              onToggle={toggleFolder}
            />
          ))}
        </div>

        {/* 右侧资源网格/列表 */}
        <div
          className="flex-1 min-h-0 overflow-y-auto p-2"
          onContextMenu={(e) => handleContext(e, null)}
        >
          {currentContents.length === 0 ? (
            <div className="h-full flex items-center justify-center text-mist text-[11px]">
              {t('assetBrowser.empty')}
            </div>
          ) : viewMode === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
              {currentContents.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  selected={selectedId === asset.id}
                  editing={editingId === asset.id}
                  editValue={editValue}
                  onSelect={handleSelect}
                  onDragStart={handleDragStart}
                  onContext={handleContext}
                  onEditChange={setEditValue}
                  onCommitRename={() => commitRename(asset)}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col">
              {currentContents.map((asset) => (
                <AssetListRow
                  key={asset.id}
                  asset={asset}
                  selected={selectedId === asset.id}
                  editing={editingId === asset.id}
                  editValue={editValue}
                  onSelect={handleSelect}
                  onDragStart={handleDragStart}
                  onContext={handleContext}
                  onEditChange={setEditValue}
                  onCommitRename={() => commitRename(asset)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右键菜单 */}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          asset={menu.asset}
          onImport={() => {
            handleImportClick();
            setMenu(null);
          }}
          onDelete={() => {
            if (menu.asset) onDelete(menu.asset);
            setMenu(null);
          }}
          onRename={() => {
            if (menu.asset) startRename(menu.asset);
            setMenu(null);
          }}
        />
      )}
    </HudPanel>
  );
}

// ── 文件夹树行 ────────────────────────────────────────────

interface FolderRowProps {
  node: AssetItem;
  depth: number;
  isRoot?: boolean;
  isOpen: boolean;
  expanded: Set<string>;
  currentFolderId: string | null;
  onToggle: (id: string) => void;
}

function FolderRow({
  node,
  depth,
  isRoot,
  isOpen,
  currentFolderId,
  onToggle,
}: FolderRowProps) {
  const Icon = isRoot || isOpen ? FolderOpen : Folder;
  const isActive = isRoot ? currentFolderId === null : currentFolderId === node.id;
  return (
    <div
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors',
        isActive ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-haze/85 hover:bg-neon-cyan/5 hover:text-haze',
      )}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      onClick={() => onToggle(node.id)}
    >
      {!isRoot && (
        <span className="w-3 h-3 flex items-center justify-center text-mist shrink-0">
          {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </span>
      )}
      <Icon className={cn('w-3 h-3 shrink-0', isRoot ? 'text-neon-cyan' : 'text-neon-cyan/80')} />
      <span className="truncate flex-1">{node.name}</span>
    </div>
  );
}

// ── 资源卡片(网格视图) ──────────────────────────────────

interface AssetCardProps {
  asset: AssetItem;
  selected: boolean;
  editing: boolean;
  editValue: string;
  onSelect: (asset: AssetItem) => void;
  onDragStart: (e: React.DragEvent, asset: AssetItem) => void;
  onContext: (e: React.MouseEvent, asset: AssetItem) => void;
  onEditChange: (v: string) => void;
  onCommitRename: () => void;
}

function AssetCard({
  asset,
  selected,
  editing,
  editValue,
  onSelect,
  onDragStart,
  onContext,
  onEditChange,
  onCommitRename,
}: AssetCardProps) {
  const { t } = useTranslation();
  const style = styleFor(asset.type);
  const Icon = style.icon;
  return (
    <div
      className={cn(
        'group flex flex-col items-center gap-1 p-2 border transition-colors cursor-pointer',
        selected
          ? 'border-neon-cyan/60 bg-neon-cyan/10'
          : 'border-neon-cyan/10 hover:border-neon-cyan/30 hover:bg-neon-cyan/5',
      )}
      draggable={!editing && asset.type !== 'folder'}
      onDragStart={(e) => onDragStart(e, asset)}
      onClick={() => onSelect(asset)}
      onContextMenu={(e) => onContext(e, asset)}
      title={t('assetBrowser.dragToScene')}
    >
      <div className="w-full aspect-square flex items-center justify-center bg-space-900/60 border border-neon-cyan/5 overflow-hidden">
        {asset.thumbnailUrl ? (
          <img
            src={asset.thumbnailUrl}
            alt={asset.name}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <Icon className={cn('w-7 h-7', style.color)} />
        )}
      </div>
      {editing ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename();
            if (e.key === 'Escape') onCommitRename();
          }}
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-space-900/60 border border-neon-cyan/40 px-1 text-[10px] text-haze focus:outline-none text-center"
        />
      ) : (
        <span className="truncate w-full text-center text-[10px] text-haze/90">{asset.name}</span>
      )}
      <span className="text-[9px] text-mist/60 tracking-[0.08em]">
        {asset.type === 'folder' ? t('assetBrowser.folder') : formatSize(asset.size)}
      </span>
    </div>
  );
}

// ── 资源列表行(列表视图) ────────────────────────────────

function AssetListRow({
  asset,
  selected,
  editing,
  editValue,
  onSelect,
  onDragStart,
  onContext,
  onEditChange,
  onCommitRename,
}: AssetCardProps) {
  const { t } = useTranslation();
  const style = styleFor(asset.type);
  const Icon = style.icon;
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors text-[12px] font-mono',
        selected
          ? 'bg-neon-cyan/10 text-neon-cyan'
          : 'text-haze/85 hover:bg-neon-cyan/5 hover:text-haze',
      )}
      draggable={!editing && asset.type !== 'folder'}
      onDragStart={(e) => onDragStart(e, asset)}
      onClick={() => onSelect(asset)}
      onContextMenu={(e) => onContext(e, asset)}
    >
      <Icon className={cn('w-3.5 h-3.5 shrink-0', style.color)} />
      {editing ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => onEditChange(e.target.value)}
          onBlur={onCommitRename}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onCommitRename();
            if (e.key === 'Escape') onCommitRename();
          }}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 bg-space-900/60 border border-neon-cyan/40 px-1 text-[11px] text-haze focus:outline-none"
        />
      ) : (
        <span className="truncate flex-1">{asset.name}</span>
      )}
      <span className="text-[9px] text-mist/60 tracking-[0.12em] shrink-0 uppercase">
        {asset.type}
      </span>
      <span className="text-[10px] text-mist/70 shrink-0 w-16 text-right">
        {asset.type === 'folder' ? t('assetBrowser.folder') : formatSize(asset.size)}
      </span>
    </div>
  );
}

// ── 右键菜单 ──────────────────────────────────────────────

function ContextMenu({
  x,
  y,
  asset,
  onImport,
  onDelete,
  onRename,
}: {
  x: number;
  y: number;
  asset: AssetItem | null;
  onImport: () => void;
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
        onClick={onImport}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono text-haze hover:bg-neon-cyan/10 hover:text-neon-cyan"
      >
        <Upload className="w-3 h-3" /> {t('assetBrowser.import')}
      </button>
      {asset && (
        <>
          <button
            onClick={onRename}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono text-haze hover:bg-neon-cyan/10 hover:text-neon-cyan"
          >
            <Pencil className="w-3 h-3" /> {t('assetBrowser.rename')}
          </button>
          <button
            onClick={onDelete}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[11px] font-mono text-haze hover:bg-neon-magenta/10 hover:text-neon-magenta"
          >
            <Trash2 className="w-3 h-3" /> {t('assetBrowser.delete')}
          </button>
        </>
      )}
    </div>
  );
}
