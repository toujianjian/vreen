// Inspector — right panel: material editor, lighting, environment, post-fx.
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Brush,
  Camera,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  Lightbulb,
  RotateCcw,
  Sparkles,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import { HudPanel } from '@/components/hud/HudPanel';
import { useInspectorStore } from '@/stores/inspectorStore';
import { useUIStore } from '@/stores/uiStore';
import { useViewerStore } from '@/stores/viewerStore';
import { useWorldStore } from '@/stores/worldStore';
import { cn } from '@/lib/cn';
import type { EnvironmentPreset } from '@/types';
import { CAMERA_PRESET_LIST, CAMERA_PRESETS } from '@/three/camera';
import { ColorField } from '@/components/viewer/ColorField';
import { ECSPanel } from '@/components/viewer/ECSPanel';
import {
  packVreenPackage,
  unpackVreenPackage,
  downloadVreenBytes,
  type VreenScene,
  type PackAssetInput,
} from '@/lib/vreenPack';
import { importVreenPackageFile } from '@/lib/export';
import { uploadBridge } from '@/lib/uploadBridge';
import { useNavigate } from 'react-router-dom';

export function Inspector() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showInspector = useUIStore((s) => s.showInspector);
  const selectedName = useInspectorStore((s) => s.selectedName);
  const selectedType = useInspectorStore((s) => s.selectedType);
  const triCount = useInspectorStore((s) => s.triCount);
  const materials = useInspectorStore((s) => s.materials);
  const focusedMaterialId = useInspectorStore((s) => s.focusedMaterialId);
  const setFocusedMaterial = useInspectorStore((s) => s.setFocusedMaterial);
  const updateMaterial = useInspectorStore((s) => s.updateMaterial);
  const currentModelFile = useViewerStore((s) => s.currentModelFile);

  const matList = useMemo(() => Object.values(materials), [materials]);
  const focusedMaterial = focusedMaterialId ? materials[focusedMaterialId] : matList[0];

  if (!showInspector) return null;

  return (
    <HudPanel title={t('viewer.inspector')} tag={t('viewer.inspectorTag')} className="h-full flex flex-col" bodyClassName="flex-1 min-h-0 flex flex-col" variant="magenta">
      <div className="shrink-0 px-4 py-3 border-b border-neon-magenta/15">
        <div className="flex items-center gap-2 text-magenta-300/90">
          <Box className="w-3.5 h-3.5" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase">{t('viewer.selected')}</span>
        </div>
        <div className="mt-1.5 font-display text-[13px] tracking-[0.14em] text-haze truncate">
          {selectedName}
        </div>
        <div className="mt-1 flex items-center gap-3 font-mono text-[10px] tracking-[0.18em] text-mist">
          <span className="hud-tag hud-tag-magenta">{t(`nodeKind.${selectedType}`, { defaultValue: selectedType.toUpperCase() })}</span>
          {triCount > 0 && <span>{Math.round(triCount).toLocaleString()} TRIS</span>}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <Section icon={<Camera className="w-3.5 h-3.5" />} title={t('viewer.camera')}>
          <CameraEditor />
        </Section>

        <Section icon={<Box className="w-3.5 h-3.5" />} title="GEOMETRY">
          <GeometryPanel />
        </Section>

        <Section icon={<Brush className="w-3.5 h-3.5" />} title={t('viewer.materialLab')}>
          {matList.length === 0 ? (
            <div className="text-mist text-[11px] font-mono px-1">{t('viewer.noMaterials')}</div>
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

        <Section icon={<Sparkles className="w-3.5 h-3.5" />} title={t('viewer.postFX')}>
          <PostFXEditor />
        </Section>

        <Section icon={<Lightbulb className="w-3.5 h-3.5" />} title={t('viewer.displayFlags')}>
          <DisplayFlagsEditor />
        </Section>

        <Section icon={<Cpu className="w-3.5 h-3.5" />} title="ECS WORLD">
          <ECSPanel />
        </Section>
      </div>

      <div className="shrink-0 px-4 py-3 border-t border-neon-magenta/15 space-y-1.5">
        <button
          onClick={async () => {
            const viewer = useViewerStore.getState();
            const inspector = useInspectorStore.getState();
            const ui = useUIStore.getState();
            const modelFile = useViewerStore.getState().currentModelFile;
            try {
              const scene: VreenScene = {
                version: '0.2.1' as const,
                camera: viewer.camera as unknown as Record<string, unknown>,
                animation: { speed: viewer.animation.speed },
                environment: ui.environment as unknown as Record<string, unknown>,
                postFX: ui.postFX as unknown as Record<string, unknown>,
                materials: inspector.materials as unknown as Record<string, unknown>,
              };
              const assets: PackAssetInput[] = [];
              if (modelFile) {
                const buf = new Uint8Array(await modelFile.arrayBuffer());
                assets.push({ kind: 'model', data: buf, originalName: modelFile.name });
              }
              const worldJson = useWorldStore.getState().serialize();
              const { bytes, manifest } = packVreenPackage({
                name: viewer.assetName || 'project',
                assetName: viewer.assetName || 'project',
                scene,
                assets,
                world: worldJson ?? undefined,
              });
              downloadVreenBytes(bytes, viewer.assetName);
              const worldNote = worldJson
                ? ` + world(${worldJson.entities.length})`
                : '';
              const modelNote = assets.length > 0 ? ` + model(${assets[0].originalName})` : '';
              useUIStore
                .getState()
                .pushLog('OK', `Saved .vreen → ${manifest.version}${modelNote}${worldNote}`);
            } catch (e) {
              const msg = e instanceof Error ? e.message : String(e);
              useUIStore.getState().pushLog('ERR', `Export failed: ${msg}`);
            }
          }}
          className="hud-btn hud-btn-magenta w-full justify-center !text-[10px]"
          title={
            currentModelFile
              ? t('viewer.exportBundleHint')
              : t('viewer.exportJsonHint')
          }
        >
          <Download className="w-3 h-3" />
          <span>
            {currentModelFile
              ? t('viewer.exportBundle')
              : t('viewer.exportProject')}
          </span>
        </button>
        <label className="hud-btn hud-btn-ghost w-full justify-center !text-[10px] cursor-pointer">
          <Upload className="w-3 h-3" />
          <span>{t('viewer.importProject')}</span>
          <input
            type="file"
            accept=".vreen,.vreen.json,application/json,application/zip"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                // 嗅探 zip / json：zip 走 0.2.1 unpackVreenPackage, json 走 export.ts 的 0.1.0 legacy。
                const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
                const isZip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
                if (isZip) {
                  const bytes = new Uint8Array(await f.arrayBuffer());
                  const unpacked = await unpackVreenPackage(bytes);
                  useViewerStore.setState((s) => ({
                    camera: { ...s.camera, ...(unpacked.scene.camera as object) },
                    animation: { ...s.animation, ...unpacked.scene.animation },
                    assetName: unpacked.manifest.assetName || unpacked.manifest.name,
                  }));
                  useInspectorStore.setState({ materials: unpacked.scene.materials as never });
                  useUIStore.setState({
                    environment: unpacked.scene.environment as never,
                    postFX: unpacked.scene.postFX as never,
                    envCustomFile: null,
                  });
                  if (unpacked.manifest.world) {
                    useWorldStore.getState().deserialize(unpacked.manifest.world);
                  }
                  const modelEntry = unpacked.manifest.assets.find((a) => a.kind === 'model');
                  if (modelEntry) {
                    const data = unpacked.assets.get(modelEntry.id);
                    if (data) {
                      const ext = (modelEntry.originalName ?? 'glb').split('.').pop() ?? 'glb';
                      const mFile = new File([data as unknown as BlobPart], `embedded.${ext}`, { type: 'application/octet-stream' });
                      uploadBridge.set(mFile);
                      useViewerStore.getState().setAssetSource(
                        { kind: 'upload', uploadId: mFile.name },
                        unpacked.manifest.assetName,
                      );
                      useUIStore
                        .getState()
                        .pushLog('OK', `Imported .vreen 0.2.1 → ${unpacked.manifest.assetName} + model`);
                      navigate('/viewer');
                      return;
                    }
                  }
                  useUIStore
                    .getState()
                    .pushLog('OK', `Imported .vreen 0.2.1 state → ${unpacked.manifest.assetName}`);
                } else {
                  // 0.1.x 兼容路径
                  const { pkg, modelFile } = await importVreenPackageFile(f);
                  if (modelFile) {
                    uploadBridge.set(modelFile);
                    useViewerStore
                      .getState()
                      .setAssetSource(
                        { kind: 'upload', uploadId: modelFile.name },
                        modelFile.name,
                      );
                    useUIStore
                      .getState()
                      .pushLog(
                        'OK',
                        `Imported .vreen 0.1.x → ${modelFile.name} + state`,
                      );
                    navigate('/viewer');
                  } else {
                    useUIStore
                      .getState()
                      .pushLog(
                        'OK',
                        `Imported .vreen.json 0.1.x state (${pkg.assetName || '—'})`,
                      );
                  }
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                useUIStore.getState().pushLog('ERR', `Import failed: ${msg}`);
              }
            }}
          />
        </label>
      </div>
    </HudPanel>
  );
}

