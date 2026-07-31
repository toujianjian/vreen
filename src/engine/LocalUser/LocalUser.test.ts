// LocalUser 模块单元测试。
//
// 测试策略:
//   - createProfile 默认值
//   - createEmptySlot 默认值
//   - LocalUserManager 默认 4 槽位 + slotCount 钳制
//   - join/leave/reactivate 生命周期
//   - findByDevice / activeSlots / getProfile / setSetting 查询与配置
//   - reset 清空所有槽位

import { describe, it, expect } from 'vitest';
import {
  createProfile,
  createEmptySlot,
  LocalUserManager,
} from './index';

// ── createProfile ────────────────────────────────────────────────

describe('createProfile', () => {
  it('默认值正确', () => {
    const p = createProfile('p1', 'Alice');
    expect(p.id).toBe('p1');
    expect(p.displayName).toBe('Alice');
    expect(p.settings).toEqual({});
    expect(p.savePartition).toBe('player_p1');
  });
});

// ── createEmptySlot ──────────────────────────────────────────────

describe('createEmptySlot', () => {
  it('默认值正确', () => {
    const slot = createEmptySlot(2);
    expect(slot.index).toBe(2);
    expect(slot.state).toBe('empty');
    expect(slot.profile).toBeNull();
    expect(slot.inputDeviceId).toBeNull();
    expect(slot.cameraRigIndex).toBeNull();
  });
});

// ── LocalUserManager ─────────────────────────────────────────────

