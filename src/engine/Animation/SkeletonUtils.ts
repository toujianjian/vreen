// SkeletonUtils — 骨骼工具集(移植自 three.js examples/jsm/utils/SkeletonUtils.js)。
//
// 三个核心能力:
//   - retarget      实时姿势重定向:把 source 骨架的当前姿态(世界矩阵)搬到 target 骨架
//                   (匹配骨骼名,按相对 root 矩阵求旋转,hip 骨做位移缩放)。
//   - retargetClip  动画烘焙:把 source 上播放的 clip 逐帧重定向到 target,输出
//                   target 自己的 AnimationClip(数据驱动,可离线预烘焙)。
//   - clone         骨骼感知深拷贝:深拷贝 Object3D 树,并把 SkinnedMesh 的骨骼
//                   重映射到克隆树上的对应骨骼(共享几何/材质,独立骨骼姿态)。
//
// VREEN 适配点(与 three.js 的差异):
//   - VREEN Object3D 用 `rotation`(Quaternion)承载姿态,three.js 用 `quaternion`。
//   - VREEN AnimationClip.bind 用 `root.getObjectByName(nodeName)` 解析 track 名
//     (three.js 用 PropertyBinding 的 `.bones[i]` 特判)。因此烘焙输出 track 名
//     必须用 `<boneName>.position` / `<boneName>.quaternion` 纯名格式;骨骼本身
//     通过 getObjectByName 沿场景树命中。
//   - VREEN 无 SkeletonHelper:source 传入裸 Skeleton 时,用 SkeletonHelperAdapter
//     (Group + skeleton 字段 + 按名查找覆盖)充当 binder 根,不改动骨骼层级。
//   - VREEN AnimationClip 构造器不自动推导 duration(three.js 在 duration<0 时
//     取最后 track 末时间),retargetClip 必须显式算出并传入。
//   - 空 tracks clip 的 fps 推导会得 -Infinity(three.js 缺陷),这里补 guard。

import { AnimationClip } from './AnimationClip';
import { AnimationMixer } from './AnimationMixer';
import { VectorKeyframeTrack, QuaternionKeyframeTrack } from './KeyframeTrack';
import type { KeyframeTrack } from './KeyframeTrack';
import { Matrix4, Quaternion, Vector3 } from '../Math';
import { Group } from '../Core/Group';
import { Skeleton } from '../Core/Skeleton';
import { Bone } from '../Core/Bone';
import { SkinnedMesh } from '../Core/SkinnedMesh';
import { Object3D } from '../Core/Object3D';

/** retarget / retargetClip 的选项(three.js SkeletonUtils.RetargetOptions 适配)。 */
export interface RetargetOptions {
  /** 骨骼名重映射:target 骨骼名 → source 骨骼名(默认无映射)。 */
  names?: Record<string, string>;
  /** 自定义骨骼名解析,优先于 names(传入则忽略 names 的 target→source 映射)。 */
  getBoneName?: (bone: Bone) => string | undefined;
  /** 重定向后保留 target 骨骼局部矩阵(默认 true)。 */
  preserveBoneMatrix?: boolean;
  /** 保留非 hip 骨 position,根位移只作用于 hip(默认 true)。 */
  preserveBonePositions?: boolean;
  /** 直接复制 source 骨骼矩阵而非相对 target 根求逆(默认 false)。 */
  useTargetMatrix?: boolean;
  /** hip 骨名(默认 'hip')。 */
  hip?: string;
  /** hip 骨位移各轴影响权重(默认 (1,1,1))。 */
  hipInfluence?: Vector3;
  /** 根位移缩放(默认 1)。 */
  scale?: number;
  /** 局部偏移矩阵(按 target 骨骼名,乘到全局旋转之后)。 */
  localOffsets?: Record<string, Matrix4>;
  /** hip 骨附加位移(默认无)。 */
  hipPosition?: Vector3;
  /** 烘焙采样帧率(默认从 clip 自动推导)。 */
  fps?: number;
  /** 烘焙裁剪区间 [start, end] 秒(默认整段)。 */
  trim?: [number, number];
  /** 把首帧位置作为基准,烘焙的相对位移从 0 起(默认 false)。 */
  useFirstFramePosition?: boolean;
}

