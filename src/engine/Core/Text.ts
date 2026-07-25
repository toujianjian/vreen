// Text — 3D 文字渲染。
//
// 把字符串通过 TextAtlas 光栅化为共享纹理图集,然后为每个字符生成一个
// quad(2 三角形)组装成 BufferGeometry,通过 MeshBasicMaterial + atlas
// texture 渲染。文字在 3D 空间中是一组固定朝向的 quad(不自动 billboard),
// 适用于 HUD 标签、世界空间铭牌等。
//
// 与 BitmapText 的区别:
//   * Text 内部持有自己的 TextAtlas,首次 setText 时按需添加字符。
//   * BitmapText 接受外部预渲染好的 TextAtlas,适合大量文本共享图集。
//
// 设计要点:
//   * 几何体顶点坐标单位为"像素 × fontSize 缩放",通过 Object3D.scale
//     控制最终世界尺寸。
//   * 换行符 (\n) 触发换行;行高 = fontSize * 1.25。
//   * alignment 支持 'left' / 'center' / 'right',沿 X 轴对齐每行。
//   * 默认 material 为 MeshBasicMaterial({ map: atlasTexture, color, transparent: true }),
//     用户可替换为自定义材质(如 SpriteMaterial)。

import { Object3D } from './Object3D';
import { BufferGeometry } from './BufferGeometry';
import { BufferAttribute } from './BufferAttribute';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import { TextAtlas, DEFAULT_FONT, type TextFont } from './TextAtlas';
import type { RGB } from './Material';
import type { Material } from './Material';

/** 文本水平对齐方式。 */
export type TextAlignment = 'left' | 'center' | 'right';

export interface TextOptions {
  text?: string;
  font?: TextFont;
  fontSize?: number;
  color?: RGB;
  alignment?: TextAlignment;
  /** 自定义材质;不传则用 MeshBasicMaterial({ map, color, transparent })。 */
  material?: Material;
  /** 自定义图集;不传则内部懒创建。 */
  atlas?: TextAtlas;
}

/**
 * 3D 文字 — 通过 TextAtlas 光栅化并组装几何体。
 *
 * ```ts
 * const text = new Text({ text: 'Hello', color: { r: 1, g: 1, b: 1 } });
 * text.position.set(0, 1, 0);
 * scene.add(text);
 * text.setText('Updated');
 * ```
 */
export class Text extends Object3D {
  override readonly type: string = 'Text';
  isText: boolean = true;

  /** 文字内容。修改后需调用 generateGeometry() 重算几何体。 */
  text: string;
  /** 字体描述(传给 TextAtlas)。 */
  font: TextFont;
  /** 字号(像素);用于行高与缩放。 */
  fontSize: number;
  /** 文字颜色(与 material.color 同步)。 */
  color: RGB;
  /** 水平对齐方式。 */
  alignment: TextAlignment;

  /** 内部使用的图集。 */
  atlas: TextAtlas;
  /** 材质(默认 MeshBasicMaterial)。 */
  material: Material;
  /** 当前几何体;setText / generateGeometry 后替换。 */
  geometry: BufferGeometry;

  constructor(opts: TextOptions = {}) {
    super();
    this.text = opts.text ?? '';
    this.font = opts.font ?? DEFAULT_FONT;
    this.fontSize = opts.fontSize ?? this.font.size;
    this.color = opts.color ?? { r: 1, g: 1, b: 1 };
    this.alignment = opts.alignment ?? 'left';

    this.atlas = opts.atlas ?? new TextAtlas();
    this.geometry = new BufferGeometry();

    if (opts.material) {
      this.material = opts.material;
    } else {
      this.material = new MeshBasicMaterial({
        color: { ...this.color },
        transparent: true,
        depthTest: true,
      });
      // 把 atlas 纹理绑定到 material.map(getTexture 懒构造)
      const tex = this.atlas.getTexture();
      if (tex && 'map' in this.material) {
        (this.material as MeshBasicMaterial).map = tex;
      }
    }

    if (this.text.length > 0) {
      this.generateGeometry();
    }
  }

