// UI module tests — RectTransform / UIElement / UICanvas / Layout / Widgets / Input / Animator。
import { describe, it, expect, beforeEach } from 'vitest';
import {
  RectTransform,
  UIElement,
  UICanvas,
  HorizontalLayoutGroup,
  VerticalLayoutGroup,
  GridLayoutGroup,
  ContentSizeFitter,
  LayoutElementPrefs,
  attachLayoutPrefs,
  UIText,
  UIImage,
  UIButton,
  UISlider,
  UIToggle,
  UIDropdown,
  UIScrollRect,
  UIInputDispatcher,
  UIAnimator,
  UIColors,
  Easing,
  type UIDrawCommand,
} from './index';

// ===================== RectTransform =====================
describe('RectTransform', () => {
  it('默认为 middleCenter 点锚点 + 100×50 尺寸', () => {
    const rt = new RectTransform();
    expect(rt.anchors.minX).toBe(0.5);
    expect(rt.anchors.maxX).toBe(0.5);
    expect(rt.anchors.minY).toBe(0.5);
    expect(rt.anchors.maxY).toBe(0.5);
    expect(rt.isStretched).toBe(false);
    const sd = rt.sizeDelta;
    expect(sd.x).toBe(100);
    expect(sd.y).toBe(50);
  });

  it('stretchAll 预设为拉伸模式', () => {
    const rt = new RectTransform();
    rt.setAnchorPreset('stretchAll');
    expect(rt.isStretched).toBe(true);
    expect(rt.anchors.minX).toBe(0);
    expect(rt.anchors.maxX).toBe(1);
    expect(rt.anchors.minY).toBe(0);
    expect(rt.anchors.maxY).toBe(1);
  });

  it('点锚点 computeRect 返回固定尺寸', () => {
    const rt = new RectTransform();
    rt.setAnchorPreset('middleCenter');
    rt.setSize(200, 100);
    // 锚点在父中心 (400,300),offsets 居中 → rect 在 (300,250) 200×100
    const rect = rt.computeRect(800, 600);
    expect(rect.width).toBeCloseTo(200);
    expect(rect.height).toBeCloseTo(100);
    expect(rect.x).toBeCloseTo(300); // 400 - 100
    expect(rect.y).toBeCloseTo(250); // 300 - 50
  });

  it('拉伸锚点 computeRect 随父尺寸变化', () => {
    const rt = new RectTransform();
    rt.setAnchorPreset('stretchAll');
    rt.offsets = { left: 10, bottom: 20, right: -10, top: -20 };
    const r1 = rt.computeRect(800, 600);
    expect(r1.x).toBeCloseTo(10);
    expect(r1.y).toBeCloseTo(20);
    expect(r1.width).toBeCloseTo(780); // 800 - 10 + 10 → 800*(1-0) + (-10-10) = 800-20
    expect(r1.height).toBeCloseTo(560); // 600 - 20 - 20
  });

  it('sizeDelta 设置保持中心不变', () => {
    const rt = new RectTransform();
    rt.setAnchorPreset('middleCenter');
    rt.offsets = { left: -50, bottom: -25, right: 50, top: 25 };
    rt.sizeDelta = { x: 300, y: 150 };
    expect(rt.offsets.right - rt.offsets.left).toBeCloseTo(300);
    expect(rt.offsets.top - rt.offsets.bottom).toBeCloseTo(150);
    // 中心 (left+right)/2 仍为 0。
    expect((rt.offsets.left + rt.offsets.right) / 2).toBeCloseTo(0);
  });

  it('containsPoint 判定点在矩形内', () => {
    const rt = new RectTransform();
    rt.setAnchorPreset('bottomLeft');
    rt.setSize(100, 100);
    rt.offsets = { left: 0, bottom: 0, right: 100, top: 100 };
    expect(rt.containsPoint(50, 50, 800, 600)).toBe(true);
    expect(rt.containsPoint(150, 50, 800, 600)).toBe(false);
    expect(rt.containsPoint(50, -10, 800, 600)).toBe(false);
  });

  it('所有 16 种锚点预设可正确设置', () => {
    const rt = new RectTransform();
    const presets: Array<keyof typeof import('./index').ANCHOR_PRESETS> = [
      'topLeft', 'topCenter', 'topRight', 'topStretch',
      'middleLeft', 'middleCenter', 'middleRight', 'middleStretch',
      'bottomLeft', 'bottomCenter', 'bottomRight', 'bottomStretch',
      'stretchLeft', 'stretchCenter', 'stretchRight', 'stretchAll',
    ];
    for (const p of presets) {
      rt.setAnchorPreset(p);
      expect(rt.anchors).toBeDefined();
    }
  });

  it('clone 生成独立副本', () => {
    const rt = new RectTransform();
    rt.setAnchorPreset('topRight');
    rt.setSize(123, 456);
    rt.rotation = 30;
    const clone = rt.clone();
    expect(clone.anchors.minX).toBe(1);
    expect(clone.sizeDelta.x).toBeCloseTo(123);
    expect(clone.rotation).toBe(30);
    clone.setSize(999, 999);
    expect(rt.sizeDelta.x).toBeCloseTo(123); // 原对象不受影响
  });
});

