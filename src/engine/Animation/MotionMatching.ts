// MotionMatching — 动作匹配:数据驱动的动画选择系统。
//
// 设计来源:
//   * Kovar et al. 2002 "Motion Graphs"(SIGGRAPH)
//   * Clavet 2016 "Motion Matching"(GDC)— Ubisoft For Honor 原始实现
//   * UE5 Pose Search 插件 — 搜索 + 成本函数 + 帧混合
//   * o3de EMotionFX MotionMatching — 实验性动作匹配
//   * Holden et al. 2020 "Learned Motion Matching"(SIGGRAPH)
//
// 问题:
//   传统动画状态机需要手动构建状态图:每个状态转换(走→跑、跑→跳)都要
//   美术手动标记过渡条件和混合时间。角色类型多、动作多时,状态图爆炸。
//   玩家输入变化时,角色动画响应慢、不自然。
//
// 解决:
//   Motion Matching 是数据驱动方法:
//   1. 离线阶段:从动捕数据中按固定间隔采样,为每帧提取「轨迹 + 姿态」特征向量。
//      轨迹 = 过去 N 点 + 未来 M 点的位置 + 朝向 + 速度。
//      姿态 = 关键关节(双脚、双手、重心)的位置 + 速度。
//   2. 运行时阶段:从玩家输入计算「期望轨迹」,在数据库中搜索成本最低的帧:
//      cost = w_traj * Σ|traj_desired[i] - traj_db[i]|² + w_pose * Σ|pose_desired - pose_db|²
//   3. 如果最佳帧与当前播放帧差距超过阈值,切换到最佳帧(带混合避免跳变)。
//   4. 从匹配帧继续播放,直到下一次搜索触发切换。
//
// 优势(vs 传统状态机):
//   - 无需手动构建状态图
//   - 自然过渡(直接搜索最佳过渡点)
//   - 响应快(每帧搜索,无需等待状态转换条件)
//   - 可扩展(新增动作只需加入数据库,无需改状态机)
//
// 与 AnimationMixer / AnimationLayerMixer 的关系:
//   Motion Matching 产出的是「从哪个 clip 的哪一帧开始播放」,
//   实际播放仍由 AnimationMixer 驱动。MotionMatcher 是决策层,Mixer 是执行层。
//
// 与 FootPlacementIK 的关系:
//   Motion Matching 保证角色移动方向自然,FootPlacementIK 保证脚贴地。
//   两者配合:Motion Matching 选动作,FootPlacementIK 修脚部。

import { Vector3 } from '../Math/Vector3';

// ── 轨迹 ─────────────────────────────────────────────────────────

/** 轨迹点:某时刻角色根运动的位置 + 朝向 + 速度。 */
export interface TrajectoryPoint {
  /** 水平位置 (x, z),y 忽略(地面运动)。 */
  posX: number;
  posZ: number;
  /** 朝向角(弧度,Y 轴旋转)。 */
  facing: number;
  /** 水平速度(m/s)。 */
  speed: number;
}

/** 创建 TrajectoryPoint。 */
export function makeTrajectoryPoint(
  posX: number = 0,
  posZ: number = 0,
  facing: number = 0,
  speed: number = 0,
): TrajectoryPoint {
  return { posX, posZ, facing, speed };
}

/**
 * 轨迹:过去 N 点 + 未来 M 点的 TrajectoryPoint 数组。
 *
 * 约定:
 *   trajectory[0] = 最远的过去点
 *   trajectory[N-1] = 当前点(t=0)
 *   trajectory[N] = 最近未来点
 *   trajectory[N+M-1] = 最远未来点
 *
 * 常用配置:过去 5 点(1.0s),未来 5 点(1.0s),间隔 0.2s。
 */
export type Trajectory = TrajectoryPoint[];

// ── 姿态向量 ─────────────────────────────────────────────────────

/**
 * 姿态向量:关键关节的位置 + 速度,展平为 Float32Array。
 *
 * 每个关节贡献 6 个 float:posX, posY, posZ, velX, velY, velZ。
 * 关节选择通常是:左脚、右脚、左脚速度、右脚速度、重心。
 *
 * 姿态向量是动画选择的关键特征:相同动作的帧应有相似的关节位置/速度。
 */
export type PoseVector = Float32Array;

/** 姿态向量的关节数(决定向量长度 = jointCount * 6)。 */
export function poseVectorJointCount(pose: PoseVector): number {
  return pose.length / 6;
}

