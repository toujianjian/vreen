// PhysicsDemo — 一个简单的物理 demo,展示所有 ECS 物理能力。
//
// 启动流程:
//   1) 把 world 接入 PhysicsSystem / CollisionSystem / ParticleSystem
//   2) 创建 ground + 30 随机 box 的堆叠
//   3) 顶部添加一个 ParticleEmitter,持续撒粒子
//
// 真实可视:打开 viewer 即可看到 30 个 box 掉到地面、互相碰撞、最终静止;
// 顶部粒子持续向上飞;控制台打印物理 tick 状态(可选)。

import { World } from '../ECS/World';
import { Transform, TransformC, MeshRefC, MeshRef, TagC, Tag } from '../ECS/Components';
import {
  Rigidbody, RigidbodyC, Collider, ColliderC,
  PhysicsConfig, PhysicsConfigC, PhysicsDebug, PhysicsDebugC,
  ParticleEmitter, ParticleEmitterC,
} from '../ECS/PhysicsComponents';
import { BoxGeometry } from '../Geometries';
import { Mesh } from '../Core/Mesh';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { Scene } from '../Core/Scene';
import { PhysicsSystem, CollisionSystem, ParticleSystem, PhysicsDebugSystem } from '../ECS/PhysicsSystems';
import { createLogger } from '@/lib/logger';

const log = createLogger('PhysicsDemo');

/** 接入所有物理 system 到 world(幂等)。 */
export function installPhysicsSystems(world: World): void {
  const names = new Set<string>();
  for (const s of world.getSystems()) names.add(s.name);
  if (!names.has('PhysicsSystem')) {
    world.addSystem(new PhysicsSystem());
    world.addSystem(new CollisionSystem());
    world.addSystem(new ParticleSystem());
    world.addSystem(new PhysicsDebugSystem());
    log.info('physics systems installed');
  }
}

/** 创建物理配置 entity(全局)。 */
export function createPhysicsConfigEntity(world: World): number {
  const id = world.createEntity();
  world.setComponent(id, PhysicsConfigC, new PhysicsConfig());
  world.setComponent(id, PhysicsDebugC, new PhysicsDebug());
  return id;
}

interface DemoOptions {
  /** 多少 box 落入场景。 */
  boxCount?: number;
  /** 是否启用 debug 渲染(contact line)。 */
  enableDebug?: boolean;
}

/** 创建物理 demo 场景。返回 { world, scene, rootEntity }。 */
export function createPhysicsDemo(
  scene: Scene,
  opts: DemoOptions = {},
): { world: World; rootEntity: number; boxIds: number[]; emitterId: number } {
  const boxCount = opts.boxCount ?? 30;
  const world = new World();
  installPhysicsSystems(world);
  createPhysicsConfigEntity(world);
  // 物理调试开启
  world.queryWith(PhysicsDebugC, (_id, d) => { d.showContacts = true; d.showColliders = false; });

  // 1) Ground (大 box,static)
  const groundMat = new StandardMaterial();
  groundMat.baseColor = { r: 0.18, g: 0.2, b: 0.25 };
  const groundGeom = new BoxGeometry(20, 0.2, 20);
  const groundMesh = new Mesh(groundGeom, groundMat);
  groundMesh.position.set(0, -0.1, 0);
  scene.add(groundMesh);

  const groundId = world.createEntity();
  world.setComponent(groundId, TransformC, Transform.fromPos(0, -0.1, 0));
  world.setComponent(groundId, MeshRefC, new MeshRef(groundMesh));
  world.setComponent(groundId, ColliderC, Object.assign(new Collider(), {
    shape: 'aabb' as const,
    halfExtents: [10, 0.1, 10] as [number, number, number],
    isStatic: true,
    friction: 0.6,
    restitution: 0.05,
  }));
  world.setComponent(groundId, RigidbodyC, Object.assign(new Rigidbody(), { mass: 0 }));
  world.setComponent(groundId, TagC, new Tag('ground'));

  // 2) 随机 box 堆
  const boxIds: number[] = [];
  const colors = [
    [0.9, 0.4, 0.3], [0.3, 0.7, 0.9], [0.9, 0.85, 0.3], [0.5, 0.9, 0.5],
    [0.7, 0.5, 0.9], [0.95, 0.6, 0.4], [0.4, 0.85, 0.85], [0.85, 0.4, 0.85],
  ];
  for (let i = 0; i < boxCount; i++) {
    const w = 0.4 + Math.random() * 0.4;
    const h = 0.4 + Math.random() * 0.4;
    const d = 0.4 + Math.random() * 0.4;
    const x = (Math.random() - 0.5) * 6;
    const z = (Math.random() - 0.5) * 6;
    const y = 3 + Math.random() * 5;
    const col = colors[i % colors.length];
    const mat = new StandardMaterial();
    mat.baseColor = { r: col[0], g: col[1], b: col[2] };
    const geom = new BoxGeometry(w, h, d);
    const mesh = new Mesh(geom, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    const eid = world.createEntity();
    world.setComponent(eid, TransformC, Transform.fromPos(x, y, z));
    world.setComponent(eid, MeshRefC, new MeshRef(mesh));
    world.setComponent(eid, ColliderC, Object.assign(new Collider(), {
      shape: 'aabb' as const,
      halfExtents: [w / 2, h / 2, d / 2] as [number, number, number],
      mass: 1.0,
      friction: 0.4,
      restitution: 0.15,
    }));
    const rb = new Rigidbody();
    rb.mass = 1.0;
    rb.angularVelocity = [
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
      (Math.random() - 0.5) * 2,
    ];
    world.setComponent(eid, RigidbodyC, rb);
    world.setComponent(eid, TagC, new Tag('box'));
    boxIds.push(eid);
  }

  // 3) 顶部粒子发射器(从场景里下落到地面前会 spawn 粒子)
  const emitterId = world.createEntity();
  world.setComponent(emitterId, TransformC, Transform.fromPos(0, 7, 0));
  const em = new ParticleEmitter();
  em.rate = 30;
  em.speedMin = 1.5;
  em.speedMax = 3.0;
  em.lifeMin = 0.8;
  em.lifeMax = 1.5;
  em.maxParticles = 60;
  em.colorA = [1.0, 0.4, 0.2];
  em.colorB = [1.0, 0.9, 0.3];
  em.spawnRadius = 0.2;
  world.setComponent(emitterId, ParticleEmitterC, em);
  world.setComponent(emitterId, TagC, new Tag('emitter'));

  log.info(`physics demo created: ${boxCount} boxes + emitter`);
  return { world, rootEntity: groundId, boxIds, emitterId };
}

/** 把 ECS Transform 同步到 MeshRef.mesh (每帧调用)。 */
export function syncMeshesFromTransforms(world: World): void {
  world.queryWith2(TransformC, MeshRefC, (_id, t, mref) => {
    const m = mref.mesh;
    m.position.x = t.position[0];
    m.position.y = t.position[1];
    m.position.z = t.position[2];
    m.rotation.x = t.rotation[0];
    m.rotation.y = t.rotation[1];
    m.rotation.z = t.rotation[2];
    m.rotation.w = t.rotation[3];
    m.matrixWorldNeedsUpdate = true;
  });
}
