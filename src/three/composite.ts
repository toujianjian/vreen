// composite — 组合生成器 (M3)。
//
// 设计:把现有 6 个 archetype 的部件抽象成「part function」,
// composite 通过 `body / top / accent` 三个 slot 选择部件来源,
// 拼装出一个新的混合模型。
//
// 部件库是自包含的简化版(直接拿现有生成器的核心 mesh 重新实现),
// 不去侵入 src/three/generators.ts 的现有 6 个 build 函数。
// 这样可以独立演进,旧 API 保持稳定。

import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  StandardMaterial,
  TorusGeometry,
} from '@/engine';
import type { ParamSchema, ParamFieldDef } from './generators';

// ── palette(与 generators.ts 保持一致) ─────────────────────────
const CYAN = '#00f0ff';
const MAGENTA = '#ff2bd6';
const AMBER = '#ffb648';
const DARK = '#0e1320';
const STEEL = '#3a455a';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}

function mat(color: string, opts: { metallic?: number; roughness?: number; emissive?: boolean; emissiveIntensity?: number } = {}): StandardMaterial {
  const m = new StandardMaterial();
  m.baseColor = hexToRgb(color);
  m.metallic = opts.metallic ?? 0.6;
  m.roughness = opts.roughness ?? 0.4;
  if (opts.emissive) {
    m.emissive = hexToRgb(color);
    m.emissiveIntensity = opts.emissiveIntensity ?? 1.5;
  }
  return m;
}

const Emis = (color: string, intensity = 1.5) => mat(color, { metallic: 0.1, roughness: 0.4, emissive: true, emissiveIntensity: intensity });

// ── 部件库:每个 part 返回一个 Group,锚点在部件几何中心偏底部(便于垂直拼接) ──

/** 0 = skip this slot */
export type SlotChoice = 'mech' | 'creature' | 'tree' | 'totem' | 'ship' | 'crystal' | 'none';

export type BodyChoice = Extract<SlotChoice, 'mech' | 'creature' | 'tree' | 'totem' | 'ship' | 'crystal'>;
export type TopChoice = SlotChoice;       // 允许 'none'
export type AccentChoice = Extract<SlotChoice, 'mech' | 'crystal' | 'tree' | 'creature' | 'totem' | 'ship' | 'none'>;

interface PartBuildOpts {
  /** 当前总高度(底部到 body 顶),让 accent 能贴到正确位置 */
  bodyTopY: number;
  /** 整体缩放 */
  scale: number;
  /** 自发光强度倍率 */
  emissive: number;
}

// ── BODY slot 部件(主干,撑起整个模型) ─────────────────────────
function buildBodyMech(): Group {
  const g = new Group(); g.name = 'body_mech';
  const torso = new Mesh(new BoxGeometry(0.9, 1.1, 0.55), mat(STEEL, { metallic: 0.85, roughness: 0.32 }));
  torso.position.y = 0.55;
  g.add(torso);
  const chest = new Mesh(new BoxGeometry(0.75, 0.6, 0.08), mat(DARK, { metallic: 0.5, roughness: 0.5 }));
  chest.position.set(0, 0.7, 0.28);
  g.add(chest);
  // legs
  for (const sx of [-0.22, 0.22]) {
    const thigh = new Mesh(new CylinderGeometry(0.13, 0.16, 0.55, 12), mat(DARK, { metallic: 0.7, roughness: 0.4 }));
    thigh.position.set(sx, -0.55, 0);
    g.add(thigh);
    const shin = new Mesh(new CylinderGeometry(0.1, 0.14, 0.55, 12), mat(STEEL, { metallic: 0.85, roughness: 0.3 }));
    shin.position.set(sx, -1.05, 0);
    g.add(shin);
    const foot = new Mesh(new BoxGeometry(0.25, 0.1, 0.4), mat(DARK, { metallic: 0.6, roughness: 0.4 }));
    foot.position.set(sx, -1.35, 0.05);
    g.add(foot);
  }
  return g;
}

