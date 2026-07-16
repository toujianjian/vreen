// TunerPanel — M2 参数编辑器主体。
//
// 当 viewer 加载的是某个 generator preset(mech/crystal/tree/...)时,
// 弹出一个带 live preview 的控制面板:
//   - 顶部:当前 generator 名 + RESET 按钮
//   - 中部:mini 3D preview(PresetPreview,跟随当前 params 实时重建)
//   - 底部:ParamEditor(schema 驱动的滑块/颜色/选择器)
//
// 非 preset 资源(用户上传的 glb)→ 显示禁用占位。

import { useEffect, useMemo, useState } from 'react';
import { Sliders, X, Wand2 } from 'lucide-react';
import { useViewerStore } from '@/stores/viewerStore';
import { getPresetById } from '@/lib/presets';
import {
  GENERATOR_META,
  type GeneratorName,
} from '@/three/generators';
import { PresetPreview } from '@/components/three/PresetPreview';
import { ParamEditor } from './ParamEditor';
import { cn } from '@/lib/cn';

export function TunerPanel() {
  const showTuner = useViewerStore((s) => s.showTuner);
  const toggleTuner = useViewerStore((s) => s.toggleTuner);
  const assetSource = useViewerStore((s) => s.assetSource);

  // 当前 generator name(从 preset 推导)
  const activeGen = useMemo<GeneratorName | null>(() => {
    if (assetSource?.kind !== 'preset') return null;
    const preset = getPresetById(assetSource.presetId);
    return preset ? (preset.generator as GeneratorName) : null;
  }, [assetSource]);

  // 局部 params 状态,key = generator name。当切 generator 时重置。
  const [paramsByGen, setParamsByGen] = useState<Record<string, Record<string, unknown>>>({});
  useEffect(() => {
    if (!activeGen) return;
    setParamsByGen((prev) => {
      if (prev[activeGen]) return prev;
      return { ...prev, [activeGen]: { ...GENERATOR_META[activeGen].default } };
    });
  }, [activeGen]);

  if (!showTuner) return null;

  if (!activeGen) {
    return (
      <div className="absolute top-3 right-3 z-20 pointer-events-auto w-[320px] hud-panel p-3">
        <Header onClose={toggleTuner} />
        <div className="mt-2 text-[10px] font-mono text-mist leading-relaxed">
          <Wand2 className="w-3 h-3 inline mr-1 text-neon-cyan" />
          TUNER 仅支持 generator preset(mech / crystal / tree / ship / creature / totem / composite)。
          当前加载的是上传的模型,无法调参。
        </div>
      </div>
    );
  }

  const meta = GENERATOR_META[activeGen];
  const current = paramsByGen[activeGen] ?? meta.default;

  const handleChange = (key: string, value: number | string) => {
    setParamsByGen((prev) => ({
      ...prev,
      [activeGen]: { ...(prev[activeGen] ?? meta.default), [key]: value },
    }));
  };
  const handleReset = () => {
    setParamsByGen((prev) => ({ ...prev, [activeGen]: { ...meta.default } }));
  };

  return (
    <div
      className={cn(
        'absolute top-3 right-3 z-20 pointer-events-auto w-[340px]',
        'hud-panel p-2.5 font-mono text-[10px] flex flex-col gap-2',
      )}
    >
      <Header onClose={toggleTuner} genLabel={activeGen.toUpperCase()} />

      {/* live preview — use a stable wrapper key so the canvas remounts on generator change */}
      <div className="border border-neon-cyan/15 bg-space-950 aspect-[16/10] relative">
        <PresetPreview
          key={activeGen}
          generator={activeGen}
          className="absolute inset-0"
          rotate
          params={current}
        />
        <div className="absolute top-1 left-1.5 px-1.5 py-0.5 bg-space-900/70 border border-neon-cyan/20 text-[9px] tracking-[0.18em] text-neon-cyan">
          LIVE PREVIEW
        </div>
      </div>

      {/* editor */}
      <div className="max-h-[40vh] overflow-y-auto pr-0.5">
        <ParamEditor
          schema={meta.schema}
          values={current}
          onChange={handleChange}
          onReset={handleReset}
        />
      </div>

      <div className="text-[9px] text-mist/70 leading-relaxed border-t border-neon-cyan/10 pt-1.5">
        调整滑块实时更新右侧小预览。主场景模型不受影响(只读 sandbox)。
        参数存于内存,不持久化。
      </div>
    </div>
  );
}

function Header({ onClose, genLabel }: { onClose: () => void; genLabel?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-neon-cyan/15 pb-1.5">
      <div className="flex items-center gap-1.5 text-neon-cyan">
        <Sliders className="w-3.5 h-3.5" />
        <span className="font-display text-[11px] tracking-[0.22em]">TUNER</span>
        {genLabel && (
          <span className="text-[9px] text-mist/80 tracking-[0.18em] ml-1.5">· {genLabel}</span>
        )}
      </div>
      <button
        onClick={onClose}
        className="text-mist hover:text-neon-magenta"
        title="close tuner"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
