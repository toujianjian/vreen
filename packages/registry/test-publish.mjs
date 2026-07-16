// vreen-publish CLI tests — uses node:test (Node 18+).
//
// Run:
//   node --test packages/registry/test-publish.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLISH = path.join(__dirname, 'publish.mjs');

// ── helpers ────────────────────────────────────────────────────────

function run(args, opts = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [PUBLISH, ...args], {
            env: { ...process.env, ...(opts.env ?? {}) },
        });
        const chunks = [];
        const errs = [];
        child.stdout.on('data', (c) => chunks.push(c));
        child.stderr.on('data', (c) => errs.push(c));
        child.on('error', reject);
        child.on('close', (code) => resolve({
            code,
            stdout: Buffer.concat(chunks).toString('utf-8'),
            stderr: Buffer.concat(errs).toString('utf-8'),
        }));
    });
}

async function withStore(fn) {
    const store = await mkdtemp(path.join(tmpdir(), 'vreen-publish-test-'));
    try {
        await fn(store);
    } finally {
        await rm(store, { recursive: true, force: true });
    }
}

async function makeFakeVreen(store, name = 'pkg.vreen', content = 'hello vreen') {
    const file = path.join(store, name);
    await writeFile(file, content);
    return { file, sha: crypto.createHash('sha256').update(content).digest('hex'), size: Buffer.byteLength(content) };
}

// ── tests ──────────────────────────────────────────────────────────

test('add creates package and version entry', async () => {
    await withStore(async (store) => {
        const { file, sha, size } = await makeFakeVreen(store);
        const r = await run(['add', 'robot.glb', '1.0.0', file, '--store', store]);
        assert.equal(r.code, 0, r.stderr);
        const idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
        assert.equal(idx.packages.length, 1);
        assert.equal(idx.packages[0].id, 'robot.glb');
        assert.equal(idx.packages[0].latest, '1.0.0');
        const ver = idx.packages[0].versions[0];
        assert.equal(ver.sha256, sha);
        assert.equal(ver.size, size);
    });
});

test('add rejects bad id and bad version', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store);
        const r1 = await run(['add', 'BAD_ID', '1.0.0', file, '--store', store]);
        assert.notEqual(r1.code, 0);
        assert.match(r1.stderr, /bad id/);
        const r2 = await run(['add', 'robot.glb', 'not-semver', file, '--store', store]);
        assert.notEqual(r2.code, 0);
        assert.match(r2.stderr, /bad version/);
    });
});

test('add picks max semver as latest', async () => {
    await withStore(async (store) => {
        for (const v of ['1.0.0', '1.0.1', '1.2.0', '0.9.0']) {
            const { file } = await makeFakeVreen(store, `${v}.vreen`, `content-${v}`);
            const r = await run(['add', 'pkg', v, file, '--store', store]);
            assert.equal(r.code, 0, r.stderr);
        }
        const idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
        assert.equal(idx.packages[0].latest, '1.2.0');
        assert.equal(idx.packages[0].versions.length, 4);
    });
});

test('yank and unyank flip the flag', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store);
        await run(['add', 'pkg', '1.0.0', file, '--store', store]);
        let idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
        assert.equal(idx.packages[0].versions[0].yanked, undefined);

        const ry = await run(['yank', 'pkg', '1.0.0', '--reason', 'bad', '--store', store]);
        assert.equal(ry.code, 0, ry.stderr);
        idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
        assert.equal(idx.packages[0].versions[0].yanked, true);
        assert.equal(idx.packages[0].versions[0].yankReason, 'bad');

        const ru = await run(['unyank', 'pkg', '1.0.0', '--store', store]);
        assert.equal(ru.code, 0, ru.stderr);
        idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
        assert.equal(idx.packages[0].versions[0].yanked, undefined);
    });
});