/**
 * GeometryPanel — shows vertex / face / attribute / bbox / texture info
 * for the currently selected mesh. Game developers typically want this
 * before optimizing a model (LOD decisions, texture budget, etc.).
 */
function GeometryPanel() {
  const selectedUuid = useInspectorStore((s) => s.selectedUuid);
  const selectedName = useInspectorStore((s) => s.selectedName);
  const selectedType = useInspectorStore((s) => s.selectedType);
  const triCount = useInspectorStore((s) => s.triCount);
  const stats = useInspectorStore((s) => s.geometryStats);

  if (!stats) {
    return (
      <div className="text-mist text-[11px] font-mono px-1 py-2 leading-relaxed">
        {selectedUuid
          ? `Selected: ${selectedName} (${selectedType}). Click a Mesh in the outliner or 3D view to inspect vertex / face / texture data.`
          : 'No mesh selected. Click a part in the 3D view or outliner.'}
      </div>
    );
  }

  const fmt = (n: number) => n.toLocaleString('en-US');
  const fmtVec = (v: [number, number, number], digits = 3) =>
    `(${v.map((x) => x.toFixed(digits)).join(', ')})`;

  return (
    <div className="space-y-2.5">
      {/* Identity row */}
      <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
        <Stat label="NAME" value={selectedName} mono />
        <Stat label="KIND" value={selectedType} mono />
        <Stat label="VERTICES" value={fmt(stats.vertexCount)} accent />
        <Stat label="TRIANGLES" value={fmt(Math.max(stats.faceCount, triCount))} accent />
        <Stat label="INDEXED" value={stats.indexed ? 'YES' : 'NO'} mono />
        <Stat label="GROUPS" value={String(stats.groupCount)} mono />
      </div>

      {/* Attributes */}
      <div>
        <div className="hud-label mb-1">ATTRIBUTES</div>
        <div className="grid grid-cols-5 gap-1 font-mono text-[10px]">
          <AttrTag on={stats.hasPosition} label="POS" />
          <AttrTag on={stats.hasNormal} label="NRM" />
          <AttrTag on={stats.hasUV} label="UV" />
          <AttrTag on={stats.hasColor} label="CLR" />
          <AttrTag on={stats.hasTangent} label="TAN" />
        </div>
      </div>

      {/* AABB */}
      {stats.bbox && (
        <div>
          <div className="hud-label mb-1">BOUNDING BOX (LOCAL)</div>
          <div className="font-mono text-[10px] leading-relaxed">
            <div className="text-mist">min  <span className="text-haze">{fmtVec(stats.bbox.min)}</span></div>
            <div className="text-mist">max  <span className="text-haze">{fmtVec(stats.bbox.max)}</span></div>
            <div className="text-mist">size <span className="text-neon-cyan">{fmtVec(stats.bbox.size)}</span></div>
          </div>
        </div>
      )}

      {/* Textures */}
      <div>
        <div className="hud-label mb-1">TEXTURES · {stats.textures.length}</div>
        {stats.textures.length === 0 ? (
          <div className="text-mist text-[10px] font-mono">none</div>
        ) : (
          <ul className="font-mono text-[10px] space-y-0.5 max-h-32 overflow-y-auto">
            {stats.textures.map((t, i) => (
              <li key={i} className="text-haze/85 truncate" title={t}>
                <span className="text-neon-cyan mr-1">▸</span>{t}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
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

function AttrTag({ on, label }: { on: boolean; label: string }) {
  return (
    <div
      className={cn(
        'text-center py-1 border transition-colors',
        on
          ? 'border-neon-cyan/40 bg-neon-cyan/10 text-neon-cyan'
          : 'border-neon-cyan/10 text-mist/40',
      )}
    >
      {label}
    </div>
  );
}

function CameraEditor() {
  const { t } = useTranslation();
  const cam = useViewerStore((s) => s.camera);
  const setCameraPreset = useViewerStore((s) => s.setCameraPreset);
  const setCamera = useViewerStore((s) => s.setCamera);
  const resetCamera = useViewerStore((s) => s.resetCamera);
  const presetCfg = CAMERA_PRESETS[cam.preset];

  return (
    <div className="space-y-4">
      {/* Preset grid */}
      <div>
        <div className="hud-label mb-1.5">{t('viewer.cameraEditor.povPreset')}</div>
        <div className="grid grid-cols-3 gap-1.5">
          {CAMERA_PRESET_LIST.map((p) => (
            <button
              key={p.value}
              onClick={() => setCameraPreset(p.value)}
              className={cn(
                'hud-btn !flex-col !items-center !justify-center !text-[9px] !px-1 !py-1.5 !gap-0.5',
                cam.preset === p.value ? '' : 'hud-btn-ghost',
              )}
              title={t(CAMERA_PRESETS[p.value].descriptionKey)}
            >
              <span className="font-display tracking-[0.18em]">{p.label}</span>
              <span className="text-[8px] opacity-70 tracking-[0.16em]">{p.tag}</span>
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] font-mono text-mist leading-relaxed">
          {t(presetCfg.descriptionKey)}
        </p>
      </div>

      {/* Tunables */}
      <div>
        <div className="hud-label mb-1.5">{t('viewer.cameraEditor.lens')}</div>
        <SliderField
          label={t('viewer.fov')}
          value={cam.fov}
          min={15}
          max={90}
          step={1}
          onChange={(v) => setCamera({ fov: v })}
          format={(v) => `${v.toFixed(0)}°`}
        />
        <SliderField
          label={t('viewer.cameraEditor.distance')}
          value={cam.distance}
          min={0.4}
          max={3.0}
          step={0.05}
          onChange={(v) => setCamera({ distance: v })}
          format={(v) => `${v.toFixed(2)}x`}
        />
        <SliderField
          label={t('viewer.cameraEditor.targetHeight')}
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
          <div className="hud-label mb-1.5">{t('viewer.cameraEditor.cinematic')}</div>
          <SliderField
            label={t('viewer.cameraEditor.orbitSpeed')}
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
        <div className="hud-label mb-1.5">{t('viewer.cameraEditor.controls')}</div>
        <SliderField
          label={t('viewer.cameraEditor.damping')}
          value={cam.damping}
          min={0}
          max={0.3}
          step={0.01}
          onChange={(v) => setCamera({ damping: v })}
          format={(v) => v.toFixed(2)}
        />
        <SliderField
          label={t('viewer.cameraEditor.autoRotate')}
          value={cam.autoRotateSpeed}
          min={0}
          max={1.2}
          step={0.05}
          onChange={(v) => setCamera({ autoRotateSpeed: v })}
          format={(v) => `${v.toFixed(2)} rad/s`}
        />
        <ToggleRow
          label={t('viewer.cameraEditor.freeOrbit')}
          value={cam.orbitEnabled && cam.preset !== 'cinematic'}
          onChange={(v) => setCamera({ orbitEnabled: v })}
        />
      </div>

      <button
        onClick={resetCamera}
        className="hud-btn hud-btn-ghost w-full justify-center !text-[10px]"
      >
        <RotateCcw className="w-3 h-3" />
        <span>{t('viewer.reset')}</span>
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
  const { t } = useTranslation();
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
        <span className="ml-auto hud-label">{open ? t('viewer.cameraEditor.open') : t('viewer.cameraEditor.closed')}</span>
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
  const { t } = useTranslation();
  return (
    <div className="space-y-3">
      <Field label={t('viewer.field.baseColor')}>
        <ColorField
          value={material.baseColor}
          onChange={(v) => onChange({ baseColor: v })}
        />
      </Field>

      <SliderField
        label={t('viewer.field.metalness')}
        value={material.metalness}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ metalness: v })}
      />
      <SliderField
        label={t('viewer.field.roughness')}
        value={material.roughness}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ roughness: v })}
      />

      <Field label={t('viewer.field.emissive')}>
        <ColorField
          value={material.emissive}
          onChange={(v) => onChange({ emissive: v })}
        />
      </Field>
      <SliderField
        label={t('viewer.field.emissiveIntensity')}
        value={material.emissiveIntensity}
        min={0}
        max={6}
        step={0.05}
        onChange={(v) => onChange({ emissiveIntensity: v })}
      />
      <SliderField
        label={t('viewer.field.normalScale')}
        value={material.normalScale}
        min={0}
        max={2}
        step={0.05}
        onChange={(v) => onChange({ normalScale: v })}
      />
      <SliderField
        label={t('viewer.field.opacity')}
        value={material.opacity}
        min={0}
        max={1}
        step={0.01}
        onChange={(v) => onChange({ opacity: v })}
      />

      <Field label={t('viewer.field.wireframe')}>
        <button
          onClick={() => onChange({ wireframe: !material.wireframe })}
          className={cn(
            'hud-btn w-full justify-center text-[10px]',
            material.wireframe ? 'hud-btn-magenta' : 'hud-btn-ghost',
          )}
        >
          {material.wireframe ? t('viewer.cameraEditor.on') : t('viewer.cameraEditor.off')}
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
        className="hud-range mt-1.5"
      />
    </div>
  );
}

function PostFXEditor() {
  const { t } = useTranslation();
  const postFX = useUIStore((s) => s.postFX);
  const setPostFX = useUIStore((s) => s.setPostFX);
  return (
    <div className="space-y-3">
      <ToggleRow label={t('viewer.bloom')} value={postFX.bloom} onChange={(v) => setPostFX({ bloom: v })} />
      {postFX.bloom && (
        <SliderField
          label={t('viewer.bloomIntensity')}
          value={postFX.bloomIntensity}
          min={0}
          max={2}
          step={0.05}
          onChange={(v) => setPostFX({ bloomIntensity: v })}
        />
      )}
      <ToggleRow
        label={t('viewer.chromatic')}
        value={postFX.chromaticAberration}
        onChange={(v) => setPostFX({ chromaticAberration: v })}
      />
      <ToggleRow label={t('viewer.vignette')} value={postFX.vignette} onChange={(v) => setPostFX({ vignette: v })} />
      <ToggleRow label={t('viewer.ssao')} value={postFX.ssao} onChange={(v) => setPostFX({ ssao: v })} />
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
  const { t } = useTranslation();
  const showWireframe = useViewerStore((s) => s.showWireframe);
  const toggleWireframe = useViewerStore((s) => s.toggleWireframe);
  const showGround = useViewerStore((s) => s.showGround);
  const toggleGround = useViewerStore((s) => s.toggleGround);
  const autoRotate = useViewerStore((s) => s.autoRotate);
  const toggleAutoRotate = useViewerStore((s) => s.toggleAutoRotate);

  return (
    <div className="space-y-3">
      <ToggleRow label={t('viewer.wireframe')} value={showWireframe} onChange={toggleWireframe} />
      <ToggleRow label={t('viewer.ground')} value={showGround} onChange={toggleGround} />
      <ToggleRow label={t('viewer.autoRotate')} value={autoRotate} onChange={toggleAutoRotate} />
    </div>
  );
}
