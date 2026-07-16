#!/usr/bin/env node
// vreen-publish — registry publisher CLI.
//
// 直接对 registry store 操作的命令行工具,无需启动 HTTP server。
// 适合 CI 脚本、批量发布、本地构建产物上架。
//
// 用法:
//   vreen-publish add <id> <version> <file.vreen> [--store <dir>] [--name <human name>] [--tag t1 --tag t2]
//   vreen-publish yank <id> <version> --reason "msg" [--store <dir>]
//   vreen-publish unyank <id> <version> [--store <dir>]
//   vreen-publish remove <id> <version> [--store <dir>]    # delete a single version
//   vreen-publish delete <id>                             # delete the whole package
//   vreen-publish info <id> [--store <dir>]
//   vreen-publish list [--store <dir>] [--tag <tag>]
//   vreen-publish verify <id> <version> [--store <dir>]   # recompute sha256 and compare
//   vreen-publish diff <id> <old> <new>                   # delegate to scripts/vreen-cli.mjs
//
// 零外部依赖,Node 16+ ESM。

import { readFile, writeFile, stat, mkdir, copyFile, rm } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function usage() {
    process.stdout.write(`vreen-publish — registry publisher CLI

Usage:
  vreen-publish add <id> <version> <file.vreen> [--name <name>] [--tag t1] [--store <dir>]
  vreen-publish yank <id> <version> --reason "msg"   [--store <dir>]
  vreen-publish unyank <id> <version>                [--store <dir>]
  vreen-publish remove <id> <version>                [--store <dir>]
  vreen-publish delete <id>                          [--store <dir>]
  vreen-publish info <id>                            [--store <dir>]
  vreen-publish list [--tag <tag>]                   [--store <dir>]
  vreen-publish verify <id> <version>                [--store <dir>]

Options:
  --store <dir>   registry store (default: packages/registry/store)
  -h, --help      show this help
  -q, --quiet     suppress non-error output
  -v, --verbose

Environment:
  VREEN_REGISTRY_STORE  default packages/registry/store
`);
}

function parseArgs(argv) {
    const out = { positional: [], flags: {}, tags: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '-h' || a === '--help') out.flags.help = true;
        else if (a === '-q' || a === '--quiet') out.flags.quiet = true;
        else if (a === '-v' || a === '--verbose') out.flags.verbose = true;
        else if (a === '--store') out.flags.store = argv[++i];
        else if (a === '--name') out.flags.name = argv[++i];
        else if (a === '--tag') {
            const v = argv[++i];
            out.tags.push(v);
            if (out.flags.tag === undefined) out.flags.tag = v;
        }
        else if (a === '--reason') out.flags.reason = argv[++i];
        else out.positional.push(a);
    }
    return out;
}

function defaultStore() {
    return path.resolve(
        process.env.VREEN_REGISTRY_STORE ?? path.join(__dirname, 'store'),
    );
}

async function readIndex(store) {
    const idxPath = path.join(store, 'index.json');
    if (!existsSync(idxPath)) {
        const empty = {
            version: '1.0.0',
            generatedAt: new Date().toISOString(),
            packages: [],
        };
        await writeFile(idxPath, JSON.stringify(empty, null, 2));
        return empty;
    }
    return JSON.parse(await readFile(idxPath, 'utf-8'));
}

async function writeIndex(store, idx) {
    idx.generatedAt = new Date().toISOString();
    await writeFile(path.join(store, 'index.json'), JSON.stringify(idx, null, 2));
}

function sha256Hex(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}

async function sha256HexStreamed(filePath) {
    const hash = crypto.createHash('sha256');
    return new Promise((resolve, reject) => {
        const stream = createReadStream(filePath);
        stream.on('data', (c) => hash.update(c));
        stream.on('end', () => resolve(hash.digest('hex')));
        stream.on('error', reject);
    });
}

