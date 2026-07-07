// Drag-and-drop uploader for the home page.
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FileBox, UploadCloud, X } from 'lucide-react';
import { HudPanel } from '@/components/hud/HudPanel';
import { ALL_FORMATS, FORMAT_LABEL, detectFormat, formatBytes } from '@/lib/format';
import { isVreenPackageFile, importVreenPackageFile } from '@/lib/export';
import { useUIStore } from '@/stores/uiStore';
import { useViewerStore } from '@/stores/viewerStore';
import { uploadBridge } from '@/lib/uploadBridge';

/** Hard cap on 3D model file size (200 MB). Most GLB files are < 50 MB. */
export const MAX_MODEL_BYTES = 200 * 1024 * 1024;

const ACCEPT = '.glb,.gltf,.obj,.fbx,.stl,.ply,.vreen,.vreen.json';

export function Uploader() {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [vreenPkg, setVreenPkg] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pushLog = useUIStore((s) => s.pushLog);
  const setAssetSource = useViewerStore((s) => s.setAssetSource);
  const setAssetName = useViewerStore((s) => s.setAssetName);
  const navigate = useNavigate();

  const handleFile = useCallback(
    async (f: File) => {
      setError(null);
      // 1. .vreen project package (state-only, no 3D model)
      if (isVreenPackageFile(f.name)) {
        try {
          const { pkg, modelFile } = await importVreenPackageFile(f);
          setFile(f);
          setVreenPkg(true);
          if (modelFile) {
            // Self-contained bundle: also queue the embedded model
            uploadBridge.set(modelFile);
            pushLog(
              'OK',
              t('uploader.logs.vreenImported', {
                name: f.name,
                asset: `${pkg.assetName || '—'} (+ ${modelFile.name})`,
              }),
            );
          } else {
            pushLog(
              'OK',
              t('uploader.logs.vreenImported', {
                name: f.name,
                asset: pkg.assetName || '—',
              }),
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(t('uploader.errors.vreenInvalid', { name: f.name, msg }));
          pushLog('ERR', t('uploader.logs.vreenFailed', { name: f.name, msg }));
        }
        return;
      }

      // 2. 3D model
      const fmt = detectFormat(f.name);
      if (!fmt) {
        setError(t('uploader.errors.unsupported', { name: f.name }));
        pushLog('ERR', t('uploader.logs.rejected', { name: f.name }));
        return;
      }
      if (f.size > MAX_MODEL_BYTES) {
        setError(
          t('uploader.errors.tooLarge', {
            name: f.name,
            size: formatBytes(MAX_MODEL_BYTES),
          }),
        );
        pushLog(
          'WARN',
          t('uploader.logs.exceeds', { name: f.name, size: formatBytes(MAX_MODEL_BYTES) }),
        );
        return;
      }
      setFile(f);
      setVreenPkg(false);
      pushLog(
        'OK',
        t('uploader.logs.parsed', { name: f.name, format: FORMAT_LABEL[fmt], size: formatBytes(f.size) }),
      );
    },
    [pushLog, t],
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files?.[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const onSubmit = () => {
    if (!file) return;
    if (vreenPkg) {
      // Already applied during handleFile. Just jump to viewer.
      pushLog('INFO', t('uploader.logs.init', { name: file.name }));
      navigate('/viewer');
      return;
    }
    const fmt = detectFormat(file.name);
    if (!fmt) return;
    // Hand the file off to the viewer via a module-level bridge
    uploadBridge.set(file);
    setAssetSource({ kind: 'upload', uploadId: file.name }, file.name);
    setAssetName(file.name);
    pushLog('INFO', t('uploader.logs.init', { name: file.name }));
    navigate('/viewer');
  };

  return (
    <section className="relative max-w-[1600px] mx-auto px-5 py-12">
      <HudPanel title={t('uploader.title')} tag={t('uploader.tag')}>
        <div className="p-6 lg:p-10">
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
            <div className="lg:col-span-3">
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
                }}
                className={`relative cursor-pointer h-72 lg:h-80 transition-all duration-300 border-2 border-dashed ${
                  dragging
                    ? 'border-neon-cyan bg-neon-cyan/5 shadow-glow'
                    : 'border-neon-cyan/30 bg-space-800/40 hover:border-neon-cyan/60 hover:bg-space-800/70'
                }`}
              >
                {/* Corner accents */}
                <span className="absolute top-0 left-0 w-4 h-4 border-t-2 border-l-2 border-neon-cyan" />
                <span className="absolute top-0 right-0 w-4 h-4 border-t-2 border-r-2 border-neon-cyan" />
                <span className="absolute bottom-0 left-0 w-4 h-4 border-b-2 border-l-2 border-neon-cyan" />
                <span className="absolute bottom-0 right-0 w-4 h-4 border-b-2 border-r-2 border-neon-cyan" />

                <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 gap-4">
                  <div className="relative">
                    <UploadCloud
                      className={`w-12 h-12 ${
                        dragging ? 'text-neon-cyan' : 'text-neon-cyan/70'
                      } transition-colors`}
                    />
                    {dragging && (
                      <div className="absolute inset-0 blur-xl bg-neon-cyan/30 -z-10 animate-pulse-slow" />
                    )}
                  </div>
                  <div>
                    <div className="font-display text-[15px] tracking-[0.3em] text-haze">
                      {dragging ? t('uploader.drop') : t('uploader.subtitle')}
                    </div>
                    <div className="mt-1.5 font-mono text-[10px] tracking-[0.22em] text-mist">
                      {t('uploader.or')} {t('uploader.browse')} · {t('uploader.maxSize')}
                    </div>
                    <div className="mt-1 font-mono text-[9px] tracking-[0.2em] text-neon-cyan/80">
                      {t('uploader.vreenHint')}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
                    {ALL_FORMATS.map((f) => (
                      <span key={f} className="hud-tag hud-tag-mist">
                        {FORMAT_LABEL[f]}
                      </span>
                    ))}
                    <span className="hud-tag hud-tag-cyan">.VREEN</span>
                  </div>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                  }}
                />
              </div>
            </div>

            <div className="lg:col-span-2 space-y-4">
              <div className="hud-clip hud-panel p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <FileBox className="w-4 h-4 text-neon-cyan" />
                  <span className="hud-label">{t('uploader.parsed')}</span>
                  {vreenPkg && file && (
                    <span className="hud-tag hud-tag-cyan ml-auto">.VREEN</span>
                  )}
                </div>
                {file ? (
                  <div className="space-y-2">
                    <div className="font-mono text-[12px] text-haze break-all">{file.name}</div>
                    <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.2em] text-mist">
                      <span>{formatBytes(file.size)}</span>
                      {!vreenPkg && (
                        <>
                          <span className="w-1 h-1 rounded-full bg-mist" />
                          <span className="text-neon-cyan">
                            {FORMAT_LABEL[detectFormat(file.name) ?? 'glb']}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-neon-cyan text-[10px] tracking-[0.2em] font-mono">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>
                        {vreenPkg
                          ? t('uploader.vreenReady')
                          : t('uploader.ready')}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="text-mist text-[11px] font-mono">{t('uploader.empty')}</div>
                )}
                {error && (
                  <div className="flex items-center gap-2 text-neon-magenta text-[10px] tracking-[0.2em] font-mono">
                    <X className="w-3 h-3" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <button
                onClick={onSubmit}
                disabled={!file}
                className="hud-btn hud-btn-magenta w-full justify-center"
                aria-disabled={!file}
              >
                <UploadCloud className="w-3.5 h-3.5" />
                <span>
                  {vreenPkg ? t('uploader.openProject') : t('uploader.submit')}
                </span>
              </button>
            </div>
          </div>
        </div>
      </HudPanel>
    </section>
  );
}
