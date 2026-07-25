// TextAtlas 单元测试。
//
// 测试环境为 node(无 DOM)。TextAtlas 在 canvas/ctx 缺失时退化为
// dry-run 模式(仅登记元数据),用于测试与 SSR 场景。本测试同时覆盖:
//   * dry-run 模式(stub canvas + null ctx)
//   * addChar / getChar / build / clear 数据层行为
//   * 字符不重复添加
//   * 行打包换行
//   * 图集满时返回 null
//   * getTexture 懒构造与 version bump

import { describe, it, expect } from 'vitest';
import { TextAtlas, DEFAULT_FONT, DEFAULT_ATLAS_WIDTH, DEFAULT_ATLAS_HEIGHT } from './TextAtlas';
import { CanvasTexture } from './CanvasTexture';

/** 构造一个最小 canvas stub:仅提供 width/height 字段(无 getContext 方法)。 */
function makeCanvasStub(width = 256, height = 256): HTMLCanvasElement {
  return { width, height } as unknown as HTMLCanvasElement;
}

describe('TextAtlas', () => {
  describe('defaults & construction', () => {
    it('constructs with default dimensions when no options given', () => {
      // 在 node 环境下 document 未定义 → canvas/ctx 为 null(dry-run)
      const atlas = new TextAtlas();
      expect(atlas.width).toBe(DEFAULT_ATLAS_WIDTH);
      expect(atlas.height).toBe(DEFAULT_ATLAS_HEIGHT);
      expect(atlas.chars.size).toBe(0);
      // node 环境下 tryCreateCanvas 返回 null
      expect(atlas.canvas).toBeNull();
      expect(atlas.ctx).toBeNull();
    });

    it('accepts injected canvas stub with null ctx (dry-run)', () => {
      const stub = makeCanvasStub(64, 32);
      const atlas = new TextAtlas({ canvas: stub, ctx: null });
      expect(atlas.canvas).toBe(stub);
      expect(atlas.ctx).toBeNull();
      expect(atlas.width).toBe(64);
      expect(atlas.height).toBe(32);
    });

    it('accepts custom width/height', () => {
      const atlas = new TextAtlas({ width: 128, height: 64 });
      expect(atlas.width).toBe(128);
      expect(atlas.height).toBe(64);
    });
  });

  describe('addChar', () => {
    it('registers a char with atlas coordinates in dry-run mode', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      const info = atlas.addChar('A', DEFAULT_FONT);
      expect(info).not.toBeNull();
      expect(info!.x).toBeGreaterThanOrEqual(0);
      expect(info!.y).toBeGreaterThanOrEqual(0);
      expect(info!.width).toBeGreaterThan(0);
      expect(info!.height).toBeGreaterThan(0);
      expect(info!.advance).toBeGreaterThanOrEqual(info!.width);
      expect(atlas.chars.has('A')).toBe(true);
    });

    it('returns the same record on re-add (no duplication)', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      const a = atlas.addChar('A', DEFAULT_FONT);
      const b = atlas.addChar('A', DEFAULT_FONT);
      expect(b).toBe(a); // 同一引用
      expect(atlas.chars.size).toBe(1);
    });

    it('registers whitespace chars with zero bitmap but positive advance', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      const space = atlas.addChar(' ', DEFAULT_FONT);
      expect(space).not.toBeNull();
      expect(space!.width).toBe(0);
      expect(space!.height).toBe(0);
      expect(space!.advance).toBeGreaterThan(0);

      const tab = atlas.addChar('\t', DEFAULT_FONT);
      expect(tab).not.toBeNull();
      expect(tab!.advance).toBeGreaterThan(space!.advance);
    });

    it('places chars horizontally then wraps to next row', () => {
      // 用一个很窄的图集强制换行:宽度 16,字号 24 → 每个字符(估算宽 15)
      // 都触发换行;A 与 B 应位于不同行(B.y > A.y)。
      const atlas = new TextAtlas({ canvas: makeCanvasStub(16, 256), ctx: null });
      const a = atlas.addChar('A', DEFAULT_FONT);
      const b = atlas.addChar('B', DEFAULT_FONT);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      // B 应在 A 下方(换行后)
      expect(b!.y).toBeGreaterThan(a!.y);
    });

    it('returns null when the atlas is full', () => {
      // 极小图集 + 大字号 → 第一个字符就可能塞不下
      const atlas = new TextAtlas(
        { canvas: makeCanvasStub(2, 2), ctx: null, width: 2, height: 2 },
      );
      const hugeFont = { font: '64px sans-serif', size: 64 };
      // 第一个字符可能塞下(估算 width=64*0.6=38,height=80,但 atlas 只有 2x2)
      const r = atlas.addChar('X', hugeFont);
      expect(r).toBeNull();
    });
  });

  describe('getChar', () => {
    it('returns undefined for unknown chars', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      expect(atlas.getChar('?')).toBeUndefined();
    });

    it('returns the recorded AtlasChar for known chars', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      atlas.addChar('Q', DEFAULT_FONT);
      const info = atlas.getChar('Q');
      expect(info).toBeDefined();
      expect(info!.advance).toBeGreaterThan(0);
    });
  });

  describe('build', () => {
    it('adds all unique chars from the text', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(512, 512), ctx: null });
      const failed = atlas.build('Hello', DEFAULT_FONT);
      expect(failed).toEqual([]);
      // H, e, l, o (l 重复,只添加一次)
      expect(atlas.chars.size).toBe(4);
      expect(atlas.getChar('H')).toBeDefined();
      expect(atlas.getChar('e')).toBeDefined();
      expect(atlas.getChar('l')).toBeDefined();
      expect(atlas.getChar('o')).toBeDefined();
    });

    it('does not re-add already-present chars', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(512, 512), ctx: null });
      atlas.build('AB', DEFAULT_FONT);
      const sizeAfterFirst = atlas.chars.size;
      atlas.build('ABCD', DEFAULT_FONT);
      expect(atlas.chars.size).toBe(sizeAfterFirst + 2); // 只新增 C, D
    });

    it('returns list of chars that did not fit', () => {
      const atlas = new TextAtlas(
        { canvas: makeCanvasStub(4, 4), ctx: null, width: 4, height: 4 },
      );
      const hugeFont = { font: '64px sans-serif', size: 64 };
      const failed = atlas.build('XYZ', hugeFont);
      expect(failed.length).toBeGreaterThan(0);
    });

    it('handles unicode (CJK) chars', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(512, 512), ctx: null });
      atlas.build('你好世界', DEFAULT_FONT);
      expect(atlas.chars.size).toBe(4);
      expect(atlas.getChar('你')).toBeDefined();
    });
  });

  describe('getTexture', () => {
    it('returns null when canvas is unavailable (dry-run without injected canvas)', () => {
      const atlas = new TextAtlas();
      expect(atlas.getTexture()).toBeNull();
    });

    it('returns a CanvasTexture when canvas is injected', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      const tex = atlas.getTexture();
      expect(tex).toBeInstanceOf(CanvasTexture);
      expect(tex!.canvas).toBe(atlas.canvas);
    });

    it('caches the same CanvasTexture across calls', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      const a = atlas.getTexture();
      const b = atlas.getTexture();
      expect(a).toBe(b);
    });

    it('bumps texture version after addChar', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      const tex = atlas.getTexture();
      const v0 = tex!.version;
      atlas.addChar('A', DEFAULT_FONT);
      expect(tex!.version).toBeGreaterThan(v0);
    });
  });

  describe('clear', () => {
    it('resets chars and cursor', () => {
      const atlas = new TextAtlas({ canvas: makeCanvasStub(), ctx: null });
      atlas.build('ABC', DEFAULT_FONT);
      expect(atlas.chars.size).toBe(3);
      atlas.clear();
      expect(atlas.chars.size).toBe(0);
      expect(atlas.getChar('A')).toBeUndefined();
      // clear 后可以重新添加
      const info = atlas.addChar('A', DEFAULT_FONT);
      expect(info).not.toBeNull();
      expect(info!.x).toBe(0);
      expect(info!.y).toBe(0);
    });
  });
});