/** 从关节位置 + 速度构建 PoseVector。 */
export function buildPoseVector(
  joints: Array<{ pos: Vector3; vel: Vector3 }>,
): PoseVector {
  const pose = new Float32Array(joints.length * 6);
  for (let i = 0; i < joints.length; i++) {
    const j = joints[i];
    pose[i * 6] = j.pos.x;
    pose[i * 6 + 1] = j.pos.y;
    pose[i * 6 + 2] = j.pos.z;
    pose[i * 6 + 3] = j.vel.x;
    pose[i * 6 + 4] = j.vel.y;
    pose[i * 6 + 5] = j.vel.z;
  }
  return pose;
}

/** 从 PoseVector 提取第 i 个关节的位置 + 速度。 */
export function getJointFromPose(
  pose: PoseVector,
  i: number,
  out?: { pos: Vector3; vel: Vector3 },
): { pos: Vector3; vel: Vector3 } {
  const result = out ?? { pos: new Vector3(), vel: new Vector3() };
  result.pos.set(pose[i * 6], pose[i * 6 + 1], pose[i * 6 + 2]);
  result.vel.set(pose[i * 6 + 3], pose[i * 6 + 4], pose[i * 6 + 5]);
  return result;
}

// ── 数据库帧 ─────────────────────────────────────────────────────

/** 数据库中的一个帧条目:轨迹 + 姿态 + 来源信息。 */
export interface MotionDBEntry {
  /** 此帧的轨迹(过去 + 未来)。 */
  trajectory: Trajectory;
  /** 此帧的姿向向量。 */
  pose: PoseVector;
  /** 来源 clip 的 ID。 */
  clipId: number;
  /** 在 clip 内的时间(秒)。 */
  clipTime: number;
  /** 此帧在数据库中的索引(构建后填充)。 */
  index: number;
}

/** 动作匹配数据库。 */
export interface MotionDatabase {
  /** 所有帧条目。 */
  entries: MotionDBEntry[];
  /** 轨迹长度(过去 + 未来点数)。 */
  trajectoryLength: number;
  /** 姿态向量长度(float 数)。 */
  poseDim: number;
}

/**
 * 构建动作匹配数据库。
 *
 * 输入:多个动作 clip,每个 clip 是一系列帧(每帧有轨迹 + 姿态)。
 * 输出:统一的 MotionDatabase,所有帧展平到一个数组,带索引。
 */
export function buildMotionDatabase(
  clips: Array<{
    clipId: number;
    frames: Array<{ trajectory: Trajectory; pose: PoseVector; clipTime: number }>;
  }>,
): MotionDatabase {
  const entries: MotionDBEntry[] = [];
  let trajectoryLength = 0;
  let poseDim = 0;

  for (const clip of clips) {
    for (const frame of clip.frames) {
      if (trajectoryLength === 0) trajectoryLength = frame.trajectory.length;
      if (poseDim === 0) poseDim = frame.pose.length;
      entries.push({
        trajectory: frame.trajectory,
        pose: frame.pose,
        clipId: clip.clipId,
        clipTime: frame.clipTime,
        index: entries.length,
      });
    }
  }

  return { entries, trajectoryLength, poseDim };
}

// ── 代价函数 ─────────────────────────────────────────────────────

/** 代价计算权重。 */
export interface MotionMatchCostWeights {
  /** 轨迹位置权重(每个点)。 */
  trajectoryPosition: number;
  /** 轨迹朝向权重(每个点)。 */
  trajectoryFacing: number;
  /** 轨迹速度权重(每个点)。 */
  trajectorySpeed: number;
  /** 姿态权重(每个关节)。 */
  pose: number;
  /** 未来轨迹相对于过去的倍率(未来更重要)。 */
  futureMultiplier: number;
}

/** 默认权重(参考 Clavet 2016 GDC 演讲推荐值)。 */
export const DEFAULT_COST_WEIGHTS: MotionMatchCostWeights = {
  trajectoryPosition: 1.0,
  trajectoryFacing: 1.0,
  trajectorySpeed: 0.5,
  pose: 0.8,
  futureMultiplier: 1.5,
};

