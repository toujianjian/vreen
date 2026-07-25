import { describe, it, expect } from 'vitest';
import { SteeringBehavior } from './SteeringBehavior';
import { Agent } from './Agent';
import { Vector3 } from '../Math';

function makeAgent(pos: number[] = [0, 0, 0], vel: number[] = [0, 0, 0]): Agent {
  return new Agent({
    position: new Vector3(pos[0], pos[1], pos[2]),
    velocity: new Vector3(vel[0], vel[1], vel[2]),
    maxSpeed: 5,
    maxForce: 10,
    mass: 1,
    radius: 0.5,
  });
}

describe('SteeringBehavior', () => {
  it('seek 朝目标方向产生力', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const target = new Vector3(10, 0, 0);
    const f = steer.seek(agent, target);
    // 力应该指向 +X(目标方向)
    expect(f.x).toBeGreaterThan(0);
    expect(Math.abs(f.z)).toBeLessThan(1e-6);
  });

  it('seek 同位置不产生力', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([5, 0, 5]);
    const target = new Vector3(5, 0, 5);
    const f = steer.seek(agent, target);
    expect(f.lengthSq()).toBe(0);
  });

  it('flee 远离威胁', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const threat = new Vector3(10, 0, 0);
    const f = steer.flee(agent, threat);
    // 应远离威胁,即朝 -X
    expect(f.x).toBeLessThan(0);
  });

  it('flee 距离过远不产生力', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const threat = new Vector3(200, 0, 0);
    const f = steer.flee(agent, threat);
    expect(f.lengthSq()).toBe(0);
  });

  it('arrive 远距离等于 seek', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const target = new Vector3(100, 0, 0);
    const arriveF = steer.arrive(agent, target, 5);
    const seekF = steer.seek(agent, target);
    // 远距离时 arrive 行为与 seek 近似(速度未衰减)
    expect(Math.abs(arriveF.x - seekF.x)).toBeLessThan(1e-3);
  });

  it('arrive 近距离减速', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const target = new Vector3(2, 0, 0);
    const arriveF = steer.arrive(agent, target, 5);
    const seekF = steer.seek(agent, target);
    // 近距离 arrive 期望速度更小,力也较小
    expect(arriveF.length()).toBeLessThan(seekF.length());
  });

  it('pursue 预测目标位置', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const quarry = makeAgent([5, 0, 0], [0, 0, 5]); // 目标朝 +Z
    const f = steer.pursue(agent, quarry);
    // 应朝目标预测位置移动(目标朝 +Z,预测位置 z > 0)
    expect(f.z).toBeGreaterThan(0);
  });

  it('evade 朝远离预测位置的方向', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const pursuer = makeAgent([5, 0, 0], [0, 0, 0]);
    const f = steer.evade(agent, pursuer);
    // pursuer 在 +X,应朝 -X 逃避
    expect(f.x).toBeLessThan(0);
  });

  it('evade 距离过远不产生力', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const pursuer = makeAgent([100, 0, 0], [0, 0, 0]);
    const f = steer.evade(agent, pursuer);
    expect(f.lengthSq()).toBe(0);
  });

  it('wander 产生非零力', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0], [1, 0, 0]);
    const f = steer.wander(agent);
    expect(f.lengthSq()).toBeGreaterThan(0);
  });

  it('separation 与拥挤邻居产生排斥力', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const neighbors = [
      makeAgent([0.5, 0, 0]), // 在 agent 半径内
      makeAgent([-0.4, 0, 0.3]),
    ];
    const f = steer.separation(agent, neighbors);
    expect(f.lengthSq()).toBeGreaterThan(0);
  });

  it('separation 无邻居不产生力', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const f = steer.separation(agent, []);
    expect(f.lengthSq()).toBe(0);
  });

  it('alignment 对齐邻居平均速度', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const neighbors = [
      makeAgent([2, 0, 0], [0, 0, 5]),
      makeAgent([3, 0, 0], [0, 0, 3]),
    ];
    const f = steer.alignment(agent, neighbors);
    // 平均速度朝 +Z
    expect(f.z).toBeGreaterThan(0);
  });

  it('cohesion 朝邻居中心移动', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0]);
    const neighbors = [
      makeAgent([5, 0, 0]),
      makeAgent([5, 0, 5]),
    ];
    const f = steer.cohesion(agent, neighbors);
    // 中心在 (5, 0, 2.5),应朝 +X
    expect(f.x).toBeGreaterThan(0);
  });

  it('obstacleAvoidance 前方有障碍产生避让力', () => {
    const steer = new SteeringBehavior();
    // wanderDistance 默认 2 → ahead 距离 = 2*wanderDistance = 4
    // 把障碍放在 ahead 点附近,确保 ahead 落入障碍球
    const agent = makeAgent([0, 0, 0], [1, 0, 0]); // 朝 +X
    const obstacles = [{ position: new Vector3(4, 0, 0), radius: 1 }];
    const f = steer.obstacleAvoidance(agent, obstacles);
    expect(f.lengthSq()).toBeGreaterThan(0);
  });

  it('obstacleAvoidance 前方无障碍不产生力', () => {
    const steer = new SteeringBehavior();
    const agent = makeAgent([0, 0, 0], [1, 0, 0]);
    const obstacles = [{ position: new Vector3(100, 0, 0), radius: 1 }];
    const f = steer.obstacleAvoidance(agent, obstacles);
    expect(f.lengthSq()).toBe(0);
  });
});
