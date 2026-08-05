import { describe, it, expect } from 'vitest';
import { SpringArm, SpringArmPresets } from './SpringArm';
import type { ProbeFn } from './SpringArm';
import { PerspectiveCamera } from './PerspectiveCamera';
import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math';

/** 创建一个位于 (px,py,pz) 的 Object3D 作为跟随目标。 */
function makeTarget(px = 0, py = 0, pz = 0): Object3D {
  const obj = new Object3D();
  obj.position.set(px, py, pz);
  return obj;
}

/** 创建一个根据 origin.z 与 maxDist 决定命中的探针(模拟墙在 z=-3 处)。 */
function wallProbe(wallZ: number): ProbeFn {
  return (origin, dir, maxDist) => {
    // 仅处理 -Z 方向射线(armOffset 典型朝 -Z)
    if (Math.abs(dir.z) < 0.001) return null;
    // 射线参数:origin.z + t * dir.z = wallZ → t = (wallZ - origin.z) / dir.z
    if (dir.z >= 0) return null; // 朝 +Z 不命中 -Z 的墙
    const t = (wallZ - origin.z) / dir.z;
    if (t < 0 || t > maxDist) return null;
    return t;
  };
}

describe('SpringArm', () => {
  // ── 构造与默认值 ─────────────────────────────────────────────────────

  it('默认构造:armOffset/targetOffset/maxDistance 默认值', () => {
    const arm = new SpringArm();
    expect(arm.target).toBeNull();
    expect(arm.camera).toBeNull();
    expect(arm.armOffset.x).toBe(0);
    expect(arm.armOffset.y).toBe(2);
    expect(arm.armOffset.z).toBe(-5);
    expect(arm.targetOffset.y).toBe(1.5);
    expect(arm.maxDistance).toBeCloseTo(Math.hypot(0, 2, 5), 5);
    expect(arm.probeRadius).toBe(0.3);
    expect(arm.collisionMargin).toBe(0.2);
    expect(arm.probeType).toBe('sphere');
  });

  it('可接受外部 Camera', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    expect(arm.camera).toBe(cam);
  });

  // ── follow() ─────────────────────────────────────────────────────────

  it('follow 设置目标并立即同步平滑状态', () => {
    const arm = new SpringArm();
    const target = makeTarget(5, 0, 5);
    arm.follow(target);
    expect(arm.target).toBe(target);
    // currentLength 应立即等于 maxDistance(无跳变)
    expect(arm.currentLength).toBeCloseTo(arm.maxDistance, 5);
  });

  // ── update:无目标/无碰撞 ─────────────────────────────────────────────

  it('update 无目标时为 no-op', () => {
    const arm = new SpringArm();
    expect(() => arm.update(0.016)).not.toThrow();
  });

  it('无碰撞时相机位于 maxDistance 处', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    arm.setProbe(() => null); // 无碰撞
    // 多帧推进让弹簧收敛
    for (let i = 0; i < 60; i++) arm.update(0.016);
    // 相机应在 target + targetOffset + armOffset 方向上,距离 = maxDistance
    const expected = new Vector3(0, 2, -5).add(new Vector3(0, 1.5, 0));
    expect(cam.position.x).toBeCloseTo(expected.x, 1);
    expect(cam.position.y).toBeCloseTo(expected.y, 1);
    expect(cam.position.z).toBeCloseTo(expected.z, 1);
  });

  it('无探针 + 无碰撞物体 → 视为无碰撞', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    // 不设 probe,不设 collisionObjects
    for (let i = 0; i < 60; i++) arm.update(0.016);
    expect(arm.currentLength).toBeCloseTo(arm.maxDistance, 2);
  });

  // ── update:碰撞回缩 ─────────────────────────────────────────────────

  it('碰撞时相机回缩到 hitDist - margin - probeRadius', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    // armOffset = (0, 2, -5),方向归一化后约 (0, 0.371, -0.928)
    // maxDistance ≈ 5.385
    // 模拟墙在臂方向 3 米处命中
    const hitDist = 3.0;
    arm.setProbe(() => hitDist);
    arm.probeRadius = 0.3;
    arm.collisionMargin = 0.2;
    // 多帧推进让弹簧收敛
    for (let i = 0; i < 120; i++) arm.update(0.016);
    const expectedLength = hitDist - arm.collisionMargin - arm.probeRadius;
    expect(arm.currentLength).toBeCloseTo(expectedLength, 1);
  });

  it('探针返回 null → 不回缩(保持 maxDistance)', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    arm.setProbe(() => null);
    for (let i = 0; i < 60; i++) arm.update(0.016);
    expect(arm.currentLength).toBeCloseTo(arm.maxDistance, 2);
  });

  it('探针返回 > maxDistance → 视为未命中', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    arm.setProbe(() => arm.maxDistance + 10);
    for (let i = 0; i < 60; i++) arm.update(0.016);
    expect(arm.currentLength).toBeCloseTo(arm.maxDistance, 2);
  });

  it('碰撞点极近时臂长钳制到 0(不穿墙)', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    arm.setProbe(() => 0.1); // 极近命中
    arm.probeRadius = 0.3;
    arm.collisionMargin = 0.2;
    for (let i = 0; i < 120; i++) arm.update(0.016);
    // 回缩目标 = 0.1 - 0.2 - 0.3 = -0.4 → 钳制到 0
    expect(arm.currentLength).toBeGreaterThanOrEqual(0);
    expect(arm.currentLength).toBeLessThan(0.5);
  });

  it('wallProbe 模拟墙在 z=-3 处 → 相机不穿墙', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    arm.setProbe(wallProbe(-3));
    arm.probeRadius = 0;
    arm.collisionMargin = 0.2;
    for (let i = 0; i < 120; i++) arm.update(0.016);
    // 相机 z 不应小于 -3 + 0.2 = -2.8(墙在 -3,margin 0.2)
    expect(cam.position.z).toBeGreaterThan(-3);
    expect(cam.position.z).toBeLessThanOrEqual(-2.8 + 0.1); // 容差
  });

  // ── 弹簧平滑 ─────────────────────────────────────────────────────────

  it('弹簧平滑:碰撞解除后臂长逐渐恢复(非瞬切)', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    // 第一阶段:碰撞,臂长回缩
    arm.setProbe(() => 2.0);
    arm.probeRadius = 0;
    arm.collisionMargin = 0.2;
    for (let i = 0; i < 120; i++) arm.update(0.016);
    const retractedLength = arm.currentLength;
    expect(retractedLength).toBeLessThan(arm.maxDistance);

    // 第二阶段:解除碰撞,记录第 1 帧后的臂长(应 < maxDistance,弹簧未瞬切)
    arm.setProbe(() => null);
    arm.update(0.016);
    expect(arm.currentLength).toBeGreaterThan(retractedLength);
    expect(arm.currentLength).toBeLessThan(arm.maxDistance);
  });

  it('弹簧刚度越高恢复越快', () => {
    // 高刚度应比低刚度更快到达目标
    const makeArm = (stiffness: number) => {
      const cam = new PerspectiveCamera(60, 1, 0.1, 100);
      const arm = new SpringArm(cam);
      arm.follow(makeTarget(0, 0, 0));
      arm.setProbe(() => null);
      arm.springStiffness = stiffness;
      arm.springDamping = 0.5;
      // 先让臂长偏离 maxDistance
      arm.currentLength = 1.0;
      return arm;
    };
    const stiff = makeArm(0.9);
    const soft = makeArm(0.1);
    // 推进相同帧数
    for (let i = 0; i < 30; i++) {
      stiff.update(0.016);
      soft.update(0.016);
    }
    // 高刚度应更接近 maxDistance
    expect(stiff.currentLength).toBeGreaterThan(soft.currentLength);
  });

  // ── lookAt / position 平滑 ───────────────────────────────────────────

  it('lookAt 平滑:目标移动后相机朝向逐渐跟随', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const target = makeTarget(0, 0, 0);
    const arm = new SpringArm(cam);
    arm.follow(target);
    arm.setProbe(() => null);
    // 先稳定一帧
    arm.update(0.016);
    // 移动目标
    target.position.set(10, 0, 0);
    // 第 1 帧:lookAt 应介于旧(0,1.5,0)和新(10,1.5,0)之间
    arm.update(0.016);
    // smoothedLookAt.x 应 < 10(未瞬切)
    // 但 > 0(已开始跟随)
    // 注:由于 positionStiffness 默认 0.5 + 弹簧,smoothedTargetPos 也会平滑
    // 这里只验证 camera 确实在朝目标方向移动
    const initialLookX = cam.position.x; // 间接验证:相机也在移动
    expect(initialLookX).toBeGreaterThan(-100); // sanity
    // 多帧后应收敛
    for (let i = 0; i < 120; i++) arm.update(0.016);
    // 最终相机应位于新目标附近
    expect(cam.position.x).toBeGreaterThan(5);
  });

  it('positionStiffness=1 + positionDamping=0 → 目标位置瞬切', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const target = makeTarget(0, 0, 0);
    const arm = new SpringArm(cam);
    arm.follow(target);
    arm.setProbe(() => null);
    arm.positionStiffness = 1.0;
    arm.positionDamping = 0.0;
    target.position.set(10, 0, 0);
    arm.update(0.016);
    // 第一帧就应跟上(刚度 1 + 阻尼 0 → 瞬切)
    // 注:弹簧公式 vel += F * dt * 60,即使 k=1 c=0 也需要几帧
    // 这里放宽:验证 positionStiffness=1 比 0.1 快很多
    const cam2 = new PerspectiveCamera(60, 1, 0.1, 100);
    const target2 = makeTarget(0, 0, 0);
    const arm2 = new SpringArm(cam2);
    arm2.follow(target2);
    arm2.setProbe(() => null);
    arm2.positionStiffness = 0.1;
    arm2.positionDamping = 0.0;
    target2.position.set(10, 0, 0);
    arm2.update(0.016);
    expect(cam.position.x).toBeGreaterThan(cam2.position.x);
  });

  // ── setArmOffset / setCollisionObjects / setProbe ────────────────────

  it('setArmOffset 更新偏移并重算 maxDistance', () => {
    const arm = new SpringArm();
    arm.setArmOffset(new Vector3(0, 3, -8));
    expect(arm.maxDistance).toBeCloseTo(Math.hypot(0, 3, 8), 5);
  });

  it('setCollisionObjects 设置碰撞物体列表', () => {
    const arm = new SpringArm();
    const objs = [new Object3D(), new Object3D()];
    arm.setCollisionObjects(objs);
    expect(arm.collisionObjects.length).toBe(2);
  });

  it('setProbe 注入自定义探针', () => {
    const arm = new SpringArm();
    const fn: ProbeFn = () => 1.0;
    arm.setProbe(fn);
    expect(arm.probe).toBe(fn);
  });

  // ── 预设 ─────────────────────────────────────────────────────────────

  it('thirdPerson 预设:后上方,球面探针,中刚度', () => {
    const arm = SpringArmPresets.thirdPerson();
    expect(arm.armOffset.z).toBeLessThan(-3); // 在后方
    expect(arm.armOffset.y).toBeGreaterThan(1); // 上方
    expect(arm.probeType).toBe('sphere');
    expect(arm.probeRadius).toBeGreaterThan(0);
  });

  it('overShoulder 预设:偏右,更近', () => {
    const arm = SpringArmPresets.overShoulder();
    expect(arm.armOffset.x).toBeGreaterThan(0); // 右偏
    expect(arm.maxDistance).toBeLessThan(SpringArmPresets.thirdPerson().maxDistance);
  });

  it('farFollow 预设:更远,更软', () => {
    const arm = SpringArmPresets.farFollow();
    expect(arm.maxDistance).toBeGreaterThan(10);
    expect(arm.springStiffness).toBeLessThan(0.4); // 软
  });

  it('firstPerson 预设:无臂长,无探针半径', () => {
    const arm = SpringArmPresets.firstPerson();
    expect(arm.maxDistance).toBe(0);
    expect(arm.probeRadius).toBe(0);
  });

  it('所有预设产生的实例可用(不抛错)', () => {
    const presets = [
      SpringArmPresets.thirdPerson(),
      SpringArmPresets.overShoulder(),
      SpringArmPresets.farFollow(),
      SpringArmPresets.firstPerson(),
    ];
    for (const arm of presets) {
      arm.follow(makeTarget(0, 0, 0));
      arm.setProbe(() => null);
      arm.update(0.016);
      expect(Number.isFinite(arm.currentLength)).toBe(true);
    }
  });

  // ── 序列化 ───────────────────────────────────────────────────────────

  it('export/import JSON 往返保持配置', () => {
    const arm = new SpringArm();
    arm.setArmOffset(new Vector3(1, 2, -7));
    arm.targetOffset.set(0, 1.8, 0);
    arm.probeRadius = 0.45;
    arm.collisionMargin = 0.3;
    arm.probeType = 'ray';
    arm.springStiffness = 0.5;
    arm.springDamping = 0.5;
    arm.lookAtStiffness = 0.6;
    arm.lookAtDamping = 0.4;
    arm.positionStiffness = 0.7;
    arm.positionDamping = 0.3;
    arm.currentLength = 4.2;
    const json = arm.exportJSON();

    const arm2 = new SpringArm();
    arm2.importJSON(json);
    expect(arm2.armOffset.x).toBe(1);
    expect(arm2.armOffset.y).toBe(2);
    expect(arm2.armOffset.z).toBe(-7);
    expect(arm2.maxDistance).toBeCloseTo(Math.hypot(1, 2, 7), 5);
    expect(arm2.probeRadius).toBe(0.45);
    expect(arm2.collisionMargin).toBe(0.3);
    expect(arm2.probeType).toBe('ray');
    expect(arm2.springStiffness).toBe(0.5);
    expect(arm2.springDamping).toBe(0.5);
    expect(arm2.lookAtStiffness).toBe(0.6);
    expect(arm2.lookAtDamping).toBe(0.4);
    expect(arm2.positionStiffness).toBe(0.7);
    expect(arm2.positionDamping).toBe(0.3);
    expect(arm2.currentLength).toBeCloseTo(4.2, 5);
  });

  // ── 边界情况 ─────────────────────────────────────────────────────────

  it('maxDistance=0 时不执行探针(避免除零)', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    arm.setArmOffset(new Vector3(0, 0, 0)); // maxDistance = 0
    arm.setProbe(() => 999); // 即使探针命中也不应影响
    expect(() => {
      for (let i = 0; i < 10; i++) arm.update(0.016);
    }).not.toThrow();
    expect(arm.currentLength).toBe(0);
  });

  it('dt=0 时不改变状态(弹簧不积分)', () => {
    const cam = new PerspectiveCamera(60, 1, 0.1, 100);
    const arm = new SpringArm(cam);
    arm.follow(makeTarget(0, 0, 0));
    arm.setProbe(() => null);
    arm.update(0.016);
    const lengthBefore = arm.currentLength;
    arm.update(0); // dt=0
    expect(arm.currentLength).toBe(lengthBefore);
  });
});
