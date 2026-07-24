import { describe, it, expect } from 'vitest';
import { World } from './World';
import { Transform, TransformC } from './Components';
import {
  Rigidbody, RigidbodyC,
  Collider, ColliderC,
  Particle, ParticleC,
  ParticleEmitter, ParticleEmitterC,
  PhysicsConfig, PhysicsConfigC,
} from './PhysicsComponents';
import {
  PhysicsSystem,
  CollisionSystem,
  ParticleSystem,
} from './PhysicsSystems';

describe('PhysicsSystem', () => {
  it('applies gravity to rigidbody', () => {
    const world = new World();
    const cfgEntity = world.createEntity('physics');
    world.setComponent(cfgEntity, PhysicsConfigC, new PhysicsConfig());

    const e = world.createEntity('box');
    world.setComponent(e, TransformC, new Transform());
    const rb = new Rigidbody();
    rb.mass = 1;
    rb.gravityScale = 1;
    world.setComponent(e, RigidbodyC, rb);

    const sys = new PhysicsSystem();
    world.addSystem(sys);
    world.update(1 / 60);

    // After one step at 9.81 m/s²: v = 9.81 * (1/60) ≈ 0.1635
    expect(rb.velocity[1]).toBeLessThan(0); // falling
    expect(rb.velocity[1]).toBeCloseTo(-9.81 / 60, 2);
  });

  it('static rigidbody (mass=0) does not move', () => {
    const world = new World();
    const cfgEntity = world.createEntity('physics');
    world.setComponent(cfgEntity, PhysicsConfigC, new PhysicsConfig());

    const e = world.createEntity('static');
    world.setComponent(e, TransformC, Transform.fromPos(0, 10, 0));
    const rb = new Rigidbody();
    rb.mass = 0; // static
    world.setComponent(e, RigidbodyC, rb);

    const sys = new PhysicsSystem();
    world.addSystem(sys);
    world.update(1 / 60);

    expect(rb.velocity[1]).toBe(0); // no velocity change
  });

  it('velocity damping reduces speed over time', () => {
    const world = new World();
    const cfgEntity = world.createEntity('physics');
    world.setComponent(cfgEntity, PhysicsConfigC, new PhysicsConfig());

    const e = world.createEntity('box');
    world.setComponent(e, TransformC, new Transform());
    const rb = new Rigidbody();
    rb.mass = 1;
    rb.velocity = [10, 0, 0];
    rb.linearDamping = 0.5;
    rb.gravityScale = 0;
    world.setComponent(e, RigidbodyC, rb);

    const sys = new PhysicsSystem();
    world.addSystem(sys);

    // Simulate several steps
    for (let i = 0; i < 60; i++) world.update(1 / 60);

    expect(Math.abs(rb.velocity[0])).toBeLessThan(10);
  });
});

