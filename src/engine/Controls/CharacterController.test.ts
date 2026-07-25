// CharacterController 单元测试（数据层，不依赖真实 DOM/WebGL）。

import { describe, it, expect, beforeEach } from 'vitest';
import { CharacterController } from './CharacterController';
import { Vector3 } from '../Math/Vector3';
import type { GroundSampleFn } from './CharacterController';

describe('CharacterController', () => {
  let ctrl: CharacterController;

  beforeEach(() => {
    ctrl = new CharacterController(new Vector3(0, 0, 0));
  });

  it('默认构造', () => {
    expect(ctrl.height).toBe(1.8);
    expect(ctrl.radius).toBe(0.4);
    expect(ctrl.moveSpeed).toBe(4.0);
    expect(ctrl.runSpeed).toBe(8.0);
    expect(ctrl.jumpForce).toBe(6.0);
    expect(ctrl.isGrounded).toBe(false);
    expect(ctrl.gravity.y).toBeCloseTo(-9.81);
  });

  it('自定义 options', () => {
    const c = new CharacterController(new Vector3(1, 2, 3), {
      height: 2.0,
      radius: 0.5,
      stepHeight: 0.5,
      slopeLimit: 30,
      moveSpeed: 5,
      runSpeed: 10,
      jumpForce: 8,
      gravity: new Vector3(0, -20, 0),
    });
    expect(c.height).toBe(2.0);
    expect(c.radius).toBe(0.5);
    expect(c.stepHeight).toBe(0.5);
    expect(c.slopeLimit).toBe(30);
    expect(c.runSpeed).toBe(10);
    expect(c.gravity.y).toBe(-20);
    expect(c.position.x).toBe(1);
  });

  it('setRotation / getForward / getRight', () => {
    ctrl.setRotation(0);
    const f = ctrl.getForward();
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(1); // 0 = +Z
    const r = ctrl.getRight();
    expect(r.x).toBeCloseTo(1);
    expect(r.z).toBeCloseTo(0);

    // 旋转 90°（+X 方向）
    ctrl.setRotation(Math.PI / 2);
    const f2 = ctrl.getForward();
    expect(f2.x).toBeCloseTo(1);
    expect(f2.z).toBeCloseTo(0);
  });

  it('move 设置水平速度并对齐朝向', () => {
    const dt = 0.016;
    ctrl.isGrounded = true;
    ctrl.move(new Vector3(1, 0, 0), dt, false);
    expect(ctrl.velocity.x).toBeCloseTo(ctrl.moveSpeed);
    expect(ctrl.velocity.z).toBeCloseTo(0);
    expect(ctrl.isRunning).toBe(false);
    // 朝向应朝 +X
    expect(ctrl.rotation).toBeCloseTo(Math.PI / 2);

    // 奔跑
    ctrl.move(new Vector3(0, 0, 1), dt, true);
    expect(ctrl.velocity.z).toBeCloseTo(ctrl.runSpeed);
    expect(ctrl.isRunning).toBe(true);
    // 朝向 0 = +Z
    expect(ctrl.rotation).toBeCloseTo(0);
  });

  it('move 忽略方向 Y 分量', () => {
    ctrl.isGrounded = true;
    ctrl.move(new Vector3(0, 1, 1), 0.016);
    expect(ctrl.velocity.y).toBe(0); // Y 不被 move 改变
    expect(ctrl.velocity.z).toBeCloseTo(ctrl.moveSpeed);
  });

  it('move 零方向不改变朝向', () => {
    ctrl.setRotation(1.0);
    ctrl.move(new Vector3(0, 0, 0), 0.016);
    expect(ctrl.rotation).toBeCloseTo(1.0);
  });

  it('jump 仅着地时有效', () => {
    ctrl.isGrounded = false;
    expect(ctrl.jump()).toBe(false);

    ctrl.isGrounded = true;
    expect(ctrl.jump()).toBe(true);
    expect(ctrl.velocity.y).toBeCloseTo(ctrl.jumpForce);
    expect(ctrl.isGrounded).toBe(false);

    // 空中再跳无效
    expect(ctrl.jump()).toBe(false);
  });

  it('update：重力积分 + 落地', () => {
    // 地面采样：所有 (x,z) 处地面高度 = 0
    const sample: GroundSampleFn = () => 0;
    ctrl.position.set(0, 1, 0); // 离地 1m
    ctrl.velocity.set(0, 0, 0);

    // 第一帧：重力让 y 速度变负，位置下移
    ctrl.update(0.1, sample);
    expect(ctrl.velocity.y).toBeLessThan(0);
    expect(ctrl.position.y).toBeLessThan(1);

    // 多帧后落地
    for (let i = 0; i < 60; i++) {
      ctrl.update(0.016, sample);
    }
    expect(ctrl.isGrounded).toBe(true);
    expect(ctrl.position.y).toBeCloseTo(0, 2);
    expect(ctrl.velocity.y).toBe(0);
  });

  it('update：无地面（sample 返回 null）自由下落', () => {
    const sample: GroundSampleFn = () => null;
    ctrl.position.set(0, 100, 0); // 高处起步，确保不触底
    ctrl.velocity.set(0, 0, 0);
    // 累计 1 秒下落（10 帧 × 0.1s），semi-implicit Euler 后 v ≈ g*t
    for (let i = 0; i < 10; i++) {
      ctrl.update(0.1, sample);
    }
    expect(ctrl.isGrounded).toBe(false);
    expect(ctrl.velocity.y).toBeLessThan(-9);
  });

  it('update：台阶抬升（stepHeight 内）', () => {
    // 地面从 0 抬到 0.2（在默认 stepHeight=0.3 内）
    let groundY = 0.2;
    const sample: GroundSampleFn = () => groundY;
    ctrl.position.set(0, 0, 0);
    ctrl.isGrounded = true;

    ctrl.update(0.016, sample);
    expect(ctrl.position.y).toBeCloseTo(0.2, 2);
    expect(ctrl.isGrounded).toBe(true);
  });

  it('update：水平移动积分位置', () => {
    const sample: GroundSampleFn = () => 0;
    ctrl.position.set(0, 0, 0);
    ctrl.isGrounded = true;
    ctrl.move(new Vector3(1, 0, 0), 0.016);
    const x0 = ctrl.position.x;
    ctrl.update(0.5, sample);
    expect(ctrl.position.x).toBeGreaterThan(x0);
  });

  it('getState：idle / walking / running', () => {
    ctrl.isGrounded = true;
    // 无水平速度 → idle
    expect(ctrl.getState()).toBe('idle');

    // 步行（通过反射或直接调用 move 后 update）
    ctrl.move(new Vector3(1, 0, 0), 0.016, false);
    const sample: GroundSampleFn = () => 0;
    ctrl.update(0.016, sample);
    expect(ctrl.getState()).toBe('walking');

    // 奔跑
    ctrl.move(new Vector3(1, 0, 0), 0.016, true);
    ctrl.update(0.016, sample);
    expect(ctrl.getState()).toBe('running');
  });

  it('getState：jumping / falling', () => {
    ctrl.isGrounded = false;
    ctrl.velocity.y = 5; // 上升
    expect(ctrl.getState()).toBe('jumping');

    ctrl.velocity.y = -5; // 下落
    expect(ctrl.getState()).toBe('falling');
  });

  it('teleport 重置位置与速度', () => {
    ctrl.velocity.set(1, 2, 3);
    ctrl.isGrounded = true;
    ctrl.teleport(new Vector3(10, 20, 30));
    expect(ctrl.position.x).toBe(10);
    expect(ctrl.position.y).toBe(20);
    expect(ctrl.position.z).toBe(30);
    expect(ctrl.velocity.x).toBe(0);
    expect(ctrl.velocity.y).toBe(0);
    expect(ctrl.isGrounded).toBe(false);
  });

  it('getAABB 返回胶囊外包盒', () => {
    ctrl.position.set(0, 0, 0);
    const aabb = ctrl.getAABB();
    expect(aabb.min.x).toBe(-ctrl.radius);
    expect(aabb.max.x).toBe(ctrl.radius);
    expect(aabb.min.y).toBe(0);
    expect(aabb.max.y).toBe(ctrl.height);
    expect(aabb.max.z).toBe(ctrl.radius);
  });

  it('坡度限制：超过 slopeLimit 阻挡水平移动', () => {
    // 构造一个陡坡：脚下地面 y=0，前方 0.5m 处地面 y=2.0（远超 stepHeight）
    const sample: GroundSampleFn = (x) => {
      // x < 0.5 → 0；x >= 0.5 → 2.0（一堵墙）
      return x < 0.5 ? 0 : 2.0;
    };
    ctrl.position.set(0, 0, 0);
    ctrl.isGrounded = true;
    ctrl.slopeLimit = 45;
    // 朝 +X 走
    ctrl.move(new Vector3(1, 0, 0), 0.016);
    ctrl.update(0.016, sample);
    // 应被墙挡住：水平速度归零
    expect(ctrl.velocity.x).toBe(0);
    expect(ctrl.velocity.z).toBe(0);
  });

  it('空气控制：地面同等 vs 空中减弱', () => {
    // 地面：直接采用目标速度
    ctrl.isGrounded = true;
    ctrl.move(new Vector3(1, 0, 0), 0.016);
    expect(ctrl.velocity.x).toBeCloseTo(ctrl.moveSpeed);

    // 空中：airControl=0 时不改变水平速度
    ctrl.airControl = 0;
    ctrl.isGrounded = false;
    ctrl.velocity.set(0, 0, 0);
    ctrl.move(new Vector3(1, 0, 0), 0.016);
    expect(ctrl.velocity.x).toBeCloseTo(0);
  });
});
