// InspectorPanel — 属性检查器面板。
// 显示选中对象的属性,支持编辑 Transform (位置 / 旋转 / 缩放) / 组件属性 /
// 添加 / 移除组件 / 颜色选择器 / 滑块 / 输入框。赛博朋克风格。

import {
  Box,
  ChevronDown,
  ChevronRight,
  Layers,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HudPanel } from '@/components/hud/HudPanel';
import { ColorField } from '@/components/viewer/ColorField';
import { cn } from '@/lib/cn';

/** 归一化后的检视对象 (与引擎 Object3D / three.js / ECS 快照兼容)。 */
export interface InspectorObject {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  scale: { x: number; y: number; z: number };
  components: Record<string, Record<string, unknown>>;
}

interface InspectorPanelProps {
  /** 选中对象:Object3D-like / ECS snapshot / null。 */
  selectedObject: unknown;
  onUpdate: (id: string, property: string, value: unknown) => void;
  onAddComponent: (id: string, componentType: string) => void;
  onRemoveComponent: (id: string, componentType: string) => void;
}

/** 可通过 picker 添加的常见组件类型。 */
const COMMON_COMPONENTS = [
  'Transform',
  'Velocity',
  'Health',
  'Tag',
  'Lifetime',
  'PlayerInput',
  'Rigidbody',
  'Collider',
];

/** 轴 → 颜色 (X 品红 / Y 青 / Z 琥珀)。 */
const AXIS_COLOR = ['text-neon-magenta', 'text-neon-cyan', 'text-neon-amber'] as const;
const AXIS_LABELS = ['X', 'Y', 'Z'] as const;

/** 把任意对象归一化为 InspectorObject。 */
function normalize(raw: unknown): InspectorObject | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = String(o.uuid ?? o.id ?? o.name ?? '');
  const pos = (o.position as Record<string, number> | undefined) ?? { x: 0, y: 0, z: 0 };
  const rot = (o.rotation as Record<string, number> | undefined) ?? { x: 0, y: 0, z: 0 };
  const scl = (o.scale as Record<string, number> | undefined) ?? { x: 1, y: 1, z: 1 };
  const components = (o.components as Record<string, Record<string, unknown>> | undefined) ?? {};
  return {
    id,
    name: typeof o.name === 'string' ? o.name : '(unnamed)',
    type: typeof o.type === 'string' ? o.type : 'Object3D',
    visible: o.visible !== false,
    position: { x: pos.x ?? 0, y: pos.y ?? 0, z: pos.z ?? 0 },
    rotation: { x: rot.x ?? 0, y: rot.y ?? 0, z: rot.z ?? 0 },
    scale: { x: scl.x ?? 1, y: scl.y ?? 1, z: scl.z ?? 1 },
    components,
  };
}

export function InspectorPanel({
  selectedObject,
  onUpdate,
  onAddComponent,
  onRemoveComponent,
}: InspectorPanelProps) {
  const { t } = useTranslation();
  const obj = useMemo(() => normalize(selectedObject), [selectedObject]);

  if (!obj) {
    return (
      <HudPanel
        title={t('editor.inspector')}
        tag="PROPERTIES"
        className="h-full flex flex-col"
        bodyClassName="flex-1 min-h-0"
      >
        <div className="px-4 py-6 text-mist text-center text-[11px] font-mono">
          {t('editor.noSelection')}
        </div>
      </HudPanel>
    );
  }

  return (
    <HudPanel
      title={t('editor.inspector')}
      tag="PROPERTIES"
      variant="magenta"
      className="h-full flex flex-col"
      bodyClassName="flex-1 min-h-0 overflow-y-auto"
    >
      {/* Identity */}
      <div className="shrink-0 px-4 py-3 border-b border-neon-magenta/15">
        <div className="flex items-center gap-2 text-magenta-300/90">
          <Box className="w-3.5 h-3.5" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase">
            {t('editor.type')}
          </span>
        </div>
        <div className="mt-1.5 font-display text-[13px] tracking-[0.14em] text-haze truncate">
          {obj.name}
        </div>
        <div className="mt-1 flex items-center gap-3 font-mono text-[10px] tracking-[0.18em] text-mist">
          <span className="hud-tag hud-tag-magenta">{obj.type}</span>
          <span className="truncate">{obj.id}</span>
        </div>
      </div>

      {/* Transform */}
      <TransformSection obj={obj} onUpdate={onUpdate} />

      {/* Components */}
      <ComponentsSection
        obj={obj}
        onUpdate={onUpdate}
        onAddComponent={onAddComponent}
        onRemoveComponent={onRemoveComponent}
      />
    </HudPanel>
  );
}

