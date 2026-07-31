// CascadedShadowMap 测试 — 级联阴影贴图。
//
// 验证:
//   • 级联分割(logarithmic / uniform / practical)
//   • 级联数量与 splitDepths
//   • update 后 viewProjection 非零
//   • 级联 near/far 递增
//   • stabilize texel snap
//   • getCascadeVPArray / getSplitDepths
//   • setLightDirection / setCascadeCount / setScheme / setLambda

import { describe, it, expect } from 'vitest';
import { CascadedShadowMap } from './CascadedShadowMap';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { Vector3, Box3 } from '../Math';

function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, 16 / 9, 0.1, 500);
  cam.position.set(0, 10, 20);
  cam.updateMatrixWorld(true);
  return cam;
}

describe('CascadedShadowMap — 构造', () => {
  it('默认 4 级联', () => {
    const csm = new CascadedShadowMap();
    expect(csm.cascadeCount).toBe(4);
    expect(csm.cascades.length).toBe(4);
  });

  it('自定义级联数量', () => {
    const csm = new CascadedShadowMap({ cascades: 2 });
    expect(csm.cascadeCount).toBe(2);
    expect(csm.cascades.length).toBe(2);
  });

  it('级联数量限制 1..8', () => {
    expect(new CascadedShadowMap({ cascades: 0 }).cascadeCount).toBe(1);
    expect(new CascadedShadowMap({ cascades: 16 }).cascadeCount).toBe(8);
  });

  it('默认分割方案 practical, λ=0.5', () => {
    const csm = new CascadedShadowMap();
    expect(csm.scheme).toBe('practical');
    expect(csm.lambda).toBe(0.5);
  });

  it('默认光源方向归一化', () => {
    const csm = new CascadedShadowMap({ lightDirection: new Vector3(-1, -2, -0.6) });
    const len = Math.hypot(csm.lightDirection.x, csm.lightDirection.y, csm.lightDirection.z);
    expect(len).toBeCloseTo(1, 5);
  });
});

describe('CascadedShadowMap — 分割', () => {
  it('logarithmic 分割:近处级更小', () => {
    const csm = new CascadedShadowMap({ cascades: 4, scheme: 'logarithmic', shadowDistance: 200 });
    csm.update(makeCamera());
    // 各级 far 递增
    for (let i = 1; i < csm.cascadeCount; i++) {
      expect(csm.cascades[i].far).toBeGreaterThan(csm.cascades[i - 1].far);
    }
    // 第一级 range < 最后一级 range(近处密集)
    const r0 = csm.cascades[0].far - csm.cascades[0].near;
    const r3 = csm.cascades[3].far - csm.cascades[3].near;
    expect(r0).toBeLessThan(r3);
  });

  it('uniform 分割:各级等距', () => {
    const csm = new CascadedShadowMap({ cascades: 4, scheme: 'uniform', shadowDistance: 200 });
    csm.update(makeCamera());
    const r0 = csm.cascades[0].far - csm.cascades[0].near;
    const r1 = csm.cascades[1].far - csm.cascades[1].near;
    const r2 = csm.cascades[2].far - csm.cascades[2].near;
    const r3 = csm.cascades[3].far - csm.cascades[3].near;
    expect(r0).toBeCloseTo(r1, 2);
    expect(r1).toBeCloseTo(r2, 2);
    expect(r2).toBeCloseTo(r3, 2);
  });

  it('practical 分割:λ=0 接近 logarithmic', () => {
    const csmLog = new CascadedShadowMap({ cascades: 4, scheme: 'logarithmic', shadowDistance: 200 });
    const csmPrac = new CascadedShadowMap({ cascades: 4, scheme: 'practical', lambda: 0, shadowDistance: 200 });
    csmLog.update(makeCamera());
    csmPrac.update(makeCamera());
    for (let i = 0; i < 4; i++) {
      expect(csmPrac.cascades[i].far).toBeCloseTo(csmLog.cascades[i].far, 3);
    }
  });

  it('practical 分割:λ=1 接近 uniform', () => {
    const csmUni = new CascadedShadowMap({ cascades: 4, scheme: 'uniform', shadowDistance: 200 });
    const csmPrac = new CascadedShadowMap({ cascades: 4, scheme: 'practical', lambda: 1, shadowDistance: 200 });
    csmUni.update(makeCamera());
    csmPrac.update(makeCamera());
    for (let i = 0; i < 4; i++) {
      expect(csmPrac.cascades[i].far).toBeCloseTo(csmUni.cascades[i].far, 3);
    }
  });

  it('splitDepths 递增', () => {
    const csm = new CascadedShadowMap({ cascades: 4, shadowDistance: 200 });
    csm.update(makeCamera());
    for (let i = 1; i < csm.cascadeCount; i++) {
      expect(csm.splitDepths[i]).toBeGreaterThan(csm.splitDepths[i - 1]);
    }
  });

  it('最后一级 far = min(camera.far, shadowDistance)', () => {
    const csm = new CascadedShadowMap({ cascades: 3, shadowDistance: 100 });
    const cam = makeCamera(); // far=500
    csm.update(cam);
    expect(csm.cascades[2].far).toBeCloseTo(100, 2);
  });
});

