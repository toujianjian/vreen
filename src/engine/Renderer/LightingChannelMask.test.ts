// LightingChannelMask 单元测试。
//
// 覆盖:
//   A. 常量
//   B. 纯函数:channelMask / channelsMask / getChannel / setChannel
//   C. 纯函数:affects / hasAnyChannel / countChannels / listChannels
//   D. LightingChannelConfiguration 类:构造、get/set、链式、affects、序列化、克隆、工厂
//   E. 边界与错误:越界抛 RangeError

import { describe, it, expect } from 'vitest';
import {
  MAX_LIGHTING_CHANNELS,
  ALL_LIGHTING_CHANNELS,
  NO_LIGHTING_CHANNELS,
  DEFAULT_LIGHTING_CHANNEL,
  channelMask,
  channelsMask,
  getChannel,
  setChannel,
  affects,
  hasAnyChannel,
  countChannels,
  listChannels,
  LightingChannelConfiguration,
} from './LightingChannelMask';

// ── A. 常量 ───────────────────────────────────────────────────────

describe('constants', () => {
  it('MAX_LIGHTING_CHANNELS = 32', () => {
    expect(MAX_LIGHTING_CHANNELS).toBe(32);
  });

  it('ALL_LIGHTING_CHANNELS = 0xFFFFFFFF', () => {
    expect(ALL_LIGHTING_CHANNELS).toBe(0xFFFFFFFF);
  });

  it('NO_LIGHTING_CHANNELS = 0', () => {
    expect(NO_LIGHTING_CHANNELS).toBe(0);
  });

  it('DEFAULT_LIGHTING_CHANNEL = bit 0 (1)', () => {
    expect(DEFAULT_LIGHTING_CHANNEL).toBe(1);
  });
});

// ── B. 纯函数:掩码构造与读写 ─────────────────────────────────────

describe('channelMask', () => {
  it('channel 0 → 1', () => {
    expect(channelMask(0)).toBe(1);
  });

  it('channel 1 → 2', () => {
    expect(channelMask(1)).toBe(2);
  });

  it('channel 5 → 32', () => {
    expect(channelMask(5)).toBe(32);
  });

  it('channel 31 → 0x80000000', () => {
    expect(channelMask(31)).toBe(0x80000000);
  });

  it('throws on negative index', () => {
    expect(() => channelMask(-1)).toThrow(RangeError);
  });

  it('throws on index >= 32', () => {
    expect(() => channelMask(32)).toThrow(RangeError);
  });
});

describe('channelsMask', () => {
  it('empty → 0', () => {
    expect(channelsMask()).toBe(0);
  });

  it('single → same as channelMask', () => {
    expect(channelsMask(3)).toBe(channelMask(3));
  });

  it('multiple → bitwise OR', () => {
    expect(channelsMask(0, 2, 4)).toBe(0b10101); // 1 + 4 + 16 = 21
  });

  it('duplicate indices collapse', () => {
    expect(channelsMask(1, 1, 1)).toBe(channelMask(1));
  });

  it('throws on out-of-range index', () => {
    expect(() => channelsMask(0, 32)).toThrow(RangeError);
  });
});

describe('getChannel', () => {
  it('returns true for set channel', () => {
    expect(getChannel(channelsMask(0, 3), 0)).toBe(true);
    expect(getChannel(channelsMask(0, 3), 3)).toBe(true);
  });

  it('returns false for unset channel', () => {
    expect(getChannel(channelsMask(0, 3), 1)).toBe(false);
    expect(getChannel(channelsMask(0, 3), 2)).toBe(false);
  });

  it('throws on out-of-range', () => {
    expect(() => getChannel(0, 32)).toThrow(RangeError);
  });
});

describe('setChannel', () => {
  it('sets a channel on', () => {
    expect(setChannel(0, 5, true)).toBe(channelMask(5));
  });

  it('sets a channel off', () => {
    expect(setChannel(channelsMask(0, 5), 5, false)).toBe(channelMask(0));
  });

  it('is idempotent when already set', () => {
    const m = channelsMask(0, 5);
    expect(setChannel(m, 5, true)).toBe(m);
  });

  it('is idempotent when already unset', () => {
    expect(setChannel(0, 5, false)).toBe(0);
  });

  it('does not mutate the input (returns new value)', () => {
    const original = channelsMask(0, 5);
    const result = setChannel(original, 3, true);
    expect(original).toBe(channelsMask(0, 5)); // unchanged
    expect(result).toBe(channelsMask(0, 3, 5));
  });

  it('throws on out-of-range', () => {
    expect(() => setChannel(0, 32, true)).toThrow(RangeError);
  });
});

// ── C. 纯函数:影响测试与统计 ─────────────────────────────────────