function buildBodyCreature(): Group {
  const g = new Group(); g.name = 'body_creature';
  const body = new Mesh(new SphereGeometry(0.55, 16, 12), mat('#7a1a1a', { metallic: 0.4, roughness: 0.6 }));
  body.scale.set(1.4, 0.8, 0.9);
  body.position.y = 0;
  g.add(body);
  for (const p of [[0.45, -0.55, 0.3], [0.45, -0.55, -0.3], [-0.45, -0.55, 0.3], [-0.45, -0.55, -0.3]] as [number, number, number][]) {
    const leg = new Mesh(new CylinderGeometry(0.07, 0.09, 0.4, 8), mat('#3a0a0a', { metallic: 0.3, roughness: 0.7 }));
    leg.position.set(p[0], p[1], p[2]);
    g.add(leg);
  }
  return g;
}

function buildBodyTree(): Group {
  const g = new Group(); g.name = 'body_tree';
  const trunk = new Mesh(new CylinderGeometry(0.15, 0.25, 1.2, 6), mat('#3a2a1a', { metallic: 0.1, roughness: 0.95 }));
  trunk.position.y = 0;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const r = 0.85 - i * 0.18;
    const c = new Mesh(new ConeGeometry(r, 0.7, 6), mat('#1a4a3a', { metallic: 0.05, roughness: 0.85 }));
    c.position.y = 0.6 + i * 0.45;
    g.add(c);
  }
  return g;
}

function buildBodyTotem(): Group {
  const g = new Group(); g.name = 'body_totem';
  const segH = 0.6;
  for (let i = 0; i < 3; i++) {
    const isBox = i % 2 === 0;
    const w = 0.7 - i * 0.05;
    const m = isBox
      ? new Mesh(new BoxGeometry(w, segH, w), mat('#0e0e1a', { metallic: 0.5, roughness: 0.5 }))
      : new Mesh(new CylinderGeometry(w * 0.6, w * 0.65, segH, 6), mat('#101020', { metallic: 0.5, roughness: 0.5 }));
    m.position.y = i * segH + segH / 2;
    g.add(m);
  }
  return g;
}

function buildBodyShip(): Group {
  const g = new Group(); g.name = 'body_ship';
  const hull = new Mesh(new ConeGeometry(0.45, 2.2, 12), mat(STEEL, { metallic: 0.9, roughness: 0.25 }));
  hull.rotation.setFromEuler(Math.PI / 2, 0, 0);
  hull.position.y = 0.5;
  g.add(hull);
  // 水平机翼
  for (const sx of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(0.95, 0.05, 0.6), mat(STEEL, { metallic: 0.85, roughness: 0.3 }));
    wing.position.set(sx * 0.55, 0.2, 0);
    g.add(wing);
  }
  return g;
}

function buildBodyCrystal(): Group {
  const g = new Group(); g.name = 'body_crystal';
  const base = new Mesh(new CylinderGeometry(0.7, 0.85, 0.3, 8), mat('#2a2030', { metallic: 0.2, roughness: 0.9 }));
  base.position.y = -0.55;
  g.add(base);
  // 一根中心高 shard 当 body
  const shard = new Mesh(new ConeGeometry(0.32, 1.4, 6, 1), Emis(CYAN, 0.4));
  shard.position.y = 0.2;
  g.add(shard);
  return g;
}

// ── TOP slot 部件(头/顶) ─────────────────────────────────────
function buildTopMech(opts: PartBuildOpts): Group {
  const g = new Group(); g.name = 'top_mech';
  const head = new Mesh(new BoxGeometry(0.45, 0.25, 0.35), mat(DARK, { metallic: 0.6, roughness: 0.4 }));
  head.position.y = opts.bodyTopY + 0.13;
  g.add(head);
  const eye = new Mesh(new BoxGeometry(0.3, 0.04, 0.04), Emis(MAGENTA, opts.emissive));
  eye.position.set(0, opts.bodyTopY + 0.15, 0.2);
  g.add(eye);
  return g;
}

function buildTopCreature(opts: PartBuildOpts): Group {
  const g = new Group(); g.name = 'top_creature';
  const head = new Mesh(new ConeGeometry(0.25, 0.55, 8), mat('#7a1a1a', { metallic: 0.4, roughness: 0.6 }));
  head.rotation.setFromEuler(0, 0, -Math.PI / 2);
  head.position.set(0.85, opts.bodyTopY + 0.1, 0);
  g.add(head);
  const eye1 = new Mesh(new BoxGeometry(0.06, 0.06, 0.06), Emis(AMBER, opts.emissive));
  eye1.position.set(0.95, opts.bodyTopY + 0.18, 0.12);
  g.add(eye1);
  const eye2 = new Mesh(new BoxGeometry(0.06, 0.06, 0.06), Emis(AMBER, opts.emissive));
  eye2.position.set(0.95, opts.bodyTopY + 0.18, -0.12);
  g.add(eye2);
  return g;
}