/** 带骨架的对象:SkinnedMesh 或 SkeletonHelperAdapter。 */
type SkinnedLike = Object3D & { skeleton: Skeleton };

/** 窄化:Object3D|Skeleton → SkinnedLike('skeleton' in v)。 */
function isSkinnedLike(v: Object3D | Skeleton): v is SkinnedLike {
  return 'skeleton' in v;
}

/** 取 source 侧骨骼名(先走自定义解析,再走 names 映射,最后回退原名)。 */
function getBoneName(bone: Bone, options: RetargetOptions): string | undefined {
  if (options.getBoneName !== undefined) return options.getBoneName(bone);
  const name = options.names?.[bone.name];
  return name ?? bone.name;
}

/** 按名在骨骼数组里查找(返回 undefined 表示无匹配)。 */
function getBoneByName(name: string | undefined, bones: Bone[]): Bone | undefined {
  for (let i = 0; i < bones.length; i++) {
    if (name === bones[i].name) return bones[i];
  }
  return undefined;
}

/**
 * 归一化骨架参数:Skeleton 实例 / Bone[] / Object3D 都给出 Bone[]。
 *
 * Object3D(无 skeleton 字段)时收集子树中的 Bone 作为兜底 —— three.js
 * 的 getBones 只处理 `Array.isArray ? : skeleton.bones`,传裸 Object3D 会在
 * `.bones` 上解引用崩溃;这里补全类型面,保证空骨架安全而非 throw。
 */
function getBones(skeleton: Object3D | Skeleton | Bone[]): Bone[] {
  if (Array.isArray(skeleton)) return skeleton;
  if ('bones' in skeleton) return skeleton.bones;
  const result: Bone[] = [];
  skeleton.traverse((node) => {
    if ((node as Bone).isBone === true) result.push(node as Bone);
  });
  return result;
}

/**
 * 裸 Skeleton → binder 根适配器。
 *
 * 三个.js 用 SkeletonHelper 提供 `root.bones[i]` 索引(VREEN 无),而 VREEN 的
 * AnimationClip.bind 靠 `getObjectByName(nodeName)` 解析 track 名。因此这里用
 * Group + 覆盖 getObjectByName(先在骨骼数组查名)充当 binder 根,骨骼仍保留
 * 原场景层级(不挂为 children,避免破坏 parent 关系)。
 */
class SkeletonHelperAdapter extends Group implements SkinnedLike {
  skeleton: Skeleton;

  constructor(skeleton: Skeleton) {
    super();
    this.skeleton = skeleton;
  }

  override getObjectByName(name: string): Object3D | null {
    for (const bone of this.skeleton.bones) {
      if (bone.name === name) return bone;
    }
    return super.getObjectByName(name);
  }
}

/** 裸 Skeleton → binder 根(仅 source 侧使用)。 */
function getHelperFromSkeleton(skeleton: Skeleton): SkinnedLike {
  return new SkeletonHelperAdapter(skeleton);
}

/** retargetClip 单骨骼采样缓冲:bone 必填,pos/quat 惰性创建(仅命中/hip 骨有)。 */
interface BoneData {
  bone: Bone;
  pos?: { times: number[]; values: number[] };
  quat?: { times: number[]; values: number[] };
}

/**
 * 实时姿势重定向:把 source 骨架当前姿态搬到 target 骨架。
 *
 * 核心思路:对每根 target 骨骼,取 source 对应骨骼的世界矩阵,相对 target 根求逆
 * 得相对旋转(忽略缩放),写回 target 骨骼局部矩阵;hip 骨额外做根位移的
 * scale × hipInfluence 缩放。target 骨骼其余部分保留绑定姿势位移(preserveBonePositions)。
 *
 * @param target 目标骨架(SkinnedMesh 或 Skeleton 数组)。
 * @param source 源骨架(SkinnedMesh 或 Skeleton 数组)。
 * @param options 选项(见 RetargetOptions)。
 */