describe('affects', () => {
  it('returns true when sharing a channel', () => {
    expect(affects(channelsMask(0, 1), channelsMask(1, 2))).toBe(true);
  });

  it('returns false when no shared channel', () => {
    expect(affects(channelsMask(0, 1), channelsMask(2, 3))).toBe(false);
  });

  it('returns true when light is ALL channels', () => {
    expect(affects(ALL_LIGHTING_CHANNELS, channelMask(5))).toBe(true);
  });

  it('returns true when object is ALL channels', () => {
    expect(affects(channelMask(5), ALL_LIGHTING_CHANNELS)).toBe(true);
  });

  it('returns false when either is NO channels', () => {
    expect(affects(NO_LIGHTING_CHANNELS, ALL_LIGHTING_CHANNELS)).toBe(false);
    expect(affects(ALL_LIGHTING_CHANNELS, NO_LIGHTING_CHANNELS)).toBe(false);
  });

  it('default config (all) affects default config (all)', () => {
    expect(affects(ALL_LIGHTING_CHANNELS, ALL_LIGHTING_CHANNELS)).toBe(true);
  });
});

describe('hasAnyChannel', () => {
  it('true for non-zero mask', () => {
    expect(hasAnyChannel(channelMask(0))).toBe(true);
  });

  it('false for zero mask', () => {
    expect(hasAnyChannel(0)).toBe(false);
  });

  it('true for ALL_LIGHTING_CHANNELS', () => {
    expect(hasAnyChannel(ALL_LIGHTING_CHANNELS)).toBe(true);
  });
});

describe('countChannels', () => {
  it('0 for empty mask', () => {
    expect(countChannels(0)).toBe(0);
  });

  it('1 for single channel', () => {
    expect(countChannels(channelMask(7))).toBe(1);
  });

  it('3 for three channels', () => {
    expect(countChannels(channelsMask(0, 5, 31))).toBe(3);
  });

  it('32 for ALL_LIGHTING_CHANNELS', () => {
    expect(countChannels(ALL_LIGHTING_CHANNELS)).toBe(32);
  });
});

describe('listChannels', () => {
  it('empty for zero mask', () => {
    expect(listChannels(0)).toEqual([]);
  });

  it('lists set channels in ascending order', () => {
    expect(listChannels(channelsMask(5, 0, 3))).toEqual([0, 3, 5]);
  });

  it('lists all 32 for ALL', () => {
    const list = listChannels(ALL_LIGHTING_CHANNELS);
    expect(list.length).toBe(32);
    expect(list[0]).toBe(0);
    expect(list[31]).toBe(31);
  });
});

// ── D. LightingChannelConfiguration 类 ────────────────────────────

