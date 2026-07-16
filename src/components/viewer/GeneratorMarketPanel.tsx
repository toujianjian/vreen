// GeneratorMarketPanel — 生成器市场浏览/安装/卸载 UI。
//
// 功能:
//   - 浏览本地已安装的生成器
//   - 远程市场搜索(如果配置了 remoteUrl)
//   - 安装/卸载/启用/禁用
//   - 预览生成器代码和参数 schema

import { useState, useEffect, useCallback } from 'react';
import { Search, Download, Trash2, Power, Code, X, Package, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { GeneratorMarket, GeneratorScript, RemoteMarketEntry } from '@/lib/generatorMarket';

interface GeneratorMarketPanelProps {
  market: GeneratorMarket;
  onClose: () => void;
}

type ViewMode = 'installed' | 'browse' | 'detail';

export function GeneratorMarketPanel({ market, onClose }: GeneratorMarketPanelProps) {
  const [view, setView] = useState<ViewMode>('installed');
  const [installed, setInstalled] = useState<GeneratorScript[]>([]);
  const [query, setQuery] = useState('');
  const [browseResults, setBrowseResults] = useState<RemoteMarketEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshInstalled = useCallback(() => {
    setInstalled(market.local.list());
  }, [market]);

  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  const handleUninstall = useCallback((id: string) => {
    if (!confirm(`Uninstall "${id}"?`)) return;
    market.uninstall(id);
    refreshInstalled();
  }, [market, refreshInstalled]);

  const handleToggle = useCallback((id: string, enabled: boolean) => {
    market.registry.enable(id, enabled);
    refreshInstalled();
  }, [market, refreshInstalled]);

  const handleBrowse = useCallback(async () => {
    if (!market.remote) {
      setError('Remote market not configured');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await market.remote.browse({ limit: 50 });
      const filtered = query
        ? res.entries.filter((e) =>
            e.name.toLowerCase().includes(query.toLowerCase()) ||
            e.id.toLowerCase().includes(query.toLowerCase()) ||
            e.description.toLowerCase().includes(query.toLowerCase())
          )
        : res.entries;
      setBrowseResults(filtered);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [market, query]);

  const handleInstall = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await market.installFromRemote(id);
      refreshInstalled();
      setView('installed');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [market, refreshInstalled]);

  useEffect(() => {
    if (view === 'browse') handleBrowse();
  }, [view, handleBrowse]);

  const selected = selectedId
    ? installed.find((s) => s.id === selectedId) || browseResults.find((e) => e.id === selectedId)
    : null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur flex items-center justify-center p-6">
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-amber-400" />
            <h2 className="text-lg font-semibold text-zinc-100">Generator Market</h2>
            <span className="text-xs text-zinc-500">({installed.length} installed)</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-700">
          {(['installed', 'browse'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'px-4 py-2 text-sm font-medium',
                view === v
                  ? 'text-amber-400 border-b-2 border-amber-400'
                  : 'text-zinc-400 hover:text-zinc-100'
              )}
            >
              {v === 'installed' ? `Installed (${installed.length})` : 'Browse'}
            </button>
          ))}
        </div>

        {error && (
          <div className="px-4 py-2 bg-red-900/30 border-b border-red-800 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {view === 'installed' && (
            <InstalledList
              scripts={installed}
              onUninstall={handleUninstall}
              onToggle={handleToggle}
              onSelect={(id) => { setSelectedId(id); setView('detail'); }}
            />
          )}
          {view === 'browse' && (
            <BrowseView
              market={market}
              query={query}
              setQuery={setQuery}
              results={browseResults}
              busy={busy}
              installedIds={new Set(installed.map((s) => s.id))}
              onInstall={handleInstall}
              onSearch={handleBrowse}
              onSelect={(id) => { setSelectedId(id); setView('detail'); }}
            />
          )}
          {view === 'detail' && selected && (
            <DetailView
              entry={selected}
              installed={installed.find((s) => s.id === (selected as { id: string }).id) !== undefined}
              onBack={() => setView(installed.find((s) => s.id === (selected as { id: string }).id) ? 'installed' : 'browse')}
              onInstall={() => handleInstall((selected as { id: string }).id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Installed List ─────────────────────────────────────────────

function InstalledList({
  scripts,
  onUninstall,
  onToggle,
  onSelect,
}: {
  scripts: GeneratorScript[];
  onUninstall: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onSelect: (id: string) => void;
}) {
  if (scripts.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <Package className="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>No generators installed</p>
        <p className="text-xs mt-1">Browse the market to install community generators</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {scripts.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 p-3 rounded border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50 cursor-pointer"
          onClick={() => onSelect(s.id)}
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-medium text-zinc-100">{s.name}</span>
              <span className="text-xs text-zinc-500">v{s.version}</span>
              {s.tags.includes('builtin') && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400">BUILTIN</span>
              )}
              {s.enabled === false && (
                <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500">DISABLED</span>
              )}
            </div>
            <div className="text-xs text-zinc-500 truncate">{s.id} · {(s.size ?? s.code.length)} bytes</div>
            {s.description && <p className="text-sm text-zinc-400 mt-1 line-clamp-1">{s.description}</p>}
          </div>
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => onToggle(s.id, s.enabled !== false)}
              className="p-1.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-amber-400"
              title={s.enabled === false ? 'Enable' : 'Disable'}
            >
              <Power className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onUninstall(s.id)}
              className="p-1.5 rounded hover:bg-red-900/30 text-zinc-400 hover:text-red-400"
              title="Uninstall"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Browse View ────────────────────────────────────────────────

function BrowseView({
  market,
  query,
  setQuery,
  results,
  busy,
  installedIds,
  onInstall,
  onSearch,
  onSelect,
}: {
  market: GeneratorMarket;
  query: string;
  setQuery: (q: string) => void;
  results: RemoteMarketEntry[];
  busy: boolean;
  installedIds: Set<string>;
  onInstall: (id: string) => void;
  onSearch: () => void;
  onSelect: (id: string) => void;
}) {
  if (!market.remote) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p>Remote market not configured</p>
        <p className="text-xs mt-1">Pass <code className="text-amber-400">remoteUrl</code> to <code className="text-amber-400">GeneratorMarket</code></p>
      </div>
    );
  }
  return (
    <div>
      <div className="flex gap-2 mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') onSearch(); }}
            placeholder="Search generators..."
            className="w-full pl-9 pr-3 py-2 rounded bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm focus:border-amber-500 focus:outline-none"
          />
        </div>
        <button
          type="button"
          onClick={onSearch}
          disabled={busy}
          className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm disabled:opacity-50"
        >
          {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Search'}
        </button>
      </div>

      {results.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p>{busy ? 'Loading...' : 'No results'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((e) => {
            const isInstalled = installedIds.has(e.id);
            return (
              <div
                key={e.id}
                className="flex items-center gap-3 p-3 rounded border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50"
              >
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onSelect(e.id)}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-zinc-100">{e.name}</span>
                    <span className="text-xs text-zinc-500">v{e.version}</span>
                    <span className="text-xs text-zinc-500">· {e.author}</span>
                  </div>
                  <p className="text-sm text-zinc-400 mt-1 line-clamp-1">{e.description}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
                    <span>↓ {e.downloads}</span>
                    <span>★ {e.rating.toFixed(1)}</span>
                    <span>{(e.size / 1024).toFixed(1)} KB</span>
                    {e.tags.slice(0, 3).map((t) => (
                      <span key={t} className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{t}</span>
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onInstall(e.id)}
                  disabled={isInstalled || busy}
                  className={cn(
                    'px-3 py-1.5 rounded text-sm font-medium',
                    isInstalled
                      ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                      : 'bg-amber-600 hover:bg-amber-500 text-white'
                  )}
                >
                  {isInstalled ? 'Installed' : <><Download className="w-3.5 h-3.5 inline mr-1" />Install</>}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Detail View ────────────────────────────────────────────────

function DetailView({
  entry,
  installed,
  onBack,
  onInstall,
}: {
  entry: GeneratorScript | RemoteMarketEntry;
  installed: boolean;
  onBack: () => void;
  onInstall: () => void;
}) {
  const isScript = 'code' in entry;
  return (
    <div>
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-amber-400 hover:text-amber-300 mb-4"
      >
        ← Back
      </button>
      <h3 className="text-2xl font-semibold text-zinc-100 mb-1">{entry.name}</h3>
      <div className="text-sm text-zinc-500 mb-4">
        {entry.id} · v{entry.version} · {entry.author}
      </div>
      {entry.description && <p className="text-zinc-300 mb-4">{entry.description}</p>}

      {isScript && (
        <>
          {Object.keys(entry.schema).length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-zinc-300 mb-2">Parameters</h4>
              <div className="space-y-1 text-sm">
                {Object.entries(entry.schema).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 px-2 py-1 rounded bg-zinc-800/50">
                    <code className="text-amber-400">{k}</code>
                    <span className="text-zinc-500">({v.type})</span>
                    <span className="text-zinc-400">default: {String(v.default)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <h4 className="text-sm font-semibold text-zinc-300 mb-2 flex items-center gap-1">
              <Code className="w-3.5 h-3.5" /> Source
            </h4>
            <pre className="text-xs text-zinc-300 bg-zinc-950 p-3 rounded overflow-x-auto max-h-64">
              {entry.code}
            </pre>
          </div>
        </>
      )}

      {!installed && !isScript && (
        <button
          type="button"
          onClick={onInstall}
          className="mt-4 px-4 py-2 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium"
        >
          <Download className="w-4 h-4 inline mr-2" />Install
        </button>
      )}
    </div>
  );
}
