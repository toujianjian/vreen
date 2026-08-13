// CubeCamera 单元测试 — 6 面方向 / 投影 / 位置同步 / update 流程。
//
// 覆盖维度:
//   1. 构造(默认/自定义参数、6 面 PerspectiveCamera、renderTarget)
//   2. near/far 同步
//   3. setResolution
//   4. 位置同步(CubeCamera 移动 → 6 面相机跟随)
//   5. 方向(每面 getWorldDirection 匹配 dir,含 ±Y 的非 (0,1,0) up)
//   6. updateCameras 手动调用
//   7. update(renderer, scene) 流程
//   8. Object3D 集成(updateMatrixWorld 触发、type/isCubeCamera)

import { describe, it, expect, vi } from 'vitest';
import { CubeCamera, CUBE_FACES } from './CubeCamera';
import { PerspectiveCamera } from './PerspectiveCamera';
import { Object3D } from '../Core/Object3D';
import { Vector3 } from '../Math';

// 每面对应的期望方向(+X, -X, +Y, -Y, +Z, -Z)
const EXPECTED_DIRS: Record<string, [number, number, number]> = {
  px: [1, 0, 0],
  nx: [-1, 0, 0],
  py: [0, 1, 0],
  ny: [0, -1, 0],
  pz: [0, 0, 1],
  nz: [0, 0, -1],
};

