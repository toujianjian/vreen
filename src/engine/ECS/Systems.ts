// CommonSystems — 常用 ECS 系统。
//
// 每个 System 都是普通 class，构造时取名 + 优先级，update(World, dt) 里
// 用 World.query / World.getComponent 遍历。System 本身不存业务状态
// （如要缓存可以用 World 私有 Map）。

import { System, World } from './World';
import { TransformC, VelocityC, SkinnedMeshRefC, AnimStateC, LifetimeC, PlayerInputC } from './Components';
import { createLogger } from '@/lib/logger';

const log = createLogger('ECS.Systems');

// ── MovementSystem ──────────────────────────────────────────────────
/** priority 默认 0 (100)。处理 Transform + Velocity：position += v * dt；
 *  angularY 绕 Y 旋转 quaternion。 */
export class MovementSystem extends System {
  constructor() { super('MovementSystem', 100); }
  override update(world: World, dt: number): void {
    world.queryWith2(TransformC, VelocityC, (id, t, v) => {
      t.position[0] += v.linear[0] * dt;
      t.position[1] += v.linear[1] * dt;
      t.position[2] += v.linear[2] * dt;
      if (v.angularY !== 0) {
        // 绕 Y 轴旋转 quaternion: q' = q * (0, sin(θ/2), 0, cos(θ/2))
        // 四元数乘法 (x,y,z,w) × (0, s, 0, c):
        //   .x = qx*c - qz*s
        //   .y = qw*s + qy*c
        //   .z = qx*s + qz*c
        //   .w = qw*c - qy*s
        const half = v.angularY * dt * 0.5;
        const s = Math.sin(half), c = Math.cos(half);
        const [qx, qy, qz, qw] = t.rotation;
        const rx = qx * c - qz * s;
        const ry = qw * s + qy * c;
        const rz = qx * s + qz * c;
        const rw = qw * c - qy * s;
        // 归一化
        const len = Math.hypot(rx, ry, rz, rw) || 1;
        t.rotation = [rx / len, ry / len, rz / len, rw / len];
      }
      // 同步到 scene node
      const node = world.getSceneNode(id);
      if (node) {
        node.position.set(t.position[0], t.position[1], t.position[2]);
        node.rotation.set(t.rotation[0], t.rotation[1], t.rotation[2], t.rotation[3]);
      }
    });
  }
}

// ── AnimationTickSystem ─────────────────────────────────────────────
/** 推进 SkinnedMesh 的 AnimationMixer。priority 200 (Movement 之后)。 */
export class AnimationTickSystem extends System {
  constructor() { super('AnimationTickSystem', 200); }
  override update(world: World, dt: number): void {
    world.queryWith(SkinnedMeshRefC, (id, ref) => {
      ref.mixer.update(dt);
      void id;
    });
  }
}

// ── AnimStateSystem ─────────────────────────────────────────────────
/** 推进 entity 上的 AnimationStateMachine。priority 150
 *  (Movement 之后，AnimationTick 之前 — 状态机先决定播啥 clip,
 *   再让 AnimationTickSystem 推进 mixer)。
 *
 *  每个 entity 的 AnimState 可选地持一个 stateMachine;有就跑
 *  stateMachine.update(dt)。系统会从 Velocity 读取速度写入 'speed'
 *  参数,供条件转换使用。状态切换时自动在 mixer 上播放新 clip。 */
export class AnimStateSystem extends System {
  constructor() { super('AnimStateSystem', 150); }
  override update(world: World, dt: number): void {
    world.queryWith(AnimStateC, (id, state) => {
      if (!state.stateMachine) return;
      // 从 Velocity 组件写入 speed 参数(约定:locomotion 用 'speed')
      const vel = world.getComponent(id, VelocityC);
      if (vel) {
        const speed = Math.hypot(vel.linear[0], vel.linear[1], vel.linear[2]);
        state.stateMachine.setParameter('speed', speed);
      }
      // 记录切换前的 clip 名,用于检测状态变化
      const prevClip = state.clip;
      // 推进状态机
      state.stateMachine.update(dt);
      // 同步当前 clip 名 + 在 mixer 上播放
      const cur = state.stateMachine.getCurrentState();
      const newClip = cur ? cur.clipName : null;
      if (newClip !== prevClip && newClip && cur && state.mixer) {
        const clip = state.clips.get(newClip);
        if (clip) {
          state.mixer.stopAll();
          state.mixer.play(clip, {
            loop: cur.loop ? 'repeat' : 'once',
            timeScale: cur.speed,
          });
        }
      }
      state.clip = newClip;
    });
  }
}

// ── PlayerInputSystem ──────────────────────────────────────────────
/** 把 PlayerInput 意图转为 Velocity。WASD + Shift 跑 + Space 跳。priority 50
 *  (Movement 之前)。
 *  输入向量会按 cameraYaw 旋转,实现 "按视角方向移动"。 */
export class PlayerInputSystem extends System {
  walkSpeed: number = 1.8;   // m/s
  runSpeed: number = 5.0;    // m/s
  turnSpeed: number = 2.0;   // rad/s (保留给手动转向)
  jumpSpeed: number = 4.5;   // m/s 瞬间上冲
  constructor() { super('PlayerInputSystem', 50); }
  override update(world: World, dt: number): void {
    world.queryWith2(PlayerInputC, VelocityC, (id, input, vel) => {
      const speed = input.run ? this.runSpeed : this.walkSpeed;
      const yaw = input.cameraYaw;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      // forward 在世界空间 = (-sin, 0, -cos); right = (cos, 0, -sin)
      // 注意:ThreeJS/OpenGL 默认 camera 看 -Z,所以 forward 取负。
      const worldFx = -input.forward * sin;
      const worldFz = -input.forward * cos;
      const worldRx = input.right * cos;
      const worldRz = -input.right * sin;
      vel.linear[0] = (worldFx + worldRx) * speed;
      vel.linear[1] = input.jump ? this.jumpSpeed : 0;
      vel.linear[2] = (worldFz + worldRz) * speed;
      // A/D 不再直接转身;若需要坦克转向可重新开启 vel.angularY。
      vel.angularY = 0;
      void id; void dt;
    });
  }
}

// ── LifetimeSystem ─────────────────────────────────────────────────
/** 倒计时归零 → destroyEntity。priority 1000 (最后)。 */
export class LifetimeSystem extends System {
  constructor() { super('LifetimeSystem', 1000); }
  override update(world: World, dt: number): void {
    const toKill: number[] = [];
    world.queryWith(LifetimeC, (id, lt) => {
      lt.remaining -= dt;
      if (lt.remaining <= 0) toKill.push(id);
    });
    if (toKill.length > 0) {
      log.info(`expired ${toKill.length} entities: [${toKill.map((i) => '0x' + i.toString(16)).join(', ')}]`);
      for (const id of toKill) world.destroyEntity(id);
    }
  }
}
