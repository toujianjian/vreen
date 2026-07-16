// Procedural generators for the 6 VREEN preset archetypes.
// Each generator returns a `Group` (our engine's, not three.js) that
// contains a fully self-contained model. Geometry is built from
// primitive shapes — no external assets required.
//
// Engine: @/engine (WebGL2, no three.js runtime).
//
// ── 参数化 (M1) ────────────────────────────────────────────────
// 每个 buildXxx 接受 `Partial<Params>`,缺省走 DEFAULT_XXX,保证与
// 旧版 (无参调用) 视觉完全一致。配套 SCHEMA 给 M2 的 UI 渲染控件。

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
import {
  buildComposite,
  DEFAULT_COMPOSITE,
  COMPOSITE_SCHEMA,
  type CompositeParams,
} from './composite';

const CYAN = '#00f0ff';
const MAGENTA = '#ff2bd6';
const AMBER = '#ffb648';
const DARK = '#0e1320';
const STEEL = '#3a455a';
const BONE = '#c4cad6';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3
    ? h.split('').map((c) => c + c).join('')
    : h, 16);
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255 };
}

function makeStandard(color: string, opts: Partial<{
  metallic: number;
  roughness: number;
  emissive: { r: number; g: number; b: number };
  emissiveIntensity: number;
}> = {}): StandardMaterial {
  const m = new StandardMaterial();
  m.baseColor = hexToRgb(color);
  m.metallic = opts.metallic ?? 0.6;
  m.roughness = opts.roughness ?? 0.4;
  if (opts.emissive) m.emissive = opts.emissive;
  if (opts.emissiveIntensity !== undefined) m.emissiveIntensity = opts.emissiveIntensity;
  return m;
}

function makeEmissive(color: string, intensity = 1.5): StandardMaterial {
  const rgb = hexToRgb(color);
  return makeStandard(color, {
    metallic: 0.1,
    roughness: 0.4,
    emissive: rgb,
    emissiveIntensity: intensity,
  });
}

function addEmissiveAccent(
  group: Group,
  size: [number, number, number],
  pos: [number, number, number],
  color: string,
  intensity = 2,
): Mesh {
  const m = new Mesh(new BoxGeometry(size[0], size[1], size[2]), makeEmissive(color, intensity));
  m.position.set(pos[0], pos[1], pos[2]);
  m.castShadow = false;
  m.receiveShadow = false;
  group.add(m);
  return m;
}

