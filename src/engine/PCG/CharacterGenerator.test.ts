// CharacterGenerator 单元测试。
//
// 测试策略:
//   - 默认参数生成基本角色,验证几何体非空、各部分存在。
//   - 同种子确定性:两次 generate() 产出的顶点完全一致。
//   - 不同种子产生不同角色(randomize 后参数不同)。
//   - 各 setter 方法验证参数校验与状态更新。
//   - generateSkeleton 验证骨头数量与层级。
//   - 各发型/服装/配饰分支覆盖。

import { describe, it, expect } from 'vitest';
import {
  CharacterGenerator,
  type CharacterRace,
  type CharacterGender,
  type CharacterBodyType,
  type CharacterClothing,
} from './CharacterGenerator';

describe('CharacterGenerator', () => {
  describe('默认生成', () => {
    it('generate 返回完整角色,几何体非空', () => {
      const gen = new CharacterGenerator();
      const result = gen.generate();
      expect(result.geometry).toBeDefined();
      const pos = result.geometry.attributes.position;
      expect(pos).toBeDefined();
      expect(pos.array.length).toBeGreaterThan(0);
    });

    it('各部分几何体独立存在', () => {
      const gen = new CharacterGenerator();
      const result = gen.generate();
      expect(result.body.attributes.position).toBeDefined();
      expect(result.body.attributes.position.array.length).toBeGreaterThan(0);
      expect(result.head.attributes.position).toBeDefined();
      expect(result.head.attributes.position.array.length).toBeGreaterThan(0);
      expect(result.face.attributes.position).toBeDefined();
      expect(result.face.attributes.position.array.length).toBeGreaterThan(0);
    });

    it('整体几何体顶点数 = 各部分之和(合并后无丢失)', () => {
      const gen = new CharacterGenerator();
      const result = gen.generate();
      const sumParts =
        vertexCount(result.body) +
        vertexCount(result.head) +
        vertexCount(result.face) +
        vertexCount(result.hair) +
        vertexCount(result.clothing) +
        vertexCount(result.accessories);
      expect(result.vertexCount).toBe(sumParts);
    });

    it('三角面数 > 0', () => {
      const gen = new CharacterGenerator();
      const result = gen.generate();
      expect(result.triangleCount).toBeGreaterThan(0);
    });

    it('height 字段反映当前身高', () => {
      const gen = new CharacterGenerator();
      gen.setHeight(1.8);
      const result = gen.generate();
      expect(result.height).toBeCloseTo(1.8, 5);
    });
  });

  describe('确定性', () => {
    it('同种子同参数产生相同几何体', () => {
      const a = new CharacterGenerator().setSeed(42).generate();
      const b = new CharacterGenerator().setSeed(42).generate();
      const pa = a.geometry.attributes.position.array as Float32Array;
      const pb = b.geometry.attributes.position.array as Float32Array;
      expect(pa.length).toBe(pb.length);
      for (let i = 0; i < pa.length; i++) {
        expect(pa[i]).toBeCloseTo(pb[i], 7);
      }
    });

    it('不同种子产生不同角色(randomize)', () => {
      const a = new CharacterGenerator().setSeed(1);
      a.randomize();
      const b = new CharacterGenerator().setSeed(2);
      b.randomize();
      // 至少有一个参数不同
      const sa = a.getStats();
      const sb = b.getStats();
      const different =
        sa.race !== sb.race ||
        sa.gender !== sb.gender ||
        sa.bodyType !== sb.bodyType ||
        sa.hairStyle !== sb.hairStyle ||
        sa.clothing !== sb.clothing ||
        Math.abs(sa.height - sb.height) > 1e-6;
      expect(different).toBe(true);
    });

    it('同种子 randomize 产生相同参数', () => {
      const a = new CharacterGenerator().setSeed(99);
      a.randomize();
      const b = new CharacterGenerator().setSeed(99);
      b.randomize();
      expect(a.getStats()).toEqual(b.getStats());
    });
  });

  describe('setter 方法', () => {
    it('setRace 更新种族与默认肤色', () => {
      const gen = new CharacterGenerator();
      gen.setRace('orc');
      expect(gen.race).toBe('orc');
      // orc 默认肤色偏绿(g > r)
      expect(gen.skinColor.g).toBeGreaterThan(gen.skinColor.r);
    });

    it('setGender 更新性别与身高', () => {
      const gen = new CharacterGenerator();
      gen.setRace('human');
      const maleH = gen.height;
      gen.setGender('female');
      expect(gen.gender).toBe('female');
      expect(gen.height).toBeLessThan(maleH);
    });

    it('setHeight 校验正数', () => {
      const gen = new CharacterGenerator();
      gen.setHeight(2.0);
      expect(gen.height).toBe(2.0);
      expect(() => gen.setHeight(0)).toThrow();
      expect(() => gen.setHeight(-1)).toThrow();
    });

    it('setBodyType 更新体型', () => {
      const gen = new CharacterGenerator();
      gen.setBodyType('heavy');
      expect(gen.bodyType).toBe('heavy');
    });

    it('setSkinColor 复制颜色(不持有引用)', () => {
      const gen = new CharacterGenerator();
      const input = { r: 0.5, g: 0.6, b: 0.7 };
      gen.setSkinColor(input);
      input.r = 0.1;
      expect(gen.skinColor.r).toBe(0.5);
    });

    it('setHairStyle 校验 0-10 范围', () => {
      const gen = new CharacterGenerator();
      gen.setHairStyle(0);
      gen.setHairStyle(10);
      expect(() => gen.setHairStyle(-1)).toThrow();
      expect(() => gen.setHairStyle(11)).toThrow();
    });

    it('setHairColor 复制颜色', () => {
      const gen = new CharacterGenerator();
      const input = { r: 0.1, g: 0.2, b: 0.3 };
      gen.setHairColor(input);
      input.g = 0.9;
      expect(gen.hairColor.g).toBe(0.2);
    });

    it('setEyeColor 复制颜色', () => {
      const gen = new CharacterGenerator();
      gen.setEyeColor({ r: 0.2, g: 0.4, b: 0.7 });
      expect(gen.eyeColor.b).toBe(0.7);
    });

    it('setFaceShape 校验 0-1 范围', () => {
      const gen = new CharacterGenerator();
      gen.setFaceShape(0);
      gen.setFaceShape(1);
      expect(() => gen.setFaceShape(-0.1)).toThrow();
      expect(() => gen.setFaceShape(1.1)).toThrow();
    });

    it('setNoseShape 校验 0-1 范围', () => {
      const gen = new CharacterGenerator();
      gen.setNoseShape(0.5);
      expect(() => gen.setNoseShape(2)).toThrow();
    });

    it('setMouthShape 校验 0-1 范围', () => {
      const gen = new CharacterGenerator();
      gen.setMouthShape(0.3);
      expect(() => gen.setMouthShape(-1)).toThrow();
    });

    it('setClothing 更新类型与颜色', () => {
      const gen = new CharacterGenerator();
      gen.setClothing('armor', { r: 0.5, g: 0.5, b: 0.5 });
      expect(gen.clothing).toBe('armor');
      expect(gen.clothingColor.r).toBe(0.5);
    });

    it('setClothing 无颜色时用默认色', () => {
      const gen = new CharacterGenerator();
      gen.setClothing('robe');
      expect(gen.clothingColor).toBeDefined();
      expect(gen.clothingColor.r).toBeGreaterThan(0);
    });

    it('setAccessories 复制数组', () => {
      const gen = new CharacterGenerator();
      const input = ['glasses', 'hat'];
      gen.setAccessories(input);
      input.push('scarf');
      expect(gen.accessories).toEqual(['glasses', 'hat']);
      expect(gen.accessories.length).toBe(2);
    });

    it('setSeed 重置 PRNG', () => {
      const gen = new CharacterGenerator();
      gen.setSeed(123);
      expect(gen.seed).toBe(123);
    });

    it('fluent API 链式调用', () => {
      const gen = new CharacterGenerator();
      const result = gen
        .setRace('elf')
        .setGender('female')
        .setHeight(1.7)
        .setBodyType('slim')
        .setHairStyle(5)
        .setClothing('robe');
      expect(result).toBe(gen);
      expect(gen.race).toBe('elf');
      expect(gen.gender).toBe('female');
      expect(gen.height).toBe(1.7);
    });
  });

  describe('generateBody', () => {
    it('身体包含躯干 + 双臂 + 双腿(5 个盒体,顶点数 > 0)', () => {
      const gen = new CharacterGenerator();
      const body = gen.generateBody();
      expect(vertexCount(body)).toBeGreaterThan(0);
      // 5 个盒体 × 24 顶点/盒 = 120 顶点
      expect(vertexCount(body)).toBeGreaterThanOrEqual(120);
    });

    it('不同体型产生不同宽度的身体', () => {
      const gen = new CharacterGenerator();
      gen.setBodyType('slim');
      const slim = gen.generateBody();
      gen.setBodyType('heavy');
      const heavy = gen.generateBody();
      // heavy 体型身体更宽,顶点位置应有差异
      const slimPos = slim.attributes.position.array as Float32Array;
      const heavyPos = heavy.attributes.position.array as Float32Array;
      let diff = 0;
      const len = Math.min(slimPos.length, heavyPos.length);
      for (let i = 0; i < len; i++) {
        if (Math.abs(slimPos[i] - heavyPos[i]) > 1e-6) diff++;
      }
      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('generateHead', () => {
    it('头部包含脖颈 + 头颅', () => {
      const gen = new CharacterGenerator();
      const head = gen.generateHead();
      // 2 个盒体 × 24 顶点 = 48 顶点
      expect(vertexCount(head)).toBeGreaterThanOrEqual(48);
    });

    it('脸型影响头部宽度', () => {
      const gen = new CharacterGenerator();
      gen.setFaceShape(0);
      const narrow = gen.generateHead();
      gen.setFaceShape(1);
      const wide = gen.generateHead();
      // 宽脸型头部顶点应有更宽的 X 范围
      const narrowMaxX = maxAbsX(narrow.attributes.position.array as Float32Array);
      const wideMaxX = maxAbsX(wide.attributes.position.array as Float32Array);
      expect(wideMaxX).toBeGreaterThan(narrowMaxX);
    });
  });

  describe('generateFace', () => {
    it('面部包含双眼 + 鼻 + 嘴(4 个面片)', () => {
      const gen = new CharacterGenerator();
      const face = gen.generateFace();
      // 3 quad(2眼+嘴)× 4 顶点 + 1 tri × 3 顶点 = 15 顶点
      expect(vertexCount(face)).toBeGreaterThanOrEqual(15);
    });

    it('嘴型影响嘴宽度', () => {
      const gen = new CharacterGenerator();
      gen.setMouthShape(0);
      const small = gen.generateFace();
      gen.setMouthShape(1);
      const big = gen.generateFace();
      expect(vertexCount(small)).toBe(vertexCount(big));
      // 顶点位置应有差异
      const a = small.attributes.position.array as Float32Array;
      const b = big.attributes.position.array as Float32Array;
      let diff = 0;
      for (let i = 0; i < a.length; i++) {
        if (Math.abs(a[i] - b[i]) > 1e-6) diff++;
      }
      expect(diff).toBeGreaterThan(0);
    });
  });

  describe('generateHair', () => {
    it('hairStyle=0 光头无头发', () => {
      const gen = new CharacterGenerator();
      gen.setHairStyle(0);
      const hair = gen.generateHair();
      expect(vertexCount(hair)).toBe(0);
    });

    it('hairStyle=1 短发有头发', () => {
      const gen = new CharacterGenerator();
      gen.setHairStyle(1);
      const hair = gen.generateHair();
      expect(vertexCount(hair)).toBeGreaterThan(0);
    });

    it('hairStyle=5 中长发比短发顶点多', () => {
      const gen = new CharacterGenerator();
      gen.setHairStyle(1);
      const short = vertexCount(gen.generateHair());
      gen.setHairStyle(5);
      const medium = vertexCount(gen.generateHair());
      expect(medium).toBeGreaterThan(short);
    });

    it('hairStyle=8 长发比中长发顶点多', () => {
      const gen = new CharacterGenerator();
      gen.setHairStyle(5);
      const medium = vertexCount(gen.generateHair());
      gen.setHairStyle(8);
      const long = vertexCount(gen.generateHair());
      expect(long).toBeGreaterThan(medium);
    });

    it('hairStyle=10 莫西干有头发', () => {
      const gen = new CharacterGenerator();
      gen.setHairStyle(10);
      const hair = gen.generateHair();
      expect(vertexCount(hair)).toBeGreaterThan(0);
    });

    it('robot 无头发', () => {
      const gen = new CharacterGenerator();
      gen.setRace('robot');
      gen.setHairStyle(5);
      const hair = gen.generateHair();
      expect(vertexCount(hair)).toBe(0);
    });
  });

  describe('generateClothing', () => {
    const clothings: CharacterClothing[] = ['casual', 'formal', 'armor', 'robe', 'sci-fi'];
    for (const c of clothings) {
      it(`clothing=${c} 产出非空几何体`, () => {
        const gen = new CharacterGenerator();
        gen.setClothing(c);
        const clothing = gen.generateClothing();
        expect(vertexCount(clothing)).toBeGreaterThan(0);
      });
    }

    it('armor 比 casual 顶点多(更厚)', () => {
      const gen = new CharacterGenerator();
      gen.setClothing('casual');
      const casual = vertexCount(gen.generateClothing());
      gen.setClothing('armor');
      const armor = vertexCount(gen.generateClothing());
      expect(armor).toBeGreaterThanOrEqual(casual);
    });
  });

  describe('generateAccessories', () => {
    it('无配饰返回空几何体', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories([]);
      const acc = gen.generateAccessories();
      expect(vertexCount(acc)).toBe(0);
    });

    it('glasses 产出镜片几何体', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories(['glasses']);
      const acc = gen.generateAccessories();
      expect(vertexCount(acc)).toBeGreaterThan(0);
    });

    it('hat 产出帽子几何体', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories(['hat']);
      const acc = gen.generateAccessories();
      expect(vertexCount(acc)).toBeGreaterThan(0);
    });

    it('scarf 产出围巾几何体', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories(['scarf']);
      const acc = gen.generateAccessories();
      expect(vertexCount(acc)).toBeGreaterThan(0);
    });

    it('earrings 产出耳环几何体', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories(['earrings']);
      const acc = gen.generateAccessories();
      expect(vertexCount(acc)).toBeGreaterThan(0);
    });

    it('beard 男性产出胡子,女性不产出', () => {
      const gen = new CharacterGenerator();
      gen.setGender('male');
      gen.setAccessories(['beard']);
      expect(vertexCount(gen.generateAccessories())).toBeGreaterThan(0);
      gen.setGender('female');
      gen.setAccessories(['beard']);
      expect(vertexCount(gen.generateAccessories())).toBe(0);
    });

    it('mask 产出面罩', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories(['mask']);
      const acc = gen.generateAccessories();
      expect(vertexCount(acc)).toBeGreaterThan(0);
    });

    it('未知配饰忽略不报错', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories(['unknown-item']);
      expect(() => gen.generateAccessories()).not.toThrow();
    });

    it('多个配饰合并', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories(['glasses', 'hat', 'scarf']);
      const acc = gen.generateAccessories();
      expect(vertexCount(acc)).toBeGreaterThan(0);
    });
  });

  describe('generateSkeleton', () => {
    it('生成 16 块骨头(与 Humanoid 同层级)', () => {
      const gen = new CharacterGenerator();
      const skel = gen.generateSkeleton();
      expect(skel.bones.length).toBe(16);
    });

    it('骨头名称正确', () => {
      const gen = new CharacterGenerator();
      const skel = gen.generateSkeleton();
      const names = skel.bones.map((b) => b.name);
      expect(names).toContain('pelvis');
      expect(names).toContain('spine');
      expect(names).toContain('chest');
      expect(names).toContain('head');
      expect(names).toContain('shoulder.L');
      expect(names).toContain('upperArm.L');
      expect(names).toContain('thigh.R');
      expect(names).toContain('foot.R');
    });

    it('inverse bind matrices 数量与骨头一致', () => {
      const gen = new CharacterGenerator();
      const skel = gen.generateSkeleton();
      expect(skel.boneInverses.length).toBe(16);
    });

    it('身高缩放影响骨头位置', () => {
      const gen = new CharacterGenerator();
      gen.setHeight(1.75);
      const skelNormal = gen.generateSkeleton();
      const pelvisNormal = skelNormal.bones.find((b) => b.name === 'pelvis')!;
      gen.setHeight(3.5);
      const skelTall = gen.generateSkeleton();
      const pelvisTall = skelTall.bones.find((b) => b.name === 'pelvis')!;
      expect(pelvisTall.position.y).toBeGreaterThan(pelvisNormal.position.y);
    });

    it('父子层级正确(pelvis 是根)', () => {
      const gen = new CharacterGenerator();
      const skel = gen.generateSkeleton();
      const pelvis = skel.bones.find((b) => b.name === 'pelvis')!;
      const spine = skel.bones.find((b) => b.name === 'spine')!;
      expect(pelvis.children).toContain(spine);
      const chest = skel.bones.find((b) => b.name === 'chest')!;
      expect(spine.children).toContain(chest);
      const head = skel.bones.find((b) => b.name === 'head')!;
      expect(chest.children).toContain(head);
    });
  });

  describe('getStats', () => {
    it('返回当前参数快照', () => {
      const gen = new CharacterGenerator();
      gen.setRace('elf').setGender('female').setHeight(1.7).setBodyType('slim');
      const stats = gen.getStats();
      expect(stats.race).toBe('elf');
      expect(stats.gender).toBe('female');
      expect(stats.height).toBe(1.7);
      expect(stats.bodyType).toBe('slim');
    });

    it('快照是深拷贝(修改 gen 不影响已返回的 stats)', () => {
      const gen = new CharacterGenerator();
      gen.setAccessories(['glasses']);
      const stats = gen.getStats();
      gen.setAccessories(['hat']);
      expect(stats.accessories).toEqual(['glasses']);
    });
  });

  describe('randomize', () => {
    it('randomize 后所有参数在合法范围', () => {
      const gen = new CharacterGenerator();
      gen.randomize();
      const s = gen.getStats();
      const validRaces: CharacterRace[] = ['human', 'elf', 'dwarf', 'orc', 'robot'];
      const validGenders: CharacterGender[] = ['male', 'female'];
      const validBodyTypes: CharacterBodyType[] = ['slim', 'average', 'muscular', 'heavy'];
      const validClothings: CharacterClothing[] = ['casual', 'formal', 'armor', 'robe', 'sci-fi'];
      expect(validRaces).toContain(s.race);
      expect(validGenders).toContain(s.gender);
      expect(validBodyTypes).toContain(s.bodyType);
      expect(validClothings).toContain(s.clothing);
      expect(s.height).toBeGreaterThan(0);
      expect(s.hairStyle).toBeGreaterThanOrEqual(0);
      expect(s.hairStyle).toBeLessThanOrEqual(10);
      expect(s.faceShape).toBeGreaterThanOrEqual(0);
      expect(s.faceShape).toBeLessThanOrEqual(1);
      expect(s.noseShape).toBeGreaterThanOrEqual(0);
      expect(s.noseShape).toBeLessThanOrEqual(1);
      expect(s.mouthShape).toBeGreaterThanOrEqual(0);
      expect(s.mouthShape).toBeLessThanOrEqual(1);
    });

    it('randomize 后 generate 不抛错', () => {
      const gen = new CharacterGenerator();
      gen.randomize();
      expect(() => gen.generate()).not.toThrow();
    });
  });

  describe('多种族生成', () => {
    const races: CharacterRace[] = ['human', 'elf', 'dwarf', 'orc', 'robot'];
    for (const race of races) {
      it(`race=${race} 完整生成不抛错`, () => {
        const gen = new CharacterGenerator();
        gen.setRace(race);
        expect(() => gen.generate()).not.toThrow();
        const result = gen.generate();
        expect(result.vertexCount).toBeGreaterThan(0);
      });
    }
  });
});

// ── 辅助函数 ──────────────────────────────────────────────────

function vertexCount(geo: { attributes: Record<string, { array: ArrayLike<number> }> }): number {
  const pos = geo.attributes.position;
  return pos ? pos.array.length / 3 : 0;
}

function maxAbsX(arr: Float32Array): number {
  let max = 0;
  for (let i = 0; i < arr.length; i += 3) {
    const ax = Math.abs(arr[i]);
    if (ax > max) max = ax;
  }
  return max;
}
