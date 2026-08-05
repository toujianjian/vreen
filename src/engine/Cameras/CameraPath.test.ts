import { describe, it, expect } from 'vitest';
import { CameraPath } from './CameraPath';
import type { CameraPathKeyframe, CameraPose } from './CameraPath';
import { smoothstepEasing, easeInOutCubic } from './CameraPath';
import { Vector3 } from '../Math';

function kf(
  time: number,
  px: number, py: number, pz: number,
  lx = 0, ly = 0, lz = 0,
  fov = 50, roll = 0,
): CameraPathKeyframe {
  return {
    time,
    position: new Vector3(px, py, pz),
    lookAt: new Vector3(lx, ly, lz),
    fov,
    roll,
  };
}

describe('CameraPath', () => {
  // ── 构造与关键帧管理 ─────────────────────────────────────────────────

  it('默认构造创建空路径', () => {
    const p = new CameraPath();
    expect(p.keyframes.length).toBe(0);
    expect(p.getDuration()).toBe(0);
    expect(p.isPlaying()).toBe(false);
    expect(p.loopMode).toBe('once');
    expect(p.parametrization).toBe('centripetal');
  });

  it('addKeyframe 添加关键帧并重算 duration', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    p.addKeyframe(kf(6, 20, 0, 0));
    expect(p.keyframes.length).toBe(3);
    expect(p.getDuration()).toBe(6);
  });

  it('addKeyframe 自动按 time 升序排序', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(6, 20, 0, 0));
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    expect(p.keyframes[0].time).toBe(0);
    expect(p.keyframes[1].time).toBe(3);
    expect(p.keyframes[2].time).toBe(6);
  });

  it('setKeyframes 批量替换', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.setKeyframes([kf(0, 1, 1, 1), kf(2, 3, 3, 3)]);
    expect(p.keyframes.length).toBe(2);
    expect(p.keyframes[0].position.x).toBe(1);
  });

  it('removeKeyframe 移除并重算', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    p.addKeyframe(kf(6, 20, 0, 0));
    expect(p.removeKeyframe(1)).toBe(true);
    expect(p.keyframes.length).toBe(2);
    expect(p.getDuration()).toBe(6);
  });

  it('removeKeyframe 越界返回 false', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    expect(p.removeKeyframe(5)).toBe(false);
    expect(p.removeKeyframe(-1)).toBe(false);
  });

  it('clear 清空', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    p.clear();
    expect(p.keyframes.length).toBe(0);
    expect(p.getDuration()).toBe(0);
  });

  // ── 播放控制 ─────────────────────────────────────────────────────────

  it('play 启动播放,getCurrentTime 重置为 0', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    p.play();
    expect(p.isPlaying()).toBe(true);
    expect(p.getCurrentTime()).toBe(0);
  });

  it('play 空路径不启动', () => {
    const p = new CameraPath();
    p.play();
    expect(p.isPlaying()).toBe(false);
  });

  it('update 推进时间', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    p.play();
    p.update(1);
    expect(p.getCurrentTime()).toBe(1);
    p.update(0.5);
    expect(p.getCurrentTime()).toBe(1.5);
  });

  it('pause 暂停但保留时间', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    p.play();
    p.update(1);
    p.pause();
    expect(p.isPlaying()).toBe(false);
    expect(p.getCurrentTime()).toBe(1);
    p.update(1);
    expect(p.getCurrentTime()).toBe(1); // 暂停后不推进
  });

  it('stop 停止并重置到起点', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    p.play();
    p.update(1);
    p.stop();
    expect(p.isPlaying()).toBe(false);
    expect(p.getCurrentTime()).toBe(0);
  });

  it('seek 跳转到指定时间(截断到 [0, duration])', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(3, 10, 0, 0));
    p.seek(2);
    expect(p.getCurrentTime()).toBe(2);
    p.seek(-1);
    expect(p.getCurrentTime()).toBe(0);
    p.seek(100);
    expect(p.getCurrentTime()).toBe(3);
  });

  it('getProgress 返回 [0,1] 进度', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(4, 10, 0, 0));
    p.seek(2);
    expect(p.getProgress()).toBe(0.5);
  });

  // ── 循环模式 ─────────────────────────────────────────────────────────

  it('once: 播放到末尾自动停止', () => {
    const p = new CameraPath();
    p.loopMode = 'once';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.play();
    p.update(1.5);
    expect(p.isPlaying()).toBe(true);
    p.update(1);
    expect(p.isPlaying()).toBe(false);
    expect(p.getCurrentTime()).toBe(2);
  });

  it('loop: 超过 duration 折回起点', () => {
    const p = new CameraPath();
    p.loopMode = 'loop';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.play();
    p.update(3); // 超出 1 秒
    expect(p.getCurrentTime()).toBeCloseTo(1, 5);
    expect(p.isPlaying()).toBe(true);
  });

  it('pingpong: 到达端点反向', () => {
    const p = new CameraPath();
    p.loopMode = 'pingpong';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.play();
    p.update(3); // 正向 2 + 反向 1 → 时间 = 1
    expect(p.getCurrentTime()).toBeCloseTo(1, 5);
    expect(p.isPlaying()).toBe(true);
  });

  it('pingpong: 单帧多次反弹(dt 超过 2*duration)', () => {
    const p = new CameraPath();
    p.loopMode = 'pingpong';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.play();
    // dt = 5 = 2(正向) + 2(反向) + 1(正向) → 时间 = 1
    p.update(5);
    expect(p.getCurrentTime()).toBeCloseTo(1, 5);
    expect(p.isPlaying()).toBe(true);
  });

  it('pingpong: 反向到达起点再反弹', () => {
    const p = new CameraPath();
    p.loopMode = 'pingpong';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.play();
    p.update(3); // 正向 2 + 反向 1 → 时间 = 1
    p.update(3); // 反向 1 + 正向 2 → 时间 = 2
    expect(p.getCurrentTime()).toBeCloseTo(2, 5);
  });

  it('loop: dt 超过 duration 多次折回', () => {
    const p = new CameraPath();
    p.loopMode = 'loop';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.play();
    p.update(5); // 5 mod 2 = 1
    expect(p.getCurrentTime()).toBeCloseTo(1, 5);
  });

  // ── 采样 ─────────────────────────────────────────────────────────────

  it('sample 空路径返回零位姿', () => {
    const p = new CameraPath();
    const pose = p.sample();
    expect(pose.position.x).toBe(0);
    expect(pose.position.y).toBe(0);
    expect(pose.position.z).toBe(0);
    expect(pose.fov).toBe(50);
  });

  it('sample 单关键帧返回该帧位姿', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 1, 2, 3, 0, 0, 0, 60, 5));
    const pose = p.sample();
    expect(pose.position.x).toBe(1);
    expect(pose.position.y).toBe(2);
    expect(pose.position.z).toBe(3);
    expect(pose.fov).toBe(60);
    expect(pose.roll).toBe(5);
  });

  it('sample 在段起点返回起点关键帧', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0, 0, 0, 0, 50, 0));
    p.addKeyframe(kf(2, 10, 0, 0, 0, 0, 0, 60, 0));
    p.seek(0);
    const pose = p.sample();
    expect(pose.position.x).toBeCloseTo(0, 5);
    expect(pose.fov).toBeCloseTo(50, 5);
  });

  it('sample 在段终点返回终点关键帧', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0, 0, 0, 0, 50, 0));
    p.addKeyframe(kf(2, 10, 0, 0, 0, 0, 0, 60, 0));
    p.seek(2);
    const pose = p.sample();
    expect(pose.position.x).toBeCloseTo(10, 5);
    expect(pose.fov).toBeCloseTo(60, 5);
  });

  it('sample 在段中点返回中点位置(线性特例)', () => {
    // 4 关键帧等距共线,采样段 1(中间段,无端点复制)
    // 段 1 在 time=2..4 之间,中点 time=3,位置中点 = 15
    const p = new CameraPath();
    p.parametrization = 'uniform';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.addKeyframe(kf(4, 20, 0, 0));
    p.addKeyframe(kf(6, 30, 0, 0));
    p.seek(3);
    const pose = p.sample();
    expect(pose.position.x).toBeCloseTo(15, 1);
  });

  it('sample FOV 线性插值', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0, 0, 0, 0, 50, 0));
    p.addKeyframe(kf(2, 10, 0, 0, 0, 0, 0, 70, 0));
    p.seek(1);
    const pose = p.sample();
    expect(pose.fov).toBeCloseTo(60, 5);
  });

  it('sample roll 线性插值', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0, 0, 0, 0, 50, 0));
    p.addKeyframe(kf(2, 10, 0, 0, 0, 0, 0, 50, 10));
    p.seek(1);
    const pose = p.sample();
    expect(pose.roll).toBeCloseTo(5, 5);
  });

  it('enableRoll=false 时 roll 始终为 0', () => {
    const p = new CameraPath();
    p.enableRoll = false;
    p.addKeyframe(kf(0, 0, 0, 0, 0, 0, 0, 50, 0));
    p.addKeyframe(kf(2, 10, 0, 0, 0, 0, 0, 50, 30));
    p.seek(1);
    const pose = p.sample();
    expect(pose.roll).toBe(0);
  });

  it('autoLookAlongPath 启用后 lookAt 沿切线方向', () => {
    const p = new CameraPath();
    p.autoLookAlongPath = true;
    p.autoLookDistance = 5;
    // 沿 +X 方向直线运动,切线应朝 +X
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.addKeyframe(kf(4, 20, 0, 0));
    p.seek(1);
    const pose = p.sample();
    // lookAt.x 应 > position.x(切线朝 +X)
    expect(pose.lookAt.x).toBeGreaterThan(pose.position.x);
    // y/z 几乎不变
    expect(pose.lookAt.z).toBeCloseTo(pose.position.z, 1);
  });

  it('easing: smoothstep 在中点接近 0.5', () => {
    // 4 关键帧等距共线,采样段 1 中点(time=3)
    // smoothstep(0.5) = 0.5,位置中点 = 15
    const p = new CameraPath();
    p.easing = smoothstepEasing;
    p.parametrization = 'uniform';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.addKeyframe(kf(4, 20, 0, 0));
    p.addKeyframe(kf(6, 30, 0, 0));
    p.seek(3);
    const pose = p.sample();
    expect(pose.position.x).toBeCloseTo(15, 1);
  });

  it('easing: easeInOutCubic 中点等于 0.5', () => {
    // 4 关键帧等距共线,采样段 1 中点(time=3)
    // easeInOutCubic(0.5) = 0.5,位置中点 = 15
    const p = new CameraPath();
    p.easing = easeInOutCubic;
    p.parametrization = 'uniform';
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.addKeyframe(kf(4, 20, 0, 0));
    p.addKeyframe(kf(6, 30, 0, 0));
    p.seek(3);
    const pose = p.sample();
    expect(pose.position.x).toBeCloseTo(15, 1);
  });

  it('sample 支持 out 参数复用避免分配', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    const out: CameraPose = {
      position: new Vector3(),
      lookAt: new Vector3(),
      fov: 0,
      roll: 0,
    };
    p.seek(1);
    const result = p.sample(out);
    expect(result).toBe(out);
    // 验证 out 被填充(中点应在两端点之间,即 0..10)
    expect(out.position.x).toBeGreaterThan(0);
    expect(out.position.x).toBeLessThan(10);
    expect(out.fov).toBe(50);
  });

  // ── 手持噪声 ─────────────────────────────────────────────────────────

  it('enableHandheldNoise 不破坏采样确定性(同帧同结果)', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.enableHandheldNoise(0.2, 1);
    p.seek(1);
    const pose1 = p.sample();
    const pose2 = p.sample();
    expect(pose1.position.x).toBeCloseTo(pose2.position.x, 6);
    expect(pose1.position.y).toBeCloseTo(pose2.position.y, 6);
    expect(pose1.position.z).toBeCloseTo(pose2.position.z, 6);
  });

  it('disableHandheldNoise 关闭扰动', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(2, 10, 0, 0));
    p.enableHandheldNoise(0.2, 1);
    p.disableHandheldNoise();
    p.seek(1);
    const pose = p.sample();
    expect(pose.position.x).toBeCloseTo(5, 1);
  });

  // ── 序列化 ───────────────────────────────────────────────────────────

  it('export/import JSON 往返保持数据', () => {
    const p = new CameraPath();
    p.loopMode = 'loop';
    p.parametrization = 'uniform';
    p.addKeyframe(kf(0, 1, 2, 3, 0, 0, 0, 50, 0));
    p.addKeyframe(kf(3, 4, 5, 6, 1, 1, 1, 60, 5));
    p.addKeyframe(kf(6, 7, 8, 9, 2, 2, 2, 70, 10));
    const json = p.exportJSON();

    const p2 = new CameraPath();
    p2.importJSON(json);
    expect(p2.keyframes.length).toBe(3);
    expect(p2.keyframes[0].position.x).toBe(1);
    expect(p2.keyframes[2].lookAt.z).toBe(2);
    expect(p2.keyframes[2].fov).toBe(70);
    expect(p2.keyframes[2].roll).toBe(10);
    expect(p2.loopMode).toBe('loop');
    expect(p2.parametrization).toBe('uniform');
    expect(p2.getDuration()).toBe(6);
  });

  // ── 段查找性能优化 ───────────────────────────────────────────────────

  it('非均匀时间分布的多段路径能正确定位段', () => {
    const p = new CameraPath();
    p.addKeyframe(kf(0, 0, 0, 0));
    p.addKeyframe(kf(1, 10, 0, 0));
    p.addKeyframe(kf(5, 20, 0, 0));  // 段 1..5 较长
    p.addKeyframe(kf(6, 30, 0, 0));
    // 时间 3 在第 1 段(1..5)
    p.seek(3);
    const pose = p.sample();
    // 段 1..5 的中点应是 15
    expect(pose.position.x).toBeCloseTo(15, 0);
  });

  it('centripetal 与 uniform 在等距共线点上行为一致', () => {
    // 4 个等距共线点,采样段 1(中间段,无端点复制)
    // 等距时两种参数化的节点参数呈线性,结果一致
    const pu = new CameraPath();
    pu.parametrization = 'uniform';
    pu.addKeyframe(kf(0, 0, 0, 0));
    pu.addKeyframe(kf(2, 10, 0, 0));
    pu.addKeyframe(kf(4, 20, 0, 0));
    pu.addKeyframe(kf(6, 30, 0, 0));
    pu.seek(3);

    const pc = new CameraPath();
    pc.parametrization = 'centripetal';
    pc.addKeyframe(kf(0, 0, 0, 0));
    pc.addKeyframe(kf(2, 10, 0, 0));
    pc.addKeyframe(kf(4, 20, 0, 0));
    pc.addKeyframe(kf(6, 30, 0, 0));
    pc.seek(3);

    const poseU = pu.sample();
    const poseC = pc.sample();
    expect(poseC.position.x).toBeCloseTo(poseU.position.x, 3);
  });
});
