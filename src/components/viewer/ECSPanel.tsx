// ECSPanel — Inspector 子面板,可视化当前 World 的 entity / component 树。
//
// 读 useWorldStore 拿到 World 引用 (不可序列化,直接持引用) + version 触发刷新。
// 不把 entity 列表塞进 zustand state,因为 world 自己就是 source of truth。

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronRight,
  Cpu,
  Hash,
  Layers,
  ListTree,
  Move,
  Pause,
  Play,
  Plus,
  Trash2,
  X,
  Camera,
  GitCompare,
  ChevronDown,
  Filter,
} from 'lucide-react';
import { useWorldStore } from '@/stores/worldStore';
import { useViewerStore } from '@/stores/viewerStore';
import type { AnimStateRuntime, EntityId, EntitySnapshot, EntitySummary, SystemTiming, WorldSnapshot, WorldDiff } from '@/engine/ECS';
import { PlayerInputC, ComponentTypeRegistry, World } from '@/engine/ECS';
import type { ComponentType } from '@/engine/ECS/ComponentType';
import {
  Health,
  Lifetime,
  PlayerInput,
  Tag,
  Transform,
  Velocity,
} from '@/engine/ECS/Components';
import { cn } from '@/lib/cn';
import { Activity } from 'lucide-react';
import { EntityGraph } from './EntityGraph';

