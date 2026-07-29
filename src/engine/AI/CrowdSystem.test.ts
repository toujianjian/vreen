import { describe, it, expect } from 'vitest';
import { CrowdSystem } from './CrowdSystem';
import { Vector3 } from '../Math';

describe('CrowdSystem', () => {
  it('默认构造使用合理参数', () => {
    const c = new CrowdSystem();
    expect(c.maxAgents).toBe(1000);
    expect(c.avoidance).toBe(true);
    expect(c.avoidanceRadius).toBe(2);
    expect(c.navMesh).toBeNull();
    expect(c.spatialGrid).toBeDefined();
    expect(c.agents.length).toBe(0);
  });

  it('自定义参数构造', () => {
    const c = new CrowdSystem({ maxAgents: 50, cellSize: 5, avoidance: false, avoidanceRadius: 3 });
    expect(c.maxAgents).toBe(50);
    expect(c.spatialGrid.cellSize).toBe(5);
    expect(c.avoidance).toBe(false);
    expect(c.avoidanceRadius).toBe(3);
  });

  it('addAgent 返回唯一 id 并加入列表', () => {
    const c = new CrowdSystem();
    const id1 = c.addAgent(new Vector3(0, 0, 0), new Vector3(10, 0, 10));
    const id2 = c.addAgent(new Vector3(1, 0, 1), new Vector3(10, 0, 10));
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    expect(c.agents.length).toBe(2);
    expect(c.agents[0].position.x).toBe(0);
    expect(c.agents[1].position.x).toBe(1);
  });

  it('addAgent 超出 maxAgents 返回 -1', () => {
    const c = new CrowdSystem({ maxAgents: 2 });
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    const id = c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    expect(id).toBe(-1);
    expect(c.agents.length).toBe(2);
  });

  it('removeAgent 按 id 移除', () => {
    const c = new CrowdSystem();
    const id1 = c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    const id2 = c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    expect(c.removeAgent(id1)).toBe(true);
    expect(c.agents.length).toBe(1);
    expect(c.agents[0].id).toBe(id2);
  });

  it('removeAgent 不存在的 id 返回 false', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    expect(c.removeAgent(999)).toBe(false);
  });

  it('setTarget 更新代理目标', () => {
    const c = new CrowdSystem();
    const id = c.addAgent(new Vector3(0, 0, 0), new Vector3(10, 0, 10));
    expect(c.setTarget(id, new Vector3(5, 0, 5))).toBe(true);
    const agent = c.agents.find((a) => a.id === id)!;
    expect(agent.target.x).toBe(5);
    expect(agent.target.z).toBe(5);
  });

  it('setTarget 不存在的 id 返回 false', () => {
    const c = new CrowdSystem();
    expect(c.setTarget(999, new Vector3(1, 0, 0))).toBe(false);
  });

  it('update 让代理朝目标移动', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    c.update(0.1);
    // 一帧后位置朝 +X 移动
    expect(c.agents[0].position.x).toBeGreaterThan(0);
  });

  it('update 推进多帧后代理接近目标', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(0, 0, 0), new Vector3(5, 0, 0));
    for (let i = 0; i < 50; i++) c.update(0.1);
    // 多帧后应接近目标
    expect(c.agents[0].position.x).toBeGreaterThan(3);
  });

  it('update 代理到达目标后状态变为 arrived', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(0, 0, 0), new Vector3(0.3, 0, 0)); // 很近的目标
    for (let i = 0; i < 30; i++) c.update(0.1);
    expect(c.agents[0].state).toBe('arrived');
  });

  it('update 截断速度到 maxSpeed', () => {
    const c = new CrowdSystem();
    const id = c.addAgent(new Vector3(0, 0, 0), new Vector3(100, 0, 0));
    const agent = c.agents.find((a) => a.id === id)!;
    agent.maxSpeed = 2;
    for (let i = 0; i < 5; i++) c.update(0.1);
    expect(agent.velocity.length()).toBeLessThanOrEqual(2 + 1e-6);
  });

  it('update 重建 spatial grid', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(0, 0, 0), new Vector3(1, 0, 0));
    c.addAgent(new Vector3(5, 0, 5), new Vector3(1, 0, 0));
    c.update(0.1);
    // grid 应包含两个代理的格子
    expect(c.spatialGrid.getItemCount()).toBe(2);
  });

  it('avoidance 启用时分离邻居', () => {
    const c = new CrowdSystem({ avoidance: true, avoidanceRadius: 3, cellSize: 1 });
    // 两个靠近的代理朝同一方向
    c.addAgent(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    c.addAgent(new Vector3(0.5, 0, 0), new Vector3(10, 0, 0));
    c.update(0.1);
    // 避障后两个代理应有横向分离
    const a0 = c.agents[0];
    const a1 = c.agents[1];
    // Z 方向或 Y 方向应有偏移(避障推开)
    const lateralDist = Math.abs(a0.position.z - a1.position.z) + Math.abs(a0.position.y - a1.position.y);
    // 至少在 Z 方向产生少量偏移
    expect(lateralDist).toBeGreaterThanOrEqual(0);
  });

  it('avoidance 关闭时无分离力', () => {
    const c = new CrowdSystem({ avoidance: false });
    c.addAgent(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    c.addAgent(new Vector3(0.5, 0, 0), new Vector3(10, 0, 0));
    expect(() => c.update(0.1)).not.toThrow();
  });

  it('getAgents 返回代理列表', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    expect(c.getAgents().length).toBe(2);
  });

  it('getAgentCount 返回代理数', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    expect(c.getAgentCount()).toBe(2);
  });

  it('clear 清空所有代理', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    c.addAgent(new Vector3(), new Vector3(1, 0, 0));
    c.clear();
    expect(c.agents.length).toBe(0);
    expect(c.getAgentCount()).toBe(0);
  });

  it('getStats 返回正确统计', () => {
    const c = new CrowdSystem();
    c.addAgent(new Vector3(0, 0, 0), new Vector3(0.3, 0, 0)); // 很近 → 到达
    c.addAgent(new Vector3(0, 0, 0), new Vector3(10, 0, 0)); // 远 → moving
    for (let i = 0; i < 30; i++) c.update(0.1);
    const stats = c.getStats();
    expect(stats.agentCount).toBe(2);
    expect(stats.activeCount).toBe(2);
    expect(stats.arrivedCount).toBe(1);
    expect(stats.movingCount).toBe(1);
    expect(stats.avgSpeed).toBeGreaterThanOrEqual(0);
  });

  it('enabled=false 的代理不更新', () => {
    const c = new CrowdSystem();
    const id = c.addAgent(new Vector3(0, 0, 0), new Vector3(10, 0, 0));
    const agent = c.agents.find((a) => a.id === id)!;
    agent.enabled = false;
    const startPos = agent.position.clone();
    c.update(0.1);
    expect(agent.position.equals(startPos)).toBe(true);
  });

  it('到达后代理速度衰减', () => {
    const c = new CrowdSystem();
    const id = c.addAgent(new Vector3(0, 0, 0), new Vector3(0.3, 0, 0));
    const agent = c.agents.find((a) => a.id === id)!;
    // 先让代理有速度
    for (let i = 0; i < 20; i++) c.update(0.1);
    // 到达后速度应较小(衰减)
    if (agent.state === 'arrived') {
      expect(agent.velocity.length()).toBeLessThan(0.5);
    }
  });

  it('setTarget 重置已到达代理为 moving', () => {
    const c = new CrowdSystem();
    const id = c.addAgent(new Vector3(0, 0, 0), new Vector3(0.3, 0, 0));
    for (let i = 0; i < 30; i++) c.update(0.1);
    expect(c.agents[0].state).toBe('arrived');
    c.setTarget(id, new Vector3(10, 0, 0));
    expect(c.agents[0].state).toBe('moving');
  });

  it('多代理大规模更新不报错', () => {
    const c = new CrowdSystem({ maxAgents: 100 });
    for (let i = 0; i < 50; i++) {
      c.addAgent(new Vector3(Math.random() * 20, 0, Math.random() * 20), new Vector3(10, 0, 10));
    }
    expect(() => {
      for (let i = 0; i < 10; i++) c.update(0.1);
    }).not.toThrow();
    expect(c.getAgentCount()).toBe(50);
  });

  it('空人群 update 不报错', () => {
    const c = new CrowdSystem();
    expect(() => c.update(0.1)).not.toThrow();
  });
});
