// CharacterGenerator — 程序化角色生成器。
//
// 由 race / gender / height / bodyType / skinColor / hairStyle / hairColor /
// eyeColor / faceShape / noseShape / mouthShape / clothing / clothingColor /
// accessories / seed 等参数驱动,程序化拼装一个简单可渲染的人形角色。
//
// 设计取向:
//   * 与 BuildingGenerator / TreeGenerator 一致,产出 BufferGeometry + 元数据,
//     不绑定 Material / Scene,由调用方附加材质后挂到场景。
//   * 角色由身体 / 头部 / 面部 / 头发 / 服装 / 配饰若干部分组成,
//     各部分独立 BufferGeometry,generate() 返回合并后的整体几何体。
//   * 使用 mulberry32 PRNG(与其他 PCG 模块同实现)保证种子确定性。
//   * generateSkeleton() 返回简化 Skeleton(pelvis/spine/chest/head + 四肢),
//     与 Animation/Humanoid 骨骼层级保持一致,便于后续 skinning。
//
// 几何约定:
//   * 角色脚底在 Y=0,头部朝 +Y,面朝 -Z。
//   * 身体由躯干(盒) + 双臂(盒) + 双腿(盒)构成,均为轴对齐盒体。
//   * 头部为方盒,面部特征(眼/鼻/嘴)以小平面片贴在 -Z 面。
//   * 头发为覆盖头顶的薄壳盒,配饰为简单几何体偏移到对应位置。

import { BufferAttribute } from '../Core/BufferAttribute';
import { BufferGeometry } from '../Core/BufferGeometry';
import { Bone } from '../Core/Bone';
import { Skeleton } from '../Core/Skeleton';
import { Matrix4 } from '../Math/Matrix4';

/** 种族。 */
export type CharacterRace = 'human' | 'elf' | 'dwarf' | 'orc' | 'robot';

/** 性别。 */
export type CharacterGender = 'male' | 'female';

/** 体型。 */
export type CharacterBodyType = 'slim' | 'average' | 'muscular' | 'heavy';

/** 服装类型。 */
export type CharacterClothing = 'casual' | 'formal' | 'armor' | 'robe' | 'sci-fi';

/** RGB 颜色(各分量 0-1)。 */
export interface CharacterColor {
  r: number;
  g: number;
  b: number;
}

/** 角色生成结果。 */
export interface CharacterResult {
  /** 合并后的整体几何体(身体+头部+面部+头发+服装+配饰)。 */
  geometry: BufferGeometry;
  /** 身体几何体(躯干+四肢)。 */
  body: BufferGeometry;
  /** 头部几何体。 */
  head: BufferGeometry;
  /** 面部特征几何体(眼/鼻/嘴,合并)。 */
  face: BufferGeometry;
  /** 头发几何体。 */
  hair: BufferGeometry;
  /** 服装几何体。 */
  clothing: BufferGeometry;
  /** 配饰几何体(合并)。 */
  accessories: BufferGeometry;
  /** 简化骨骼(16 块骨头,与 Humanoid 同层级)。 */
  skeleton: Skeleton;
  /** 角色总高度(头顶到脚底)。 */
  height: number;
  /** 顶点数。 */
  vertexCount: number;
  /** 三角面数。 */
  triangleCount: number;
  /** 元数据:使用的参数快照。 */
  stats: CharacterStats;
}

/** 角色统计信息。 */
export interface CharacterStats {
  race: CharacterRace;
  gender: CharacterGender;
  height: number;
  bodyType: CharacterBodyType;
  skinColor: CharacterColor;
  hairStyle: number;
  hairColor: CharacterColor;
  eyeColor: CharacterColor;
  faceShape: number;
  noseShape: number;
  mouthShape: number;
  clothing: CharacterClothing;
  clothingColor: CharacterColor;
  accessories: string[];
  seed: number;
}

/** mulberry32 — 与其他 PCG 模块同实现的种子化 PRNG。 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 种族默认身高基线(m)。 */
const RACE_HEIGHT_BASE: Record<CharacterRace, number> = {
  human: 1.75,
  elf: 1.85,
  dwarf: 1.40,
  orc: 1.95,
  robot: 1.80,
};

/** 体型宽度/厚度乘数。 */
const BODY_TYPE_SCALE: Record<CharacterBodyType, { width: number; depth: number }> = {
  slim: { width: 0.85, depth: 0.85 },
  average: { width: 1.0, depth: 1.0 },
  muscular: { width: 1.15, depth: 1.1 },
  heavy: { width: 1.3, depth: 1.25 },
};

/** 默认肤色表(按种族)。 */
const DEFAULT_SKIN: Record<CharacterRace, CharacterColor> = {
  human: { r: 0.82, g: 0.68, b: 0.55 },
  elf: { r: 0.9, g: 0.85, b: 0.7 },
  dwarf: { r: 0.7, g: 0.5, b: 0.35 },
  orc: { r: 0.45, g: 0.6, b: 0.4 },
  robot: { r: 0.6, g: 0.6, b: 0.65 },
};

