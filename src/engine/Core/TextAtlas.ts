// TextAtlas — 文字纹理图集。
//
// 把字符逐个光栅化到一张共享 canvas,记录每个字符在图集中的位置/尺寸,
// 由 Text / BitmapText 在生成几何体时按字符坐标采样。
//
// 设计要点:
//   * Canvas + 2D Context 在浏览器侧由 `document.createElement('canvas')`
//     创建;在 node 测试环境下没有 DOM,本类接受外部注入的 canvas 与
//     `CanvasRenderingContext2D` 工厂,缺失时退化为"只登记元数据不实际绘制"
//     的 dry-run 模式(用于测试与 SSR 场景)。
//   * `chars: Map<string, AtlasChar>` 保存每个字符的图集坐标。空白字符
//     (空格/制表符)不绘制,但仍记录 advance 以驱动光标前进。
//   * 图集布局采用简单的"行打包":超出当前行宽时换行。这避免依赖外部
//     bin-packing 库;对常见 UI 文本(几百到几千字符)足够高效。
//   * `getTexture()` 返回 `CanvasTexture`,版本号在每次新增字符后 bump,
//     renderer 据此从 canvas 重传 GPU。

import { CanvasTexture } from './CanvasTexture';

/** 单个字符在图集中的位置/尺寸/前进量(像素)。 */
export interface AtlasChar {
  /** 图集中字符位图的左上角 X(像素)。 */
  x: number;
  /** 图集中字符位图的左上角 Y(像素)。 */
  y: number;
  /** 字符位图宽度(像素)。 */
  width: number;
  /** 字符位图高度(像素)。 */
  height: number;
  /** 光标前进量(像素);通常 ≥ width,含字间距。 */
  advance: number;
}

/** 字体描述 — 最小字段集,用于在 2D Context 上配置 font。 */
export interface TextFont {
  /** CSS font 字符串,如 `'24px sans-serif'`。 */
  font: string;
  /** 字号(像素),与 font 字符串中一致。用于布局/行高估算。 */
  size: number;
  /** 字间距(像素),默认 1。 */
  letterSpacing?: number;
}

/** 默认字体:24px sans-serif。 */
export const DEFAULT_FONT: TextFont = {
  font: '24px sans-serif',
  size: 24,
  letterSpacing: 1,
};

/** 默认图集尺寸:512×512。 */
export const DEFAULT_ATLAS_WIDTH = 512;
export const DEFAULT_ATLAS_HEIGHT = 512;

/** 字符位图之间的水平/垂直内边距(像素),防止纹理采样串色。 */
const CHAR_PADDING = 2;

/**
 * 文字图集 — 把字符光栅化到 canvas,提供字符 → UV 坐标的查表。
 *
 * 浏览器侧典型用法:
 * ```ts
 * const atlas = new TextAtlas();
 * atlas.build('Hello, 世界');
 * const tex = atlas.getTexture();
 * ```
 *
 * 测试/SSR 侧:
 * ```ts
 * const atlas = new TextAtlas({ canvas: stubCanvas, ctx: null });
 * atlas.addChar('A', DEFAULT_FONT); // 仅登记元数据,不实际绘制
 * ```
 */
export class TextAtlas {
  /** 图集画布(浏览器侧由 document.createElement 创建;测试侧可注入 stub)。 */
  canvas: HTMLCanvasElement | null;
  /** 2D 上下文;若 canvas 不支持 getContext('2d')(如 stub),为 null。 */
  ctx: CanvasRenderingContext2D | null;
  /** 字符 → 图集坐标的查表。 */
  chars: Map<string, AtlasChar> = new Map();

  /** 当前打包游标 X(下一字符左上角 X)。 */
  private cursorX: number = 0;
  /** 当前打包游标 Y(当前行的基线 Y)。 */
  private cursorY: number = 0;
  /** 当前行已用最大高度(用于换行时计算下一行 Y)。 */
  private rowMaxHeight: number = 0;

  /** 图集宽度(像素)。 */
  readonly width: number;
  /** 图集高度(像素)。 */
  readonly height: number;

  /** 由 getTexture() 懒构造的 CanvasTexture;在 addChar 后 bump version。 */
  private texture: CanvasTexture | null = null;

