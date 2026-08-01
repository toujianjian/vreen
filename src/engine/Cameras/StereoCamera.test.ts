// StereoCamera 单元测试 (双目立体相机)。
//
// 覆盖:
//   1. 构造默认值 + 自定义配置
//   2. update — 左右眼位置偏移(瞳距)
//   3. update — 左右眼投影矩阵不同(非对称)
//   4. update — 左右眼朝向与主相机一致
//   5. convergence 影响投影偏移量
//   6. eyeSeparation 影响瞳距
//   7. computeStereoViewports — side-by-side / anaglyph
//   8. 非对称投影矩阵元素验证

import { describe, it, expect } from 'vitest';
import { StereoCamera, computeStereoViewports } from './StereoCamera';
import { PerspectiveCamera } from './PerspectiveCamera';

// ── 构造 ────────────────────────────────────────────────────────────

describe('StereoCamera construction', () => {
  it('defaults: eyeSep=0.064, convergence=10', () => {
    const s = new StereoCamera();
    expect(s.eyeSeparation).toBeCloseTo(0.064);
    expect(s.convergence).toBe(10);
    expect(s.stereoL).toBeInstanceOf(PerspectiveCamera);
    expect(s.stereoR).toBeInstanceOf(PerspectiveCamera);
  });

  it('accepts custom options', () => {
    const s = new StereoCamera({ eyeSeparation: 0.1, convergence: 5 });
    expect(s.eyeSeparation).toBeCloseTo(0.1);
    expect(s.convergence).toBe(5);
  });
});

// ── update:位置偏移 ─────────────────────────────────────────────────

describe('StereoCamera update positions', () => {
  it('left eye is offset to -X, right eye to +X (camera at origin, looking -Z)', () => {
    const main = new PerspectiveCamera(60, 1, 0.1, 100);
    main.position.set(0, 0, 0);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera({ eyeSeparation: 0.1, convergence: 10 });
    stereo.update(main);

    // 主相机在原点看向 -Z,本地 X = 世界 X
    // 左眼在 -X 方向,右眼在 +X 方向
    const eyeL = { x: stereo.stereoL.matrixWorld.elements[12], y: stereo.stereoL.matrixWorld.elements[13], z: stereo.stereoL.matrixWorld.elements[14] };
    const eyeR = { x: stereo.stereoR.matrixWorld.elements[12], y: stereo.stereoR.matrixWorld.elements[13], z: stereo.stereoR.matrixWorld.elements[14] };

    expect(eyeL.x).toBeCloseTo(-0.05, 5);
    expect(eyeR.x).toBeCloseTo(0.05, 5);
    expect(eyeL.z).toBeCloseTo(0);
    expect(eyeR.z).toBeCloseTo(0);
  });

  it('eye Y and Z match main camera', () => {
    const main = new PerspectiveCamera(60, 1, 0.1, 100);
    main.position.set(10, 20, 30);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera({ eyeSeparation: 0.064 });
    stereo.update(main);

    const eyeL = { y: stereo.stereoL.matrixWorld.elements[13], z: stereo.stereoL.matrixWorld.elements[14] };
    const eyeR = { y: stereo.stereoR.matrixWorld.elements[13], z: stereo.stereoR.matrixWorld.elements[14] };

    expect(eyeL.y).toBeCloseTo(20);
    expect(eyeL.z).toBeCloseTo(30);
    expect(eyeR.y).toBeCloseTo(20);
    expect(eyeR.z).toBeCloseTo(30);
  });

  it('larger eyeSeparation increases distance between eyes', () => {
    const main = new PerspectiveCamera(60, 1, 0.1, 100);
    main.updateMatrixWorld(true);

    const s1 = new StereoCamera({ eyeSeparation: 0.064 });
    s1.update(main);
    const eyeDist1 = Math.abs(s1.stereoL.matrixWorld.elements[12] - s1.stereoR.matrixWorld.elements[12]);

    const s2 = new StereoCamera({ eyeSeparation: 0.2 });
    s2.update(main);
    const eyeDist2 = Math.abs(s2.stereoL.matrixWorld.elements[12] - s2.stereoR.matrixWorld.elements[12]);

    expect(eyeDist2).toBeGreaterThan(eyeDist1);
  });
});

// ── update:投影矩阵 ────────────────────────────────────────────────

