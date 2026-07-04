// Procedural generators for the 6 VREEN preset archetypes.
// Each generator returns a THREE.Group representing a fully self-contained model.
// The geometry uses primitive boxes/cylinders/cones — no external assets required.

import * as THREE from 'three';

const CYAN = '#00f0ff';
const MAGENTA = '#ff2bd6';
const AMBER = '#ffb648';
const DARK = '#0e1320';
const STEEL = '#3a455a';
const BONE = '#c4cad6';

function makeStandard(color: string, opts: Partial<THREE.MeshStandardMaterial> = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: 0.6,
    roughness: 0.4,
    ...opts,
  } as THREE.MeshStandardMaterialParameters);
}

function makeEmissive(color: string, intensity = 1.5) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    metalness: 0.1,
    roughness: 0.4,
  });
}

function addEmissiveAccent(group: THREE.Group, size: [number, number, number], pos: [number, number, number], color: string, intensity = 2) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(size[0], size[1], size[2]),
    makeEmissive(color, intensity),
  );
  m.position.set(pos[0], pos[1], pos[2]);
  m.castShadow = false;
  m.receiveShadow = false;
  group.add(m);
  return m;
}

/** 1) MECH-WALKER: Bipedal chassis */
export function buildMech(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'MECH_WALKER';

  // Torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.55), makeStandard(STEEL, { metalness: 0.85, roughness: 0.32 }));
  torso.position.y = 1.1;
  g.add(torso);

  // Chest plate
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.6, 0.08), makeStandard(DARK, { metalness: 0.5, roughness: 0.5 }));
  chest.position.set(0, 1.2, 0.28);
  g.add(chest);

  // Core reactor (emissive)
  addEmissiveAccent(g, [0.2, 0.2, 0.04], [0, 1.2, 0.32], CYAN, 3);

  // Shoulders
  for (const sx of [-0.55, 0.55]) {
    const sh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), makeStandard(STEEL, { metalness: 0.9, roughness: 0.2 }));
    sh.position.set(sx, 1.45, 0);
    g.add(sh);
    // Arms
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 12), makeStandard(DARK, { metalness: 0.7, roughness: 0.4 }));
    arm.position.set(sx, 1.05, 0);
    g.add(arm);
    // Forearm
    const fa = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.55, 12), makeStandard(STEEL, { metalness: 0.85, roughness: 0.3 }));
    fa.position.set(sx, 0.55, 0);
    g.add(fa);
    // Hand
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.25), makeStandard(DARK, { metalness: 0.6, roughness: 0.4 }));
    hand.position.set(sx, 0.25, 0);
    g.add(hand);
  }

  // Hip
  const hip = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.5), makeStandard(STEEL, { metalness: 0.8, roughness: 0.35 }));
  hip.position.y = 0.55;
  g.add(hip);

  // Legs
  for (const sx of [-0.22, 0.22]) {
    const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.55, 12), makeStandard(DARK, { metalness: 0.7, roughness: 0.4 }));
    thigh.position.set(sx, 0.18, 0);
    g.add(thigh);
    const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.55, 12), makeStandard(STEEL, { metalness: 0.85, roughness: 0.3 }));
    shin.position.set(sx, -0.32, 0);
    g.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.1, 0.4), makeStandard(DARK, { metalness: 0.6, roughness: 0.4 }));
    foot.position.set(sx, -0.62, 0.05);
    g.add(foot);
  }

  // Head / sensor array
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.25, 0.35), makeStandard(DARK, { metalness: 0.6, roughness: 0.4 }));
  head.position.set(0, 1.85, 0.05);
  g.add(head);
  addEmissiveAccent(g, [0.3, 0.04, 0.04], [0, 1.92, 0.22], MAGENTA, 4);

  // Antenna
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.4, 6), makeStandard('#7a8090'));
  ant.position.set(0.15, 2.15, -0.05);
  g.add(ant);
  addEmissiveAccent(g, [0.05, 0.05, 0.05], [0.15, 2.35, -0.05], CYAN, 5);

  // Backpack
  const bp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.7, 0.25), makeStandard(STEEL, { metalness: 0.85, roughness: 0.3 }));
  bp.position.set(0, 1.2, -0.32);
  g.add(bp);

  return g;
}

