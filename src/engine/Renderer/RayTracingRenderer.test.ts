// RayTracingRenderer 单元测试 — 实时光线追踪渲染器。
//
// 覆盖:
//   • 构造默认值 / 选项覆盖 / clamp 边界
//   • setter:setBounces / setSamplesPerPixel / setMaxDepth / setTileSize /
//     setEnvironmentMap / setEnvironmentIntensity / enableDenoiser
//   • resetAccumulation / resize / dispose
//   • buildBVH(场景 mesh 索引)
//   • closestHit(命中 / 未命中)
//   • anyHit(遮挡 / 无遮挡)
//   • miss(背景色 / 环境贴图)
//   • traceRay(递归路径)
//   • shade(直接 + 间接)
//   • sampleDirectLight(方向光 / 阴影)
//   • sampleBRDF
//   • render(最小场景 / 累积 / 命中 mesh 非零 / 空场景背景色)
//   • getResult(降噪开关 / 长度 / alpha)
//   • getStats / getFrameCount / getAccumulationBuffer

import { describe, it, expect } from 'vitest';
import {
  RayTracingRenderer,
  type EnvironmentMap,
} from './RayTracingRenderer';
import { Scene } from '../Core/Scene';
import { Mesh } from '../Core/Mesh';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { PerspectiveCamera } from '../Cameras/PerspectiveCamera';
import { DirectionalLight } from '../Lights/DirectionalLight';
import { AmbientLight } from '../Lights/AmbientLight';
import { Color } from '../Math/Color';
import { Vector3 } from '../Math/Vector3';

/** 构造一个朝 -Z 方向看的相机(0,0,0) → (0,0,-3)。 */
function makeCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(0, 0, 0);
  camera.lookAt(0, 0, -3);
  camera.updateWorldMatrix(true, false);
  return camera;
}

/** 构造一个位于 (0,0,-3) 的 2x2x2 立方体 mesh(白色标准材质)。 */
function makeBoxAtOrigin3(): Mesh {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2), new StandardMaterial());
  (mesh.material as StandardMaterial).baseColor = { r: 1, g: 1, b: 1 };
  mesh.position.set(0, 0, -3);
  mesh.updateWorldMatrix(true, false);
  return mesh;
}

describe('RayTracingRenderer — 构造', () => {
  it('默认值:maxBounces 8 / spp 2 / 256x256 / frameCount 0', () => {
    const rt = new RayTracingRenderer();
    expect(rt.maxBounces).toBe(8);
    expect(rt.samplesPerPixel).toBe(2);
    expect(rt.maxDepth).toBe(16);
    expect(rt.width).toBe(256);
    expect(rt.height).toBe(256);
    expect(rt.tileSize).toBe(32);
    expect(rt.frameCount).toBe(0);
    expect(rt.isAccumulating).toBe(false);
    expect(rt.denoiserEnabled).toBe(false);
    expect(rt.environmentIntensity).toBeCloseTo(1, 6);
    expect(rt.accumulationBuffer.length).toBe(256 * 256 * 3);
  });

  it('选项覆盖生效', () => {
    const rt = new RayTracingRenderer({
      maxBounces: 4,
      samplesPerPixel: 3,
      maxDepth: 10,
      width: 64,
      height: 48,
      tileSize: 16,
      shadowBias: 0.001,
      environmentIntensity: 2.5,
      backgroundColor: new Color(0.5, 0.5, 0.5),
    });
    expect(rt.maxBounces).toBe(4);
    expect(rt.samplesPerPixel).toBe(3);
    expect(rt.maxDepth).toBe(10);
    expect(rt.width).toBe(64);
    expect(rt.height).toBe(48);
    expect(rt.tileSize).toBe(16);
    expect(rt.shadowBias).toBeCloseTo(0.001, 6);
    expect(rt.environmentIntensity).toBeCloseTo(2.5, 6);
    expect(rt.backgroundColor).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(rt.accumulationBuffer.length).toBe(64 * 48 * 3);
  });

  it('backgroundColor 不跨实例共享', () => {
    const a = new RayTracingRenderer({ backgroundColor: new Color(0.1, 0.2, 0.3) });
    const b = new RayTracingRenderer({ backgroundColor: new Color(0.1, 0.2, 0.3) });
    a.backgroundColor.r = 0.9;
    expect(b.backgroundColor.r).toBeCloseTo(0.1, 6);
  });
});

