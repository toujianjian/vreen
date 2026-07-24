// AnimationLayerMixer — 动画层混合器。
//
// 管理多个 AnimationLayer,按顺序把各层动画叠加到目标骨架。
// 典型用法:
//   const mixer = new AnimationLayerMixer(skeleton);
//   const baseLayer = mixer.addLayer(new AnimationLayer('base', 'override'));
//   const upperLayer = mixer.addLayer(new AnimationLayer('upper', 'override', AvatarMask.upperBody()));
//   const breathLayer = mixer.addLayer(new AnimationLayer('breath', 'additive'));
//
// 每帧:
//   mixer.update(dt);   // 推进各层 playhead
//   mixer.blend();      // 顺序应用各层到 skeleton.bones

import { AnimationLayer } from './AnimationLayer';
import { Bone } from '../Core/Bone';
import { Skeleton } from '../Core/Skeleton';

export class AnimationLayerMixer {
  /** 层列表(按添加顺序;索引越大越靠后,基于前层结果混合)。 */
  layers: AnimationLayer[] = [];
  /** 目标骨架或骨骼数组。 */
  target: Skeleton | Bone[];

  constructor(target: Skeleton | Bone[]) {
    this.target = target;
  }

  /** 获取目标骨骼数组(统一接口)。 */
  private getBones(): Bone[] {
    if (Array.isArray(this.target)) return this.target;
    return this.target.bones;
  }

  /** 添加层。返回该层以便链式配置。 */
  addLayer(layer: AnimationLayer): AnimationLayer {
    this.layers.push(layer);
    return layer;
  }

  /** 按 name 移除层。返回是否移除成功。 */
  removeLayer(name: string): boolean {
    const i = this.layers.findIndex(l => l.name === name);
    if (i < 0) return false;
    this.layers.splice(i, 1);
    return true;
  }

  /** 按 name 获取层。 */
  getLayer(name: string): AnimationLayer | undefined {
    return this.layers.find(l => l.name === name);
  }

  /** 推进所有层的 playhead 与 fade。不写入骨骼。 */
  update(dt: number): void {
    for (const layer of this.layers) layer.update(dt);
  }

  /** 顺序应用所有层到目标骨骼。
   *  后层基于前层结果混合(override lerp / additive 叠加 / mask 限制)。 */
  blend(): void {
    const bones = this.getBones();
    for (const layer of this.layers) layer.apply(bones);
  }
}