/** 默认发色表。 */
const DEFAULT_HAIR: CharacterColor[] = [
  { r: 0.1, g: 0.05, b: 0.02 },  // 黑
  { r: 0.35, g: 0.2, b: 0.08 },  // 棕
  { r: 0.75, g: 0.6, b: 0.3 },   // 金
  { r: 0.85, g: 0.75, b: 0.6 },  // 浅金
  { r: 0.55, g: 0.15, b: 0.1 },  // 红
  { r: 0.9, g: 0.9, b: 0.95 },   // 白
  { r: 0.35, g: 0.3, b: 0.4 },   // 灰
];

/** 默认眼睛颜色表。 */
const DEFAULT_EYE: CharacterColor[] = [
  { r: 0.3, g: 0.5, b: 0.25 },   // 绿
  { r: 0.4, g: 0.25, b: 0.15 },  // 棕
  { r: 0.2, g: 0.4, b: 0.7 },    // 蓝
  { r: 0.5, g: 0.4, b: 0.2 },    // 琥珀
  { r: 0.6, g: 0.6, b: 0.6 },    // 灰
];

/** 默认服装颜色表(按类型)。 */
const DEFAULT_CLOTHING_COLOR: Record<CharacterClothing, CharacterColor> = {
  casual: { r: 0.3, g: 0.4, b: 0.6 },
  formal: { r: 0.1, g: 0.1, b: 0.15 },
  armor: { r: 0.55, g: 0.55, b: 0.6 },
  robe: { r: 0.4, g: 0.2, b: 0.5 },
  'sci-fi': { r: 0.2, g: 0.6, b: 0.8 },
};

/** 简化骨骼骨名(与 Humanoid 同层级)。 */
const BONE_NAMES = [
  'pelvis',
  'spine',
  'chest',
  'head',
  'shoulder.L', 'upperArm.L', 'lowerArm.L',
  'shoulder.R', 'upperArm.R', 'lowerArm.R',
  'thigh.L', 'shin.L', 'foot.L',
  'thigh.R', 'shin.R', 'foot.R',
] as const;

/**
 * 程序化角色生成器(实例类,持有可变状态)。
 *
 * 用法:
 *   const gen = new CharacterGenerator();
 *   gen.setRace('elf').setGender('female').setHeight(1.7);
 *   const result = gen.generate();
 *   scene.add(new Mesh(result.geometry, material));
 */
export class CharacterGenerator {
  race: CharacterRace = 'human';
  gender: CharacterGender = 'male';
  height: number = 1.75;
  bodyType: CharacterBodyType = 'average';
  skinColor: CharacterColor = { ...DEFAULT_SKIN.human };
  hairStyle: number = 0;
  hairColor: CharacterColor = { ...DEFAULT_HAIR[1] };
  eyeColor: CharacterColor = { ...DEFAULT_EYE[1] };
  faceShape: number = 0.5;
  noseShape: number = 0.5;
  mouthShape: number = 0.5;
  clothing: CharacterClothing = 'casual';
  clothingColor: CharacterColor = { ...DEFAULT_CLOTHING_COLOR.casual };
  accessories: string[] = [];
  seed: number = 0;

  /** PRNG 实例(每次 setSeed 重置)。 */
  private _rng: () => number = mulberry32(0);

  constructor() {
    this.setSeed(0);
  }

  // ── 属性设置(fluent API,返回 this)──────────────────────────

  /** 设置种族。会同步调整默认肤色基线(若未手动改过肤色则跟随种族默认)。 */
  setRace(race: CharacterRace): this {
    this.race = race;
    this.skinColor = { ...DEFAULT_SKIN[race] };
    // 调整默认身高基线(仅当用户未显式改过 height 时?简化:总是设种族基线)
    this.height = RACE_HEIGHT_BASE[race];
    return this;
  }

  /** 设置性别。 */
  setGender(gender: CharacterGender): this {
    this.gender = gender;
    // 女性略矮(在种族基线上 *0.93),男性 *1.0
    const base = RACE_HEIGHT_BASE[this.race];
    this.height = gender === 'female' ? base * 0.93 : base;
    return this;
  }

  /** 设置身高(m)。 */
  setHeight(height: number): this {
    if (height <= 0) throw new Error(`CharacterGenerator.setHeight: height 必须为正数,收到 ${height}`);
    this.height = height;
    return this;
  }

  /** 设置体型。 */
  setBodyType(type: CharacterBodyType): this {
    this.bodyType = type;
    return this;
  }