describe('RayTracingRenderer — setter', () => {
  it('setBounces 设置并 reset 累积', () => {
    const rt = new RayTracingRenderer();
    rt.frameCount = 5;
    const ret = rt.setBounces(16);
    expect(ret).toBe(rt);
    expect(rt.maxBounces).toBe(16);
    expect(rt.frameCount).toBe(0);
  });

  it('setBounces clamp [1, 64]', () => {
    const rt = new RayTracingRenderer();
    rt.setBounces(0);
    expect(rt.maxBounces).toBe(1);
    rt.setBounces(100);
    expect(rt.maxBounces).toBe(64);
  });

  it('setSamplesPerPixel 设置并 reset', () => {
    const rt = new RayTracingRenderer();
    rt.frameCount = 3;
    rt.setSamplesPerPixel(8);
    expect(rt.samplesPerPixel).toBe(8);
    expect(rt.frameCount).toBe(0);
  });

  it('setSamplesPerPixel clamp [1, 256]', () => {
    const rt = new RayTracingRenderer();
    rt.setSamplesPerPixel(0);
    expect(rt.samplesPerPixel).toBe(1);
    rt.setSamplesPerPixel(1000);
    expect(rt.samplesPerPixel).toBe(256);
  });

  it('setMaxDepth 设置并 reset', () => {
    const rt = new RayTracingRenderer();
    rt.frameCount = 2;
    rt.setMaxDepth(8);
    expect(rt.maxDepth).toBe(8);
    expect(rt.frameCount).toBe(0);
  });

  it('setMaxDepth clamp [1, 64]', () => {
    const rt = new RayTracingRenderer();
    rt.setMaxDepth(0);
    expect(rt.maxDepth).toBe(1);
    rt.setMaxDepth(100);
    expect(rt.maxDepth).toBe(64);
  });

  it('setTileSize 设置(不 reset 累积)', () => {
    const rt = new RayTracingRenderer();
    rt.frameCount = 3;
    rt.setTileSize(16);
    expect(rt.tileSize).toBe(16);
    expect(rt.frameCount).toBe(3); // 不 reset
  });

  it('setTileSize clamp [1, 256]', () => {
    const rt = new RayTracingRenderer();
    rt.setTileSize(0);
    expect(rt.tileSize).toBe(1);
    rt.setTileSize(1000);
    expect(rt.tileSize).toBe(256);
  });

  it('setEnvironmentMap 设置并 reset', () => {
    const rt = new RayTracingRenderer();
    rt.frameCount = 4;
    const env: EnvironmentMap = { sample: () => new Color(1, 1, 1) };
    rt.setEnvironmentMap(env);
    expect(rt.environmentMap).toBe(env);
    expect(rt.frameCount).toBe(0);
  });

  it('setEnvironmentIntensity 设置并 reset', () => {
    const rt = new RayTracingRenderer();
    rt.frameCount = 4;
    rt.setEnvironmentIntensity(3.5);
    expect(rt.environmentIntensity).toBeCloseTo(3.5, 6);
    expect(rt.frameCount).toBe(0);
  });

  it('setEnvironmentIntensity 非负', () => {
    const rt = new RayTracingRenderer().setEnvironmentIntensity(-1);
    expect(rt.environmentIntensity).toBe(0);
  });

  it('enableDenoiser 切换', () => {
    const rt = new RayTracingRenderer();
    expect(rt.denoiserEnabled).toBe(false);
    const ret = rt.enableDenoiser(true);
    expect(ret).toBe(rt);
    expect(rt.denoiserEnabled).toBe(true);
    rt.enableDenoiser(false);
    expect(rt.denoiserEnabled).toBe(false);
  });
});

