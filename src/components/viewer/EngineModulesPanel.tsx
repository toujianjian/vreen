// EngineModulesPanel — 引擎模块展示面板。
//
// 集中展示自研 @vreen/engine 的全部 34 个顶层模块,按类别分组:
//   渲染 / 场景与资源 / 动画与角色 / 物理与模拟 / 架构与系统 /
//   游戏基础设施 / 性能与调试 / UI 与交付
//
// 每个模块卡片可展开显示核心类与功能描述。
// 赛博朋克风格 (neon border + glassmorphism + 可折叠)。
// 与 EngineFeaturesPanel 互补:后者只展示 8 个可开关子系统,本面板展示全部模块用于检视/学习。

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Boxes,
  ChevronDown,
  Cpu,
  Gamepad2,
  Layers,
  Package,
  Search,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';

type Accent = 'cyan' | 'magenta' | 'amber';

interface ModuleDef {
  /** 模块名(技术标识,不翻译) */
  name: string;
  /** i18n key 后缀,用于 title/desc,如 'core' → engineModules.modules.core.title */
  key: string;
  /** 核心类列表 */
  classes: string[];
  /** 类别 */
  category: CategoryId;
}

type CategoryId =
  | 'rendering'
  | 'scene'
  | 'animation'
  | 'physics'
  | 'architecture'
  | 'gameplay'
  | 'profiling'
  | 'ui';

interface CategoryDef {
  id: CategoryId;
  i18nKey: string;
  Icon: typeof Boxes;
  accent: Accent;
}

const CATEGORIES: CategoryDef[] = [
  { id: 'rendering', i18nKey: 'engineModules.categories.rendering', Icon: Sparkles, accent: 'magenta' },
  { id: 'scene', i18nKey: 'engineModules.categories.scene', Icon: Package, accent: 'cyan' },
  { id: 'animation', i18nKey: 'engineModules.categories.animation', Icon: Layers, accent: 'amber' },
  { id: 'physics', i18nKey: 'engineModules.categories.physics', Icon: Boxes, accent: 'magenta' },
  { id: 'architecture', i18nKey: 'engineModules.categories.architecture', Icon: Cpu, accent: 'cyan' },
  { id: 'gameplay', i18nKey: 'engineModules.categories.gameplay', Icon: Gamepad2, accent: 'amber' },
  { id: 'profiling', i18nKey: 'engineModules.categories.profiling', Icon: Wrench, accent: 'cyan' },
  { id: 'ui', i18nKey: 'engineModules.categories.ui', Icon: Sparkles, accent: 'magenta' },
];