function TransformSection({
  obj,
  onUpdate,
}: {
  obj: InspectorObject;
  onUpdate: (id: string, property: string, value: unknown) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const axes = ['x', 'y', 'z'] as const;
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-neon-cyan" />
        ) : (
          <ChevronRight className="w-3 h-3 text-neon-cyan" />
        )}
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          TRANSFORM
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <VectorField
            label={t('editor.position')}
            values={[obj.position.x, obj.position.y, obj.position.z]}
            step={0.01}
            onChange={(i, v) => onUpdate(obj.id, `position.${axes[i]}`, v)}
          />
          <VectorField
            label={t('editor.rotation')}
            values={[obj.rotation.x, obj.rotation.y, obj.rotation.z]}
            step={0.01}
            onChange={(i, v) => onUpdate(obj.id, `rotation.${axes[i]}`, v)}
          />
          <VectorField
            label={t('editor.scale')}
            values={[obj.scale.x, obj.scale.y, obj.scale.z]}
            step={0.01}
            onChange={(i, v) => onUpdate(obj.id, `scale.${axes[i]}`, v)}
          />
        </div>
      )}
    </div>
  );
}

function VectorField({
  label,
  values,
  step,
  onChange,
}: {
  label: string;
  values: [number, number, number];
  step: number;
  onChange: (index: number, value: number) => void;
}) {
  return (
    <div>
      <div className="hud-label mb-1.5">{label}</div>
      <div className="grid grid-cols-3 gap-1.5">
        {values.map((v, i) => (
          <label
            key={i}
            className="flex items-center gap-1 border border-neon-cyan/15 bg-space-900/40 px-1.5 py-0.5"
          >
            <span className={cn('text-[9px] font-mono shrink-0', AXIS_COLOR[i])}>
              {AXIS_LABELS[i]}
            </span>
            <input
              type="number"
              value={Number.isFinite(v) ? v : 0}
              step={step}
              onChange={(e) => onChange(i, parseFloat(e.target.value) || 0)}
              className="flex-1 w-full min-w-0 bg-transparent border-0 text-[10px] font-mono text-haze focus:outline-none"
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function ComponentsSection({
  obj,
  onUpdate,
  onAddComponent,
  onRemoveComponent,
}: {
  obj: InspectorObject;
  onUpdate: (id: string, property: string, value: unknown) => void;
  onAddComponent: (id: string, componentType: string) => void;
  onRemoveComponent: (id: string, componentType: string) => void;
}) {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showPicker, setShowPicker] = useState(false);
  const compNames = Object.keys(obj.components).sort();

  const toggle = (name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  return (
    <div>
      <div className="px-4 py-2.5 flex items-center gap-2 border-b border-neon-cyan/5">
        <Layers className="w-3 h-3 text-neon-cyan" />
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">
          {t('editor.components')} · {compNames.length}
        </span>
        <span className="flex-1" />
        <button
          onClick={() => setShowPicker(!showPicker)}
          className="hud-btn hud-btn-ghost !py-0.5 text-[9px]"
          title={t('editor.addComponent')}
        >
          {showPicker ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
        </button>
      </div>

      {showPicker && (
        <div className="px-4 py-2 border-b border-neon-cyan/5 flex items-center gap-1 flex-wrap">
          {COMMON_COMPONENTS.map((c) => {
            const disabled = c in obj.components;
            return (
              <button
                key={c}
                onClick={() => {
                  onAddComponent(obj.id, c);
                  setShowPicker(false);
                }}
                disabled={disabled}
                className="px-1.5 py-0.5 text-[9px] font-mono border border-neon-cyan/20 text-mist hover:border-neon-cyan hover:text-neon-cyan disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      <div className="px-4 py-2 space-y-1">
        {compNames.length === 0 ? (
          <div className="text-mist text-[10px] font-mono">—</div>
        ) : (
          compNames.map((name) => {
            const isOpen = !collapsed.has(name);
            const data = obj.components[name];
            return (
              <div
                key={name}
                className="border border-neon-cyan/10 bg-space-800/30"
              >
                <div className="flex items-center gap-1.5 px-2 py-1">
                  <button
                    onClick={() => toggle(name)}
                    className="text-mist hover:text-neon-cyan"
                  >
                    {isOpen ? (
                      <ChevronDown className="w-3 h-3" />
                    ) : (
                      <ChevronRight className="w-3 h-3" />
                    )}
                  </button>
                  <span className="font-mono text-[10px] text-neon-cyan flex-1 truncate">
                    {name}
                  </span>
                  <button
                    onClick={() => onRemoveComponent(obj.id, name)}
                    className="text-mist hover:text-neon-magenta"
                    title={t('editor.removeComponent')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {isOpen && data && (
                  <div className="px-2 pb-2">
                    <ComponentFields
                      data={data}
                      onUpdate={(field, value) =>
                        onUpdate(obj.id, `components.${name}.${field}`, value)
                      }
                    />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/** 组件字段编辑器:按值类型渲染 (颜色 / 数字 / 布尔 / 字符串 / 数组)。 */
function ComponentFields({
  data,
  onUpdate,
}: {
  data: Record<string, unknown>;
  onUpdate: (field: string, value: unknown) => void;
}) {
  const keys = Object.keys(data);
  if (keys.length === 0) {
    return <div className="font-mono text-[10px] text-mist">(no fields)</div>;
  }
  return (
    <div className="font-mono text-[10px] space-y-1">
      {keys.map((key) => {
        const value = data[key];
        // 颜色字段:字段名命中 color/emissive/tint 且为 hex 字符串
        const isColor =
          /color|emissive|tint/i.test(key) &&
          typeof value === 'string' &&
          /^#?[0-9a-f]{6}$/i.test(value.trim());
        if (isColor) {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0 w-16 truncate">{key}</span>
              <ColorField
                value={value}
                onChange={(v) => onUpdate(key, v)}
                className="flex-1"
              />
            </div>
          );
        }
        if (typeof value === 'number') {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0 w-16 truncate">{key}</span>
              <input
                type="number"
                value={value}
                step={0.01}
                onChange={(e) => onUpdate(key, parseFloat(e.target.value) || 0)}
                className="flex-1 bg-space-900/50 border border-neon-cyan/20 px-1.5 py-0.5 text-neon-cyan focus:border-neon-cyan focus:outline-none"
              />
            </div>
          );
        }
        if (typeof value === 'boolean') {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0 w-16 truncate">{key}</span>
              <button
                onClick={() => onUpdate(key, !value)}
                className={cn(
                  'px-2 py-0.5 text-[9px] border',
                  value
                    ? 'border-neon-cyan text-neon-cyan bg-neon-cyan/10'
                    : 'border-neon-cyan/20 text-mist',
                )}
              >
                {value ? 'ON' : 'OFF'}
              </button>
            </div>
          );
        }
        if (typeof value === 'string') {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0 w-16 truncate">{key}</span>
              <input
                type="text"
                value={value}
                onChange={(e) => onUpdate(key, e.target.value)}
                className="flex-1 bg-space-900/50 border border-neon-cyan/20 px-1.5 py-0.5 text-neon-cyan focus:border-neon-cyan focus:outline-none"
              />
            </div>
          );
        }
        if (Array.isArray(value) && value.every((v) => typeof v === 'number')) {
          return (
            <div key={key} className="flex items-center gap-1.5">
              <span className="text-mist shrink-0 w-16 truncate">{key}</span>
              <div className="flex-1 flex gap-1">
                {value.map((v, i) => (
                  <input
                    key={i}
                    type="number"
                    value={v}
                    step={0.01}
                    onChange={(e) => {
                      const next = [...value];
                      next[i] = parseFloat(e.target.value) || 0;
                      onUpdate(key, next);
                    }}
                    className="flex-1 min-w-0 bg-space-900/50 border border-neon-cyan/20 px-1 py-0.5 text-[9px] text-neon-cyan focus:border-neon-cyan focus:outline-none"
                  />
                ))}
              </div>
            </div>
          );
        }
        return (
          <div key={key} className="flex items-start gap-1.5">
            <span className="text-mist shrink-0 w-16 truncate">{key}</span>
            <span className="text-haze/70 break-all">{formatValue(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'number') return Number.isInteger(v) ? v.toString() : v.toFixed(4);
  if (typeof v === 'string' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    return `Object{${keys.length}}`;
  }
  return String(v);
}
