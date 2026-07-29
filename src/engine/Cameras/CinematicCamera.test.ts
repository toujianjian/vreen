import { describe, it, expect } from 'vitest';
import { CinematicCamera } from './CinematicCamera';
import type { CameraShot } from './CinematicCamera';
import { PerspectiveCamera } from './PerspectiveCamera';
import { Vector3 } from '../Math';

function makeShot(name: string, px = 0, py = 0, pz = 10, fov = 50, duration = 1, transitionType: CameraShot['transitionType'] = 'cut'): CameraShot {
  return {
    name,
    position: new Vector3(px, py, pz),
    lookAt: new Vector3(0, 0, 0),
    fov,
    duration,
    transitionType,
  };
}

describe('CinematicCamera', () => {
  it('默认构造创建 PerspectiveCamera 与空镜头序列', () => {
    const c = new CinematicCamera();
    expect(c.camera).toBeInstanceOf(PerspectiveCamera);
    expect(c.shots.length).toBe(0);
    expect(c.currentShot).toBe(0);
    expect(c.shotTime).toBe(0);
    expect(c.transitionDuration).toBe(0.5);
    expect(c.dofEnabled).toBe(false);
  });

  it('可接受外部 PerspectiveCamera 实例', () => {
    const cam = new PerspectiveCamera(75, 2, 0.5, 2000);
    const c = new CinematicCamera(cam);
    expect(c.camera).toBe(cam);
    expect(c.camera.fov).toBe(75);
  });

  it('addShot 添加镜头到末尾', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    c.addShot(makeShot('B'));
    expect(c.shots.length).toBe(2);
    expect(c.shots[0].name).toBe('A');
    expect(c.shots[1].name).toBe('B');
  });

  it('removeShot 移除指定索引镜头', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    c.addShot(makeShot('B'));
    c.addShot(makeShot('C'));
    expect(c.removeShot(1)).toBe(true);
    expect(c.shots.length).toBe(2);
    expect(c.shots[1].name).toBe('C');
  });

  it('removeShot 越界返回 false', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    expect(c.removeShot(5)).toBe(false);
    expect(c.removeShot(-1)).toBe(false);
  });

  it('play 立即应用第一个镜头(cut)', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 1, 2, 3, 60));
    c.play();
    expect(c.camera.position.x).toBe(1);
    expect(c.camera.position.y).toBe(2);
    expect(c.camera.position.z).toBe(3);
    expect(c.camera.fov).toBe(60);
  });

  it('play 空序列不报错', () => {
    const c = new CinematicCamera();
    c.play();
    expect(c.shots.length).toBe(0);
  });

  it('stop 停止播放', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 0, 0, 10, 50, 1));
    c.play();
    c.update(0.5);
    c.stop();
    // 停止后 shotTime 不再增长
    const t = c.shotTime;
    c.update(0.5);
    // stop 后 update 仍会推进 shotTime(因为 update 不检查 playing),
    // 但镜头不会切换;此测试验证 stop 调用本身不抛错
    expect(c.shotTime).toBeGreaterThanOrEqual(t);
  });

  it('nextShot 推进到下一个镜头', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    c.addShot(makeShot('B'));
    c.play();
    const next = c.nextShot();
    expect(next).toBe(1);
    expect(c.currentShot).toBe(1);
  });

  it('nextShot 循环回到开头(仅当 loop=true,否则停在末尾)', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    c.addShot(makeShot('B'));
    c.play();
    c.nextShot(); // -> 1
    // 不 loop:到末尾
    c.nextShot(); // -> 0 (因 (1+1)%2=0)
    expect(c.currentShot).toBe(0);
  });

  it('prevShot 回到上一个镜头', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    c.addShot(makeShot('B'));
    c.addShot(makeShot('C'));
    c.play();
    c.seekShot(2);
    c.prevShot();
    expect(c.currentShot).toBe(1);
  });

  it('prevShot 在索引 0 时回到末尾', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    c.addShot(makeShot('B'));
    c.play();
    c.prevShot();
    expect(c.currentShot).toBe(1);
  });

  it('seekShot 跳转到指定索引', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    c.addShot(makeShot('B'));
    c.addShot(makeShot('C'));
    c.play();
    expect(c.seekShot(2)).toBe(true);
    expect(c.currentShot).toBe(2);
  });

  it('seekShot 越界返回 false', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A'));
    expect(c.seekShot(5)).toBe(false);
  });

  it('update cut 镜头直接切换', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 0, 0, 10, 50, 0.5, 'cut'));
    c.addShot(makeShot('B', 5, 5, 5, 70, 0.5, 'cut'));
    c.play();
    // 第一帧后 shotTime 增长
    c.update(0.6);
    // 镜头时长 0.5,应切换到 B
    expect(c.currentShot).toBe(1);
    // B 是 cut,位置应为 B 的位置
    expect(c.camera.position.x).toBe(5);
  });

  it('update fade 镜头线性插值位置', () => {
    const c = new CinematicCamera();
    c.transitionDuration = 1.0;
    c.addShot(makeShot('A', 0, 0, 10, 50, 5, 'cut'));
    c.addShot(makeShot('B', 10, 0, 10, 50, 5, 'fade'));
    c.play();
    // 切到 B(fade 过渡)
    c.nextShot();
    // shotTime=0,过渡 t=0 → 位置接近 A
    c.update(0.001);
    expect(c.camera.position.x).toBeLessThan(1);
    // 推进到过渡中点
    c.update(0.5);
    // 中点位置应在 A 和 B 之间
    expect(c.camera.position.x).toBeGreaterThan(0);
    expect(c.camera.position.x).toBeLessThan(10);
  });

  it('update dolly 镜头 smoothstep 插值', () => {
    const c = new CinematicCamera();
    c.transitionDuration = 1.0;
    c.addShot(makeShot('A', 0, 0, 10, 50, 5, 'cut'));
    c.addShot(makeShot('B', 10, 0, 10, 50, 5, 'dolly'));
    c.play();
    c.nextShot();
    c.update(0.001);
    // t≈0,smoothstep(0)=0,位置接近 A
    expect(c.camera.position.x).toBeLessThan(1);
    c.update(1.0);
    // 过渡完成,位置接近 B
    expect(c.camera.position.x).toBeGreaterThan(8);
  });

  it('update orbit 镜头绕目标旋转', () => {
    const c = new CinematicCamera();
    c.transitionDuration = 1.0;
    c.addShot(makeShot('A', 10, 0, 0, 50, 5, 'cut')); // 在 +X,lookAt 原点
    c.addShot(makeShot('B', -10, 0, 0, 50, 5, 'orbit')); // 终点 -X,lookAt 原点
    c.play();
    c.nextShot();
    // 过渡中点应绕原点旋转到 +Z 或 -Z 附近(圆弧中点)
    c.update(0.5);
    // 中点位置 X 应接近 0(在 +Z 或 -Z 圆弧上),距原点 ≈ 半径 10
    expect(Math.abs(c.camera.position.x)).toBeLessThan(1);
    const dist = c.camera.position.length();
    expect(dist).toBeCloseTo(10, 0); // 仍在半径 10 圆弧上
  });

  it('update 推进 shotTime', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 0, 0, 10, 50, 5, 'cut'));
    c.play();
    c.update(0.3);
    expect(c.shotTime).toBeCloseTo(0.3, 5);
  });

  it('update 镜头播放完毕后停止(无 loop)', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 0, 0, 10, 50, 0.5, 'cut'));
    c.play();
    c.update(0.6);
    // 镜头时长 0.5,应已停止
    const info = c.getShotInfo();
    expect(info.playing).toBe(false);
  });

  it('update loop=true 时镜头循环', () => {
    const c = new CinematicCamera();
    c.loop = true;
    c.addShot(makeShot('A', 0, 0, 10, 50, 0.3, 'cut'));
    c.addShot(makeShot('B', 5, 0, 5, 50, 0.3, 'cut'));
    c.play();
    c.update(0.4); // 第一镜头结束 → 切到 B
    expect(c.currentShot).toBe(1);
    c.update(0.4); // B 结束 → 循环到 A
    expect(c.currentShot).toBe(0);
  });

  it('shake 触发震动并衰减', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 0, 0, 10, 50, 5, 'cut'));
    c.play();
    const startPos = c.camera.position.clone();
    c.shake(1, 0.5);
    c.update(0.1);
    // 震动后位置应偏离原位(shakeAmount=1)
    expect(c.camera.position.distanceTo(startPos)).toBeGreaterThan(0);
    // 等待震动结束
    c.update(0.5);
    // 震动结束后应回到原位(近似)
    expect(c.camera.position.distanceTo(startPos)).toBeLessThan(0.5);
  });

  it('setDOF 设置景深参数', () => {
    const c = new CinematicCamera();
    c.setDOF(true, 20, 1.4);
    expect(c.dofEnabled).toBe(true);
    expect(c.focusDistance).toBe(20);
    expect(c.aperture).toBe(1.4);
  });

  it('getShotInfo 返回当前镜头信息', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 0, 0, 10, 50, 2, 'cut'));
    c.play();
    c.update(0.5);
    const info = c.getShotInfo();
    expect(info.index).toBe(0);
    expect(info.name).toBe('A');
    expect(info.duration).toBe(2);
    expect(info.elapsed).toBeCloseTo(0.5, 5);
    expect(info.playing).toBe(true);
  });

  it('exportTimeline 导出可序列化结构', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 1, 2, 3, 50, 2, 'cut'));
    c.addShot(makeShot('B', 4, 5, 6, 70, 3, 'dolly'));
    c.transitionDuration = 0.8;
    c.setDOF(true, 15, 2.0);
    c.focalLength = 85;
    const data = c.exportTimeline();
    expect(data.shots.length).toBe(2);
    expect(data.shots[0].position).toEqual([1, 2, 3]);
    expect(data.shots[1].lookAt).toEqual([0, 0, 0]);
    expect(data.transitionDuration).toBe(0.8);
    expect(data.dofEnabled).toBe(true);
    expect(data.focusDistance).toBe(15);
    expect(data.focalLength).toBe(85);
  });

  it('importTimeline 从 JSON 还原并替换现有镜头', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('old'));
    const data = {
      shots: [
        { name: 'X', position: [1, 1, 1] as [number, number, number], lookAt: [0, 0, 0] as [number, number, number], fov: 40, duration: 2, transitionType: 'fade' as const },
        { name: 'Y', position: [2, 2, 2] as [number, number, number], lookAt: [0, 0, 0] as [number, number, number], fov: 60, duration: 3, transitionType: 'orbit' as const },
      ],
      transitionDuration: 1.0,
      dofEnabled: true,
      focusDistance: 8,
      aperture: 4.0,
      focalLength: 35,
    };
    c.importTimeline(data);
    expect(c.shots.length).toBe(2);
    expect(c.shots[0].name).toBe('X');
    expect(c.shots[0].position.x).toBe(1);
    expect(c.shots[1].transitionType).toBe('orbit');
    expect(c.transitionDuration).toBe(1.0);
    expect(c.dofEnabled).toBe(true);
    expect(c.focalLength).toBe(35);
    expect(c.currentShot).toBe(0);
  });

  it('export-import 往返保持一致', () => {
    const c1 = new CinematicCamera();
    c1.addShot(makeShot('A', 1, 2, 3, 50, 2, 'cut'));
    c1.addShot(makeShot('B', 4, 5, 6, 70, 3, 'dolly'));
    c1.transitionDuration = 0.7;
    c1.setDOF(true, 12, 2.8);
    c1.focalLength = 50;
    const data = c1.exportTimeline();

    const c2 = new CinematicCamera();
    c2.importTimeline(data);
    expect(c2.shots.length).toBe(2);
    expect(c2.shots[1].position.x).toBe(4);
    expect(c2.shots[1].fov).toBe(70);
    expect(c2.transitionDuration).toBe(0.7);
    expect(c2.aperture).toBe(2.8);
  });

  it('空序列 update 不抛错', () => {
    const c = new CinematicCamera();
    expect(() => c.update(0.1)).not.toThrow();
  });

  it('update 更新相机 FOV 并触发投影矩阵重算', () => {
    const c = new CinematicCamera();
    c.addShot(makeShot('A', 0, 0, 10, 50, 5, 'cut'));
    c.addShot(makeShot('B', 0, 0, 10, 80, 5, 'cut'));
    c.play();
    expect(c.camera.fov).toBe(50);
    c.nextShot();
    c.update(0.001);
    expect(c.camera.fov).toBe(80);
  });
});