// ===================== UIElement =====================
describe('UIElement', () => {
  it('父子层级:addChild 设置 parent + children', () => {
    const parent = new UIElement('parent');
    const child = new UIElement('child');
    parent.addChild(child);
    expect(child.parent).toBe(parent);
    expect(parent.children).toContain(child);
    expect(parent.childCount).toBe(1);
  });

  it('addChild 自动从原父级移除', () => {
    const a = new UIElement('a');
    const b = new UIElement('b');
    const child = new UIElement('child');
    a.addChild(child);
    b.addChild(child);
    expect(a.children).not.toContain(child);
    expect(b.children).toContain(child);
    expect(child.parent).toBe(b);
  });

  it('removeChild 正确移除', () => {
    const parent = new UIElement('parent');
    const child = new UIElement('child');
    parent.addChild(child);
    expect(parent.removeChild(child)).toBe(true);
    expect(child.parent).toBeNull();
    expect(parent.childCount).toBe(0);
    expect(parent.removeChild(child)).toBe(false); // 再次移除失败
  });

  it('activeInHierarchy 受祖先影响', () => {
    const root = new UIElement('root');
    const mid = new UIElement('mid');
    const leaf = new UIElement('leaf');
    root.addChild(mid);
    mid.addChild(leaf);
    expect(leaf.activeInHierarchy).toBe(true);
    mid.visible = false;
    expect(leaf.activeInHierarchy).toBe(false);
    mid.visible = true;
    root.enabled = false;
    expect(leaf.activeInHierarchy).toBe(false);
  });

  it('layout 计算世界矩形并递归子元素', () => {
    const root = new UIElement('root');
    root.transform.setAnchorPreset('stretchAll');
    root.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };

    const child = new UIElement('child');
    child.transform.setAnchorPreset('stretchAll');
    child.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    root.addChild(child);

    root.layout(0, 0, 800, 600);
    expect(root.worldRect.width).toBeCloseTo(800);
    expect(root.worldRect.height).toBeCloseTo(600);
    expect(child.worldRect.width).toBeCloseTo(800);
    expect(child.worldRect.height).toBeCloseTo(600);
  });

  it('raycast 返回最顶层命中元素', () => {
    const root = new UIElement('root');
    root.transform.setAnchorPreset('stretchAll');
    root.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    root.isRaycastTarget = false;

    const child = new UIElement('child');
    child.transform.setAnchorPreset('stretchAll');
    child.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    root.addChild(child);

    root.layout(0, 0, 800, 600);
    const hit = root.raycast(400, 300);
    expect(hit).toBe(child);
  });

  it('findDescendant 递归查找后代', () => {
    const root = new UIElement('root');
    const mid = new UIElement('mid');
    const leaf = new UIElement('leaf');
    root.addChild(mid);
    mid.addChild(leaf);
    expect(root.findDescendant('leaf')).toBe(leaf);
    expect(root.findDescendant('nonexistent')).toBeNull();
  });

  it('bringToFront 改变渲染顺序', () => {
    const parent = new UIElement('parent');
    const a = new UIElement('a');
    const b = new UIElement('b');
    const c = new UIElement('c');
    parent.addChild(a);
    parent.addChild(b);
    parent.addChild(c);
    a.bringToFront();
    expect(parent.children[parent.children.length - 1]).toBe(a);
  });

  it('destroy 移除自身和所有子元素', () => {
    const parent = new UIElement('parent');
    const child = new UIElement('child');
    parent.addChild(child);
    child.destroy();
    expect(parent.childCount).toBe(0);
    expect(child.parent).toBeNull();
  });
});