export function retarget(
  target: Object3D | Skeleton,
  source: Object3D | Skeleton,
  options: RetargetOptions = {},
): void {
  const quat = new Quaternion();
  const tmpScale = new Vector3();
  const relativeMatrix = new Matrix4();
  const globalMatrix = new Matrix4();

  let preserveBoneMatrix = options.preserveBoneMatrix !== undefined ? options.preserveBoneMatrix : true;
  const preserveBonePositions = options.preserveBonePositions !== undefined ? options.preserveBonePositions : true;
  let useTargetMatrix = options.useTargetMatrix !== undefined ? options.useTargetMatrix : false;
  const hip = options.hip !== undefined ? options.hip : 'hip';
  const hipInfluence = options.hipInfluence !== undefined ? options.hipInfluence : new Vector3(1, 1, 1);
  const scale = options.scale !== undefined ? options.scale : 1;

  const sourceBones = isSkinnedLike(source) ? source.skeleton.bones : getBones(source);
  const bones = isSkinnedLike(target) ? target.skeleton.bones : getBones(target);
  // target 为 Object3D 时才访问其 matrixWorld/children(纯骨骼数组时 preserveBoneMatrix 已禁用)。
  const targetObj = target as Object3D;

  // 重置 target 骨骼到绑定姿势;纯骨骼数组 target 无法求根逆,强制 useTargetMatrix。
  if (isSkinnedLike(target)) {
    target.skeleton.pose();
  } else {
    useTargetMatrix = true;
    preserveBoneMatrix = false;
  }

  // 保存非 hip 骨初始 position,重定向结束后恢复。
  let bonesPosition: Vector3[] = [];
  if (preserveBonePositions) {
    for (let i = 0; i < bones.length; i++) bonesPosition.push(bones[i].position.clone());
  }

  if (preserveBoneMatrix) {
    // 把 target 根世界矩阵临时归零,使相对矩阵 = source 世界矩阵。
    targetObj.updateMatrixWorld();
    targetObj.matrixWorld.identity();
    for (let i = 0; i < targetObj.children.length; ++i) {
      targetObj.children[i].updateMatrixWorld(true);
    }
  }

  for (let i = 0; i < bones.length; ++i) {
    const bone = bones[i];
    const name = getBoneName(bone, options);
    const boneTo = getBoneByName(name, sourceBones);

    globalMatrix.copy(bone.matrixWorld);

    if (boneTo) {
      boneTo.updateMatrixWorld();

      if (useTargetMatrix) {
        relativeMatrix.copy(boneTo.matrixWorld);
      } else {
        relativeMatrix.copy(targetObj.matrixWorld).invert();
        relativeMatrix.multiply(boneTo.matrixWorld);
      }

      // 忽略缩放,提取纯旋转 → 写入全局旋转。
      tmpScale.setFromMatrixScale(relativeMatrix);
      relativeMatrix.scale(tmpScale.set(1 / tmpScale.x, 1 / tmpScale.y, 1 / tmpScale.z));
      globalMatrix.makeRotationFromQuaternion(quat.setFromRotationMatrix(relativeMatrix));

      if (isSkinnedLike(target)) {
        const offset = options.localOffsets?.[bone.name];
        if (offset) globalMatrix.multiply(offset);
      }

      globalMatrix.copyPosition(relativeMatrix);
    }

    // hip 骨:根位移按 scale × hipInfluence 缩放,可选附加 hipPosition。
    if (name === hip) {
      globalMatrix.elements[12] *= scale * hipInfluence.x;
      globalMatrix.elements[13] *= scale * hipInfluence.y;
      globalMatrix.elements[14] *= scale * hipInfluence.z;
      if (options.hipPosition !== undefined) {
        globalMatrix.elements[12] += options.hipPosition.x * scale;
        globalMatrix.elements[13] += options.hipPosition.y * scale;
        globalMatrix.elements[14] += options.hipPosition.z * scale;
      }
    }

    // 相对父节点世界矩阵求局部矩阵。
    if (bone.parent) {
      bone.matrix.copy(bone.parent.matrixWorld).invert();
      bone.matrix.multiply(globalMatrix);
    } else {
      bone.matrix.copy(globalMatrix);
    }

    // decompose 经 position/rotation/scale 的 set() 写入,触发 _Bound* 的 markDirty
    // (MATRIX | MATRIX_WORLD),与 three.js 一致 —— 无需 force 即可重算世界矩阵。
    bone.matrix.decompose(bone.position, bone.rotation, bone.scale);
    bone.updateMatrixWorld();
  }

  // 恢复非 hip 骨 position,保证重定向只影响根位移(hip)与旋转。
  if (preserveBonePositions) {
    for (let i = 0; i < bones.length; ++i) {
      const bone = bones[i];
      const name = getBoneName(bone, options) || bone.name;
      if (name !== hip) bone.position.copy(bonesPosition[i]);
    }
  }

  if (preserveBoneMatrix) {
    targetObj.updateMatrixWorld(true);
  }
}