/**
 * 计算期望轨迹与数据库帧之间的代价。
 *
 * cost = Σ_{i} [w_pos * |pos_diff|² + w_facing * angle_diff² + w_speed * speed_diff²] * futureMult(i)
 *      + w_pose * Σ_{j} |pose_diff[j]|²
 *
 * 未来点的权重乘以 futureMultiplier,因为未来轨迹对玩家意图更重要。
 *
 * 角度差用最短弧:|wrap(θ)| = |((θ + π) mod 2π) - π|。
 */
export function computeMotionCost(
  desiredTrajectory: Trajectory,
  dbEntry: MotionDBEntry,
  weights: MotionMatchCostWeights = DEFAULT_COST_WEIGHTS,
): number {
  const traj = dbEntry.trajectory;
  const n = Math.min(desiredTrajectory.length, traj.length);
  const currentIdx = Math.floor(n / 2); // 当前点在轨迹中间

  let cost = 0;

  // ── 轨迹代价 ──────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const d = desiredTrajectory[i];
    const db = traj[i];

    // 位置差(平方距离)
    const dx = d.posX - db.posX;
    const dz = d.posZ - db.posZ;
    const posCost = dx * dx + dz * dz;
    cost += weights.trajectoryPosition * posCost;

    // 朝向差(最短弧平方)
    let angleDiff = d.facing - db.facing;
    // wrap to [-π, π]
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    cost += weights.trajectoryFacing * angleDiff * angleDiff;

    // 速度差(平方)
    const speedDiff = d.speed - db.speed;
    cost += weights.trajectorySpeed * speedDiff * speedDiff;

    // 未来点加权
    if (i > currentIdx) {
      cost *= weights.futureMultiplier;
    }
  }

  // ── 姿态代价 ──────────────────────────────────────────────────
  const desiredPose = dbEntry.pose; // 注:实际运行时,期望姿态来自当前播放帧
  // 在数据库搜索时,姿态代价用于排除姿态差异过大的帧
  // 这里用 dbEntry 自身的 pose 做占位(运行时由 MotionMatcher 传入当前姿态)
  const pose = dbEntry.pose;
  const poseLen = Math.min(desiredPose.length, pose.length);
  let poseCost = 0;
  for (let j = 0; j < poseLen; j++) {
    const diff = desiredPose[j] - pose[j];
    poseCost += diff * diff;
  }
  cost += weights.pose * poseCost;

  return cost;
}

/**
 * 计算期望轨迹 + 当前姿态与数据库帧之间的代价。
 *
 * 这是运行时使用的完整版本:传入当前播放帧的姿向,与数据库帧的姿向比较。
 */
export function computeFullCost(
  desiredTrajectory: Trajectory,
  currentPose: PoseVector,
  dbEntry: MotionDBEntry,
  weights: MotionMatchCostWeights = DEFAULT_COST_WEIGHTS,
): number {
  const traj = dbEntry.trajectory;
  const n = Math.min(desiredTrajectory.length, traj.length);
  const currentIdx = Math.floor(n / 2);

  let cost = 0;

  // ── 轨迹代价 ──────────────────────────────────────────────────
  for (let i = 0; i < n; i++) {
    const d = desiredTrajectory[i];
    const db = traj[i];

    const dx = d.posX - db.posX;
    const dz = d.posZ - db.posZ;
    cost += weights.trajectoryPosition * (dx * dx + dz * dz);

    let angleDiff = d.facing - db.facing;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
    cost += weights.trajectoryFacing * angleDiff * angleDiff;

    const speedDiff = d.speed - db.speed;
    cost += weights.trajectorySpeed * speedDiff * speedDiff;

    if (i > currentIdx) {
      cost *= weights.futureMultiplier;
    }
  }

  // ── 姿态代价 ──────────────────────────────────────────────────
  const dbPose = dbEntry.pose;
  const poseLen = Math.min(currentPose.length, dbPose.length);
  let poseCost = 0;
  for (let j = 0; j < poseLen; j++) {
    const diff = currentPose[j] - dbPose[j];
    poseCost += diff * diff;
  }
  cost += weights.pose * poseCost;

  return cost;
}

// ── 运行时匹配器 ─────────────────────────────────────────────────

/** 搜索结果:最佳匹配帧 + 代价。 */
export interface MotionMatchResult {
  /** 最佳匹配的数据库条目。 */
  entry: MotionDBEntry;
  /** 匹配代价(越低越好)。 */
  cost: number;
  /** 搜索的帧数。 */
  searchedCount: number;
}