// ===================== UICanvas =====================
describe('UICanvas', () => {
  it('constantPixelSize 缩放因子为固定值', () => {
    const canvas = new UICanvas({
      renderMode: 'screenSpaceOverlay',
      scaler: { mode: 'constantPixelSize', scaleFactor: 2 },
    });
    canvas.update({ width: 1920, height: 1080, pixelRatio: 1 });
    expect(canvas.scaleFactor).toBe(2);
  });

  it('scaleWithScreenSize 在参考分辨率匹配时缩放为 1', () => {
    const canvas = new UICanvas({
      renderMode: 'screenSpaceOverlay',
      scaler: {
        mode: 'scaleWithScreenSize',
        screenMatch: { referenceResolution: { width: 1920, height: 1080 }, matchWidthOrHeight: 0.5 },
      },
    });
    canvas.update({ width: 1920, height: 1080, pixelRatio: 1 });
    expect(canvas.scaleFactor).toBeCloseTo(1, 2);
  });

  it('scaleWithScreenSize 屏幕更大时缩放因子 > 1', () => {
    const canvas = new UICanvas({
      scaler: {
        mode: 'scaleWithScreenSize',
        screenMatch: { referenceResolution: { width: 1920, height: 1080 }, matchWidthOrHeight: 0 },
      },
    });
    canvas.update({ width: 3840, height: 2160, pixelRatio: 1 });
    expect(canvas.scaleFactor).toBeCloseTo(2, 2);
  });

  it('update 驱动根元素布局到屏幕尺寸', () => {
    const canvas = new UICanvas({ renderMode: 'screenSpaceOverlay' });
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });
    expect(canvas.root.worldRect.width).toBeCloseTo(800);
    expect(canvas.root.worldRect.height).toBeCloseTo(600);
  });

  it('hitTest 将屏幕坐标转换为逻辑坐标并命中元素', () => {
    const canvas = new UICanvas({ renderMode: 'screenSpaceOverlay' });
    // 添加一个占满画布的可命中子元素。
    const full = new UIElement('full');
    full.transform.setAnchorPreset('stretchAll');
    full.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    full.isRaycastTarget = true;
    canvas.root.addChild(full);
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });
    // 屏幕坐标 (400, 0) = 顶部中心 → 逻辑坐标 (400, 600) → 命中 full。
    const hit = canvas.hitTest(400, 0);
    expect(hit).toBe(full);
  });

  it('hitTest 空白处返回 null (根容器不参与命中)', () => {
    const canvas = new UICanvas({ renderMode: 'screenSpaceOverlay' });
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });
    const hit = canvas.hitTest(400, 300);
    expect(hit).toBeNull();
  });

  it('collectRaycastTargets 收集所有可命中元素 (不含根容器)', () => {
    const canvas = new UICanvas({ renderMode: 'screenSpaceOverlay' });
    const child = new UIElement('child');
    child.isRaycastTarget = true;
    canvas.root.addChild(child);
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });
    const targets = canvas.collectRaycastTargets();
    expect(targets).toContain(child);
    expect(targets).not.toContain(canvas.root);
  });
});

