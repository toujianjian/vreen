// VreenInspectorPanel — 验证 / 详情 / Diff 面板。
//
// 用于在 viewer 中查看当前打开的 .vreen 包：
//   - 验证报告(sha256 / size / schema)
//   - 资产清单
//   - 增量包生成 / 应用(从文件选择 base + head)
//
// 数据来源：viewer store 的 assetSource(File) 暂未直接复用。简化版：
// 用户可拖拽 / 选择 .vreen 文件进行验证；Diff / Delta 用文件选择器。

import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, FileBox, GitCompareArrows, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { HudPanel } from '@/components/hud/HudPanel';
import { tryUnpackAnyVreen, type UnpackedVreen } from '@/lib/vreenPack';
import {
  getValidationReport,
  formatReport,
  type ValidationReport,
} from '@/lib/vreenValidate';
import {
  diffVreenPackages,
  createVreenDelta,
  applyVreenDelta,
  formatDiff,
  type PackageDiff,
} from '@/lib/vreenDiff';

type Tab = 'validate' | 'diff' | 'delta';

export function VreenInspectorPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('validate');
  return (
    <HudPanel
      title={t('vreen.inspector.title', 'Vreen Inspector')}
      className="vreen-inspector"
    >
      <div className="tabs">
        <TabButton active={tab === 'validate'} onClick={() => setTab('validate')} icon={<ShieldCheck size={14} />}>
          {t('vreen.inspector.tab.validate', 'Validate')}
        </TabButton>
        <TabButton active={tab === 'diff'} onClick={() => setTab('diff')} icon={<GitCompareArrows size={14} />}>
          {t('vreen.inspector.tab.diff', 'Diff')}
        </TabButton>
        <TabButton active={tab === 'delta'} onClick={() => setTab('delta')} icon={<RefreshCw size={14} />}>
          {t('vreen.inspector.tab.delta', 'Delta')}
        </TabButton>
      </div>
      <div className="tab-body">
        {tab === 'validate' && <ValidateTab />}
        {tab === 'diff' && <DiffTab />}
        {tab === 'delta' && <DeltaTab />}
      </div>
    </HudPanel>
  );
}

