# UI — 游戏内 UI 系统

> 仿照 o3de **LyShine**、UE5 **UMG (Unreal Motion Graphics)**、Unity **UI Toolkit** 的统一 in-game UI 实现。

VREEN 的 UI 模块提供完整的屏幕空间与世界空间用户界面栈:画布 (Canvas) → 元素层级 (Widget Tree) → 变换 (RectTransform) → 自动布局 (LayoutGroup) → 控件 (Button/Slider/Toggle/Dropdown/ScrollRect) → 输入事件 (Pointer/Keyboard/Drag/Focus) → 动画 (Tween)。

与 `Core/Text`、`Core/Sprite` 的区别:Core 是 3D 空间渲染原语,UI 是屏幕空间布局/交互系统。UI 控件可委托 Core 原语做实际光栅化,但锚点/布局/命中/动画由 UI 系统统一管理。

---

## 设计原则

| 原则 | 说明 |
|------|------|
| **纯 CPU 逻辑** | 布局/命中/动画逻辑不依赖 WebGL,可单元测试。渲染层消费 `UIDrawCommand` 绘制。 |
| **数据驱动** | 控件持有绘制指令 (纯数据),渲染层只需遍历可见元素收集指令。 |
| **组合优于继承** | 控件内部组合显示子元素 (背景图 + 标签),交互逻辑混入 `IInteractable`。 |
| **两阶段布局** | Calc (自底向上计算首选尺寸) → SetChildren (自顶向下分配位置),与 Unity 一致。 |
| **事件冒泡** | 指针/键盘事件从命中元素向上冒泡,可 `stopPropagation()`。 |

---

## 模块结构

| 文件 | 职责 |
|------|------|
| [RectTransform.ts](./RectTransform.ts) | 2D 变换:锚点 (Anchors) / 枢轴 (Pivot) / 偏移 (Offsets) / sizeDelta / 16 种锚点预设。 |
| [UIElement.ts](./UIElement.ts) | 元素基类:父子层级 / 可见性 / 命中检测 (hitTest + raycast) / 生命周期 (onEnable/onDisable/onLayout/onRender)。 |
| [UICanvas.ts](./UICanvas.ts) | 画布根:渲染模式 (ScreenSpaceOverlay/Camera/WorldSpace) / 缩放模式 (ConstantPixelSize/ScaleWithScreenSize/ConstantPhysicalSize) / 屏幕适配。 |
| [UILayout.ts](./UILayout.ts) | 自动布局:HorizontalLayoutGroup / VerticalLayoutGroup / GridLayoutGroup / ContentSizeFitter / LayoutElementPrefs。 |
| [UIPrimitives.ts](./UIPrimitives.ts) | 显示控件:UIText / UIImage / UIRawImage + UIColors 工具 + UIDrawCommand 类型。 |
| [UIControls.ts](./UIControls.ts) | 交互控件:UIInteractable 基类 / UIButton / UISlider / UIToggle / UIDropdown + 状态机 (normal/hover/pressed/disabled/focused)。 |
| [UIScrollRect.ts](./UIScrollRect.ts) | 滚动视图:视口裁剪 / 内容偏移 / 惯性 / 弹性回弹 / 滚动条。 |
| [UIInput.ts](./UIInput.ts) | 输入事件:UIInputDispatcher (指针/键盘/拖拽/焦点) + 事件冒泡 + Tab 导航。 |
| [UIAnimator.ts](./UIAnimator.ts) | 动画:UITween / UIAnimator / UISequence + 12 缓动函数 + Loop/PingPong。 |

---

## 核心概念

### RectTransform — 锚点布局

RectTransform 是 UI 元素的 2D 变换,与 3D `Object3D` 解耦。核心概念:

- **锚点 (Anchors)**:子元素相对父元素四角的归一化位置 `[0,1]²`。`min` 和 `max` 分离可实现「拉伸」(stretch) 布局——当 `minX != maxX` 时,元素随父元素宽度拉伸。
- **枢轴 (Pivot)**:元素自身的旋转/缩放中心,归一化 `[0,1]²`。`(0,0)` = 左下,`(0.5,0.5)` = 中心,`(1,1)` = 右上。
- **偏移 (Offsets)**:锚点矩形到元素矩形的像素偏移 `{left, bottom, right, top}`。
- **sizeDelta**:点锚点时等于元素宽高;拉伸锚点时为相对锚点矩形的增量。

```ts
const rt = new RectTransform();
rt.setAnchorPreset('middleCenter');  // 中心点锚点
rt.setSize(200, 50);                  // 200×50 像素
rt.pivot = { x: 0.5, y: 0.5 };        // 中心对齐

// 计算元素在父元素中的本地矩形
const rect = rt.computeRect(parentWidth, parentHeight);
// → { x: parentWidth*0.5 - 100, y: parentHeight*0.5 - 25, width: 200, height: 50 }
```

**16 种锚点预设**:`topLeft` / `topCenter` / `topRight` / `topStretch` / `middleLeft` / `middleCenter` / `middleRight` / `middleStretch` / `bottomLeft` / `bottomCenter` / `bottomRight` / `bottomStretch` / `stretchLeft` / `stretchCenter` / `stretchRight` / `stretchAll`。

### UICanvas — 画布与屏幕适配

画布是 UI 层级树的根,定义渲染模式与缩放模式:

| 渲染模式 | 说明 |
|----------|------|
| `screenSpaceOverlay` | 画布覆盖在屏幕最上层,不受相机变换影响 (HUD/UI 常用)。 |
| `screenSpaceCamera` | 画布渲染在相机前方固定距离的平面上 (可被 3D 物体遮挡)。 |
| `worldSpace` | 画布作为 3D 世界中的一个平面存在 (世界看板/操作台)。 |

| 缩放模式 | 说明 |
|----------|------|
| `constantPixelSize` | 像素 1:1,不随分辨率缩放。 |
| `scaleWithScreenSize` | 以参考分辨率缩放,`matchWidthOrHeight` (0=匹配宽度,1=匹配高度,0.5=平衡)。对数空间插值避免极端 match 跳变。 |
| `constantPhysicalSize` | 按物理 DPI 缩放 (移动端)。 |

```ts
const canvas = new UICanvas({
  renderMode: 'screenSpaceOverlay',
  scaler: {
    mode: 'scaleWithScreenSize',
    screenMatch: {
      referenceResolution: { width: 1920, height: 1080 },
      matchWidthOrHeight: 0.5,
    },
  },
});

// 每帧更新
canvas.update({ width: window.innerWidth, height: window.innerHeight, pixelRatio: devicePixelRatio });
```

### 布局系统

布局组自动排列子元素,免去手动设置每个元素的 offsets:

- **HorizontalLayoutGroup**:从左到右排列,支持 spacing/padding/对齐/弹性权重/强制展开。
- **VerticalLayoutGroup**:从上到下排列 (UI Y 向上,第一个子元素在顶部)。
- **GridLayoutGroup**:按行列网格排列,可指定列数/行数/单元格尺寸。
- **ContentSizeFitter**:根据子元素内容调整自身尺寸 (`minSize`/`preferredSize`/`unconstrained`)。
- **LayoutElementPrefs**:显式声明元素的布局偏好 (min/preferred/flexible),通过 `attachLayoutPrefs()` 附加。

```ts
const row = new HorizontalLayoutGroup('row', {
  spacing: 10,
  padding: { left: 20, right: 20, top: 10, bottom: 10 },
  childAlignment: 'middleCenter',
  controlChildSize: true,
  childForceExpandWidth: true,
});
canvas.root.addChild(row);

for (const item of items) row.addChild(item);
```

### 控件

