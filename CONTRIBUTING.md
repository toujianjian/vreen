# Contributing to VREEN

> Thanks for your interest in contributing to VREEN! This document
> describes the workflow, conventions, and review criteria for
> contributions to the [VREEN repository](https://github.com/toujianjian/vreen).
>
> For the system architecture, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).
> For the project roadmap, see [`ROADMAP.md`](./ROADMAP.md). For a
> high-level overview, see [`README.md`](./README.md).

---

## Table of Contents

1. [Code of Conduct](#1-code-of-conduct)
2. [Contribution Workflow](#2-contribution-workflow)
3. [Development Environment](#3-development-environment)
4. [Project Structure Navigation](#4-project-structure-navigation)
5. [Code Conventions](#5-code-conventions)
6. [Commit Message Format](#6-commit-message-format)
7. [Testing Requirements](#7-testing-requirements)
8. [Pull Request Review Criteria](#8-pull-request-review-criteria)
9. [Issue Reporting Guide](#9-issue-reporting-guide)
10. [Engine Package Contributions](#10-engine-package-contributions)
11. [Documentation Contributions](#11-documentation-contributions)
12. [Licensing](#12-licensing)

---

## 1. Code of Conduct

Be respectful, constructive, and assume good faith. VREEN is a
solo-maintained project with an irregular release cadence — patience is
appreciated. Personal attacks, harassment, and discriminatory language
will not be tolerated.

---

## 2. Contribution Workflow

### 2.1 Discuss before you build

For any non-trivial change (new subsystem, breaking API change, format
specification change), **open an issue first** to discuss the approach.
This avoids wasted effort when the maintainer has a different direction
in mind.

Trivial changes (bug fixes, documentation typos, test additions for
existing behavior) can go straight to a PR.

### 2.2 Fork → branch → PR

```bash
# 1. Fork the repository on GitHub, then:
git clone https://github.com/<your-username>/vreen.git
cd vreen
git remote add upstream https://github.com/toujianjian/vreen.git

# 2. Create a feature branch from main.
git checkout -b feat/my-feature

# 3. Make your changes, keeping commits atomic (see §6).

# 4. Run local checks (see §3 and §7).
npm run typecheck
npm test

# 5. Push and open a Pull Request against main.
git push origin feat/my-feature
```

### 2.3 Keep PRs scoped

VREEN favors atomic, 1–3 hour tasks (see `ROADMAP.md`). A PR that does
one thing well will be reviewed faster than a PR that does five things
at once. If your change spans multiple concerns, split it into multiple
PRs.

### 2.4 Rebase before review

If the `main` branch has moved, rebase your branch onto the latest
`main` before requesting review:

```bash
git fetch upstream
git rebase upstream/main
# resolve conflicts, then:
git push --force-with-lease origin feat/my-feature
```

> **Do not** use `git push --force` without `--force-with-lease`. The
> `--force-with-lease` flag prevents you from accidentally overwriting
> someone else's commits if the remote branch moved.

---

## 3. Development Environment

### Prerequisites

- **Node.js** >= 18.18 (Node 20 recommended; this is what CI uses)
- A modern browser with **WebGL 2** support (latest Chrome / Edge /
  Firefox / Safari)
- **Git** (with `git-lfs` if you intend to commit large binary test
  fixtures — see §7)
- Optional: **draco3d** `^1.5.7` for testing Draco-compressed GLB loading
- Optional: **Unity** / **Unreal** if you intend to touch the SDK
  packages under `packages/unity-package/` or `packages/unreal-plugin/`

### Install

```bash
git clone https://github.com/<your-username>/vreen.git
cd vreen
npm install
```

The `prepare` script installs Husky git hooks automatically.

### Common commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server with HMR (http://localhost:5173). |
| `npm run build` | `tsc -b && vite build` — type-check then produce a static SPA in `dist/`. |
| `npm run preview` | Locally preview the production build from `dist/`. |
| `npm run typecheck` | `tsc -b --noEmit` — strict type check (runs in CI and pre-commit). |
| `npm run test` | `vitest run` — run the unit test suite once. |
| `npm run test:watch` | `vitest` — watch-mode tests. |
| `npm run test:coverage` | `vitest run --coverage` — coverage report via v8. |
| `npm run engine:build` | Build the `@vreen/engine` standalone package. |
| `npm run engine:typecheck` | Type-check the engine package in isolation. |
| `npm run engine:sync` | Sync `src/engine/` into `packages/engine/src/` for publishing. |
| `npm run electron:dev` | Run Vite + Electron concurrently in dev mode. |
| `npm run electron:build` | Build the SPA and package a portable Windows `.exe` into `release/`. |
| `npm run electron:build:dir` | Produce an unpacked `win-unpacked/` directory (faster iteration). |
| `npm run vreen` | `.vreen` CLI — pack / unpack / validate / diff packages. |

### Windows-specific notes

- Use PowerShell. Path separator is `\`. Quote paths containing spaces.
- On Windows with non-ASCII project paths, `lucide-react`'s `replace-all`
  icon can fail to install (`Could not read from file ...
  replace-all.js`). See [`setup-git.ps1`](./setup-git.ps1) for a one-line
  shim.
- Commands in this document use Bash syntax for clarity; adapt
  accordingly in PowerShell (e.g. `;` instead of `&&` for command
  chaining).

---

## 4. Project Structure Navigation

VREEN has three logical layers. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md)
for the full picture; this section is a quick orientation.

```
vreen/
├── src/                # Main Vite application
│   ├── engine/         # Self-developed WebGL2 engine (mirrored to packages/engine/src)
│   ├── components/     # React UI (home / viewer / hud / three)
│   ├── pages/          # Route-level pages
│   ├── stores/         # Zustand stores
│   ├── three/          # Three.js bridges (loaders / generators / anim)
│   ├── lib/            # Utilities (logger / presets / vreenPack / Blockly / ECS API)
│   ├── i18n/           # i18next config + zh / en locales
│   └── types/          # Shared TypeScript types
├── packages/           # Multi-language SDK ecosystem
│   ├── engine/         # @vreen/engine — standalone npm package (zero deps)
│   ├── registry/       # .vreen package registry schema + reference server
│   ├── unity-package/  # Unity editor plugin (C#)
│   ├── unreal-plugin/  # Unreal Engine plugin (C++)
│   └── vreen-core/     # Kotlin/Java build-time tools (Maven)
├── sdks/java/          # Java POJO SDK for .vreen (Gradle + Maven)
├── docs/               # Format spec, API tutorial
├── scripts/            # vreen-cli.mjs, sync-engine-package.mjs, etc.
├── electron/           # Electron main process / preload / splash
├── .github/workflows/  # CI pipeline
└── .husky/             # Git hooks
```

### Where does my change belong?

| Type of change | Location |
|-----------------|----------|
| Engine kernel (math, renderer, ECS, animation, physics, loaders) | `src/engine/<subsystem>/` (source of truth) — will be mirrored to `packages/engine/src/` |
| Inspector UI (React components) | `src/components/viewer/` or `src/components/<area>/` |
| Zustand state | `src/stores/` |
| Three.js bridge utilities | `src/three/` |
| Application utilities (logger, presets, Blockly, `.vreen` tooling) | `src/lib/` |
| i18n strings | `src/i18n/locales/{en,zh}.json` |
| Format spec | `docs/format/vreen-format-spec.md` |
| Multi-language SDK | `packages/<lang>/` or `sdks/<lang>/` |
| CI configuration | `.github/workflows/` |
| Build scripts | `scripts/` |

---

## 5. Code Conventions

### 5.1 Language and module system

- **TypeScript strict mode.** `strict`, `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch` are all enabled in
  `tsconfig.app.json`. Do not disable them locally.
- **ESM only.** `import` / `export`; no `require` / `module.exports` in
  application source. The Electron main process (`electron/*.cjs`) is
  the only CommonJS exception.
- **Target:** ES2020+ for engine, ES2022 for the application.

### 5.2 Naming

| Element | Convention | Example |
|---------|-----------|---------|
| Variables, functions, properties | camelCase | `meshCount`, `updateWorldMatrix` |
| Classes, components, types, interfaces | PascalCase | `WebGL2Renderer`, `ComponentType` |
| Constants (truly constant) | UPPER_SNAKE_CASE | `INDEX_MASK`, `DEG2RAD` |
| Enums | PascalCase with PascalCase members | `LoopMode.Repeat` |
| Files | PascalCase for classes/components (`WebGL2Renderer.ts`), camelCase for utilities (`mathUtils.ts`) |
| Type-only exports | use `export type` | `export type { Renderer } from './Renderer'` |

### 5.3 Path alias

- `@/` maps to `src/` (configured in `tsconfig.app.json` and
  `vite.config.ts`). Prefer `@/lib/logger` over relative paths like
  `../../lib/logger` for application source.
- **Engine source (`src/engine/`) must use relative imports**, not `@/`.
  The engine is mirrored to `packages/engine/src/` for standalone
  publishing; the `@/` alias does not exist there. The
  `scripts/rewrite-engine-imports.cjs` script rewrites the single
  `@/lib/logger` import to a package-local `./logger.ts` during sync.

### 5.4 Logging

- Use `createLogger(module)` from `lib/logger.ts`. Example:
  ```ts
  import { createLogger } from '@/lib/logger';
  const log = createLogger('Renderer');
  log.info('renderer initialized');
  ```
- **Hot paths** (`render()`, `world.update()`) must aggregate logs — every
  120 frames, not every frame.
- UI log pushes are throttled to 500 ms.
- The engine package exposes its own `setLoggerSink` / `setMinLevel` so
  hosts can redirect engine logs without depending on the application
  logger.
- Never log secrets, credentials, or user-supplied file paths verbatim.

### 5.5 i18n

- All user-visible strings must go through i18next keys
  (`src/i18n/locales/{en,zh}.json`). Both `en` and `zh` must be updated
  in the same PR.
- `scripts/check-i18n-keys.cjs` audits key coverage at build time.
- Engine log messages are i18n-free (stable strings) — the engine has no
  i18next dependency.

### 5.6 Comments

- Comments are for *why*, not *what*. The code already says *what*.
- JSDoc on **public** engine API is encouraged but not required. The
  engine's public surface is documented in
  [`packages/engine/API.md`](./packages/engine/API.md).
- Do not add comments to code you did not change. Do not add boilerplate
  section-header comments.
- Non-obvious invariant comments (e.g. "versioned invalidation: bump
  geometry.version to trigger VAO re-upload") are valuable — keep them.

### 5.7 Error handling

- Throw typed errors. `new Error('...')` is acceptable; prefer custom
  subclasses (`VreenFormatError`, etc.) for format / SDK code.
- Do not catch errors silently. If you swallow an error, log it with
  context.
- Engine code: avoid try/catch in hot paths (render, update). Use it for
  I/O (loaders, format parsing).
- React components: wrap risky subtrees in error boundaries rather than
  try/catch in render.

### 5.8 No over-engineering

- Only make changes directly required by the task. Do not refactor
  surrounding code, add "improvements" beyond scope, or introduce
  abstractions for one-time operations.
- Do not add comments, docstrings, or type annotations to code you did
  not change.
- Do not add error handling for scenarios that cannot happen. Trust
  internal code and framework guarantees.

---

## 6. Commit Message Format

VREEN follows [Conventional Commits](https://www.conventionalcommits.org/).

### Format

```
<type>(<scope>): <subject>

<body? optional, wrap at 72 chars>

<footer? optional>
```

### Types

| Type | Use for |
|------|---------|
| `feat` | A new feature. |
| `fix` | A bug fix. |
| `docs` | Documentation only changes. |
| `style` | Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc.). |
| `refactor` | A code change that neither fixes a bug nor adds a feature. |
| `perf` | A code change that improves performance. |
| `test` | Adding missing or correcting existing tests. |
| `build` | Changes that affect the build system or external dependencies. |
| `ci` | Changes to CI configuration files and scripts. |
| `chore` | Other changes that don't modify src or test files. |
| `revert` | Reverting a previous commit. |

### Scopes (optional but encouraged)

| Scope | Covers |
|-------|--------|
| `engine` | `src/engine/` and `packages/engine/` |
| `renderer` | `src/engine/Renderer/` |
| `ecs` | `src/engine/ECS/` |
| `physics` | `src/engine/Physics/` + `PhysicsSystems.ts` |
| `animation` | `src/engine/Animation/` |
| `loaders` | `src/engine/Loaders/` |
| `math` | `src/engine/Math/` |
| `viewer` | `src/components/viewer/` |
| `blockly` | `src/lib/vreenBlockly.ts`, `src/lib/ecsScriptApi.ts`, `BlocklyPanel.tsx` |
| `vreen` | `.vreen` format, CLI, SDKs |
| `ui` | `src/components/`, `src/pages/`, `src/stores/` |
| `i18n` | `src/i18n/` |
| `build` | Build scripts, Vite / TypeScript config |
| `ci` | `.github/workflows/`, Husky |
| `electron` | `electron/` |
| `docs` | Top-level docs (`README.md`, `ARCHITECTURE.md`, etc.) |

### Subject

- Imperative, present tense: "add" not "added" / "adds".
- Lowercase, no trailing period.
- ≤ 72 characters.

### Body

- Wrap at 72 characters.
- Explain *why* the change is needed, not *what* changed (the diff
  already says *what*).
- Optional — omit for trivial changes.

### Examples

```
feat(renderer): add InstancedMesh support in main pass

Extends WebGL2Renderer to detect InstancedMesh nodes and dispatch
gl.drawElementsInstanced instead of gl.drawElements. Per-instance
matrices are uploaded as a mat4 attribute array. See ROADMAP §2.2.2.
```

```
fix(hdr-loader): decode per-channel RLE for mixed-encoding scanlines

The previous packed-RGBE decoder broke on scanlines where R, G, B, E
have different RLE encodings (common in production .hdr files).
Rewrite the decoder to read each channel independently.
```

```
docs(architecture): add render pipeline sequence diagram
```

```
test(math): add Quaternion slerp edge-case coverage
```

---

## 7. Testing Requirements

### 7.1 Framework

VREEN uses **Vitest 4** with the Vite-shared config (zero extra
configuration) and `@vitest/coverage-v8` for coverage. Tests live
alongside source files as `*.test.ts` and are picked up automatically by
Vitest's default glob.

```bash
npm run test              # single run
npm run test:watch        # watch mode
npm run test:coverage     # coverage report
```

### 7.2 What to test

| Change type | Test requirement |
|-------------|------------------|
| Math library (`src/engine/Math/`) | Unit tests for every public method, including edge cases (zero vectors, identity matrices, singular matrices, Gimbal-adjacent Eulers). |
| ECS core (`World`, `ComponentType`, `QueryBuilder`, `Prefab`) | Lifecycle tests (`createEntity` / `destroyEntity`), `setComponent` / `getComponent` / `removeComponent`, `query()` correctness, `toJSON` / `loadJSON` round-trip. |
| Loaders (`GLBLoader`, `HDRLoader`, `FBXLoader`, `KTX2Loader`, `AssetManager`) | Construct minimal known-good binary fixtures, verify parsing does not throw and produces expected structures. |
| Animation (`AnimationClip`, `AnimationMixer`, `AnimationStateMachine`, `BlendSpace1D`) | Playback / pause / seek / time-scale, state transitions, event callbacks. |
| Physics (`PhysicsSystem`, `CollisionSystem`, `ParticleSystem`) | Overlap detection, impulse-response direction correctness, particle advance. |
| Renderer (`WebGL2Renderer`, `RenderPass`) | Headless mock-GL tests for the `Renderer` interface contract; `RenderPass` composition correctness. |
| `.vreen` tooling (`vreenPack`, `vreenPublish`, `vreenValidate`) | Round-trip tests (pack → unpack → compare). |
| UI components | Not currently unit-tested; manual verification via `npm run dev` is acceptable. (Adding component tests is welcome.) |

### 7.3 Coverage expectations

There is no hard coverage threshold, but PRs that *reduce* coverage on
the engine kernel (`src/engine/`) or `.vreen` tooling (`src/lib/vreen*.ts`)
will be asked to add tests. New public API on the engine *must* ship
with at least one test case.

### 7.4 Test style

- One `describe` block per class or per cohesive feature.
- Test names are sentences: `'returns the cross product'`,
  not `'crossProduct'` or `'test1'`.
- Avoid shared mutable state across tests. Use `beforeEach` to reset.
- For binary fixtures, prefer small hand-constructed buffers over
  committed binary files. If a binary file is unavoidable, document its
  provenance in a comment.

### 7.5 Running tests locally

CI runs `npm run typecheck`, `npm run build`, and `npm test` on every
push and PR. A failed step blocks merge. Run all three locally before
pushing:

```bash
npm run typecheck ; npm run build ; npm test
```

---

## 8. Pull Request Review Criteria

A PR will be merged once all of the following are true:

### 8.1 Required

- [ ] CI is green (`typecheck`, `build`, `test`).
- [ ] PR description explains *why* the change is needed and links to a
      relevant issue (if any).
- [ ] The change is scoped to one concern.
- [ ] New public API has tests.
- [ ] New user-visible strings are added to both `en.json` and `zh.json`.
- [ ] Engine changes use relative imports only (no `@/`).
- [ ] No `console.log` / `debugger` left in committed code (use
      `createLogger` instead).
- [ ] No secrets, credentials, or user-supplied file paths in logs.
- [ ] No commented-out code blocks.
- [ ] Documentation updated if behavior changed ("docs as code"
      principle — see §11).

### 8.2 Strongly preferred

- [ ] Commit messages follow Conventional Commits (§6).
- [ ] Branch is rebased onto latest `main`.
- [ ] No unrelated whitespace / formatting churn.
- [ ] Performance-sensitive paths (renderer, ECS update loop) include a
      note in the PR description if they could regress frame time.
- [ ] Breaking changes are flagged with `BREAKING CHANGE:` in the commit
      footer and called out in the PR description.

### 8.3 Review turnaround

VREEN is solo-maintained with an irregular cadence. Expect review within
**1–7 days**; ping politely after 7 days if there is no response. Do not
self-merge without review.

### 8.4 What reviewers look for

1. **Correctness.** Does the change do what it claims? Are edge cases
   handled? Are invariants (documented in source) preserved?
2. **Architecture fit.** Does the change respect the layered
   architecture (§4 of `ARCHITECTURE.md`)? Engine code must not import
   React / Zustand / i18next.
3. **Testability.** Is the change tested? If not, why not?
4. **Performance.** Does the change introduce per-frame allocations,
   O(n²) hot loops, or unnecessary GPU traffic?
5. **API stability.** Does the change break existing public API? If so,
   is the breakage justified and documented?
6. **Documentation.** Does the change require a doc update? Is the doc
   update included?

---

## 9. Issue Reporting Guide

### 9.1 Before filing

1. Search existing issues to avoid duplicates.
2. Check [`ROADMAP.md` § "Known Issues"](./ROADMAP.md) and
   [`README.md` § "Known Issues"](./README.md#known-issues).
3. Try to reproduce on the latest `main` branch.

### 9.2 Bug reports

Use the bug report template (or include the following if no template is
available):

```markdown
**Describe the bug**
A clear one-paragraph description.

**To reproduce**
1. Run `npm run dev`
2. Open `/viewer`
3. Upload `model.glb`
4. Toggle `PHYSICS`
5. See error

**Expected behavior**
What you expected to happen.

**Actual behavior**
What actually happened. Include the exact error message and stack trace
from the browser console / terminal.

**Environment**
- VREEN version: `git rev-parse HEAD` or release tag
- Browser: e.g. Chrome 126 on Windows 11
- GPU: e.g. NVIDIA RTX 3060 (helpful for WebGL bugs)
- Node version: `node --version`

**Reproduction assets**
Attach the smallest `.glb` / `.hdr` / `.vreen` file that triggers the
bug. If the asset is private, describe its structure (vertex count,
animation clip count, material setup).
```

### 9.3 Feature requests

```markdown
**Problem**
What problem does this feature solve? Who has this problem?

**Proposed solution**
A concrete description of what you want VREEN to do.

**Alternatives considered**
What workarounds exist today? Why are they insufficient?

**Roadmap fit**
Does this map to a Phase in ROADMAP.md? If not, should it?
```

### 9.4 Good first issues

Issues labeled `good first issue` are scoped to be approachable for new
contributors. If you claim one, comment on the issue so others don't
duplicate work. If you abandon it, comment to release the claim.

---

## 10. Engine Package Contributions

The engine has a dual life:

```
src/engine/                    # source of truth (in the web app)
   │
   │ npm run engine:sync
   ▼
packages/engine/src/           # mirrored copy (for standalone publishing)
   │
   │ npm run engine:build
   ▼
packages/engine/dist/          # bundled ESM + .d.ts
```

### Rules

1. **Edit `src/engine/`, never `packages/engine/src/`.** The latter is
   generated by `scripts/sync-engine-package.mjs` and will be
   overwritten.
2. **Engine code must use relative imports.** The `@/` alias does not
   exist in `packages/engine/`. The single exception is
   `@/lib/logger`, which `scripts/rewrite-engine-imports.cjs` rewrites
   to a package-local `./logger.ts` during sync.
3. **Engine code must not import React, Zustand, i18next, or any
   application module.** The engine package has zero runtime
   dependencies (Draco is an optional peer).
4. **After editing the engine, run:**
   ```bash
   npm run engine:sync         # mirror to packages/engine/src/
   npm run engine:typecheck    # verify the package still compiles
   npm run engine:build        # verify the bundle still builds
   ```
5. **Public API changes** (anything re-exported from
   `src/engine/index.ts`) must be reflected in
   [`packages/engine/API.md`](./packages/engine/API.md) and called out
   in the PR description.
6. **Tests live in `src/engine/`** (e.g. `World.test.ts`). They are
   mirrored along with the source. The engine package does not run tests
   in isolation — the web app's `npm test` covers them.

---

## 11. Documentation Contributions

VREEN follows a **docs-as-code** principle: if you change behavior, you
update the docs in the same PR.

### Documentation map

| Document | Covers |
|----------|--------|
| [`README.md`](./README.md) | Project overview, quick start, full module reference, deployment. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System architecture, subsystem deep-dives, design decisions. |
| [`ROADMAP.md`](./ROADMAP.md) | Phased plan, tech-debt list, performance audit. |
| [`CONTRIBUTING.md`](./CONTRIBUTING.md) | This document. |
| [`docs/format/vreen-format-spec.md`](./docs/format/vreen-format-spec.md) | Authoritative `.vreen` format specification. |
| [`docs/vreen-api-tutorial.md`](./docs/vreen-api-tutorial.md) | `.vreen` SDK tutorial. |
| [`packages/engine/README.md`](./packages/engine/README.md) | `@vreen/engine` package usage and API. |
| [`packages/engine/API.md`](./packages/engine/API.md) | Per-class / per-function signatures. |
| [`packages/<sdk>/README.md`](./packages/) | Per-SDK readmes (Unity, Unreal, Kotlin, etc.). |

### Style

- **English** is the primary language for `ARCHITECTURE.md`,
  `CONTRIBUTING.md`, `ROADMAP.md`, and the engine package docs. Key
  technical terms may include a Chinese gloss in parentheses where it
  aids clarity for the project's primary audience.
- **Markdown:** GFM. Hard-wrap prose at ~100 characters where it
  improves diff readability; tables and code blocks may exceed this.
- **Code references** use `file_path:line_number` so reviewers can jump
  to the source: e.g. `see src/engine/Renderer/Renderer.ts:30`.
- **No emojis** in committed documentation unless the surrounding
  document already uses them. (`ROADMAP.md` uses a few for visual
  scan-ability — preserve that style when editing it.)
- Do not create new top-level documentation files without prior
  agreement. Prefer extending an existing doc.

---

## 12. Licensing

VREEN is released under the [MIT License](./LICENSE). By contributing,
you agree that your contributions will be licensed under the same terms.

VREEN does **not** use a Contributor License Agreement (CLA) or require
Developer Certificate of Origin (DCO) sign-off. Your commit authorship
is preserved by Git itself.

### Third-party code

If you bring in code from another project:

1. Check the source license is MIT-compatible (MIT, BSD, Apache 2.0,
   ISC, etc.).
2. Preserve the original copyright notice and license text in the file
   header or in `THIRD_PARTY_LICENSES.md` (create it if needed).
3. Note the provenance in your commit message: `"Includes code from
   three.js examples (MIT)."`

GPL / LGPL / proprietary code is **not** acceptable.

---

> Thanks again for contributing to VREEN. If anything in this document
> is unclear or incorrect, please open an issue or PR.
