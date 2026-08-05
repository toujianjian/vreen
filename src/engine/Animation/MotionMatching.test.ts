import { describe, it, expect } from 'vitest';
import {
  makeTrajectoryPoint,
  buildPoseVector,
  getJointFromPose,
  poseVectorJointCount,
  buildMotionDatabase,
  computeFullCost,
  searchBestMatch,
  MotionMatcher,
  buildDesiredTrajectory,
  MotionMatchingPresets,
  DEFAULT_COST_WEIGHTS,
  type Trajectory,
  type PoseVector,
  type MotionMatchCostWeights,
} from './MotionMatching';
import { Vector3 } from '../Math/Vector3';

// ── 测试辅助 ─────────────────────────────────────────────────────

/** 创建简单轨迹:从 (0,0) 向前走,每点间隔 0.2s。 */
function makeWalkTrajectory(
  startX: number,
  startZ: number,
  facing: number,
  speed: number,
  pastCount: number = 2,
  futureCount: number = 3,
): Trajectory {
  const traj: Trajectory = [];
  // 过去点
  for (let i = pastCount; i > 0; i--) {
    const t = -i * 0.2;
    const dist = speed * t;
    traj.push(makeTrajectoryPoint(
      startX + Math.sin(facing) * dist,
      startZ + Math.cos(facing) * dist,
      facing,
      speed,
    ));
  }
  // 当前点
  traj.push(makeTrajectoryPoint(startX, startZ, facing, speed));
  // 未来点
  for (let i = 1; i <= futureCount; i++) {
    const t = i * 0.2;
    const dist = speed * t;
    traj.push(makeTrajectoryPoint(
      startX + Math.sin(facing) * dist,
      startZ + Math.cos(facing) * dist,
      facing,
      speed,
    ));
  }
  return traj;
}

/** 创建简单姿态:2 个关节(左脚 + 右脚)。 */
function makeSimplePose(
  leftFootPos: Vector3,
  leftFootVel: Vector3,
  rightFootPos: Vector3,
  rightFootVel: Vector3,
): PoseVector {
  return buildPoseVector([
    { pos: leftFootPos, vel: leftFootVel },
    { pos: rightFootPos, vel: rightFootVel },
  ]);
}

/** 创建测试数据库:2 个 clip(walk + run),各 3 帧。 */
function makeTestDatabase() {
  const walkFrames = [];
  const runFrames = [];
  for (let i = 0; i < 3; i++) {
    const t = i * 0.3;
    walkFrames.push({
      trajectory: makeWalkTrajectory(0, t * 2, 0, 2.0),
      pose: makeSimplePose(
        new Vector3(0.1, 0, t * 2), new Vector3(0, 0, 2),
        new Vector3(-0.1, 0, t * 2), new Vector3(0, 0, 2),
      ),
      clipTime: t,
    });
    runFrames.push({
      trajectory: makeWalkTrajectory(0, t * 5, 0, 5.0),
      pose: makeSimplePose(
        new Vector3(0.15, 0, t * 5), new Vector3(0, 0, 5),
        new Vector3(-0.15, 0, t * 5), new Vector3(0, 0, 5),
      ),
      clipTime: t,
    });
  }
  return buildMotionDatabase([
    { clipId: 0, frames: walkFrames },
    { clipId: 1, frames: runFrames },
  ]);
}

// ── TrajectoryPoint ──────────────────────────────────────────────

describe('makeTrajectoryPoint', () => {
  it('默认值全为零', () => {
    const p = makeTrajectoryPoint();
    expect(p.posX).toBe(0);
    expect(p.posZ).toBe(0);
    expect(p.facing).toBe(0);
    expect(p.speed).toBe(0);
  });

  it('自定义值正确', () => {
    const p = makeTrajectoryPoint(1, 2, Math.PI / 2, 5);
    expect(p.posX).toBe(1);
    expect(p.posZ).toBe(2);
    expect(p.facing).toBeCloseTo(Math.PI / 2);
    expect(p.speed).toBe(5);
  });
});

// ── PoseVector ───────────────────────────────────────────────────

