# VREEN Engine API 调用教程

**版本**: 0.2.0 — 本教程涵盖 `@vreen/engine` 核心 API 的使用方法。

---

## 目录

1. [快速开始](#1-快速开始)
2. [World 与 ECS 系统](#2-world-与-ecs-系统)
3. [组件定义与使用](#3-组件定义与使用)
4. [系统 (System) 编写](#4-系统-system-编写)
5. [渲染器 (Renderer)](#5-渲染器-renderer)
6. [相机 (Camera)](#6-相机-camera)
7. [光照 (Light)](#7-光照-light)
8. [物理系统 (Physics)](#8-物理系统-physics)
9. [动画系统 (Animation)](#9-动画系统-animation)
10. [日志系统 (Logger)](#10-日志系统-logger)
11. [序列化与持久化](#11-序列化与持久化)
12. [性能分析 (Profiler)](#12-性能分析-profiler)

---

## 1. 快速开始

### 1.1 安装

```bash
npm install github:vreen/vreen/packages/engine
```

或使用 GitHub SSH：

```bash
npm install git+ssh://git@github.com:vreen/vreen.git#master
```

> **说明**: 包尚未发布到 npm registry，需通过 GitHub 仓库安装。安装后包名为 `@vreen/engine`，可正常导入使用。

### 1.2 最小示例

```typescript
import { World, TransformC, Transform, MeshRefC, Mesh, BoxGeometry, StandardMaterial, WebGL2Renderer, PerspectiveCamera, Scene, AmbientLight, DirectionalLight } from '@vreen/engine';

// 1. 创建 World
const world = new World('MyWorld');

// 2. 创建实体并添加组件
const entityId = world.createEntity('Cube');
world.setComponent(entityId, TransformC, Transform.fromPos(0, 0, -5));

// 3. 创建渲染对象
const mesh = new Mesh(new BoxGeometry(), new StandardMaterial({ color: 0x00ff00 }));
world.setComponent(entityId, MeshRefC, new MeshRef(mesh));

// 4. 创建场景和相机
const scene = new Scene();
const camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 5);

// 5. 添加光源
scene.add(new AmbientLight(0xffffff, 0.5));
scene.add(new DirectionalLight(0xffffff, 1));

// 6. 创建渲染器
const renderer = new WebGL2Renderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.canvas);

// 7. 主循环
function animate() {
  requestAnimationFrame(animate);
  world.update(0.016);
  renderer.render(scene, camera);
}
animate();
```

---

## 2. World 与 ECS 系统

### 2.1 创建 World

```typescript
import { World } from '@vreen/engine';

const world = new World('GameWorld');
```

### 2.2 创建实体

```typescript
const playerId = world.createEntity('Player');
const enemyId = world.createEntity('Enemy');
```

### 2.3 查询实体

```typescript
import { TransformC, VelocityC } from '@vreen/engine';

// 查询同时拥有 Transform 和 Velocity 组件的实体
const movingEntities = world.query(TransformC, VelocityC);

for (const id of movingEntities) {
  const transform = world.getComponent(id, TransformC);
  const velocity = world.getComponent(id, VelocityC);
  // ...
}
```

### 2.4 删除实体

```typescript
world.destroyEntity(enemyId);
```

### 2.5 更新 World

```typescript
const dt = 1 / 60; // 60 FPS
world.update(dt);
```

---

## 3. 组件定义与使用

### 3.1 内置组件

| 组件名 | 用途 | 是否可序列化 |
|--------|------|--------------|
| `TransformC` | 位置/旋转/缩放 | 是 |
| `VelocityC` | 线速度/角速度 | 是 |
| `MeshRefC` | 指向 Mesh 对象 | 否 |
| `SkinnedMeshRefC` | 指向 SkinnedMesh + Mixer | 否 |
| `AnimStateC` | 动画状态机 | 否 |
| `HealthC` | 生命值 | 是 |
| `LifetimeC` | 生命周期 | 是 |
| `PlayerInputC` | 玩家输入 | 是 |
| `TagC` | 标签分类 | 是 |

### 3.2 使用内置组件

```typescript
import { TransformC, Transform, VelocityC, Velocity } from '@vreen/engine';

const entity = world.createEntity('MovingObject');

// 设置 Transform
world.setComponent(entity, TransformC, {
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});

// 设置 Velocity
world.setComponent(entity, VelocityC, {
  linear: [1, 0, 0],
  angularY: 0.5,
});

// 获取组件
const transform = world.getComponent(entity, TransformC);
console.log(transform.position);
```

### 3.3 自定义组件

```typescript
import { ComponentType } from '@vreen/engine';

class PlayerStats {
  speed: number = 5;
  jumpHeight: number = 2;
  stamina: number = 100;
  maxStamina: number = 100;
}

export const PlayerStatsC = new ComponentType<PlayerStats>('PlayerStats');

// 使用
world.setComponent(playerId, PlayerStatsC, new PlayerStats());
```

---

## 4. 系统 (System) 编写

### 4.1 创建自定义系统

```typescript
import { System, World } from '@vreen/engine';
import { TransformC, VelocityC, PlayerInputC } from '@vreen/engine';

class MovementSystem extends System {
  constructor() {
    super('Movement', 100); // 名字 + 优先级
  }

  update(world: World, dt: number): void {
    const entities = world.query(TransformC, VelocityC);
    
    for (const id of entities) {
      const transform = world.getComponent(id, TransformC);
      const velocity = world.getComponent(id, VelocityC);
      
      // 更新位置
      transform.position[0] += velocity.linear[0] * dt;
      transform.position[1] += velocity.linear[1] * dt;
      transform.position[2] += velocity.linear[2] * dt;
      
      // 更新旋转（绕 Y 轴）
      // ...
    }
  }
}

// 注册系统
world.addSystem(new MovementSystem());
```

### 4.2 常用内置系统

```typescript
import { MovementSystem, AnimationTickSystem, LifetimeSystem } from '@vreen/engine';

world.addSystem(new MovementSystem());      // 移动更新
world.addSystem(new AnimationTickSystem()); // 动画推进
world.addSystem(new LifetimeSystem());      // 生命周期管理
```

---

## 5. 渲染器 (Renderer)

### 5.1 创建 WebGL2Renderer

```typescript
import { WebGL2Renderer } from '@vreen/engine';

const renderer = new WebGL2Renderer({
  antialias: true,
  alpha: false,
  shadowMap: true,
  toneMapping: 'ACES',
  exposure: 1.0,
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.canvas);
```

### 5.2 渲染场景

```typescript
import { Scene, PerspectiveCamera } from '@vreen/engine';

const scene = new Scene();
const camera = new PerspectiveCamera(75, aspect, 0.1, 1000);

renderer.render(scene, camera);
```

### 5.3 后处理效果

```typescript
renderer.postProcessing = {
  bloom: { enabled: true, intensity: 1.0, radius: 0.5 },
  chromaticAberration: { enabled: true, amount: 0.05 },
  vignette: { enabled: true, intensity: 0.5 },
  ssao: { enabled: true, radius: 0.5, intensity: 2.0 },
};
```

---

## 6. 相机 (Camera)

### 6.1 透视相机

```typescript
import { PerspectiveCamera } from '@vreen/engine';

const camera = new PerspectiveCamera(75, aspect, 0.1, 1000);
camera.position.set(0, 2, 5);
camera.lookAt(0, 0, 0);
```

### 6.2 正交相机

```typescript
import { OrthographicCamera } from '@vreen/engine';

const frustumSize = 10;
const camera = new OrthographicCamera(
  frustumSize * aspect / -2,
  frustumSize * aspect / 2,
  frustumSize / 2,
  frustumSize / -2,
  0.1,
  1000
);
```

### 6.3 相机控制器

```typescript
import { OrbitControls, FirstPersonControls } from '@vreen/engine';

// 轨道控制
const controls = new OrbitControls(camera, renderer.canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.05;

// 第一人称控制
const fpControls = new FirstPersonControls(camera);
fpControls.movementSpeed = 5;
fpControls.lookSpeed = 0.005;
```

---

## 7. 光照 (Light)

### 7.1 环境光

```typescript
import { AmbientLight } from '@vreen/engine';

const ambient = new AmbientLight(0xffffff, 0.5);
scene.add(ambient);
```

### 7.2 方向光（带阴影）

```typescript
import { DirectionalLight } from '@vreen/engine';

const dirLight = new DirectionalLight(0xffffff, 1);
dirLight.position.set(10, 20, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
scene.add(dirLight);
```

### 7.3 点光源

```typescript
import { PointLight } from '@vreen/engine';

const pointLight = new PointLight(0xff0000, 1, 100);
pointLight.position.set(0, 5, 0);
scene.add(pointLight);
```

---

## 8. 物理系统 (Physics)

### 8.1 创建物理世界

```typescript
import { PhysicsWorld } from '@vreen/engine';

const physics = new PhysicsWorld();
physics.gravity.set(0, -9.8, 0);
```

### 8.2 添加刚体

```typescript
import { RigidBody, BoxShape, SphereShape } from '@vreen/engine';

// 创建盒子刚体
const boxBody = new RigidBody({
  shape: new BoxShape(1, 1, 1),
  position: [0, 10, 0],
  mass: 1,
});
physics.addBody(boxBody);

// 创建静态地面
const groundBody = new RigidBody({
  shape: new BoxShape(50, 0.5, 50),
  position: [0, -0.5, 0],
  mass: 0, // 0 = 静态
});
physics.addBody(groundBody);
```

### 8.3 模拟物理

```typescript
function update(dt: number) {
  physics.step(dt);
  
  // 同步物理位置到渲染对象
  for (const body of physics.bodies) {
    const entity = /* ... */;
    const transform = world.getComponent(entity, TransformC);
    transform.position = body.position;
    transform.rotation = body.rotation;
  }
}
```

---

## 9. 动画系统 (Animation)

### 9.1 加载动画

```typescript
import { AnimationClip, AnimationMixer } from '@vreen/engine';

// 创建动画片段
const clip = new AnimationClip('walk', duration, tracks);

// 创建 Mixer
const mixer = new AnimationMixer(skinnedMesh);
const action = mixer.clipAction(clip);
action.play();
```

### 9.2 状态机

```typescript
import { AnimationStateMachine, AnimStateC } from '@vreen/engine';

const sm = new AnimationStateMachine();

// 添加状态
sm.addState('idle', idleClip);
sm.addState('walk', walkClip);
sm.addState('run', runClip);

// 添加转换
sm.addTransition('idle', 'walk', (world, entity) => {
  const input = world.getComponent(entity, PlayerInputC);
  return input.movement.length > 0.1;
});

sm.addTransition('walk', 'run', (world, entity) => {
  const input = world.getComponent(entity, PlayerInputC);
  return input.movement.length > 0.5 && input.sprint;
});

// 绑定到实体
world.setComponent(entity, AnimStateC, {
  clip: 'idle',
  speed: 1,
  stateMachine: sm,
});
```

---

## 10. 日志系统 (Logger)

### 10.1 创建 Logger

```typescript
import { createLogger } from '@vreen/engine';

const log = createLogger('Game');
log.debug('Debug info');
log.info('Game started');
log.warn('Low memory');
log.error('Critical error');
```

### 10.2 设置自定义 Sink

```typescript
import { setLoggerSink, type LogEntry } from '@vreen/engine';

setLoggerSink((entry: LogEntry) => {
  // 发送到自定义日志系统
  console.log(`[${entry.level}] [${entry.module}] ${entry.message}`);
  
  // 或者发送到服务器
  // fetch('/log', { method: 'POST', body: JSON.stringify(entry) });
});
```

### 10.3 设置日志级别

```typescript
import { setMinLevel } from '@vreen/engine';

// 只显示 warn 和 error
setMinLevel('warn');

// 显示所有日志
setMinLevel('debug');
```

---

## 11. 序列化与持久化

### 11.1 导出 World 为 JSON

```typescript
const json = world.toJSON();
console.log(JSON.stringify(json, null, 2));
```

### 11.2 从 JSON 加载

```typescript
const registry = {
  Transform: () => new Transform(),
  Velocity: () => new Velocity(),
  PlayerStats: () => new PlayerStats(),
};

world.loadJSON(json, registry);
```

### 11.3 VREEN 包格式

```typescript
import { packVreen, unpackVreen } from '@vreen/engine';

// 打包
const vreenBuffer = await packVreen({
  scene: sceneJson,
  world: world.toJSON(),
  assets: { 'model.glb': glbBuffer },
});

// 解压
const vreenData = await unpackVreen(vreenBuffer);
console.log(vreenData.scene);
console.log(vreenData.world);
```

---

## 12. 性能分析 (Profiler)

### 12.1 创建并使用 Profiler

```typescript
import { PerformanceProfiler } from '@vreen/engine';

const profiler = new PerformanceProfiler(renderer);
profiler.setWorld(world);

// 开始录制
profiler.startRecording();

// 运行一段时间后停止
setTimeout(() => {
  profiler.stopRecording();
  
  // 获取报告
  const report = profiler.generateReport();
  console.log(report);
}, 5000);
```

### 12.2 获取实时统计

```typescript
const stats = profiler.getStats();
console.log(`FPS: ${stats.fps}`);
console.log(`Draw Calls: ${stats.drawCalls}`);
console.log(`Triangles: ${stats.triangles}`);
console.log(`Memory: ${stats.memory.texturesBytes}`);
```

---

## 附录：组件注册表示例

```typescript
import { ComponentRegistry } from '@vreen/engine';
import { Transform, Velocity, Health, Lifetime, PlayerInput, Tag } from '@vreen/engine';

export const ComponentRegistry: ComponentRegistry = {
  Transform: () => new Transform(),
  Velocity: () => new Velocity(),
  Health: () => new Health(100),
  Lifetime: () => ({ remaining: 0 }),
  PlayerInput: () => ({ movement: [0, 0], sprint: false, jump: false }),
  Tag: () => ({ value: '' }),
};
```

---

## 附录：完整游戏循环示例

```typescript
import { World, WebGL2Renderer, Scene, PerspectiveCamera, OrbitControls } from '@vreen/engine';

const world = new World('Game');
const renderer = new WebGL2Renderer();
const scene = new Scene();
const camera = new PerspectiveCamera(75, aspect, 0.1, 1000);
const controls = new OrbitControls(camera, renderer.canvas);

// 添加系统
world.addSystem(new MovementSystem());
world.addSystem(new AnimationTickSystem());
world.addSystem(new PhysicsSystem());

let lastTime = performance.now();

function gameLoop(currentTime: number) {
  const dt = Math.min((currentTime - lastTime) / 1000, 0.1);
  lastTime = currentTime;
  
  // 更新控制系统
  controls.update(dt);
  
  // 更新 ECS World
  world.update(dt);
  
  // 更新物理
  physics.step(dt);
  
  // 渲染
  renderer.render(scene, camera);
  
  requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
```