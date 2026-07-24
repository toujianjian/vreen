// AvatarMask — 人形骨架预定义遮罩。
//
// 提供 Unity/Unreal 风格的常用身体部位遮罩工厂方法。
// 骨骼命名遵循 Mixamo/Unreal 标准 (Hips, Spine, Chest, Neck, Head,
// LeftArm/LeftForeArm/LeftHand, LeftUpLeg/LeftLeg/LeftFoot 等)。
// 返回的 BoneMask 可按需进一步调整。

import { BoneMask } from './BoneMask';

export class AvatarMask {
  /** 上半身:躯干 + 头 + 双臂。 */
  static upperBody(): BoneMask {
    return new BoneMask([
      'Spine', 'Spine1', 'Spine2', 'Chest', 'UpperChest',
      'Neck', 'Head',
      'LeftShoulder', 'RightShoulder',
      'LeftArm', 'RightArm',
      'LeftForeArm', 'RightForeArm',
      'LeftHand', 'RightHand',
    ], true);
  }

  /** 下半身:髋部 + 双腿。 */
  static lowerBody(): BoneMask {
    return new BoneMask([
      'Hips',
      'LeftUpLeg', 'RightUpLeg',
      'LeftLeg', 'RightLeg',
      'LeftFoot', 'RightFoot',
      'LeftToeBase', 'RightToeBase',
    ], true);
  }

  /** 左臂。 */
  static leftArm(): BoneMask {
    return new BoneMask([
      'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
    ], true);
  }

  /** 右臂。 */
  static rightArm(): BoneMask {
    return new BoneMask([
      'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
    ], true);
  }

  /** 左腿。 */
  static leftLeg(): BoneMask {
    return new BoneMask([
      'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
    ], true);
  }

  /** 右腿。 */
  static rightLeg(): BoneMask {
    return new BoneMask([
      'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
    ], true);
  }

  /** 头部与颈部。 */
  static head(): BoneMask {
    return new BoneMask(['Neck', 'Head'], true);
  }

  /** 全身:空 exclusive 遮罩(无骨骼被排除)→ 所有骨骼均受影响。 */
  static fullBody(): BoneMask {
    return new BoneMask([], false);
  }
}