describe('LightingChannelConfiguration', () => {
  describe('constructor', () => {
    it('defaults to ALL_LIGHTING_CHANNELS', () => {
      const c = new LightingChannelConfiguration();
      expect(c.mask).toBe(ALL_LIGHTING_CHANNELS);
      expect(c.isDefault()).toBe(true);
    });

    it('accepts a custom mask', () => {
      const c = new LightingChannelConfiguration(channelsMask(0, 1));
      expect(c.mask).toBe(channelsMask(0, 1));
      expect(c.isDefault()).toBe(false);
    });
  });

  describe('setMask / getChannel', () => {
    it('setMask returns this (chainable)', () => {
      const c = new LightingChannelConfiguration();
      expect(c.setMask(channelMask(3))).toBe(c);
    });

    it('getChannel reads the set mask', () => {
      const c = new LightingChannelConfiguration(channelsMask(0, 2));
      expect(c.getChannel(0)).toBe(true);
      expect(c.getChannel(1)).toBe(false);
      expect(c.getChannel(2)).toBe(true);
    });
  });

  describe('setChannel / enableChannel / disableChannel', () => {
    it('setChannel is chainable and toggles', () => {
      const c = new LightingChannelConfiguration(0);
      c.setChannel(3, true);
      expect(c.getChannel(3)).toBe(true);
      c.setChannel(3, false);
      expect(c.getChannel(3)).toBe(false);
    });

    it('enableChannel turns on without clearing others', () => {
      const c = new LightingChannelConfiguration(channelsMask(0));
      c.enableChannel(5);
      expect(c.getChannel(0)).toBe(true);
      expect(c.getChannel(5)).toBe(true);
    });

    it('disableChannel turns off without clearing others', () => {
      const c = new LightingChannelConfiguration(channelsMask(0, 5));
      c.disableChannel(5);
      expect(c.getChannel(0)).toBe(true);
      expect(c.getChannel(5)).toBe(false);
    });
  });

  describe('setSingleChannel', () => {
    it('sets only the given channel', () => {
      const c = new LightingChannelConfiguration(ALL_LIGHTING_CHANNELS);
      c.setSingleChannel(7);
      expect(c.mask).toBe(channelMask(7));
      expect(c.count()).toBe(1);
    });
  });

  describe('enableChannels', () => {
    it('enables multiple channels additively', () => {
      const c = new LightingChannelConfiguration(channelsMask(0));
      c.enableChannels(2, 4);
      expect(c.mask).toBe(channelsMask(0, 2, 4));
    });
  });

  describe('reset / clear', () => {
    it('reset → ALL channels', () => {
      const c = new LightingChannelConfiguration(0);
      c.reset();
      expect(c.mask).toBe(ALL_LIGHTING_CHANNELS);
      expect(c.isDefault()).toBe(true);
    });

    it('clear → NO channels', () => {
      const c = new LightingChannelConfiguration(ALL_LIGHTING_CHANNELS);
      c.clear();
      expect(c.mask).toBe(0);
      expect(c.count()).toBe(0);
    });
  });

  describe('affects', () => {
    it('returns true when sharing a channel with another config', () => {
      const light = LightingChannelConfiguration.fromChannels(0, 1);
      const obj = LightingChannelConfiguration.fromChannels(1, 2);
      expect(light.affects(obj)).toBe(true);
    });

    it('returns false when disjoint', () => {
      const light = LightingChannelConfiguration.fromChannels(0);
      const obj = LightingChannelConfiguration.fromChannels(1);
      expect(light.affects(obj)).toBe(false);
    });

    it('accepts a raw mask', () => {
      const light = LightingChannelConfiguration.fromChannels(0);
      expect(light.affects(channelMask(0))).toBe(true);
      expect(light.affects(channelMask(1))).toBe(false);
    });

    it('default affects default', () => {
      expect(LightingChannelConfiguration.default().affects(LightingChannelConfiguration.default())).toBe(true);
    });
  });

  describe('count / list', () => {
    it('count returns number of set channels', () => {
      const c = LightingChannelConfiguration.fromChannels(0, 5, 10);
      expect(c.count()).toBe(3);
    });

    it('list returns ascending channel indices', () => {
      const c = LightingChannelConfiguration.fromChannels(10, 0, 5);
      expect(c.list()).toEqual([0, 5, 10]);
    });
  });

  describe('serialization', () => {
    it('toJSON returns { mask }', () => {
      const c = LightingChannelConfiguration.fromChannels(0, 3);
      expect(c.toJSON()).toEqual({ mask: channelsMask(0, 3) });
    });

    it('fromJSON restores the mask', () => {
      const original = LightingChannelConfiguration.fromChannels(1, 4, 7);
      const json = original.toJSON();
      const restored = LightingChannelConfiguration.fromJSON(json);
      expect(restored.mask).toBe(original.mask);
      expect(restored.list()).toEqual([1, 4, 7]);
    });

    it('round-trip preserves ALL channels', () => {
      const c = LightingChannelConfiguration.default();
      const restored = LightingChannelConfiguration.fromJSON(c.toJSON());
      expect(restored.isDefault()).toBe(true);
    });
  });

  describe('clone', () => {
    it('produces an independent copy', () => {
      const original = LightingChannelConfiguration.fromChannels(0, 1);
      const copy = original.clone();
      copy.disableChannel(0);
      expect(original.getChannel(0)).toBe(true);
      expect(copy.getChannel(0)).toBe(false);
    });
  });

  describe('factories', () => {
    it('only(index) = single channel', () => {
      expect(LightingChannelConfiguration.only(5).mask).toBe(channelMask(5));
    });

    it('fromChannels(...) = OR of channels', () => {
      expect(LightingChannelConfiguration.fromChannels(0, 2, 4).mask).toBe(channelsMask(0, 2, 4));
    });

    it('default() = ALL channels', () => {
      expect(LightingChannelConfiguration.default().isDefault()).toBe(true);
    });
  });
});

// ── E. 典型用例验证(集成场景) ────────────────────────────────────

describe('use-case scenarios', () => {
  it('flashlight only lights the player', () => {
    // Flashlight on channel 1; player on channel 1; environment on channel 0.
    const flashlight = LightingChannelConfiguration.only(1);
    const player = LightingChannelConfiguration.only(1);
    const environment = LightingChannelConfiguration.only(0);

    expect(flashlight.affects(player)).toBe(true);
    expect(flashlight.affects(environment)).toBe(false);
  });

  it('muzzle flash lights enemies and nearby props, not the whole map', () => {
    // Muzzle flash on channels 1+2; enemies on 1; nearby props on 2; distant sky on 0.
    const muzzle = LightingChannelConfiguration.fromChannels(1, 2);
    const enemy = LightingChannelConfiguration.only(1);
    const nearbyProp = LightingChannelConfiguration.only(2);
    const sky = LightingChannelConfiguration.only(0);

    expect(muzzle.affects(enemy)).toBe(true);
    expect(muzzle.affects(nearbyProp)).toBe(true);
    expect(muzzle.affects(sky)).toBe(false);
  });

  it('default lights illuminate everything (backward compat)', () => {
    const sun = LightingChannelConfiguration.default();
    const anyObject = LightingChannelConfiguration.only(31);
    expect(sun.affects(anyObject)).toBe(true);
  });

  it('emissive-only object is never lit', () => {
    const sun = LightingChannelConfiguration.default();
    const emissive = new LightingChannelConfiguration(NO_LIGHTING_CHANNELS);
    expect(sun.affects(emissive)).toBe(false);
  });
});