// ===================== Layout Groups =====================
describe('HorizontalLayoutGroup', () => {
  it('子元素从左到右排列', () => {
    const group = new HorizontalLayoutGroup('h', {
      spacing: 0,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      controlChildSize: true,
      childForceExpandWidth: true,
      childForceExpandHeight: true,
    });
    group.transform.setAnchorPreset('stretchAll');
    group.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    const a = new UIElement('a');
    const b = new UIElement('b');
    const c = new UIElement('c');
    group.addChild(a);
    group.addChild(b);
    group.addChild(c);

    group.layout(0, 0, 300, 100);

    // 三个子元素各占 100 宽。
    expect(a.worldRect.x).toBeCloseTo(0);
    expect(a.worldRect.width).toBeCloseTo(100);
    expect(b.worldRect.x).toBeCloseTo(100);
    expect(c.worldRect.x).toBeCloseTo(200);
  });

  it('spacing 增加子元素间距', () => {
    const group = new HorizontalLayoutGroup('h', {
      spacing: 10,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      controlChildSize: true,
      childForceExpandWidth: true,
      childForceExpandHeight: true,
    });
    group.transform.setAnchorPreset('stretchAll');
    group.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    const a = new UIElement('a');
    const b = new UIElement('b');
    group.addChild(a);
    group.addChild(b);
    group.layout(0, 0, 210, 100);
    expect(a.worldRect.x).toBeCloseTo(0);
    expect(a.worldRect.width).toBeCloseTo(100);
    expect(b.worldRect.x).toBeCloseTo(110);
  });

  it('使用 LayoutElementPrefs 的 flexibleWidth 分配剩余空间', () => {
    const group = new HorizontalLayoutGroup('h', {
      spacing: 0,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      controlChildSize: true,
      useFlexibleSpaces: true,
      childForceExpandWidth: false,
      childForceExpandHeight: false,
    });
    group.transform.setAnchorPreset('stretchAll');
    group.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    const a = new UIElement('a');
    const b = new UIElement('b');
    attachLayoutPrefs(a, new LayoutElementPrefs({ preferredWidth: 100, flexibleWidth: 1 }));
    attachLayoutPrefs(b, new LayoutElementPrefs({ preferredWidth: 100, flexibleWidth: 3 }));
    group.addChild(a);
    group.addChild(b);
    group.layout(0, 0, 600, 100);
    // 剩余 400 按 1:3 分配:a=200, b=400。
    expect(a.worldRect.width).toBeCloseTo(200, 0);
    expect(b.worldRect.width).toBeCloseTo(400, 0);
  });
});

describe('VerticalLayoutGroup', () => {
  it('子元素从上到下排列', () => {
    const group = new VerticalLayoutGroup('v', {
      spacing: 0,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
      controlChildSize: true,
      childForceExpandWidth: true,
      childForceExpandHeight: true,
    });
    group.transform.setAnchorPreset('stretchAll');
    group.transform.offsets = { left: 0, bottom: 0, right: 0, top: 0 };
    const a = new UIElement('a');
    const b = new UIElement('b');
    const c = new UIElement('c');
    group.addChild(a);
    group.addChild(b);
    group.addChild(c);

    group.layout(0, 0, 100, 300);

    // a 在最顶部 (Y 最大)。
    expect(a.worldRect.y + a.worldRect.height).toBeCloseTo(300);
    expect(b.worldRect.y + b.worldRect.height).toBeCloseTo(200);
    expect(c.worldRect.y + c.worldRect.height).toBeCloseTo(100);
  });
});

describe('GridLayoutGroup', () => {
  it('子元素按行列排列', () => {
    const group = new GridLayoutGroup('g', {
      columns: 2,
      cellSize: { width: 50, height: 50 },
      spacing: 0,
      padding: { left: 0, right: 0, top: 0, bottom: 0 },
    });
    const items = ['a', 'b', 'c', 'd'].map((n) => new UIElement(n));
    for (const it of items) group.addChild(it);
    group.layout(0, 0, 100, 100);
    // a(0,0) b(1,0) c(0,1) d(1,1) → X: a=0 b=50 c=0 d=50
    expect(items[0].worldRect.x).toBeCloseTo(0);
    expect(items[1].worldRect.x).toBeCloseTo(50);
    expect(items[2].worldRect.x).toBeCloseTo(0);
    expect(items[3].worldRect.x).toBeCloseTo(50);
  });
});

describe('ContentSizeFitter', () => {
  it('根据子元素首选尺寸调整自身', () => {
    const container = new UIElement('container');
    container.transform.setSize(0, 0);
    const child = new UIElement('child');
    child.transform.setSize(150, 80);
    container.addChild(child);

    const fitter = new ContentSizeFitter('preferredSize', 'preferredSize');
    const { width, height } = fitter.fit(container);
    expect(width).toBeGreaterThanOrEqual(140);
    expect(height).toBeGreaterThanOrEqual(70);
  });
});