function TabButton({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`tab-btn ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      {icon} <span>{children}</span>
    </button>
  );
}

// ── Validate ───────────────────────────────────────────────────────

function ValidateTab() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [unpacked, setUnpacked] = useState<UnpackedVreen | null>(null);
  const [verbose, setVerbose] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const onFile = useCallback(async (f: File) => {
    setFile(f);
    setBusy(true);
    setErr(null);
    setReport(null);
    setUnpacked(null);
    try {
      const u8 = new Uint8Array(await f.arrayBuffer());
      const u = await tryUnpackAnyVreen(u8);
      setUnpacked(u);
      const r = await getValidationReport(u);
      setReport(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="validate-tab">
      <input
        ref={inputRef}
        type="file"
        accept=".vreen,.json"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
      <button type="button" className="picker-btn" onClick={() => inputRef.current?.click()} disabled={busy}>
        <FileBox size={14} /> {file ? file.name : t('vreen.inspector.pickFile', 'Pick a .vreen file')}
      </button>
      <label className="verbose-toggle">
        <input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} />
        {t('vreen.inspector.verbose', 'Verbose')}
      </label>
      {busy && <div className="busy">…</div>}
      {err && <div className="err"><AlertCircle size={14} /> {err}</div>}
      {report && (
        <pre className={`report ${report.ok ? 'ok' : 'fail'}`}>
{formatReport(report, verbose)}
        </pre>
      )}
      {unpacked && (
        <details className="asset-list">
          <summary>{t('vreen.inspector.assets', 'Assets ({{n}})', { n: unpacked.manifest.assets.length })}</summary>
          <ul>
            {unpacked.manifest.assets.map((a) => (
              <li key={a.id}>
                <code>{a.id.slice(0, 8)}</code> {a.kind} <span className="path">{a.path}</span> <span className="size">{(a.size / 1024).toFixed(1)} KB</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

// ── Diff ───────────────────────────────────────────────────────────

function DiffTab() {
  const { t } = useTranslation();
  const [base, setBase] = useState<File | null>(null);
  const [head, setHead] = useState<File | null>(null);
  const [diff, setDiff] = useState<PackageDiff | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const baseRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async () => {
    if (!base || !head) return;
    setBusy(true);
    setErr(null);
    setDiff(null);
    try {
      const baseU8 = new Uint8Array(await base.arrayBuffer());
      const headU8 = new Uint8Array(await head.arrayBuffer());
      const basePkg = await tryUnpackAnyVreen(baseU8);
      const headPkg = await tryUnpackAnyVreen(headU8);
      const d = await diffVreenPackages(basePkg, headPkg);
      setDiff(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [base, head]);

  return (
    <div className="diff-tab">
      <div className="row">
        <button type="button" className="picker-btn" onClick={() => baseRef.current?.click()}>
          <FileBox size={14} /> {base ? base.name : 'Base .vreen'}
        </button>
        <input ref={baseRef} type="file" accept=".vreen,.json" hidden onChange={(e) => setBase(e.target.files?.[0] ?? null)} />
        <button type="button" className="picker-btn" onClick={() => headRef.current?.click()}>
          <FileBox size={14} /> {head ? head.name : 'Head .vreen'}
        </button>
        <input ref={headRef} type="file" accept=".vreen,.json" hidden onChange={(e) => setHead(e.target.files?.[0] ?? null)} />
      </div>
      <button type="button" className="run-btn" onClick={run} disabled={!base || !head || busy}>
        {busy ? '…' : t('vreen.inspector.diffRun', 'Diff')}
      </button>
      {err && <div className="err"><AlertCircle size={14} /> {err}</div>}
      {diff && (
        <>
          <pre className="report">{formatDiff(diff)}</pre>
          <details>
            <summary>{t('vreen.inspector.assetDiffs', 'Asset diffs ({{n}})', { n: diff.assets.length })}</summary>
            <table>
              <thead>
                <tr><th>id</th><th>kind</th><th>status</th><th>base</th><th>head</th></tr>
              </thead>
              <tbody>
                {diff.assets.map((a) => (
                  <tr key={a.id} className={a.status}>
                    <td><code>{a.id.slice(0, 8)}</code></td>
                    <td>{a.kind}</td>
                    <td>{a.status}</td>
                    <td>{a.baseSha256 ? a.baseSha256.slice(0, 8) : '—'} {a.baseSize ? `(${(a.baseSize / 1024).toFixed(1)} KB)` : ''}</td>
                    <td>{a.headSha256 ? a.headSha256.slice(0, 8) : '—'} {a.headSize ? `(${(a.headSize / 1024).toFixed(1)} KB)` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </div>
  );
}

// ── Delta ──────────────────────────────────────────────────────────

function DeltaTab() {
  const { t } = useTranslation();
  const [base, setBase] = useState<File | null>(null);
  const [head, setHead] = useState<File | null>(null);
  const [delta, setDelta] = useState<File | null>(null);
  const [applyBase, setApplyBase] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const baseRef = useRef<HTMLInputElement>(null);
  const headRef = useRef<HTMLInputElement>(null);
  const deltaRef = useRef<HTMLInputElement>(null);
  const applyBaseRef = useRef<HTMLInputElement>(null);

  const makeDelta = useCallback(async () => {
    if (!base || !head) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const basePkg = await tryUnpackAnyVreen(new Uint8Array(await base.arrayBuffer()));
      const headPkg = await tryUnpackAnyVreen(new Uint8Array(await head.arrayBuffer()));
      const d = await diffVreenPackages(basePkg, headPkg);
      const deltaR = await createVreenDelta({ base: basePkg, head: headPkg, diff: d });
      // download
      const blob = new Blob([deltaR.bytes as unknown as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(head.name || 'delta').replace(/\.vreen$/, '')}-delta.vreen`;
      a.click();
      URL.revokeObjectURL(url);
      setResult(`delta saved (${(deltaR.bytes.byteLength / 1024).toFixed(1)} KB, savings ${(deltaR.savingsRatio * 100).toFixed(1)}%)`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [base, head]);

  const applyDelta = useCallback(async () => {
    if (!applyBase || !delta) return;
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      const basePkg = await tryUnpackAnyVreen(new Uint8Array(await applyBase.arrayBuffer()));
      const deltaBytes = new Uint8Array(await delta.arrayBuffer());
      const applied = await applyVreenDelta(basePkg, deltaBytes);
      // 序列化为 zip (re-pack)
      const { packVreenPackage } = await import('@/lib/vreenPack');
      const assets = [];
      for (const a of applied.head.manifest.assets) {
        const data = applied.head.assets.get(a.id);
        if (!data) continue;
        assets.push({ id: a.id, kind: a.kind, data, originalName: a.originalName, sha256: a.sha256 });
      }
      const packed = packVreenPackage({
        name: applied.head.manifest.name,
        assetName: applied.head.manifest.assetName,
        scene: applied.head.scene,
        assets,
        primaryModelId: applied.head.manifest.primaryModelId,
        world: applied.head.world ?? undefined,
        generator: 'VREEN Delta Apply',
      });
      const blob = new Blob([packed.bytes as unknown as BlobPart], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(applyBase.name || 'applied').replace(/\.vreen$/, '')}-applied.vreen`;
      a.click();
      URL.revokeObjectURL(url);
      setResult(`applied: +${applied.appliedAdds} ~${applied.appliedModifies} -${applied.appliedRemoves}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [applyBase, delta]);

  return (
    <div className="delta-tab">
      <fieldset>
        <legend>Build delta</legend>
        <div className="row">
          <button type="button" className="picker-btn" onClick={() => baseRef.current?.click()}>
            <FileBox size={14} /> {base ? base.name : 'Base .vreen'}
          </button>
          <input ref={baseRef} type="file" accept=".vreen,.json" hidden onChange={(e) => setBase(e.target.files?.[0] ?? null)} />
          <button type="button" className="picker-btn" onClick={() => headRef.current?.click()}>
            <FileBox size={14} /> {head ? head.name : 'Head .vreen'}
          </button>
          <input ref={headRef} type="file" accept=".vreen,.json" hidden onChange={(e) => setHead(e.target.files?.[0] ?? null)} />
        </div>
        <button type="button" className="run-btn" onClick={makeDelta} disabled={!base || !head || busy}>
          {busy ? '…' : t('vreen.inspector.deltaMake', 'Build & download .vreen-delta')}
        </button>
      </fieldset>
      <fieldset>
        <legend>Apply delta</legend>
        <div className="row">
          <button type="button" className="picker-btn" onClick={() => applyBaseRef.current?.click()}>
            <FileBox size={14} /> {applyBase ? applyBase.name : 'Base .vreen'}
          </button>
          <input ref={applyBaseRef} type="file" accept=".vreen,.json" hidden onChange={(e) => setApplyBase(e.target.files?.[0] ?? null)} />
          <button type="button" className="picker-btn" onClick={() => deltaRef.current?.click()}>
            <FileBox size={14} /> {delta ? delta.name : '.vreen-delta'}
          </button>
          <input ref={deltaRef} type="file" accept=".vreen,.vreen-delta,.json" hidden onChange={(e) => setDelta(e.target.files?.[0] ?? null)} />
        </div>
        <button type="button" className="run-btn" onClick={applyDelta} disabled={!applyBase || !delta || busy}>
          {busy ? '…' : t('vreen.inspector.deltaApply', 'Apply & download')}
        </button>
      </fieldset>
      {err && <div className="err"><AlertCircle size={14} /> {err}</div>}
      {result && <div className="ok"><CheckCircle2 size={14} /> {result}</div>}
    </div>
  );
}