/**
 * 动画烘焙:把 source 上播放的 `clip` 逐帧重定向到 target,输出 target 的 clip。
 *
 * 用 AnimationMixer 驱动 source 播放 clip,每帧先 retarget 到 target,采样 target
 * 骨骼的位置(仅 hip)与旋转;最终把所有骨骼的采样写成 Vector/Quaternion
 * KeyframeTrack(VREEN 格式 `<boneName>.position` / `<boneName>.quaternion`)。
 *
 * @param target 目标骨架(SkinnedMesh,带 skeleton)。
 * @param source 源骨架(SkinnedMesh 或 Skeleton)。
 * @param clip 源动画 clip。
 * @param options 选项(见 RetargetOptions,烘焙相关: fps/trim/useFirstFramePosition)。
 * @returns target 的烘焙 AnimationClip。
 */
export function retargetClip(
  target: Object3D | Skeleton,
  source: Object3D | Skeleton,
  clip: AnimationClip,
  options: RetargetOptions = {},
): AnimationClip {
  options.useFirstFramePosition = options.useFirstFramePosition !== undefined ? options.useFirstFramePosition : false;

  // 从 clip 自动推导帧率:帧数最多 track 的采样数 / 时长;空 tracks 给 30。
  options.fps = options.fps !== undefined
    ? options.fps
    : clip.tracks.length > 0
      ? Math.max(...clip.tracks.map((t) => t.times.length)) / clip.duration
      : 30;
  options.names = options.names ?? {};

  // 裸 Skeleton → binder 根(adapter),mixer 绑定 clip 与骨骼查找都走它。
  let src: SkinnedLike;
  if (isSkinnedLike(source)) {
    src = source;
  } else {
    src = getHelperFromSkeleton(source as Skeleton);
  }

  // 极短 clip 时保证至少 2 帧,避免 delta = Infinity(three.js 缺陷)。
  const numFrames = Math.max(2, Math.round(clip.duration * options.fps));
  const delta = clip.duration / (numFrames - 1);
  const convertedTracks: KeyframeTrack[] = [];
  const mixer = new AnimationMixer(src);
  const bones = isSkinnedLike(target) ? target.skeleton.bones : getBones(target);
  const boneDatas: Array<BoneData | undefined> = [];

  let positionOffset: Vector3 | undefined;

  mixer.clipAction(clip).play();

  // trim:裁剪烘焙区间,先快进 mixer 到起点。
  let start = 0;
  let end = numFrames;
  if (options.trim !== undefined) {
    start = Math.round(options.trim[0] * options.fps);
    end = Math.min(Math.round(options.trim[1] * options.fps), numFrames) - start;
    mixer.update(options.trim[0]);
  } else {
    mixer.update(0);
  }

  src.updateMatrixWorld();

  for (let frame = 0; frame < end; ++frame) {
    const time = frame * delta;

    // 先把 source 当前帧姿态重定向到 target。
    retarget(target, src, options);

    // 采样 target 骨骼:hip 骨带 position 轨道,所有命中骨骼带 quaternion 轨道。
    for (let j = 0; j < bones.length; ++j) {
      const bone = bones[j];
      const name = getBoneName(bone, options) || bone.name;
      // Bug B 修复:getBoneByName 期望 Bone[](用 .length 迭代);传 Skeleton 实例
      // (无 .length)会让循环静默跳过 → 永远返回 undefined → 烘焙轨道为空。
      const boneTo = getBoneByName(name, src.skeleton.bones);

      if (boneTo) {
        let boneData = boneDatas[j];
        if (!boneData) {
          boneData = { bone };
          boneDatas[j] = boneData;
        }

        if (options.hip === name) {
          if (!boneData.pos) {
            boneData.pos = {
              times: new Array<number>(end).fill(0),
              values: new Array<number>(end * 3).fill(0),
            };
          }
          // 首帧位置作为基准:烘焙相对位移从 0 起。
          if (options.useFirstFramePosition) {
            if (frame === 0) positionOffset = bone.position.clone();
            bone.position.sub(positionOffset!);
          }
          boneData.pos.times[frame] = time;
          bone.position.toArray(boneData.pos.values, frame * 3);
        }

        if (!boneData.quat) {
          boneData.quat = {
            times: new Array<number>(end).fill(0),
            values: new Array<number>(end * 4).fill(0),
          };
        }
        boneData.quat.times[frame] = time;
        bone.rotation.toArray(boneData.quat.values, frame * 4);
      }
    }

    // 推进 mixer:最后一帧前略微减小 dt,避免越过 clip 时长。
    if (frame === end - 2) {
      mixer.update(delta - 0.0000001);
    } else {
      mixer.update(delta);
    }
    src.updateMatrixWorld();
  }

  // 输出 track:纯骨骼名 + 属性(VREEN bind 用 getObjectByName 解析)。
  for (let i = 0; i < boneDatas.length; ++i) {
    const boneData = boneDatas[i];
    if (boneData) {
      if (boneData.pos) {
        convertedTracks.push(
          new VectorKeyframeTrack(
            boneData.bone.name + '.position',
            boneData.pos.times,
            boneData.pos.values,
          ),
        );
      }
      if (boneData.quat) {
        convertedTracks.push(
          new QuaternionKeyframeTrack(
            boneData.bone.name + '.quaternion',
            boneData.quat.times,
            boneData.quat.values,
          ),
        );
      }
    }
  }

  mixer.uncacheAction(clip);

  // VREEN AnimationClip 不自动推导 duration,显式算:最后帧时间 = (end - 1) * delta。
  return new AnimationClip(clip.name, Math.max(0, (end - 1) * delta), convertedTracks);
}