  constructor(opts: {
    width?: number;
    height?: number;
    canvas?: HTMLCanvasElement | null;
    ctx?: CanvasRenderingContext2D | null;
  } = {}) {
    // 注入 canvas 时,优先从 canvas.width/height 推断图集尺寸;
    // 否则用 opts.width/height 或默认值。
    if (opts.canvas !== undefined && opts.canvas !== null) {
      const cw = (opts.canvas as { width?: number }).width;
      const ch = (opts.canvas as { height?: number }).height;
      this.width = opts.width ?? cw ?? DEFAULT_ATLAS_WIDTH;
      this.height = opts.height ?? ch ?? DEFAULT_ATLAS_HEIGHT;
      this.canvas = opts.canvas;
      this.ctx = opts.ctx ?? tryGet2DContext(opts.canvas);
    } else {
      this.width = opts.width ?? DEFAULT_ATLAS_WIDTH;
      this.height = opts.height ?? DEFAULT_ATLAS_HEIGHT;
      // 浏览器侧自动创建 canvas;node 侧 document 未定义时退化为 dry-run。
      const created = tryCreateCanvas(this.width, this.height);
      this.canvas = created.canvas;
      this.ctx = created.ctx ?? opts.ctx ?? null;
    }

    // 初始清空图集背景(透明)。
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  /**
   * 添加单个字符到图集。
   * - 已存在:直接返回旧记录
   * - 空白字符:不绘制,仅按字号估算 advance
   * - canvas/ctx 不可用:仅登记元数据估算值(dry-run)
   *
   * @returns 该字符的图集坐标;canvas 满时返回 null
   */
  addChar(char: string, font: TextFont = DEFAULT_FONT): AtlasChar | null {
    if (this.chars.has(char)) {
      return this.chars.get(char)!;
    }

    const letterSpacing = font.letterSpacing ?? 1;

    // 测量字符宽度。ctx 不可用时按字号估算。
    let charWidth: number;
    let charHeight: number;
    if (this.ctx) {
      this.ctx.font = font.font;
      const m = this.ctx.measureText(char);
      charWidth = Math.ceil(m.width);
      charHeight = Math.ceil(font.size * 1.25); // 行高近似
    } else {
      // dry-run:按字号估算(Latin/CJK 取较宽)
      charWidth = Math.ceil(font.size * 0.6);
      charHeight = Math.ceil(font.size * 1.25);
    }
    if (charWidth <= 0) charWidth = 1;

    // 空白字符:不绘制位图,仅记录 advance
    if (char === ' ' || char === '\t' || char === '\n') {
      const advance = (char === '\t' ? 4 : 1) * Math.ceil(font.size * 0.5) + letterSpacing;
      const entry: AtlasChar = {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        advance,
      };
      this.chars.set(char, entry);
      return entry;
    }

    // 行打包:超出当前行宽时换行
    const needX = this.cursorX + charWidth + CHAR_PADDING;
    if (needX > this.width) {
      this.cursorX = 0;
      this.cursorY += this.rowMaxHeight + CHAR_PADDING;
      this.rowMaxHeight = 0;
    }
    // 垂直溢出:图集已满
    if (this.cursorY + charHeight + CHAR_PADDING > this.height) {
      return null;
    }

    const x = this.cursorX;
    const y = this.cursorY;

    // 实际绘制(ctx 不可用时跳过)
    if (this.ctx) {
      this.ctx.font = font.font;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(char, x, y);
    }

    const entry: AtlasChar = {
      x,
      y,
      width: charWidth,
      height: charHeight,
      advance: charWidth + letterSpacing,
    };
    this.chars.set(char, entry);

    // 推进游标
    this.cursorX += charWidth + CHAR_PADDING;
    if (charHeight > this.rowMaxHeight) this.rowMaxHeight = charHeight;

    // 标记纹理脏
    if (this.texture) this.texture.update();

    return entry;
  }

  /** 获取字符的图集坐标;未添加返回 undefined。 */
  getChar(char: string): AtlasChar | undefined {
    return this.chars.get(char);
  }

  /**
   * 获取图集纹理(CanvasTexture)。
   * 首次调用时懒构造;后续 addChar 会自动 bump version。
   * canvas 不可用时返回 null。
   */
  getTexture(): CanvasTexture | null {
    if (this.canvas === null) return null;
    if (this.texture === null) {
      this.texture = new CanvasTexture(this.canvas);
    }
    return this.texture;
  }

  /**
   * 为文本预生成所有出现的字符。
   * 跳过已添加的字符,返回未添加失败的字符列表(图集满时)。
   */
  build(text: string, font: TextFont = DEFAULT_FONT): string[] {
    const failed: string[] = [];
    for (const ch of text) {
      if (this.chars.has(ch)) continue;
      const r = this.addChar(ch, font);
      if (r === null) failed.push(ch);
    }
    return failed;
  }

  /** 清空图集:重置 chars / 游标 / canvas。 */
  clear(): void {
    this.chars.clear();
    this.cursorX = 0;
    this.cursorY = 0;
    this.rowMaxHeight = 0;
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
    if (this.texture) this.texture.update();
  }
}

/** 尝试创建 canvas + 2D context;失败(如 node 环境)返回 null。 */
function tryCreateCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
} {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return { canvas: null, ctx: null };
  }
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return { canvas: c, ctx: tryGet2DContext(c) };
}

/** 从 canvas 取 2D context;失败返回 null。 */
function tryGet2DContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  if (typeof canvas.getContext !== 'function') return null;
  try {
    const ctx = canvas.getContext('2d');
    return ctx as CanvasRenderingContext2D | null;
  } catch {
    return null;
  }
}