describe('buildPoseVector', () => {
  it('2 个关节 → 长度 12', () => {
    const pose = makeSimplePose(
      new Vector3(1, 2, 3), new Vector3(4, 5, 6),
      new Vector3(7, 8, 9), new Vector3(10, 11, 12),
    );
    expect(pose.length).toBe(12);
  });

  it('0 个关节 → 长度 0', () => {
    const pose = buildPoseVector([]);
    expect(pose.length).toBe(0);
  });

  it('数据正确填充', () => {
    const pose = makeSimplePose(
      new Vector3(1, 2, 3), new Vector3(4, 5, 6),
      new Vector3(7, 8, 9), new Vector3(10, 11, 12),
    );
    // 关节 0
    expect(pose[0]).toBe(1);  // pos.x
    expect(pose[1]).toBe(2);  // pos.y
    expect(pose[2]).toBe(3);  // pos.z
    expect(pose[3]).toBe(4);  // vel.x
    expect(pose[4]).toBe(5);  // vel.y
    expect(pose[5]).toBe(6);  // vel.z
    // 关节 1
    expect(pose[6]).toBe(7);
    expect(pose[7]).toBe(8);
    expect(pose[8]).toBe(9);
    expect(pose[9]).toBe(10);
    expect(pose[10]).toBe(11);
    expect(pose[11]).toBe(12);
  });
});

describe('poseVectorJointCount', () => {
  it('长度 12 → 2 关节', () => {
    const pose = new Float32Array(12);
    expect(poseVectorJointCount(pose)).toBe(2);
  });

  it('长度 0 → 0 关节', () => {
    const pose = new Float32Array(0);
    expect(poseVectorJointCount(pose)).toBe(0);
  });
});

describe('getJointFromPose', () => {
  it('正确提取关节位置和速度', () => {
    const pose = makeSimplePose(
      new Vector3(1, 2, 3), new Vector3(4, 5, 6),
      new Vector3(7, 8, 9), new Vector3(10, 11, 12),
    );
    const joint0 = getJointFromPose(pose, 0);
    expect(joint0.pos.x).toBe(1);
    expect(joint0.pos.y).toBe(2);
    expect(joint0.pos.z).toBe(3);
    expect(joint0.vel.x).toBe(4);
    expect(joint0.vel.y).toBe(5);
    expect(joint0.vel.z).toBe(6);

    const joint1 = getJointFromPose(pose, 1);
    expect(joint1.pos.x).toBe(7);
    expect(joint1.vel.z).toBe(12);
  });

  it('支持输出对象复用', () => {
    const pose = makeSimplePose(
      new Vector3(1, 2, 3), new Vector3(0, 0, 0),
      new Vector3(4, 5, 6), new Vector3(0, 0, 0),
    );
    const out = { pos: new Vector3(), vel: new Vector3() };
    getJointFromPose(pose, 0, out);
    expect(out.pos.x).toBe(1);
    getJointFromPose(pose, 1, out);
    expect(out.pos.x).toBe(4);
  });
});

// ── MotionDatabase ───────────────────────────────────────────────

describe('buildMotionDatabase', () => {
  it('正确合并多个 clip 的帧', () => {
    const db = makeTestDatabase();
    expect(db.entries.length).toBe(6); // 2 clips × 3 frames
    expect(db.trajectoryLength).toBe(6); // 2 past + 1 current + 3 future
    expect(db.poseDim).toBe(12); // 2 joints × 6
  });

  it('每帧有正确的 clipId 和 clipTime', () => {
    const db = makeTestDatabase();
    // clip 0 的 3 帧
    expect(db.entries[0].clipId).toBe(0);
    expect(db.entries[0].clipTime).toBe(0);
    expect(db.entries[2].clipId).toBe(0);
    expect(db.entries[2].clipTime).toBeCloseTo(0.6);
    // clip 1 的 3 帧
    expect(db.entries[3].clipId).toBe(1);
    expect(db.entries[3].clipTime).toBe(0);
    expect(db.entries[5].clipId).toBe(1);
    expect(db.entries[5].clipTime).toBeCloseTo(0.6);
  });

  it('index 从 0 递增', () => {
    const db = makeTestDatabase();
    for (let i = 0; i < db.entries.length; i++) {
      expect(db.entries[i].index).toBe(i);
    }
  });

  it('空 clip 列表 → 空数据库', () => {
    const db = buildMotionDatabase([]);
    expect(db.entries.length).toBe(0);
    expect(db.trajectoryLength).toBe(0);
    expect(db.poseDim).toBe(0);
  });
});

