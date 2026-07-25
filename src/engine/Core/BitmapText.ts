// BitmapText — 位图文字(使用预渲染的 TextAtlas)。
//
// 与 Text 的区别:BitmapText 接受外部已经预渲染好的 TextAtlas(典型场景:
// 启动时把常用字符集一次性 build 到一张 atlas,后续多段文本共享同一图集,
// 避免运行时动态光栅化)。适用于需要大量文本共享图集的场景(HUD、
// 字幕、菜单)。
//
// 设计要点:
//   * 每次 setText / setFontSize 后调用 update() 重新生成几何体。
//   * letterSpacing 控制字间距(像素),默认 0。
//   * 颜色通过 material.color 控制(默认 MeshBasicMaterial,可替换)。
//   * 几何体生成逻辑与 Text 一致:逐字符查表 → quad → 合并。

import { Object3D } from './Object3D';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import { TextAtlas, DEFAULT_FONT, type TextFont } from './TextAtlas';
import type { RGB } from './Material';
import type { Material } from './Material';

export interface BitmapTextOptions {
  atlas: TextAtlas;
  text?: string;
  fontSize?: number;
  color?: RGB;
  letterSpacing?: number;
  font?: TextFont;
  material?: Material;
}

/**
 * 位图文字 — 共享预渲染图集。
 *
 * ```ts
 * const atlas = new TextAtlas();
 * atlas.build('0123456789');
 * const bmp = new BitmapText({ atlas, text: 'Score: 42' });
 * scene.add(bmp);
 * bmp.setText('Score: 99').update();
 * ```
 */
export class BitmapText extends Object3D {
  override readonly type: string = 'BitmapText';
  isBitmapText: boolean = true;

  /** 共享的图集。 */
  atlas: TextAtlas;
  /** 文字内容。 */
  text: string;
  /** 字号(像素)。 */
  fontSize: number;
  /** 字间距(像素)。 */
  letterSpacing: number;
  /** 字体描述(只读地传给 atlas 查表,不会再 addChar)。 */
  font: TextFont;
  /** 材质(默认 MeshBasicMaterial)。 */
  material: Material;
  /** 当前几何体。 */
  geometry: BufferGeometry;

  constructor(opts: BitmapTextOptions) {
    super();
    this.atlas = opts.atlas;
    this.text = opts.text ?? '';
    this.fontSize = opts.fontSize ?? DEFAULT_FONT.size;
    this.letterSpacing = opts.letterSpacing ?? 0;
    this.font = opts.font ?? DEFAULT_FONT;
    this.geometry = new BufferGeometry();

    if (opts.material) {
      this.material = opts.material;
    } else {
      const color: RGB = opts.color ?? { r: 1, g: 1, b: 1 };
      this.material = new MeshBasicMaterial({
        color,
        transparent: true,
        depthTest: true,
      });
      const tex = this.atlas.getTexture();
      if (tex && 'map' in this.material) {
        (this.material as MeshBasicMaterial).map = tex;
      }
    }

    if (this.text.length > 0) {
      this.update();
    }
  }

  /**
   * 重新生成几何体:遍历 {@link text} 的字符,从 {@link atlas} 取坐标,
   * 组装为单 BufferGeometry。update() 应在 setText / setFontSize /
   * setLetterSpacing 后调用。
   */
  update(): this {
    this.geometry = new BufferGeometry();

    const text = this.text;
    if (text.length === 0) return this;

    const atlasW = this.atlas.width;
    const atlasH = this.atlas.height;
    const scale = this.fontSize / this.font.size;
    const lineHeight = this.fontSize * 1.25;

    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;
    let xCursor = 0;
    let lineIndex = 0;

    for (const ch of text) {
      if (ch === '\n') {
        xCursor = 0;
        lineIndex++;
        continue;
      }
      const info = this.atlas.getChar(ch);
      if (!info) continue;

      const w = info.width * scale;
      const h = info.height * scale;
      const x0 = xCursor;
      const y0 = -lineIndex * lineHeight;
      const x1 = x0 + w;
      const y1 = y0 - h;

      const u0 = info.x / atlasW;
      const u1 = (info.x + info.width) / atlasW;
      const v0 = 1 - info.y / atlasH;
      const v1 = 1 - (info.y + info.height) / atlasH;

      positions.push(
        x0, y0, 0,
        x1, y0, 0,
        x1, y1, 0,
        x0, y1, 0,
      );
      uvs.push(
        u0, v0,
        u1, v0,
        u1, v1,
        u0, v1,
      );
      indices.push(
        vertexOffset, vertexOffset + 1, vertexOffset + 2,
        vertexOffset, vertexOffset + 2, vertexOffset + 3,
      );
      vertexOffset += 4;

      xCursor += info.advance * scale + this.letterSpacing;
    }

    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.geometry.setIndex(indices);

    return this;
  }

  /** 设置文本并立即重算几何体。 */
  setText(text: string): this {
    this.text = text;
    return this.update();
  }

  /** 设置字号并立即重算几何体。 */
  setFontSize(size: number): this {
    this.fontSize = size;
    return this.update();
  }

  /** 设置字间距并立即重算几何体。 */
  setLetterSpacing(spacing: number): this {
    this.letterSpacing = spacing;
    return this.update();
  }
}
