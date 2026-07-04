// Inspector — right panel: material editor, lighting, environment, post-fx.
import { useMemo, useState } from 'react';
import {
  Box,
  Brush,
  Camera,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  RotateCcw,
  Sparkles,
  Sun,
} from 'lucide-react';
import { HudPanel } from '@/components/hud/HudPanel';
import { useInspectorStore } from '@/stores/inspectorStore';
import { useUIStore } from '@/stores/uiStore';
import { useViewerStore } from '@/stores/viewerStore';
import { cn } from '@/lib/cn';
import type { EnvironmentPreset } from '@/types';
import { CAMERA_PRESET_LIST, CAMERA_PRESETS } from '@/three/camera';

const ENV_PRESETS: { value: EnvironmentPreset; label: string; color: string }[] = [
  { value: 'studio', label: 'STUDIO', color: 'text-neon-cyan' },
  { value: 'sunset', label: 'SUNSET', color: 'text-neon-amber' },
  { value: 'warehouse', label: 'WAREHOUSE', color: 'text-neon-magenta' },
  { value: 'night', label: 'NIGHT', color: 'text-violet-300' },
  { value: 'city', label: 'CITY', color: 'text-emerald-300' },
];

export function Inspector() {
  const showInspector = useUIStore((s) => s.showInspector);
  const selectedName = useInspectorStore((s) => s.selectedName);
  const selectedType = useInspectorStore((s) => s.selectedType);
  const triCount = useInspectorStore((s) => s.triCount);
  const materials = useInspectorStore((s) => s.materials);
  const focusedMaterialId = useInspectorStore((s) => s.focusedMaterialId);
  const setFocusedMaterial = useInspectorStore((s) => s.setFocusedMaterial);
  const updateMaterial = useInspectorStore((s) => s.updateMaterial);

  const matList = useMemo(() => Object.values(materials), [materials]);
  const focusedMaterial = focusedMaterialId ? materials[focusedMaterialId] : matList[0];

  if (!showInspector) return null;

  return (
    <HudPanel title="INSPECTOR" tag="PROPERTIES" className="h-full" variant="magenta">
      <div className="px-4 py-3 border-b border-neon-magenta/15">
        <div className="flex items-center gap-2 text-magenta-300/90">
          <Box className="w-3.5 h-3.5" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase">SELECTED</span>
        </div>
        <div className="mt-1.5 font-display text-[13px] tracking-[0.14em] text-haze truncate">
          {selectedName}
        </div>
        <div className="mt-1 flex items-center gap-3 font-mono text-[10px] tracking-[0.18em] text-mist">
          <span className="hud-tag hud-tag-magenta">{selectedType.toUpperCase()}</span>
          {triCount > 0 && <span>{Math.round(triCount).toLocaleString()} TRIS</span>}
        </div>
      </div>

      <div className="overflow-y-auto h-[calc(100%-130px)]">
        <Section icon={<Camera className="w-3.5 h-3.5" />} title="Camera / POV">
          <CameraEditor />
        </Section>

        <Section icon={<Brush className="w-3.5 h-3.5" />} title="Material Lab">
          {matList.length === 0 ? (
            <div className="text-mist text-[11px] font-mono px-1">— no materials —</div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {matList.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setFocusedMaterial(m.id)}
                    className={cn(
                      'px-2 py-1 font-mono text-[10px] tracking-[0.16em] uppercase border transition-colors',
                      focusedMaterial?.id === m.id
                        ? 'border-neon-magenta text-neon-magenta bg-neon-magenta/5'
                        : 'border-neon-cyan/20 text-mist hover:text-haze hover:border-neon-cyan/50',
                    )}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle"
                      style={{ backgroundColor: m.baseColor }}
                    />
                    {m.name.slice(0, 10)}
                  </button>
                ))}
              </div>
              {focusedMaterial && (
                <MaterialEditor
                  material={focusedMaterial}
                  onChange={(patch) => updateMaterial(focusedMaterial.id, patch)}
                />
              )}
            </>
          )}
        </Section>

        <Section icon={<Sun className="w-3.5 h-3.5" />} title="Environment">
          <EnvironmentEditor />
        </Section>

        <Section icon={<Sparkles className="w-3.5 h-3.5" />} title="Post FX">
          <PostFXEditor />
        </Section>

        <Section icon={<Lightbulb className="w-3.5 h-3.5" />} title="Display Flags">
          <DisplayFlagsEditor />
        </Section>
      </div>
    </HudPanel>
  );
}