/**
 * 在数据库中搜索最佳匹配帧。
 *
 * 算法:线性扫描所有帧,计算代价,取最低。
 * 对于大型数据库(>10k 帧),建议使用 KD-tree 加速(见 buildKDTree)。
 *
 * 参数:
 *   desiredTrajectory: 期望轨迹(从玩家输入计算)
 *   currentPose: 当前播放帧的姿向(用于姿态代价)
 *   database: 动作数据库
 *   weights: 代价权重
 *   maxCost: 最大可接受代价(超过此值不切换,返回 null)
 *   excludeClipId: 排除的 clip ID(可选,避免在同一段内反复匹配)
 *   excludeTimeRange: 排除的时间范围(秒,避免匹配到当前播放点附近)
 */
export function searchBestMatch(
  desiredTrajectory: Trajectory,
  currentPose: PoseVector,
  database: MotionDatabase,
  options: {
    weights?: MotionMatchCostWeights;
    maxCost?: number;
    excludeClipId?: number;
    excludeClipTime?: number;
    excludeTimeRange?: number;
  } = {},
): MotionMatchResult | null {
  const weights = options.weights ?? DEFAULT_COST_WEIGHTS;
  const maxCost = options.maxCost ?? Infinity;

  let bestEntry: MotionDBEntry | null = null;
  let bestCost = Infinity;
  let searched = 0;

  for (const entry of database.entries) {
    // 排除当前 clip 附近(避免匹配到自身)
    if (
      options.excludeClipId !== undefined &&
      options.excludeClipId === entry.clipId &&
      options.excludeClipTime !== undefined &&
      options.excludeTimeRange !== undefined
    ) {
      const timeDiff = Math.abs(entry.clipTime - options.excludeClipTime);
      if (timeDiff < options.excludeTimeRange) continue;
    }

    const cost = computeFullCost(desiredTrajectory, currentPose, entry, weights);
    searched++;

    if (cost < bestCost) {
      bestCost = cost;
      bestEntry = entry;
    }
  }

  if (!bestEntry || bestCost > maxCost) return null;

  return { entry: bestEntry, cost: bestCost, searchedCount: searched };
}

// ── MotionMatcher 运行时状态机 ──────────────────────────────────

/**
 * MotionMatcher — 运行时动作匹配状态机。
 *
 * 管理当前播放状态(clip + time),定期搜索最佳匹配帧,决定是否切换。
 *
 * 用法:
 *   const matcher = new MotionMatcher(database);
 *   matcher.setCurrentClip(0, 0);  // 从 clip 0 的 0s 开始
 *
 *   // 每帧:
 *   matcher.update(dt, desiredTrajectory, currentPose);
 *   const state = matcher.getState();
 *   // state.clipId, state.clipTime → 传给 AnimationMixer 播放
 */
export class MotionMatcher {
  /** 动作数据库。 */
  readonly database: MotionDatabase;
  /** 代价权重。 */
  weights: MotionMatchCostWeights;
  /** 搜索间隔(秒,每 N 秒搜索一次,默认 0.1 = 10 次/秒)。 */
  searchInterval: number;
  /** 切换的最大代价(匹配代价低于此值才切换,默认 Infinity = 总是切换到最佳匹配)。 */
  maxSwitchCost: number;
  /** 切换混合时间(秒)。 */
  blendTime: number;
  /** 排除当前播放点附近的时间范围(秒)。 */
  excludeTimeRange: number;

  // 运行时状态
  private _clipId: number = 0;
  private _clipTime: number = 0;
  private _clipDuration: number = 0;
  private _searchTimer: number = 0;
  private _blendTimer: number = 0;
  private _prevClipId: number = 0;
  private _prevClipTime: number = 0;
  private _lastCost: number = Infinity;
  private _searchCount: number = 0;
  private _switchCount: number = 0;

  /** clip 持续时间表(clipId → duration 秒)。 */
  private _clipDurations: Map<number, number> = new Map();

