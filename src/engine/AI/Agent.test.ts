import { describe, it, expect } from 'vitest';
import { Agent } from './Agent';
import { SteeringBehavior } from './SteeringBehavior';
import { Vector3 } from '../Math';

describe('Agent', () => {
  it('默认构造使用合理参数', () => {
    const a = new Agent();
    expect(a.maxSpeed).toBe(5);
    expect(a.maxForce).toBe(10);
    expect(a.mass).toBe(1);
    expect(a.radius).toBe(0.5);
    expect(a.behavior).toBeInstanceOf(SteeringBehavior);
  });

  it('setTarget 设置单点路径', () => {
    const a = new Agent();
    const target = new Vector3(1, 0, 1);
    a.setTarget(target);
    expect(a.path.length).toBe(1);
    expect(a.currentWaypoint).toBe(0);
    expect(a.path[0].equals(target)).toBe(true);
  });

  it('setPath 设置路径并重置指针', () => {
    const a = new Agent();
    a.currentWaypoint = 5;
    a.setPath([new Vector3(0, 0, 0), new Vector3(1, 0, 0)]);
    expect(a.path.length).toBe(2);
    expect(a.currentWaypoint).toBe(0);
  });

  it('applyForce 累加到 acceleration', () => {
    const a = new Agent();
    a.applyForce(new Vector3(2, 0, 0));
    a.applyForce(new Vector3(0, 3, 0));
    expect(a.acceleration.x).toBe(2);
    expect(a.acceleration.y).toBe(3);
  });

  it('getVelocity 返回克隆', () => {
    const a = new Agent({ velocity: new Vector3(1, 2, 3) });
    const v = a.getVelocity();
    expect(v.equals(a.velocity)).toBe(true);
    v.x = 99;
    expect(a.velocity.x).toBe(1); // 改克隆不影响原值
  });

  it('update 推进位置(直线单点路径)', () => {
    const a = new Agent({
      position: new Vector3(0, 0, 0),
      maxSpeed: 5,
    });
    a.setTarget(new Vector3(10, 0, 0));
    a.update(1);
    // 一帧后位置朝 +X 移动
    expect(a.position.x).toBeGreaterThan(0);
    expect(Math.abs(a.position.z)).toBeLessThan(1e-3);
  });

  it('update 后 acceleration 清零', () => {
    const a = new Agent();
    a.setTarget(new Vector3(10, 0, 0));
    a.update(0.1);
    expect(a.acceleration.lengthSq()).toBe(0);
  });

  it('update 速度截断到 maxSpeed', () => {
    const a = new Agent({
      position: new Vector3(0, 0, 0),
      maxSpeed: 2,
      maxForce: 1000, // 大力保证一帧内能超速
    });
    a.setTarget(new Vector3(100, 0, 0));
    a.update(1);
    expect(a.velocity.length()).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('update 力截断到 maxForce', () => {
    const a = new Agent({
      position: new Vector3(0, 0, 0),
      maxForce: 1,
    });
    a.applyForce(new Vector3(1000, 0, 0));
    a.update(0.1);
    // acceleration 在 update 中应被截断到 maxForce=1
    // (注:update 后 acceleration 已清零,但 velocity 应小于 maxForce*dt 量级)
    expect(a.velocity.length()).toBeLessThan(5);
  });

  it('followPath 推进 waypoint', () => {
    const a = new Agent({
      position: new Vector3(0, 0, 0),
      maxSpeed: 10,
      maxForce: 100,
    });
    // 给一个朝第一目标点的路径
    a.setPath([new Vector3(0.4, 0, 0), new Vector3(10, 0, 0)]);
    // 多帧 update 让 agent 到达第一 waypoint
    for (let i = 0; i < 30; i++) a.update(0.1);
    // 应该推进过 waypoint(>=1)
    expect(a.currentWaypoint).toBeGreaterThanOrEqual(1);
  });

  it('reset 清零速度并清空路径', () => {
    const a = new Agent();
    a.velocity.set(5, 5, 5);
    a.setPath([new Vector3(1, 0, 0)]);
    a.reset(new Vector3(2, 0, 2));
    expect(a.position.equals(new Vector3(2, 0, 2))).toBe(true);
    expect(a.velocity.lengthSq()).toBe(0);
    expect(a.path.length).toBe(0);
  });

  it('enabled=false 时 update 不积分', () => {
    const a = new Agent();
    a.enabled = false;
    const startPos = a.position.clone();
    a.setTarget(new Vector3(10, 0, 0));
    a.update(1);
    expect(a.position.equals(startPos)).toBe(true);
  });

  it('无路径时 update 不报错也不产生位移', () => {
    const a = new Agent();
    const startPos = a.position.clone();
    a.update(1);
    expect(a.position.equals(startPos)).toBe(true);
  });

  it('loop 路径到达末尾后回到起点', () => {
    const a = new Agent({
      position: new Vector3(0, 0, 0),
      maxSpeed: 50,
      maxForce: 1000,
      loop: true,
    });
    a.setPath([new Vector3(0.3, 0, 0)]);
    for (let i = 0; i < 50; i++) a.update(0.1);
    // 循环模式下,currentWaypoint 应该回到 0
    expect(a.currentWaypoint).toBe(0);
  });
});
