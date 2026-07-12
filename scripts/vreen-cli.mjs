#!/usr/bin/env node
// vreen-cli — 轻量级命令行工具。
//
// 用法:
//   node scripts/vreen-cli.js validate <file.vreen> [--verbose]
//   node scripts/vreen-cli.js pack    <input.json> <out.vreen>
//   node scripts/vreen-cli.js diff    <base.vreen> <head.vreen>
//   node scripts/vreen-cli.js delta   <base.vreen> <head.vreen> <out.vreen-delta>
//   node scripts/vreen-cli.js apply   <base.vreen> <delta.vreen-delta> <out.vreen>
//   node scripts/vreen-cli.js sha256  <file>
//
// 跨平台 Node 16+ ES module。Vite 不参与 — CLI 直接 import src/lib/*。

import { readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// 由于 src/lib/*.ts 是 TS,这里用 tsx 自带 — 但避免增加 devDep,改为用
// 纯 ESM 动态 import 到编译后版本。先尝试 source,失败再回退到 .js。
async function importLib(name) {
  const candidates = [
    `../src/lib/${name}.ts`,
    `../src/lib/${name}.js`,
    `../dist/lib/${name}.js`,
  ];
  for (const c of candidates) {
    try {
      const mod = await import(c);
      return mod;
    } catch (_) { /* try next */ }
  }
  throw new Error(`failed to import ${name}`);
}

function usage() {
  process.stderr.write(`vreen-cli — .vreen pack validation / diff / delta / registry utility

Usage:
  vreen-cli validate <file.vreen> [--verbose]
  vreen-cli pack    <input.json>    <out.vreen>
  vreen-cli diff    <base.vreen>    <head.vreen>
  vreen-cli delta   <base.vreen>    <head.vreen>  <out.vreen-delta>
  vreen-cli apply   <base.vreen>    <delta.vreen-delta>  <out.vreen>
  vreen-cli sha256  <file>
  vreen-cli registry list   <file.json | url>
  vreen-cli registry resolve <file.json | url> <package-id> [range]
  vreen-cli registry fetch   <url>              <package-id> [range] [out.vreen]

Subcommand help:
  validate          Schema + sha256 + size integrity report
  pack              Build a .vreen from a JSON input descriptor
  diff              Show asset/scene/world differences between two packages
  delta             Build a .vreen-delta (incremental) from base to head
  apply             Apply a .vreen-delta to a base, emitting a new .vreen
  sha256            Print hex SHA-256 of a file
  registry list     List all packages in a registry
  registry resolve  Resolve the best version matching a range
  registry fetch    Download the resolved .vreen to a file

Options:
  -h, --help   Show this help
  -v, --verbose
  -q, --quiet  Suppress non-error output
`);
}

function parseArgs(argv) {
  const out = { positional: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.flags.help = true;
    else if (a === '-v' || a === '--verbose') out.flags.verbose = true;
    else if (a === '-q' || a === '--quiet') out.flags.quiet = true;
    else out.positional.push(a);
  }
  return out;
}

async function readBytes(p) {
  const buf = await readFile(p);
  return new Uint8Array(buf);
}

async function cmdValidate(args) {
  if (args.positional.length < 1) throw new Error('validate: missing file');
  const lib = await importLib('vreenValidate');
  const { tryUnpackAnyVreen, formatReport, getValidationReport } = lib;
  const u8 = await readBytes(args.positional[0]);
  const unpacked = await tryUnpackAnyVreen(u8);
  const report = await getValidationReport(unpacked);
  process.stdout.write(formatReport(report, !!args.flags.verbose) + '\n');
  if (!report.ok) process.exit(1);
}

async function cmdPack(args) {
  if (args.positional.length < 2) throw new Error('pack: missing input/out');
  const lib = await importLib('vreenPack');
  const { packVreenPackage } = lib;
  const inputText = (await readFile(args.positional[0])).toString('utf-8');
  const input = JSON.parse(inputText);
  // 简单适配:input.assets 字段为 [{kind, data:<base64>, originalName}], 转成 PackInput
  if (Array.isArray(input.assets)) {
    input.assets = input.assets.map((a) => ({
      id: a.id,
      kind: a.kind,
      originalName: a.originalName,
      data: new Uint8Array(Buffer.from(a.data, 'base64')),
      sha256: a.sha256,
    }));
  }
  const result = packVreenPackage(input);
  await writeFile(args.positional[1], Buffer.from(result.bytes));
  if (!args.flags.quiet) {
    process.stdout.write(`packed ${args.positional[1]} (${result.bytes.byteLength} bytes, ${Object.keys(result.entries).length} entries)\n`);
  }
}

async function cmdDiff(args) {
  if (args.positional.length < 2) throw new Error('diff: missing base/head');
  const diff = await importLib('vreenDiff');
  const base = await diff.tryUnpackAnyVreen(await readBytes(args.positional[0]));
  const head = await diff.tryUnpackAnyVreen(await readBytes(args.positional[1]));
  const d = await diff.diffVreenPackages(base, head);
  process.stdout.write(diff.formatDiff(d) + '\n');
}

async function cmdDelta(args) {
  if (args.positional.length < 3) throw new Error('delta: missing base/head/out');
  const diff = await importLib('vreenDiff');
  const base = await diff.tryUnpackAnyVreen(await readBytes(args.positional[0]));
  const head = await diff.tryUnpackAnyVreen(await readBytes(args.positional[1]));
  const d = await diff.diffVreenPackages(base, head);
  const delta = await diff.createVreenDelta({ base, head, diff: d });
  await writeFile(args.positional[2], Buffer.from(delta.bytes));
  if (!args.flags.quiet) {
    process.stdout.write(`delta ${args.positional[2]} (${delta.bytes.byteLength} bytes, savings ${(delta.savingsRatio * 100).toFixed(1)}%)\n`);
  }
}

async function cmdApply(args) {
  if (args.positional.length < 3) throw new Error('apply: missing base/delta/out');
  const diff = await importLib('vreenDiff');
  const base = await diff.tryUnpackAnyVreen(await readBytes(args.positional[0]));
  const deltaBytes = await readBytes(args.positional[1]);
  const result = await diff.applyDeltaThenPack(base, deltaBytes);
  await writeFile(args.positional[2], Buffer.from(result.bytes));
  if (!args.flags.quiet) {
    process.stdout.write(`applied +${result.bytes.byteLength} bytes → ${args.positional[2]}\n`);
  }
}

async function cmdSha256(args) {
  if (args.positional.length < 1) throw new Error('sha256: missing file');
  const validate = await importLib('vreenValidate');
  const u8 = await readBytes(args.positional[0]);
  const hash = await validate.computeSha256(u8);
  const st = await stat(args.positional[0]);
  process.stdout.write(`${hash}  ${args.positional[0]}  (${st.size} bytes)\n`);
}

async function cmdRegistry(args) {
  // vreen-cli registry <subcommand> <registry.json> [args]
  if (args.positional.length < 2) {
    process.stderr.write('registry: missing subcommand/registry-file\n');
    process.stderr.write('Usage: vreen-cli registry list <file>\n');
    process.stderr.write('       vreen-cli registry resolve <file> <package-id> [range]\n');
    process.stderr.write('       vreen-cli registry fetch <registry-url> <package-id> [range] [out.vreen]\n');
    process.exit(2);
  }
  const [sub, src, ...rest] = args.positional;
  const reg = await importLib('vreenRegistry');
  let index;
  if (sub === 'fetch') {
    // src is URL
    const url = src;
    index = await reg.loadRegistry(url);
  } else {
    const { readFile } = await import('node:fs/promises');
    const text = (await readFile(src)).toString('utf-8');
    index = JSON.parse(text);
  }
  if (sub === 'list') {
    process.stdout.write(reg.formatRegistry(index) + '\n');
    return;
  }
  if (sub === 'resolve' || sub === 'fetch') {
    const pkgId = rest[0];
    const range = rest[1] || 'latest';
    const pkg = reg.findPackage(index, pkgId);
    if (!pkg) { process.stderr.write(`registry: package not found: ${pkgId}\n`); process.exit(1); }
    const ver = reg.resolveVersion(pkg, range);
    if (!ver) { process.stderr.write(`registry: no version matching ${range}\n`); process.exit(1); }
    const url = reg.resolveDownloadUrl(ver, index.baseUrl);
    process.stdout.write(`${pkgId}@${ver.version} → ${url}\n  size: ${ver.size}  sha256: ${ver.sha256}\n`);
    if (sub === 'fetch' && rest[2]) {
      const out = rest[2];
      const res = await fetch(url);
      if (!res.ok) { process.stderr.write(`download failed: ${res.status}\n`); process.exit(1); }
      const ab = await res.arrayBuffer();
      const { writeFile } = await import('node:fs/promises');
      await writeFile(out, Buffer.from(ab));
      process.stdout.write(`saved → ${out} (${ab.byteLength} bytes)\n`);
    }
    return;
  }
  process.stderr.write(`registry: unknown subcommand: ${sub}\n`);
  process.exit(2);
}

const COMMANDS = {
  validate: cmdValidate,
  pack: cmdPack,
  diff: cmdDiff,
  delta: cmdDelta,
  apply: cmdApply,
  sha256: cmdSha256,
  registry: cmdRegistry,
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.help || args.positional.length === 0) {
    usage();
    process.exit(args.flags.help ? 0 : 2);
  }
  const [cmd] = args.positional;
  const fn = COMMANDS[cmd];
  if (!fn) {
    process.stderr.write(`unknown subcommand: ${cmd}\n\n`);
    usage();
    process.exit(2);
  }
  // shift out the subcommand
  args.positional = args.positional.slice(1);
  try {
    await fn(args);
  } catch (e) {
    process.stderr.write(`error: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

main();
