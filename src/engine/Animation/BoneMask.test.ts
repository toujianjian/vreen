import { describe, it, expect } from 'vitest';
import { BoneMask } from './BoneMask';

describe('BoneMask', () => {
  it('default inclusive mask affects no bones when empty', () => {
    const m = new BoneMask();
    expect(m.affects('Hips')).toBe(false);
    expect(m.affects('Spine')).toBe(false);
  });

  it('include adds bones to the set', () => {
    const m = new BoneMask();
    m.include('Hips').include('Spine');
    expect(m.affects('Hips')).toBe(true);
    expect(m.affects('Spine')).toBe(true);
    expect(m.affects('Head')).toBe(false);
  });

  it('exclude removes bones from the set', () => {
    const m = new BoneMask(['Hips', 'Spine'], true);
    m.exclude('Hips');
    expect(m.affects('Hips')).toBe(false);
    expect(m.affects('Spine')).toBe(true);
  });

  it('inclusive=false inverts affects', () => {
    const m = new BoneMask(['Hips'], false);
    // exclusive: 集合内的骨骼不受影响,集合外的受影响
    expect(m.affects('Hips')).toBe(false);
    expect(m.affects('Spine')).toBe(true);
    expect(m.affects('Head')).toBe(true);
  });

  it('constructor accepts an iterable of bone names', () => {
    const m = new BoneMask(['A', 'B', 'C'], true);
    expect(m.affects('A')).toBe(true);
    expect(m.affects('B')).toBe(true);
    expect(m.affects('D')).toBe(false);
  });

  describe('fromPattern', () => {
    it('matches * wildcard', () => {
      // "Left*" matches any bone whose name starts with "Left"
      const m = new BoneMask().fromPattern('Left*');
      expect(m.affects('LeftArm')).toBe(true);
      expect(m.affects('LeftForeArm')).toBe(true);
      expect(m.affects('LeftHand')).toBe(true);
      expect(m.affects('RightArm')).toBe(false);
    });

    it('matches ? single char wildcard', () => {
      const m = new BoneMask().fromPattern('Bone?');
      expect(m.affects('Bone1')).toBe(true);
      expect(m.affects('Bone2')).toBe(true);
      expect(m.affects('Bone12')).toBe(false);
    });

    it('combines pattern with explicit names', () => {
      const m = new BoneMask(['Hips'], true).fromPattern('Spine*');
      expect(m.affects('Hips')).toBe(true);
      expect(m.affects('Spine')).toBe(true);
      expect(m.affects('Spine1')).toBe(true);
      expect(m.affects('Head')).toBe(false);
    });

    it('escapes regex metacharacters', () => {
      const m = new BoneMask().fromPattern('Bone.1');
      // '.' should be literal, not "any char"
      expect(m.affects('Bone.1')).toBe(true);
      expect(m.affects('BoneX1')).toBe(false);
    });
  });

  it('clear removes names and patterns', () => {
    const m = new BoneMask(['A']).fromPattern('B*');
    expect(m.affects('A')).toBe(true);
    expect(m.affects('B1')).toBe(true);
    m.clear();
    expect(m.affects('A')).toBe(false);
    expect(m.affects('B1')).toBe(false);
  });

  it('inclusive=false with pattern inverts correctly', () => {
    const m = new BoneMask([], false).fromPattern('Left*');
    // Left* bones excluded; everything else affected
    expect(m.affects('LeftArm')).toBe(false);
    expect(m.affects('RightArm')).toBe(true);
  });
});
