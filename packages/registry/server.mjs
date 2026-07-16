#!/usr/bin/env node
// vreen-registry — minimal HTTP server for serving .vreen packages.
//
// 端点:
//   GET  /                              HTML 索引(列出所有 packages)
//   GET  /health                        200 OK
//   GET  /registry/index.json           RegistryIndex JSON
//   GET  /packages/<id>/<version>/<file>  下载 .vreen / .vreen-delta
//   GET  /packages/<id>/<version>/       目录列表(调试用)
//   POST /publish?token=...              上传 .vreen(Authorization via token)
//
// 零外部依赖 — 仅用 Node 内置 http / fs / path / url。
//
// 用法:
//   node scripts/vreen-registry.mjs [--port 8080] [--store ./store]
//   VREEN_REGISTRY_PORT=8080 VREEN_REGISTRY_STORE=./store npm run vreen:registry
//
// 存储布局:
//   <store>/
//     index.json                 # RegistryIndex
//     packages/
//       <id>/
//         <version>/
//           <file>.vreen         # 实际包
//           <file>.vreen-delta  # 增量包(可选)

import http from 'node:http';
import { readFile, writeFile, stat, mkdir, readdir, copyFile, unlink } from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Lazy config — re-read on every request so test harnesses can change env
// vars between runs without re-importing the module.
function getStore() {
    return path.resolve(
        process.env.VREEN_REGISTRY_STORE ?? path.join(__dirname, 'store'),
    );
}
function getBaseUrl() {
    return process.env.VREEN_REGISTRY_BASE_URL ?? '';
}
function getPublishToken() {
    return process.env.VREEN_REGISTRY_TOKEN ?? '';
}

// ── Path safety ────────────────────────────────────────────────────
function safeJoin(root, ...parts) {
    const joined = path.join(root, ...parts);
    const normalized = path.resolve(joined);
    const rootN = path.resolve(root);
    if (!normalized.startsWith(rootN + path.sep) && normalized !== rootN) {
        throw new Error('path traversal');
    }
    return normalized;
}

async function readIndex() {
    const STORE = getStore();
    const BASE_URL = getBaseUrl();
    const idxPath = path.join(STORE, 'index.json');
    if (!existsSync(idxPath)) {
        // bootstrap with empty registry
        const empty = {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            baseUrl: BASE_URL || undefined,
            packages: [],
        };
        await writeFile(idxPath, JSON.stringify(empty, null, 2));
        return empty;
    }
    return JSON.parse(await readFile(idxPath, 'utf-8'));
}

async function writeIndex(idx) {
    idx.generatedAt = new Date().toISOString();
    const STORE = getStore();
    const idxPath = path.join(STORE, 'index.json');
    await writeFile(idxPath, JSON.stringify(idx, null, 2));
}

function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

