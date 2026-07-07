// Procedural generators for the 6 VREEN preset archetypes.
// Each generator returns a `Group` (our engine's, not three.js) that
// contains a fully self-contained model. Geometry is built from
// primitive shapes — no external assets required.
//
// Engine: @/engine (WebGL2, no three.js runtime).

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

/** 1) MECH-WALKER: Bipedal chassis */
export function buildMech(): Group {
  const g = new Group();
  g.name = 'MECH_WALKER';

  const torso = new Mesh(new BoxGeometry(0.9, 1.1, 0.55), makeStandard(STEEL, { metallic: 0.85, roughness: 0.32 }));
  torso.position.y = 1.1;
  g.add(torso);

  const chest = new Mesh(new BoxGeometry(0.75, 0.6, 0.08), makeStandard(DARK, { metallic: 0.5, roughness: 0.5 }));
  chest.position.set(0, 1.2, 0.28);
  g.add(chest);

  addEmissiveAccent(g, [0.2, 0.2, 0.04], [0, 1.2, 0.32], CYAN, 3);

  for (const sx of [-0.55, 0.55]) {
    const sh = new Mesh(new SphereGeometry(0.22, 16, 12), makeStandard(STEEL, { metallic: 0.9, roughness: 0.2 }));
    sh.position.set(sx, 1.45, 0);
    g.add(sh);
    const arm = new Mesh(new CylinderGeometry(0.08, 0.08, 0.7, 12), makeStandard(DARK, { metallic: 0.7, roughness: 0.4 }));
    arm.position.set(sx, 1.05, 0);
    g.add(arm);
    const fa = new Mesh(new CylinderGeometry(0.1, 0.13, 0.55, 12), makeStandard(STEEL, { metallic: 0.85, roughness: 0.3 }));
    fa.position.set(sx, 0.55, 0);
    g.add(fa);
    const hand = new Mesh(new BoxGeometry(0.18, 0.18, 0.25), makeStandard(DARK, { metallic: 0.6, roughness: 0.4 }));
    hand.position.set(sx, 0.25, 0);
    g.add(hand);
  }

  const hip = new Mesh(new BoxGeometry(0.8, 0.2, 0.5), makeStandard(STEEL, { metallic: 0.8, roughness: 0.35 }));
  hip.position.y = 0.55;
  g.add(hip);

  for (const sx of [-0.22, 0.22]) {
    const thigh = new Mesh(new CylinderGeometry(0.13, 0.16, 0.55, 12), makeStandard(DARK, { metallic: 0.7, roughness: 0.4 }));
    thigh.position.set(sx, 0.18, 0);
    g.add(thigh);
    const shin = new Mesh(new CylinderGeometry(0.1, 0.14, 0.55, 12), makeStandard(STEEL, { metallic: 0.85, roughness: 0.3 }));
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
  addEmissiveAccent(g, [0.05, 0.05, 0.05], [0.15, 2.35, -0.05], CYAN, 5);

  const bp = new Mesh(new BoxGeometry(0.6, 0.7, 0.25), makeStandard(STEEL, { metallic: 0.85, roughness: 0.3 }));
  bp.position.set(0, 1.2, -0.32);
  g.add(bp);

  return g;
}

/** 2) CRYSTAL: Cluster of refractive-looking shards */
export function buildCrystal(): Group {
  const g = new Group();
  g.name = 'CRYSTAL';

  const base = new Mesh(new CylinderGeometry(0.7, 0.85, 0.3, 8), makeStandard('#2a2030', { metallic: 0.2, roughness: 0.9 }));
  base.position.y = 0.15;
  g.add(base);

  const shards: { h: number; r: number; pos: [number, number, number]; rot: [number, number, number]; color: string }[] = [
    { h: 1.4, r: 0.32, pos: [0, 0.9, 0], rot: [0, 0, 0], color: CYAN },
    { h: 1.0, r: 0.24, pos: [0.45, 0.7, 0.1], rot: [0, 0, 0.4], color: MAGENTA },
    { h: 0.85, r: 0.22, pos: [-0.4, 0.55, -0.05], rot: [0, 0, -0.3], color: CYAN },
    { h: 0.7, r: 0.18, pos: [0.15, 0.45, 0.45], rot: [0.2, 0.1, 0.1], color: AMBER },
    { h: 0.55, r: 0.15, pos: [-0.25, 0.4, -0.35], rot: [-0.15, -0.05, -0.2], color: MAGENTA },
  ];

  for (const s of shards) {
    const geo = new ConeGeometry(s.r, s.h, 6, 1);
    const mat = makeEmissive(s.color, 0.4);
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

/** 3) TREE: Stylized low-poly bio-luminescent tree */
export function buildTree(): Group {
  const g = new Group();
  g.name = 'LUMEN_TREE';

  const trunk = new Mesh(new CylinderGeometry(0.15, 0.25, 1.2, 6), makeStandard('#3a2a1a', { metallic: 0.1, roughness: 0.95 }));
  trunk.position.y = 0.6;
  g.add(trunk);

  for (let i = 0; i < 3; i++) {
    const r = 0.85 - i * 0.18;
    const h = 0.7;
    const c = new Mesh(new ConeGeometry(r, h, 6), makeStandard('#1a4a3a', { metallic: 0.05, roughness: 0.85 }));
    c.position.y = 1.2 + i * 0.45;
    g.add(c);
  }

  const fruitColors = [CYAN, MAGENTA, AMBER, CYAN, MAGENTA];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const radius = 0.55 + (i % 2) * 0.15;
    const y = 1.3 + (i % 3) * 0.4;
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

/** 4) SCOUT-SHIP: Atmospheric reconnaissance craft */
export function buildShip(): Group {
  const g = new Group();
  g.name = 'ARROW_3';

  const hull = new Mesh(new ConeGeometry(0.45, 2.2, 12), makeStandard(STEEL, { metallic: 0.9, roughness: 0.25 }));
  hull.rotation.setFromEuler(Math.PI / 2, 0, 0);
  hull.position.z = 0;
  g.add(hull);

  const cockpit = new Mesh(new SphereGeometry(0.22, 12, 8), makeStandard('#001a22', { metallic: 0.0, roughness: 0.05 }));
  cockpit.position.set(0, 0.18, -0.5);
  g.add(cockpit);

  for (const sx of [-1, 1]) {
    const wing = new Mesh(new BoxGeometry(0.95, 0.05, 0.6), makeStandard(STEEL, { metallic: 0.85, roughness: 0.3 }));
    wing.position.set(sx * 0.55, 0, -0.1);
    g.add(wing);
    const tip = new Mesh(new ConeGeometry(0.07, 0.5, 6), makeStandard(STEEL, { metallic: 0.9, roughness: 0.2 }));
    tip.position.set(sx * 1.0, 0, -0.1);
    tip.rotation.setFromEuler(0, 0, sx * Math.PI / 2);
    g.add(tip);
    addEmissiveAccent(g, [0.12, 0.12, 0.12], [sx * 0.55, 0, 0.45], CYAN, 5);
  }

  const fin = new Mesh(new BoxGeometry(0.05, 0.45, 0.35), makeStandard(STEEL, { metallic: 0.85, roughness: 0.3 }));
  fin.position.set(0, 0.25, 0.8);
  g.add(fin);

  addEmissiveAccent(g, [0.18, 0.18, 0.18], [0, 0, 1.1], MAGENTA, 6);

  return g;
}

/** 5) CREATURE: Quadrupedal drake */
export function buildCreature(): Group {
  const g = new Group();
  g.name = 'VERMILLION';

  const body = new Mesh(new SphereGeometry(0.55, 16, 12), makeStandard('#7a1a1a', { metallic: 0.4, roughness: 0.6 }));
  body.scale.set(1.4, 0.8, 0.9);
  body.position.y = 0.6;
  g.add(body);

  const head = new Mesh(new ConeGeometry(0.25, 0.55, 8), makeStandard('#7a1a1a', { metallic: 0.4, roughness: 0.6 }));
  head.rotation.setFromEuler(0, 0, -Math.PI / 2);
  head.position.set(0.85, 0.7, 0);
  g.add(head);
  addEmissiveAccent(g, [0.06, 0.06, 0.06], [0.95, 0.78, 0.12], AMBER, 5);
  addEmissiveAccent(g, [0.06, 0.06, 0.06], [0.95, 0.78, -0.12], AMBER, 5);

  for (let i = 0; i < 6; i++) {
    const spike = new Mesh(new ConeGeometry(0.08, 0.25, 6), makeStandard('#3a0a0a', { metallic: 0.3, roughness: 0.7 }));
    const t = i / 5;
    spike.position.set(-0.7 + t * 1.4, 0.95 + Math.sin(t * Math.PI) * 0.15, 0);
    spike.rotation.setFromEuler(0, 0, Math.PI);
    g.add(spike);
  }

  const legPositions: [number, number, number][] = [
    [0.45, 0.2, 0.3], [0.45, 0.2, -0.3], [-0.45, 0.2, 0.3], [-0.45, 0.2, -0.3],
  ];
  for (const p of legPositions) {
    const leg = new Mesh(new CylinderGeometry(0.07, 0.09, 0.4, 8), makeStandard('#3a0a0a', { metallic: 0.3, roughness: 0.7 }));
    leg.position.set(p[0], p[1], p[2]);
    g.add(leg);
  }

  const tail = new Mesh(new ConeGeometry(0.12, 0.7, 8), makeStandard('#7a1a1a', { metallic: 0.4, roughness: 0.6 }));
  tail.rotation.setFromEuler(0, 0, Math.PI / 2);
  tail.position.set(-0.95, 0.55, 0);
  g.add(tail);

  addEmissiveAccent(g, [0.12, 0.12, 0.12], [-1.25, 0.5, 0], AMBER, 4);

  return g;
}

/** 6) TOTEM: Ancient ceremonial relic with glowing glyphs */
export function buildTotem(): Group {
  const g = new Group();
  g.name = 'OBSIDIAN_IDOL';

  const base = new Mesh(new CylinderGeometry(0.6, 0.7, 0.2, 8), makeStandard('#0a0a14', { metallic: 0.4, roughness: 0.5 }));
  base.position.y = 0.1;
  g.add(base);

  const seg1 = new Mesh(new BoxGeometry(0.7, 0.6, 0.7), makeStandard('#0e0e1a', { metallic: 0.5, roughness: 0.5 }));
  seg1.position.y = 0.5;
  g.add(seg1);

  const seg2 = new Mesh(new CylinderGeometry(0.4, 0.45, 0.7, 6), makeStandard('#101020', { metallic: 0.5, roughness: 0.5 }));
  seg2.position.y = 1.15;
  g.add(seg2);

  const seg3 = new Mesh(new BoxGeometry(0.55, 0.55, 0.55), makeStandard('#0e0e1a', { metallic: 0.5, roughness: 0.5 }));
  seg3.position.y = 1.75;
  g.add(seg3);

  const crown = new Mesh(new ConeGeometry(0.3, 0.4, 4), makeStandard('#1a1a2a', { metallic: 0.7, roughness: 0.3 }));
  crown.position.y = 2.2;
  g.add(crown);

  const glyphColors = [CYAN, MAGENTA, AMBER];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const strip = new Mesh(new BoxGeometry(0.04, 0.45, 0.18), makeEmissive(glyphColors[i], 3));
    strip.position.set(Math.cos(angle) * 0.31, 1.15, Math.sin(angle) * 0.31);
    strip.lookAt(0, 1.15, 0);
    g.add(strip);
  }

  addEmissiveAccent(g, [0.08, 0.08, 0.08], [-0.12, 1.78, 0.28], MAGENTA, 5);
  addEmissiveAccent(g, [0.08, 0.08, 0.08], [0.12, 1.78, 0.28], MAGENTA, 5);

  const ring = new Mesh(new TorusGeometry(0.62, 0.015, 6, 32), makeEmissive(AMBER, 2.5));
  ring.position.y = 0.21;
  ring.rotation.setFromEuler(Math.PI / 2, 0, 0);
  g.add(ring);

  return g;
}

export const GENERATORS: Record<string, () => Group> = {
  mech: buildMech,
  crystal: buildCrystal,
  tree: buildTree,
  ship: buildShip,
  creature: buildCreature,
  totem: buildTotem,
};