// 34 个顶层引擎模块(与 CLAUDE.md 中 src/engine/ 结构一一对应)
const MODULES: ModuleDef[] = [
  // ── 渲染 ──
  { name: 'Core', key: 'core', category: 'rendering', classes: ['Object3D', 'Scene', 'Group', 'Mesh', 'SkinnedMesh', 'Bone', 'Skeleton', 'BufferGeometry', 'BufferAttribute', 'InstancedBufferAttribute', 'Material', 'InstancedMesh', 'LOD', 'Sprite', 'Text', 'BitmapText', 'TextAtlas', 'DirtyFlag', 'SceneGraphProcessor', 'FrustumCuller', 'SceneStats', 'MorphTargets', 'MorphTargetAnimation', 'Fog', 'FogExp2', 'Raycaster'] },
  { name: 'Renderer', key: 'renderer', category: 'rendering', classes: ['WebGL2Renderer', 'ShaderProgram', 'RenderPass', 'ShadowMapManager', 'MRTTarget', 'GBuffer', 'DeferredRenderer', 'ReflectionProbe', 'ReflectionProbeManager', 'PathTracer'] },
  { name: 'Materials', key: 'materials', category: 'rendering', classes: ['StandardMaterial', 'MeshPhysicalMaterial', 'MeshBasicMaterial', 'MeshPhongMaterial', 'MeshNormalMaterial', 'ShadowMaterial', 'SpriteMaterial', 'ShaderMaterial', 'FurMaterial', 'MatcapMaterial', 'ToonMaterial', 'OutlineMaterial', 'WaterMaterial', 'WireframeMaterial', 'ShaderChunkRegistry'] },
  { name: 'Cameras', key: 'cameras', category: 'rendering', classes: ['PerspectiveCamera', 'OrthographicCamera'] },
  { name: 'Lights', key: 'lights', category: 'rendering', classes: ['AmbientLight', 'DirectionalLight', 'PointLight', 'SpotLight', 'HemisphereLight', 'RectAreaLight', 'DirectionalLightShadow', 'ShadowMapManager'] },
  { name: 'Helpers', key: 'helpers', category: 'rendering', classes: ['GridHelper', 'GridHelper3D', 'AxesHelper', 'BoxHelper', 'CameraHelper', 'ArrowHelper', 'LineHelper', 'PhysicsDebugRenderer'] },

  // ── 场景与资源 ──
  { name: 'Math', key: 'math', category: 'scene', classes: ['Vector2/3/4', 'Matrix3/4', 'Quaternion', 'Euler', 'Color', 'Box3', 'Sphere', 'Plane', 'Ray', 'Line3', 'Triangle', 'Frustum', 'MathUtils'] },
  { name: 'Loaders', key: 'loaders', category: 'scene', classes: ['GLBLoader', 'OBJLoader', 'FBXLoader', 'HDRLoader', 'KTX2Loader', 'STLLoader', 'PLYLoader', 'TGALoader', 'MTLLoader', 'EXRLoader', 'TextureLoader', 'DracoDecoder', 'AssetManager', 'OBJExporter', 'GLTFExporter', 'STLExporter', 'PLYExporter'] },
  { name: 'Geometries', key: 'geometries', category: 'scene', classes: ['BoxGeometry', 'SphereGeometry', 'CylinderGeometry', 'ConeGeometry', 'TorusGeometry', 'PlaneGeometry', 'CircleGeometry', 'RingGeometry', 'CapsuleGeometry', 'TorusKnotGeometry', 'LatheGeometry', 'ExtrudeGeometry', 'ShapeGeometry', 'WireframeGeometry', 'EdgesGeometry'] },
  { name: 'Acceleration', key: 'acceleration', category: 'scene', classes: ['BVH', 'BVHBuilder', 'MeshBVH'] },
  { name: 'Assets', key: 'assets', category: 'scene', classes: ['AssetCache', 'AssetRegistry', 'AssetLoader'] },
  { name: 'Serialization', key: 'serialization', category: 'scene', classes: ['SerializerRegistry', 'GeometrySerializer', 'MaterialSerializer', 'SceneSerializer'] },
  { name: 'Pipeline', key: 'pipeline', category: 'scene', classes: ['AssetPipeline', 'TextureProcessor', 'GeometryProcessor', 'ImportPipeline'] },

  // ── 动画与角色 ──
  { name: 'Animation', key: 'animation', category: 'animation', classes: ['AnimationMixer', 'AnimationClip', 'AnimationAction', 'AnimationStateMachine', 'BlendSpace1D', 'Humanoid', 'AnimationLayer', 'AnimationLayerMixer', 'BoneMask', 'AvatarMask', 'AdditiveBlend', 'AnimationSync', 'IKBone', 'IKChain', 'IKSolver', 'CCDSolver', 'IKHumanoid'] },
  { name: 'Timeline', key: 'timeline', category: 'animation', classes: ['TimelineClip', 'TimelineTrack', 'EventTrack', 'PropertyTrack', 'TimelineSequencer'] },

  // ── 物理与模拟 ──
  { name: 'ECS', key: 'ecs', category: 'physics', classes: ['World', 'ComponentType', 'Components', 'Systems', 'PhysicsComponents', 'PhysicsSystems', 'ConstraintSolver', 'Prefab', 'QueryBuilder', 'Broadphase'] },
  { name: 'Physics', key: 'physics', category: 'physics', classes: ['ConstraintSolver', 'BallJointConstraint', 'HingeJointConstraint', 'SliderJointConstraint', 'FixedJointConstraint', 'DistanceJointConstraint', 'ClothSimulation', 'FluidSimulation', 'DestructionSystem', 'VoronoiFracture'] },
  { name: 'Particles', key: 'particles', category: 'physics', classes: ['ParticleSystem2', 'ParticleEmitter', 'ParticleModifier', 'ParticleCurve', 'TrailModule', 'ParticleData'] },

  // ── 架构与系统 ──
  { name: 'Events', key: 'events', category: 'architecture', classes: ['EventBus', 'EventQueue', 'GameEvent', 'CollisionEvent', 'TriggerEvent', 'SpawnEvent', 'DestroyEvent', 'ScoreEvent', 'CustomEvent'] },
  { name: 'Scripting', key: 'scripting', category: 'architecture', classes: ['ScriptComponent', 'ScriptSystem', 'ScriptRegistry', 'CoroutineSystem'] },
  { name: 'Controls', key: 'controls', category: 'architecture', classes: ['OrbitControls', 'FlyControls', 'PointerLockControls', 'MapControls', 'CharacterController'] },
  { name: 'Input', key: 'input', category: 'architecture', classes: ['InputManager', 'KeyboardState', 'MouseState', 'TouchState', 'GamepadState', 'InputAction', 'InputMap'] },
  { name: 'Network', key: 'network', category: 'architecture', classes: ['NetworkSync', 'Snapshot', 'NetworkTransport', 'WebSocketTransport', 'MockTransport', 'NetworkLerp', 'createNetworkEntity'] },
  { name: 'SaveSystem', key: 'saveSystem', category: 'architecture', classes: ['SaveSystem', 'SaveSerializer', 'LocalStorageAdapter', 'MemoryStorageBackend'] },
  { name: 'SceneManager', key: 'sceneManager', category: 'architecture', classes: ['SceneManager', 'SceneTransition'] },
  { name: 'Audio', key: 'audio', category: 'architecture', classes: ['AudioListener', 'Audio', 'PositionalAudio', 'AudioLoader', 'AudioAnalyser'] },

  // ── 游戏基础设施 ──
  { name: 'AI', key: 'ai', category: 'gameplay', classes: ['NavMesh', 'AStarPathFinder', 'SteeringBehavior', 'Agent', 'BehaviorTree', 'BTAction', 'BTComposite', 'BTCondition', 'BTDecorator', 'BTNode', 'Blackboard'] },
  { name: 'Environment', key: 'environment', category: 'gameplay', classes: ['WeatherSystem', 'SkySystem', 'CloudSystem', 'PrecipitationSystem', 'VegetationSystem', 'VegetationType', 'WaterSimulation', 'WaterSystem'] },
  { name: 'Voxel', key: 'voxel', category: 'gameplay', classes: ['VoxelPalette', 'VoxelChunk', 'VoxelMesher', 'VoxelRaycaster', 'VoxelWorld'] },
  { name: 'Editor', key: 'editor', category: 'gameplay', classes: ['SelectionSystem', 'TransformGizmo', 'UndoRedoSystem', 'EditorCommands', 'SnapSystem'] },
  { name: 'PCG', key: 'pcg', category: 'gameplay', classes: ['NoiseGenerator', 'Perlin', 'Simplex', 'Worley', 'FBM', 'BuildingGenerator', 'CityGenerator', 'DungeonGenerator', 'TreeGenerator'] },
  { name: 'Terrain', key: 'terrain', category: 'gameplay', classes: ['TerrainGeometry', 'HeightmapGenerator', 'TerrainSplat', 'TerrainLayer'] },
  { name: 'Gameplay', key: 'gameplayMod', category: 'gameplay', classes: ['DialogueSystem', 'DialogueTree', 'DialogueParticipant', 'QuestSystem', 'InventorySystem'] },

  // ── 性能与调试 ──
  { name: 'Tools', key: 'tools', category: 'profiling', classes: ['Profiler', 'FrameProfiler', 'SystemProfiler', 'MemoryTracker', 'GpuProfiler', 'PerformanceReport'] },
];