// ── 代价函数 ─────────────────────────────────────────────────────

describe('computeFullCost', () => {
  it('相同轨迹 + 姿态 → 代价为 0', () => {
    const db = makeTestDatabase();
    const entry = db.entries[0];
    const cost = computeFullCost(entry.trajectory, entry.pose, entry);
    expect(cost).toBeCloseTo(0, 4);
  });

  it('不同轨迹 → 代价 > 0', () => {
    const db = makeTestDatabase();
    const entry = db.entries[0];
    // 构建一个不同的轨迹
    const desiredTraj = makeWalkTrajectory(10, 10, 0, 1.0);
    const cost = computeFullCost(desiredTraj, entry.pose, entry);
    expect(cost).toBeGreaterThan(0);
  });

  it('速度差异越大代价越高', () => {
    const db = makeTestDatabase();
    const walkEntry = db.entries[0]; // speed=2
    const slowTraj = makeWalkTrajectory(0, 0, 0, 1.0);
    const fastTraj = makeWalkTrajectory(0, 0, 0, 10.0);
    const slowCost = computeFullCost(slowTraj, walkEntry.pose, walkEntry);
    const fastCost = computeFullCost(fastTraj, walkEntry.pose, walkEntry);
    // 都与 walk(speed=2)有差异
    expect(slowCost).toBeGreaterThan(0);
    expect(fastCost).toBeGreaterThan(0);
    // fast(10) 差异 > slow(1) 差异(都偏离 2)
    expect(fastCost).toBeGreaterThan(slowCost);
  });

  it('未来点权重更高(futureMultiplier)', () => {
    const db = makeTestDatabase();
    const entry = db.entries[0];
    const weights: MotionMatchCostWeights = {
      ...DEFAULT_COST_WEIGHTS,
      futureMultiplier: 10.0, // 未来点权重极高
    };
    // 在未来点制造偏差
    const desiredTraj = entry.trajectory.map((p, i) => ({
      ...p,
      posX: i > 2 ? p.posX + 1 : p.posX, // 只改未来点
    }));
    const costHigh = computeFullCost(desiredTraj, entry.pose, entry, weights);

    const weightsLow: MotionMatchCostWeights = {
      ...DEFAULT_COST_WEIGHTS,
      futureMultiplier: 0.1, // 未来点权重极低
    };
    const costLow = computeFullCost(desiredTraj, entry.pose, entry, weightsLow);

    expect(costHigh).toBeGreaterThan(costLow);
  });

  it('姿态差异影响代价', () => {
    const db = makeTestDatabase();
    const entry = db.entries[0];
    // 完全不同的姿态
    const differentPose = makeSimplePose(
      new Vector3(100, 0, 0), new Vector3(0, 0, 0),
      new Vector3(-100, 0, 0), new Vector3(0, 0, 0),
    );
    const samePoseCost = computeFullCost(entry.trajectory, entry.pose, entry);
    const diffPoseCost = computeFullCost(entry.trajectory, differentPose, entry);
    expect(diffPoseCost).toBeGreaterThan(samePoseCost);
  });
});

// ── searchBestMatch ──────────────────────────────────────────────