function htmlEscape(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

async function buildHtmlIndex(idx) {
    const lines = [
        '<!doctype html>',
        '<html><head><meta charset="utf-8"><title>VREEN Registry</title>',
        '<style>body{font-family:ui-monospace,monospace;max-width:900px;margin:2rem auto;background:#05070d;color:#dde;padding:1rem}',
        'a{color:#5cf} h1{color:#5cf} .pkg{margin:0.5rem 0;padding:0.5rem;border:1px solid #234}',
        '.meta{color:#789;font-size:0.85em}</style></head><body>',
        `<h1>VREEN Registry v${htmlEscape(idx.version)}</h1>`,
        `<p>${idx.packages.length} package(s) · generated ${htmlEscape(idx.generatedAt)}</p>`,
        '<p>Endpoints: <a href="/registry/index.json">/registry/index.json</a> · <a href="/health">/health</a></p>',
    ];
    for (const p of idx.packages) {
        lines.push(`<div class="pkg"><strong>${htmlEscape(p.id)}</strong> v${htmlEscape(p.latest)} — ${htmlEscape(p.name)}`);
        if (p.description) lines.push(`<div class="meta">${htmlEscape(p.description)}</div>`);
        for (const v of p.versions) {
            const yank = v.yanked ? ' (yanked)' : '';
            lines.push(`<div class="meta">· ${htmlEscape(v.version)}${yank} — ${(v.size / 1024).toFixed(1)} KB — <a href="${htmlEscape(v.downloadUrl)}">download</a>${v.deltaUrl ? ` · <a href="${htmlEscape(v.deltaUrl)}">delta</a>` : ''}</div>`);
        }
        lines.push('</div>');
    }
    lines.push('</body></html>');
    return lines.join('\n');
}

// ── HTTP handler ───────────────────────────────────────────────────
async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, corsHeaders());
        return res.end();
    }
    res.setHeader('access-control-allow-origin', '*');

    try {
        // /health
        if (url.pathname === '/health' && req.method === 'GET') {
            res.writeHead(200, { 'content-type': 'text/plain' });
            return res.end('ok');
        }

        // /registry/index.json
        if (url.pathname === '/registry/index.json' && req.method === 'GET') {
            const idx = await readIndex();
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify(idx, null, 2));
        }

        // /  → HTML index
        if (url.pathname === '/' && req.method === 'GET') {
            const idx = await readIndex();
            const html = await buildHtmlIndex(idx);
            res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
            return res.end(html);
        }

        // /publish  POST
        if (url.pathname === '/publish' && req.method === 'POST') {
            return await handlePublish(req, res, url);
        }

        // /packages/<id>/<version>/<filename>
        const pkgMatch = url.pathname.match(/^\/packages\/([^/]+)\/([^/]+)\/([^/]+)$/);
        if (pkgMatch && req.method === 'GET') {
            const [, id, version, filename] = pkgMatch;
            return await servePackageFile(res, id, version, filename);
        }

        // /packages/<id>/<version>/  → directory listing
        const dirMatch = url.pathname.match(/^\/packages\/([^/]+)\/([^/]+)\/?$/);
        if (dirMatch && req.method === 'GET') {
            const [, id, version] = dirMatch;
            return await servePackageDir(res, id, version);
        }

        // 404
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'not found', path: url.pathname }));
    } catch (e) {
        const code = e.message === 'path traversal' ? 400 : 500;
        res.writeHead(code, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: e.message || String(e) }));
    }
}

function corsHeaders() {
    return {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type, authorization',
    };
}

async function servePackageFile(res, id, version, filename) {
    // safeJoin guards path traversal
    const full = safeJoin(getStore(), 'packages', id, version, filename);
    if (!existsSync(full)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'file not found' }));
    }
    const st = await stat(full);
    res.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': st.size,
        'etag': `"${st.size.toString(16)}-${st.mtimeMs.toString(16)}"`,
        'cache-control': 'public, max-age=300',
    });
    createReadStream(full).pipe(res);
}

async function servePackageDir(res, id, version) {
    const full = safeJoin(getStore(), 'packages', id, version);
    if (!existsSync(full)) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'directory not found' }));
    }
    const files = await readdir(full);
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ id, version, files }, null, 2));
}

// ── Publish ────────────────────────────────────────────────────────
async function readBody(req, max = 256 * 1024 * 1024) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        total += chunk.length;
        if (total > max) throw new Error('payload too large');
        chunks.push(chunk);
    }
    return Buffer.concat(chunks);
}

