import { describe, it, expect, beforeEach } from 'vitest';
import {
  PerceptionSystem,
  type Sensor,
  type PerceptionTarget,
} from './PerceptionSystem';
import { Vector3 } from '../Math';

/** 构造一个简单 owner:有 position + forward。 */
function makeOwner(x: number, y: number, z: number, forward?: [number, number, number]) {
  return {
    position: new Vector3(x, y, z),
    forward: forward ? new Vector3(...forward) : new Vector3(0, 0, -1),
  };
}

/** 构造一个标准视觉传感器。 */
function makeVisionSensor(owner: any, range = 20, angle = Math.PI / 2): Sensor {
  return {
    id: 'eyes',
    type: 'vision',
    owner,
    range,
    angle,
    sensitivity: 0.3,
    filter: [],
    cooldown: 0,
    lastTrigger: 0,
  };
}

/** 构造一个标准目标。 */
function makeTarget(x: number, y: number, z: number, type = 'enemy', noise = 1.0): PerceptionTarget {
  return { position: new Vector3(x, y, z), type, noise };
}

describe('PerceptionSystem', () => {
  let ps: PerceptionSystem;

  beforeEach(() => {
    ps = new PerceptionSystem();
  });

  describe('传感器管理', () => {
    it('addSensor 添加传感器', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner));
      expect(ps.sensors.size).toBe(1);
      expect(ps.getSensor('eyes')).toBeDefined();
    });

    it('addSensor 设置 sensor.id 为传入 id', () => {
      const owner = makeOwner(0, 0, 0);
      const sensor = makeVisionSensor(owner);
      ps.addSensor('vision', sensor);
      expect(sensor.id).toBe('vision');
    });

    it('addSensor 同 id 覆盖', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 10));
      ps.addSensor('eyes', makeVisionSensor(owner, 20));
      expect(ps.sensors.size).toBe(1);
      expect(ps.getSensor('eyes')!.range).toBe(20);
    });

    it('addSensor 传入 null 抛错', () => {
      expect(() => ps.addSensor('bad', null as any)).toThrow();
    });

    it('removeSensor 移除传感器', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner));
      ps.removeSensor('eyes');
      expect(ps.sensors.size).toBe(0);
      expect(ps.getSensor('eyes')).toBeUndefined();
    });

    it('removeSensor 不存在的 id 不报错', () => {
      expect(() => ps.removeSensor('nope')).not.toThrow();
    });

    it('getSensor 不存在返回 undefined', () => {
      expect(ps.getSensor('nope')).toBeUndefined();
    });

    it('getSensors 返回数组快照', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('a', makeVisionSensor(owner));
      ps.addSensor('b', makeVisionSensor(owner));
      const arr = ps.getSensors();
      expect(arr.length).toBe(2);
      expect(Array.isArray(arr)).toBe(true);
    });
  });

  describe('视觉检测', () => {
    it('目标在前方范围内被检测到', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(true);
    });

    it('目标在范围外不被检测', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 5, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(false);
    });

    it('目标在 FOV 外不被检测', () => {
      const owner = makeOwner(0, 0, 0, [0, 0, -1]); // 朝 -Z
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 4)); // 45° FOV
      const target = makeTarget(10, 0, 0); // 在 +X 方向,FOV 外
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(false);
    });

    it('目标在身后(FOV 外)不被检测', () => {
      const owner = makeOwner(0, 0, 0, [0, 0, -1]);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, 10); // 在 +Z 方向(身后)
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(false);
    });

    it('occlusionTest 遮挡时返回 false', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      ps.occlusionTest = () => true; // 总是遮挡
      const target = makeTarget(0, 0, -10);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(false);
    });

    it('occlusionTest 不遮挡时返回 true', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      ps.occlusionTest = () => false;
      const target = makeTarget(0, 0, -10);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(true);
    });

    it('owner 无 position 返回 false', () => {
      ps.addSensor('eyes', makeVisionSensor(null, 20, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(false);
    });

    it('目标与 owner 同位置返回 false(距离≈0)', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, 0);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(false);
    });
  });

  describe('听觉检测', () => {
    it('近距离高噪声被检测', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('ears', {
        id: 'ears', type: 'hearing', owner,
        range: 20, angle: 0, sensitivity: 0.2,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -5, 'enemy', 1.0);
      expect(ps.checkHearing(ps.getSensor('ears')!, target, 1.0)).toBe(true);
    });

    it('远距离低噪声不被检测', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('ears', {
        id: 'ears', type: 'hearing', owner,
        range: 20, angle: 0, sensitivity: 0.5,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      // 距离 18,衰减 = 1 - 18/20 = 0.1,感知 = 0.1 * 0.3 = 0.03 < 0.5
      const target = makeTarget(0, 0, -18, 'enemy', 0.3);
      expect(ps.checkHearing(ps.getSensor('ears')!, target, 0.3)).toBe(false);
    });

    it('目标在范围外不被检测', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('ears', {
        id: 'ears', type: 'hearing', owner,
        range: 10, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -15, 'enemy', 1.0);
      expect(ps.checkHearing(ps.getSensor('ears')!, target, 1.0)).toBe(false);
    });

    it('owner 无 position 返回 false', () => {
      ps.addSensor('ears', {
        id: 'ears', type: 'hearing', owner: null,
        range: 10, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -5, 'enemy', 1.0);
      expect(ps.checkHearing(ps.getSensor('ears')!, target, 1.0)).toBe(false);
    });
  });

  describe('触觉检测', () => {
    it('目标在范围内被检测', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('touch', {
        id: 'touch', type: 'touch', owner,
        range: 1, angle: 0, sensitivity: 0.5,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -0.5);
      expect(ps.checkTouch(ps.getSensor('touch')!, target)).toBe(true);
    });

    it('目标在范围外不被检测', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('touch', {
        id: 'touch', type: 'touch', owner,
        range: 1, angle: 0, sensitivity: 0.5,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -2);
      expect(ps.checkTouch(ps.getSensor('touch')!, target)).toBe(false);
    });

    it('owner 无 position 返回 false', () => {
      ps.addSensor('touch', {
        id: 'touch', type: 'touch', owner: null,
        range: 1, angle: 0, sensitivity: 0.5,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -0.5);
      expect(ps.checkTouch(ps.getSensor('touch')!, target)).toBe(false);
    });
  });

  describe('嗅觉检测', () => {
    it('无风时近距离被检测(半范围内)', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('nose', {
        id: 'nose', type: 'smell', owner,
        range: 20, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      ps.windStrength = 0;
      const target = makeTarget(0, 0, -5); // 距离 5 < 20*0.5=10
      expect(ps.checkSmell(ps.getSensor('nose')!, target)).toBe(true);
    });

    it('无风时远距离不被检测(超出半范围)', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('nose', {
        id: 'nose', type: 'smell', owner,
        range: 20, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      ps.windStrength = 0;
      const target = makeTarget(0, 0, -15); // 距离 15 > 20*0.5=10
      expect(ps.checkSmell(ps.getSensor('nose')!, target)).toBe(false);
    });

    it('风从目标吹向 owner 时增大检测范围', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('nose', {
        id: 'nose', type: 'smell', owner,
        range: 20, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      // 风向 +Z(从 -Z 方向的目标吹向 owner)
      ps.windDirection.set(0, 0, 1);
      ps.windStrength = 1.0;
      const target = makeTarget(0, 0, -18); // 距离 18,alignment=1,有效范围=20
      expect(ps.checkSmell(ps.getSensor('nose')!, target)).toBe(true);
    });

    it('风从 owner 吹向目标时减小检测范围', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('nose', {
        id: 'nose', type: 'smell', owner,
        range: 20, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      // 风向 -Z(从 owner 吹向 -Z 方向的目标)
      ps.windDirection.set(0, 0, -1);
      ps.windStrength = 1.0;
      const target = makeTarget(0, 0, -15); // alignment=-1,有效范围=20*0.25=5
      expect(ps.checkSmell(ps.getSensor('nose')!, target)).toBe(false);
    });

    it('目标在范围外不被检测', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('nose', {
        id: 'nose', type: 'smell', owner,
        range: 10, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      ps.windDirection.set(0, 0, 1);
      ps.windStrength = 1.0;
      const target = makeTarget(0, 0, -15);
      expect(ps.checkSmell(ps.getSensor('nose')!, target)).toBe(false);
    });

    it('owner 无 position 返回 false', () => {
      ps.addSensor('nose', {
        id: 'nose', type: 'smell', owner: null,
        range: 10, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -5);
      expect(ps.checkSmell(ps.getSensor('nose')!, target)).toBe(false);
    });
  });

  describe('update 生成事件', () => {
    it('视觉检测生成事件', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      ps.update(0.1, [target]);
      expect(ps.perceptions.length).toBe(1);
      const e = ps.perceptions[0];
      expect(e.sensorId).toBe('eyes');
      expect(e.targetType).toBe('enemy');
      expect(e.target).toBe(target);
      expect(e.strength).toBeGreaterThan(0);
      expect(e.isConfirmed).toBe(true);
    });

    it('强度低于灵敏度时标记为未确认', () => {
      const owner = makeOwner(0, 0, 0);
      const sensor = makeVisionSensor(owner, 20, Math.PI / 2);
      sensor.sensitivity = 0.99; // 高灵敏度
      ps.addSensor('eyes', sensor);
      const target = makeTarget(0, 0, -18); // 远距离,强度 = 1 - 18/20 = 0.1
      ps.update(0.1, [target]);
      expect(ps.perceptions.length).toBe(1);
      expect(ps.perceptions[0].isConfirmed).toBe(false);
    });

    it('跳过自身(owner 即 target)', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      // target 引用等于 owner
      ps.update(0.1, [owner as any]);
      expect(ps.perceptions.length).toBe(0);
    });

    it('类型过滤:仅检测 filter 中的类型', () => {
      const owner = makeOwner(0, 0, 0);
      const sensor = makeVisionSensor(owner, 20, Math.PI / 2);
      sensor.filter = ['enemy'];
      ps.addSensor('eyes', sensor);
      const enemy = makeTarget(0, 0, -10, 'enemy');
      const friend = makeTarget(0, 0, -10, 'friend');
      ps.update(0.1, [enemy, friend]);
      expect(ps.perceptions.length).toBe(1);
      expect(ps.perceptions[0].targetType).toBe('enemy');
    });

    it('空 filter 检测所有类型', () => {
      const owner = makeOwner(0, 0, 0);
      const sensor = makeVisionSensor(owner, 20, Math.PI / 2);
      sensor.filter = [];
      ps.addSensor('eyes', sensor);
      const enemy = makeTarget(0, 0, -10, 'enemy');
      const friend = makeTarget(0, 0, -10, 'friend');
      ps.update(0.1, [enemy, friend]);
      expect(ps.perceptions.length).toBe(2);
    });

    it('冷却期间不触发新检测', () => {
      const owner = makeOwner(0, 0, 0);
      const sensor = makeVisionSensor(owner, 20, Math.PI / 2);
      sensor.cooldown = 1.0;
      ps.addSensor('eyes', sensor);
      const target = makeTarget(0, 0, -10);
      ps.update(0.1, [target]); // 第一次检测,触发冷却
      expect(ps.perceptions.length).toBe(1);
      ps.update(0.5, [target]); // 冷却中(0.6 < 1.0)
      expect(ps.perceptions.length).toBe(1);
      ps.update(0.5, [target]); // 冷却结束(1.1 >= 1.0)
      expect(ps.perceptions.length).toBe(2);
    });

    it('dt <= 0 不更新', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      ps.update(0, [target]);
      expect(ps.perceptions.length).toBe(0);
    });

    it('确认事件后传感器同帧可继续检测其他目标', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const t1 = makeTarget(0, 0, -10, 'enemy');
      const t2 = makeTarget(1, 0, -10, 'enemy');
      ps.update(0.1, [t1, t2]);
      // 两个目标都在 FOV 内,都应被检测
      expect(ps.perceptions.length).toBe(2);
    });

    it('听觉检测生成事件', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('ears', {
        id: 'ears', type: 'hearing', owner,
        range: 20, angle: 0, sensitivity: 0.2,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -5, 'enemy', 1.0);
      ps.update(0.1, [target]);
      expect(ps.perceptions.length).toBe(1);
      expect(ps.perceptions[0].sensorId).toBe('ears');
    });

    it('触觉检测生成事件', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('touch', {
        id: 'touch', type: 'touch', owner,
        range: 1, angle: 0, sensitivity: 0.5,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      const target = makeTarget(0, 0, -0.5);
      ps.update(0.1, [target]);
      expect(ps.perceptions.length).toBe(1);
      expect(ps.perceptions[0].strength).toBe(1);
    });

    it('嗅觉检测生成事件', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('nose', {
        id: 'nose', type: 'smell', owner,
        range: 20, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
      ps.windStrength = 0;
      const target = makeTarget(0, 0, -5);
      ps.update(0.1, [target]);
      expect(ps.perceptions.length).toBe(1);
      expect(ps.perceptions[0].sensorId).toBe('nose');
    });

    it('事件 position 为克隆(修改 target 不影响事件)', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      ps.update(0.1, [target]);
      const eventPos = ps.perceptions[0].position;
      const origX = eventPos.x;
      target.position.x = 999;
      expect(eventPos.x).toBe(origX);
    });
  });

  describe('事件查询', () => {
    beforeEach(() => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      ps.addSensor('ears', {
        id: 'ears', type: 'hearing', owner,
        range: 20, angle: 0, sensitivity: 0.1,
        filter: [], cooldown: 0, lastTrigger: 0,
      });
    });

    it('getPerceptions 返回所有事件', () => {
      const enemy = makeTarget(0, 0, -10, 'enemy');
      const friend = makeTarget(0, 0, -10, 'friend');
      ps.update(0.1, [enemy, friend]);
      // 两个传感器各检测两个目标(第二目标被 break 跳过),约 2 个事件
      expect(ps.getPerceptions().length).toBeGreaterThanOrEqual(1);
    });

    it('getPerceptionsByType 按目标类型筛选', () => {
      const enemy = makeTarget(0, 0, -10, 'enemy');
      const friend = makeTarget(0, 0, -10, 'friend');
      ps.update(0.1, [enemy, friend]);
      const enemies = ps.getPerceptionsByType('enemy');
      expect(enemies.length).toBeGreaterThan(0);
      expect(enemies.every((e) => e.targetType === 'enemy')).toBe(true);
    });

    it('getRecentPerceptions 返回时间窗内事件', () => {
      const target = makeTarget(0, 0, -10);
      ps.update(0.1, [target]); // t=0.1
      ps.update(0.5, [target]); // t=0.6
      ps.update(1.0, [target]); // t=1.6
      // 时间窗 1.0 秒:cutoff = 1.6 - 1.0 = 0.6,包含 t=0.6 和 t=1.6
      const recent = ps.getRecentPerceptions(1.0);
      expect(recent.length).toBeGreaterThan(0);
      expect(recent.every((e) => e.timestamp >= 0.6)).toBe(true);
    });

    it('clearPerceptions 清空事件', () => {
      const target = makeTarget(0, 0, -10);
      ps.update(0.1, [target]);
      expect(ps.perceptions.length).toBeGreaterThan(0);
      ps.clearPerceptions();
      expect(ps.perceptions.length).toBe(0);
    });

    it('超出 maxPerceptions 淘汰最旧', () => {
      ps.maxPerceptions = 2;
      const owner = makeOwner(0, 0, 0);
      // 使用无冷却的视觉传感器,但单帧只确认一个 → 需多帧
      const sensor = makeVisionSensor(owner, 20, Math.PI * 2); // 全方位
      sensor.cooldown = 0;
      ps.addSensor('eyes', sensor);
      // 三帧各检测一次
      for (let i = 0; i < 3; i++) {
        ps.update(0.1, [makeTarget(0, 0, -1, 'e' + i)]);
      }
      expect(ps.perceptions.length).toBe(2); // 被裁剪到 maxPerceptions
    });
  });

  describe('参数设置', () => {
    it('setSensitivity 设置灵敏度', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner));
      ps.setSensitivity('eyes', 0.8);
      expect(ps.getSensor('eyes')!.sensitivity).toBe(0.8);
    });

    it('setRange 设置范围', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner));
      ps.setRange('eyes', 50);
      expect(ps.getSensor('eyes')!.range).toBe(50);
    });

    it('setAngle 设置角度', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner));
      ps.setAngle('eyes', Math.PI);
      expect(ps.getSensor('eyes')!.angle).toBe(Math.PI);
    });

    it('set* 不存在的 id 不报错', () => {
      expect(() => ps.setSensitivity('nope', 0.5)).not.toThrow();
      expect(() => ps.setRange('nope', 10)).not.toThrow();
      expect(() => ps.setAngle('nope', 1)).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('空系统统计', () => {
      const stats = ps.getStats();
      expect(stats.sensorCount).toBe(0);
      expect(stats.perceptionCount).toBe(0);
      expect(stats.confirmedCount).toBe(0);
      expect(stats.currentTime).toBe(0);
    });

    it('检测后统计正确', () => {
      const owner = makeOwner(0, 0, 0);
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const enemy = makeTarget(0, 0, -10, 'enemy');
      ps.update(0.1, [enemy]);
      const stats = ps.getStats();
      expect(stats.sensorCount).toBe(1);
      expect(stats.perceptionCount).toBe(1);
      expect(stats.confirmedCount).toBe(1);
      expect(stats.byTargetType['enemy']).toBe(1);
      expect(stats.currentTime).toBe(0.1);
    });
  });

  describe('owner 朝向来源', () => {
    it('使用 velocity 作为朝向(Agent 风格)', () => {
      const owner = {
        position: new Vector3(0, 0, 0),
        velocity: new Vector3(0, 0, -1), // 朝 -Z 移动
      };
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(true);
    });

    it('使用 rotation 作为朝向(Object3D 风格)', () => {
      // 绕 Y 轴旋转 180° 朝 +Z
      const owner = {
        position: new Vector3(0, 0, 0),
        rotation: { x: 0, y: 0, z: 0, w: 1 }, // 单位四元数,朝 -Z
      };
      // 应用 (0,0,-1) 到单位四元数 → (0,0,-1)
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(true);
    });

    it('无 forward/velocity/rotation 时默认 (0,0,-1)', () => {
      const owner = { position: new Vector3(0, 0, 0) };
      ps.addSensor('eyes', makeVisionSensor(owner, 20, Math.PI / 2));
      const target = makeTarget(0, 0, -10);
      expect(ps.checkVision(ps.getSensor('eyes')!, target)).toBe(true);
    });
  });
});
