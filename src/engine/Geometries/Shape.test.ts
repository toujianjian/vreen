import { describe, it, expect } from 'vitest';
import { Shape } from './Shape';
import { Vector2 } from '../Math';

describe('Shape', () => {
  it('moveTo + lineTo 生成直线段', () => {
    const s = new Shape();
    s.moveTo(0, 0);
    s.lineTo(1, 0);
    s.lineTo(1, 1);
    s.lineTo(0, 1);
    s.lineTo(0, 0);
    const pts = s.getPoints(1);
    // 4 条直线段,每段 2 个点(起点 + 终点),去重相邻后应有 5 个点
    expect(pts.length).toBe(5);
    expect(pts[0].x).toBe(0);
    expect(pts[0].y).toBe(0);
    expect(pts[4].x).toBe(0);
    expect(pts[4].y).toBe(0);
  });

  it('从 Vector2[] 初始化', () => {
    const s = new Shape([
      new Vector2(0, 0),
      new Vector2(1, 0),
      new Vector2(1, 1),
    ]);
    expect(s.currentPoint.x).toBe(1);
    expect(s.currentPoint.y).toBe(1);
    expect(s.curves.length).toBe(2);
  });

  it('quadraticCurveTo 生成二次贝塞尔曲线', () => {
    const s = new Shape();
    s.moveTo(0, 0);
    s.quadraticCurveTo(0.5, 1, 1, 0);
    const pts = s.getPoints(10);
    // 二次贝塞尔:1 段,divisions=10 → 11 个采样点(起点 + 10 个)
    expect(pts.length).toBe(11);
    // 起点为 (0,0)
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[0].y).toBeCloseTo(0, 5);
    // 终点为 (1,0)
    expect(pts[10].x).toBeCloseTo(1, 5);
    expect(pts[10].y).toBeCloseTo(0, 5);
    // 中点应为 (0.5, 0.5)(t=0.5 时的二次贝塞尔)
    expect(pts[5].x).toBeCloseTo(0.5, 5);
    expect(pts[5].y).toBeCloseTo(0.5, 5);
  });

  it('bezierCurveTo 生成三次贝塞尔曲线', () => {
    const s = new Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0, 1, 1, 1, 1, 0);
    const pts = s.getPoints(10);
    expect(pts.length).toBe(11);
    // 起点为 (0,0),终点为 (1,0)
    expect(pts[0].x).toBeCloseTo(0, 5);
    expect(pts[0].y).toBeCloseTo(0, 5);
    expect(pts[10].x).toBeCloseTo(1, 5);
    expect(pts[10].y).toBeCloseTo(0, 5);
    // 中点(t=0.5):B(0.5) = 0.125*P0 + 0.375*P1 + 0.375*P2 + 0.125*P3
    // = 0.125*0 + 0.375*0 + 0.375*1 + 0.125*1 = 0.5 (x)
    // = 0.125*0 + 0.375*1 + 0.375*1 + 0.125*0 = 0.75 (y)
    expect(pts[5].x).toBeCloseTo(0.5, 5);
    expect(pts[5].y).toBeCloseTo(0.75, 5);
  });

  it('absarc 生成圆弧', () => {
    const s = new Shape();
    s.absarc(0, 0, 1, 0, Math.PI / 2, false);
    const pts = s.getPoints(8);
    // 圆弧:divisions * 2 = 16 段(ellipse 用 2 倍 divisions)
    // 但实际是 1 段曲线,采样数为 16+1 = 17
    expect(pts.length).toBe(17);
    // 起点 (1, 0)
    expect(pts[0].x).toBeCloseTo(1, 5);
    expect(pts[0].y).toBeCloseTo(0, 5);
    // 终点 (cos(π/2), sin(π/2)) = (0, 1)
    expect(pts[16].x).toBeCloseTo(0, 5);
    expect(pts[16].y).toBeCloseTo(1, 5);
  });

  it('closePath 自动闭合', () => {
    const s = new Shape();
    s.moveTo(0, 0);
    s.lineTo(1, 0);
    s.lineTo(1, 1);
    s.closePath(); // 应自动补一条到 (0,0) 的直线
    const pts = s.getPoints(1);
    // 3 段直线:2 段显式 + 1 段闭合
    // 每段 2 个点,去重相邻 → 4 个点(包含末尾回到起点的点)
    expect(pts.length).toBe(4);
    expect(pts[3].x).toBeCloseTo(0, 5);
    expect(pts[3].y).toBeCloseTo(0, 5);
  });

  it('addHole + extractPoints 同时返回轮廓与孔洞', () => {
    const outer = new Shape();
    outer.moveTo(-1, -1);
    outer.lineTo(1, -1);
    outer.lineTo(1, 1);
    outer.lineTo(-1, 1);
    outer.lineTo(-1, -1);

    const hole = new Shape();
    hole.moveTo(-0.5, -0.5);
    hole.lineTo(0.5, -0.5);
    hole.lineTo(0.5, 0.5);
    hole.lineTo(-0.5, 0.5);
    hole.lineTo(-0.5, -0.5);

    outer.addHole(hole);

    const extracted = outer.extractPoints(1);
    expect(extracted.shape.length).toBe(5);
    expect(extracted.holes.length).toBe(1);
    expect(extracted.holes[0].length).toBe(5);
  });
});
