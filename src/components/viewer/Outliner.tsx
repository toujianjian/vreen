// Outliner — left panel showing scene tree.
import { ChevronDown, ChevronRight, Eye, FolderTree, Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { useViewerStore } from '@/stores/viewerStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { useUIStore } from '@/stores/uiStore';
import type { SceneNode } from '@/types';
import { cn } from '@/lib/cn';

const KIND_COLOR: Record<string, string> = {
  Group: 'text-neon-cyan',
  Mesh: 'text-neon-magenta',
  Bone: 'text-neon-amber',
  Light: 'text-emerald-300',
  Camera: 'text-violet-300',
  Other: 'text-mist',
};

export function Outliner() {
  const { t } = useTranslation();
  const showOutliner = useUIStore((s) => s.showOutliner);
  const sceneTree = useViewerStore((s) => s.sceneTree);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const filteredRoots = sceneTree
    .map((n) => filterTree(n, search))
    .filter((n): n is SceneNode => n !== null);
  const isEmpty = filteredRoots.length === 0;

  if (!showOutliner) return null;

  return (
    <HudPanel title={t('viewer.outliner')} tag={t('viewer.outlinerTag')} className="h-full">
      <div className="px-3 py-2 border-b border-neon-cyan/10 flex items-center gap-2">
        <Search className="w-3 h-3 text-mist shrink-0" />
        <input
          className="hud-input !border-0 !bg-transparent !px-0 !py-0"
          placeholder={t('viewer.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="overflow-y-auto h-[calc(100%-90px)] py-2 text-[12px] font-mono">
        {isEmpty ? (
          <div className="px-4 py-6 text-mist text-center text-[11px]">{t('viewer.noMatch')}</div>
        ) : (
          filteredRoots.map((node) => (
            <TreeNode
              key={node.id}
              node={node}
              depth={0}
              expanded={expanded}
              onToggle={(id) => {
                const next = new Set(expanded);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                setExpanded(next);
              }}
            />
          ))
        )}
      </div>
    </HudPanel>
  );
}

function filterTree(node: SceneNode, q: string): SceneNode | null {
  if (!q) return node;
  const matchSelf = node.name.toLowerCase().includes(q.toLowerCase());
  const matchedChildren = node.children
    .map((c) => filterTree(c, q))
    .filter((c): c is SceneNode => c !== null);
  if (matchSelf || matchedChildren.length > 0) {
    return { ...node, children: matchedChildren };
  }
  return null;
}

interface TreeNodeProps {
  node: SceneNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (id: string) => void;
}

function TreeNode({ node, depth, expanded, onToggle }: TreeNodeProps) {
  const { t } = useTranslation();
  const setSelection = useInspectorStore((s) => s.setSelection);
  const selectedUuid = useInspectorStore((s) => s.selectedUuid);
  const hasChildren = node.children.length > 0;
  const isOpen = expanded.has(node.id);
  const isSelected = selectedUuid === node.uuid;
  const label = t(`outliner.nodes.${node.name}`, { defaultValue: node.name });

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors',
          isSelected ? 'bg-neon-cyan/10 text-neon-cyan' : 'text-haze/85 hover:bg-neon-cyan/5 hover:text-haze',
        )}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => {
          setSelection(node.uuid, label, node.type, Math.round(node.triCount));
          if (hasChildren) onToggle(node.id);
        }}
      >
        <span className="w-3 h-3 flex items-center justify-center text-mist shrink-0">
          {hasChildren ? (
            isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />
          ) : (
            <span className="w-1 h-1 rounded-full bg-mist/40" />
          )}
        </span>
        <FolderTree className={cn('w-3 h-3 shrink-0', KIND_COLOR[node.type] ?? 'text-mist')} />
        <span className="truncate flex-1">{label}</span>
        {node.triCount > 0 && (
          <span className="text-[9px] text-mist tabular-nums shrink-0">
            {Math.round(node.triCount).toLocaleString()}
          </span>
        )}
        <span className="text-mist opacity-0 group-hover:opacity-100">
          <Eye className="w-3 h-3" />
        </span>
      </div>
      {hasChildren && isOpen && (
        <div>
          {node.children.map((c) => (
            <TreeNode
              key={c.id}
              node={c}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