async function handlePublish(req, res, url) {
    // Token check
    const token = url.searchParams.get('token')
        ?? req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const PUBLISH_TOKEN = getPublishToken();
    if (!PUBLISH_TOKEN) {
        res.writeHead(503, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'publish disabled (VREEN_REGISTRY_TOKEN not set)' }));
    }
    if (token !== PUBLISH_TOKEN) {
        res.writeHead(401, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'invalid token' }));
    }

    // Headers from query string:
    //   ?id=robot.glb&version=1.2.0&kind=vreen  (kind ∈ vreen | delta)
    const id = url.searchParams.get('id');
    const version = url.searchParams.get('version');
    const kind = url.searchParams.get('kind') ?? 'vreen';
    if (!id || !version) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: 'missing id or version query param' }));
    }
    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: `bad id: ${id}` }));
    }
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/.test(version)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: `bad version: ${version}` }));
    }
    if (kind !== 'vreen' && kind !== 'delta') {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ error: `bad kind: ${kind}` }));
    }

    const body = await readBody(req);
    const sha = sha256Hex(body);
    const filename = kind === 'vreen' ? `${id}.vreen` : `${id}.vreen-delta`;
    const dir = safeJoin(getStore(), 'packages', id, version);
    await mkdir(dir, { recursive: true });
    const dst = path.join(dir, filename);
    await writeFile(dst, body);

    // Update index.json
    const idx = await readIndex();
    const BASE_URL = getBaseUrl();
    let pkg = idx.packages.find((p) => p.id === id);
    if (!pkg) {
        pkg = {
            id,
            name: id,
            latest: version,
            versions: [],
        };
        idx.packages.push(pkg);
    }
    // Update or insert the version entry
    let ver = pkg.versions.find((v) => v.version === version);
    if (!ver) {
        ver = {
            version,
            releasedAt: new Date().toISOString(),
            downloadUrl: `${BASE_URL}/packages/${id}/${version}/${filename}`,
            size: body.length,
            sha256: sha,
            formatVersion: '0.2.1',
        };
        pkg.versions.push(ver);
        // update latest pointer
        if (compareSemver(version, pkg.latest) > 0) pkg.latest = version;
    } else {
        ver.size = body.length;
        ver.sha256 = sha;
    }
    if (kind === 'delta') {
        ver.deltaUrl = `${BASE_URL}/packages/${id}/${version}/${filename}`;
    }
    await writeIndex(idx);

    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({
        ok: true, id, version, kind, size: body.length, sha256: sha, path: dst,
    }));
}

function compareSemver(a, b) {
    const pa = a.split(/[.-]/);
    const pb = b.split(/[.-]/);
    for (let i = 0; i < 3; i++) {
        const da = parseInt(pa[i] ?? '0', 10) || 0;
        const db = parseInt(pb[i] ?? '0', 10) || 0;
        if (da !== db) return da - db;
    }
    return 0;
}

// ── Entry point ────────────────────────────────────────────────────
function parseArgs(argv) {
    const out = { positional: [], flags: {} };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--port') out.flags.port = Number(argv[++i]);
        else if (a === '--store') out.flags.store = argv[++i];
        else if (a === '--help' || a === '-h') out.flags.help = true;
        else out.positional.push(a);
    }
    return out;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.flags.help) {
        process.stdout.write(`vreen-registry — serve .vreen packages

Usage:
  vreen-registry [--port <n>] [--store <dir>]

Environment:
  VREEN_REGISTRY_PORT      default 8080
  VREEN_REGISTRY_STORE     default packages/registry/store
  VREEN_REGISTRY_TOKEN     if set, enables POST /publish
  VREEN_REGISTRY_BASE_URL  base URL written into index.json downloadUrl fields
`);
        return;
    }
    if (args.flags.port) process.env.VREEN_REGISTRY_PORT = String(args.flags.port);
    if (args.flags.store) process.env.VREEN_REGISTRY_STORE = path.resolve(args.flags.store);

    const PORT = Number(process.env.VREEN_REGISTRY_PORT ?? 8080);
    const STORE = getStore();
    const PUBLISH_TOKEN = getPublishToken();

    await mkdir(path.join(STORE, 'packages'), { recursive: true });
    await readIndex(); // bootstrap if missing

    const server = http.createServer((req, res) => handler(req, res).catch((e) => {
        console.error('[vreen-registry] handler error', e);
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: String(e.message || e) }));
    }));
    server.listen(PORT, () => {
        process.stdout.write(`vreen-registry listening on http://localhost:${PORT}\n  store: ${STORE}\n  publish: ${PUBLISH_TOKEN ? 'enabled' : 'disabled'}\n`);
    });
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
    main().catch((e) => {
        process.stderr.write(`fatal: ${e.message || e}\n`);
        process.exit(1);
    });
}

export {
    handler,
    servePackageFile,
    servePackageDir,
    readIndex,
    writeIndex,
    handlePublish,
    safeJoin,
    sha256Hex,
    compareSemver,
};