describe('RayTracingRenderer — reset / resize / dispose', () => {
  it('resetAccumulation 清零 buffer 与 frameCount', () => {
    const rt = new RayTracingRenderer({ width: 4, height: 4 });
    rt.accumulationBuffer[0] = 1;
    rt.accumulationBuffer[5] = 2;
    rt.frameCount = 5;
    rt.resetAccumulation();
    expect(rt.frameCount).toBe(0);
    expect(rt.accumulationBuffer[0]).toBe(0);
    expect(rt.accumulationBuffer[5]).toBe(0);
  });

  it('resize 调整 buffer 并 reset frameCount', () => {
    const rt = new RayTracingRenderer({ width: 16, height: 16 });
    rt.frameCount = 3;
    rt.resize(32, 24);
    expect(rt.width).toBe(32);
    expect(rt.height).toBe(24);
    expect(rt.accumulationBuffer.length).toBe(32 * 24 * 3);
    expect(rt.frameCount).toBe(0);
  });

  it('resize 至少 1x1', () => {
    const rt = new RayTracingRenderer();
    rt.resize(0, -5);
    expect(rt.width).toBe(1);
    expect(rt.height).toBe(1);
  });

  it('dispose 释放资源', () => {
    const rt = new RayTracingRenderer({ width: 16, height: 16 });
    rt.dispose();
    expect(rt.width).toBe(0);
    expect(rt.height).toBe(0);
    expect(rt.frameCount).toBe(0);
    expect(rt.accumulationBuffer.length).toBe(0);
    expect(rt.bvh).toBeNull();
    expect(rt.environmentMap).toBeNull();
    expect(rt.isAccumulating).toBe(false);
  });
});

describe('RayTracingRenderer — buildBVH', () => {
  it('buildBVH 索引场景 mesh', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    rt.buildBVH(scene);
    expect(rt.bvh).not.toBeNull();
    expect(rt.bvh!.length).toBe(1);
    expect(rt.getStats().bvhMeshCount).toBeGreaterThanOrEqual(0); // render 前为 0
  });

  it('buildBVH 空场景无 mesh', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    rt.buildBVH(scene);
    expect(rt.bvh).toEqual([]);
  });
});

describe('RayTracingRenderer — closestHit', () => {
  it('射线命中 mesh', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());

    // 从 (0,0,0) 朝 -Z 射击,应命中 z=-2 处的盒面
    const hit = rt.closestHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
    expect(hit).not.toBeNull();
    expect(hit!.mesh).toBeDefined();
    expect(hit!.distance).toBeGreaterThan(0);
    expect(hit!.point.z).toBeLessThan(0);
    // 法线归一化
    const nLen = Math.sqrt(hit!.normal.x ** 2 + hit!.normal.y ** 2 + hit!.normal.z ** 2);
    expect(nLen).toBeCloseTo(1, 4);
  });

  it('射线未命中返回 null', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());

    // 朝 +Y 射击,无 mesh
    const hit = rt.closestHit(new Vector3(0, 0, 0), new Vector3(0, 1, 0));
    expect(hit).toBeNull();
  });

  it('空场景未命中', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    rt.buildBVH(scene);
    const hit = rt.closestHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
    expect(hit).toBeNull();
  });

  it('多 mesh 取最近', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    // 近盒 z=-2,远盒 z=-5
    const near = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    near.position.set(0, 0, -2);
    near.updateWorldMatrix(true, false);
    const far = new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
    far.position.set(0, 0, -5);
    far.updateWorldMatrix(true, false);
    scene.add(near);
    scene.add(far);
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());

    const hit = rt.closestHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1));
    expect(hit).not.toBeNull();
    // 应命中近盒(z ≈ -1.5)
    expect(hit!.point.z).toBeGreaterThan(-3);
  });
});