// ===================== Widgets =====================
describe('UIText', () => {
  it('设置文本与样式', () => {
    const t = new UIText('label', 'Hello');
    expect(t.text).toBe('Hello');
    t.setText('World').setColor(1, 0, 0);
    expect(t.text).toBe('World');
  });

  it('onRender 生成 text 绘制指令', () => {
    const t = new UIText('label', 'Test');
    t.transform.setSize(100, 20);
    t.layout(0, 0, 100, 20);
    t.render();
    expect(t.drawCommand).not.toBeNull();
    expect(t.drawCommand!.kind).toBe('text');
  });

  it('默认不参与命中检测', () => {
    const t = new UIText('label');
    expect(t.isRaycastTarget).toBe(false);
  });

  it('getLayoutElement 根据文本估算尺寸', () => {
    const t = new UIText('label', 'Hello');
    t.fontSize = 20;
    const le = t.getLayoutElement();
    expect(le.preferredWidth).toBeGreaterThan(0);
    expect(le.preferredHeight).toBeGreaterThanOrEqual(20);
  });
});

describe('UIImage', () => {
  it('onRender 生成 rect 绘制指令', () => {
    const img = new UIImage('bg');
    img.transform.setSize(100, 100);
    img.layout(0, 0, 100, 100);
    img.render();
    expect(img.drawCommand).not.toBeNull();
    expect(img.drawCommand!.kind).toBe('rect');
  });

  it('设置 UV 后生成 image 绘制指令', () => {
    const img = new UIImage('tex');
    img.uv = { u0: 0, v0: 0, u1: 1, v1: 1 };
    img.transform.setSize(100, 100);
    img.layout(0, 0, 100, 100);
    img.render();
    expect(img.drawCommand!.kind).toBe('image');
  });

  it('圆角与边框配置', () => {
    const img = new UIImage('card');
    img.cornerRadius = 8;
    img.borderColor = UIColors.red();
    img.borderWidth = 2;
    img.transform.setSize(100, 100);
    img.layout(0, 0, 100, 100);
    img.render();
    const cmd = img.drawCommand as Extract<UIDrawCommand, { kind: 'rect' }>;
    expect(cmd.radius).toBe(8);
    expect(cmd.borderColor).toBeDefined();
    expect(cmd.borderWidth).toBe(2);
  });
});

describe('UIButton', () => {
  it('点击触发 onClick', () => {
    const btn = new UIButton('start', 'Start');
    let clicked = false;
    btn.onClick = () => { clicked = true; };

    btn.transform.setSize(100, 40);
    btn.layout(0, 0, 100, 40);

    const e = {
      uiEvent: expect.any(Object),
      x: 50, y: 20, localX: 50, localY: 20,
      button: 'left' as const, isInside: true,
    };
    btn.onPointerClick!(e);
    expect(clicked).toBe(true);
  });

  it('disabled 状态不触发点击', () => {
    const btn = new UIButton('btn');
    let clicked = false;
    btn.onClick = () => { clicked = true; };
    btn.setInteractable(false);
    btn.onPointerClick!({} as any);
    expect(clicked).toBe(false);
    expect(btn.state).toBe('disabled');
  });

  it('hover 切换状态颜色', () => {
    const btn = new UIButton('btn');
    btn.transform.setSize(100, 40);
    btn.layout(0, 0, 100, 40);
    const normalColor = btn.background.color;
    btn.onPointerEnter!({} as any);
    expect(btn.state).toBe('hover');
    expect(btn.background.color).not.toEqual(normalColor);
  });

  it('包含背景图与文字标签子元素', () => {
    const btn = new UIButton('btn', 'OK');
    expect(btn.findChild('btn/bg')).not.toBeNull();
    expect(btn.findChild('btn/label')).not.toBeNull();
    expect(btn.label.text).toBe('OK');
  });
});

describe('UISlider', () => {
  it('设置值触发 onValueChanged', () => {
    const slider = new UISlider('vol');
    slider.minValue = 0;
    slider.maxValue = 100;
    let captured = -1;
    slider.onValueChanged = (v) => { captured = v as number; };
    slider.setValue(50);
    expect(slider.value).toBe(50);
    expect(captured).toBe(50);
  });

  it('值被钳制到范围', () => {
    const slider = new UISlider('vol');
    slider.minValue = 0;
    slider.maxValue = 10;
    slider.setValue(100);
    expect(slider.value).toBe(10);
    slider.setValue(-5);
    expect(slider.value).toBe(0);
  });

  it('wholeNumbers 取整', () => {
    const slider = new UISlider('vol');
    slider.minValue = 0;
    slider.maxValue = 10;
    slider.wholeNumbers = true;
    slider.setValue(3.7);
    expect(slider.value).toBe(4);
  });

  it('normalizedValue 正确归一化', () => {
    const slider = new UISlider('vol');
    slider.minValue = 10;
    slider.maxValue = 20;
    slider.setValue(15);
    expect(slider.normalizedValue).toBeCloseTo(0.5);
  });

  it('包含 track / fill / handle 子元素', () => {
    const slider = new UISlider('vol');
    expect(slider.findChild('vol/track')).not.toBeNull();
    expect(slider.findChild('vol/fill')).not.toBeNull();
    expect(slider.findChild('vol/handle')).not.toBeNull();
  });
});