/** 2) CRYSTAL: Cluster of refractive-looking shards */
export function buildCrystal(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'CRYSTAL';

  // Base rock
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.3, 8), makeStandard('#2a2030', { metalness: 0.2, roughness: 0.9 }));
  base.position.y = 0.15;
  g.add(base);

  // Crystal cluster — 5 angular shards at different scales
  const shards: { h: number; r: number; pos: [number, number, number]; rot: [number, number, number]; color: string }[] = [
    { h: 1.4, r: 0.32, pos: [0, 0.9, 0], rot: [0, 0, 0], color: CYAN },
    { h: 1.0, r: 0.24, pos: [0.45, 0.7, 0.1], rot: [0, 0, 0.4], color: MAGENTA },
    { h: 0.85, r: 0.22, pos: [-0.4, 0.55, -0.05], rot: [0, 0, -0.3], color: CYAN },
    { h: 0.7, r: 0.18, pos: [0.15, 0.45, 0.45], rot: [0.2, 0.1, 0.1], color: AMBER },
    { h: 0.55, r: 0.15, pos: [-0.25, 0.4, -0.35], rot: [-0.15, -0.05, -0.2], color: MAGENTA },
  ];

  for (const s of shards) {
    const geo = new THREE.ConeGeometry(s.r, s.h, 6, 1, false);
    const mat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(s.color),
      metalness: 0.1,
      roughness: 0.05,
      transmission: 0.9,
      thickness: 1.5,
      ior: 1.7,
      attenuationColor: new THREE.Color(s.color),
      attenuationDistance: 0.6,
      emissive: new THREE.Color(s.color),
      emissiveIntensity: 0.4,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(s.pos[0], s.pos[1], s.pos[2]);
    m.rotation.set(s.rot[0], s.rot[1], s.rot[2]);
    g.add(m);
  }

  // Glow ring
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.85, 0.015, 8, 64),
    makeEmissive(CYAN, 3),
  );
  ring.position.y = 0.32;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  return g;
}

/** 3) TREE: Stylized low-poly bio-luminescent tree */
export function buildTree(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'LUMEN_TREE';

  // Trunk
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.25, 1.2, 6), makeStandard('#3a2a1a', { metalness: 0.1, roughness: 0.95 }));
  trunk.position.y = 0.6;
  g.add(trunk);

  // Foliage layers (3 cone shells)
  for (let i = 0; i < 3; i++) {
    const r = 0.85 - i * 0.18;
    const h = 0.7;
    const c = new THREE.Mesh(
      new THREE.ConeGeometry(r, h, 6),
      makeStandard('#1a4a3a', { metalness: 0.05, roughness: 0.85 }),
    );
    c.position.y = 1.2 + i * 0.45;
    g.add(c);
  }

  // Glowing fruits
  const fruitColors = [CYAN, MAGENTA, AMBER, CYAN, MAGENTA];
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const radius = 0.55 + (i % 2) * 0.15;
    const y = 1.3 + (i % 3) * 0.4;
    const fruit = new THREE.Mesh(
      new THREE.SphereGeometry(0.06, 8, 6),
      makeEmissive(fruitColors[i % fruitColors.length], 4),
    );
    fruit.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    g.add(fruit);
  }

  // Roots
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const root = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.08, 0.6, 6), makeStandard('#2a1a0a', { metalness: 0.1, roughness: 0.95 }));
    root.position.set(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3);
    root.rotation.z = Math.cos(a) * 0.6;
    root.rotation.x = Math.sin(a) * 0.6;
    g.add(root);
  }

  return g;
}

/** 4) SCOUT-SHIP: Atmospheric reconnaissance craft */
export function buildShip(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'ARROW_3';

  // Hull
  const hull = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 2.2, 12),
    makeStandard(STEEL, { metalness: 0.9, roughness: 0.25 }),
  );
  hull.rotation.x = Math.PI / 2;
  hull.position.z = 0;
  g.add(hull);

  // Cockpit dome
  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#001a22'),
      metalness: 0.0,
      roughness: 0.05,
      transmission: 0.7,
      ior: 1.5,
      thickness: 0.3,
    }),
  );
  cockpit.position.set(0, 0.18, -0.5);
  g.add(cockpit);

  // Wings
  for (const sx of [-1, 1]) {
    const wing = new THREE.Mesh(
      new THREE.BoxGeometry(0.95, 0.05, 0.6),
      makeStandard(STEEL, { metalness: 0.85, roughness: 0.3 }),
    );
    wing.position.set(sx * 0.55, 0, -0.1);
    g.add(wing);
    // Wing tip
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.5, 6), makeStandard(STEEL, { metalness: 0.9, roughness: 0.2 }));
    tip.position.set(sx * 1.0, 0, -0.1);
    tip.rotation.z = sx * Math.PI / 2;
    g.add(tip);
    // Engine glow
    addEmissiveAccent(g, [0.12, 0.12, 0.12], [sx * 0.55, 0, 0.45], CYAN, 5);
  }

  // Tail fin
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.45, 0.35), makeStandard(STEEL, { metalness: 0.85, roughness: 0.3 }));
  fin.position.set(0, 0.25, 0.8);
  g.add(fin);

  // Rear thruster
  addEmissiveAccent(g, [0.18, 0.18, 0.18], [0, 0, 1.1], MAGENTA, 6);

  return g;
}