describe('LocalUserManager', () => {
  describe('构造', () => {
    it('默认 4 个空槽位', () => {
      const m = new LocalUserManager();
      expect(m.slots.length).toBe(4);
      for (const s of m.slots) {
        expect(s.state).toBe('empty');
        expect(s.profile).toBeNull();
      }
    });

    it('slotCount=2/8/16 受尊重', () => {
      expect(new LocalUserManager({ slotCount: 2 }).slots.length).toBe(2);
      expect(new LocalUserManager({ slotCount: 8 }).slots.length).toBe(8);
      expect(new LocalUserManager({ slotCount: 16 }).slots.length).toBe(16);
    });

    it('slotCount>16 钳制到 16', () => {
      expect(new LocalUserManager({ slotCount: 20 }).slots.length).toBe(16);
    });

    it('slotCount<1 钳制到 1', () => {
      expect(new LocalUserManager({ slotCount: 0 }).slots.length).toBe(1);
      expect(new LocalUserManager({ slotCount: -5 }).slots.length).toBe(1);
    });
  });

  describe('join', () => {
    it('第一次 join 分配槽位 0,第二次分配槽位 1', () => {
      const m = new LocalUserManager();
      const p1 = createProfile('p1', 'Alice');
      const p2 = createProfile('p2', 'Bob');
      expect(m.join(p1, 'keyboard')).toBe(0);
      expect(m.join(p2, 'gamepad0')).toBe(1);
      expect(m.slots[0].profile).toBe(p1);
      expect(m.slots[0].state).toBe('active');
      expect(m.slots[0].inputDeviceId).toBe('keyboard');
      expect(m.slots[1].profile).toBe(p2);
    });

    it('cameraRigIndex 默认等于 slot.index', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard');
      expect(m.slots[0].cameraRigIndex).toBe(0);
    });

    it('cameraRigIndex 可显式指定', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard', 3);
      expect(m.slots[0].cameraRigIndex).toBe(3);
    });

    it('所有槽位满时返回 -1', () => {
      const m = new LocalUserManager({ slotCount: 2 });
      m.join(createProfile('p1', 'A'), 'kb1');
      m.join(createProfile('p2', 'B'), 'kb2');
      expect(m.join(createProfile('p3', 'C'), 'kb3')).toBe(-1);
    });
  });

  describe('leave', () => {
    it('标记槽位为 inactive,清空 profile', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard');
      expect(m.leave(0)).toBe(true);
      expect(m.slots[0].state).toBe('inactive');
      expect(m.slots[0].profile).toBeNull();
      expect(m.slots[0].inputDeviceId).toBeNull();
      expect(m.slots[0].cameraRigIndex).toBeNull();
    });

    it('无效 slotIndex 返回 false', () => {
      const m = new LocalUserManager({ slotCount: 2 });
      expect(m.leave(5)).toBe(false);
    });
  });

  describe('reactivate', () => {
    it('重新激活 inactive 槽位', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard');
      m.leave(0);
      expect(m.reactivate(0, createProfile('p2', 'Bob'), 'gamepad0')).toBe(true);
      expect(m.slots[0].state).toBe('active');
      expect(m.slots[0].profile?.displayName).toBe('Bob');
      expect(m.slots[0].inputDeviceId).toBe('gamepad0');
    });

    it('对 active 槽位失败', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard');
      expect(m.reactivate(0, createProfile('p2', 'Bob'), 'gamepad0')).toBe(false);
    });

    it('无效 slotIndex 返回 false', () => {
      const m = new LocalUserManager({ slotCount: 2 });
      expect(m.reactivate(5, createProfile('p1', 'A'), 'kb')).toBe(false);
    });
  });

  describe('findByDevice', () => {
    it('返回绑定到设备的 active 槽位', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard');
      m.join(createProfile('p2', 'Bob'), 'gamepad0');
      const slot = m.findByDevice('gamepad0');
      expect(slot).not.toBeNull();
      expect(slot!.index).toBe(1);
      expect(slot!.profile?.displayName).toBe('Bob');
    });

    it('未绑定的设备返回 null', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard');
      expect(m.findByDevice('gamepad9')).toBeNull();
    });

    it('inactive 槽位的设备不匹配', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard');
      m.leave(0);
      expect(m.findByDevice('keyboard')).toBeNull();
    });
  });

  describe('activeSlots', () => {
    it('只返回 active 槽位', () => {
      const m = new LocalUserManager({ slotCount: 4 });
      m.join(createProfile('p1', 'A'), 'kb1');
      m.join(createProfile('p2', 'B'), 'kb2');
      m.leave(0);
      const active = m.activeSlots();
      expect(active.length).toBe(1);
      expect(active[0].index).toBe(1);
    });
  });

  describe('getProfile', () => {
    it('返回槽位的 profile', () => {
      const m = new LocalUserManager();
      const p = createProfile('p1', 'Alice');
      m.join(p, 'keyboard');
      expect(m.getProfile(0)).toBe(p);
    });

    it('空槽位返回 null', () => {
      const m = new LocalUserManager();
      expect(m.getProfile(0)).toBeNull();
    });

    it('无效 slotIndex 返回 null', () => {
      const m = new LocalUserManager({ slotCount: 2 });
      expect(m.getProfile(99)).toBeNull();
    });
  });

  describe('setSetting', () => {
    it('更新 profile 设置', () => {
      const m = new LocalUserManager();
      m.join(createProfile('p1', 'Alice'), 'keyboard');
      expect(m.setSetting(0, 'volume', 0.8)).toBe(true);
      expect(m.getProfile(0)!.settings['volume']).toBe(0.8);
    });

    it('无效槽位返回 false', () => {
      const m = new LocalUserManager({ slotCount: 2 });
      expect(m.setSetting(5, 'volume', 0.5)).toBe(false);
    });

    it('空槽位 (无 profile) 返回 false', () => {
      const m = new LocalUserManager();
      expect(m.setSetting(0, 'volume', 0.5)).toBe(false);
    });
  });

  describe('reset', () => {
    it('清空所有槽位', () => {
      const m = new LocalUserManager({ slotCount: 4 });
      m.join(createProfile('p1', 'A'), 'kb1');
      m.join(createProfile('p2', 'B'), 'kb2');
      m.leave(0);
      m.reset();
      for (const s of m.slots) {
        expect(s.state).toBe('empty');
        expect(s.profile).toBeNull();
        expect(s.inputDeviceId).toBeNull();
        expect(s.cameraRigIndex).toBeNull();
      }
    });
  });
});