#### 显示控件
- **UIText**:屏幕空间文本,支持对齐/换行/溢出/行距,内容驱动首选尺寸。
- **UIImage**:矩形图像 (纯色/纹理/圆角/边框),生成 `rect` 或 `image` 绘制指令。
- **UIRawImage**:原始图像 (不做着色,直接绘制纹理)。

#### 交互控件
- **UIButton**:背景图 + 文字标签 + 点击回调,5 状态颜色过渡 + scale 过渡。
- **UISlider**:轨道 + 填充 + 手柄,4 方向 (leftToRight/rightToLeft/bottomToTop/topToBottom),拖拽/点击调整值,wholeNumbers 取整。
- **UIToggle**:复选框 + 勾选标记 + 标签,toggle()/setOn() 切换状态。
- **UIDropdown**:当前值 + 展开列表,selectIndex()/setOptions() 管理选项。
- **UIScrollRect**:视口 + 内容 + 滚动条,惯性/弹性/滚轮,scrollToTop/Bottom。

所有交互控件继承 `UIInteractable`,内置状态机:

| 状态 | 触发 |
|------|------|
| `normal` | 默认 |
| `hover` | 指针进入 |
| `pressed` | 指针按下 |
| `disabled` | `setInteractable(false)` |
| `focused` | 获得焦点 (Tab/点击) |

```ts
const btn = new UIButton('start', 'Start Game');
btn.onClick = (e) => { startGame(); };
btn.colors.hoverColor = { r: 0.3, g: 0.6, b: 1, a: 1 };
canvas.root.addChild(btn);
```

### 输入系统

`UIInputDispatcher` 负责事件派发:

- **指针事件**:`down`/`move`/`up`/`click`/`enter`/`exit`,自动屏幕坐标 → 逻辑坐标转换 (含 Y 翻转)。
- **拖拽**:超过 `dragThreshold` (默认 5px) 触发 `dragStart`/`drag`/`dragEnd`。
- **键盘**:派发给焦点元素,支持 `Tab`/`Shift+Tab` 导航。
- **焦点**:`focus()`/`blur()`/`tabNext()`/`tabPrev()`,点击空白处自动 blur。
- **事件冒泡**:从命中元素向上到根,可 `stopPropagation()`。

```ts
const dispatcher = new UIInputDispatcher();
dispatcher.attachToCanvas(canvas);

// 渲染层收到浏览器 pointerdown 事件:
dispatcher.processPointer(canvas, { type: 'down', x: event.clientX, y: event.clientY, button: 'left' });
// 收到 keydown:
dispatcher.processKeyboard(canvas, { type: 'down', key: 'Tab', code: 'Tab', shift: false, ctrl: false, alt: false });
```

### 动画系统

`UIAnimator` 提供 tween 引擎:

- **属性动画**:position / scale / rotation / opacity / color。
- **12 缓动函数**:linear / easeIn/Out/InOut (Quad/Cubic) / easeIn/Out/InOutBack / easeOutElastic / easeOutBounce。
- **循环模式**:`once` / `loop` / `pingPong`。
- **序列**:`UISequence.append()` 顺序播放。
- **快捷方法**:`fadeIn`/`fadeOut`/`popIn`/`popOut`/`slideIn`/`colorTo`。

```ts
const animator = new UIAnimator();
animator.popIn(panel, 0.3);                        // 弹出 (easeOutBack)
animator.fadeIn(overlay, 0.2);                     // 淡入
animator.slideIn(menu, {x:-200,y:0}, {x:0,y:0}, 0.3, Easing.easeOutCubic);

// 每帧推进
animator.update(dt);
```

---

## 渲染集成

UI 控件在 `onRender()` 阶段生成 `UIDrawCommand` (纯数据):

```typescript
type UIDrawCommand =
  | { kind: 'rect'; x; y; width; height; color: UIColor; radius?; borderColor?; borderWidth? }
  | { kind: 'text'; x; y; width; height; text; color; fontSize; font?; align; verticalAlign; rotation? }
  | { kind: 'image'; x; y; width; height; color: UIColor; uv? };
```

