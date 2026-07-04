// Drag-and-drop uploader for the home page.
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, FileBox, UploadCloud, X } from 'lucide-react';
import { HudPanel } from '@/components/hud/HudPanel';
import { ALL_FORMATS, FORMAT_LABEL, detectFormat, formatBytes } from '@/lib/format';
import { useUIStore } from '@/stores/uiStore';
import { useViewerStore } from '@/stores/viewerStore';
import { uploadBridge } from '@/lib/uploadBridge';

const ACCEPT = '.glb,.gltf,.obj,.fbx,.stl,.ply';

export function Uploader() {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pushLog = useUIStore((s) => s.pushLog);
  const setAssetSource = useViewerStore((s) => s.setAssetSource);
  const setAssetName = useViewerStore((s) => s.setAssetName);
  const navigate = useNavigate();

  const handleFile = useCallback(
    (f: File) => {
      setError(null);
      const fmt = detectFormat(f.name);
      if (!fmt) {
        setError(t('uploader.errors.unsupported', { name: f.name }));
        pushLog('ERR', t('uploader.logs.rejected', { name: f.name }));
        return;
      }
      if (f.size > 50 * 1024 * 1024) {
        setError(t('uploader.errors.tooLarge', { name: f.name }));
        pushLog('WARN', t('uploader.logs.exceeds', { name: f.name }));
        return;
      }
      setFile(f);
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
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 mt-2">
                    {ALL_FORMATS.map((f) => (
                      <span key={f} className="hud-tag hud-tag-mist">
                        {FORMAT_LABEL[f]}
                      </span>
                    ))}
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
                </div>
                {file ? (
                  <div className="space-y-2">
                    <div className="font-mono text-[12px] text-haze break-all">{file.name}</div>
                    <div className="flex items-center gap-3 font-mono text-[10px] tracking-[0.2em] text-mist">
                      <span>{formatBytes(file.size)}</span>
                      <span className="w-1 h-1 rounded-full bg-mist" />
                      <span className="text-neon-cyan">{FORMAT_LABEL[detectFormat(file.name) ?? 'glb']}</span>
                    </div>
                    <div className="flex items-center gap-2 text-neon-cyan text-[10px] tracking-[0.2em] font-mono">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>{t('uploader.ready')}</span>
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
                <span>{t('uploader.submit')}</span>
              </button>
            </div>
          </div>
        </div>
      </HudPanel>
    </section>
  );
}