/** 并行深度遍历两棵同构树,回调 (sourceNode, clonedNode)。 */
function parallelTraverse(a: Object3D, b: Object3D, callback: (a: Object3D, b: Object3D) => void): void {
  callback(a, b);
  for (let i = 0; i < a.children.length; ++i) {
    parallelTraverse(a.children[i], b.children[i], callback);
  }
}

/**
 * 骨骼感知深拷贝:深拷贝 Object3D 树,并重映射 SkinnedMesh 的骨骼。
 *
 * 几何体与材质共享(引用不变),骨骼树独立克隆(clone 后每根骨骼姿态可独立改动)。
 * 重映射依据 parallelTraverse 建立的 source→clone 节点映射:克隆骨架的 bones 指向
 * 克隆树里的对应骨骼,并以原 bindMatrix 重新 bind(不重算 inverses)。
 *
 * @param source 源 Object3D 树。
 * @returns 克隆树(SkinnedMesh 的 skeleton 已重映射)。
 */
export function clone(source: Object3D): Object3D {
  // three.js 语义:sourceLookup 记录 clone→source,cloneLookup 记录 source→clone。
  // 遍历 clone 树时经 sourceLookup 找回原 SkinnedMesh,重映射骨骼时经
  // cloneLookup 把 source 骨骼映射到克隆树上的对应骨骼。
  const sourceLookup = new Map<Object3D, Object3D>();
  const cloneLookup = new Map<Object3D, Object3D>();
  const cloned = source.clone();
  parallelTraverse(source, cloned, (srcNode, cloneNode) => {
    sourceLookup.set(cloneNode, srcNode);
    cloneLookup.set(srcNode, cloneNode);
  });

  cloned.traverse((node) => {
    if ((node as SkinnedMesh).isSkinnedMesh !== true) return;
    const mesh = node as SkinnedMesh;
    const srcMesh = sourceLookup.get(mesh) as SkinnedMesh | undefined;
    const srcSkeleton = srcMesh?.skeleton;
    if (!srcSkeleton) return;

    const skeleton = srcSkeleton.clone();
    // 逐 source 骨骼映射到克隆树对应骨骼;未命中(不在树里)回退原骨骼。
    skeleton.bones = srcSkeleton.bones.map((bone) => {
      const mapped = cloneLookup.get(bone);
      return (mapped as Bone | undefined) ?? bone;
    });
    mesh.skeleton = skeleton;
    // 传 bindMatrix 时不重算 boneInverses(与原骨架一致)。
    mesh.bind(skeleton, mesh.bindMatrix);
  });

  return cloned;
}