describe('UIToggle', () => {
  it('toggle 切换状态并触发回调', () => {
    const tog = new UIToggle('mute', 'Mute');
    let val = false;
    tog.onValueChanged = (v) => { val = v as boolean; };
    tog.toggle();
    expect(tog.isOn).toBe(true);
    expect(val).toBe(true);
  });

  it('setOn 不触发回调 (fireCallback=false)', () => {
    const tog = new UIToggle('tog');
    let count = 0;
    tog.onValueChanged = () => { count++; };
    tog.setOn(true, false);
    expect(tog.isOn).toBe(true);
    expect(count).toBe(0);
  });

  it('勾选标记可见性随状态变化', () => {
    const tog = new UIToggle('tog');
    expect(tog.checkmark.visible).toBe(false);
    tog.toggle();
    expect(tog.checkmark.visible).toBe(true);
  });
});

describe('UIDropdown', () => {
  it('设置选项并选中', () => {
    const dd = new UIDropdown('quality');
    dd.setOptions(['Low', 'Medium', 'High']);
    dd.selectIndex(1);
    expect(dd.value).toBe('Medium');
    expect(dd.caption.text).toBe('Medium');
  });

  it('selectIndex 越界不崩溃', () => {
    const dd = new UIDropdown('dd');
    dd.setOptions(['A', 'B']);
    dd.selectIndex(99);
    expect(dd.value).not.toBe('B');
  });

  it('展开/收起切换', () => {
    const dd = new UIDropdown('dd');
    dd.setOptions(['A', 'B']);
    expect(dd.isExpanded).toBe(false);
    dd.toggleExpanded();
    expect(dd.isExpanded).toBe(true);
    expect(dd.list.visible).toBe(true);
  });
});

// ===================== UIScrollRect =====================
describe('UIScrollRect', () => {
  it('包含 viewport 与 content', () => {
    const sr = new UIScrollRect('scroll');
    expect(sr.findDescendant('scroll/viewport')).not.toBeNull();
    expect(sr.findDescendant('scroll/content')).not.toBeNull();
  });

  it('scrollToBottom 设置垂直位置为 1', () => {
    const sr = new UIScrollRect('scroll');
    sr.scrollToBottom();
    expect(sr.verticalNormalizedPosition).toBe(1);
  });

  it('scrollToTop 设置垂直位置为 0', () => {
    const sr = new UIScrollRect('scroll');
    sr.scrollToTop();
    expect(sr.verticalNormalizedPosition).toBe(0);
  });

  it('handleScroll 调整垂直位置', () => {
    const sr = new UIScrollRect('scroll', { direction: 'vertical' });
    sr.viewport.worldRect = { x: 0, y: 0, width: 100, height: 100 };
    sr.content.worldRect = { x: 0, y: 0, width: 100, height: 300 };
    sr.handleScroll(0, 1); // 向下滚 1 单位灵敏度
    expect(sr.verticalNormalizedPosition).toBeGreaterThan(0);
  });
});