function CameraEditor() {
  const cam = useViewerStore((s) => s.camera);
  const setCameraPreset = useViewerStore((s) => s.setCameraPreset);
  const setCamera = useViewerStore((s) => s.setCamera);
  const resetCamera = useViewerStore((s) => s.resetCamera);
  const presetCfg = CAMERA_PRESETS[cam.preset];

  return (
    <div className="space-y-4">
      {/* Preset grid */}
      <div>
        <div className="hud-label mb-1.5">POV Preset</div>
        <div className="grid grid-cols-3 gap-1.5">
          {CAMERA_PRESET_LIST.map((p) => (
            <button
              key={p.value}
              onClick={() => setCameraPreset(p.value)}
              className={cn(
                'hud-btn !flex-col !items-center !justify-center !text-[9px] !px-1 !py-1.5 !gap-0.5',
                cam.preset === p.value ? '' : 'hud-btn-ghost',
              )}
              title={CAMERA_PRESETS[p.value].description}
            >
              <span className="font-display tracking-[0.18em]">{p.label}</span>
              <span className="text-[8px] opacity-70 tracking-[0.16em]">{p.tag}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] font-mono text-mist leading-relaxed">
          {presetCfg.description}
        </p>
      </div>

      {/* Tunables */}
      <div>
        <div className="hud-label mb-1.5">Lens</div>
        <SliderField
          label="Field of View"
          value={cam.fov}
          min={15}
          max={90}
          step={1}
          onChange={(v) => setCamera({ fov: v })}
          format={(v) => `${v.toFixed(0)}°`}
        />
        <SliderField
          label="Distance"
          value={cam.distance}
          min={0.4}
          max={3.0}
          step={0.05}
          onChange={(v) => setCamera({ distance: v })}
          format={(v) => `${v.toFixed(2)}x`}
        />
        <SliderField
          label="Target Height"
          value={cam.targetHeight}
          min={-0.5}
          max={3.0}
          step={0.05}
          onChange={(v) => setCamera({ targetHeight: v })}
          format={(v) => `${v.toFixed(2)}u`}
        />
      </div>

      {cam.preset === 'cinematic' && (
        <div>
          <div className="hud-label mb-1.5">Cinematic Path</div>
          <SliderField
            label="Orbit Speed"
            value={cam.cinematicSpeed}
            min={0}
            max={1.5}
            step={0.05}
            onChange={(v) => setCamera({ cinematicSpeed: v })}
            format={(v) => `${v.toFixed(2)} rad/s`}
          />
        </div>
      )}

      <div>
        <div className="hud-label mb-1.5">Controls</div>
        <SliderField
          label="Damping"
          value={cam.damping}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(v) => setCamera({ damping: v })}
          format={(v) => v.toFixed(2)}
        />
        <SliderField
          label="Auto-Rotate Speed"
          value={cam.autoRotateSpeed}
          min={0}
          max={1.2}
          step={0.05}
          onChange={(v) => setCamera({ autoRotateSpeed: v })}
          format={(v) => `${v.toFixed(2)} rad/s`}
        />
        <ToggleRow
          label="Free Orbit Input"
          value={cam.orbitEnabled && cam.preset !== 'cinematic'}
          onChange={(v) => setCamera({ orbitEnabled: v })}
        />
      </div>

      <button
        onClick={resetCamera}
        className="hud-btn hud-btn-ghost w-full justify-center !text-[10px]"
      >
        <RotateCcw className="w-3 h-3" />
        <span>Reset Camera</span>
      </button>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b border-neon-cyan/5">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-4 py-2.5 hover:bg-neon-cyan/[0.04] transition-colors"
      >
        <span className="text-neon-cyan">{open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</span>
        <span className="text-neon-cyan">{icon}</span>
        <span className="font-display text-[11px] tracking-[0.22em] text-haze uppercase">{title}</span>
        <span className="ml-auto hud-label">{open ? 'OPEN' : 'CLOSED'}</span>
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

function MaterialEditor({
  material,
  onChange,
}: {
  material: ReturnType<typeof useInspectorStore.getState>['materials'][string];
  onChange: (patch: Record<string, unknown>) => void;
}) {
  return (
    <div className="space-y-3">
      <Field label="Base Color">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={material.baseColor}
            onChange={(e) => onChange({ baseColor: e.target.value })}
            className="w-8 h-8 bg-transparent border border-neon-cyan/30 cursor-pointer"
          />
          <input
            value={material.baseColor}
            onChange={(e) => onChange({ baseColor: e.target.value })}
            className="hud-input font-mono"
          />
        </div>
      </Field>

      <SliderField
        label="Metalness"
        value={material.metalness}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ metalness: v })}
      />
      <SliderField
        label="Roughness"
        value={material.roughness}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ roughness: v })}
      />

      <Field label="Emissive">
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={material.emissive}
            onChange={(e) => onChange({ emissive: e.target.value })}
            className="w-8 h-8 bg-transparent border border-neon-cyan/30 cursor-pointer"
          />
          <input
            value={material.emissive}
            onChange={(e) => onChange({ emissive: e.target.value })}
            className="hud-input font-mono"
          />
        </div>
      </Field>
      <SliderField
        label="Emissive Intensity"
        value={material.emissiveIntensity}
        min={0}
        max={6}
        step={0.05}
        onChange={(v) => onChange({ emissiveIntensity: v })}
      />
      <SliderField
        label="Normal Scale"
        value={material.normalScale}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => onChange({ normalScale: v })}
      />
      <SliderField
        label="Opacity"
        value={material.opacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ opacity: v })}
      />

      <Field label="Wireframe">
        <button
          onClick={() => onChange({ wireframe: !material.wireframe })}
          className={cn(
            'hud-btn w-full justify-center text-[10px]',
            material.wireframe ? 'hud-btn-magenta' : 'hud-btn-ghost',
          )}
        >
          {material.wireframe ? 'ON' : 'OFF'}
        </button>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="hud-label mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
}) {
  const display = format ? format(value) : (step < 0.1 ? value.toFixed(2) : value.toFixed(1));
  return (
    <div>
      <div className="flex items-center justify-between hud-label">
        <span>{label}</span>
        <span className="text-haze tabular-nums text-[10px]">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 mt-1.5 appearance-none bg-space-700 cursor-pointer accent-neon-cyan"
      />
    </div>
  );
}

