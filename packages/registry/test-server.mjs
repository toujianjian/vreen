// vreen-registry server tests — uses node:test (Node 18+).
//
// Run:
//   node --test packages/registry/test-server.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { handler } from './server.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── helpers ────────────────────────────────────────────────────────

function listen(handler) {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => handler(req, res));
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            resolve({ server, url: `http://127.0.0.1:${port}` });
        });
    });
}

function request(url, options = {}) {
    return new Promise((resolve, reject) => {
        const u = new URL(url);
        const req = http.request({
            hostname: u.hostname,
            port: u.port,
            path: u.pathname + u.search,
            method: options.method ?? 'GET',
            headers: options.headers ?? {},
        }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers,
                    body: Buffer.concat(chunks),
                });
            });
        });
        req.on('error', reject);
        if (options.body) req.write(options.body);
        req.end();
    });
}

async function withStore(fn) {
    const store = await mkdtemp(path.join(tmpdir(), 'vreen-registry-test-'));
    process.env.VREEN_REGISTRY_STORE = store;
    process.env.VREEN_REGISTRY_PORT = '0';
    process.env.VREEN_REGISTRY_TOKEN = 'test-token';
    process.env.VREEN_REGISTRY_BASE_URL = 'http://test.example';
    try {
        await mkdir(path.join(store, 'packages'), { recursive: true });
        await fn(store);
    } finally {
        await rm(store, { recursive: true, force: true });
        delete process.env.VREEN_REGISTRY_STORE;
        delete process.env.VREEN_REGISTRY_TOKEN;
        delete process.env.VREEN_REGISTRY_BASE_URL;
    }
}

// ── tests ──────────────────────────────────────────────────────────

test('GET /health returns 200 ok', async () => {
    await withStore(async (store) => {
        const { server, url } = await listen(handler);
        try {
            const res = await request(`${url}/health`);
            assert.equal(res.status, 200);
            assert.equal(res.body.toString(), 'ok');
        } finally {
            server.close();
        }
    });
});

test('GET /registry/index.json returns bootstrap index', async () => {
    await withStore(async () => {
        const { server, url } = await listen(handler);
        try {
            const res = await request(`${url}/registry/index.json`);
            assert.equal(res.status, 200);
            const json = JSON.parse(res.body.toString());
            assert.equal(json.version, '1.0.0');
            assert.deepEqual(json.packages, []);
        } finally {
            server.close();
        }
    });
});

test('GET / serves HTML index with all packages', async () => {
    await withStore(async (store) => {
        // seed a package
        const pkgDir = path.join(store, 'packages', 'robot.glb', '1.0.0');
        await mkdir(pkgDir, { recursive: true });
        const data = Buffer.from('fake vreen content');
        await writeFile(path.join(pkgDir, 'robot.glb.vreen'), data);

        const idxPath = path.join(store, 'index.json');
        const idx = {
            version: '1.0.0',
            generatedAt: '2026-01-01T00:00:00.000Z',
            baseUrl: 'http://test.example',
            packages: [{
                id: 'robot.glb',
                name: 'Robot Character',
                latest: '1.0.0',
                versions: [{
                    version: '1.0.0',
                    downloadUrl: '/packages/robot.glb/1.0.0/robot.glb.vreen',
                    size: data.length,
                    sha256: crypto.createHash('sha256').update(data).digest('hex'),
                    formatVersion: '0.2.1',
                }],
            }],
        };
        await writeFile(idxPath, JSON.stringify(idx, null, 2));

        const { server, url } = await listen(handler);
        try {
            const res = await request(`${url}/`);
            assert.equal(res.status, 200);
            const html = res.body.toString();
            assert.match(html, /<title>VREEN Registry<\/title>/);
            assert.match(html, /robot\.glb/);
            assert.match(html, /v1\.0\.0/);
        } finally {
            server.close();
        }
    });
});

test('GET /packages/<id>/<version>/<file> serves stored bytes', async () => {
    await withStore(async (store) => {
        const pkgDir = path.join(store, 'packages', 'robot.glb', '1.0.0');
        await mkdir(pkgDir, { recursive: true });
        const data = Buffer.from('hello vreen');
        await writeFile(path.join(pkgDir, 'robot.glb.vreen'), data);

        const { server, url } = await listen(handler);
        try {
            const res = await request(`${url}/packages/robot.glb/1.0.0/robot.glb.vreen`);
            assert.equal(res.status, 200);
            assert.equal(res.headers['content-type'], 'application/octet-stream');
            assert.equal(res.headers['content-length'], String(data.length));
            assert.equal(res.body.toString(), 'hello vreen');
        } finally {
            server.close();
        }
    });
});

test('GET /packages/<id>/<version>/  returns directory listing', async () => {
    await withStore(async (store) => {
        const pkgDir = path.join(store, 'packages', 'studio', '2.0.0');
        await mkdir(pkgDir, { recursive: true });
        await writeFile(path.join(pkgDir, 'studio.hdr'), Buffer.alloc(0));

        const { server, url } = await listen(handler);
        try {
            const res = await request(`${url}/packages/studio/2.0.0/`);
            assert.equal(res.status, 200);
            const json = JSON.parse(res.body.toString());
            assert.equal(json.id, 'studio');
            assert.equal(json.version, '2.0.0');
            assert.deepEqual(json.files, ['studio.hdr']);
        } finally {
            server.close();
        }
    });
});

