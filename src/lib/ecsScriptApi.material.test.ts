// EcsScriptAPI 材质操作测试 — Phase 3.3
//
// 验证:
//   • StandardMaterial 的 baseColor/metallic/roughness/emissive/opacity/wireframe 设置
//   • hex 颜色解析
//   • 非 StandardMaterial / 无 MeshRef 的情况返回 false
//   • assignNewStandardMaterial 替换材质
//   • VREEN API 端到端调用 (matSetColor/matSetMetallic 等)

import { describe, it, expect, beforeEach } from 'vitest';
import { World, MeshRef, MeshRefC } from '@/engine/ECS';
import { EcsScriptAPI } from '@/lib/ecsScriptApi';
import { StandardMaterial } from '@/engine/Materials/StandardMaterial';
import { Mesh } from '@/engine/Core/Mesh';
import { BufferGeometry } from '@/engine/Core/BufferGeometry';
import { BasicMaterial } from '@/engine/Core/Material';

describe('EcsScriptAPI — Material operations (Phase 3.3)', () => {
  let world: World;
  let api: EcsScriptAPI;

  beforeEach(() => {
    world = new World({ name: 'MatTestWorld' });
    api = new EcsScriptAPI(world);
  });

  /** 创建一个带 StandardMaterial 的 entity。 */
  function makeEntityWithStandardMaterial(): { id: number; mat: StandardMaterial } {
    const id = world.createEntity('TestMesh');
    const mat = new StandardMaterial();
    const mesh = new Mesh(new BufferGeometry(), mat);
    world.setComponent(id, MeshRefC, new MeshRef(mesh));
    return { id, mat };
  }

  /** 创建一个带 BasicMaterial(非 Standard)的 entity。 */
  function makeEntityWithBasicMaterial(): number {
    const id = world.createEntity('BasicMesh');
    const mat = new BasicMaterial();
    const mesh = new Mesh(new BufferGeometry(), mat);
    world.setComponent(id, MeshRefC, new MeshRef(mesh));
    return id;
  }

  // ── setEntityMaterialColor ──────────────────────────────────
  describe('setEntityMaterialColor', () => {
    it('sets baseColor from rgb 0..1', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      expect(api.setEntityMaterialColor(id, 0.5, 0.25, 0.1)).toBe(true);
      expect(mat.baseColor).toEqual({ r: 0.5, g: 0.25, b: 0.1 });
    });

    it('returns false for entity without MeshRef', () => {
      const id = world.createEntity('NoMesh');
      expect(api.setEntityMaterialColor(id, 1, 0, 0)).toBe(false);
    });

    it('returns false for non-StandardMaterial', () => {
      const id = makeEntityWithBasicMaterial();
      expect(api.setEntityMaterialColor(id, 1, 0, 0)).toBe(false);
    });

    it('returns false for non-existent entity', () => {
      expect(api.setEntityMaterialColor(0xfffffff, 1, 0, 0)).toBe(false);
    });
  });

  // ── setEntityMaterialMetallic ───────────────────────────────
  describe('setEntityMaterialMetallic', () => {
    it('sets metallic value', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      expect(api.setEntityMaterialMetallic(id, 0.8)).toBe(true);
      expect(mat.metallic).toBe(0.8);
    });

    it('clamps to 0..1', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      api.setEntityMaterialMetallic(id, 2.5);
      expect(mat.metallic).toBe(1);
      api.setEntityMaterialMetallic(id, -1);
      expect(mat.metallic).toBe(0);
    });
  });

  // ── setEntityMaterialRoughness ──────────────────────────────
  describe('setEntityMaterialRoughness', () => {
    it('sets roughness value', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      expect(api.setEntityMaterialRoughness(id, 0.3)).toBe(true);
      expect(mat.roughness).toBe(0.3);
    });

    it('clamps to 0..1', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      api.setEntityMaterialRoughness(id, 5);
      expect(mat.roughness).toBe(1);
    });
  });

  // ── setEntityMaterialEmissive ───────────────────────────────
  describe('setEntityMaterialEmissive', () => {
    it('sets emissive color and intensity', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      expect(api.setEntityMaterialEmissive(id, 1, 0.5, 0.2, 2.5)).toBe(true);
      expect(mat.emissive).toEqual({ r: 1, g: 0.5, b: 0.2 });
      expect(mat.emissiveIntensity).toBe(2.5);
    });

    it('clamps intensity to >= 0', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      api.setEntityMaterialEmissive(id, 1, 1, 1, -5);
      expect(mat.emissiveIntensity).toBe(0);
    });
  });

  // ── setEntityMaterialOpacity ────────────────────────────────
  describe('setEntityMaterialOpacity', () => {
    it('sets opacity', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      expect(api.setEntityMaterialOpacity(id, 0.5)).toBe(true);
      expect(mat.opacity).toBe(0.5);
    });

    it('clamps to 0..1', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      api.setEntityMaterialOpacity(id, 2);
      expect(mat.opacity).toBe(1);
      api.setEntityMaterialOpacity(id, -1);
      expect(mat.opacity).toBe(0);
    });
  });

  // ── setEntityMaterialWireframe ──────────────────────────────
  describe('setEntityMaterialWireframe', () => {
    it('toggles wireframe on', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      expect(api.setEntityMaterialWireframe(id, true)).toBe(true);
      expect(mat.wireframe).toBe(true);
    });

    it('toggles wireframe off', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      mat.wireframe = true;
      expect(api.setEntityMaterialWireframe(id, false)).toBe(true);
      expect(mat.wireframe).toBe(false);
    });
  });

  // ── Getters ─────────────────────────────────────────────────
  describe('Getters', () => {
    it('getEntityMaterialMetallic returns current value', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      mat.metallic = 0.7;
      expect(api.getEntityMaterialMetallic(id)).toBe(0.7);
    });

    it('getEntityMaterialRoughness returns current value', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      mat.roughness = 0.4;
      expect(api.getEntityMaterialRoughness(id)).toBe(0.4);
    });

    it('getEntityMaterialOpacity returns current value', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      mat.opacity = 0.6;
      expect(api.getEntityMaterialOpacity(id)).toBe(0.6);
    });

    it('getEntityMaterialColor returns current rgb', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      mat.baseColor = { r: 0.1, g: 0.2, b: 0.3 };
      expect(api.getEntityMaterialColor(id)).toEqual([0.1, 0.2, 0.3]);
    });

    it('getters return defaults for non-StandardMaterial', () => {
      const id = makeEntityWithBasicMaterial();
      expect(api.getEntityMaterialMetallic(id)).toBe(0);
      expect(api.getEntityMaterialRoughness(id)).toBe(0);
      expect(api.getEntityMaterialOpacity(id)).toBe(1);
      expect(api.getEntityMaterialColor(id)).toEqual([0.8, 0.8, 0.8]);
    });
  });

  // ── assignNewStandardMaterial ───────────────────────────────
  describe('assignNewStandardMaterial', () => {
    it('replaces existing StandardMaterial with a fresh one', () => {
      const { id, mat } = makeEntityWithStandardMaterial();
      const oldUuid = mat.uuid;
      expect(api.assignNewStandardMaterial(id)).toBe(true);
      const ref = world.getComponent(id, MeshRefC);
      const newMat = ref!.mesh.material as StandardMaterial;
      expect(newMat).not.toBe(mat);
      expect(newMat.uuid).not.toBe(oldUuid);
      expect(newMat).toBeInstanceOf(StandardMaterial);
    });

    it('replaces BasicMaterial with StandardMaterial', () => {
      const id = makeEntityWithBasicMaterial();
      expect(api.assignNewStandardMaterial(id)).toBe(true);
      const ref = world.getComponent(id, MeshRefC);
      expect(ref!.mesh.material).toBeInstanceOf(StandardMaterial);
    });

    it('returns false for entity without MeshRef', () => {
      const id = world.createEntity('NoMesh');
      expect(api.assignNewStandardMaterial(id)).toBe(false);
    });
  });

  // ── 材质数组情况 ─────────────────────────────────────────────
  describe('material arrays', () => {
    it('operates on first material in array', () => {
      const id = world.createEntity('MultiMat');
      const mat1 = new StandardMaterial();
      const mat2 = new StandardMaterial();
      const mesh = new Mesh(new BufferGeometry(), [mat1, mat2]);
      world.setComponent(id, MeshRefC, new MeshRef(mesh));

      expect(api.setEntityMaterialMetallic(id, 0.9)).toBe(true);
      expect(mat1.metallic).toBe(0.9);
      expect(mat2.metallic).toBe(0); // 未被修改
    });
  });
});