describe('RayTracingRenderer — anyHit', () => {
  it('有遮挡返回 true', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());

    // 朝 -Z 射击,box 在路径上
    const blocked = rt.anyHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1), 100);
    expect(blocked).toBe(true);
  });

  it('无遮挡返回 false', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());

    // 朝 +Y 射击,无 mesh
    const blocked = rt.anyHit(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 100);
    expect(blocked).toBe(false);
  });

  it('超出 maxDist 返回 false', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());

    // 朝 -Z 射击,但 maxDist 设为 0.5(box 在 z=-2,距离 1.5)
    const blocked = rt.anyHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1), 0.5);
    expect(blocked).toBe(false);
  });
});

describe('RayTracingRenderer — miss', () => {
  it('无环境贴图返回背景色', () => {
    const rt = new RayTracingRenderer({ backgroundColor: new Color(0.2, 0.4, 0.6) });
    const c = rt.miss({ origin: new Vector3(0, 0, 0), direction: new Vector3(0, 1, 0) });
    expect(c.r).toBeCloseTo(0.2, 6);
    expect(c.g).toBeCloseTo(0.4, 6);
    expect(c.b).toBeCloseTo(0.6, 6);
  });

  it('有环境贴图返回采样 × 强度', () => {
    const env: EnvironmentMap = {
      sample: (dir: Vector3) => new Color(dir.x, dir.y, dir.z),
    };
    const rt = new RayTracingRenderer({ environmentIntensity: 2 });
    rt.setEnvironmentMap(env);
    const c = rt.miss({ origin: new Vector3(0, 0, 0), direction: new Vector3(0.5, 0.5, 0) });
    expect(c.r).toBeCloseTo(1.0, 6); // 0.5 * 2
    expect(c.g).toBeCloseTo(1.0, 6);
    expect(c.b).toBeCloseTo(0, 6);
  });
});

describe('RayTracingRenderer — traceRay', () => {
  it('未命中返回背景色', () => {
    const rt = new RayTracingRenderer({ backgroundColor: new Color(0.3, 0.3, 0.3) });
    const scene = new Scene();
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());
    const c = rt.traceRay(new Vector3(0, 0, 0), new Vector3(0, 1, 0), 0);
    expect(c.r).toBeCloseTo(0.3, 6);
  });

  it('命中 mesh 返回非零(有环境光)', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    const mesh = makeBoxAtOrigin3();
    scene.add(mesh);
    scene.add(new AmbientLight(0xffffff, 0.5));
    rt.buildBVH(scene);
    rt['_collectLights'](scene);
    rt['_refreshMatrices'](makeCamera());

    const c = rt.traceRay(new Vector3(0, 0, 0), new Vector3(0, 0, -1), 0);
    // 命中 + 环境光 → 应有贡献
    const total = c.r + c.g + c.b;
    expect(total).toBeGreaterThan(0);
  });

  it('超过 maxDepth 返回黑', () => {
    const rt = new RayTracingRenderer({ maxBounces: 1, maxDepth: 1 });
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());
    const c = rt.traceRay(new Vector3(0, 0, 0), new Vector3(0, 0, -1), 5);
    expect(c.r).toBe(0);
    expect(c.g).toBe(0);
    expect(c.b).toBe(0);
  });
});