function accentText(accent: Accent): string {
  if (accent === 'magenta') return 'text-neon-magenta';
  if (accent === 'amber') return 'text-neon-amber';
  return 'text-neon-cyan';
}

function accentBorder(accent: Accent): string {
  if (accent === 'magenta') return 'border-neon-magenta/40 hover:border-neon-magenta/70';
  if (accent === 'amber') return 'border-neon-amber/40 hover:border-neon-amber/70';
  return 'border-neon-cyan/40 hover:border-neon-cyan/70';
}

function accentDot(accent: Accent): string {
  if (accent === 'magenta') return 'bg-neon-magenta';
  if (accent === 'amber') return 'bg-neon-amber';
  return 'bg-neon-cyan';
}

export interface EngineModulesPanelProps {
  /** 初始是否展开,默认 true */
  defaultExpanded?: boolean;
  /** 是否显示为浮动面板 (absolute 定位),默认 false (内联) */
  floating?: boolean;
  /** 容器附加 className */
  className?: string;
}

export function EngineModulesPanel({
  defaultExpanded = true,
  floating = false,
  className,
}: EngineModulesPanelProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [query, setQuery] = useState('');
  const [openModule, setOpenModule] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MODULES;
    return MODULES.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.key.toLowerCase().includes(q) ||
        m.classes.some((c) => c.toLowerCase().includes(q)),
    );
  }, [query]);

  // 按类别分组
  const grouped = useMemo(() => {
    const map = new Map<CategoryId, ModuleDef[]>();
    for (const cat of CATEGORIES) {
      map.set(cat.id, []);
    }
    for (const m of filtered) {
      map.get(m.category)?.push(m);
    }
    return map;
  }, [filtered]);

  const containerClass = cn(
    'hud-panel font-mono',
    floating && 'absolute top-3 left-3 z-20 pointer-events-auto w-[340px] max-h-[88vh] overflow-y-auto',
    !floating && 'w-full',
    'p-2.5',
    className,
  );

  return (
    <div className={containerClass}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between border-b border-neon-cyan/15 pb-1.5"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-1.5 text-neon-cyan">
          <Boxes className="w-3.5 h-3.5" />
          <span className="font-display text-[11px] tracking-[0.22em]">
            {t('engineModules.title')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] tracking-[0.18em] text-mist">
            {MODULES.length} {t('engineModules.unit')}
          </span>
          <ChevronDown
            className={cn(
              'w-3.5 h-3.5 text-mist transition-transform',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </button>

      {expanded && (
        <div className="mt-2 space-y-2">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-mist" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('engineModules.search')}
              className="w-full pl-6 pr-5 py-1 bg-space-950/60 border border-neon-cyan/20 text-[10px] text-haze placeholder:text-mist/60 focus:outline-none focus:border-neon-cyan/60"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-mist hover:text-neon-magenta"
                aria-label={t('engineModules.clear')}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* 统计 */}
          <div className="text-[9px] text-mist/70 tracking-[0.18em]">
            {t('engineModules.showing', { shown: filtered.length, total: MODULES.length })}
          </div>

          {/* 按类别分组渲染 */}
          {CATEGORIES.map((cat) => {
            const mods = grouped.get(cat.id) ?? [];
            if (mods.length === 0) return null;
            const { Icon, accent, i18nKey } = cat;
            return (
              <div key={cat.id} className="space-y-1">
                <div className={cn('flex items-center gap-1.5', accentText(accent))}>
                  <Icon className="w-3 h-3" />
                  <span className="font-display text-[9px] tracking-[0.22em]">
                    {t(`${i18nKey}.title`)}
                  </span>
                  <span className="text-[8px] text-mist/60 tracking-[0.18em]">
                    {mods.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-1 pl-1">
                  {mods.map((m) => {
                    const isOpen = openModule === m.key;
                    const titleKey = `engineModules.modules.${m.key}.title`;
                    const descKey = `engineModules.modules.${m.key}.desc`;
                    // 若 i18n 缺失则回退到模块技术名
                    const title = t(titleKey) === titleKey ? m.name : t(titleKey);
                    const desc = t(descKey) === descKey ? '' : t(descKey);
                    return (
                      <div
                        key={m.key}
                        className={cn(
                          'relative p-1.5 border bg-space-950/50 backdrop-blur-sm transition-all duration-200',
                          accentBorder(accent),
                        )}
                      >
                        <span
                          className={cn(
                            'absolute top-0 left-0 w-1 h-1',
                            accentDot(accent),
                          )}
                        />
                        <button
                          type="button"
                          onClick={() => setOpenModule(isOpen ? null : m.key)}
                          className="w-full flex items-center justify-between text-left"
                          aria-expanded={isOpen}
                        >
                          <span
                            className={cn(
                              'font-display text-[10px] tracking-[0.16em] truncate',
                              accentText(accent),
                            )}
                          >
                            {title}
                          </span>
                          <ChevronDown
                            className={cn(
                              'w-3 h-3 text-mist shrink-0 transition-transform',
                              isOpen && 'rotate-180',
                            )}
                          />
                        </button>
                        {isOpen && (
                          <div className="mt-1.5 space-y-1">
                            {desc && (
                              <div className="text-[9px] text-mist leading-relaxed">
                                {desc}
                              </div>
                            )}
                            <div className="text-[8px] tracking-[0.18em] text-mist/60">
                              {t('engineModules.coreClasses')}
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {m.classes.map((c) => (
                                <span
                                  key={c}
                                  className={cn(
                                    'px-1 py-0.5 text-[8px] border bg-space-900/60',
                                    accentBorder(accent),
                                    accentText(accent),
                                  )}
                                >
                                  {c}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* footer hint */}
          <div className="mt-1 text-[9px] text-mist/70 leading-relaxed border-t border-neon-cyan/10 pt-1.5">
            {t('engineModules.hint')}
          </div>
        </div>
      )}
    </div>
  );
}