test('remove deletes the version file and updates index', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store);
        await run(['add', 'pkg', '1.0.0', file, '--store', store]);
        await run(['add', 'pkg', '1.1.0', file, '--store', store]);

        const r = await run(['remove', 'pkg', '1.0.0', '--store', store]);
        assert.equal(r.code, 0, r.stderr);
        const idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
        assert.equal(idx.packages[0].versions.length, 1);
        assert.equal(idx.packages[0].versions[0].version, '1.1.0');
        assert.equal(idx.packages[0].latest, '1.1.0');
    });
});

test('delete removes the whole package', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store);
        await run(['add', 'pkg', '1.0.0', file, '--store', store]);
        const r = await run(['delete', 'pkg', '--store', store]);
        assert.equal(r.code, 0, r.stderr);
        const idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
        assert.equal(idx.packages.length, 0);
    });
});

test('info prints package details', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store);
        await run(['add', 'pkg', '1.0.0', file, '--store', store, '--name', 'Test Package', '--tag', 'demo']);
        const r = await run(['info', 'pkg', '--store', store]);
        assert.equal(r.code, 0, r.stderr);
        assert.match(r.stdout, /Test Package/);
        assert.match(r.stdout, /demo/);
        assert.match(r.stdout, /1\.0\.0/);
    });
});

test('list prints all packages', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store);
        await run(['add', 'pkg-a', '1.0.0', file, '--store', store]);
        await run(['add', 'pkg-b', '1.0.0', file, '--store', store]);
        const r = await run(['list', '--store', store]);
        assert.equal(r.code, 0, r.stderr);
        assert.match(r.stdout, /pkg-a/);
        assert.match(r.stdout, /pkg-b/);
    });
});

test('list --tag filters by tag', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store);
        await run(['add', 'pkg-a', '1.0.0', file, '--store', store, '--tag', 'character']);
        await run(['add', 'pkg-b', '1.0.0', file, '--store', store, '--tag', 'hdri']);
        const r = await run(['list', '--store', store, '--tag', 'hdri']);
        assert.equal(r.code, 0, r.stderr);
        assert.match(r.stdout, /pkg-b/);
        assert.doesNotMatch(r.stdout, /pkg-a/);
    });
});

test('verify succeeds for an untampered file', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store, 'a.vreen', 'verified content');
        await run(['add', 'pkg', '1.0.0', file, '--store', store]);
        const r = await run(['verify', 'pkg', '1.0.0', '--store', store]);
        assert.equal(r.code, 0, r.stderr);
        assert.match(r.stdout, /^OK /);
    });
});

test('verify detects a tampered file', async () => {
    await withStore(async (store) => {
        const { file } = await makeFakeVreen(store, 'a.vreen', 'original');
        await run(['add', 'pkg', '1.0.0', file, '--store', store]);
        // tamper
        const stored = path.join(store, 'packages', 'pkg', '1.0.0', 'pkg.vreen');
        await writeFile(stored, 'tampered');
        const r = await run(['verify', 'pkg', '1.0.0', '--store', store]);
        assert.notEqual(r.code, 0);
        assert.match(r.stderr, /sha256 mismatch/);
    });
});

test('add for delta sets deltaUrl and keeps primary downloadUrl', async () => {
    await withStore(async (store) => {
        const { file: f1 } = await makeFakeVreen(store, 'a.vreen', 'primary');
        await run(['add', 'pkg', '1.0.0', f1, '--store', store]);
        const { file: f2 } = await makeFakeVreen(store, 'a.delta', 'delta');
        const r = await run(['add', 'pkg', '1.0.0', f2, '--store', store]);
        assert.equal(r.code, 0, r.stderr);
        const idx = JSON.parse(await readFile(path.join(store, 'index.json'), 'utf-8'));
        const ver = idx.packages[0].versions[0];
        assert.ok(ver.downloadUrl.includes('pkg.vreen'));
        assert.ok(ver.deltaUrl.includes('pkg.vreen-delta'));
    });
});
