// ParamEditor — schema 驱动的参数编辑控件。
//
// 接收 `ParamSchema` + 当前 `values` + `onChange`,自动渲染:
//   - number → slider + numeric input(min/max/step)
//   - color  → 颜色选择器 + hex 文本输入
//   - select → button group(每个 option 用色块展示色值)
//
// 字段按 schema 的 `group` 折叠;同 group 集中展示,带 fold/unfold 切换。

import { useMemo, useState } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import type { ParamSchema, ParamFieldDef } from '@/three/generators';
import { cn } from '@/lib/cn';

interface ParamEditorProps {
  schema: ParamSchema;
  values: Readonly<Record<string, unknown>>;
  onChange: (key: string, value: number | string) => void;
  onReset?: () => void;
}

type GroupKey = ParamFieldDef['group'];

const GROUP_ORDER: GroupKey[] = ['body', 'palette', 'accent', 'detail'];
const GROUP_LABEL: Record<GroupKey, string> = {
  body: 'BODY',
  palette: 'PALETTE',
  accent: 'ACCENT',
  detail: 'DETAIL',
};

export function ParamEditor({ schema, values, onChange, onReset }: ParamEditorProps) {
  // 默认全部展开
  const [collapsed, setCollapsed] = useState<Set<GroupKey>>(new Set());
  const [resetFlash, setResetFlash] = useState(0);

  // 按 group 归类
  const grouped = useMemo(() => {
    const m = new Map<GroupKey, Array<{ key: string; def: ParamFieldDef }>>();
    for (const [key, def] of Object.entries(schema)) {
      const arr = m.get(def.group) ?? [];
      arr.push({ key, def });
      m.set(def.group, arr);
    }
    // 保持 GROUP_ORDER 的顺序
    return GROUP_ORDER
      .filter((g) => m.has(g))
      .map((g) => ({ group: g, fields: m.get(g) ?? [] }));
  }, [schema]);

  const toggle = (g: GroupKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g);
      else next.add(g);
      return next;
    });
  };

  const handleReset = () => {
    onReset?.();
    // 触发 UI 闪烁提示已重置
    setResetFlash((n) => n + 1);
  };

  return (
    <div className="font-mono text-[10px] space-y-1.5">
      {onReset && (
        <div className="flex items-center justify-end">
          <button
            onClick={handleReset}
            className="hud-btn hud-btn-ghost !py-0.5 text-[9px]"
            title="restore defaults"
          >
            <RotateCcw className="w-3 h-3" />
            <span>RESET</span>
          </button>
        </div>
      )}
      {grouped.map(({ group, fields }) => {
        const isCollapsed = collapsed.has(group);
        return (
          <div
            key={group}
            className={cn(
              'border border-neon-cyan/10 bg-space-900/30',
              resetFlash > 0 && 'animate-flash',
            )}
          >
            <button
              onClick={() => toggle(group)}
              className="w-full flex items-center gap-1.5 px-2 py-1 border-b border-neon-cyan/10 text-[9px] tracking-[0.18em] text-mist hover:text-neon-cyan"
            >
              <ChevronDown
                className={cn(
                  'w-3 h-3 transition-transform',
                  isCollapsed && '-rotate-90',
                )}
              />
              <span className="text-neon-cyan/80">{GROUP_LABEL[group]}</span>
              <span className="text-mist/60">· {fields.length}</span>
            </button>
            {!isCollapsed && (
              <div className="p-1.5 space-y-1">
                {fields.map(({ key, def }) => (
                  <Field
                    key={key}
                    fieldKey={key}
                    def={def}
                    value={values[key]}
                    onChange={(v) => onChange(key, v)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Field({
  fieldKey,
  def,
  value,
  onChange,
}: {
  fieldKey: string;
  def: ParamFieldDef;
  value: unknown;
  onChange: (v: number | string) => void;
}) {
  if (def.type === 'number') {
    return (
      <NumberField
        fieldKey={fieldKey}
        def={def}
        value={typeof value === 'number' ? value : Number(def.default)}
        onChange={onChange}
      />
    );
  }
  if (def.type === 'color') {
    return (
      <ColorField
        fieldKey={fieldKey}
        def={def}
        value={typeof value === 'string' ? value : String(def.default)}
        onChange={onChange}
      />
    );
  }
  if (def.type === 'select') {
    return (
      <SelectField
        fieldKey={fieldKey}
        def={def}
        value={typeof value === 'number' || typeof value === 'string' ? value : def.default}
        onChange={onChange}
      />
    );
  }
  return null;
}

function NumberField({
  fieldKey,
  def,
  value,
  onChange,
}: {
  fieldKey: string;
  def: ParamFieldDef;
  value: number;
  onChange: (v: number) => void;
}) {
  const min = def.min ?? 0;
  const max = def.max ?? 100;
  const step = def.step ?? 1;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-mist">{def.label}</span>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (!Number.isNaN(v)) onChange(v);
          }}
          className="w-16 bg-space-900/60 border border-neon-cyan/20 px-1 py-0.5 text-[10px] text-neon-cyan text-right focus:border-neon-cyan focus:outline-none"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        aria-label={def.label}
        title={fieldKey}
        className="w-full h-1.5 bg-space-800 appearance-none cursor-pointer accent-neon-cyan"
        style={{
          background: `linear-gradient(to right, #22d3ee 0%, #22d3ee ${
            ((value - min) / (max - min)) * 100
          }%, #1e1b4b ${((value - min) / (max - min)) * 100}%, #1e1b4b 100%)`,
        }}
      />
    </div>
  );
}

function ColorField({
  fieldKey,
  def,
  value,
  onChange,
}: {
  fieldKey: string;
  def: ParamFieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const hex = normalizeHex(value);
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-mist shrink-0">{def.label}</span>
      <input
        type="color"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="w-7 h-5 bg-transparent border border-neon-cyan/20 cursor-pointer"
        title={`${fieldKey} picker`}
      />
      <input
        type="text"
        value={hex}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 bg-space-900/60 border border-neon-cyan/20 px-1 py-0.5 text-[10px] text-neon-cyan font-mono focus:border-neon-cyan focus:outline-none uppercase"
      />
    </div>
  );
}

function SelectField({
  fieldKey,
  def,
  value,
  onChange,
}: {
  fieldKey: string;
  def: ParamFieldDef;
  value: number | string;
  onChange: (v: number | string) => void;
}) {
  const opts = def.options ?? [];
  // 决定存储格式:如果 default 是 string,option 字符串就是 value;
  // 如果 default 是 number,option 是 palette,onChange 传 index(沿用 hue 调色板语义)。
  const useStringValue = typeof def.default === 'string';
  return (
    <div className="space-y-0.5">
      <span className="text-mist">{def.label}</span>
      <div className="flex items-center gap-1 flex-wrap">
        {opts.map((opt, i) => {
          const isActive = useStringValue ? value === opt : value === i;
          const isColor = typeof opt === 'string' && /^#[0-9a-f]{3,6}$/i.test(opt);
          const label = useStringValue
            ? String(opt).toUpperCase()
            : isColor
              ? (opt as string).toUpperCase()
              : `#${i}`;
          return (
            <button
              key={String(opt)}
              onClick={() => onChange(useStringValue || isColor ? opt : i)}
              className={cn(
                'flex items-center gap-1 px-1.5 py-0.5 border text-[9px] transition-colors',
                isActive
                  ? 'border-neon-cyan bg-neon-cyan/15 text-neon-cyan'
                  : 'border-neon-cyan/15 text-mist hover:border-neon-cyan/40 hover:text-haze',
              )}
              title={`${fieldKey}=${opt}`}
            >
              {isColor && (
                <span
                  className="w-2.5 h-2.5 inline-block border border-neon-cyan/20"
                  style={{ background: opt as string }}
                />
              )}
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function normalizeHex(s: string): string {
  if (!s) return '#000000';
  if (!s.startsWith('#')) s = '#' + s;
  // 3 位缩写 → 6 位
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return '#' + s.slice(1).split('').map((c) => c + c).join('');
  }
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  return '#000000';
}