export function ECSPanel() {
  const { t } = useTranslation();
  // version 是 World 变化的 signal;读这个会订阅
  const version = useWorldStore((s) => s.version);
  const world = useWorldStore((s) => s.world);
  const removeEntity = useWorldStore((s) => s.removeEntity);
  const ecsMovementEnabled = useWorldStore((s) => s.ecsMovementEnabled);
  const setEcsMovementEnabled = useWorldStore((s) => s.setEcsMovementEnabled);
  const [selectedId, setSelectedId] = useState<EntityId | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  /** 多选组件过滤器:必须同时拥有这些组件的 entity 才显示。空 Set = 不过滤。 */
  const [requiredComponents, setRequiredComponents] = useState<Set<string>>(new Set());
  const [snapshots, setSnapshots] = useState<WorldSnapshot[]>([]);
  const [diffResult, setDiffResult] = useState<WorldDiff | null>(null);
  /** diff 详情的展开状态:{added|removed|modified, expanded?} */
  const [diffExpanded, setDiffExpanded] = useState<{ added: boolean; removed: boolean; modified: boolean }>({
    added: false, removed: false, modified: false,
  });
  // useViewerStore 必须提前调,否则 world 从 null→非 null 时 hook 顺序会变
  const useCustomRenderer = useViewerStore((s) => s.useCustomRenderer);

  // 每次 version / world 变化时,重新 listEntities (便宜,无副作用)
  const entities = useMemo<EntitySummary[]>(() => {
    void version; // 显式让 eslint 知道依赖
    return world ? world.listEntities() : [];
  }, [world, version]);

  const snapshot = useMemo<EntitySnapshot | null>(() => {
    if (!world || selectedId == null) return null;
    return world.getEntitySnapshot(selectedId);
  }, [world, selectedId, version]);

  // 选中的 entity 若有 AnimState,从 world 直接读 runtime 数据(state machine 当前 state 等)。
  const animRuntime = useMemo(() => {
    if (!world || selectedId == null) return null;
    // version 触发刷新
    void version;
    return world.getAnimStateRuntime(selectedId);
  }, [world, selectedId, version]);

  // 实体创建/删除工具
  const handleCreateEntity = () => {
    if (!world) return;
    const id = world.createEntity(`Entity_${world.entityCount()}`);
    setSelectedId(id);
  };
  const handleDestroyEntity = (id: EntityId) => {
    if (!world) return;
    if (selectedId === id) setSelectedId(null);
    world.destroyEntity(id);
  };

  const systemTimings = useMemo<readonly SystemTiming[]>(() => {
    void version;
    return world ? world.getSystemTimings() : [];
  }, [world, version]);

  // 实体搜索/筛选:文本匹配 + 必须拥有所有 required 组件
  const filteredEntities = useMemo<EntitySummary[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    const noText = !q;
    const noComp = requiredComponents.size === 0;
    if (noText && noComp) return entities;
    return entities.filter((e) => {
      // 文本过滤
      if (!noText) {
        const hit =
          e.name.toLowerCase().includes(q) ||
          e.components.some((c) => c.toLowerCase().includes(q));
        if (!hit) return false;
      }
      // 组件过滤:必须全部命中(AND)
      if (!noComp) {
        for (const req of requiredComponents) {
          if (!e.components.includes(req)) return false;
        }
      }
      return true;
    });
  }, [entities, searchQuery, requiredComponents]);

  // 快捷键:Ctrl/Cmd+Shift+S 快速拍快照
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        if (!world) return;
        e.preventDefault();
        const snap = world.takeSnapshot();
        setSnapshots((prev) => [...prev.slice(-4), snap]);
        setDiffResult(null);
        setDiffExpanded({ added: false, removed: false, modified: false });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [world]);

  if (!world) {
    return (
      <div className="text-mist text-[11px] font-mono px-1 py-2 leading-relaxed">
        {t('ecs.empty', { defaultValue: 'No ECS World yet. Load a model to populate entities.' })}
      </div>
    );
  }

  const systems = world.getSystems();
  // 已在上方提前调了 useViewerStore,直接用变量
  const backend = useCustomRenderer ? 'CUSTOM · WebGL2' : 'THREE · r3f';

  return (
    <div className="space-y-2.5">
      {/* Header: world identity + active render backend */}
      <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
        <Stat label="WORLD" value={world.name} mono />
        <Stat label="FRAME" value={String(world.frame())} mono accent />
        <Stat label="ENTITIES" value={String(world.entityCount())} mono accent />
        <Stat label="SYSTEMS" value={String(systems.length)} mono />
        <div className="col-span-2 border border-neon-cyan/20 bg-space-800/50 px-2 py-1 flex items-center gap-2">
          <span className="text-[9px] tracking-[0.18em] text-mist">BACKEND</span>
          <span className={cn('font-mono', useCustomRenderer ? 'text-neon-cyan' : 'text-neon-magenta')}>
            {backend}
          </span>
        </div>
      </div>

      {/* Phase 2 演示:ECS → 渲染 桥接开关 */}
      <button
        onClick={() => setEcsMovementEnabled(!ecsMovementEnabled)}
        className={cn(
          'w-full flex items-center gap-2 px-2 py-1.5 border transition-colors text-left',
          ecsMovementEnabled
            ? 'border-neon-magenta bg-neon-magenta/10 text-neon-magenta'
            : 'border-neon-cyan/20 text-haze/85 hover:border-neon-cyan/40',
        )}
        title="Toggle ECS → render bridge (MovementSystem drives root)"
      >
        {ecsMovementEnabled ? (
          <Pause className="w-3 h-3 shrink-0" />
        ) : (
          <Play className="w-3 h-3 shrink-0" />
        )}
        <Move className="w-3 h-3 shrink-0 text-mist" />
        <div className="flex-1">
          <div className="font-mono text-[10px]">ECS → RENDER BRIDGE</div>
          <div className="text-[9px] text-mist">
            {ecsMovementEnabled
              ? 'MovementSystem drives three.js root · position/rotation live'
              : 'click to let MovementSystem move the root entity'}
          </div>
        </div>
        <span
          className={cn(
            'font-mono text-[9px] tracking-[0.18em] px-1',
            ecsMovementEnabled ? 'text-neon-magenta' : 'text-mist',
          )}
        >
          {ecsMovementEnabled ? 'ON' : 'OFF'}
        </span>
      </button>

      {/* System list */}
      <div>
        <div className="hud-label mb-1 flex items-center gap-1.5">
          <Cpu className="w-3 h-3" />
          <span>SYSTEMS · {systems.length}</span>
        </div>
        <SystemTimingList systems={systems} timings={systemTimings} />
      </div>

      {/* Entity list */}
      <div>
        <div className="hud-label mb-1 flex items-center gap-1.5">
          <ListTree className="w-3 h-3" />
          <span>ENTITIES · {filteredEntities.length}{filteredEntities.length !== entities.length ? ` / ${entities.length}` : ''}</span>
          <span className="flex-1" />
          <button
            onClick={handleCreateEntity}
            disabled={!world}
            className="hud-btn hud-btn-ghost text-[9px] disabled:opacity-40 !py-0.5"
            title="create new entity"
          >
            <Plus className="w-3 h-3" />
          </button>
        </div>
        {entities.length > 0 && (
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="filter: name or component…"
            className="w-full mb-1 bg-space-900/50 border border-neon-cyan/20 px-1.5 py-0.5 text-[10px] font-mono text-haze placeholder:text-mist/50 focus:border-neon-cyan focus:outline-none"
          />
        )}
        {entities.length > 0 && (
          <ComponentFilterChips
            entities={entities}
            selected={requiredComponents}
            onChange={setRequiredComponents}
          />
        )}
        {entities.length > 0 && entities.length <= 32 && (
          <EntityGraph
            entities={filteredEntities}
            selectedEntityId={selectedId}
            onSelectEntity={setSelectedId}
            width={400}
            height={200}
          />
        )}
        {entities.length === 0 ? (
          <div className="text-mist text-[10px] font-mono">no entities</div>
        ) : filteredEntities.length === 0 ? (
          <div className="text-mist text-[10px] font-mono">no match for "{searchQuery}"</div>
        ) : (
          <ul className="font-mono text-[10px] space-y-0.5 max-h-48 overflow-y-auto">
            {filteredEntities.map((e) => (
              <li key={e.id} className="group flex items-stretch gap-0.5">
                <button
                  onClick={() => setSelectedId(e.id)}
                  className={cn(
                    'flex-1 flex items-center gap-1.5 px-1.5 py-1 text-left border transition-colors min-w-0',
                    selectedId === e.id
                      ? 'border-neon-magenta bg-neon-magenta/5 text-neon-magenta'
                      : 'border-neon-cyan/10 text-haze/85 hover:border-neon-cyan/40 hover:text-haze',
                  )}
                >
                  <ChevronRight
                    className={cn(
                      'w-3 h-3 shrink-0',
                      selectedId === e.id ? 'text-neon-magenta' : 'text-mist',
                    )}
                  />
                  <span className="truncate flex-1">{e.name || '(unnamed)'}</span>
                  <span className="text-mist shrink-0">#{e.id}</span>
                  <span className="text-neon-cyan shrink-0">×{e.components.length}</span>
                </button>
                <button
                  onClick={(ev) => {
                    ev.stopPropagation();
                    handleDestroyEntity(e.id);
                  }}
                  className="px-1 border border-neon-cyan/10 text-mist hover:text-neon-magenta hover:border-neon-magenta/40 opacity-0 group-hover:opacity-100"
                  title="destroy entity"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Snapshots / diff */}
      <SnapshotPanel
        world={world}
        snapshots={snapshots}
        setSnapshots={setSnapshots}
        diffResult={diffResult}
        setDiffResult={setDiffResult}
        diffExpanded={diffExpanded}
        setDiffExpanded={setDiffExpanded}
      />

      {/* Selected entity detail */}
      {snapshot ? (
        <EntityDetail
          snapshot={snapshot}
          animRuntime={animRuntime}
          world={world}
          version={version}
          onDelete={() => {
            removeEntity(snapshot.id);
            setSelectedId(null);
          }}
        />
      ) : entities.length > 0 ? (
        <div className="text-mist text-[10px] font-mono">
          click an entity above to inspect its components
        </div>
      ) : null}
    </div>
  );
}

/**
 * 组件多选过滤器 — chip 形式。
 * 收集所有 entity 用过的组件名,点击 chip 切换「必须拥有」状态。
 * 多个被选时取 AND(实体必须同时拥有所有选中的组件才显示)。
 */
function ComponentFilterChips({
  entities,
  selected,
  onChange,
}: {
  entities: EntitySummary[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  // 统计每个组件名出现次数,按频次降序排;最多展示 12 个
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entities) {
      for (const c of e.components) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [entities]);

  if (counts.length === 0) return null;

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  return (
    <div className="mb-1 flex items-center gap-1 flex-wrap">
      <Filter className="w-3 h-3 text-mist shrink-0" />
      <span className="text-[9px] text-mist font-mono shrink-0">AND:</span>
      {counts.map(([name, n]) => {
        const active = selected.has(name);
        return (
          <button
            key={name}
            onClick={() => toggle(name)}
            className={cn(
              'px-1.5 py-0.5 text-[9px] font-mono border transition-colors',
              active
                ? 'border-neon-magenta bg-neon-magenta/15 text-neon-magenta'
                : 'border-neon-cyan/15 text-mist hover:border-neon-cyan/40 hover:text-haze',
            )}
            title={active ? `remove filter: ${name}` : `add filter: must have ${name} (×${n})`}
          >
            {name}
            <span className="text-mist/70 ml-0.5">×{n}</span>
          </button>
        );
      })}
      {selected.size > 0 && (
        <button
          onClick={() => onChange(new Set())}
          className="px-1 py-0.5 text-[9px] font-mono text-mist hover:text-neon-magenta shrink-0"
          title="clear filters"
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function AddComponentPicker({
  world,
  entityId,
  existing,
}: {
  world: World | null;
  entityId: EntityId;
  existing: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');

  // 列出所有未挂载的组件类型(只显示有默认构造的简单组件)
  const candidates = useMemo(() => {
    return ComponentTypeRegistry.knownTypes()
      .map((t) => t.name)
      .filter((n) => !existing.has(n) && SUPPORTED_ADDABLE.has(n))
      .sort();
  }, [existing]);

  if (!world || candidates.length === 0) return null;

  const handleAdd = () => {
    if (!selected) return;
    const t = ComponentTypeRegistry.byName(selected);
    if (!t) return;
    const data = createDefaultComponent(selected);
    if (data == null) return;
    // setComponent 强类型签名 <T>，loose cast 把 unknown 数据塞进去
    (world.setComponent as (i: EntityId, t: ComponentType<unknown>, d: unknown) => void)(entityId, t, data);
    setSelected('');
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="hud-btn hud-btn-ghost w-full text-[10px]"
      >
        <Plus className="w-3 h-3 inline mr-1" />
        Add component
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1 border border-neon-cyan/20 bg-space-800/30 px-1.5 py-1">
      <select
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        className="flex-1 bg-space-900/60 border border-neon-cyan/20 px-1 py-0.5 text-[10px] font-mono text-haze focus:border-neon-cyan focus:outline-none"
      >
        <option value="">— select type —</option>
        {candidates.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <button
        onClick={handleAdd}
        disabled={!selected}
        className="hud-btn hud-btn-primary !py-0.5 text-[10px] disabled:opacity-40"
      >
        Add
      </button>
      <button
        onClick={() => {
          setOpen(false);
          setSelected('');
        }}
        className="hud-btn hud-btn-ghost !py-0.5 text-[10px]"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

/** 可由 picker 添加的简单组件(不需要外部引用/构造参数)。 */
const SUPPORTED_ADDABLE = new Set([
  'Transform',
  'Velocity',
  'Health',
  'Tag',
  'Lifetime',
  'PlayerInput',
]);

function createDefaultComponent(name: string): unknown {
  switch (name) {
    case 'Transform': return new Transform();
    case 'Velocity': return new Velocity();
    case 'Health': return new Health(100);
    case 'Tag': return new Tag('New');
    case 'Lifetime': return new Lifetime(5);
    case 'PlayerInput': return new PlayerInput();
    default: return null;
  }
}

function EntityDetail({
  snapshot,
  animRuntime,
  world,
  version,
  onDelete,
}: {
  snapshot: EntitySnapshot;
  animRuntime: AnimStateRuntime | null;
  world: World | null;
  version: number;
  onDelete: () => void;
}) {
  const compNames = Object.keys(snapshot.components).sort();
  return (
    <div className="border border-neon-magenta/30 bg-neon-magenta/5 p-2 space-y-2">
      {/* Identity */}
      <div className="flex items-center justify-between">
        <div>
          <div className="font-display text-[11px] tracking-[0.18em] text-neon-magenta">
            {snapshot.name}
          </div>
          <div className="font-mono text-[9px] text-mist mt-0.5">
            id=#{snapshot.id} · idx={snapshot.index} · ver={snapshot.version}
          </div>
        </div>
        <button
          onClick={onDelete}
          className="hud-btn hud-btn-ghost !p-1.5"
          title="destroy entity"
        >
          <Trash2 className="w-3 h-3 text-neon-magenta" />
        </button>
      </div>

      {/* SceneNode TRS */}
      <div>
        <div className="hud-label mb-1 flex items-center gap-1.5">
          <Hash className="w-3 h-3" />
          <span>SCENE NODE (TRS)</span>
        </div>
        <div className="font-mono text-[10px] space-y-0.5 leading-relaxed">
          <div className="text-mist">
            pos{' '}
            <span className="text-haze">
              [{snapshot.sceneNode.position.map((v) => v.toFixed(3)).join(', ')}]
            </span>
          </div>
          <div className="text-mist">
            rot{' '}
            <span className="text-haze">
              [{snapshot.sceneNode.rotation.map((v) => v.toFixed(3)).join(', ')}]
            </span>
          </div>
          <div className="text-mist">
            sca{' '}
            <span className="text-haze">
              [{snapshot.sceneNode.scale.map((v) => v.toFixed(3)).join(', ')}]
            </span>
          </div>
        </div>
      </div>

      {/* State Machine runtime (only for entities with AnimState) */}
      {animRuntime ? <AnimRuntimeBlock runtime={animRuntime} /> : null}

      {/* PlayerInput live state (if any) */}
      {snapshot.components.PlayerInput && world ? (
        <PlayerInputBlock world={world} entityId={snapshot.id} version={version} />
      ) : null}

      {/* Components */}
      <div>
        <div className="hud-label mb-1 flex items-center gap-1.5">
          <Layers className="w-3 h-3" />
          <span>COMPONENTS · {compNames.length}</span>
        </div>
        {/* add-component picker */}
        <AddComponentPicker
          world={world}
          entityId={snapshot.id}
          existing={new Set(compNames)}
        />
        <div className="space-y-1 mt-1">
          {compNames.map((name) => (
            <ComponentBlock
              key={name}
              name={name}
              data={snapshot.components[name]}
              world={world}
              entityId={snapshot.id}
              version={version}
              onRemove={world ? () => {
                const t = ComponentTypeRegistry.byName(name);
                if (t) {
                  world.removeComponent(snapshot.id, t);
                }
              } : undefined}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function AnimRuntimeBlock({ runtime }: { runtime: AnimStateRuntime }) {
  const inTransition = runtime.transitionT > 0;
  return (
    <div className="border border-neon-magenta/30 bg-neon-magenta/5 px-2 py-1.5">
      <div className="flex items-center justify-between mb-1">
        <div className="hud-label flex items-center gap-1.5">
          <span className="text-neon-magenta">▸</span>
          <span>STATE MACHINE</span>
        </div>
        <span className="font-mono text-[9px] text-mist">
          clips={runtime.clipCount}
        </span>
      </div>
      <div className="font-mono text-[10px] space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-mist shrink-0">current</span>
          <span className="text-neon-magenta font-semibold">
            {runtime.currentState ?? '(none)'}
          </span>
          {inTransition ? (
            <span className="text-neon-cyan text-[9px]">
              → {runtime.pendingState} ({runtime.transitionT.toFixed(2)}s)
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-mist shrink-0">action.t</span>
          <span className="text-haze">{runtime.currentClipTime.toFixed(3)}s</span>
        </div>
        <div className="flex items-start gap-1.5 pt-0.5">
          <span className="text-mist shrink-0">states</span>
          <div className="flex flex-wrap gap-1">
            {runtime.stateNames.map((n) => (
              <span
                key={n}
                className={cn(
                  'font-mono text-[9px] px-1 border',
                  n === runtime.currentState
                    ? 'border-neon-magenta text-neon-magenta'
                    : 'border-neon-cyan/20 text-mist',
                )}
              >
                {n}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function PlayerInputBlock({
  world,
  entityId,
  version,
}: {
  world: World;
  entityId: EntityId;
  version: number;
}) {
  void version;
  const input = world.getComponent(entityId, PlayerInputC);
  if (!input) return null;
  const dirStyle = (active: boolean) =>
    active ? 'text-neon-cyan border-neon-cyan' : 'text-mist border-space-700';
  return (
    <div className="border border-neon-cyan/20 bg-space-800/40 px-2 py-1.5">
      <div className="hud-label mb-1.5 flex items-center gap-1.5">
        <span className="text-neon-cyan">⌨</span>
        <span>PLAYER INPUT</span>
      </div>
      <div className="grid grid-cols-3 gap-1 font-mono text-[9px] text-center mb-1.5">
        <div className={cn('border py-0.5', dirStyle(false))}></div>
        <div className={cn('border py-0.5', dirStyle(input.forward > 0))}>W</div>
        <div className={cn('border py-0.5', dirStyle(false))}></div>
        <div className={cn('border py-0.5', dirStyle(input.right < 0))}>A</div>
        <div className={cn('border py-0.5', dirStyle(input.forward < 0))}>S</div>
        <div className={cn('border py-0.5', dirStyle(input.right > 0))}>D</div>
      </div>
      <div className="font-mono text-[10px] space-y-0.5">
        <div className="flex items-center gap-1.5">
          <span className="text-mist">run</span>
          <span className={input.run ? 'text-neon-magenta' : 'text-haze'}>
            {input.run ? 'SHIFT ON' : 'off'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-mist">jump</span>
          <span className={input.jump ? 'text-neon-cyan' : 'text-haze'}>
            {input.jump ? 'SPACE' : 'off'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-mist">cameraYaw</span>
          <span className="text-haze">{input.cameraYaw.toFixed(2)} rad</span>
        </div>
      </div>
    </div>
  );
}

function ComponentBlock({
  name,
  data,
  world,
  entityId,
  version,
  onRemove,
}: {
  name: string;
  data: unknown;
  world: World | null;
  entityId: EntityId;
  version: number;
  onRemove?: () => void;
}) {
  if (data && typeof data === 'object' && (data as { __ref?: boolean }).__ref) {
    return (
      <div className="border border-neon-cyan/10 bg-space-800/30 px-2 py-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-neon-cyan">{name}</span>
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[9px] text-mist tracking-[0.16em]">
              RUNTIME REF · not serialized
            </span>
            {onRemove && (
              <button
                onClick={onRemove}
                className="text-mist hover:text-neon-magenta"
                title="remove component"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const handleFieldChange = (field: string, value: unknown) => {
    if (!world || !(data instanceof Object)) return;
    (data as Record<string, unknown>)[field] = value;
    const type = ComponentTypeRegistry.byName(name);
    if (type) {
      world.setComponent(entityId, type, data);
    }
  };

  const handleArrayChange = (field: string, index: number, value: number) => {
    if (!world || !(data instanceof Object)) return;
    const arr = (data as Record<string, unknown>)[field];
    if (!Array.isArray(arr)) return;
    arr[index] = value;
    const type = ComponentTypeRegistry.byName(name);
    if (type) {
      world.setComponent(entityId, type, data);
    }
  };

  void version;

  return (
    <div className="border border-neon-cyan/10 bg-space-800/30 px-2 py-1">
      <div className="flex items-center justify-between mb-0.5">
        <div className="font-mono text-[10px] text-neon-cyan">{name}</div>
        {onRemove && (
          <button
            onClick={onRemove}
            className="text-mist hover:text-neon-magenta"
            title="remove component"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <EditableFields data={data} onChange={handleFieldChange} onArrayChange={handleArrayChange} />
    </div>
  );
}

function EditableFields({
  data,
  onChange,
  onArrayChange,
}: {
  data: unknown;
  onChange: (field: string, value: unknown) => void;
  onArrayChange: (field: string, index: number, value: number) => void;
}) {
  if (data == null || typeof data !== 'object') {
    return <div className="font-mono text-[10px] text-mist">(no fields)</div>;
  }

  const obj = data as Record<string, unknown>;
  const keys = Object.keys(obj);

  return (
    <div className="font-mono text-[10px] space-y-0.5">
      {keys.map((key) => {
        const value = obj[key];
        if (typeof value === 'number') {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0">{key}</span>
              <input
                type="number"
                value={value}
                onChange={(e) => onChange(key, parseFloat(e.target.value))}
                step={0.01}
                className="flex-1 bg-space-900/50 border border-neon-cyan/20 px-1.5 py-0.5 text-[10px] text-neon-cyan focus:border-neon-cyan focus:outline-none"
              />
            </div>
          );
        }
        if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0">{key}</span>
              <div className="flex-1 flex gap-1">
                {value.map((v, i) => (
                  <input
                    key={i}
                    type="number"
                    value={v}
                    onChange={(e) => onArrayChange(key, i, parseFloat(e.target.value))}
                    step={0.01}
                    className="flex-1 bg-space-900/50 border border-neon-cyan/20 px-1 py-0.5 text-[9px] text-neon-cyan focus:border-neon-cyan focus:outline-none"
                  />
                ))}
              </div>
            </div>
          );
        }
        if (typeof value === 'boolean') {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0">{key}</span>
              <input
                type="checkbox"
                checked={value}
                onChange={(e) => onChange(key, e.target.checked)}
                className="w-3 h-3 accent-neon-cyan"
              />
            </div>
          );
        }
        if (typeof value === 'string') {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0">{key}</span>
              <input
                type="text"
                value={value}
                onChange={(e) => onChange(key, e.target.value)}
                className="flex-1 bg-space-900/50 border border-neon-cyan/20 px-1.5 py-0.5 text-[10px] text-neon-cyan focus:border-neon-cyan focus:outline-none"
              />
            </div>
          );
        }
        return (
          <div key={key} className="flex items-start gap-1.5">
            <span className="text-mist shrink-0">{key}</span>
            <span className="text-haze break-all">{formatValue(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatFields(data: unknown): { k: string; v: string }[] {
  if (data == null) return [];
  if (typeof data !== 'object') return [{ k: 'value', v: String(data) }];
  const obj = data as Record<string, unknown>;
  return Object.entries(obj).map(([k, v]) => ({ k, v: formatValue(v) }));
}

function formatValue(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return String(v);
    return Number.isInteger(v) ? v.toString() : v.toFixed(4);
  }
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    if (v.length <= 6 && v.every((x) => typeof x === 'number')) {
      return `[${v.map((x) => (typeof x === 'number' ? (x as number).toFixed(3) : String(x))).join(', ')}]`;
    }
    return `Array(${v.length})`;
  }
  if (v instanceof Map) return `Map(${v.size})`;
  if (v instanceof Set) return `Set(${v.size})`;
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length <= 3) {
      return `{${keys.map((k) => `${k}: ${formatValue(obj[k])}`).join(', ')}}`;
    }
    return `Object{${keys.length} keys}`;
  }
  return String(v);
}

function Stat({ label, value, mono, accent }: { label: string; value: string; mono?: boolean; accent?: boolean }) {
  return (
    <div className="border border-neon-cyan/10 bg-space-800/40 px-2 py-1">
      <div className="text-[9px] tracking-[0.18em] text-mist">{label}</div>
      <div className={accent ? 'text-neon-cyan' : 'text-haze'} style={{ fontFamily: mono ? 'inherit' : undefined }}>
        {value}
      </div>
    </div>
  );
}

function SnapshotPanel({
  world,
  snapshots,
  setSnapshots,
  diffResult,
  setDiffResult,
  diffExpanded,
  setDiffExpanded,
}: {
  world: World | null;
  snapshots: WorldSnapshot[];
  setSnapshots: React.Dispatch<React.SetStateAction<WorldSnapshot[]>>;
  diffResult: WorldDiff | null;
  setDiffResult: React.Dispatch<React.SetStateAction<WorldDiff | null>>;
  diffExpanded: { added: boolean; removed: boolean; modified: boolean };
  setDiffExpanded: React.Dispatch<React.SetStateAction<{ added: boolean; removed: boolean; modified: boolean }>>;
}) {
  const handleTakeSnapshot = () => {
    if (!world) return;
    const snap = world.takeSnapshot();
    setSnapshots((prev) => [...prev.slice(-4), snap]); // 最多保留 5 份
    setDiffResult(null);
    setDiffExpanded({ added: false, removed: false, modified: false });
  };

  const handleCompareLatest = () => {
    if (snapshots.length < 2) return;
    const a = snapshots[snapshots.length - 2];
    const b = snapshots[snapshots.length - 1];
    setDiffResult(World.diffSnapshots(a, b));
    setDiffExpanded({ added: false, removed: false, modified: false });
  };

  const handleCompareWith = (idx: number) => {
    if (snapshots.length < 2 || idx >= snapshots.length - 1) return;
    const a = snapshots[idx];
    const b = snapshots[snapshots.length - 1];
    setDiffResult(World.diffSnapshots(a, b));
    setDiffExpanded({ added: false, removed: false, modified: false });
  };

  const handleClear = () => {
    setSnapshots([]);
    setDiffResult(null);
    setDiffExpanded({ added: false, removed: false, modified: false });
  };

  return (
    <div>
      <div className="hud-label mb-1 flex items-center gap-1.5">
        <Camera className="w-3 h-3" />
        <span>SNAPSHOTS · {snapshots.length}</span>
        <span className="flex-1" />
        <span className="text-[9px] text-mist/70 font-mono">Ctrl+Shift+S</span>
        {snapshots.length > 0 && (
          <button
            onClick={handleClear}
            className="text-mist hover:text-neon-magenta shrink-0"
            title="clear all snapshots"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="flex gap-1 mb-1">
        <button
          onClick={handleTakeSnapshot}
          disabled={!world}
          className="hud-btn hud-btn-ghost flex-1 text-[10px] disabled:opacity-40"
        >
          + Take
        </button>
        <button
          onClick={handleCompareLatest}
          disabled={snapshots.length < 2}
          className="hud-btn hud-btn-ghost flex-1 text-[10px] disabled:opacity-40"
        >
          <GitCompare className="w-3 h-3 inline mr-1" />
          Diff Last 2
        </button>
      </div>
      {snapshots.length > 0 && (
        <ul className="font-mono text-[10px] space-y-0.5">
          {snapshots.map((s, i) => {
            const ts = new Date(s.timestamp);
            const hh = String(ts.getHours()).padStart(2, '0');
            const mm = String(ts.getMinutes()).padStart(2, '0');
            const ss = String(ts.getSeconds()).padStart(2, '0');
            return (
              <li
                key={i}
                className="flex items-center gap-1.5 border border-neon-cyan/10 bg-space-800/30 px-1.5 py-0.5"
              >
                <span className="text-neon-cyan shrink-0">#{i}</span>
                <span className="text-haze truncate flex-1" title={s.label}>
                  {s.label}
                </span>
                <span className="text-mist/60 shrink-0 font-mono text-[9px]">
                  {hh}:{mm}:{ss}
                </span>
                <span className="text-mist shrink-0">×{s.entities.length}</span>
                {i < snapshots.length - 1 && (
                  <button
                    onClick={() => handleCompareWith(i)}
                    className="text-mist hover:text-neon-cyan shrink-0"
                    title="diff with latest"
                  >
                    <GitCompare className="w-3 h-3" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {diffResult && (
        <div className="mt-1 font-mono text-[10px] space-y-0.5 border border-neon-magenta/30 bg-neon-magenta/5 p-1.5">
          <div className="text-neon-magenta mb-0.5 flex items-center gap-1">
            <GitCompare className="w-3 h-3" />
            <span>DIFF RESULT</span>
          </div>
          {diffResult.added.length > 0 && (
            <DiffSection
              kind="added"
              color="text-green-400"
              ids={diffResult.added}
              expanded={diffExpanded.added}
              onToggle={() => setDiffExpanded((s) => ({ ...s, added: !s.added }))}
            />
          )}
          {diffResult.removed.length > 0 && (
            <DiffSection
              kind="removed"
              color="text-red-400"
              ids={diffResult.removed}
              expanded={diffExpanded.removed}
              onToggle={() => setDiffExpanded((s) => ({ ...s, removed: !s.removed }))}
            />
          )}
          {diffResult.modified.length > 0 && (
            <DiffModifiedSection
              entries={diffResult.modified}
              expanded={diffExpanded.modified}
              onToggle={() => setDiffExpanded((s) => ({ ...s, modified: !s.modified }))}
            />
          )}
          {diffResult.added.length === 0 &&
            diffResult.removed.length === 0 &&
            diffResult.modified.length === 0 && (
              <div className="text-mist">no changes</div>
            )}
        </div>
      )}
    </div>
  );
}

/** diff 区域单行(added / removed):可展开 id 列表。 */
function DiffSection({
  kind,
  color,
  ids,
  expanded,
  onToggle,
}: {
  kind: 'added' | 'removed';
  color: string;
  ids: EntityId[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const prefix = kind === 'added' ? '+' : '-';
  return (
    <div className={color}>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1 hover:opacity-80"
      >
        <ChevronDown
          className={cn('w-3 h-3 transition-transform shrink-0', !expanded && '-rotate-90')}
        />
        <span>
          {prefix} {kind} {ids.length}
        </span>
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 text-mist/90 space-y-0.5 max-h-24 overflow-y-auto">
          {ids.map((id) => (
            <div key={id} className="font-mono text-[9px]">
              #{id}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** diff 区域(modified):每个 entity 展开后看到哪些 component 变了。 */
function DiffModifiedSection({
  entries,
  expanded,
  onToggle,
}: {
  entries: { id: EntityId; componentChanges: { name: string; before: unknown; after: unknown }[] }[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const totalChanges = entries.reduce((n, e) => n + e.componentChanges.length, 0);
  return (
    <div className="text-neon-cyan">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1 hover:opacity-80"
      >
        <ChevronDown
          className={cn('w-3 h-3 transition-transform shrink-0', !expanded && '-rotate-90')}
        />
        <span>
          ~ modified {entries.length} ({totalChanges} components)
        </span>
      </button>
      {expanded && (
        <div className="ml-4 mt-0.5 space-y-1 max-h-32 overflow-y-auto">
          {entries.map((e) => (
            <div key={e.id} className="font-mono text-[9px] border border-neon-cyan/15 bg-space-900/30 px-1 py-0.5">
              <div className="text-neon-cyan">#{e.id}</div>
              <ul className="text-mist/90 space-y-0.5 mt-0.5">
                {e.componentChanges.map((c) => (
                  <li key={c.name}>
                    <span className="text-haze">{c.name}</span>
                    <span className="text-mist/60">: </span>
                    <span className="line-through text-red-400/80">{shortJson(c.before)}</span>
                    <span className="text-mist/60"> → </span>
                    <span className="text-green-400/90">{shortJson(c.after)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 紧凑 JSON 渲染(超过 40 字符截断),避免 diff 详情撑爆 UI。 */
function shortJson(v: unknown): string {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'string') return v.length > 40 ? `"${v.slice(0, 40)}…"` : JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 60) + '…' : s;
  } catch {
    return String(v);
  }
}

function SystemTimingList({
  systems,
  timings,
}: {
  systems: readonly import('@/engine/ECS/World').System[];
  timings: readonly SystemTiming[];
}) {
  const maxDuration = Math.max(...timings.map((t) => t.duration), 1);

  return (
    <div className="font-mono text-[10px] space-y-1">
      {systems.map((s, i) => {
        const timing = timings.find((t) => t.name === s.name);
        const duration = timing?.duration ?? 0;
        const percent = (duration / maxDuration) * 100;
        const color = duration > 1 ? 'bg-neon-magenta' : duration > 0.1 ? 'bg-neon-cyan' : 'bg-neon-cyan/30';

        return (
          <div key={i} className="flex items-center gap-1.5">
            <span className={s.enabled ? 'text-neon-cyan' : 'text-mist'}>▸</span>
            <span className={s.enabled ? 'text-haze/85' : 'text-mist/50'}>{s.name}</span>
            <div className="flex-1 h-1.5 bg-space-700/50 overflow-hidden">
              <div
                className={cn('h-full transition-all duration-75', color)}
                style={{ width: `${Math.max(1, percent)}%` }}
              />
            </div>
            <span className={duration > 1 ? 'text-neon-magenta' : 'text-mist'}>
              {duration.toFixed(2)}ms
            </span>
            <span className="text-mist/60">p={s.priority}</span>
          </div>
        );
      })}
    </div>
  );
}
