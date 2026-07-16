// ECS barrel.

export {
  World,
  System,
  defineComponentType,
  ComponentTypeRegistry,
  packEntityId,
  entityIndex,
  entityVersion,
  isValidEntityId,
  NON_POJO_COMPONENTS,
  type EntityId,
  type ComponentType,
  type WorldOptions,
  type WorldJson,
  type WorldEntityJson,
  type EntitySummary,
  type EntitySnapshot,
  type AnimStateRuntime,
  type SystemTiming,
  type WorldSnapshot,
  type WorldDiff,
  type ComponentFactory,
  type ComponentRegistry,
} from './World';
export {
  Transform, TransformC,
  Velocity, VelocityC,
  MeshRef, MeshRefC,
  SkinnedMeshRef, SkinnedMeshRefC,
  AnimState, AnimStateC,
  Health, HealthC,
  Tag, TagC,
  Lifetime, LifetimeC,
  PlayerInput, PlayerInputC,
} from './Components';
export {
  MovementSystem,
  AnimationTickSystem,
  AnimStateSystem,
  PlayerInputSystem,
  LifetimeSystem,
} from './Systems';

export {
  Collider, ColliderC,
  Rigidbody, RigidbodyC,
  PhysicsConfig, PhysicsConfigC,
  Particle, ParticleC,
  ParticleEmitter, ParticleEmitterC,
  PhysicsDebug, PhysicsDebugC,
  Cloth, ClothC,
  type ColliderShape,
} from './PhysicsComponents';
export {
  PhysicsSystem,
  CollisionSystem,
  ParticleSystem,
  PhysicsDebugSystem,
  ClothSystem,
} from './PhysicsSystems';