渲染层只需遍历可见元素收集 `drawCommand`,用 Canvas2D / WebGL2 / SDF 绘制。布局/命中/动画逻辑与渲染完全解耦。

---

## 完整示例:HUD 构建

```ts
const canvas = new UICanvas({
  renderMode: 'screenSpaceOverlay',
  scaler: {
    mode: 'scaleWithScreenSize',
    screenMatch: { referenceResolution: { width: 1920, height: 1080 }, matchWidthOrHeight: 0.5 },
  },
});

// 顶部栏:血条 + 计分
const topBar = new HorizontalLayoutGroup('topBar', { spacing: 20, padding: { left:20, right:20, top:20, bottom:0 } });
topBar.transform.setAnchorPreset('topStretch');
topBar.transform.offsets = { left: 0, bottom: -60, right: 0, top: 0 };
canvas.root.addChild(topBar);

const healthBar = new UIImage('health');
healthBar.transform.setSize(200, 20);
healthBar.color = { r: 1, g: 0.2, b: 0.2, a: 1 };
topBar.addChild(healthBar);

const scoreLabel = new UIText('score', 'Score: 0');
scoreLabel.transform.setSize(150, 24);
topBar.addChild(scoreLabel);

// 底部按钮
const startBtn = new UIButton('start', 'Start');
startBtn.transform.setAnchorPreset('bottomCenter');
startBtn.transform.setSize(120, 40);
startBtn.transform.offsets = { left: -60, bottom: 20, right: 60, top: 60 };
startBtn.onClick = () => { startGame(); };
canvas.root.addChild(startBtn);

// 输入
const dispatcher = new UIInputDispatcher();
dispatcher.attachToCanvas(canvas);

// 主循环
function frame(dt: number) {
  canvas.update({ width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio });
  animator.update(dt);
  // 渲染层收集 drawCommand 并绘制...
}
```

---

## 与其他引擎对比

| 特性 | o3de LyShine | UE5 UMG | Unity UI | **VREEN UI** |
|------|:---:|:---:|:---:|:---:|
| 屏幕空间画布 | ✅ | ✅ | ✅ | ✅ |
| 世界空间画布 | ✅ | ✅ | ✅ | ✅ |
| 锚点/枢轴/拉伸 | ✅ | ✅ | ✅ | ✅ |
| 缩放适配 (参考分辨率) | ✅ | ✅ | ✅ | ✅ |
| Horizontal/Vertical/Grid 布局 | ✅ | ✅ | ✅ | ✅ |
| ContentSizeFitter | ❌ | ✅ (SizeBox) | ✅ | ✅ |
| Button/Slider/Toggle/Dropdown | ✅ | ✅ | ✅ | ✅ |
| ScrollRect (惯性+弹性) | ✅ | ✅ | ✅ | ✅ |
| 指针/键盘/拖拽/焦点 | ✅ | ✅ | ✅ | ✅ |
| Tween 动画 (12 缓动) | ✅ (AnimGraph) | ✅ (WidgetAnimation) | ❌ (需插件) | ✅ |
| 事件冒泡 + stopPropagation | ❌ (slate) | ✅ | ✅ | ✅ |
| 纯 CPU 可测试 | ❌ | ❌ | ❌ | ✅ |
| 零 WebGL 依赖 (布局逻辑) | ❌ | ❌ | ❌ | ✅ |

**相对于 soup3D 的优势**:soup3D 是基于 Python+pygame 的初学者引擎,**完全没有游戏内 UI 系统**——无画布、无控件、无布局、无输入事件路由。VREEN 提供完整的 LyShine/UMG 级 UI 栈,支持 HUD/菜单/对话框/血条/小地图等所有游戏 UI 场景。

---

## 测试

69 个单元测试覆盖 RectTransform / UIElement / UICanvas / LayoutGroup / Widgets / Input / Animator / 集成场景。

```bash
npx vitest run src/engine/UI/UI.test.ts
```