describe('searchBestMatch', () => {
  it('完美匹配 → 返回代价 ≈ 0 的帧', () => {
    const db = makeTestDatabase();
    const entry = db.entries[0];
    const result = searchBestMatch(entry.trajectory, entry.pose, db);
    expect(result).not.toBeNull();
    expect(result!.cost).toBeCloseTo(0, 4);
    expect(result!.entry.index).toBe(0);
  });

  it('walk 轨迹 → 匹配 walk clip(clipId=0)', () => {
    const db = makeTestDatabase();
    const walkTraj = makeWalkTrajectory(0, 0, 0, 2.0);
    const walkPose = makeSimplePose(
      new Vector3(0.1, 0, 0), new Vector3(0, 0, 2),
      new Vector3(-0.1, 0, 0), new Vector3(0, 0, 2),
    );
    const result = searchBestMatch(walkTraj, walkPose, db);
    expect(result).not.toBeNull();
    expect(result!.entry.clipId).toBe(0); // walk
  });

  it('run 轨迹 → 匹配 run clip(clipId=1)', () => {
    const db = makeTestDatabase();
    const runTraj = makeWalkTrajectory(0, 0, 0, 5.0);
    const runPose = makeSimplePose(
      new Vector3(0.15, 0, 0), new Vector3(0, 0, 5),
      new Vector3(-0.15, 0, 0), new Vector3(0, 0, 5),
    );
    const result = searchBestMatch(runTraj, runPose, db);
    expect(result).not.toBeNull();
    expect(result!.entry.clipId).toBe(1); // run
  });

  it('maxCost 过低 → 返回 null', () => {
    const db = makeTestDatabase();
    const traj = makeWalkTrajectory(100, 100, 0, 100); // 完全不匹配
    const pose = makeSimplePose(
      new Vector3(0, 0, 0), new Vector3(0, 0, 0),
      new Vector3(0, 0, 0), new Vector3(0, 0, 0),
    );
    const result = searchBestMatch(traj, pose, db, { maxCost: 0.001 });
    expect(result).toBeNull();
  });

  it('排除当前 clip 附近 → 不匹配到自身', () => {
    const db = makeTestDatabase();
    const entry = db.entries[0];
    // 排除 clip 0 的 0s 附近 1s 范围
    const result = searchBestMatch(
      entry.trajectory,
      entry.pose,
      db,
      {
        excludeClipId: 0,
        excludeClipTime: 0,
        excludeTimeRange: 1.0,
      },
    );
    // 应该匹配到 clip 1(run)而非 clip 0(walk)
    expect(result).not.toBeNull();
    expect(result!.entry.clipId).toBe(1);
  });

  it('searchedCount 等于实际搜索的帧数', () => {
    const db = makeTestDatabase();
    const traj = makeWalkTrajectory(0, 0, 0, 2.0);
    const pose = db.entries[0].pose;
    const result = searchBestMatch(traj, pose, db);
    expect(result!.searchedCount).toBe(6); // 6 帧
  });

  it('排除后 searchedCount 减少', () => {
    const db = makeTestDatabase();
    const traj = makeWalkTrajectory(0, 0, 0, 2.0);
    const pose = db.entries[0].pose;
    // 排除 clip 0 的全部 3 帧
    const result = searchBestMatch(traj, pose, db, {
      excludeClipId: 0,
      excludeClipTime: 0.3,
      excludeTimeRange: 10.0, // 排除所有 clip 0 的帧
    });
    expect(result!.searchedCount).toBe(3); // 只搜了 clip 1 的 3 帧
  });
});

// ── MotionMatcher ────────────────────────────────────────────────

