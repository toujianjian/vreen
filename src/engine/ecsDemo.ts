// engineEcsDemo — 最小 ECS 演示，验证 World / System / Component 跑通。
// 该函数被 EngineDemoPage 在挂载时调用一次，往 console 打印 5 帧的
// entity 状态作为 sanity check。生产代码会改成 React state 显示。

import { createLogger, setMinLevel, minLevel } from '@/lib/logger';
import {
  World,
  MovementSystem,
  AnimationTickSystem,
  AnimStateSystem,
  PlayerInputSystem,
  LifetimeSystem,
  TransformC,
  VelocityC,
  PlayerInputC,
  AnimStateC,
  LifetimeC,
  SkinnedMeshRefC,
  HealthC,
  TagC,
  Tag,
  Health,
  Transform,
  Velocity,
  PlayerInput,
  AnimState,
  Lifetime,
} from '@/engine/ECS';

const log = createLogger('Demo');

export interface EcsDemoSummary {
  entityCount: number;
  systems: string[];
  finalFrame: number;
}

export function runEcsDemo(): EcsDemoSummary {
  const world = new World({ name: 'EcsDemoWorld' });

  // 注册 5 个 system，按 priority 排序
  world.addSystem(new PlayerInputSystem());
  world.addSystem(new MovementSystem());
  world.addSystem(new AnimStateSystem());
  world.addSystem(new AnimationTickSystem());
  world.addSystem(new LifetimeSystem());

  // 创建一个 player 实体
  const player = world.createEntity('Player');
  const t = new Transform();
  t.position = [0, 1.0, 0];
  world.setComponent(player, TransformC, t);
  world.setComponent(player, VelocityC, new Velocity());
  world.setComponent(player, PlayerInputC, new PlayerInput());
  world.setComponent(player, AnimStateC, new AnimState());
  world.setComponent(player, HealthC, new Health(100));
  world.setComponent(player, TagC, new Tag('Player'));

  // 创建一个敌人
  const enemy = world.createEntity('Enemy');
  const tE = new Transform();
  tE.position = [3, 1.0, 0];
  world.setComponent(enemy, TransformC, tE);
  world.setComponent(enemy, VelocityC, new Velocity());
  world.setComponent(enemy, HealthC, new Health(50));
  world.setComponent(enemy, TagC, new Tag('Enemy'));

  // 创建一个粒子（带 Lifetime，3s 后销毁）
  const particle = world.createEntity('Particle');
  world.setComponent(particle, TransformC, new Transform());
  world.setComponent(particle, LifetimeC, new Lifetime(3.0));

  // 模拟 5 帧
  for (let f = 0; f < 5; f++) {
    // 模拟输入
    const pi = world.getComponent(player, PlayerInputC)!;
    pi.forward = f % 2 === 0 ? 1 : 0;
    pi.right = 0;

    world.update(0.5);

    // 抽样打印
    const t2 = world.getComponent(player, TransformC)!;
    const lt = world.getComponent(particle, LifetimeC);
    log.info(
      `frame=${world.frame()} player.pos=(${t2.position[0].toFixed(2)}, ${t2.position[1].toFixed(2)}, ${t2.position[2].toFixed(2)}) ` +
      `entityCount=${world.entityCount()}` +
      (lt ? ` particle.remaining=${lt.remaining.toFixed(2)}` : ' particle=destroyed'),
    );
  }

  // 测试 query
  const tagged = world.query(TagC);
  log.info(`query(TagC) → ${tagged.length} entities: ${tagged.map((id) => world.getName(id)).join(', ')}`);

  // 测试序列化
  const json = world.toJSON();
  log.info(`toJSON() → ${json.entities.length} entities, version ${json.version}`);

  return {
    entityCount: world.entityCount(),
    systems: world.getSystems().map((s) => s.name),
    finalFrame: world.frame(),
  };
}

// 静默版：仅跑通流程，不打印日志。生产环境下用。
export function runEcsDemoSilent(): EcsDemoSummary {
  const origLevel = minLevel;
  setMinLevel('ERROR');
  try {
    return runEcsDemo();
  } finally {
    setMinLevel(origLevel);
  }
}

void SkinnedMeshRefC; // 占位 import