describe('CubeCamera', () => {
  // ── 构造 ────────────────────────────────────────────────────

  describe('构造', () => {
    it('默认参数:near=0.1, far=1000, resolution=256, format=rgba8', () => {
      const cam = new CubeCamera();
      expect(cam.near).toBe(0.1);
      expect(cam.far).toBe(1000);
      expect(cam.renderTarget.resolution).toBe(256);
      expect(cam.renderTarget.format).toBe('rgba8');
      expect(cam.renderTarget.generateMipmaps).toBe(true);
      expect(cam.renderTarget.colorSpace).toBe('srgb');
    });

    it('自定义参数', () => {
      const cam = new CubeCamera({
        near: 1,
        far: 500,
        resolution: 512,
        format: 'rgba16f',
        generateMipmaps: false,
        colorSpace: 'linear',
      });
      expect(cam.near).toBe(1);
      expect(cam.far).toBe(500);
      expect(cam.renderTarget.resolution).toBe(512);
      expect(cam.renderTarget.format).toBe('rgba16f');
      expect(cam.renderTarget.generateMipmaps).toBe(false);
      expect(cam.renderTarget.colorSpace).toBe('linear');
    });

    it('创建 6 个 PerspectiveCamera', () => {
      const cam = new CubeCamera();
      expect(cam.cameras).toHaveLength(6);
      for (const c of cam.cameras) {
        expect(c).toBeInstanceOf(PerspectiveCamera);
        expect(c.isPerspectiveCamera).toBe(true);
      }
    });

    it('每个相机 fov=90, aspect=1, near/far 同步', () => {
      const cam = new CubeCamera({ near: 2, far: 200 });
      for (const c of cam.cameras) {
        expect(c.fov).toBe(90);
        expect(c.aspect).toBe(1);
        expect(c.near).toBe(2);
        expect(c.far).toBe(200);
      }
    });

    it('type="CubeCamera", isCubeCamera=true', () => {
      const cam = new CubeCamera();
      expect(cam.type).toBe('CubeCamera');
      expect(cam.isCubeCamera).toBe(true);
    });

    it('继承 Object3D', () => {
      const cam = new CubeCamera();
      expect(cam).toBeInstanceOf(Object3D);
      expect(cam.isCubeCamera).toBe(true);
    });
  });

  // ── near/far 同步 ───────────────────────────────────────────

  describe('setNear / setFar', () => {
    it('setNear 更新所有 6 个相机', () => {
      const cam = new CubeCamera({ near: 0.5 });
      cam.setNear(5);
      expect(cam.near).toBe(5);
      for (const c of cam.cameras) {
        expect(c.near).toBe(5);
      }
    });

    it('setFar 更新所有 6 个相机', () => {
      const cam = new CubeCamera({ far: 1000 });
      cam.setFar(2000);
      expect(cam.far).toBe(2000);
      for (const c of cam.cameras) {
        expect(c.far).toBe(2000);
      }
    });

    it('setNear 返回 this(链式)', () => {
      const cam = new CubeCamera();
      expect(cam.setNear(1)).toBe(cam);
    });

    it('setFar 返回 this(链式)', () => {
      const cam = new CubeCamera();
      expect(cam.setFar(100)).toBe(cam);
    });
  });

  // ── setResolution ──────────────────────────────────────────

  describe('setResolution', () => {
    it('设置渲染目标分辨率', () => {
      const cam = new CubeCamera({ resolution: 128 });
      cam.setResolution(1024);
      expect(cam.renderTarget.resolution).toBe(1024);
    });

    it('向下取整', () => {
      const cam = new CubeCamera();
      cam.setResolution(100.7);
      expect(cam.renderTarget.resolution).toBe(100);
    });

    it('最小值 1', () => {
      const cam = new CubeCamera();
      cam.setResolution(0);
      expect(cam.renderTarget.resolution).toBe(1);
    });

    it('负数也被 clamp 到 1', () => {
      const cam = new CubeCamera();
      cam.setResolution(-50);
      expect(cam.renderTarget.resolution).toBe(1);
    });
  });

  // ── 位置同步 ────────────────────────────────────────────────

  describe('位置同步', () => {
    it('构造后 6 面相机位置 = CubeCamera 位置(原点)', () => {
      const cam = new CubeCamera();
      // 构造时 _updateCameras 已被调用
      for (const c of cam.cameras) {
        expect(c.position.x).toBe(0);
        expect(c.position.y).toBe(0);
        expect(c.position.z).toBe(0);
      }
    });

    it('CubeCamera 移动后 updateMatrixWorld 同步位置', () => {
      const cam = new CubeCamera();
      cam.position.set(10, 20, 30);
      cam.updateMatrixWorld(true);
      for (const c of cam.cameras) {
        expect(c.position.x).toBe(10);
        expect(c.position.y).toBe(20);
        expect(c.position.z).toBe(30);
      }
    });

    it('updateCameras 手动同步位置', () => {
      const cam = new CubeCamera();
      cam.position.set(1, 2, 3);
      cam.updateCameras();
      for (const c of cam.cameras) {
        expect(c.position.x).toBe(1);
        expect(c.position.y).toBe(2);
        expect(c.position.z).toBe(3);
      }
    });

    it('多次移动保持同步', () => {
      const cam = new CubeCamera();
      cam.position.set(1, 0, 0);
      cam.updateMatrixWorld(true);
      cam.position.set(0, 5, 0);
      cam.updateMatrixWorld(true);
      for (const c of cam.cameras) {
        expect(c.position.x).toBe(0);
        expect(c.position.y).toBe(5);
        expect(c.position.z).toBe(0);
      }
    });
  });

  // ── 方向(核心) ─────────────────────────────────────────────

  describe('方向', () => {
    /**
     * 对每个面,验证:
     *   1. 相机的世界 -Z 轴(getWorldDirection)匹配该面的 dir
     *   2. 特别覆盖 ±Y 面的 up=(0,0,±1),确保不依赖 Object3D.lookAt 的 up=(0,1,0)
     */
    for (let i = 0; i < 6; i++) {
      const face = CUBE_FACES[i];
      const [dx, dy, dz] = EXPECTED_DIRS[face];

      it(`面 ${face} 朝向 (${dx}, ${dy}, ${dz})`, () => {
        const cam = new CubeCamera();
        cam.position.set(0, 0, 0);
        cam.updateMatrixWorld(true); // 触发 _updateCameras

        const faceCam = cam.cameras[i];
        // 相机不是 CubeCamera 的子节点,需手动更新 matrixWorld
        faceCam.updateMatrixWorld(true);

        const dir = faceCam.getWorldDirection(new Vector3());
        expect(dir.x).toBeCloseTo(dx, 5);
        expect(dir.y).toBeCloseTo(dy, 5);
        expect(dir.z).toBeCloseTo(dz, 5);
      });
    }

    it('从非原点位置出发,方向仍正确', () => {
      const cam = new CubeCamera();
      cam.position.set(100, -50, 200);
      cam.updateMatrixWorld(true);

      // +X 面应朝向 (1,0,0)
      const pxCam = cam.cameras[0];
      pxCam.updateMatrixWorld(true);
      const dir = pxCam.getWorldDirection(new Vector3());
      expect(dir.x).toBeCloseTo(1, 5);
      expect(dir.y).toBeCloseTo(0, 5);
      expect(dir.z).toBeCloseTo(0, 5);
    });

    it('+Y 面 up=(0,0,1) 不被 (0,1,0) 覆盖', () => {
      // 如果错误地用了 up=(0,1,0),+Y 面会退化(forward 平行 up)
      // 导致 NaN 或错误方向。这里验证方向仍为 (0,1,0)。
      const cam = new CubeCamera();
      cam.updateMatrixWorld(true);
      const pyCam = cam.cameras[2]; // +Y
      pyCam.updateMatrixWorld(true);
      const dir = pyCam.getWorldDirection(new Vector3());
      expect(Number.isNaN(dir.x)).toBe(false);
      expect(Number.isNaN(dir.y)).toBe(false);
      expect(Number.isNaN(dir.z)).toBe(false);
      expect(dir.y).toBeCloseTo(1, 5);
    });

    it('-Y 面 up=(0,0,-1) 不被 (0,1,0) 覆盖', () => {
      const cam = new CubeCamera();
      cam.updateMatrixWorld(true);
      const nyCam = cam.cameras[3]; // -Y
      nyCam.updateMatrixWorld(true);
      const dir = nyCam.getWorldDirection(new Vector3());
      expect(Number.isNaN(dir.x)).toBe(false);
      expect(Number.isNaN(dir.y)).toBe(false);
      expect(Number.isNaN(dir.z)).toBe(false);
      expect(dir.y).toBeCloseTo(-1, 5);
    });
  });

  // ── 投影矩阵 ────────────────────────────────────────────────

  describe('投影矩阵', () => {
    it('每个相机的 projectionMatrix 不为零', () => {
      const cam = new CubeCamera();
      for (const c of cam.cameras) {
        const e = c.projectionMatrix.elements;
        // 透视投影矩阵第 [0][0] 元素非零
        expect(e[0]).not.toBe(0);
      }
    });

    it('setNear 后投影矩阵更新', () => {
      const cam = new CubeCamera({ near: 1 });
      const before = cam.cameras[0].projectionMatrix.elements[0];
      cam.setNear(10);
      const after = cam.cameras[0].projectionMatrix.elements[0];
      // near 变大 → [0][0] = 1/tan(fov/2) * aspect/near 相关项变化
      // 实际上 [0][0] = 1/(aspect*tan(fov/2)),与 near 无关(对称投影)
      // 但 [10][14] (z 偏移)会变。这里只验证投影矩阵被重算(可能相同)。
      expect(after).toBeDefined();
      // 验证 near 相关项:projectionMatrix.elements[10] = -(far+near)/(far-near)
      const e = cam.cameras[0].projectionMatrix.elements;
      const expected10 = -(cam.far + 10) / (cam.far - 10);
      expect(e[10]).toBeCloseTo(expected10, 5);
      void before;
    });

    it('所有 6 面投影矩阵相同(对称 90° FOV)', () => {
      const cam = new CubeCamera();
      const e0 = cam.cameras[0].projectionMatrix.elements;
      for (let i = 1; i < 6; i++) {
        const ei = cam.cameras[i].projectionMatrix.elements;
        for (let j = 0; j < 16; j++) {
          expect(ei[j]).toBeCloseTo(e0[j], 6);
        }
      }
    });
  });

  // ── updateCameras ──────────────────────────────────────────

  describe('updateCameras', () => {
    it('手动调用后位置/方向更新', () => {
      const cam = new CubeCamera();
      cam.position.set(5, 5, 5);
      cam.updateCameras();

      // 位置同步
      for (const c of cam.cameras) {
        expect(c.position.x).toBe(5);
        expect(c.position.y).toBe(5);
        expect(c.position.z).toBe(5);
      }

      // +Z 面方向
      const pzCam = cam.cameras[4];
      pzCam.updateMatrixWorld(true);
      const dir = pzCam.getWorldDirection(new Vector3());
      expect(dir.z).toBeCloseTo(1, 5);
    });
  });

  // ── update(renderer, scene) ────────────────────────────────

  describe('update', () => {
    it('调用 renderer.updateCubeCamera', () => {
      const cam = new CubeCamera();
      const scene = new Object3D();
      const updateCubeCamera = vi.fn();
      const fakeRenderer = { updateCubeCamera };

      cam.update(fakeRenderer, scene);

      expect(updateCubeCamera).toHaveBeenCalledOnce();
      expect(updateCubeCamera).toHaveBeenCalledWith(cam, scene);
    });

    it('每次 update 递增 version', () => {
      const cam = new CubeCamera();
      const scene = new Object3D();
      const fakeRenderer = { updateCubeCamera: vi.fn() };

      const v0 = cam.version;
      cam.update(fakeRenderer, scene);
      expect(cam.version).toBe(v0 + 1);
      cam.update(fakeRenderer, scene);
      expect(cam.version).toBe(v0 + 2);
    });

    it('autoUpdate=true(默认)时调用 updateMatrixWorld', () => {
      const cam = new CubeCamera();
      cam.position.set(1, 2, 3);
      const scene = new Object3D();
      const fakeRenderer = { updateCubeCamera: vi.fn() };

      cam.update(fakeRenderer, scene);

      // updateMatrixWorld 应已触发 _updateCameras,位置同步
      for (const c of cam.cameras) {
        expect(c.position.x).toBe(1);
        expect(c.position.y).toBe(2);
        expect(c.position.z).toBe(3);
      }
    });

    it('autoUpdate=false 时跳过 CubeCamera 自身的 updateMatrixWorld', () => {
      const cam = new CubeCamera();
      cam.position.set(7, 8, 9);
      cam.autoUpdate = false;
      const scene = new Object3D();
      const fakeRenderer = { updateCubeCamera: vi.fn() };

      // 记录 update 前的 matrixWorld 平移分量(初始 identity → 0)
      const mwBefore = cam.matrixWorld.elements[12];

      cam.update(fakeRenderer, scene);

      // autoUpdate=false → 不调 updateMatrixWorld → CubeCamera 自身 matrixWorld 未更新
      // matrixWorld 平移分量仍为 0(identity),未被 position (7,8,9) 覆盖
      const mwAfter = cam.matrixWorld.elements[12];
      expect(mwAfter).toBe(mwBefore);
      expect(mwAfter).toBe(0);

      // 但 _updateCameras 仍在 update() 内无条件调用 → 6 面相机位置已同步
      for (const c of cam.cameras) {
        expect(c.position.x).toBe(7);
        expect(c.position.y).toBe(8);
        expect(c.position.z).toBe(9);
      }
    });
  });

  // ── Object3D 集成 ──────────────────────────────────────────

  describe('Object3D 集成', () => {
    it('updateMatrixWorld 触发 _updateCameras', () => {
      const cam = new CubeCamera();
      cam.position.set(1, 1, 1);
      // 构造时已 _updateCameras 一次(位置 0,0,0)
      // 现在移动并强制更新
      cam.updateMatrixWorld(true);
      for (const c of cam.cameras) {
        expect(c.position.x).toBe(1);
      }
    });

    it('可作为场景子节点', () => {
      const scene = new Object3D();
      const cam = new CubeCamera();
      scene.add(cam);
      expect(cam.parent).toBe(scene);
      expect(scene.children).toContain(cam);
    });

    it('toJSON 包含 type', () => {
      const cam = new CubeCamera();
      cam.name = 'envProbe';
      const json = cam.toJSON();
      expect(json.type).toBe('CubeCamera');
      expect(json.name).toBe('envProbe');
    });

    it('children 默认为空(相机不作为子节点)', () => {
      const cam = new CubeCamera();
      expect(cam.children).toHaveLength(0);
      expect(cam.cameras).toHaveLength(6);
      // cameras 数组与 children 分离
      for (const c of cam.cameras) {
        expect(cam.children).not.toContain(c);
      }
    });
  });

  // ── CUBE_FACES 常量 ─────────────────────────────────────────

  describe('CUBE_FACES 常量', () => {
    it('顺序为 px, nx, py, ny, pz, nz', () => {
      expect(CUBE_FACES).toEqual(['px', 'nx', 'py', 'ny', 'pz', 'nz']);
    });

    it('长度为 6', () => {
      expect(CUBE_FACES).toHaveLength(6);
    });

    it('与 cameras 数组一一对应', () => {
      const cam = new CubeCamera();
      expect(cam.cameras).toHaveLength(CUBE_FACES.length);
    });
  });
});