/** 把 Partial<Params> 与默认合并,只补缺,不覆盖显式 undefined 之外的字段。 */
export function applyDefaults<T>(
  params: Partial<T> | undefined,
  defaults: Readonly<T>,
): T {
  const out = { ...defaults } as T;
  if (params) {
    for (const k of Object.keys(params) as (keyof T)[]) {
      const v = params[k];
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

// ── 参数 schema (M2 UI 消费) ─────────────────────────────────────
/** 单个参数描述。type 决定 UI 渲染的控件类型。 */
export interface ParamFieldDef {
  type: 'number' | 'color' | 'select';
  label: string;
  /** 折叠分组标签(同组的参数会一起展示)。 */
  group: 'body' | 'palette' | 'accent' | 'detail';
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
  default: number | string;
}

export type ParamSchema = Readonly<Record<string, ParamFieldDef>>;

/** 6 个 archetype + composite(组合) 的名字字面量。 */
export type GeneratorName = 'mech' | 'crystal' | 'tree' | 'ship' | 'creature' | 'totem' | 'composite';

/** 通用类型:每个 generator 的入口签名(参数可选,默认走 DEFAULT)。 */
export type BuildFn = (params?: Record<string, unknown>) => Group;

// ════════════════════════════════════════════════════════════════
// 1) MECH-WALKER
// ════════════════════════════════════════════════════════════════
export interface MechParams {
  /** 躯干高度 (米)。 */
  torsoHeight: number;
  /** 单段腿长 (米) — 决定整体身高。 */
  legLength: number;
  /** 单段手臂长 (米)。 */
  armLength: number;
  /** 主金属度 0..1。 */
  metallic: number;
  /** 主色 (hex)。 */
  primaryColor: string;
  /** 胸前/触角 emissive 强调色 (hex)。 */
  accentColor: string;
}

export const DEFAULT_MECH: Readonly<MechParams> = {
  torsoHeight: 1.1,
  legLength: 0.55,
  armLength: 0.7,
  metallic: 0.85,
  primaryColor: STEEL,
  accentColor: CYAN,
};

export const MECH_SCHEMA: ParamSchema = {
  torsoHeight: { type: 'number', label: 'Torso H', min: 0.6, max: 1.8, step: 0.05, default: DEFAULT_MECH.torsoHeight, group: 'body' },
  legLength:   { type: 'number', label: 'Leg L',   min: 0.3, max: 1.0, step: 0.05, default: DEFAULT_MECH.legLength,   group: 'body' },
  armLength:   { type: 'number', label: 'Arm L',   min: 0.3, max: 1.2, step: 0.05, default: DEFAULT_MECH.armLength,   group: 'body' },
  metallic:    { type: 'number', label: 'Metallic', min: 0,   max: 1,   step: 0.05, default: DEFAULT_MECH.metallic,    group: 'detail' },
  primaryColor:{ type: 'color',  label: 'Primary',                                   default: DEFAULT_MECH.primaryColor, group: 'palette' },
  accentColor: { type: 'color',  label: 'Accent',                                    default: DEFAULT_MECH.accentColor,  group: 'palette' },
};

export function buildMech(p?: Partial<MechParams>): Group {
  const params = applyDefaults(p, DEFAULT_MECH);
  const { torsoHeight, legLength, armLength, metallic, primaryColor, accentColor } = params;
  const g = new Group();
  g.name = 'MECH_WALKER';

  const torso = new Mesh(new BoxGeometry(0.9, torsoHeight, 0.55), makeStandard(primaryColor, { metallic, roughness: 0.32 }));
  torso.position.y = 1.1;
  g.add(torso);

  const chest = new Mesh(new BoxGeometry(0.75, 0.6, 0.08), makeStandard(DARK, { metallic: 0.5, roughness: 0.5 }));
  chest.position.set(0, 1.2, 0.28);
  g.add(chest);

  addEmissiveAccent(g, [0.2, 0.2, 0.04], [0, 1.2, 0.32], accentColor, 3);

  for (const sx of [-0.55, 0.55]) {
    const sh = new Mesh(new SphereGeometry(0.22, 16, 12), makeStandard(primaryColor, { metallic, roughness: 0.2 }));
    sh.position.set(sx, 1.45, 0);
    g.add(sh);
    const arm = new Mesh(new CylinderGeometry(0.08, 0.08, armLength, 12), makeStandard(DARK, { metallic: 0.7, roughness: 0.4 }));
    arm.position.set(sx, 1.05, 0);
    g.add(arm);
    const fa = new Mesh(new CylinderGeometry(0.1, 0.13, armLength * 0.78, 12), makeStandard(primaryColor, { metallic, roughness: 0.3 }));
    fa.position.set(sx, 0.55, 0);
    g.add(fa);
    const hand = new Mesh(new BoxGeometry(0.18, 0.18, 0.25), makeStandard(DARK, { metallic: 0.6, roughness: 0.4 }));
    hand.position.set(sx, 0.25, 0);
    g.add(hand);
  }

  const hip = new Mesh(new BoxGeometry(0.8, 0.2, 0.5), makeStandard(primaryColor, { metallic, roughness: 0.35 }));
  hip.position.y = 0.55;
  g.add(hip);

  for (const sx of [-0.22, 0.22]) {
    const thigh = new Mesh(new CylinderGeometry(0.13, 0.16, legLength, 12), makeStandard(DARK, { metallic: 0.7, roughness: 0.4 }));
    thigh.position.set(sx, 0.18, 0);
    g.add(thigh);
    const shin = new Mesh(new CylinderGeometry(0.1, 0.14, legLength, 12), makeStandard(primaryColor, { metallic, roughness: 0.3 }));
    shin.position.set(sx, -0.32, 0);
    g.add(shin);
    const foot = new Mesh(new BoxGeometry(0.25, 0.1, 0.4), makeStandard(DARK, { metallic: 0.6, roughness: 0.4 }));
    foot.position.set(sx, -0.62, 0.05);
    g.add(foot);
  }

  const head = new Mesh(new BoxGeometry(0.45, 0.25, 0.35), makeStandard(DARK, { metallic: 0.6, roughness: 0.4 }));
  head.position.set(0, 1.85, 0.05);
  g.add(head);
  addEmissiveAccent(g, [0.3, 0.04, 0.04], [0, 1.92, 0.22], MAGENTA, 4);

  const ant = new Mesh(new CylinderGeometry(0.015, 0.015, 0.4, 6), makeStandard('#7a8090'));
  ant.position.set(0.15, 2.15, -0.05);
  g.add(ant);
  addEmissiveAccent(g, [0.05, 0.05, 0.05], [0.15, 2.35, -0.05], accentColor, 5);

  const bp = new Mesh(new BoxGeometry(0.6, 0.7, 0.25), makeStandard(primaryColor, { metallic, roughness: 0.3 }));
  bp.position.set(0, 1.2, -0.32);
  g.add(bp);

  return g;
}

// ════════════════════════════════════════════════════════════════
// 2) CRYSTAL
// ════════════════════════════════════════════════════════════════
export interface CrystalParams {
  /** 顶部 shard 数量 (含中轴,不含基座)。 */
  shardCount: number;
  /** shard 缩放倍率 0.5..1.6。 */
  shardScale: number;
  /** shard 自发光强度 0..3。 */
  emissiveIntensity: number;
  /** 0/1/2 三个色相对应 cyan/magenta/amber 的索引。 */
  hueIndex: number;
}

export const DEFAULT_CRYSTAL: Readonly<CrystalParams> = {
  shardCount: 5,
  shardScale: 1.0,
  emissiveIntensity: 0.4,
  hueIndex: 0,
};

const CRYSTAL_PALETTE = [CYAN, MAGENTA, AMBER] as const;

export const CRYSTAL_SCHEMA: ParamSchema = {
  shardCount:        { type: 'number', label: 'Shard Count', min: 2, max: 8, step: 1, default: DEFAULT_CRYSTAL.shardCount, group: 'body' },
  shardScale:        { type: 'number', label: 'Shard Scale', min: 0.5, max: 1.6, step: 0.05, default: DEFAULT_CRYSTAL.shardScale, group: 'body' },
  emissiveIntensity: { type: 'number', label: 'Emissive', min: 0, max: 3, step: 0.1, default: DEFAULT_CRYSTAL.emissiveIntensity, group: 'accent' },
  hueIndex:          { type: 'select', label: 'Hue', options: CRYSTAL_PALETTE, default: DEFAULT_CRYSTAL.hueIndex, group: 'palette' },
};

export function buildCrystal(p?: Partial<CrystalParams>): Group {
  const params = applyDefaults(p, DEFAULT_CRYSTAL);
  const { shardCount, shardScale, emissiveIntensity, hueIndex } = params;
  const g = new Group();
  g.name = 'CRYSTAL';

  const base = new Mesh(new CylinderGeometry(0.7, 0.85, 0.3, 8), makeStandard('#2a2030', { metallic: 0.2, roughness: 0.9 }));
  base.position.y = 0.15;
  g.add(base);

  // 程序化生成 shard:中心高柱 + 周围按角度散布
  const shards: { h: number; r: number; pos: [number, number, number]; rot: [number, number, number]; color: string }[] = [];
  // 中心高柱
  shards.push({ h: 1.4 * shardScale, r: 0.32 * shardScale, pos: [0, 0.9, 0], rot: [0, 0, 0], color: CRYSTAL_PALETTE[hueIndex] });
  // 周围 (shardCount - 1) 根,按螺旋角度
  for (let i = 1; i < shardCount; i++) {
    const t = i / Math.max(1, shardCount - 1);
    const angle = t * Math.PI * 2;
    const radius = 0.45 * shardScale;
    const h = (0.5 + (1 - t) * 0.5) * shardScale;
    const r = (0.15 + (1 - t) * 0.1) * shardScale;
    shards.push({
      h, r,
      pos: [Math.cos(angle) * radius, 0.5 + (1 - t) * 0.4, Math.sin(angle) * radius],
      rot: [Math.sin(angle) * 0.2, Math.cos(angle) * 0.15, angle * 0.2],
      // 偶数索引=主色,奇数=magenta
      color: i % 2 === 0 ? CRYSTAL_PALETTE[hueIndex] : MAGENTA,
    });
  }

  for (const s of shards) {
    const geo = new ConeGeometry(s.r, s.h, 6, 1);
    const mat = makeEmissive(s.color, emissiveIntensity);
    mat.metallic = 0.1;
    mat.roughness = 0.05;
    const m = new Mesh(geo, mat);
    m.position.set(s.pos[0], s.pos[1], s.pos[2]);
    m.rotation.setFromEuler(s.rot[0], s.rot[1], s.rot[2]);
    g.add(m);
  }

  const ring = new Mesh(new TorusGeometry(0.85, 0.015, 8, 64), makeEmissive(CYAN, 3));
  ring.position.y = 0.32;
  ring.rotation.setFromEuler(Math.PI / 2, 0, 0);
  g.add(ring);

  return g;
}

// ════════════════════════════════════════════════════════════════
// 3) TREE
// ════════════════════════════════════════════════════════════════
export interface TreeParams {
  /** 主干高度 0.6..2.0。 */
  trunkHeight: number;
  /** 树冠层数 2..5。 */
  layerCount: number;
  /** 生物发光果数量 0..30。 */
  fruitCount: number;
}

export const DEFAULT_TREE: Readonly<TreeParams> = {
  trunkHeight: 1.2,
  layerCount: 3,
  fruitCount: 10,
};

export const TREE_SCHEMA: ParamSchema = {
  trunkHeight: { type: 'number', label: 'Trunk H', min: 0.6, max: 2.0, step: 0.05, default: DEFAULT_TREE.trunkHeight, group: 'body' },
  layerCount:  { type: 'number', label: 'Layers',   min: 2,   max: 5,   step: 1,    default: DEFAULT_TREE.layerCount,  group: 'body' },
  fruitCount:  { type: 'number', label: 'Fruits',   min: 0,   max: 30,  step: 1,    default: DEFAULT_TREE.fruitCount,  group: 'detail' },
};

export function buildTree(p?: Partial<TreeParams>): Group {
  const params = applyDefaults(p, DEFAULT_TREE);
  const { trunkHeight, layerCount, fruitCount } = params;
  const g = new Group();
  g.name = 'LUMEN_TREE';

  const trunk = new Mesh(new CylinderGeometry(0.15, 0.25, trunkHeight, 6), makeStandard('#3a2a1a', { metallic: 0.1, roughness: 0.95 }));
  trunk.position.y = trunkHeight / 2;
  g.add(trunk);

  for (let i = 0; i < layerCount; i++) {
    const r = 0.85 - i * 0.18;
    const h = 0.7;
    const c = new Mesh(new ConeGeometry(r, h, 6), makeStandard('#1a4a3a', { metallic: 0.05, roughness: 0.85 }));
    c.position.y = trunkHeight + i * 0.45;
    g.add(c);
  }

  const fruitColors = [CYAN, MAGENTA, AMBER, CYAN, MAGENTA];
  for (let i = 0; i < fruitCount; i++) {
    const angle = (i / Math.max(1, fruitCount)) * Math.PI * 2;
    const radius = 0.55 + (i % 2) * 0.15;
    const y = trunkHeight + 0.1 + (i % 3) * 0.4;
    const fruit = new Mesh(new SphereGeometry(0.06, 8, 6), makeEmissive(fruitColors[i % fruitColors.length], 4));
    fruit.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    g.add(fruit);
  }

  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const root = new Mesh(new CylinderGeometry(0.04, 0.08, 0.6, 6), makeStandard('#2a1a0a', { metallic: 0.1, roughness: 0.95 }));
    root.position.set(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3);
    root.rotation.setFromEuler(Math.sin(a) * 0.6, 0, Math.cos(a) * 0.6);
    g.add(root);
  }

  return g;
}

// ════════════════════════════════════════════════════════════════
// 4) SCOUT-SHIP
// ════════════════════════════════════════════════════════════════
export interface ShipParams {
  /** 船体长度 1.0..3.0。 */
  hullLength: number;
  /** 单侧机翼长度 0.5..1.5。 */
  wingSpan: number;
  /** 尾喷/翼尖 emissive 强度 0..10。 */
  accentGlow: number;
}

export const DEFAULT_SHIP: Readonly<ShipParams> = {
  hullLength: 2.2,
  wingSpan: 0.95,
  accentGlow: 5,
};

export const SHIP_SCHEMA: ParamSchema = {
  hullLength: { type: 'number', label: 'Hull L', min: 1.0, max: 3.0, step: 0.05, default: DEFAULT_SHIP.hullLength, group: 'body' },
  wingSpan:   { type: 'number', label: 'Wing L', min: 0.5, max: 1.5, step: 0.05, default: DEFAULT_SHIP.wingSpan,   group: 'body' },
  accentGlow: { type: 'number', label: 'Glow',   min: 0,   max: 10,  step: 0.5,  default: DEFAULT_SHIP.accentGlow, group: 'accent' },
};

export function buildShip(p?: Partial<ShipParams>): Group {
  const params = applyDefaults(p, DEFAULT_SHIP);
  const { hullLength, wingSpan, accentGlow } = params;
  const g = new Group();
  g.name = 'ARROW_3';

  const hull = new Mesh(new ConeGeometry(0.45, hullLength, 12), makeStandard(STEEL, { metallic: 0.9, roughness: 0.25 }));
  hull.rotation.setFromEuler(Math.PI / 2, 0, 0);
  hull.position.z = 0;
  g.add(hull);

  const cockpit = new Mesh(new SphereGeometry(0.22, 12, 8), makeStandard('#001a22', { metallic: 0.0, roughness: 0.05 }));
  cockpit.position.set(0, 0.18, -hullLength * 0.23);
  g.add(cockpit);

  for (const sx of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(wingSpan, 0.05, 0.6), makeStandard(STEEL, { metallic: 0.85, roughness: 0.3 }));
    wing.position.set(sx * 0.55, 0, -0.1);
    g.add(wing);
    const tip = new Mesh(new ConeGeometry(0.07, 0.5, 6), makeStandard(STEEL, { metallic: 0.9, roughness: 0.2 }));
    tip.position.set(sx * (0.55 + wingSpan * 0.5), 0, -0.1);
    tip.rotation.setFromEuler(0, 0, sx * Math.PI / 2);
    g.add(tip);
    addEmissiveAccent(g, [0.12, 0.12, 0.12], [sx * 0.55, 0, 0.45], CYAN, accentGlow);
  }

  const fin = new Mesh(new BoxGeometry(0.05, 0.45, 0.35), makeStandard(STEEL, { metallic: 0.85, roughness: 0.3 }));
  fin.position.set(0, 0.25, hullLength * 0.36);
  g.add(fin);

  addEmissiveAccent(g, [0.18, 0.18, 0.18], [0, 0, hullLength * 0.5], MAGENTA, accentGlow * 1.2);

  return g;
}

// ════════════════════════════════════════════════════════════════
// 5) CREATURE
// ════════════════════════════════════════════════════════════════
export interface CreatureParams {
  /** 身体长度倍率 0.5..1.6。 */
  bodyLength: number;
  /** 脊刺数量 0..12。 */
  spikeCount: number;
  /** 眼/尾尖 emissive 强度 0..8。 */
  eyeGlow: number;
}

export const DEFAULT_CREATURE: Readonly<CreatureParams> = {
  bodyLength: 1.0,
  spikeCount: 6,
  eyeGlow: 5,
};

export const CREATURE_SCHEMA: ParamSchema = {
  bodyLength: { type: 'number', label: 'Body L', min: 0.5, max: 1.6, step: 0.05, default: DEFAULT_CREATURE.bodyLength, group: 'body' },
  spikeCount: { type: 'number', label: 'Spikes', min: 0,   max: 12,  step: 1,    default: DEFAULT_CREATURE.spikeCount, group: 'detail' },
  eyeGlow:    { type: 'number', label: 'Eye Glow', min: 0,  max: 8,   step: 0.5,  default: DEFAULT_CREATURE.eyeGlow,    group: 'accent' },
};

export function buildCreature(p?: Partial<CreatureParams>): Group {
  const params = applyDefaults(p, DEFAULT_CREATURE);
  const { bodyLength, spikeCount, eyeGlow } = params;
  const g = new Group();
  g.name = 'VERMILLION';

  const body = new Mesh(new SphereGeometry(0.55, 16, 12), makeStandard('#7a1a1a', { metallic: 0.4, roughness: 0.6 }));
  body.scale.set(1.4 * bodyLength, 0.8, 0.9);
  body.position.y = 0.6;
  g.add(body);

  const head = new Mesh(new ConeGeometry(0.25, 0.55, 8), makeStandard('#7a1a1a', { metallic: 0.4, roughness: 0.6 }));
  head.rotation.setFromEuler(0, 0, -Math.PI / 2);
  head.position.set(0.85 * bodyLength, 0.7, 0);
  g.add(head);
  addEmissiveAccent(g, [0.06, 0.06, 0.06], [0.95 * bodyLength, 0.78, 0.12], AMBER, eyeGlow);
  addEmissiveAccent(g, [0.06, 0.06, 0.06], [0.95 * bodyLength, 0.78, -0.12], AMBER, eyeGlow);

  for (let i = 0; i < spikeCount; i++) {
    const spike = new Mesh(new ConeGeometry(0.08, 0.25, 6), makeStandard('#3a0a0a', { metallic: 0.3, roughness: 0.7 }));
    const t = spikeCount > 1 ? i / (spikeCount - 1) : 0.5;
    spike.position.set(-0.7 * bodyLength + t * 1.4 * bodyLength, 0.95 + Math.sin(t * Math.PI) * 0.15, 0);
    spike.rotation.setFromEuler(0, 0, Math.PI);
    g.add(spike);
  }

  const legPositions: [number, number, number][] = [
    [0.45 * bodyLength, 0.2, 0.3], [0.45 * bodyLength, 0.2, -0.3],
    [-0.45 * bodyLength, 0.2, 0.3], [-0.45 * bodyLength, 0.2, -0.3],
  ];
  for (const p of legPositions) {
    const leg = new Mesh(new CylinderGeometry(0.07, 0.09, 0.4, 8), makeStandard('#3a0a0a', { metallic: 0.3, roughness: 0.7 }));
    leg.position.set(p[0], p[1], p[2]);
    g.add(leg);
  }

  const tail = new Mesh(new ConeGeometry(0.12, 0.7, 8), makeStandard('#7a1a1a', { metallic: 0.4, roughness: 0.6 }));
  tail.rotation.setFromEuler(0, 0, Math.PI / 2);
  tail.position.set(-0.95 * bodyLength, 0.55, 0);
  g.add(tail);

  addEmissiveAccent(g, [0.12, 0.12, 0.12], [-1.25 * bodyLength, 0.5, 0], AMBER, eyeGlow * 0.8);

  return g;
}

// ════════════════════════════════════════════════════════════════
// 6) TOTEM
// ════════════════════════════════════════════════════════════════
export interface TotemParams {
  /** 主干段数 2..5。 */
  segments: number;
  /** 整体高度倍率 0.6..1.6。 */
  height: number;
  /** glyph 强调色索引 0/1/2 → cyan/magenta/amber。 */
  glyphHue: number;
}

export const DEFAULT_TOTEM: Readonly<TotemParams> = {
  segments: 3,
  height: 1.0,
  glyphHue: 0,
};

const TOTEM_PALETTE = [CYAN, MAGENTA, AMBER] as const;

export const TOTEM_SCHEMA: ParamSchema = {
  segments: { type: 'number', label: 'Segments', min: 2, max: 5, step: 1, default: DEFAULT_TOTEM.segments, group: 'body' },
  height:   { type: 'number', label: 'Height',   min: 0.6, max: 1.6, step: 0.05, default: DEFAULT_TOTEM.height, group: 'body' },
  glyphHue: { type: 'select', label: 'Glyph', options: TOTEM_PALETTE, default: DEFAULT_TOTEM.glyphHue, group: 'palette' },
};

export function buildTotem(p?: Partial<TotemParams>): Group {
  const params = applyDefaults(p, DEFAULT_TOTEM);
  const { segments, height, glyphHue } = params;
  const g = new Group();
  g.name = 'OBSIDIAN_IDOL';

  const base = new Mesh(new CylinderGeometry(0.6, 0.7, 0.2 * height, 8), makeStandard('#0a0a14', { metallic: 0.4, roughness: 0.5 }));
  base.position.y = 0.1 * height;
  g.add(base);

  // 把段高按总高均分,保持视觉比例;0.4 是最简版里原始 0.6+0.7+0.55+0.4 的近似
  const totalSegmentHeight = 1.85 * height;
  const segH = totalSegmentHeight / segments;
  let yCursor = 0.2 * height;
  for (let i = 0; i < segments; i++) {
    const isBox = i % 2 === 0;
    const w = 0.7 - i * 0.05;
    const m = isBox
      ? new Mesh(new BoxGeometry(w, segH, w), makeStandard('#0e0e1a', { metallic: 0.5, roughness: 0.5 }))
      : new Mesh(new CylinderGeometry(w * 0.6, w * 0.65, segH, 6), makeStandard('#101020', { metallic: 0.5, roughness: 0.5 }));
    m.position.y = yCursor + segH / 2;
    g.add(m);
    yCursor += segH;
  }

  const crown = new Mesh(new ConeGeometry(0.3, 0.4 * height, 4), makeStandard('#1a1a2a', { metallic: 0.7, roughness: 0.3 }));
  crown.position.y = yCursor + 0.2 * height;
  g.add(crown);

  // glyph 在中段贴三条带
  const glyphMidY = yCursor - segH / 2;
  const glyphColor = TOTEM_PALETTE[glyphHue];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const strip = new Mesh(new BoxGeometry(0.04, 0.45 * height, 0.18), makeEmissive(glyphColor, 3));
    strip.position.set(Math.cos(angle) * 0.31, glyphMidY, Math.sin(angle) * 0.31);
    strip.lookAt(0, glyphMidY, 0);
    g.add(strip);
  }

  // 眼部 emissive 与选中色保持一致
  addEmissiveAccent(g, [0.08, 0.08, 0.08], [-0.12, glyphMidY + 0.1, 0.28], glyphColor, 5);
  addEmissiveAccent(g, [0.08, 0.08, 0.08], [0.12, glyphMidY + 0.1, 0.28], glyphColor, 5);

  const ring = new Mesh(new TorusGeometry(0.62, 0.015, 6, 32), makeEmissive(AMBER, 2.5));
  ring.position.y = 0.21 * height;
  ring.rotation.setFromEuler(Math.PI / 2, 0, 0);
  g.add(ring);

  return g;
}