function safeJoin(root, ...parts) {
    const joined = path.join(root, ...parts);
    const normalized = path.resolve(joined);
    const rootN = path.resolve(root);
    if (!normalized.startsWith(rootN + path.sep) && normalized !== rootN) {
        throw new Error('path traversal');
    }
    return normalized;
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

// ── Subcommands ───────────────────────────────────────────────────

async function cmdAdd(store, args) {
    if (args.positional.length < 3) throw new Error('add: missing id/version/file');
    const [id, version, file] = args.positional;

    if (!/^[a-z0-9][a-z0-9._-]{1,63}$/.test(id)) {
        throw new Error(`add: bad id '${id}' (lowercase, dot/dash/underscore, 2-64 chars)`);
    }
    if (!/^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$/.test(version)) {
        throw new Error(`add: bad version '${version}' (expected semver)`);
    }
    if (!existsSync(file)) throw new Error(`add: file not found: ${file}`);

    const isDelta = file.endsWith('.vreen-delta') || file.endsWith('.delta');
    const filename = isDelta ? `${id}.vreen-delta` : `${id}.vreen`;

    const dir = safeJoin(store, 'packages', id, version);
    await mkdir(dir, { recursive: true });
    const dst = path.join(dir, filename);
    await copyFile(file, dst);

    const size = (await stat(dst)).size;
    const sha = await sha256HexStreamed(dst);

    const idx = await readIndex(store);
    let pkg = idx.packages.find((p) => p.id === id);
    if (!pkg) {
        pkg = {
            id,
            name: args.flags.name ?? id,
            tags: args.tags.length ? args.tags : undefined,
            latest: version,
            versions: [],
        };
        idx.packages.push(pkg);
    } else {
        if (args.flags.name) pkg.name = args.flags.name;
        if (args.tags.length) {
            pkg.tags = Array.from(new Set([...(pkg.tags ?? []), ...args.tags]));
        }
    }

    let ver = pkg.versions.find((v) => v.version === version);
    if (!ver) {
        ver = {
            version,
            releasedAt: new Date().toISOString(),
            downloadUrl: `/packages/${id}/${version}/${filename}`,
            size,
            sha256: sha,
            formatVersion: '0.2.1',
        };
        pkg.versions.push(ver);
    } else {
        ver.size = size;
        ver.sha256 = sha;
    }
    if (isDelta) {
        ver.deltaUrl = `/packages/${id}/${version}/${filename}`;
    }
    if (compareSemver(version, pkg.latest) > 0) pkg.latest = version;
    await writeIndex(store, idx);

    if (!args.flags.quiet) {
        process.stdout.write(`added ${id}@${version} (${size} bytes, sha256=${sha.slice(0, 12)}…)\n`);
        process.stdout.write(`  stored at ${dst}\n`);
        process.stdout.write(`  latest: ${pkg.latest}\n`);
    }
    return { id, version, size, sha256: sha };
}

async function cmdYank(store, args, yank) {
    if (args.positional.length < 2) throw new Error(`${yank ? 'yank' : 'unyank'}: missing id/version`);
    const [id, version] = args.positional;
    const idx = await readIndex(store);
    const pkg = idx.packages.find((p) => p.id === id);
    if (!pkg) throw new Error(`${id}: not found in registry`);
    const ver = pkg.versions.find((v) => v.version === version);
    if (!ver) throw new Error(`${id}@${version}: version not found`);
    if (yank) {
        ver.yanked = true;
        ver.yankReason = args.flags.reason ?? '';
    } else {
        delete ver.yanked;
        delete ver.yankReason;
    }
    await writeIndex(store, idx);
    if (!args.flags.quiet) {
        process.stdout.write(`${yank ? 'yanked' : 'un-yanked'} ${id}@${version}${yank ? ` — ${ver.yankReason ?? ''}` : ''}\n`);
    }
}

async function cmdRemove(store, args) {
    if (args.positional.length < 2) throw new Error('remove: missing id/version');
    const [id, version] = args.positional;
    const dir = safeJoin(store, 'packages', id, version);
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
    const idx = await readIndex(store);
    const pkg = idx.packages.find((p) => p.id === id);
    if (pkg) {
        pkg.versions = pkg.versions.filter((v) => v.version !== version);
        if (pkg.versions.length === 0) {
            idx.packages = idx.packages.filter((p) => p.id !== id);
        } else if (pkg.latest === version) {
            pkg.latest = pkg.versions
                .map((v) => v.version)
                .sort((a, b) => -compareSemver(a, b))[0];
        }
        await writeIndex(store, idx);
    }
    if (!args.flags.quiet) process.stdout.write(`removed ${id}@${version}\n`);
}

async function cmdDelete(store, args) {
    if (args.positional.length < 1) throw new Error('delete: missing id');
    const [id] = args.positional;
    const dir = safeJoin(store, 'packages', id);
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
    const idx = await readIndex(store);
    idx.packages = idx.packages.filter((p) => p.id !== id);
    await writeIndex(store, idx);
    if (!args.flags.quiet) process.stdout.write(`deleted ${id}\n`);
}

async function cmdInfo(store, args) {
    if (args.positional.length < 1) throw new Error('info: missing id');
    const [id] = args.positional;
    const idx = await readIndex(store);
    const pkg = idx.packages.find((p) => p.id === id);
    if (!pkg) throw new Error(`${id}: not found`);
    process.stdout.write(`${pkg.id} — ${pkg.name}\n`);
    process.stdout.write(`  description: ${pkg.description ?? '(none)'}\n`);
    process.stdout.write(`  tags: ${pkg.tags?.join(', ') ?? '(none)'}\n`);
    process.stdout.write(`  latest: ${pkg.latest}\n`);
    process.stdout.write(`  versions:\n`);
    for (const v of pkg.versions) {
        const yank = v.yanked ? ` (YANKED — ${v.yankReason ?? ''})` : '';
        process.stdout.write(`    • ${v.version}  ${(v.size / 1024).toFixed(1)} KB  sha256=${v.sha256.slice(0, 12)}…${yank}\n`);
        process.stdout.write(`      download: ${v.downloadUrl}\n`);
        if (v.deltaUrl) process.stdout.write(`      delta:    ${v.deltaUrl}\n`);
    }
}

async function cmdList(store, args) {
    const idx = await readIndex(store);
    const tag = args.flags.tag;
    const pkgs = tag ? idx.packages.filter((p) => p.tags?.includes(tag)) : idx.packages;
    if (pkgs.length === 0) {
        process.stdout.write(tag ? `no packages with tag '${tag}'\n` : 'no packages\n');
        return;
    }
    for (const p of pkgs) {
        const tags = p.tags?.length ? ` [${p.tags.join(', ')}]` : '';
        process.stdout.write(`  • ${p.id} v${p.latest} — ${p.name}${tags}\n`);
    }
}

async function cmdVerify(store, args) {
    if (args.positional.length < 2) throw new Error('verify: missing id/version');
    const [id, version] = args.positional;
    const idx = await readIndex(store);
    const pkg = idx.packages.find((p) => p.id === id);
    if (!pkg) throw new Error(`${id}: not found`);
    const ver = pkg.versions.find((v) => v.version === version);
    if (!ver) throw new Error(`${id}@${version}: not found`);

    const filename = ver.downloadUrl.split('/').pop();
    const file = safeJoin(store, 'packages', id, version, filename);
    if (!existsSync(file)) {
        process.stderr.write(`FAIL ${id}@${version}: file missing at ${file}\n`);
        process.exitCode = 1;
        return false;
    }
    const actual = await sha256HexStreamed(file);
    if (actual !== ver.sha256) {
        process.stderr.write(`FAIL ${id}@${version}: sha256 mismatch\n  expected: ${ver.sha256}\n  actual:   ${actual}\n`);
        process.exitCode = 1;
        return false;
    }
    process.stdout.write(`OK ${id}@${version} (sha256=${actual.slice(0, 12)}…)\n`);
    return true;
}

const COMMANDS = {
    add: cmdAdd,
    yank: (s, a) => cmdYank(s, a, true),
    unyank: (s, a) => cmdYank(s, a, false),
    remove: cmdRemove,
    delete: cmdDelete,
    info: cmdInfo,
    list: cmdList,
    verify: cmdVerify,
};

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.flags.help || args.positional.length === 0) {
        usage();
        process.exit(args.flags.help ? 0 : 2);
    }
    const store = args.flags.store ? path.resolve(args.flags.store) : defaultStore();
    const [cmd] = args.positional;
    const fn = COMMANDS[cmd];
    if (!fn) {
        process.stderr.write(`unknown subcommand: ${cmd}\n\n`);
        usage();
        process.exit(2);
    }
    args.positional = args.positional.slice(1);
    try {
        await fn(store, args);
    } catch (e) {
        process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
    }
}

main();
