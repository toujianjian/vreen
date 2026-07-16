// scripts/sync-engine-package.mjs
// ─────────────────────────────────────────────────────────────────────────────
// 把 src/engine/ 镜像到 packages/engine/src/，作为独立 npm 包的源。
//
// 步骤：
//   1. 删除 packages/engine/src/ 下除 logger.ts、*/index.ts 之外的所有旧文件
//   2. 复制 src/engine/ → packages/engine/src/（去掉 ecsDemo.ts 那个 demo
//      runner，因为它依赖主 app 的状态；改用 packages/engine/src/ecsDemo.ts
//      或者直接删除——package 暂不需要 demo 入口）
//   3. 改写 '@/lib/logger' → '../logger'
//   4. 写入一个干净的 packages/engine/src/index.ts（只 re-export 公共 API，
//      不导出 demo runner / 内部 helpers）
//
// 之所以手动维护一个独立目录（而不是直接 package.json 指向 src/engine）
// 是因为：
//   - 包对外的 public API 跟内部实现可以解耦（我们能 drop 一些内部 helper）
//   - 包的 logger 是自带的，跟主 app 隔离（主 app 那个带 UI 推送 sink）
//   - 例子（examples/）跟主 app 完全无关
// ─────────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src', 'engine');
const DST = path.join(ROOT, 'packages', 'engine', 'src');

// ── helpers ────────────────────────────────────────────────────────────────
async function walk(dir) {
  const out = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full)));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

async function rimraf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function ensureDir(p) {
  await fs.mkdir(p, { recursive: true });
}

async function copyFile(src, dst) {
  await ensureDir(path.dirname(dst));
  await fs.copyFile(src, dst);
}

// ── 1. 列出所有 .ts 文件，过滤掉 demo runner（ecsDemo.ts）───────────────────
async function collectEngineFiles() {
  const all = await walk(SRC);
  return all.filter((f) => f.endsWith('.ts') && !f.endsWith('ecsDemo.ts'));
}

// ── 2. 复制并改写 imports ─────────────────────────────────────────────────
//   - '@/lib/logger'   → '../logger'   (包内自带 logger.ts)
//   - '@/engine'        → '..'          (包内顶层 index.ts 是 public surface)
//   - 跳过所有 */index.ts：包的 barrel 是源码受控,不被镜像覆盖
async function mirror() {
  const files = await collectEngineFiles();
  let copied = 0;
  let rewritten = 0;
  let engineAliasRewritten = 0;
  let skipped = 0;
  for (const f of files) {
    const rel = path.relative(SRC, f);
    if (rel.endsWith('index.ts')) { skipped++; continue; }
    const dst = path.join(DST, rel);
    let text = await fs.readFile(f, 'utf8');
    if (text.includes("@/lib/logger")) {
      text = text.split("from '@/lib/logger'").join("from '../logger'");
      rewritten++;
    }
    // @/engine 是主 app 的 alias（指 src/engine/index.ts），
    // 在包内顶层 index.ts 是同一 public surface，所以 `from '@/engine'`
    // 全部替换为 `from '..'`。
    if (text.includes("from '@/engine'")) {
      text = text.split("from '@/engine'").join("from '..'");
      engineAliasRewritten++;
    }
    if (text.includes('from "@/engine"')) {
      text = text.split('from "@/engine"').join('from ".."');
      engineAliasRewritten++;
    }
    await ensureDir(path.dirname(dst));
    await fs.writeFile(dst, text, 'utf8');
    copied++;
  }
  return { copied, rewritten, engineAliasRewritten, skipped };
}

// ── 3. 删除镜像里不再存在的旧文件（防止 staleness）────────────────────────
//    总是保留 logger.ts 和任意子目录的 index.ts：
//      - logger.ts — 包内自带,不从 src/engine 镜像
//      - */index.ts — 这些是包内公共 surface 的 barrel,
//        跟 src/engine/*/index.ts 是不同的文件(我们故意把 ecsDemo 这类
//        内部入口剔除,只暴露公共 API;并且会扩展 shader / draco 等额外导出),
//        因此是源码受控的,不能被 sync 覆盖。
async function pruneStale(keptRelPaths) {
  const all = await walk(DST);
  let removed = 0;
  for (const f of all) {
    const rel = path.relative(DST, f).replace(/\\/g, '/');
    if (rel.endsWith('logger.ts')) continue;
    if (rel.endsWith('/index.ts')) continue;
    if (keptRelPaths.has(rel)) continue;
    await fs.unlink(f);
    removed++;
  }
  return removed;
}

// ── 4. 写入 packages/engine/src/index.ts 的公共 surface ──────────────────
const PACKAGE_INDEX = `// @vreen/engine — public surface.
//
// 公共 API = re-export 所有子模块的 barrel。
// 内部 helper / demo runner 不出现在这里。

export * from './Math';
export * from './Core';
export * from './Cameras';
export * from './Controls';
export * from './Lights';
export * from './Materials';
export * from './Geometries';
export * from './Loaders';
export * from './Renderer';
export * from './Helpers';
export {
  KeyframeTrack,
  NumberKeyframeTrack,
  VectorKeyframeTrack,
  QuaternionKeyframeTrack,
  type InterpMode,
  type TrackTarget,
  AnimationClip,
  AnimationAction,
  AnimationMixer,
  AnimationStateMachine,
  buildHumanoid,
  type LoopMode,
  type AnimMachineState as AnimStateNode,
  type AnimTransition,
  type HumanoidBundle,
} from './Animation';
export * from './ECS';
export * from './Physics';
export * from './Tools';

export {
  createLogger,
  setLoggerSink,
  setMinLevel,
  getMinLevel,
  type LogEntry,
  type LogLevel,
  type LogSink,
  type Logger,
} from './logger';
`;

async function writePackageIndex() {
  const dst = path.join(DST, 'index.ts');
  await fs.writeFile(dst, PACKAGE_INDEX, 'utf8');
}

// ── main ──────────────────────────────────────────────────────────────────
async function main() {
  // 收集保留的相对路径
  const files = await collectEngineFiles();
  const kept = new Set();
  for (const f of files) {
    const rel = path.relative(SRC, f).replace(/\\/g, '/');
    kept.add(rel);
  }

  const { copied, rewritten, engineAliasRewritten } = await mirror();
  const removed = await pruneStale(kept);
  await writePackageIndex();

  console.log(
    `[sync-engine] copied=${copied} loggerRewrites=${rewritten} ` +
    `engineAliasRewrites=${engineAliasRewritten} pruned=${removed}`,
  );
}

main().catch((e) => {
  console.error('[sync-engine] failed:', e);
  process.exit(1);
});