test('rejects path traversal in /packages/...', async () => {
    await withStore(async () => {
        const { server } = await listen(handler);
        try {
            const { servePackageFile, safeJoin } = await import('./server.mjs');
            // 1) safeJoin guard: filename with enough ".." segments to escape
            //    the root must throw. The path depth above the user segment is
            //    <store>/packages/<id>/<ver> = 4 levels, so 5 leading ".."
            //    entries break out.
            const evil = String.raw`..\..\..\..\..\etc\passwd`;
            assert.throws(
                () => safeJoin(process.env.VREEN_REGISTRY_STORE, 'packages', 'id', 'ver', evil),
                /path traversal/,
            );
            // 2) servePackageFile propagates the guard error.
            const fakeRes = {
                writeHead() { return this; },
                end() {},
            };
            await assert.rejects(
                () => servePackageFile(fakeRes, 'robot.glb', '1.0.0', evil),
                /path traversal/,
            );
        } finally {
            server.close();
        }
    });
});

test('returns 404 for unknown route', async () => {
    await withStore(async () => {
        const { server, url } = await listen(handler);
        try {
            const res = await request(`${url}/no-such-thing`);
            assert.equal(res.status, 404);
        } finally {
            server.close();
        }
    });
});

test('POST /publish with valid token stores the file and updates index', async () => {
    await withStore(async (store) => {
        const data = Buffer.from('my vreen package');
        const { server, url } = await listen(handler);
        try {
            const res = await request(
                `${url}/publish?token=test-token&id=robot.glb&version=1.0.0`,
                { method: 'POST', body: data },
            );
            assert.equal(res.status, 200);
            const json = JSON.parse(res.body.toString());
            assert.equal(json.ok, true);
            assert.equal(json.size, data.length);

            // file written
            const f = path.join(store, 'packages', 'robot.glb', '1.0.0', 'robot.glb.vreen');
            const onDisk = await readFile(f);
            assert.equal(onDisk.toString(), 'my vreen package');

            // index updated
            const idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
            assert.equal(idx.packages.length, 1);
            assert.equal(idx.packages[0].id, 'robot.glb');
            assert.equal(idx.packages[0].latest, '1.0.0');
            assert.equal(idx.packages[0].versions.length, 1);
            assert.equal(idx.packages[0].versions[0].sha256, crypto.createHash('sha256').update(data).digest('hex'));
        } finally {
            server.close();
        }
    });
});

test('POST /publish without token returns 503 when token disabled', async () => {
    const store = await mkdtemp(path.join(tmpdir(), 'vreen-registry-test-'));
    delete process.env.VREEN_REGISTRY_TOKEN;
    process.env.VREEN_REGISTRY_STORE = store;
    try {
        const { server, url } = await listen(handler);
        try {
            const res = await request(
                `${url}/publish?id=robot.glb&version=1.0.0`,
                { method: 'POST', body: Buffer.from('x') },
            );
            assert.equal(res.status, 503);
            const json = JSON.parse(res.body.toString());
            assert.match(json.error, /publish disabled/);
        } finally {
            server.close();
        }
    } finally {
        await rm(store, { recursive: true, force: true });
        delete process.env.VREEN_REGISTRY_STORE;
    }
});

test('POST /publish with wrong token returns 401', async () => {
    await withStore(async () => {
        const { server, url } = await listen(handler);
        try {
            const res = await request(
                `${url}/publish?token=wrong&id=robot.glb&version=1.0.0`,
                { method: 'POST', body: Buffer.from('x') },
            );
            assert.equal(res.status, 401);
        } finally {
            server.close();
        }
    });
});

test('POST /publish validates id and version shape', async () => {
    await withStore(async () => {
        const { server, url } = await listen(handler);
        try {
            // bad id
            let res = await request(
                `${url}/publish?token=test-token&id=BAD_ID&version=1.0.0`,
                { method: 'POST', body: Buffer.from('x') },
            );
            assert.equal(res.status, 400);
            // bad version
            res = await request(
                `${url}/publish?token=test-token&id=ok&version=not-semver`,
                { method: 'POST', body: Buffer.from('x') },
            );
            assert.equal(res.status, 400);
        } finally {
            server.close();
        }
    });
});

test('POST /publish for delta updates deltaUrl and preserves primary', async () => {
    await withStore(async (store) => {
        // First: publish primary vreen
        const primary = Buffer.from('primary vreen');
        const { server, url } = await listen(handler);
        try {
            await request(
                `${url}/publish?token=test-token&id=robot.glb&version=1.0.0`,
                { method: 'POST', body: primary },
            );
            // Then: publish delta for the same version
            const delta = Buffer.from('delta bytes');
            const res = await request(
                `${url}/publish?token=test-token&id=robot.glb&version=1.0.0&kind=delta`,
                { method: 'POST', body: delta },
            );
            assert.equal(res.status, 200);
            const idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
            const ver = idx.packages[0].versions[0];
            assert.ok(ver.deltaUrl, 'deltaUrl should be set');
            assert.ok(ver.downloadUrl, 'downloadUrl should still be set');
            // both files exist
            const primaryPath = path.join(store, 'packages', 'robot.glb', '1.0.0', 'robot.glb.vreen');
            const deltaPath = path.join(store, 'packages', 'robot.glb', '1.0.0', 'robot.glb.vreen-delta');
            assert.ok((await stat(primaryPath)).isFile());
            assert.ok((await stat(deltaPath)).isFile());
        } finally {
            server.close();
        }
    });
});