describe('CollisionSystem', () => {
  it('detects overlapping AABB colliders and applies separation', () => {
    const world = new World();
    const cfgEntity = world.createEntity('physics');
    world.setComponent(cfgEntity, PhysicsConfigC, new PhysicsConfig());

    // Two boxes at the same position → overlapping
    const a = world.createEntity('A');
    world.setComponent(a, TransformC, new Transform()); // pos=(0,0,0)
    const ca = new Collider();
    ca.shape = 'aabb';
    ca.halfExtents = [0.5, 0.5, 0.5];
    world.setComponent(a, ColliderC, ca);
    const rbA = new Rigidbody();
    rbA.mass = 1;
    world.setComponent(a, RigidbodyC, rbA);

    const b = world.createEntity('B');
    world.setComponent(b, TransformC, new Transform()); // pos=(0,0,0)
    const cb = new Collider();
    cb.shape = 'aabb';
    cb.halfExtents = [0.5, 0.5, 0.5];
    world.setComponent(b, ColliderC, cb);
    const rbB = new Rigidbody();
    rbB.mass = 1;
    world.setComponent(b, RigidbodyC, rbB);

    const colSys = new CollisionSystem();
    world.addSystem(colSys);
    world.update(1 / 60);

    // After collision resolution, at least one should have moved
    const tA = world.getComponent(a, TransformC)!;
    const tB = world.getComponent(b, TransformC)!;
    const moved = (tA.position[0] !== 0 || tA.position[1] !== 0 || tA.position[2] !== 0) ||
                  (tB.position[0] !== 0 || tB.position[1] !== 0 || tB.position[2] !== 0);
    expect(moved).toBe(true);
  });

  it('layer mask prevents collision', () => {
    const world = new World();
    const cfgEntity = world.createEntity('physics');
    world.setComponent(cfgEntity, PhysicsConfigC, new PhysicsConfig());

    const a = world.createEntity('A');
    world.setComponent(a, TransformC, new Transform());
    const ca = new Collider();
    ca.shape = 'aabb';
    ca.layerMask = 0x0001;
    world.setComponent(a, ColliderC, ca);
    world.setComponent(a, RigidbodyC, new Rigidbody());

    const b = world.createEntity('B');
    world.setComponent(b, TransformC, new Transform());
    const cb = new Collider();
    cb.shape = 'aabb';
    cb.layerMask = 0x0002; // different layer → no collision
    world.setComponent(b, ColliderC, cb);
    world.setComponent(b, RigidbodyC, new Rigidbody());

    const colSys = new CollisionSystem();
    world.addSystem(colSys);

    // Capture positions before
    const tA_before = world.getComponent(a, TransformC)!.position.slice();
    const tB_before = world.getComponent(b, TransformC)!.position.slice();

    world.update(1 / 60);

    // Positions should be unchanged (no collision)
    const tA_after = world.getComponent(a, TransformC)!.position;
    const tB_after = world.getComponent(b, TransformC)!.position;
    expect(tA_after).toEqual(tA_before);
    expect(tB_after).toEqual(tB_before);
  });

  it('detects sphere-sphere overlap', () => {
    const world = new World();
    const cfgEntity = world.createEntity('physics');
    world.setComponent(cfgEntity, PhysicsConfigC, new PhysicsConfig());

    const a = world.createEntity('A');
    world.setComponent(a, TransformC, new Transform());
    const ca = new Collider();
    ca.shape = 'sphere';
    ca.radius = 1.0;
    world.setComponent(a, ColliderC, ca);
    world.setComponent(a, RigidbodyC, new Rigidbody());

    const b = world.createEntity('B');
    // Offset slightly on X axis so collision normal is well-defined
    world.setComponent(b, TransformC, Transform.fromPos(1.5, 0, 0));
    const cb = new Collider();
    cb.shape = 'sphere';
    cb.radius = 1.0;
    world.setComponent(b, ColliderC, cb);
    world.setComponent(b, RigidbodyC, new Rigidbody());

    const colSys = new CollisionSystem();
    world.addSystem(colSys);
    world.update(1 / 60);

    const tA = world.getComponent(a, TransformC)!;
    const tB = world.getComponent(b, TransformC)!;
    const moved = (tA.position[0] !== 0 || tA.position[1] !== 0 || tA.position[2] !== 0) ||
                  (tB.position[0] !== 0 || tB.position[1] !== 0 || tB.position[2] !== 0);
    expect(moved).toBe(true);
  });

  it('impulse pushes bodies apart in correct direction', () => {
    const world = new World();
    const cfgEntity = world.createEntity('physics');
    world.setComponent(cfgEntity, PhysicsConfigC, new PhysicsConfig());

    // A at (0,0,0), B at (0.6, 0, 0) with radius 0.5 each → 0.1 overlap
    const a = world.createEntity('A');
    world.setComponent(a, TransformC, Transform.fromPos(0, 0, 0));
    const ca = new Collider();
    ca.shape = 'sphere';
    ca.radius = 0.5;
    world.setComponent(a, ColliderC, ca);
    const rbA = new Rigidbody();
    rbA.mass = 1;
    world.setComponent(a, RigidbodyC, rbA);

    const b = world.createEntity('B');
    world.setComponent(b, TransformC, Transform.fromPos(0.6, 0, 0));
    const cb = new Collider();
    cb.shape = 'sphere';
    cb.radius = 0.5;
    world.setComponent(b, ColliderC, cb);
    const rbB = new Rigidbody();
    rbB.mass = 1;
    world.setComponent(b, RigidbodyC, rbB);

    const colSys = new CollisionSystem();
    world.addSystem(colSys);
    world.update(1 / 60);

    // A should be pushed left (-x), B pushed right (+x)
    const tA = world.getComponent(a, TransformC)!;
    const tB = world.getComponent(b, TransformC)!;
    expect(tA.position[0]).toBeLessThan(0);
    expect(tB.position[0]).toBeGreaterThan(0.6);
  });
});

describe('ParticleSystem', () => {
  it('ages particles and destroys expired ones', () => {
    const world = new World();
    const cfgEntity = world.createEntity('physics');
    world.setComponent(cfgEntity, PhysicsConfigC, new PhysicsConfig());

    const p = world.createEntity('particle');
    const particle = new Particle();
    particle.lifetime = 0.1; // 100ms
    world.setComponent(p, ParticleC, particle);

    const sys = new ParticleSystem();
    world.addSystem(sys);

    // Advance past lifetime
    for (let i = 0; i < 10; i++) world.update(1 / 60);
    // 10/60 ≈ 0.167 > 0.1 → particle should be destroyed
    expect(world.isAlive(p)).toBe(false);
  });

  it('emitter spawns particles', () => {
    const world = new World();
    world.setComponent(world.createEntity('physics'), PhysicsConfigC, new PhysicsConfig());

    const em = world.createEntity('emitter');
    world.setComponent(em, TransformC, Transform.fromPos(0, 1, 0));
    const emitter = new ParticleEmitter();
    emitter.rate = 100;
    emitter.maxParticles = 50;
    world.setComponent(em, ParticleEmitterC, emitter);

    const sys = new ParticleSystem();
    world.addSystem(sys);

    // Advance several frames
    for (let i = 0; i < 10; i++) world.update(1 / 60);

    expect(emitter.particleIds.length).toBeGreaterThan(0);
  });

  it('emitter respects maxParticles limit', () => {
    const world = new World();
    world.setComponent(world.createEntity('physics'), PhysicsConfigC, new PhysicsConfig());

    const em = world.createEntity('emitter');
    world.setComponent(em, TransformC, Transform.fromPos(0, 1, 0));
    const emitter = new ParticleEmitter();
    emitter.rate = 1000;
    emitter.maxParticles = 5;
    world.setComponent(em, ParticleEmitterC, emitter);

    const sys = new ParticleSystem();
    world.addSystem(sys);

    for (let i = 0; i < 30; i++) world.update(1 / 60);

    expect(emitter.particleIds.length).toBeLessThanOrEqual(5);
  });

  it('gravity affects particle velocity', () => {
    const world = new World();
    world.setComponent(world.createEntity('physics'), PhysicsConfigC, new PhysicsConfig());

    const p = world.createEntity('particle');
    const particle = new Particle();
    particle.velocity = [0, 5, 0]; // moving up
    particle.lifetime = 2;
    world.setComponent(p, ParticleC, particle);

    const sys = new ParticleSystem();
    world.addSystem(sys);

    world.update(1 / 60);

    // Velocity should decrease due to gravity
    expect(particle.velocity[1]).toBeLessThan(5);
  });
});