function buildTopCrystal(opts: PartBuildOpts): Group {
  const g = new Group(); g.name = 'top_crystal';
  const shard = new Mesh(new ConeGeometry(0.18, 0.9, 6, 1), Emis(CYAN, opts.emissive));
  shard.position.y = opts.bodyTopY + 0.45;
  g.add(shard);
  return g;
}

function buildTopTree(opts: PartBuildOpts): Group {
  const g = new Group(); g.name = 'top_tree';
  const cap = new Mesh(new ConeGeometry(0.45, 0.6, 6), mat('#1a4a3a', { metallic: 0.05, roughness: 0.85 }));
  cap.position.y = opts.bodyTopY + 0.3;
  g.add(cap);
  return g;
}

function buildTopTotem(opts: PartBuildOpts): Group {
  const g = new Group(); g.name = 'top_totem';
  const crown = new Mesh(new ConeGeometry(0.3, 0.4, 4), mat('#1a1a2a', { metallic: 0.7, roughness: 0.3 }));
  crown.position.y = opts.bodyTopY + 0.2;
  g.add(crown);
  return g;
}

// ── ACCENT slot 部件(装饰,贴到 body 周边) ─────────────────────
function buildAccentMech(opts: PartBuildOpts): Group {
  const g = new Group(); g.name = 'accent_mech';
  const accent = new Mesh(new BoxGeometry(0.2, 0.2, 0.04), Emis(CYAN, opts.emissive));
  accent.position.set(0, opts.bodyTopY * 0.5, 0.32);
  g.add(accent);
  return g;
}

function buildAccentCrystal(opts: PartBuildOpts): Group {
  const g = new Group(); g.name = 'accent_crystal';
  // 3 根矮 shard 围绕 body 中部
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const shard = new Mesh(new ConeGeometry(0.12, 0.6, 5, 1), Emis(MAGENTA, opts.emissive));
    shard.position.set(Math.cos(angle) * 0.55, opts.bodyTopY * 0.5, Math.sin(angle) * 0.55);
    shard.rotation.setFromEuler(0.2, angle, 0.1);
    g.add(shard);
  }
  // 一道环
  const ring = new Mesh(new TorusGeometry(0.65, 0.012, 6, 32), Emis(CYAN, opts.emissive * 0.6));
  ring.position.y = opts.bodyTopY * 0.4;
  ring.rotation.setFromEuler(Math.PI / 2, 0, 0);
  g.add(ring);
  return g;
}

function buildAccentTree(opts: PartBuildOpts): Group {
  const g = new Group(); g.name = 'accent_tree';
  const fruitColors = [CYAN, MAGENTA, AMBER, CYAN, MAGENTA];
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const fruit = new Mesh(new SphereGeometry(0.05, 8, 6), Emis(fruitColors[i % fruitColors.length], opts.emissive));
    fruit.position.set(Math.cos(angle) * 0.6, opts.bodyTopY * 0.7, Math.sin(angle) * 0.6);
    g.add(fruit);
  }
  return g;
}

// ── 派发表:slot → part builder ────────────────────────────────
type BodyBuilder = () => Group;
type PartBuilder = (opts: PartBuildOpts) => Group;

const BODY_BUILDERS: Record<BodyChoice, BodyBuilder> = {
  mech: buildBodyMech,
  creature: buildBodyCreature,
  tree: buildBodyTree,
  totem: buildBodyTotem,
  ship: buildBodyShip,
  crystal: buildBodyCrystal,
};

const TOP_BUILDERS: Record<Exclude<TopChoice, 'none'>, PartBuilder> = {
  mech: buildTopMech,
  creature: buildTopCreature,
  crystal: buildTopCrystal,
  tree: buildTopTree,
  totem: buildTopTotem,
  ship: () => new Group(), // ship 没有 top
};

const ACCENT_BUILDERS: Record<Exclude<AccentChoice, 'none'>, PartBuilder> = {
  mech: buildAccentMech,
  crystal: buildAccentCrystal,
  tree: buildAccentTree,
  creature: () => new Group(),
  totem: () => new Group(),
  ship: () => new Group(),
};