  constructor(
    database: MotionDatabase,
    options: {
      weights?: MotionMatchCostWeights;
      searchInterval?: number;
      maxSwitchCost?: number;
      blendTime?: number;
      excludeTimeRange?: number;
    } = {},
  ) {
    this.database = database;
    this.weights = options.weights ?? { ...DEFAULT_COST_WEIGHTS };
    this.searchInterval = options.searchInterval ?? 0.1;
    this.maxSwitchCost = options.maxSwitchCost ?? Infinity;
    this.blendTime = options.blendTime ?? 0.2;
    this.excludeTimeRange = options.excludeTimeRange ?? 0.5;

    // 从数据库推断 clip 持续时间(每个 clipId 的最大 clipTime)
    for (const entry of database.entries) {
      const current = this._clipDurations.get(entry.clipId) ?? 0;
      if (entry.clipTime > current) {
        this._clipDurations.set(entry.clipId, entry.clipTime);
      }
    }
  }

  /** 设置当前播放的 clip 和时间。 */
  setCurrentClip(clipId: number, clipTime: number): this {
    this._clipId = clipId;
    this._clipTime = clipTime;
    this._clipDuration = this._clipDurations.get(clipId) ?? 0;
    this._blendTimer = 0;
    return this;
  }

  /** 获取当前播放状态。 */
  getState(): MotionMatcherState {
    // blendWeight 语义:[0, 1] 插值因子,0 = 完全是 prevClip,1 = 完全是 currentClip。
    //   - isBlending=true 时:blendWeight = 1 - timer/blendTime(从 0 增长到 ≈1)
    //   - isBlending=false 时:blendWeight = 1(完全在 currentClip,无混合)
    //   消费者应优先检查 isBlending 决定是否混合;blendWeight 仅在 isBlending=true 时有意义。
    const isBlending = this._blendTimer > 0;
    const blendWeight = isBlending
      ? 1 - this._blendTimer / this.blendTime
      : 1;
    return {
      clipId: this._clipId,
      clipTime: this._clipTime,
      isBlending,
      blendWeight,
      prevClipId: this._prevClipId,
      prevClipTime: this._prevClipTime,
      lastCost: this._lastCost,
      searchCount: this._searchCount,
      switchCount: this._switchCount,
    };
  }

  /**
   * 每帧更新:推进时间 + 定期搜索 + 决定切换。
   *
   * 参数:
   *   dt: 帧时间(秒)
   *   desiredTrajectory: 期望轨迹(从玩家输入计算)
   *   currentPose: 当前姿向(从动画采样)
   *   clipSpeed: 播放速度倍率(默认 1)
   */
  update(
    dt: number,
    desiredTrajectory: Trajectory,
    currentPose: PoseVector,
    clipSpeed: number = 1,
  ): this {
    // 1. 推进当前 clip 时间
    this._clipTime += dt * clipSpeed;
    if (this._clipDuration > 0 && this._clipTime > this._clipDuration) {
      this._clipTime = this._clipTime % this._clipDuration;
    }

    // 2. 推进混合计时器
    if (this._blendTimer > 0) {
      this._blendTimer -= dt;
      if (this._blendTimer < 0) this._blendTimer = 0;
    }

    // 3. 定期搜索
    this._searchTimer += dt;
    if (this._searchTimer < this.searchInterval) return this;
    this._searchTimer = 0;

    const result = searchBestMatch(
      desiredTrajectory,
      currentPose,
      this.database,
      {
        weights: this.weights,
        maxCost: Infinity,
        excludeClipId: this._clipId,
        excludeClipTime: this._clipTime,
        excludeTimeRange: this.excludeTimeRange,
      },
    );

    this._searchCount++;
    if (result) {
      this._lastCost = result.cost;
      // 4. 如果匹配代价低于阈值(匹配足够好),切换
      if (result.cost < this.maxSwitchCost) {
        this._switchTo(result.entry);
      }
    }

    return this;
  }

  /** 切换到新帧(带混合)。 */
  private _switchTo(entry: MotionDBEntry): void {
    this._prevClipId = this._clipId;
    this._prevClipTime = this._clipTime;
    this._clipId = entry.clipId;
    this._clipTime = entry.clipTime;
    this._clipDuration = this._clipDurations.get(entry.clipId) ?? 0;
    this._blendTimer = this.blendTime;
    this._switchCount++;
  }

  /** 重置状态。 */
  reset(): this {
    this._clipId = 0;
    this._clipTime = 0;
    this._searchTimer = 0;
    this._blendTimer = 0;
    this._lastCost = Infinity;
    this._searchCount = 0;
    this._switchCount = 0;
    return this;
  }
}