/** 5) CREATURE: Quadrupedal drake */
export function buildCreature(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'VERMILLION';

  // Body
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), makeStandard('#7a1a1a', { metalness: 0.4, roughness: 0.6 }));
  body.scale.set(1.4, 0.8, 0.9);
  body.position.y = 0.6;
  g.add(body);

  // Head
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.55, 8), makeStandard('#7a1a1a', { metalness: 0.4, roughness: 0.6 }));
  head.rotation.z = -Math.PI / 2;
  head.position.set(0.85, 0.7, 0);
  g.add(head);
  // Eyes
  addEmissiveAccent(g, [0.06, 0.06, 0.06], [0.95, 0.78, 0.12], AMBER, 5);
  addEmissiveAccent(g, [0.06, 0.06, 0.06], [0.95, 0.78, -0.12], AMBER, 5);

  // Spikes along spine
  for (let i = 0; i < 6; i++) {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.25, 6), makeStandard('#3a0a0a', { metalness: 0.3, roughness: 0.7 }));
    const t = i / 5;
    spike.position.set(-0.7 + t * 1.4, 0.95 + Math.sin(t * Math.PI) * 0.15, 0);
    spike.rotation.z = Math.PI;
    g.add(spike);
  }

  // Legs
  const legPositions: [number, number, number][] = [
    [0.45, 0.2, 0.3], [0.45, 0.2, -0.3], [-0.45, 0.2, 0.3], [-0.45, 0.2, -0.3],
  ];
  for (const p of legPositions) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), makeStandard('#3a0a0a', { metalness: 0.3, roughness: 0.7 }));
    leg.position.set(p[0], p[1], p[2]);
    g.add(leg);
  }

  // Tail
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.7, 8), makeStandard('#7a1a1a', { metalness: 0.4, roughness: 0.6 }));
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-0.95, 0.55, 0);
  g.add(tail);

  // Tail tip flame (emissive)
  addEmissiveAccent(g, [0.12, 0.12, 0.12], [-1.25, 0.5, 0], AMBER, 4);

  return g;
}

/** 6) TOTEM: Ancient ceremonial relic with glowing glyphs */
export function buildTotem(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'OBSIDIAN_IDOL';

  // Base
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.2, 8), makeStandard('#0a0a14', { metalness: 0.4, roughness: 0.5 }));
  base.position.y = 0.1;
  g.add(base);

  // Bottom segment
  const seg1 = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), makeStandard('#0e0e1a', { metalness: 0.5, roughness: 0.5 }));
  seg1.position.y = 0.5;
  g.add(seg1);

  // Middle segment
  const seg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.45, 0.7, 6), makeStandard('#101020', { metalness: 0.5, roughness: 0.5 }));
  seg2.position.y = 1.15;
  g.add(seg2);

  // Top segment
  const seg3 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), makeStandard('#0e0e1a', { metalness: 0.5, roughness: 0.5 }));
  seg3.position.y = 1.75;
  g.add(seg3);

  // Crown
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.4, 4), makeStandard('#1a1a2a', { metalness: 0.7, roughness: 0.3 }));
  crown.position.y = 2.2;
  g.add(crown);

  // Glyph channels (emissive strips)
  const glyphColors = [CYAN, MAGENTA, AMBER];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.45, 0.18),
      makeEmissive(glyphColors[i], 3),
    );
    strip.position.set(Math.cos(angle) * 0.31, 1.15, Math.sin(angle) * 0.31);
    strip.lookAt(0, 1.15, 0);
    g.add(strip);
  }

  // Eye sockets
  addEmissiveAccent(g, [0.08, 0.08, 0.08], [-0.12, 1.78, 0.28], MAGENTA, 5);
  addEmissiveAccent(g, [0.08, 0.08, 0.08], [0.12, 1.78, 0.28], MAGENTA, 5);

  // Base glyph ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.015, 6, 32), makeEmissive(AMBER, 2.5));
  ring.position.y = 0.21;
  ring.rotation.x = Math.PI / 2;
  g.add(ring);

  return g;
}

export const GENERATORS: Record<string, () => THREE.Group> = {
  mech: buildMech,
  crystal: buildCrystal,
  tree: buildTree,
  ship: buildShip,
  creature: buildCreature,
  totem: buildTotem,
};