// ── composite 主入口 ─────────────────────────────────────────
export interface CompositeParams {
  /** 主干部件来源 */
  body: BodyChoice;
  /** 头顶部件(可 'none') */
  top: TopChoice;
  /** 装饰部件(可 'none') */
  accent: AccentChoice;
  /** 整体缩放 0.6..1.6 */
  scale: number;
  /** 自发光强度倍率 0..3 */
  emissiveStrength: number;
}

export const DEFAULT_COMPOSITE: Readonly<CompositeParams> = {
  body: 'mech',
  top: 'mech',
  accent: 'crystal',
  scale: 1.0,
  emissiveStrength: 1.0,
};

// ── schema (M2 UI 消费) ────────────────────────────────────────
const BODY_OPTIONS = ['mech', 'creature', 'tree', 'totem', 'ship', 'crystal'] as const;
const TOP_OPTIONS = ['mech', 'creature', 'tree', 'totem', 'ship', 'crystal', 'none'] as const;
const ACCENT_OPTIONS = ['mech', 'crystal', 'tree', 'none'] as const;

export const COMPOSITE_SCHEMA: ParamSchema = {
  body: {
    type: 'select', label: 'Body', options: BODY_OPTIONS,
    default: DEFAULT_COMPOSITE.body, group: 'body',
  },
  top: {
    type: 'select', label: 'Top', options: TOP_OPTIONS,
    default: DEFAULT_COMPOSITE.top, group: 'body',
  },
  accent: {
    type: 'select', label: 'Accent', options: ACCENT_OPTIONS,
    default: DEFAULT_COMPOSITE.accent, group: 'accent',
  },
  scale: {
    type: 'number', label: 'Scale', min: 0.6, max: 1.6, step: 0.05,
    default: DEFAULT_COMPOSITE.scale, group: 'detail',
  },
  emissiveStrength: {
    type: 'number', label: 'Emissive', min: 0, max: 3, step: 0.1,
    default: DEFAULT_COMPOSITE.emissiveStrength, group: 'accent',
  },
};

export function buildComposite(p?: Partial<CompositeParams>): Group {
  const params = { ...DEFAULT_COMPOSITE, ...p };
  const g = new Group();
  g.name = 'COMPOSITE';

  // 1. body
  const body = BODY_BUILDERS[params.body]();
  body.name = `body_${params.body}`;
  g.add(body);
  // 估算 body 顶 Y(基于 body 部件本身的局部坐标系)
  // body builders 已经把 y=0 放在「站立地面」位置,顶端 Y 近似 = 部件自身最大 y。
  // 简单近似:取 body builder 已知的「半高」,具体由 builder 自身保证(参见各 buildXxx)。
  const bodyTopY = estimateBodyTopY(params.body, params.scale);

  // 2. top
  if (params.top !== 'none' && TOP_BUILDERS[params.top]) {
    const top = TOP_BUILDERS[params.top]({
      bodyTopY,
      scale: params.scale,
      emissive: params.emissiveStrength,
    });
    g.add(top);
  }

  // 3. accent
  if (params.accent !== 'none' && ACCENT_BUILDERS[params.accent]) {
    const accent = ACCENT_BUILDERS[params.accent]({
      bodyTopY,
      scale: params.scale,
      emissive: params.emissiveStrength,
    });
    g.add(accent);
  }

  // 4. 整体缩放
  g.scale.x = g.scale.y = g.scale.z = params.scale;

  return g;
}

/** 估算 body builder 顶端在世界坐标(缩放后)的 Y。
 *  这是一个保守近似:如果 body 顶比 top builder 假设的低,top 部件会浮在 body 内部;
 *  但因为 top 部件是装饰性的,稍微重叠反而自然。 */
function estimateBodyTopY(body: BodyChoice, _scale: number): number {
  switch (body) {
    case 'mech': return 1.1;       // torso 顶(腿往下)
    case 'creature': return 0.55;  // body sphere 顶
    case 'tree': return 1.95;      // trunk + 3 canopy
    case 'totem': return 1.8;      // 3 segments stacked
    case 'ship': return 1.2;       // 船身 + 翼
    case 'crystal': return 0.9;    // shard 中部
  }
}