  /**
   * 从 {@link text} 生成几何体:把每个字符添加到图集(若未存在),
   * 然后为每个字符生成一个 quad,按 advance 推进光标,按 \n 换行。
   *
   * @returns 生成后的 BufferGeometry(this.geometry)
   */
  generateGeometry(): BufferGeometry {
    // 释放旧 geometry 的属性(避免内存累积)
    this.geometry = new BufferGeometry();

    const text = this.text;
    if (text.length === 0) {
      return this.geometry;
    }

    // 预添加所有字符到图集
    this.atlas.build(text, this.font);

    const atlasW = this.atlas.width;
    const atlasH = this.atlas.height;
    const lineHeight = this.fontSize * 1.25;

    // 先按行收集字符,计算每行宽度(用于 alignment)
    const lines: { char: string; advance: number; x: number; y: number; w: number; h: number; u0: number; v0: number; u1: number; v1: number }[][] = [];
    let curLine: typeof lines[number] = [];
    let curX = 0;
    for (const ch of text) {
      if (ch === '\n') {
        lines.push(curLine);
        curLine = [];
        curX = 0;
        continue;
      }
      const info = this.atlas.getChar(ch);
      if (!info) continue;
      // UV (注意 canvas 默认 flipY=true,纹理 V=0 对应 canvas 顶部)
      const u0 = info.x / atlasW;
      const u1 = (info.x + info.width) / atlasW;
      const v0 = 1 - info.y / atlasH;
      const v1 = 1 - (info.y + info.height) / atlasH;
      // 缩放:把像素坐标缩放到 fontSize 字号下(若 atlas 字号 == fontSize,缩放为 1)
      const scale = this.fontSize / this.font.size;
      const w = info.width * scale;
      const h = info.height * scale;
      curLine.push({
        char: ch,
        advance: info.advance * scale,
        x: curX,
        y: 0, // 行内 y 由对齐时填
        w,
        h,
        u0,
        v0,
        u1,
        v1,
      });
      curX += info.advance * scale;
    }
    lines.push(curLine);

    // 计算每行宽度,根据 alignment 调整 x 偏移
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    let vertexOffset = 0;
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      const lineWidth = line.reduce((s, c) => s + c.advance, 0);
      let xOffset: number;
      if (this.alignment === 'center') {
        xOffset = -lineWidth / 2;
      } else if (this.alignment === 'right') {
        xOffset = -lineWidth;
      } else {
        xOffset = 0;
      }
      // 行 Y:第一行在顶部,后续行向下;用 li * lineHeight 偏移
      const lineY = -li * lineHeight;

      for (const c of line) {
        const x0 = xOffset + c.x;
        const y0 = lineY;
        const x1 = x0 + c.w;
        const y1 = y0 - c.h; // 向下扩展
        // 4 顶点 quad
        positions.push(
          x0, y0, 0,
          x1, y0, 0,
          x1, y1, 0,
          x0, y1, 0,
        );
        uvs.push(
          c.u0, c.v0,
          c.u1, c.v0,
          c.u1, c.v1,
          c.u0, c.v1,
        );
        indices.push(
          vertexOffset, vertexOffset + 1, vertexOffset + 2,
          vertexOffset, vertexOffset + 2, vertexOffset + 3,
        );
        vertexOffset += 4;
      }
    }

    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    this.geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    this.geometry.setIndex(indices);

    return this.geometry;
  }

  /** 设置文本并重算几何体。 */
  setText(text: string): this {
    this.text = text;
    this.generateGeometry();
    return this;
  }

  /** 设置颜色,同步到 material.color(若 material 支持)。 */
  setColor(color: RGB): this {
    this.color = { ...color };
    if ('color' in this.material) {
      (this.material as MeshBasicMaterial).color = { ...color };
    }
    return this;
  }
}