describe('CascadedShadowMap — update', () => {
  it('update 后 viewProjection 非零', () => {
    const csm = new CascadedShadowMap({ cascades: 2 });
    csm.update(makeCamera());
    for (const c of csm.cascades) {
      const e = c.viewProjection.elements;
      const sum = e.reduce((a, b) => a + Math.abs(b), 0);
      expect(sum).toBeGreaterThan(0);
    }
  });

  it('不同光源方向产生不同 VP', () => {
    const cam = makeCamera();
    const csm1 = new CascadedShadowMap({ cascades: 1, lightDirection: new Vector3(-1, -1, 0) });
    const csm2 = new CascadedShadowMap({ cascades: 1, lightDirection: new Vector3(1, -1, 0) });
    csm1.update(cam);
    csm2.update(cam);
    const e1 = csm1.cascades[0].viewProjection.elements;
    const e2 = csm2.cascades[0].viewProjection.elements;
    let diff = 0;
    for (let i = 0; i < 16; i++) diff += Math.abs(e1[i] - e2[i]);
    expect(diff).toBeGreaterThan(0.001);
  });

  it('sceneBounds 扩展 Z 范围', () => {
    const cam = makeCamera();
    const csm = new CascadedShadowMap({ cascades: 1, shadowDistance: 50 });
    const bounds = new Box3();
    bounds.min.set(-100, -100, -100);
    bounds.max.set(100, 100, 100);
    csm.update(cam);
    const vp1 = csm.cascades[0].viewProjection.elements.slice();
    csm.update(cam, bounds);
    const vp2 = csm.cascades[0].viewProjection.elements;
    // 扩展 bounds 后 VP 应该变化(更大覆盖范围)
    let diff = 0;
    for (let i = 0; i < 16; i++) diff += Math.abs(vp1[i] - vp2[i]);
    expect(diff).toBeGreaterThan(0.001);
  });

  it('near/far 连续(前级 far = 后级 near)', () => {
    const csm = new CascadedShadowMap({ cascades: 4, shadowDistance: 200 });
    csm.update(makeCamera());
    for (let i = 1; i < csm.cascadeCount; i++) {
      expect(csm.cascades[i].near).toBeCloseTo(csm.cascades[i - 1].far, 5);
    }
  });

  it('第一级 near = camera.near', () => {
    const csm = new CascadedShadowMap({ cascades: 3, shadowDistance: 200 });
    const cam = makeCamera();
    csm.update(cam);
    expect(csm.cascades[0].near).toBeCloseTo(cam.near, 5);
  });
});

describe('CascadedShadowMap — stabilize', () => {
  it('stabilize=true texelSize > 0', () => {
    const csm = new CascadedShadowMap({ cascades: 2, stabilize: true });
    csm.update(makeCamera());
    for (const c of csm.cascades) {
      expect(c.texelSize).toBeGreaterThan(0);
    }
  });

  it('stabilize=false texelSize > 0', () => {
    const csm = new CascadedShadowMap({ cascades: 2, stabilize: false });
    csm.update(makeCamera());
    for (const c of csm.cascades) {
      expect(c.texelSize).toBeGreaterThan(0);
    }
  });

  it('stabilize 后微小相机移动不改变 VP(snap)', () => {
    const csm = new CascadedShadowMap({ cascades: 1, stabilize: true, resolution: 1024 });
    const cam1 = makeCamera();
    cam1.position.set(0, 10, 20);
    cam1.updateMatrixWorld(true);
    csm.update(cam1);
    const vp1 = csm.cascades[0].viewProjection.elements.slice();

    // 微小移动(小于 1 texel)
    const cam2 = makeCamera();
    cam2.position.set(0.001, 10, 20);
    cam2.updateMatrixWorld(true);
    csm.update(cam2);
    const vp2 = csm.cascades[0].viewProjection.elements;

    // 由于 texel snap,微小移动不应改变 VP
    let diff = 0;
    for (let i = 0; i < 16; i++) diff += Math.abs(vp1[i] - vp2[i]);
    expect(diff).toBeLessThan(0.01);
  });
});

describe('CascadedShadowMap — 数组输出', () => {
  it('getCascadeVPArray 长度 = cascadeCount * 16', () => {
    const csm = new CascadedShadowMap({ cascades: 3 });
    csm.update(makeCamera());
    const arr = csm.getCascadeVPArray();
    expect(arr.length).toBe(3 * 16);
  });

  it('getCascadeVPArray 非零', () => {
    const csm = new CascadedShadowMap({ cascades: 2 });
    csm.update(makeCamera());
    const arr = csm.getCascadeVPArray();
    const sum = arr.reduce((a, b) => a + Math.abs(b), 0);
    expect(sum).toBeGreaterThan(0);
  });

  it('getSplitDepths 返回副本', () => {
    const csm = new CascadedShadowMap({ cascades: 4 });
    csm.update(makeCamera());
    const d1 = csm.getSplitDepths();
    const d2 = csm.getSplitDepths();
    expect(d1).not.toBe(d2);
    expect(d1.length).toBe(4);
  });
});

describe('CascadedShadowMap — setter', () => {
  it('setLightDirection 归一化', () => {
    const csm = new CascadedShadowMap();
    csm.setLightDirection(new Vector3(3, 4, 0));
    const len = Math.hypot(csm.lightDirection.x, csm.lightDirection.y, csm.lightDirection.z);
    expect(len).toBeCloseTo(1, 5);
  });

  it('setCascadeCount 重建级联', () => {
    const csm = new CascadedShadowMap({ cascades: 4 });
    csm.setCascadeCount(2);
    expect(csm.cascadeCount).toBe(2);
    expect(csm.cascades.length).toBe(2);
    expect(csm.splitDepths.length).toBe(2);
  });

  it('setScheme 更新分割', () => {
    const csm = new CascadedShadowMap({ cascades: 4, scheme: 'logarithmic' });
    csm.setScheme('uniform');
    expect(csm.scheme).toBe('uniform');
  });

  it('setLambda 限制 0..1', () => {
    const csm = new CascadedShadowMap({ scheme: 'practical' });
    csm.setLambda(-1);
    expect(csm.lambda).toBe(0);
    csm.setLambda(2);
    expect(csm.lambda).toBe(1);
  });
});
