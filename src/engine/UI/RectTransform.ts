// RectTransform — 2D UI 变换 (锚点 / 枢轴 / 偏移 / 尺寸)。
//
// 仿照 o3de LyShine `UiTransform2dInterface`、UE5 UMG `FGeometry` /
// `FAnchors`、Unity `RectTransform` 的统一实现。与 3D `Object3D` 的区别:
//   * 锚点 (Anchors) —— 子元素相对父元素四角的归一化位置 [0,1]²,
//     min/max 分离可实现「拉伸」(stretch) 布局。
//   * 枢轴 (Pivot) —— 元素自身的旋转/缩放中心,归一化 [0,1]²,
//     (0,0)=左下, (1,1)=右上, (0.5,0.5)=中心。
//   * 偏移 (Offsets) —— 锚点矩形到元素矩形的有符号像素偏移 (left/bottom/right/top)。
//   * sizeDelta —— 当锚点 min==max (非拉伸) 时为元素宽高;当锚点 min!=max (拉伸) 时
//     为相对锚点矩形的额外增量。
//
// 坐标系约定:
//   * 屏幕空间原点在左下角,+X 向右,+Y 向上 (与 WebGL clip space 一致)。
//   * 所有尺寸单位为「逻辑像素」(与设备像素比分离,由 UICanvas 的 scaleFactor 处理)。
//
// 纯 CPU 数学,无 WebGL 依赖,可单元测试。与 UICanvas / UIElement 配合使用。

/**
 * 锚点 —— 子元素相对父元素四角的归一化位置。
 *
 * - `min` = (minX, minY) 左下锚点,归一化 [0,1]。
 * - `max` = (maxX, maxY) 右上锚点,归一化 [0,1]。
 * - 当 min == max 时为「点锚点」(非拉伸,元素有固定 size)。
 * - 当 min != max 时为「拉伸锚点」(元素随父元素拉伸)。
 */
export interface Anchors {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 像素偏移 —— 锚点矩形到元素矩形的偏移。
 *
 * 当锚点为点锚点时 (min==max):
 *   width  = right - left
 *   height = top   - bottom
 *   中心位置 = 锚点位置 + (left + right)/2, (bottom + top)/2
 *
 * 当锚点为拉伸锚点时 (min!=max):
 *   元素左边 = 父宽 * minX + left
 *   元素右边 = 父宽 * maxX + right
 *   width    = 父宽 * (maxX - minX) + (right - left)
 *   同理 height。
 */
export interface Offsets {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** 计算后的轴对齐包围盒 (本地坐标系,相对父元素左下角)。 */
export interface UIRect {
  x: number;      // 左下角 X
  y: number;      // 左下角 Y
  width: number;
  height: number;
}

/** 锚点预设 —— 仿 Unity/UE5 的锚点快捷选项。 */
export type AnchorPreset =
  | 'topLeft' | 'topCenter' | 'topRight' | 'topStretch'
  | 'middleLeft' | 'middleCenter' | 'middleRight' | 'middleStretch'
  | 'bottomLeft' | 'bottomCenter' | 'bottomRight' | 'bottomStretch'
  | 'stretchLeft' | 'stretchCenter' | 'stretchRight' | 'stretchAll';

const ANCHOR_PRESETS: Record<AnchorPreset, Anchors> = {
  // 顶行 (y=1)
  topLeft:        { minX: 0,   minY: 1,   maxX: 0,   maxY: 1 },
  topCenter:      { minX: 0.5, minY: 1,   maxX: 0.5, maxY: 1 },
  topRight:       { minX: 1,   minY: 1,   maxX: 1,   maxY: 1 },
  topStretch:     { minX: 0,   minY: 1,   maxX: 1,   maxY: 1 },
  // 中行 (y=0.5)
  middleLeft:     { minX: 0,   minY: 0.5, maxX: 0,   maxY: 0.5 },
  middleCenter:   { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 },
  middleRight:    { minX: 1,   minY: 0.5, maxX: 1,   maxY: 0.5 },
  middleStretch:  { minX: 0,   minY: 0.5, maxX: 1,   maxY: 0.5 },
  // 底行 (y=0)
  bottomLeft:     { minX: 0,   minY: 0,   maxX: 0,   maxY: 0 },
  bottomCenter:   { minX: 0.5, minY: 0,   maxX: 0.5, maxY: 0 },
  bottomRight:    { minX: 1,   minY: 0,   maxX: 1,   maxY: 0 },
  bottomStretch:  { minX: 0,   minY: 0,   maxX: 1,   maxY: 0 },
  // 左拉伸 (x=0)
  stretchLeft:    { minX: 0,   minY: 0,   maxX: 0,   maxY: 1 },
  // 中拉伸 (x=0.5)
  stretchCenter:  { minX: 0.5, minY: 0,   maxX: 0.5, maxY: 1 },
  // 右拉伸 (x=1)
  stretchRight:   { minX: 1,   minY: 0,   maxX: 1,   maxY: 1 },
  // 全拉伸
  stretchAll:     { minX: 0,   minY: 0,   maxX: 1,   maxY: 1 },
};

/**
 * RectTransform —— UI 元素的 2D 变换。
 *
 * 不继承 3D Object3D:UI 使用独立的 2D 变换管线 (锚点/枢轴/偏移),
 * 由 UICanvas 统一投影到屏幕。与 3D 场景图解耦。
 *
 * ```ts
 * const rt = new RectTransform();
 * rt.setAnchorPreset('middleCenter');
 * rt.sizeDelta.set(200, 50);      // 200×50 像素
 * rt.pivot.set(0.5, 0.5);         // 中心对齐
 * const rect = rt.computeRect(parentWidth, parentHeight);
 * ```
 */
export class RectTransform {
  /** 锚点 (归一化)。 */
  anchors: Anchors = { minX: 0.5, minY: 0.5, maxX: 0.5, maxY: 0.5 };