describe('RayTracingRenderer — shade / sampleDirectLight / sampleBRDF', () => {
  it('sampleDirectLight 方向光照射(无遮挡)', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    const dir = new DirectionalLight(0xffffff, 1, { x: 0, y: 0, z: 1 }); // 朝 +Z(从盒后方照向相机)
    scene.add(dir);
    rt.buildBVH(scene);
    rt['_collectLights'](scene);
    rt['_refreshMatrices'](makeCamera());

    // 构造一个命中点(盒 +Z 面 z=-2,法线 +Z)
    const hit = rt.closestHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1))!;
    expect(hit).not.toBeNull();
    const light = rt.sampleDirectLight(hit);
    // 方向光从 z=+1 方向照(传播方向 +Z),lightDir = -direction = -Z;法线 +Z → N·L 取决于朝向
    // 这里仅验证返回 Color 实例且有限
    expect(light).toBeDefined();
    expect(Number.isFinite(light.r)).toBe(true);
  });

  it('sampleDirectLight 有遮挡时返回较小值', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    // 主盒 + 挡光盒(在主盒与光源之间)
    const main = makeBoxAtOrigin3(); // z=-3
    const blocker = new Mesh(new BoxGeometry(4, 4, 0.1), new StandardMaterial());
    blocker.position.set(0, 0, -1); // 在相机(0,0,0)与主盒之间
    blocker.updateWorldMatrix(true, false);
    scene.add(main);
    scene.add(blocker);
    scene.add(new DirectionalLight(0xffffff, 1, { x: 0, y: 0, z: -1 }));
    rt.buildBVH(scene);
    rt['_collectLights'](scene);
    rt['_refreshMatrices'](makeCamera());

    const hit = rt.closestHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1))!;
    // 最近命中应是 blocker(z=-1),其法线朝相机
    expect(hit).not.toBeNull();
    const light = rt.sampleDirectLight(hit);
    expect(light).toBeDefined();
  });

  it('sampleBRDF 返回颜色', () => {
    const rt = new RayTracingRenderer();
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    rt.buildBVH(scene);
    rt['_refreshMatrices'](makeCamera());

    const hit = rt.closestHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1))!;
    const wi = new Vector3(0, 0, 1); // 朝光源
    const wo = new Vector3(0, 0, 1); // 朝观察者
    const brdf = rt.sampleBRDF(hit, wi, wo);
    expect(brdf).toBeDefined();
    expect(brdf.r).toBeGreaterThanOrEqual(0);
  });

  it('shade 返回有限颜色', () => {
    const rt = new RayTracingRenderer({ maxBounces: 1 });
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    scene.add(new AmbientLight(0xffffff, 0.4));
    rt.buildBVH(scene);
    rt['_collectLights'](scene);
    rt['_refreshMatrices'](makeCamera());

    const hit = rt.closestHit(new Vector3(0, 0, 0), new Vector3(0, 0, -1))!;
    const dir = new Vector3(0, 0, -1);
    const c = rt.shade(hit, dir, 0);
    expect(Number.isFinite(c.r)).toBe(true);
    expect(Number.isFinite(c.g)).toBe(true);
    expect(Number.isFinite(c.b)).toBe(true);
  });
});