// ===================== UIInputDispatcher =====================
describe('UIInputDispatcher', () => {
  let canvas: UICanvas;
  let dispatcher: UIInputDispatcher;

  beforeEach(() => {
    canvas = new UICanvas({ renderMode: 'screenSpaceOverlay' });
    dispatcher = new UIInputDispatcher();
    dispatcher.attachToCanvas(canvas);
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });
  });

  it('processPointer down/up 触发 click', () => {
    const btn = new UIButton('btn');
    btn.transform.setSize(100, 40);
    btn.transform.setAnchorPreset('middleCenter');
    canvas.root.addChild(btn);
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });

    let clicked = false;
    btn.onClick = () => { clicked = true; };

    // 屏幕中心 (400, 300) → 命中按钮。
    dispatcher.processPointer(canvas, { type: 'down', x: 400, y: 300, button: 'left' });
    dispatcher.processPointer(canvas, { type: 'up', x: 400, y: 300, button: 'left' });
    expect(clicked).toBe(true);
  });

  it('点击空白处取消焦点', () => {
    const btn = new UIButton('btn');
    btn.transform.setSize(100, 40);
    btn.transform.setAnchorPreset('middleCenter');
    canvas.root.addChild(btn);
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });

    dispatcher.processPointer(canvas, { type: 'down', x: 400, y: 300, button: 'left' });
    expect(dispatcher.focused).toBe(btn);
    // 点击左上角空白。
    dispatcher.processPointer(canvas, { type: 'down', x: 0, y: 0, button: 'left' });
    expect(dispatcher.focused).toBeNull();
  });

  it('拖拽超过阈值触发 drag', () => {
    const slider = new UISlider('vol');
    slider.transform.setSize(200, 20);
    slider.transform.setAnchorPreset('middleCenter');
    slider.minValue = 0;
    slider.maxValue = 100;
    canvas.root.addChild(slider);
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });

    const initial = slider.value;
    // down 在滑块中心。
    dispatcher.processPointer(canvas, { type: 'down', x: 400, y: 300, button: 'left' });
    // move 拖拽 50 像素。
    dispatcher.processPointer(canvas, { type: 'move', x: 450, y: 300, button: 'left' });
    expect(slider.value).not.toBe(initial);
  });

  it('tabNext 在可交互元素间循环', () => {
    const btn1 = new UIButton('b1');
    const btn2 = new UIButton('b2');
    btn1.isRaycastTarget = true;
    btn2.isRaycastTarget = true;
    canvas.root.addChild(btn1);
    canvas.root.addChild(btn2);
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });

    dispatcher.tabNext();
    expect(dispatcher.focused).toBe(btn1);
    dispatcher.tabNext();
    expect(dispatcher.focused).toBe(btn2);
    dispatcher.tabNext();
    expect(dispatcher.focused).toBe(btn1); // 循环
  });

  it('hover 切换 enter/exit', () => {
    const btn = new UIButton('btn');
    btn.transform.setSize(100, 40);
    btn.transform.setAnchorPreset('middleCenter');
    canvas.root.addChild(btn);
    canvas.update({ width: 800, height: 600, pixelRatio: 1 });

    dispatcher.processPointer(canvas, { type: 'move', x: 400, y: 300, button: 'left' });
    expect(btn.state).toBe('hover');
    dispatcher.processPointer(canvas, { type: 'move', x: 0, y: 0, button: 'left' });
    expect(btn.state).toBe('normal');
  });
});

