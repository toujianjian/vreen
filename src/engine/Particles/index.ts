// Particles barrel — 高级粒子系统统一导出。
//
// 与 ECS/PhysicsComponents.ts 中的轻量级 Particle/ParticleEmitter 区别:
// 本模块是独立的"高级 CPU 粒子系统",支持曲线、修改器、拖尾、子发射器等
// 富特性。在 engine/index.ts 里以 AdvancedParticleEmitter 别名导出
// ParticleEmitter,避免与 ECS 同名组件冲突。

export {
  ConstantCurve,
  LinearCurve,
  BezierCurve,
  RandomCurve,
  createCurve,
  type ParticleCurve,
} from './ParticleCurve';

export { ParticleData } from './ParticleData';

export {
  ParticleEmitter,
  type EmitterColor,
  type EmitterParticle,
  type EmitterShape,
  type EmitterShapeType,
  type EmissionShapeType,
  type ShapeParams,
  type ParticleBurst,
  type MinMaxRange,
} from './ParticleEmitter';

export {
  ParticleModifier,
  ForceFieldModifier,
  VortexModifier,
  TurbulenceModifier,
  ColorOverLifeModifier,
  SizeOverLifeModifier,
  VelocityOverLifeModifier,
  SubEmittersModifier,
} from './ParticleModifier';

export {
  TrailModule,
  type TrailColorMode,
  type TrailRenderData,
} from './TrailModule';

export {
  ParticleSystem2,
  type ParticleSystemRenderData,
  type SpawnDefaults,
} from './ParticleSystem2';

export {
  GPUParticleSystem,
  type GPUParticleOptions,
} from './GPUParticleSystem';