function EnvironmentEditor() {
  const environment = useUIStore((s) => s.environment);
  const setEnvironment = useUIStore((s) => s.setEnvironment);
  return (
    <div className="space-y-3">
      <div>
        <div className="hud-label mb-1.5">HDRI Preset</div>
        <div className="grid grid-cols-2 gap-1.5">
          {ENV_PRESETS.map((p) => (
            <button
              key={p.value}
              onClick={() => setEnvironment({ preset: p.value })}
              className={cn(
                'hud-btn !text-[10px] !px-2 !py-1.5',
                environment.preset === p.value ? '' : 'hud-btn-ghost',
              )}
            >
              <span className={p.color}>●</span>
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </div>
      <SliderField
        label="Exposure"
        value={environment.exposure}
        min={0.2}
        max={2.5}
        step={0.05}
        onChange={(v) => setEnvironment({ exposure: v })}
      />
      <Field label="Background">
        <div className="grid grid-cols-3 gap-1.5">
          {(['envmap', 'solid', 'transparent'] as const).map((b) => (
            <button
              key={b}
              onClick={() => setEnvironment({ background: b })}
              className={cn(
                'hud-btn !text-[10px] !px-1 !py-1',
                environment.background === b ? '' : 'hud-btn-ghost',
              )}
            >
              {b.toUpperCase()}
            </button>
          ))}
        </div>
      </Field>
    </div>
  );
}

function PostFXEditor() {
  const postFX = useUIStore((s) => s.postFX);
  const setPostFX = useUIStore((s) => s.setPostFX);
  return (
    <div className="space-y-3">
      <ToggleRow label="Bloom" value={postFX.bloom} onChange={(v) => setPostFX({ bloom: v })} />
      {postFX.bloom && (
        <SliderField
          label="Bloom Intensity"
          value={postFX.bloomIntensity}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => setPostFX({ bloomIntensity: v })}
        />
      )}
      <ToggleRow
        label="Chromatic Aberration"
        value={postFX.chromaticAberration}
        onChange={(v) => setPostFX({ chromaticAberration: v })}
      />
      <ToggleRow label="Vignette" value={postFX.vignette} onChange={(v) => setPostFX({ vignette: v })} />
      <ToggleRow label="SSAO" value={postFX.ssao} onChange={(v) => setPostFX({ ssao: v })} />
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="hud-label">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-10 h-5 border transition-colors',
          value ? 'bg-neon-cyan/30 border-neon-cyan' : 'bg-space-800 border-neon-cyan/20',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 w-3.5 h-3.5 transition-transform',
            value ? 'left-[22px] bg-neon-cyan shadow-glow' : 'left-0.5 bg-mist',
          )}
        />
      </button>
    </div>
  );
}

function DisplayFlagsEditor() {
  const showWireframe = useViewerStore((s) => s.showWireframe);
  const toggleWireframe = useViewerStore((s) => s.toggleWireframe);
  const showGround = useViewerStore((s) => s.showGround);
  const toggleGround = useViewerStore((s) => s.toggleGround);
  const autoRotate = useViewerStore((s) => s.autoRotate);
  const toggleAutoRotate = useViewerStore((s) => s.toggleAutoRotate);

  return (
    <div className="space-y-3">
      <ToggleRow label="Wireframe" value={showWireframe} onChange={toggleWireframe} />
      <ToggleRow label="Show Ground" value={showGround} onChange={toggleGround} />
      <ToggleRow label="Auto Rotate" value={autoRotate} onChange={toggleAutoRotate} />
    </div>
  );
}