  /** 设置肤色。 */
  setSkinColor(color: CharacterColor): this {
    this.skinColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置发型(0-10)。 */
  setHairStyle(style: number): this {
    if (style < 0 || style > 10) {
      throw new Error(`CharacterGenerator.setHairStyle: style 越界,应在 [0,10],收到 ${style}`);
    }
    this.hairStyle = style;
    return this;
  }

  /** 设置发色。 */
  setHairColor(color: CharacterColor): this {
    this.hairColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置眼睛颜色。 */
  setEyeColor(color: CharacterColor): this {
    this.eyeColor = { r: color.r, g: color.g, b: color.b };
    return this;
  }

  /** 设置脸型(0-1)。 */
  setFaceShape(shape: number): this {
    if (shape < 0 || shape > 1) {
      throw new Error(`CharacterGenerator.setFaceShape: shape 越界,应在 [0,1],收到 ${shape}`);
    }
    this.faceShape = shape;
    return this;
  }

  /** 设置鼻型(0-1)。 */
  setNoseShape(shape: number): this {
    if (shape < 0 || shape > 1) {
      throw new Error(`CharacterGenerator.setNoseShape: shape 越界,应在 [0,1],收到 ${shape}`);
    }
    this.noseShape = shape;
    return this;
  }

  /** 设置嘴型(0-1)。 */
  setMouthShape(shape: number): this {
    if (shape < 0 || shape > 1) {
      throw new Error(`CharacterGenerator.setMouthShape: shape 越界,应在 [0,1],收到 ${shape}`);
    }
    this.mouthShape = shape;
    return this;
  }

  /** 设置服装类型与颜色。 */
  setClothing(type: CharacterClothing, color?: CharacterColor): this {
    this.clothing = type;
    this.clothingColor = color ? { r: color.r, g: color.g, b: color.b } : { ...DEFAULT_CLOTHING_COLOR[type] };
    return this;
  }

  /** 设置配饰列表(glasses/hat/scarf/earrings 等)。 */
  setAccessories(items: string[]): this {
    this.accessories = [...items];
    return this;
  }

  /** 设置随机种子并重置 PRNG。 */
  setSeed(seed: number): this {
    this.seed = seed >>> 0;
    this._rng = mulberry32(this.seed);
    return this;
  }

  // ── 生成 ──────────────────────────────────────────────────────

  /** 随机化所有参数(基于当前种子)。 */
  randomize(): this {
    const rng = this._rng;
    const races: CharacterRace[] = ['human', 'elf', 'dwarf', 'orc', 'robot'];
    const genders: CharacterGender[] = ['male', 'female'];
    const bodyTypes: CharacterBodyType[] = ['slim', 'average', 'muscular', 'heavy'];
    const clothings: CharacterClothing[] = ['casual', 'formal', 'armor', 'robe', 'sci-fi'];
    const allAccessories = ['glasses', 'hat', 'scarf', 'earrings', 'beard', 'mask'];

    this.race = races[Math.floor(rng() * races.length)];
    this.gender = genders[Math.floor(rng() * genders.length)];
    this.bodyType = bodyTypes[Math.floor(rng() * bodyTypes.length)];
    this.height = RACE_HEIGHT_BASE[this.race] * (0.9 + rng() * 0.2);
    this.skinColor = { ...DEFAULT_SKIN[this.race] };
    // 轻微扰动肤色
    this.skinColor.r = clamp01(this.skinColor.r + (rng() - 0.5) * 0.1);
    this.skinColor.g = clamp01(this.skinColor.g + (rng() - 0.5) * 0.1);
    this.skinColor.b = clamp01(this.skinColor.b + (rng() - 0.5) * 0.1);
    this.hairStyle = Math.floor(rng() * 11);
    this.hairColor = { ...DEFAULT_HAIR[Math.floor(rng() * DEFAULT_HAIR.length)] };
    this.eyeColor = { ...DEFAULT_EYE[Math.floor(rng() * DEFAULT_EYE.length)] };
    this.faceShape = rng();
    this.noseShape = rng();
    this.mouthShape = rng();
    this.clothing = clothings[Math.floor(rng() * clothings.length)];
    this.clothingColor = { ...DEFAULT_CLOTHING_COLOR[this.clothing] };
    // 随机选 0-2 个配饰
    const accCount = Math.floor(rng() * 3);
    const shuffled = [...allAccessories].sort(() => rng() - 0.5);
    this.accessories = shuffled.slice(0, accCount);
    return this;
  }

  /** 生成完整角色。 */
  generate(): CharacterResult {
    // 重置 PRNG 保证同种子确定性
    this._rng = mulberry32(this.seed >>> 0);

    const body = this.generateBody();
    const head = this.generateHead();
    const face = this.generateFace();
    const hair = this.generateHair();
    const clothing = this.generateClothing();
    const accessories = this.generateAccessories();
    const skeleton = this.generateSkeleton();

    const geometry = mergeGeometries([body, head, face, hair, clothing, accessories]);

    const vertexCount = countVertices(geometry);
    const triangleCount = countTriangles(geometry);

    return {
      geometry,
      body,
      head,
      face,
      hair,
      clothing,
      accessories,
      skeleton,
      height: this.getCharacterHeight(),
      vertexCount,
      triangleCount,
      stats: this.getStats(),
    };
  }

  /**
   * 生成身体几何体(躯干 + 双臂 + 双腿)。
   * 身体由 5 个盒体构成,以身高为基准缩放。
   */
  generateBody(): BufferGeometry {
    const h = this.getCharacterHeight();
    const scale = BODY_TYPE_SCALE[this.bodyType];
    const parts: BufferGeometry[] = [];

    // 比例(相对身高)
    const torsoH = h * 0.32;
    const torsoW = h * 0.22 * scale.width;
    const torsoD = h * 0.14 * scale.depth;
    const torsoY = h * 0.35; // 躯干底部 Y(腿顶部)

    // 躯干
    parts.push(makeBox(0, torsoY + torsoH / 2, 0, torsoW, torsoH, torsoD));

    // 双臂(上臂 + 下臂简化为单盒)
    const armLen = h * 0.32;
    const armW = h * 0.05 * scale.width;
    const armD = h * 0.05 * scale.depth;
    const armY = torsoY + torsoH * 0.85; // 肩膀高度
    const armOffX = torsoW / 2 + armW / 2;
    parts.push(makeBox(armOffX, armY - armLen / 2, 0, armW, armLen, armD));
    parts.push(makeBox(-armOffX, armY - armLen / 2, 0, armW, armLen, armD));

    // 双腿
    const legLen = torsoY; // 腿长 = 躯干底部到地面
    const legW = h * 0.07 * scale.width;
    const legD = h * 0.08 * scale.depth;
    const legOffX = torsoW * 0.25;
    parts.push(makeBox(legOffX, legLen / 2, 0, legW, legLen, legD));
    parts.push(makeBox(-legOffX, legLen / 2, 0, legW, legLen, legD));

    return mergeGeometries(parts);
  }

  /** 生成头部几何体(脖颈 + 头颅)。 */
  generateHead(): BufferGeometry {
    const h = this.getCharacterHeight();
    const parts: BufferGeometry[] = [];

    // 脖颈
    const neckH = h * 0.05;
    const neckR = h * 0.04;
    const torsoTopY = h * 0.35 + h * 0.32; // 躯干顶部
    parts.push(makeBox(0, torsoTopY + neckH / 2, 0, neckR * 2, neckH, neckR * 2));

    // 头颅(盒体,尺寸受脸型影响)
    // faceShape: 0=瘦长,1=宽圆
    const headW = h * (0.12 + this.faceShape * 0.04);
    const headH = h * 0.16;
    const headD = h * (0.13 + this.faceShape * 0.02);
    const headY = torsoTopY + neckH + headH / 2;
    parts.push(makeBox(0, headY, 0, headW, headH, headD));

    return mergeGeometries(parts);
  }

  /**
   * 生成面部特征(双眼 + 鼻子 + 嘴),贴在头部 -Z 面。
   * 以小平面片表示,由调用方按 vertexColor 或材质区分。
   */
  generateFace(): BufferGeometry {
    const h = this.getCharacterHeight();
    const parts: BufferGeometry[] = [];

    const torsoTopY = h * 0.35 + h * 0.32;
    const neckH = h * 0.05;
    const headH = h * 0.16;
    const headD = h * (0.13 + this.faceShape * 0.02);
    const headCenterY = torsoTopY + neckH + headH / 2;
    const faceZ = -headD / 2 - 0.001; // 略微外凸避免 z-fighting

    // 双眼(两个小平面片)
    const eyeW = h * 0.02;
    const eyeH = h * 0.012;
    const eyeOffX = h * 0.035;
    const eyeY = headCenterY + headH * 0.15;
    parts.push(makeQuad(eyeOffX, eyeY, faceZ, eyeW, eyeH, 0, 0, -1));
    parts.push(makeQuad(-eyeOffX, eyeY, faceZ, eyeW, eyeH, 0, 0, -1));

    // 鼻子(小三角片,noseShape 控制大小)
    const noseSize = h * (0.015 + this.noseShape * 0.015);
    const noseY = headCenterY - headH * 0.02;
    parts.push(makeTri(0, noseY, faceZ, noseSize, 0, 0, -1));

    // 嘴(横向平面片,mouthShape 控制宽度)
    const mouthW = h * (0.03 + this.mouthShape * 0.03);
    const mouthH = h * 0.008;
    const mouthY = headCenterY - headH * 0.2;
    parts.push(makeQuad(0, mouthY, faceZ, mouthW, mouthH, 0, 0, -1));

    return mergeGeometries(parts);
  }

  /**
   * 生成头发几何体。
   * hairStyle 0-10 控制不同发型(短发/长发/秃顶/莫西干等)。
   * 0 = 光头(无头发),1-3 = 短发,4-6 = 中长发,7-9 = 长发,10 = 莫西干。
   */
  generateHair(): BufferGeometry {
    if (this.race === 'robot') {
      // 机器人无头发
      return new BufferGeometry();
    }
    const h = this.getCharacterHeight();
    const parts: BufferGeometry[] = [];

    const torsoTopY = h * 0.35 + h * 0.32;
    const neckH = h * 0.05;
    const headH = h * 0.16;
    const headW = h * (0.12 + this.faceShape * 0.04);
    const headD = h * (0.13 + this.faceShape * 0.02);
    const headTopY = torsoTopY + neckH + headH;
    const headCenterY = torsoTopY + neckH + headH / 2;

    // 0 = 光头
    if (this.hairStyle === 0) {
      return new BufferGeometry();
    }

    // 1-3:短发(头顶薄壳)
    if (this.hairStyle <= 3) {
      const shellH = h * 0.015;
      parts.push(makeBox(0, headTopY + shellH / 2, 0, headW * 1.02, shellH, headD * 1.02));
      return mergeGeometries(parts);
    }

    // 4-6:中长发(头顶 + 后脑)
    if (this.hairStyle <= 6) {
      const shellH = h * 0.025;
      parts.push(makeBox(0, headTopY + shellH / 2, 0, headW * 1.05, shellH, headD * 1.05));
      // 后脑下垂
      const backH = h * 0.08;
      parts.push(makeBox(0, headCenterY, -headD / 2 - shellH / 2, headW * 1.02, backH, shellH));
      return mergeGeometries(parts);
    }

    // 7-9:长发(头顶 + 后背下垂)
    if (this.hairStyle <= 9) {
      const shellH = h * 0.03;
      parts.push(makeBox(0, headTopY + shellH / 2, 0, headW * 1.08, shellH, headD * 1.08));
      // 长后背
      const backH = h * 0.25;
      parts.push(makeBox(0, headCenterY - backH / 2 + headH * 0.1, -headD / 2 - shellH / 2, headW * 1.05, backH, shellH));
      // 两侧鬓发
      const sideH = h * 0.15;
      parts.push(makeBox(headW / 2 + shellH / 2, headCenterY, 0, shellH, sideH, headD * 0.9));
      parts.push(makeBox(-headW / 2 - shellH / 2, headCenterY, 0, shellH, sideH, headD * 0.9));
      return mergeGeometries(parts);
    }

    // 10:莫西干(中间高条)
    const mohawkH = h * 0.08;
    const mohawkW = h * 0.03;
    parts.push(makeBox(0, headTopY + mohawkH / 2, 0, mohawkW, mohawkH, headD * 0.9));
    return mergeGeometries(parts);
  }

  /**
   * 生成服装几何体(覆盖躯干 + 四肢)。
   * 不同服装类型有不同的覆盖范围与厚度。
   */
  generateClothing(): BufferGeometry {
    const h = this.getCharacterHeight();
    const scale = BODY_TYPE_SCALE[this.bodyType];
    const parts: BufferGeometry[] = [];

    const torsoH = h * 0.32;
    const torsoW = h * 0.22 * scale.width;
    const torsoD = h * 0.14 * scale.depth;
    const torsoY = h * 0.35;
    const torsoCenterY = torsoY + torsoH / 2;

    // 服装厚度(略大于身体,包裹感)
    const thick = h * 0.008;

    switch (this.clothing) {
      case 'casual': {
        // 上衣(躯干)+ 裤子(双腿)
        parts.push(makeBox(0, torsoCenterY, 0, torsoW + thick, torsoH + thick, torsoD + thick));
        const legLen = torsoY;
        const legW = h * 0.07 * scale.width + thick;
        const legD = h * 0.08 * scale.depth + thick;
        const legOffX = torsoW * 0.25;
        parts.push(makeBox(legOffX, legLen / 2, 0, legW, legLen, legD));
        parts.push(makeBox(-legOffX, legLen / 2, 0, legW, legLen, legD));
        break;
      }
      case 'formal': {
        // 西装(更厚的上衣 + 领带片 + 裤子)
        parts.push(makeBox(0, torsoCenterY, 0, torsoW + thick * 1.5, torsoH + thick, torsoD + thick * 1.5));
        // 领带
        const tieY = torsoY + torsoH * 0.85;
        parts.push(makeBox(0, tieY - torsoH * 0.2, -torsoD / 2 - thick * 2, h * 0.015, torsoH * 0.4, thick));
        const legLen = torsoY;
        const legW = h * 0.07 * scale.width + thick;
        const legD = h * 0.08 * scale.depth + thick;
        const legOffX = torsoW * 0.25;
        parts.push(makeBox(legOffX, legLen / 2, 0, legW, legLen, legD));
        parts.push(makeBox(-legOffX, legLen / 2, 0, legW, legLen, legD));
        break;
      }
      case 'armor': {
        // 重甲(厚躯干 + 肩甲)
        const armorThick = h * 0.025;
        parts.push(makeBox(0, torsoCenterY, 0, torsoW + armorThick, torsoH + armorThick, torsoD + armorThick));
        // 肩甲(球体简化为盒)
        const shoulderY = torsoY + torsoH * 0.9;
        const shoulderS = h * 0.08;
        parts.push(makeBox(torsoW / 2 + shoulderS / 2, shoulderY, 0, shoulderS, shoulderS, shoulderS));
        parts.push(makeBox(-torsoW / 2 - shoulderS / 2, shoulderY, 0, shoulderS, shoulderS, shoulderS));
        // 腿甲
        const legLen = torsoY;
        const legW = h * 0.07 * scale.width + armorThick * 0.5;
        const legD = h * 0.08 * scale.depth + armorThick * 0.5;
        const legOffX = torsoW * 0.25;
        parts.push(makeBox(legOffX, legLen / 2, 0, legW, legLen, legD));
        parts.push(makeBox(-legOffX, legLen / 2, 0, legW, legLen, legD));
        break;
      }
      case 'robe': {
        // 长袍(从肩到脚的锥形,简化为大盒)
        const robeH = h * 0.6;
        const robeY = h * 0.35; // 从腰开始
        const robeW = torsoW * 1.6;
        const robeD = torsoD * 1.8;
        parts.push(makeBox(0, robeY + robeH / 2 - torsoH * 0.2, 0, robeW, robeH, robeD));
        // 头巾
        const torsoTopY = h * 0.35 + h * 0.32;
        const neckH = h * 0.05;
        const headH = h * 0.16;
        const headTopY = torsoTopY + neckH + headH;
        const hoodH = h * 0.08;
        parts.push(makeBox(0, headTopY + hoodH / 2, 0, torsoW * 1.3, hoodH, torsoD * 1.3));
        break;
      }
      case 'sci-fi': {
        // 科幻紧身衣(躯干 + 关节装甲片)
        parts.push(makeBox(0, torsoCenterY, 0, torsoW + thick, torsoH + thick, torsoD + thick));
        // 胸前能量核心
        const coreY = torsoY + torsoH * 0.6;
        parts.push(makeTri(0, coreY, -torsoD / 2 - thick * 2, h * 0.04, 0, 0, -1));
        // 手臂能量条
        const armY = torsoY + torsoH * 0.85 - h * 0.16;
        const armOffX = torsoW / 2 + h * 0.025;
        parts.push(makeBox(armOffX, armY, 0, h * 0.01, h * 0.15, h * 0.06));
        parts.push(makeBox(-armOffX, armY, 0, h * 0.01, h * 0.15, h * 0.06));
        // 腿部
        const legLen = torsoY;
        const legW = h * 0.07 * scale.width + thick;
        const legD = h * 0.08 * scale.depth + thick;
        const legOffX = torsoW * 0.25;
        parts.push(makeBox(legOffX, legLen / 2, 0, legW, legLen, legD));
        parts.push(makeBox(-legOffX, legLen / 2, 0, legW, legLen, legD));
        break;
      }
    }

    return mergeGeometries(parts);
  }

  /**
   * 生成配饰几何体。
   * 支持: glasses / hat / scarf / earrings / beard / mask。
   */
  generateAccessories(): BufferGeometry {
    if (this.accessories.length === 0) return new BufferGeometry();
    const h = this.getCharacterHeight();
    const parts: BufferGeometry[] = [];

    const torsoTopY = h * 0.35 + h * 0.32;
    const neckH = h * 0.05;
    const headH = h * 0.16;
    const headW = h * (0.12 + this.faceShape * 0.04);
    const headD = h * (0.13 + this.faceShape * 0.02);
    const headCenterY = torsoTopY + neckH + headH / 2;
    const headTopY = torsoTopY + neckH + headH;
    const faceZ = -headD / 2 - 0.005;

    for (const item of this.accessories) {
      switch (item) {
        case 'glasses': {
          // 两个镜框片 + 鼻梁
          const lensW = h * 0.03;
          const lensH = h * 0.02;
          const eyeY = headCenterY + headH * 0.15;
          const offX = h * 0.035;
          parts.push(makeQuad(offX, eyeY, faceZ - 0.001, lensW, lensH, 0, 0, -1));
          parts.push(makeQuad(-offX, eyeY, faceZ - 0.001, lensW, lensH, 0, 0, -1));
          // 鼻梁
          parts.push(makeQuad(0, eyeY, faceZ - 0.001, h * 0.01, lensH * 0.4, 0, 0, -1));
          break;
        }
        case 'hat': {
          // 帽子(顶 + 帽檐)
          const hatH = h * 0.06;
          const hatW = headW * 1.1;
          parts.push(makeBox(0, headTopY + hatH / 2, 0, hatW, hatH, hatW));
          // 帽檐
          const brimH = h * 0.01;
          parts.push(makeBox(0, headTopY + brimH / 2, 0, headW * 1.6, brimH, headD * 1.6));
          break;
        }
        case 'scarf': {
          // 围巾(脖子周围一圈)
          const scarfY = torsoTopY + neckH / 2;
          parts.push(makeBox(0, scarfY, 0, neckR2(h) * 2.4, neckH * 1.5, neckR2(h) * 2.4));
          // 下垂部分
          parts.push(makeBox(0, scarfY - h * 0.05, -headD / 2 - h * 0.01, h * 0.04, h * 0.1, h * 0.01));
          break;
        }
        case 'earrings': {
          // 耳环(两侧小球,简化为小盒)
          const earY = headCenterY;
          const earOffX = headW / 2 + h * 0.005;
          const s = h * 0.012;
          parts.push(makeBox(earOffX, earY - h * 0.04, 0, s, s, s));
          parts.push(makeBox(-earOffX, earY - h * 0.04, 0, s, s, s));
          break;
        }
        case 'beard': {
          // 胡子(下巴片)
          if (this.gender === 'male' && this.race !== 'robot') {
            const beardY = headCenterY - headH * 0.2;
            parts.push(makeQuad(0, beardY - h * 0.02, faceZ, headW * 0.7, headH * 0.3, 0, 0, -1));
          }
          break;
        }
        case 'mask': {
          // 面罩(覆盖口鼻)
          const maskY = headCenterY - headH * 0.15;
          parts.push(makeQuad(0, maskY, faceZ, headW * 0.8, headH * 0.35, 0, 0, -1));
          break;
        }
        default:
          // 未知配饰忽略
          break;
      }
    }

    return mergeGeometries(parts);
  }

  /**
   * 生成简化骨骼(16 块骨头,与 Animation/Humanoid 同层级)。
   * 骨头位置根据当前身高比例缩放。
   */
  generateSkeleton(): Skeleton {
    const h = this.getCharacterHeight();
    const s = h / 1.75; // 以 1.75m 为基准缩放

    const bones: Bone[] = [];
    const boneMap = new Map<string, Bone>();
    for (const name of BONE_NAMES) {
      const b = new Bone();
      b.name = name;
      bones.push(b);
      boneMap.set(name, b);
    }

    const get = (n: string): Bone => boneMap.get(n)!;

    // 位置(参考 Humanoid,按身高缩放)
    get('pelvis').position.set(0, 0.95 * s, 0);
    get('spine').position.set(0, 0, 0);
    get('chest').position.set(0, 0.30 * s, 0);
    get('head').position.set(0, 0.30 * s, 0);
    get('shoulder.L').position.set(0.20 * s, 0.20 * s, 0);
    get('upperArm.L').position.set(0, -0.18 * s, 0);
    get('lowerArm.L').position.set(0, -0.20 * s, 0);
    get('shoulder.R').position.set(-0.20 * s, 0.20 * s, 0);
    get('upperArm.R').position.set(0, -0.18 * s, 0);
    get('lowerArm.R').position.set(0, -0.20 * s, 0);
    get('thigh.L').position.set(0.10 * s, -0.05 * s, 0);
    get('shin.L').position.set(0, -0.25 * s, 0);
    get('foot.L').position.set(0, -0.25 * s, 0.04 * s);
    get('thigh.R').position.set(-0.10 * s, -0.05 * s, 0);
    get('shin.R').position.set(0, -0.25 * s, 0);
    get('foot.R').position.set(0, -0.25 * s, 0.04 * s);

    // 父子关系
    get('pelvis').add(get('spine'));
    get('spine').add(get('chest'));
    get('chest').add(get('head'));
    get('chest').add(get('shoulder.L'));
    get('shoulder.L').add(get('upperArm.L'));
    get('upperArm.L').add(get('lowerArm.L'));
    get('chest').add(get('shoulder.R'));
    get('shoulder.R').add(get('upperArm.R'));
    get('upperArm.R').add(get('lowerArm.R'));
    get('pelvis').add(get('thigh.L'));
    get('thigh.L').add(get('shin.L'));
    get('shin.L').add(get('foot.L'));
    get('pelvis').add(get('thigh.R'));
    get('thigh.R').add(get('shin.R'));
    get('shin.R').add(get('foot.R'));

    // 计算 inverse bind matrices(使用初始姿态)
    // 先 update matrixWorld(从根开始)
    get('pelvis').updateMatrixWorld(true);

    const inverses: Matrix4[] = bones.map((b) => {
      const inv = new Matrix4();
      inv.getInverse(b.matrixWorld);
      return inv;
    });

    return new Skeleton(bones, inverses);
  }

  /** 获取角色总高度(脚底到头顶)。 */
  getCharacterHeight(): number {
    // 高度 = 腿长 + 躯干 + 脖颈 + 头
    // 与 generateBody / generateHead 中的比例保持一致
    return this.height;
  }

  /** 获取当前参数统计快照。 */
  getStats(): CharacterStats {
    return {
      race: this.race,
      gender: this.gender,
      height: this.height,
      bodyType: this.bodyType,
      skinColor: { ...this.skinColor },
      hairStyle: this.hairStyle,
      hairColor: { ...this.hairColor },
      eyeColor: { ...this.eyeColor },
      faceShape: this.faceShape,
      noseShape: this.noseShape,
      mouthShape: this.mouthShape,
      clothing: this.clothing,
      clothingColor: { ...this.clothingColor },
      accessories: [...this.accessories],
      seed: this.seed,
    };
  }
}

// ── 内部工具函数 ──────────────────────────────────────────────

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** 脖颈半径辅助。 */
function neckR2(h: number): number {
  return h * 0.04;
}

/** 构造轴对齐盒体几何体(中心 cx,cy,cz;尺寸 w,h,d)。 */
function makeBox(cx: number, cy: number, cz: number, w: number, h: number, d: number): BufferGeometry {
  const hx = w / 2, hy = h / 2, hz = d / 2;
  // 8 顶点
  const positions = new Float32Array([
    // -X 面
    cx - hx, cy - hy, cz + hz,
    cx - hx, cy - hy, cz - hz,
    cx - hx, cy + hy, cz - hz,
    cx - hx, cy + hy, cz + hz,
    // +X 面
    cx + hx, cy - hy, cz + hz,
    cx + hx, cy + hy, cz + hz,
    cx + hx, cy + hy, cz - hz,
    cx + hx, cy - hy, cz - hz,
    // -Y 面
    cx - hx, cy - hy, cz + hz,
    cx + hx, cy - hy, cz + hz,
    cx + hx, cy - hy, cz - hz,
    cx - hx, cy - hy, cz - hz,
    // +Y 面
    cx - hx, cy + hy, cz + hz,
    cx - hx, cy + hy, cz - hz,
    cx + hx, cy + hy, cz - hz,
    cx + hx, cy + hy, cz + hz,
    // -Z 面
    cx - hx, cy - hy, cz - hz,
    cx + hx, cy - hy, cz - hz,
    cx + hx, cy + hy, cz - hz,
    cx - hx, cy + hy, cz - hz,
    // +Z 面
    cx - hx, cy - hy, cz + hz,
    cx - hx, cy + hy, cz + hz,
    cx + hx, cy + hy, cz + hz,
    cx + hx, cy - hy, cz + hz,
  ]);
  const normals = new Float32Array([
    -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0,
    0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
    0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0,
    0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
    0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
    0, 0, 1, 0, 1, 1, 0, 1,
  ]);
  const indices = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    8, 9, 10, 8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23,
  ];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  return geo;
}

/** 构造平面四边形几何体(中心 cx,cy,cz;宽 w,高 h;法线 nx,ny,nz)。 */
function makeQuad(
  cx: number, cy: number, cz: number,
  w: number, h: number,
  nx: number, ny: number, nz: number,
): BufferGeometry {
  const hw = w / 2, hh = h / 2;
  // 选平面内两轴:若法线主要沿 Z,则平面在 XY;若沿 Y,则平面在 XZ;若沿 X,则平面在 YZ
  let ux = 0, uy = 0, uz = 0;
  let vx = 0, vy = 0, vz = 0;
  if (Math.abs(nz) > 0.5) {
    ux = 1; uy = 0; uz = 0;
    vx = 0; vy = 1; vz = 0;
  } else if (Math.abs(ny) > 0.5) {
    ux = 1; uy = 0; uz = 0;
    vx = 0; vy = 0; vz = 1;
  } else {
    ux = 0; uy = 1; uz = 0;
    vx = 0; vy = 0; vz = 1;
  }
  const positions = new Float32Array([
    cx - ux * hw - vx * hh, cy - uy * hw - vy * hh, cz - uz * hw - vz * hh,
    cx + ux * hw - vx * hh, cy + uy * hw - vy * hh, cz + uz * hw - vz * hh,
    cx + ux * hw + vx * hh, cy + uy * hw + vy * hh, cz + uz * hw + vz * hh,
    cx - ux * hw + vx * hh, cy - uy * hw + vy * hh, cz - uz * hw + vz * hh,
  ]);
  const normals = new Float32Array([nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz]);
  const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const indices = [0, 1, 2, 0, 2, 3];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  return geo;
}

/** 构造三角形几何体(中心 cx,cy,cz;尺寸 size;法线 nx,ny,nz)。 */
function makeTri(
  cx: number, cy: number, cz: number,
  size: number,
  nx: number, ny: number, nz: number,
): BufferGeometry {
  const s = size / 2;
  let ux = 0, uy = 0, uz = 0;
  let vx = 0, vy = 0, vz = 0;
  if (Math.abs(nz) > 0.5) {
    ux = 1; uy = 0; uz = 0;
    vx = 0; vy = 1; vz = 0;
  } else if (Math.abs(ny) > 0.5) {
    ux = 1; uy = 0; uz = 0;
    vx = 0; vy = 0; vz = 1;
  } else {
    ux = 0; uy = 1; uz = 0;
    vx = 0; vy = 0; vz = 1;
  }
  const positions = new Float32Array([
    cx - ux * s, cy - uy * s, cz - uz * s,
    cx + ux * s, cy - uy * s, cz - uz * s,
    cx + vx * s, cy + vy * s, cz + vz * s,
  ]);
  const normals = new Float32Array([nx, ny, nz, nx, ny, nz, nx, ny, nz]);
  const uvs = new Float32Array([0, 0, 1, 0, 0.5, 1]);
  const indices = [0, 1, 2];
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(positions, 3));
  geo.setAttribute('normal', new BufferAttribute(normals, 3));
  geo.setAttribute('uv', new BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  return geo;
}

/** 合并多个 BufferGeometry(参考 BuildingGenerator._mergeGeometries 同实现)。 */
function mergeGeometries(geos: BufferGeometry[]): BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  let vertexOffset = 0;
  for (const g of geos) {
    const pos = g.attributes.position?.array;
    if (!pos) continue;
    for (let i = 0; i < pos.length; i++) positions.push(pos[i]);
    const nrm = g.attributes.normal?.array;
    if (nrm) for (let i = 0; i < nrm.length; i++) normals.push(nrm[i]);
    const uv = g.attributes.uv?.array;
    if (uv) for (let i = 0; i < uv.length; i++) uvs.push(uv[i]);
    const idx = g.index?.array as unknown as ArrayLike<number> | undefined;
    if (idx) {
      for (let i = 0; i < idx.length; i++) indices.push(idx[i] + vertexOffset);
    } else {
      const vc = pos.length / 3;
      for (let i = 0; i < vc; i += 3) {
        indices.push(i, i + 1, i + 2);
      }
    }
    vertexOffset += pos.length / 3;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  if (normals.length > 0) geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  if (uvs.length > 0) geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  geo.computeBoundingBox();
  return geo;
}

/** 统计几何体顶点数。 */
function countVertices(geo: BufferGeometry): number {
  const pos = geo.attributes.position?.array;
  return pos ? pos.length / 3 : 0;
}

/** 统计几何体三角面数。 */
function countTriangles(geo: BufferGeometry): number {
  const idx = geo.index?.array;
  if (idx) return idx.length / 3;
  const pos = geo.attributes.position?.array;
  return pos ? pos.length / 3 / 3 : 0;
}
