// Viewer toolbar: top bar with camera presets, playback, screenshot, exit.
import {
  ArrowLeft,
  Camera,
  Circle,
  Download,
  Pause,
  Play,
  Repeat,
  Save,
  ChevronDown,
  Upload,
  Cpu,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useViewerStore, NO_ASSET_NAME, NO_ASSET_NAME_KEY } from '@/stores/viewerStore';
import { useUIStore } from '@/stores/uiStore';
import { useInspectorStore } from '@/stores/inspectorStore';
import { useWorldStore } from '@/stores/worldStore';
import { screenshotCanvas } from '@/lib/screenshot';
import { cn } from '@/lib/cn';
import type { CameraPreset } from '@/types';
import { CAMERA_PRESET_LIST } from '@/three/camera';
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

function presetToI18nKey(v: string): 'free' | 'iso' | 'front' | 'back' | 'side' | 'top' | 'first' | 'third' | 'cine' {
  switch (v) {
    case 'free': return 'free';
    case 'iso': return 'iso';
    case 'front': return 'front';
    case 'back': return 'back';
    case 'side': return 'side';
    case 'top': return 'top';
    case 'first-person': return 'first';
    case 'third-person': return 'third';
    case 'cinematic': return 'cine';
    default: return 'free';
  }
}

export function ViewerToolbar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const cameraPreset = useViewerStore((s) => s.camera.preset);
  const setCameraPreset = useViewerStore((s) => s.setCameraPreset);
  const animation = useViewerStore((s) => s.animation);
  const setAnimation = useViewerStore((s) => s.setAnimation);
  const assetName = useViewerStore((s) => s.assetName);
  const useCustomRenderer = useViewerStore((s) => s.useCustomRenderer);
  const toggleCustomRenderer = useViewerStore((s) => s.toggleCustomRenderer);
  // 用 selector 订阅,避免 getState 闭包捕到旧值
  const modelFile = useViewerStore((s) => s.currentModelFile);
  const pushLog = useUIStore((s) => s.pushLog);
  const [capturing, setCapturing] = useState(false);
  const [projMenuOpen, setProjMenuOpen] = useState(false);
  const projMenuRef = useRef<HTMLDivElement>(null);
  const projFileInputRef = useRef<HTMLInputElement>(null);

  const togglePlay = () => {
    setAnimation({ isPlaying: !animation.isPlaying });
    pushLog('INFO', animation.isPlaying ? t('toolbar.logs.paused') : t('toolbar.logs.resumed'));
  };

  // Close project menu on outside click
  useEffect(() => {
    if (!projMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (projMenuRef.current && !projMenuRef.current.contains(e.target as Node)) {
        setProjMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setProjMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onEsc);
    };
  }, [projMenuOpen]);

  const exportProject = async (mode: 'vreen' | 'json') => {
    setProjMenuOpen(false);
    try {
      const viewer = useViewerStore.getState();
      const inspector = useInspectorStore.getState();
      const ui = useUIStore.getState();
      // 0.2.1 统一格式：scene + 可选 assets + 可选 world。
      const scene: VreenScene = {
        version: '0.2.1' as const,
        camera: viewer.camera as unknown as Record<string, unknown>,
        animation: { speed: viewer.animation.speed },
        environment: ui.environment as unknown as Record<string, unknown>,
        postFX: ui.postFX as unknown as Record<string, unknown>,
        materials: inspector.materials as unknown as Record<string, unknown>,
      };
      const assets: PackAssetInput[] = [];
      if (mode === 'vreen' && modelFile) {
        const buf = new Uint8Array(await modelFile.arrayBuffer());
        assets.push({
          kind: 'model',
          data: buf,
          originalName: modelFile.name,
        });
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
        ? ` + world(${worldJson.entities.length} entities)`
        : '';
      const modelNote = assets.length > 0 ? ` + model(${assets[0].originalName})` : '';
      pushLog('OK', `Saved .vreen → ${manifest.version} (${manifest.assets.length} assets${modelNote}${worldNote})`);
    } catch (e) {
      pushLog('ERR', `Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleScreenshot = async () => {
    setCapturing(true);
    pushLog('INFO', t('toolbar.logs.capturing'));
    try {
      await screenshotCanvas(`${assetName.replace(/\s+/g, '_')}_${Date.now()}.png`);
      pushLog('OK', t('toolbar.logs.saved'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      pushLog('ERR', t('toolbar.logs.failed', { msg }));
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="relative flex items-center justify-between gap-3 px-4 h-14 bg-space-900/85 backdrop-blur-xl border-b border-neon-cyan/15">
      {/* Left: Back + asset name */}
      <div className="flex items-center gap-3 min-w-0">
        <Link to="/" className="hud-btn hud-btn-ghost shrink-0" aria-label={t('toolbar.exit')}>
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>{t('toolbar.exit')}</span>
        </Link>
        <div className="h-6 w-px bg-neon-cyan/20" />
        <div className="min-w-0">
          <div className="font-mono text-[10px] tracking-[0.22em] text-mist">{t('viewer.ready')}</div>
          <div className="font-display text-[12px] tracking-[0.18em] text-haze truncate">
            {assetName === NO_ASSET_NAME ? t(NO_ASSET_NAME_KEY) : assetName}
          </div>
        </div>
      </div>

      {/* Center: Camera + playback */}
      <div className="hidden lg:flex items-center gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 mr-1 shrink-0">
          <Camera className="w-3 h-3 text-neon-cyan" />
          <span className="hud-label">{t('viewer.pov')}</span>
        </div>
        <div className="flex items-center gap-1 p-1 border border-neon-cyan/20 bg-space-800/40">
          {CAMERA_PRESET_LIST.map((p) => {
            const key = presetToI18nKey(p.value);
            return (
              <button
                key={p.value}
                onClick={() => setCameraPreset(p.value as CameraPreset)}
                className={cn(
                  'px-2 py-1 font-mono text-[10px] tracking-[0.18em] transition-colors shrink-0',
                  cameraPreset === p.value
                    ? 'bg-neon-cyan/15 text-neon-cyan'
                    : 'text-mist hover:text-haze',
                )}
                title={p.tag}
              >
                {t(`viewer.preset.${key}`)}
              </button>
            );
          })}
        </div>

        <div className="w-px h-6 bg-neon-cyan/20 mx-2" />

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={togglePlay}
            className={cn('hud-btn', animation.isPlaying ? '' : 'hud-btn-amber')}
            aria-label={animation.isPlaying ? t('toolbar.pause') : t('toolbar.play')}
          >
            {animation.isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            <span>{animation.isPlaying ? t('toolbar.pause') : t('toolbar.play')}</span>
          </button>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-mist ml-1">
            <Repeat className="w-3 h-3" />
            <span>{t('toolbar.speed')}</span>
            <select
              value={animation.speed}
              onChange={(e) => setAnimation({ speed: parseFloat(e.target.value) })}
              className="bg-space-800 border border-neon-cyan/20 px-1 py-0.5 text-haze"
            >
              {[0.25, 0.5, 1, 1.5, 2].map((s) => (
                <option key={s} value={s}>
                  {s}x
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Right: Project + Screenshot */}
      <div className="flex items-center gap-2">
        {/* Project SAVE / LOAD */}
        <div ref={projMenuRef} className="relative">
          <button
            onClick={() => setProjMenuOpen((o) => !o)}
            className={cn('hud-btn', projMenuOpen && 'bg-neon-cyan/15')}
            aria-label={t('toolbar.project')}
            aria-expanded={projMenuOpen}
          >
            <Save className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{t('toolbar.project')}</span>
            <ChevronDown className={cn('w-3 h-3 transition-transform', projMenuOpen && 'rotate-180')} />
          </button>
          {projMenuOpen && (
            <div
              className="absolute right-0 top-[44px] z-50 w-[260px] p-1 bg-space-900/95 border border-neon-cyan/30 shadow-[0_8px_30px_rgba(0,0,0,0.6)] backdrop-blur-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 border-b border-neon-cyan/10">
                <div className="hud-label">PROJECT</div>
                <div className="text-[10px] text-mist font-mono mt-0.5">
                  {modelFile ? 'model: ' + modelFile.name : 'no embedded model'}
                </div>
              </div>
              <button
                onClick={() => exportProject('vreen')}
                className="w-full text-left px-3 py-2 hover:bg-neon-cyan/10 transition-colors"
              >
                <div className="font-mono text-[11px] text-neon-cyan">SAVE .VREEN</div>
                <div className="text-[10px] text-mist font-mono">
                  {modelFile ? 'state + embedded model (zip)' : 'model missing — choose JSON'}
                </div>
              </button>
              <button
                onClick={() => exportProject('json')}
                className="w-full text-left px-3 py-2 hover:bg-neon-cyan/10 transition-colors"
              >
                <div className="font-mono text-[11px] text-haze">SAVE .VREEN.JSON</div>
                <div className="text-[10px] text-mist font-mono">state only, small file</div>
              </button>
              <div className="my-1 border-t border-neon-cyan/10" />
              <button
                onClick={() => {
                  setProjMenuOpen(false);
                  projFileInputRef.current?.click();
                }}
                className="w-full text-left px-3 py-2 hover:bg-neon-cyan/10 transition-colors flex items-center gap-2"
              >
                <Upload className="w-3 h-3 text-neon-cyan" />
                <div>
                  <div className="font-mono text-[11px] text-neon-cyan">LOAD .VREEN</div>
                  <div className="text-[10px] text-mist font-mono">apply saved state (or restore bundle)</div>
                </div>
              </button>
              <input
                ref={projFileInputRef}
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
                      // 写回 scene 到 store
                      useViewerStore.setState((s) => ({
                        camera: { ...s.camera, ...(unpacked.scene.camera as object) },
                        animation: { ...s.animation, ...unpacked.scene.animation },
                        assetName: unpacked.manifest.assetName || unpacked.manifest.name,
                      }));
                      useInspectorStore.setState({ materials: unpacked.scene.materials as any });
                      useUIStore.setState({
                        environment: unpacked.scene.environment as any,
                        postFX: unpacked.scene.postFX as any,
                        envCustomFile: null,
                      });
                      // 写回 world
                      if (unpacked.manifest.world) {
                        useWorldStore.getState().deserialize(unpacked.manifest.world);
                        pushLog(
                          'OK',
                          `Loaded .vreen 0.2.1 → ${unpacked.manifest.assetName} ` +
                            `+ world(${unpacked.manifest.world.entities.length})`,
                        );
                      } else {
                        pushLog('OK', `Loaded .vreen 0.2.1 → ${unpacked.manifest.assetName}`);
                      }
                      // 找嵌入模型
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
                          navigate('/viewer');
                        }
                      }
                    } else {
                      // 0.1.x 兼容：转交 export.ts 的 importVreenPackageFile
                      const { pkg, modelFile: mFile } = await importVreenPackageFile(f);
                      if (mFile) {
                        uploadBridge.set(mFile);
                        useViewerStore
                          .getState()
                          .setAssetSource({ kind: 'upload', uploadId: mFile.name }, mFile.name);
                        pushLog('OK', `Loaded .vreen 0.1.x → ${mFile.name} + state`);
                        navigate('/viewer');
                      } else {
                        pushLog('OK', `Applied .vreen.json 0.1.x state (${pkg.assetName || '—'})`);
                      }
                    }
                  } catch (err) {
                    pushLog('ERR', `Import failed: ${err instanceof Error ? err.message : String(err)}`);
                  }
                }}
              />
            </div>
          )}
        </div>

        <button
          onClick={() => {
            toggleCustomRenderer();
            pushLog('INFO', useCustomRenderer ? 'Switched to three.js renderer' : 'Switched to custom WebGL2 renderer');
          }}
          className={cn('hud-btn', useCustomRenderer && 'bg-neon-cyan/15 text-neon-cyan')}
          title="Toggle custom WebGL2 engine"
        >
          <Cpu className="w-3.5 h-3.5" />
          <span className="hidden md:inline">{useCustomRenderer ? 'CUSTOM' : 'THREE'}</span>
        </button>

        <button
          onClick={handleScreenshot}
          disabled={capturing}
          className={cn('hud-btn hud-btn-magenta', capturing && 'opacity-60')}
          aria-label={t('viewer.capture')}
        >
          {capturing ? <Circle className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          <span>{capturing ? t('viewer.capturing') : t('viewer.capture')}</span>
        </button>
      </div>
    </div>
  );
}