// ════════════════════════════════════════════════════════════════
// 派发表 + schema 索引
// ════════════════════════════════════════════════════════════════
export const GENERATORS: Readonly<Record<GeneratorName, BuildFn>> = {
  mech: (p) => buildMech(p as Partial<MechParams> | undefined),
  crystal: (p) => buildCrystal(p as Partial<CrystalParams> | undefined),
  tree: (p) => buildTree(p as Partial<TreeParams> | undefined),
  ship: (p) => buildShip(p as Partial<ShipParams> | undefined),
  creature: (p) => buildCreature(p as Partial<CreatureParams> | undefined),
  totem: (p) => buildTotem(p as Partial<TotemParams> | undefined),
  composite: (p) => buildComposite(p as Partial<CompositeParams> | undefined),
};

/** 单个 generator 的 (DEFAULT_PARAMS, SCHEMA) 元组,给 M2 UI 用。 */
export interface GeneratorMeta {
  default: Readonly<Record<string, unknown>>;
  schema: ParamSchema;
}

export const GENERATOR_META: Readonly<Record<GeneratorName, GeneratorMeta>> = {
  mech:     { default: DEFAULT_MECH,     schema: MECH_SCHEMA },
  crystal:  { default: DEFAULT_CRYSTAL,  schema: CRYSTAL_SCHEMA },
  tree:     { default: DEFAULT_TREE,     schema: TREE_SCHEMA },
  ship:     { default: DEFAULT_SHIP,     schema: SHIP_SCHEMA },
  creature: { default: DEFAULT_CREATURE, schema: CREATURE_SCHEMA },
  totem:    { default: DEFAULT_TOTEM,    schema: TOTEM_SCHEMA },
  composite:{ default: DEFAULT_COMPOSITE, schema: COMPOSITE_SCHEMA },
};