/** MotionMatcher 运行时状态。 */
export interface MotionMatcherState {
  /** 当前 clip ID。 */
  clipId: number;
  /** 当前 clip 时间(秒)。 */
  clipTime: number;
  /** 是否正在混合。 */
  isBlending: boolean;
  /** 混合权重 [0, 1](0 = 刚切换, 1 = 混合完成)。 */
  blendWeight: number;
  /** 前一个 clip ID(混合源)。 */
  prevClipId: number;
  /** 前一个 clip 时间(混合源)。 */
  prevClipTime: number;
  /** 最近搜索的代价。 */
  lastCost: number;
  /** 总搜索次数。 */
  searchCount: number;
  /** 总切换次数。 */
  switchCount: number;
}

// ── 期望轨迹构建 ─────────────────────────────────────────────────

/**
 * 从玩家输入构建期望未来轨迹。
 *
 * 参数:
 *   currentPos: 当前角色位置 (x, z)
 *   currentFacing: 当前朝向(弧度)
 *   moveDirX, moveDirZ: 移动方向(归一化,游戏手柄/键盘输入)
 *   moveSpeed: 目标移动速度(m/s)
 *   sampleCount: 未来采样点数(默认 5)
 *   sampleInterval: 采样间隔(秒,默认 0.2)
 *
 * 返回:期望轨迹(过去 0 点 + 未来 sampleCount 点)。
 * 注意:过去轨迹由 MotionMatcher 从历史构建,这里只构建未来。
 */
export function buildDesiredTrajectory(
  currentPos: { x: number; z: number },
  currentFacing: number,
  moveDirX: number,
  moveDirZ: number,
  moveSpeed: number,
  sampleCount: number = 5,
  sampleInterval: number = 0.2,
): Trajectory {
  const trajectory: Trajectory = [];

  // 当前点(t=0)
  trajectory.push(
    makeTrajectoryPoint(currentPos.x, currentPos.z, currentFacing, moveSpeed),
  );

  // 未来点
  for (let i = 1; i <= sampleCount; i++) {
    const t = i * sampleInterval;
    const dist = moveSpeed * t;
    const px = currentPos.x + moveDirX * dist;
    const pz = currentPos.z + moveDirZ * dist;
    // 朝向 = 移动方向
    const facing = moveDirX !== 0 || moveDirZ !== 0
      ? Math.atan2(moveDirX, moveDirZ)
      : currentFacing;
    trajectory.push(makeTrajectoryPoint(px, pz, facing, moveSpeed));
  }

  return trajectory;
}

// ── 预设 ─────────────────────────────────────────────────────────

/** Motion Matching 预设。 */
export const MotionMatchingPresets = {
  /**
   * 精确搜索 —— 每帧搜索,低切换阈值(总是切换到最佳匹配)。
   * 适合:格斗 / 动作游戏(需要精确响应)。
   */
  precise(): Partial<MotionMatcherOptions> {
    return {
      searchInterval: 0.016, // 每帧搜索
      maxSwitchCost: Infinity,
      blendTime: 0.1,
      excludeTimeRange: 0.3,
    };
  },

  /**
   * 平衡搜索 —— 每 0.1s 搜索,中等切换阈值。
   * 适合:RPG / 冒险游戏(响应 + 性能平衡)。
   */
  balanced(): Partial<MotionMatcherOptions> {
    return {
      searchInterval: 0.1,
      maxSwitchCost: 1.0,
      blendTime: 0.2,
      excludeTimeRange: 0.5,
    };
  },

  /**
   * 性能优先 —— 每 0.2s 搜索,高切换阈值(只匹配很好的才切换)。
   * 适合:大世界 / MMO(减少搜索开销)。
   */
  performance(): Partial<MotionMatcherOptions> {
    return {
      searchInterval: 0.2,
      maxSwitchCost: 0.5,
      blendTime: 0.3,
      excludeTimeRange: 1.0,
    };
  },

  /**
   * 过场动画 —— 不切换(仅播放)。
   * 适合:过场动画 / 脚本序列(不需要动作匹配)。
   */
  cinematic(): Partial<MotionMatcherOptions> {
    return {
      searchInterval: Infinity, // 永不搜索
      maxSwitchCost: 0,
      blendTime: 0.3,
      excludeTimeRange: 1.0,
    };
  },
} as const;

/** MotionMatcher 构造选项。 */
export interface MotionMatcherOptions {
  weights: MotionMatchCostWeights;
  searchInterval: number;
  maxSwitchCost: number;
  blendTime: number;
  excludeTimeRange: number;
}