describe('StereoCamera update projections', () => {
  it('left and right projection matrices are different (asymmetric)', () => {
    const main = new PerspectiveCamera(60, 2, 0.1, 100);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera({ eyeSeparation: 0.1, convergence: 10 });
    stereo.update(main);

    // 左右投影矩阵应该不同(非对称偏移方向相反)
    const pL = stereo.stereoL.projectionMatrix.elements;
    const pR = stereo.stereoR.projectionMatrix.elements;

    // 元素 [8] (right+left)/(right-left) 应该不同
    expect(pL[8]).not.toBeCloseTo(pR[8], 6);
  });

  it('left projection shifts right, right projection shifts left', () => {
    const main = new PerspectiveCamera(60, 2, 0.1, 100);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera({ eyeSeparation: 0.1, convergence: 10 });
    stereo.update(main);

    // 元素 [8] = (right+left)/(right-left)
    // 左眼:right+left 偏正(frustum 向右移) → [8] > 0
    // 右眼:right+left 偏负(frustum 向左移) → [8] < 0
    const pL = stereo.stereoL.projectionMatrix.elements;
    const pR = stereo.stereoR.projectionMatrix.elements;

    expect(pL[8]).toBeGreaterThan(0);
    expect(pR[8]).toBeLessThan(0);
  });

  it('larger convergence reduces asymmetry (eyes converge less)', () => {
    const main = new PerspectiveCamera(60, 2, 0.1, 100);
    main.updateMatrixWorld(true);

    const sNear = new StereoCamera({ eyeSeparation: 0.1, convergence: 2 });
    sNear.update(main);
    const offsetNear = Math.abs(sNear.stereoL.projectionMatrix.elements[8]);

    const sFar = new StereoCamera({ eyeSeparation: 0.1, convergence: 100 });
    sFar.update(main);
    const offsetFar = Math.abs(sFar.stereoL.projectionMatrix.elements[8]);

    // convergence 越大 → eyeShift = eyeSep/2 * near/convergence 越小
    expect(offsetFar).toBeLessThan(offsetNear);
  });

  it('near/far/fov are synced from main camera', () => {
    const main = new PerspectiveCamera(45, 2, 0.5, 200);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera();
    stereo.update(main);

    expect(stereo.stereoL.fov).toBe(45);
    expect(stereo.stereoL.near).toBeCloseTo(0.5);
    expect(stereo.stereoL.far).toBe(200);
    expect(stereo.stereoR.fov).toBe(45);
  });

  it('aspect is halved (each eye renders half width)', () => {
    const main = new PerspectiveCamera(60, 2, 0.1, 100);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera();
    stereo.update(main);

    expect(stereo.stereoL.aspect).toBeCloseTo(1); // 2 * 0.5
    expect(stereo.stereoR.aspect).toBeCloseTo(1);
  });
});

// ── update:朝向 ────────────────────────────────────────────────────

describe('StereoCamera orientation', () => {
  it('left and right eyes look in the same direction as main camera', () => {
    const main = new PerspectiveCamera(60, 1, 0.1, 100);
    main.position.set(0, 0, 10);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera();
    stereo.update(main);

    // 旋转部分(3x3)应该相同
    const mMain = main.matrixWorld.elements;
    const mL = stereo.stereoL.matrixWorld.elements;
    const mR = stereo.stereoR.matrixWorld.elements;

    for (let i = 0; i < 12; i++) {
      if (i % 4 === 3) continue; // skip translation row
      expect(mL[i]).toBeCloseTo(mMain[i], 5);
      expect(mR[i]).toBeCloseTo(mMain[i], 5);
    }
  });
});

// ── computeStereoViewports ─────────────────────────────────────────

describe('computeStereoViewports', () => {
  it('sideBySide: splits canvas in half', () => {
    const vp = computeStereoViewports(1920, 1080, 'sideBySide');
    expect(vp.left.x).toBe(0);
    expect(vp.left.w).toBe(960);
    expect(vp.left.h).toBe(1080);
    expect(vp.right.x).toBe(960);
    expect(vp.right.w).toBe(960);
  });

  it('anaglyph: full canvas for both eyes', () => {
    const vp = computeStereoViewports(1920, 1080, 'anaglyph');
    expect(vp.left.w).toBe(1920);
    expect(vp.left.h).toBe(1080);
    expect(vp.right.w).toBe(1920);
    expect(vp.right.h).toBe(1080);
  });

  it('interlaced: full canvas for both eyes', () => {
    const vp = computeStereoViewports(1920, 1080, 'interlaced');
    expect(vp.left.w).toBe(1920);
    expect(vp.right.w).toBe(1920);
  });

  it('default mode is sideBySide', () => {
    const vp = computeStereoViewports(1000, 500);
    expect(vp.left.w).toBe(500);
    expect(vp.right.w).toBe(500);
  });
});

// ── 边界情况 ────────────────────────────────────────────────────────

describe('StereoCamera edge cases', () => {
  it('zero eye separation: both eyes at same position', () => {
    const main = new PerspectiveCamera(60, 1, 0.1, 100);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera({ eyeSeparation: 0, convergence: 10 });
    stereo.update(main);

    const xL = stereo.stereoL.matrixWorld.elements[12];
    const xR = stereo.stereoR.matrixWorld.elements[12];
    expect(xL).toBeCloseTo(xR, 6);
  });

  it('very large convergence: near-symmetric projection', () => {
    const main = new PerspectiveCamera(60, 2, 0.1, 100);
    main.updateMatrixWorld(true);

    const stereo = new StereoCamera({ eyeSeparation: 0.064, convergence: 10000 });
    stereo.update(main);

    // convergence 很大 → eyeShift 很小 → 投影近乎对称
    const pL = stereo.stereoL.projectionMatrix.elements;
    const pR = stereo.stereoR.projectionMatrix.elements;
    expect(pL[8]).toBeCloseTo(pR[8], 3); // [8] 应接近 0
  });
});