// ===================== UIAnimator =====================
describe('UIAnimator', () => {
  it('tween 完成后调用 onComplete', () => {
    const el = new UIElement('el');
    const animator = new UIAnimator();
    let done = false;
    animator.tween(
      el,
      { type: 'scale', from: { x: 1, y: 1 }, to: { x: 2, y: 2 } },
      1,
      { onComplete: () => { done = true; } },
    );
    // 推进 0.5s → 未完成。
    animator.update(0.5);
    expect(done).toBe(false);
    expect(animator.isAnimating).toBe(true);
    // 推进 0.5s → 完成。
    animator.update(0.5);
    expect(done).toBe(true);
    expect(animator.isAnimating).toBe(false);
  });

  it('fadeIn 淡入', () => {
    const el = new UIElement('el');
    const animator = new UIAnimator();
    animator.fadeIn(el, 1);
    expect(animator.count).toBe(1);
    animator.update(1);
    expect(animator.count).toBe(0); // 完成后移除
  });

  it('popIn 使用 easeOutBack', () => {
    const el = new UIElement('el');
    const animator = new UIAnimator();
    animator.popIn(el, 0.3);
    animator.update(0.15);
    expect(el.transform.scale.x).toBeGreaterThan(0);
    expect(el.transform.scale.x).toBeLessThan(1.5); // back 回弹可能超过 1
  });

  it('loop 模式循环不结束', () => {
    const el = new UIElement('el');
    const animator = new UIAnimator();
    animator.tween(
      el,
      { type: 'rotation', from: 0, to: 360 },
      1,
      { loop: 'loop' },
    );
    animator.update(1);
    expect(animator.isAnimating).toBe(true); // 循环未结束
    animator.update(1);
    expect(animator.isAnimating).toBe(true);
  });

  it('cancelAll 取消目标元素的所有 tween', () => {
    const el = new UIElement('el');
    const animator = new UIAnimator();
    animator.fadeIn(el, 1);
    animator.popIn(el, 1);
    expect(animator.count).toBe(2);
    animator.cancelAll(el);
    animator.update(0.01);
    expect(animator.count).toBe(0);
  });

  it('Easing 函数返回正确值', () => {
    expect(Easing.linear(0.5)).toBeCloseTo(0.5);
    expect(Easing.easeInQuad(0.5)).toBeCloseTo(0.25);
    expect(Easing.easeOutQuad(0.5)).toBeCloseTo(0.75);
    expect(Easing.easeInOutCubic(0)).toBeCloseTo(0);
    expect(Easing.easeInOutCubic(1)).toBeCloseTo(1);
    expect(Easing.easeOutBounce(1)).toBeCloseTo(1);
    expect(Easing.easeOutElastic(1)).toBeCloseTo(1);
  });

  it('slideIn 移动元素位置', () => {
    const el = new UIElement('el');
    el.transform.setSize(100, 100);
    el.transform.setAnchorPreset('middleCenter');
    const animator = new UIAnimator();
    animator.slideIn(el, { x: 0, y: 0 }, { x: 100, y: 100 }, 1);
    animator.update(0.5);
    // 中间位置应接近 (50, 50) (easeOutCubic 略小于 0.5)。
    const cx = (el.transform.offsets.left + el.transform.offsets.right) / 2;
    expect(cx).toBeGreaterThan(0);
    expect(cx).toBeLessThan(100);
  });
});

// ===================== 集成测试 =====================
describe('UI 集成:完整 HUD 构建', () => {
  it('构建血条 + 计分 + 按钮的 HUD', () => {
    const canvas = new UICanvas({
      renderMode: 'screenSpaceOverlay',
      scaler: {
        mode: 'scaleWithScreenSize',
        screenMatch: { referenceResolution: { width: 1920, height: 1080 }, matchWidthOrHeight: 0.5 },
      },
    });

    // 顶部水平布局:血条 + 计分。
    const topBar = new HorizontalLayoutGroup('topBar', {
      spacing: 20,
      padding: { left: 20, right: 20, top: 20, bottom: 0 },
      controlChildSize: false,
      childForceExpandWidth: false,
      childForceExpandHeight: false,
    });
    topBar.transform.setAnchorPreset('topStretch');
    topBar.transform.offsets = { left: 0, bottom: -60, right: 0, top: 0 };
    canvas.root.addChild(topBar);

    const healthBar = new UIImage('health');
    healthBar.transform.setSize(200, 20);
    healthBar.color = UIColors.red();
    topBar.addChild(healthBar);

    const scoreLabel = new UIText('score', 'Score: 0');
    scoreLabel.transform.setSize(150, 24);
    topBar.addChild(scoreLabel);

    // 底部按钮。
    const startBtn = new UIButton('start', 'Start');
    startBtn.transform.setSize(120, 40);
    startBtn.transform.setAnchorPreset('bottomCenter');
    startBtn.transform.offsets = { left: -60, bottom: 20, right: 60, top: 60 };
    canvas.root.addChild(startBtn);

    canvas.update({ width: 1920, height: 1080, pixelRatio: 1 });

    // 验证元素已布局。
    expect(topBar.worldRect.width).toBeGreaterThan(0);
    expect(healthBar.worldRect.width).toBeCloseTo(200);
    expect(scoreLabel.worldRect.width).toBeCloseTo(150);
    expect(startBtn.worldRect.width).toBeCloseTo(120);

    // 验证点击按钮可命中。
    const dispatcher = new UIInputDispatcher();
    dispatcher.attachToCanvas(canvas);
    const btnCenterY = 1080 - 40; // bottom=20 + height 40 中心
    const hit = dispatcher.processPointer(canvas, {
      type: 'down',
      x: 960, // 中心
      y: btnCenterY,
      button: 'left',
    });
    expect(hit).toBe(startBtn);
  });
});