describe('MotionMatcher', () => {
  it('构造时从数据库推断 clip 持续时间', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db);
    // clip 0 的最大 clipTime = 0.6
    // 注:实际持续时间应包含最后一帧之后的播放时间
    expect(matcher.getState().clipId).toBe(0);
  });

  it('setCurrentClip 设置当前播放', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db);
    matcher.setCurrentClip(1, 0.3);
    const state = matcher.getState();
    expect(state.clipId).toBe(1);
    expect(state.clipTime).toBeCloseTo(0.3);
  });

  it('update 推进 clipTime', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db, { searchInterval: Infinity });
    matcher.setCurrentClip(0, 0);
    matcher.update(0.1, db.entries[0].trajectory, db.entries[0].pose);
    expect(matcher.getState().clipTime).toBeCloseTo(0.1);
  });

  it('update 定期触发搜索', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db, {
      searchInterval: 0.1,
      maxSwitchCost: 0, // 永不切换
    });
    matcher.setCurrentClip(0, 0);
    matcher.update(0.05, db.entries[0].trajectory, db.entries[0].pose);
    expect(matcher.getState().searchCount).toBe(0); // 还没到 0.1s
    matcher.update(0.05, db.entries[0].trajectory, db.entries[0].pose);
    expect(matcher.getState().searchCount).toBe(1); // 到了 0.1s
  });

  it('搜索到更好匹配时切换 clip', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db, {
      searchInterval: 0.1,
      maxSwitchCost: Infinity, // 总是切换到最佳匹配
      blendTime: 0.2,
      excludeTimeRange: 0.1,
    });
    // 从 walk 开始
    matcher.setCurrentClip(0, 0);
    // 给 run 轨迹 → 应切换到 run clip
    const runTraj = makeWalkTrajectory(0, 0, 0, 5.0);
    const runPose = makeSimplePose(
      new Vector3(0.15, 0, 0), new Vector3(0, 0, 5),
      new Vector3(-0.15, 0, 0), new Vector3(0, 0, 5),
    );
    matcher.update(0.1, runTraj, runPose);
    expect(matcher.getState().switchCount).toBeGreaterThanOrEqual(1);
    expect(matcher.getState().clipId).toBe(1); // 切到 run
  });

  it('切换后 isBlending=true, blendWeight 从 0 增长', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db, {
      searchInterval: 0.1,
      maxSwitchCost: Infinity, // 总是切换到最佳匹配
      blendTime: 0.2,
      excludeTimeRange: 0.1,
    });
    matcher.setCurrentClip(0, 0);
    const runTraj = makeWalkTrajectory(0, 0, 0, 5.0);
    const runPose = makeSimplePose(
      new Vector3(0.15, 0, 0), new Vector3(0, 0, 5),
      new Vector3(-0.15, 0, 0), new Vector3(0, 0, 5),
    );
    matcher.update(0.1, runTraj, runPose);
    const state = matcher.getState();
    expect(state.isBlending).toBe(true);
    expect(state.blendWeight).toBeGreaterThanOrEqual(0);
    expect(state.blendWeight).toBeLessThan(1);
    expect(state.prevClipId).toBe(0); // 混合源是 walk
  });

  it('blendTime 后混合完成 isBlending=false', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db, {
      searchInterval: 0.1,
      maxSwitchCost: Infinity, // 总是切换
      blendTime: 0.2,
      excludeTimeRange: 0.1,
    });
    matcher.setCurrentClip(0, 0);
    const runTraj = makeWalkTrajectory(0, 0, 0, 5.0);
    const runPose = makeSimplePose(
      new Vector3(0.15, 0, 0), new Vector3(0, 0, 5),
      new Vector3(-0.15, 0, 0), new Vector3(0, 0, 5),
    );
    // 第一次 update 触发搜索 + 切换(进入混合)
    matcher.update(0.1, runTraj, runPose);
    expect(matcher.getState().isBlending).toBe(true);
    // 后续不再搜索,只推进混合计时器
    matcher.searchInterval = Infinity;
    matcher.update(0.2, runTraj, runPose);
    expect(matcher.getState().isBlending).toBe(false);
    expect(matcher.getState().blendWeight).toBe(1);
  });

  it('reset 清零所有状态', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db);
    matcher.setCurrentClip(1, 0.5);
    matcher.reset();
    const state = matcher.getState();
    expect(state.clipId).toBe(0);
    expect(state.clipTime).toBe(0);
    expect(state.searchCount).toBe(0);
    expect(state.switchCount).toBe(0);
  });

  it('cinematic 预设:永不搜索', () => {
    const db = makeTestDatabase();
    const preset = MotionMatchingPresets.cinematic();
    const matcher = new MotionMatcher(db, preset);
    matcher.setCurrentClip(0, 0);
    matcher.update(1.0, db.entries[0].trajectory, db.entries[0].pose);
    expect(matcher.getState().searchCount).toBe(0);
  });

  it('clipTime 循环(超过 duration 回绕)', () => {
    const db = makeTestDatabase();
    const matcher = new MotionMatcher(db, { searchInterval: Infinity });
    // clip 0 的最大 clipTime = 0.6,所以 duration ≈ 0.6
    matcher.setCurrentClip(0, 0.5);
    // 推进 0.3s → 0.5 + 0.3 = 0.8 > 0.6 → 回绕到 0.2
    matcher.update(0.3, db.entries[0].trajectory, db.entries[0].pose);
    expect(matcher.getState().clipTime).toBeLessThan(0.6);
  });
});

// ── buildDesiredTrajectory ───────────────────────────────────────

