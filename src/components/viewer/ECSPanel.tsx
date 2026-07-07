// ECSPanel — Inspector 子面板,可视化当前 World 的 entity / component 树。
//
// 读 useWorldStore 拿到 World 引用 (不可序列化,直接持引用) + version 触发刷新。
// 不把 entity 列表塞进 zustand state,因为 world 自己就是 source of truth。

import { useMemo, useState } from 'react';
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
  Trash2,
} from 'lucide-react';
import { useWorldStore } from '@/stores/worldStore';
import { useViewerStore } from '@/stores/viewerStore';
import type { AnimStateRuntime, EntityId, EntitySnapshot, EntitySummary } from '@/engine/ECS';
import { PlayerInputC } from '@/engine/ECS';
import type { World } from '@/engine/ECS/World';
import { cn } from '@/lib/cn';

export function ECSPanel() {
  const { t } = useTranslation();
  // version 是 World 变化的 signal;读这个会订阅
  const version = useWorldStore((s) => s.version);
  const world = useWorldStore((s) => s.world);
  const removeEntity = useWorldStore((s) => s.removeEntity);
  const ecsMovementEnabled = useWorldStore((s) => s.ecsMovementEnabled);
  const setEcsMovementEnabled = useWorldStore((s) => s.setEcsMovementEnabled);
  const [selectedId, setSelectedId] = useState<EntityId | null>(null);

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

  if (!world) {
    return (
      <div className="text-mist text-[11px] font-mono px-1 py-2 leading-relaxed">
        {t('ecs.empty', { defaultValue: 'No ECS World yet. Load a model to populate entities.' })}
      </div>
    );
  }

  const systems = world.getSystems();
  const useCustomRenderer = useViewerStore((s) => s.useCustomRenderer);
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
        <ul className="font-mono text-[10px] space-y-0.5">
          {systems.map((s, i) => (
            <li key={i} className="flex items-center gap-1.5 text-haze/85">
              <span className="text-neon-cyan">▸</span>
              <span>{s.name}</span>
              <span className="text-mist ml-auto">p={s.priority}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Entity list */}
      <div>
        <div className="hud-label mb-1 flex items-center gap-1.5">
          <ListTree className="w-3 h-3" />
          <span>ENTITIES · {entities.length}</span>
        </div>
        {entities.length === 0 ? (
          <div className="text-mist text-[10px] font-mono">no entities</div>
        ) : (
          <ul className="font-mono text-[10px] space-y-0.5 max-h-48 overflow-y-auto">
            {entities.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelectedId(e.id)}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-1.5 py-1 text-left border transition-colors',
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
              </li>
            ))}
          </ul>
        )}
      </div>

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
        <div className="space-y-1">
          {compNames.map((name) => (
            <ComponentBlock
              key={name}
              name={name}
              data={snapshot.components[name]}
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

function ComponentBlock({ name, data }: { name: string; data: unknown }) {
  // 非 POJO 组件：标记为运行时引用
  if (data && typeof data === 'object' && (data as { __ref?: boolean }).__ref) {
    return (
      <div className="border border-neon-cyan/10 bg-space-800/30 px-2 py-1">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] text-neon-cyan">{name}</span>
          <span className="font-mono text-[9px] text-mist tracking-[0.16em]">
            RUNTIME REF · not serialized
          </span>
        </div>
      </div>
    );
  }

  const fields = formatFields(data);
  return (
    <div className="border border-neon-cyan/10 bg-space-800/30 px-2 py-1">
      <div className="font-mono text-[10px] text-neon-cyan mb-0.5">{name}</div>
      <div className="font-mono text-[10px] space-y-0.5">
        {fields.length === 0 ? (
          <div className="text-mist">(no fields)</div>
        ) : (
          fields.map(({ k, v }) => (
            <div key={k} className="flex items-start gap-1.5">
              <span className="text-mist shrink-0">{k}</span>
              <span className="text-haze break-all">{v}</span>
            </div>
          ))
        )}
      </div>
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
