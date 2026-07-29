import { describe, it, expect } from 'vitest';
import { CameraRig } from './CameraRig';
import { PerspectiveCamera } from './PerspectiveCamera';
import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math';

describe('CameraRig', () => {
  it('默认构造使用合理参数', () => {
    const rig = new CameraRig();
    expect(rig.camera).toBeNull();
    expect(rig.type).toBe('fixed');
    expect(rig.target).toBeNull();
    expect(rig.height).toBe(5);
    expect(rig.radius).toBe(10);
    expect(rig.speed).toBe(0.5);
    expect(rig.damping).toBe(0.1);
  });

  it('可接受外部 Camera 实例', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    expect(rig.camera).toBe(cam);
  });

  it('follow 设置目标并对齐位置', () => {
    const rig = new CameraRig();
    const target = new Object3D();
    target.position.set(5, 0, 5);
    rig.follow(target);
    expect(rig.target).toBe(target);
    // follow 后 position 应对齐到 target + offset
    expect(rig.position.x).toBe(5);
    expect(rig.position.z).toBe(10); // target.z(5) + offset.z(5)
  });

  it('无目标时 update 不抛错', () => {
    const rig = new CameraRig();
    expect(() => rig.update(0.1)).not.toThrow();
  });

  it('setType 设置运动模式', () => {
    const rig = new CameraRig();
    rig.setType('orbit');
    expect(rig.type).toBe('orbit');
    rig.setType('crane');
    expect(rig.type).toBe('crane');
  });

  it('setOffset 设置偏移', () => {
    const rig = new CameraRig();
    rig.setOffset(new Vector3(1, 2, 3));
    expect(rig.offset.x).toBe(1);
    expect(rig.offset.y).toBe(2);
    expect(rig.offset.z).toBe(3);
  });

  it('orbit 设置轨道角度', () => {
    const rig = new CameraRig();
    rig.orbit(Math.PI / 2);
    // 内部 orbitAngle 通过 update 才能读取,但 orbit 返回 this
    expect(rig).toBe(rig);
  });

  it('fixed 模式相机跟随 target + offset', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.damping = 0; // 瞬跟
    const target = new Object3D();
    target.position.set(0, 0, 0);
    rig.follow(target);
    rig.setType('fixed');
    rig.setOffset(new Vector3(0, 5, 10));
    rig.update(0.1);
    expect(cam.position.x).toBeCloseTo(0, 5);
    expect(cam.position.y).toBeCloseTo(5, 5);
    expect(cam.position.z).toBeCloseTo(10, 5);
  });

  it('crane 模式相机绕 target 在 height 高度旋转', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.damping = 0;
    const target = new Object3D();
    target.position.set(0, 0, 0);
    rig.follow(target);
    rig.setType('crane');
    rig.height = 8;
    rig.radius = 5;
    rig.speed = 1; // 1 rad/s
    rig.orbit(0); // 起始角度 0
    rig.update(0.001); // 极小 dt 推进
    // 起始位置:X=sin(0)*5=0, Z=cos(0)*5=5, Y=8
    expect(cam.position.y).toBeCloseTo(8, 5);
    // X 应接近 0,Z 接近 5
    expect(Math.abs(cam.position.x)).toBeLessThan(1);
    expect(cam.position.z).toBeGreaterThan(3);
  });

  it('crane 模式随时间推进角度', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.damping = 0;
    const target = new Object3D();
    rig.follow(target);
    rig.setType('crane');
    rig.radius = 5;
    rig.speed = Math.PI / 2; // 90°/s
    rig.orbit(0);
    rig.update(1); // 推进 1 秒,角度增加 π/2
    // 1 秒后角度 = π/2,X=sin(π/2)*5=5, Z=cos(π/2)*5≈0
    expect(cam.position.x).toBeCloseTo(5, 1);
    expect(Math.abs(cam.position.z)).toBeLessThan(1);
  });

  it('orbit 模式相机绕 target 旋转', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.damping = 0;
    const target = new Object3D();
    rig.follow(target);
    rig.setType('orbit');
    rig.radius = 10;
    rig.speed = Math.PI; // 180°/s
    rig.orbit(0);
    rig.update(0.5); // 0.5 秒,角度增加 π/2
    // 角度 = π/2: X=sin(π/2)*10=10, Z=cos(π/2)*10≈0
    expect(cam.position.x).toBeCloseTo(10, 1);
    expect(Math.abs(cam.position.z)).toBeLessThan(1);
  });

  it('dolly 模式相机沿轨道移动', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.damping = 0;
    const target = new Object3D();
    target.position.set(0, 0, 0);
    rig.follow(target);
    rig.setType('dolly');
    rig.speed = 2;
    rig.radius = 5;
    rig.update(0.5);
    // dolly 后位置应偏离起点
    expect(cam.position.z).not.toBe(0);
  });

  it('damping 使位置平滑过渡', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.damping = 0.9; // 大阻尼,慢跟随
    const target = new Object3D();
    target.position.set(0, 0, 0);
    rig.follow(target);
    rig.setType('fixed');
    rig.setOffset(new Vector3(0, 0, 10));
    // target 移动
    target.position.set(100, 0, 0);
    rig.update(0.1);
    // 大阻尼下相机应远未到达新位置
    expect(cam.position.x).toBeLessThan(50);
  });

  it('lookAt 始终朝向 target + lookAtOffset', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.damping = 0;
    const target = new Object3D();
    target.position.set(5, 0, 5);
    rig.follow(target);
    rig.setType('fixed');
    rig.setOffset(new Vector3(0, 0, 0));
    rig.setLookAtOffset(new Vector3(0, 2, 0)); // 看 target 头部
    rig.update(0.1);
    // lookAt 点应为 (5, 2, 5)
    expect(rig.lookAt.x).toBeCloseTo(5, 5);
    expect(rig.lookAt.y).toBeCloseTo(2, 5);
    expect(rig.lookAt.z).toBeCloseTo(5, 5);
  });

  it('attachCamera / detachCamera 切换相机绑定', () => {
    const rig = new CameraRig();
    const cam = new PerspectiveCamera();
    rig.attachCamera(cam);
    expect(rig.camera).toBe(cam);
    rig.detachCamera();
    expect(rig.camera).toBeNull();
  });

  it('orbitBy 增量旋转轨道角度', () => {
    const cam = new PerspectiveCamera();
    const rig = new CameraRig(cam);
    rig.damping = 0;
    const target = new Object3D();
    rig.follow(target);
    rig.setType('orbit');
    rig.radius = 5;
    rig.speed = 0; // 关闭自动旋转
    rig.orbit(0);
    rig.orbitBy(Math.PI / 2); // 手动旋转 90°
    rig.update(0.001);
    // 角度 = π/2: X=sin(π/2)*5=5
    expect(cam.position.x).toBeCloseTo(5, 1);
  });

  it('无 camera 时 update 仍更新内部 position', () => {
    const rig = new CameraRig();
    rig.damping = 0;
    const target = new Object3D();
    target.position.set(3, 0, 3);
    rig.follow(target);
    rig.setType('fixed');
    rig.setOffset(new Vector3(0, 0, 0));
    rig.update(0.1);
    expect(rig.position.x).toBeCloseTo(3, 5);
    expect(rig.position.z).toBeCloseTo(3, 5);
  });
});