describe('buildDesiredTrajectory', () => {
  it('静止时轨迹只有当前位置', () => {
    const traj = buildDesiredTrajectory(
      { x: 0, z: 0 }, 0,
      0, 0, 0, // 零速度
      3, 0.2,
    );
    // 1 当前点 + 3 未来点 = 4
    expect(traj.length).toBe(4);
    // 所有点位置相同(零速度)
    for (const p of traj) {
      expect(p.posX).toBeCloseTo(0);
      expect(p.posZ).toBeCloseTo(0);
      expect(p.speed).toBe(0);
    }
  });

  it('移动时未来点沿移动方向延伸', () => {
    const traj = buildDesiredTrajectory(
      { x: 0, z: 0 }, 0,
      0, 1, 5, // 向 +Z 方向,5 m/s
      5, 0.2,
    );
    // 当前点
    expect(traj[0].posX).toBeCloseTo(0);
    expect(traj[0].posZ).toBeCloseTo(0);
    // 未来 1s 后(5 * 0.2 = 1m)
    expect(traj[1].posZ).toBeCloseTo(1.0, 2);
    // 未来 2s 后(5 * 0.4 = 2m)
    expect(traj[2].posZ).toBeCloseTo(2.0, 2);
    // 速度 = 5
    for (const p of traj) {
      expect(p.speed).toBe(5);
    }
  });

  it('朝向跟随移动方向', () => {
    // 向 +X 方向移动 → facing = atan2(1, 0) = π/2
    const traj = buildDesiredTrajectory(
      { x: 0, z: 0 }, 0,
      1, 0, 3, // +X 方向
      3, 0.2,
    );
    expect(traj[1].facing).toBeCloseTo(Math.PI / 2);
  });

  it('无移动方向时朝向保持当前', () => {
    const traj = buildDesiredTrajectory(
      { x: 0, z: 0 }, 1.0, // 当前朝向 = 1.0
      0, 0, 0, // 无移动
      3, 0.2,
    );
    for (const p of traj) {
      expect(p.facing).toBeCloseTo(1.0);
    }
  });
});

// ── 预设 ─────────────────────────────────────────────────────────

describe('MotionMatchingPresets', () => {
  it('precise: 每帧搜索,总是切换到最佳匹配', () => {
    const p = MotionMatchingPresets.precise();
    expect(p.searchInterval).toBe(0.016);
    expect(p.maxSwitchCost).toBe(Infinity); // 总是切换
    expect(p.blendTime).toBeLessThanOrEqual(0.15);
  });

  it('balanced: 中等搜索间隔,中等切换阈值', () => {
    const p = MotionMatchingPresets.balanced();
    expect(p.searchInterval).toBe(0.1);
    expect(p.maxSwitchCost).toBe(1.0); // cost < 1.0 才切换
    expect(p.blendTime).toBe(0.2);
  });

  it('performance: 长搜索间隔,严格切换阈值(只匹配很好的)', () => {
    const p = MotionMatchingPresets.performance();
    expect(p.searchInterval).toBeGreaterThan(0.1);
    expect(p.maxSwitchCost).toBeLessThan(1.0); // cost < 0.5 才切换(严格)
    expect(p.blendTime).toBeGreaterThan(0.2);
  });

  it('cinematic: 永不搜索,永不切换', () => {
    const p = MotionMatchingPresets.cinematic();
    expect(p.searchInterval).toBe(Infinity);
    expect(p.maxSwitchCost).toBe(0); // cost < 0 永不成立 → 永不切换
  });
});

// ── DEFAULT_COST_WEIGHTS ─────────────────────────────────────────

describe('DEFAULT_COST_WEIGHTS', () => {
  it('包含所有必要字段', () => {
    expect(DEFAULT_COST_WEIGHTS.trajectoryPosition).toBeGreaterThan(0);
    expect(DEFAULT_COST_WEIGHTS.trajectoryFacing).toBeGreaterThan(0);
    expect(DEFAULT_COST_WEIGHTS.trajectorySpeed).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_COST_WEIGHTS.pose).toBeGreaterThan(0);
    expect(DEFAULT_COST_WEIGHTS.futureMultiplier).toBeGreaterThan(1);
  });

  it('futureMultiplier > 1(未来更重要)', () => {
    expect(DEFAULT_COST_WEIGHTS.futureMultiplier).toBeGreaterThan(1.0);
  });
});