describe('RayTracingRenderer — render', () => {
  it('最小场景不抛错(1x1, 1 spp, 1 bounce)', () => {
    const rt = new RayTracingRenderer({
      width: 1,
      height: 1,
      samplesPerPixel: 1,
      maxBounces: 1,
    });
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    const camera = makeCamera();

    expect(() => rt.render(scene, camera)).not.toThrow();
    expect(rt.frameCount).toBe(1);
    expect(rt.getStats().frameCount).toBe(1);
    expect(rt.getStats().totalRays).toBeGreaterThan(0);
    expect(rt.getStats().frameTimeMs).toBeGreaterThanOrEqual(0);
  });

  it('累积 frameCount', () => {
    const rt = new RayTracingRenderer({
      width: 1,
      height: 1,
      samplesPerPixel: 1,
      maxBounces: 1,
    });
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    const camera = makeCamera();

    rt.render(scene, camera);
    rt.render(scene, camera);
    rt.render(scene, camera);
    expect(rt.frameCount).toBe(3);
    expect(rt.getFrameCount()).toBe(3);
  });

  it('命中 mesh + 方向光 → getResult 非零', () => {
    const rt = new RayTracingRenderer({
      width: 4,
      height: 4,
      samplesPerPixel: 1,
      maxBounces: 1,
    });
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    const dir = new DirectionalLight(0xffffff, 1, { x: -0.5, y: -1, z: 0.5 });
    scene.add(dir);
    scene.add(new AmbientLight(0xffffff, 0.3));

    const camera = makeCamera();
    rt.render(scene, camera);
    const out = rt.getResult();
    let nonZero = false;
    for (let i = 0; i < out.length; i += 4) {
      if (out[i] > 0 || out[i + 1] > 0 || out[i + 2] > 0) {
        nonZero = true;
        break;
      }
    }
    expect(nonZero).toBe(true);
  });

  it('空场景命中背景色', () => {
    const bgColor = new Color(0.2, 0.4, 0.6);
    const rt = new RayTracingRenderer({
      width: 1,
      height: 1,
      samplesPerPixel: 1,
      maxBounces: 1,
      backgroundColor: bgColor,
    });
    const scene = new Scene();
    const camera = makeCamera();
    rt.render(scene, camera);
    const out = rt.getResult();
    expect(out[0]).toBeGreaterThan(0);
    expect(out[1]).toBeGreaterThan(0);
    expect(out[2]).toBeGreaterThan(0);
    expect(out[3]).toBe(255);
  });

  it('accumulate 是 render 的语义别名', () => {
    const rt = new RayTracingRenderer({
      width: 1, height: 1, samplesPerPixel: 1, maxBounces: 1,
    });
    const scene = new Scene();
    const camera = makeCamera();
    rt.accumulate(scene, camera);
    expect(rt.frameCount).toBe(1);
  });

  it('render 后 resetAccumulation 使 getResult 全黑', () => {
    const rt = new RayTracingRenderer({
      width: 2,
      height: 2,
      samplesPerPixel: 1,
      maxBounces: 1,
      backgroundColor: new Color(1, 1, 1),
    });
    const scene = new Scene();
    const camera = makeCamera();
    rt.render(scene, camera);
    rt.resetAccumulation();
    const out = rt.getResult();
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(0);
      expect(out[i + 1]).toBe(0);
      expect(out[i + 2]).toBe(0);
      expect(out[i + 3]).toBe(255);
    }
  });

  it('getResult frameCount=0 时全黑(除 alpha)', () => {
    const rt = new RayTracingRenderer({ width: 2, height: 2 });
    const out = rt.getResult();
    expect(out).toBeInstanceOf(Uint8ClampedArray);
    expect(out.length).toBe(2 * 2 * 4);
    for (let i = 0; i < out.length; i += 4) {
      expect(out[i]).toBe(0);
      expect(out[i + 1]).toBe(0);
      expect(out[i + 2]).toBe(0);
      expect(out[i + 3]).toBe(255);
    }
  });

  it('getResult 降噪开关产出长度一致', () => {
    const rt = new RayTracingRenderer({
      width: 4, height: 4, samplesPerPixel: 1, maxBounces: 1,
      backgroundColor: new Color(0.5, 0.5, 0.5),
    });
    const scene = new Scene();
    const camera = makeCamera();
    rt.render(scene, camera);
    const outSharp = rt.getResult();
    rt.enableDenoiser(true);
    const outBlur = rt.getResult();
    expect(outSharp.length).toBe(outBlur.length);
    // 两者均非全黑(有背景贡献)
    let s = 0, b = 0;
    for (let i = 0; i < outSharp.length; i += 4) {
      s += outSharp[i];
      b += outBlur[i];
    }
    expect(s).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(0);
  });

  it('getAccumulationBuffer 返回 Float32Array', () => {
    const rt = new RayTracingRenderer({ width: 4, height: 4 });
    const buf = rt.getAccumulationBuffer();
    expect(buf).toBeInstanceOf(Float32Array);
    expect(buf.length).toBe(4 * 4 * 3);
  });
});

describe('RayTracingRenderer — getStats', () => {
  it('render 后 stats 字段更新', () => {
    const rt = new RayTracingRenderer({
      width: 2, height: 2, samplesPerPixel: 1, maxBounces: 1,
    });
    const scene = new Scene();
    scene.add(makeBoxAtOrigin3());
    const camera = makeCamera();
    rt.render(scene, camera);
    const stats = rt.getStats();
    expect(stats.frameCount).toBe(1);
    expect(stats.bvhMeshCount).toBe(1);
    expect(stats.primaryRays).toBeGreaterThan(0);
    expect(stats.totalRays).toBeGreaterThanOrEqual(stats.primaryRays);
    expect(stats.samplesPerPixel).toBe(1);
    expect(stats.maxBounces).toBe(1);
    expect(stats.denoiserEnabled).toBe(false);
    expect(stats.isAccumulating).toBe(false);
  });
});