  /** 像素偏移。点锚点时 left/bottom 为位置偏移, right/top = left+width/bottom+height。 */
  offsets: Offsets = { left: -50, bottom: -25, right: 50, top: 25 };

  /** 枢轴 (归一化 [0,1]²)。(0,0)=左下, (1,1)=右上。 */
  pivot: { x: number; y: number } = { x: 0.5, y: 0.5 };

  /** 旋转角度 (度,绕枢轴)。 */
  rotation: number = 0;

  /** 缩放 (相对枢轴)。 */
  scale: { x: number; y: number } = { x: 1, y: 1 };

  /** 锚点是否为拉伸模式 (min != max)。 */
  get isStretched(): boolean {
    return (
      this.anchors.minX !== this.anchors.maxX ||
      this.anchors.minY !== this.anchors.maxY
    );
  }

  /**
   * sizeDelta —— 元素尺寸增量。
   * - 点锚点时:等于元素宽高 (width = right - left, height = top - bottom)。
   * - 拉伸锚点时:相对锚点矩形的额外增量 (width = right - left)。
   */
  get sizeDelta(): { x: number; y: number } {
    return {
      x: this.offsets.right - this.offsets.left,
      y: this.offsets.top - this.offsets.bottom,
    };
  }

  set sizeDelta(v: { x: number; y: number }) {
    // 保持中心位置不变,调整 offsets 以匹配目标尺寸。
    const cx = (this.offsets.left + this.offsets.right) * 0.5;
    const cy = (this.offsets.bottom + this.offsets.top) * 0.5;
    this.offsets.left = cx - v.x * 0.5;
    this.offsets.right = cx + v.x * 0.5;
    this.offsets.bottom = cy - v.y * 0.5;
    this.offsets.top = cy + v.y * 0.5;
  }

  /** 直接设置宽高 (等价于 sizeDelta,点锚点常用)。 */
  setSize(width: number, height: number): void {
    this.sizeDelta = { x: width, y: height };
  }

  /** 设置锚点预设。 */
  setAnchorPreset(preset: AnchorPreset): void {
    this.anchors = { ...ANCHOR_PRESETS[preset] };
  }

  /**
   * 根据父元素尺寸计算本元素的本地包围盒 (相对父元素左下角)。
   *
   * 推导:
   *   锚点矩形 = { x: parentW * minX, y: parentH * minY,
   *               w: parentW * (maxX - minX), h: parentH * (maxY - minY) }
   *   元素矩形 = 锚点矩形 + offsets (left/bottom/right/top)
   *   最终 width  = 锚点矩形.w + (right - left)
   *   最终 height = 锚点矩形.h + (top   - bottom)
   *   最终 x      = 锚点矩形.x + left
   *   最终 y      = 锚点矩形.y + bottom
   *
   * 注意:返回的 rect 不含 pivot/rotation/scale 变换 (这些在 computeWorldMatrix 中应用),
   * 此处为布局尺寸,供 LayoutGroup / ContentSizeFitter 使用。
   */
  computeRect(parentWidth: number, parentHeight: number): UIRect {
    const anchorW = parentWidth * (this.anchors.maxX - this.anchors.minX);
    const anchorH = parentHeight * (this.anchors.maxY - this.anchors.minY);

    const x = parentWidth * this.anchors.minX + this.offsets.left;
    const y = parentHeight * this.anchors.minY + this.offsets.bottom;
    const width = anchorW + (this.offsets.right - this.offsets.left);
    const height = anchorH + (this.offsets.top - this.offsets.bottom);

    return { x, y, width, height };
  }

  /**
   * 计算元素中心点 (相对父元素左下角),考虑锚点 + offsets + pivot。
   * 用于子元素定位。
   */
  computeCenter(parentWidth: number, parentHeight: number): { x: number; y: number } {
    const rect = this.computeRect(parentWidth, parentHeight);
    // pivot 影响中心:当 pivot=(0.5,0.5) 时中心即 rect 中心;
    // pivot=(0,0) 时中心在 rect 左下角 + size/2... 实际上 pivot 只影响
    // 旋转/缩放中心与「锚点对齐位置」,布局中心仍是 rect 几何中心。
    return {
      x: rect.x + rect.width * 0.5,
      y: rect.y + rect.height * 0.5,
    };
  }

  /**
   * 判断点 (本地坐标,相对父元素左下角) 是否在元素矩形内。
   * 不考虑 rotation/scale (命中检测在 world space 中做)。
   */
  containsPoint(px: number, py: number, parentWidth: number, parentHeight: number): boolean {
    const rect = this.computeRect(parentWidth, parentHeight);
    return (
      px >= rect.x &&
      px <= rect.x + rect.width &&
      py >= rect.y &&
      py <= rect.y + rect.height
    );
  }

  /** 复制另一个 transform 的值。 */
  copy(other: RectTransform): this {
    this.anchors = { ...other.anchors };
    this.offsets = { ...other.offsets };
    this.pivot = { ...other.pivot };
    this.rotation = other.rotation;
    this.scale = { ...other.scale };
    return this;
  }

  /** 克隆。 */
  clone(): RectTransform {
    const rt = new RectTransform();
    rt.copy(this);
    return rt;
  }
}

export { ANCHOR_PRESETS };
