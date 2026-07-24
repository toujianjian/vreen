import { describe, it, expect } from 'vitest';
import { AvatarMask } from './AvatarMask';

describe('AvatarMask', () => {
  describe('upperBody', () => {
    const mask = AvatarMask.upperBody();
    it('affects spine and head', () => {
      expect(mask.affects('Spine')).toBe(true);
      expect(mask.affects('Chest')).toBe(true);
      expect(mask.affects('Neck')).toBe(true);
      expect(mask.affects('Head')).toBe(true);
    });
    it('affects arms', () => {
      expect(mask.affects('LeftArm')).toBe(true);
      expect(mask.affects('RightArm')).toBe(true);
      expect(mask.affects('LeftForeArm')).toBe(true);
      expect(mask.affects('LeftHand')).toBe(true);
    });
    it('does not affect lower body', () => {
      expect(mask.affects('Hips')).toBe(false);
      expect(mask.affects('LeftUpLeg')).toBe(false);
      expect(mask.affects('LeftLeg')).toBe(false);
    });
  });

  describe('lowerBody', () => {
    const mask = AvatarMask.lowerBody();
    it('affects hips and legs', () => {
      expect(mask.affects('Hips')).toBe(true);
      expect(mask.affects('LeftUpLeg')).toBe(true);
      expect(mask.affects('LeftLeg')).toBe(true);
      expect(mask.affects('LeftFoot')).toBe(true);
    });
    it('does not affect upper body', () => {
      expect(mask.affects('Spine')).toBe(false);
      expect(mask.affects('Head')).toBe(false);
      expect(mask.affects('LeftArm')).toBe(false);
    });
  });

  describe('leftArm', () => {
    const mask = AvatarMask.leftArm();
    it('affects left arm chain only', () => {
      expect(mask.affects('LeftShoulder')).toBe(true);
      expect(mask.affects('LeftArm')).toBe(true);
      expect(mask.affects('LeftForeArm')).toBe(true);
      expect(mask.affects('LeftHand')).toBe(true);
      expect(mask.affects('RightArm')).toBe(false);
    });
  });

  describe('rightArm', () => {
    const mask = AvatarMask.rightArm();
    it('affects right arm chain only', () => {
      expect(mask.affects('RightShoulder')).toBe(true);
      expect(mask.affects('RightArm')).toBe(true);
      expect(mask.affects('RightForeArm')).toBe(true);
      expect(mask.affects('RightHand')).toBe(true);
      expect(mask.affects('LeftArm')).toBe(false);
    });
  });

  describe('leftLeg / rightLeg', () => {
    it('leftLeg affects left leg chain only', () => {
      const mask = AvatarMask.leftLeg();
      expect(mask.affects('LeftUpLeg')).toBe(true);
      expect(mask.affects('LeftLeg')).toBe(true);
      expect(mask.affects('LeftFoot')).toBe(true);
      expect(mask.affects('RightLeg')).toBe(false);
    });
    it('rightLeg affects right leg chain only', () => {
      const mask = AvatarMask.rightLeg();
      expect(mask.affects('RightUpLeg')).toBe(true);
      expect(mask.affects('RightLeg')).toBe(true);
      expect(mask.affects('RightFoot')).toBe(true);
      expect(mask.affects('LeftLeg')).toBe(false);
    });
  });

  describe('head', () => {
    const mask = AvatarMask.head();
    it('affects neck and head only', () => {
      expect(mask.affects('Neck')).toBe(true);
      expect(mask.affects('Head')).toBe(true);
      expect(mask.affects('Spine')).toBe(false);
      expect(mask.affects('LeftArm')).toBe(false);
    });
  });

  describe('fullBody', () => {
    const mask = AvatarMask.fullBody();
    it('affects all bones', () => {
      expect(mask.affects('Hips')).toBe(true);
      expect(mask.affects('Spine')).toBe(true);
      expect(mask.affects('LeftArm')).toBe(true);
      expect(mask.affects('RandomBone')).toBe(true);
    });
  });

  it('returned masks are independent instances', () => {
    const a = AvatarMask.upperBody();
    const b = AvatarMask.upperBody();
    expect(a).not.toBe(b);
    a.include('Extra');
    expect(b.affects('Extra')).toBe(false);
  });
});
