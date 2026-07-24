import { describe, it, expect } from 'vitest';
import { MeshBVH } from './MeshBVH';
import { Ray } from '../Math/Ray';
import { Vector3 } from '../Math/Vector3';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { SphereGeometry } from '../Geometries/SphereGeometry';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';

describe('MeshBVH', () => {
  describe('raycast', () => {
    const geo = new BoxGeometry(2, 2, 2); // 带 position/normal/uv
    const mesh = new MeshBVH(geo, { maxLeafSize: 4 });

    it('返回带 distance/point/face/uv 的命中结果', () => {
      const ray = new Ray(new Vector3(-5, 0.2, 0.1), new Vector3(1, 0, 0));
      const hits = mesh.raycast(ray);
      expect(hits.length).toBe(2);

      const first = hits[0];
      expect(first.distance).toBeCloseTo(4, 6);
      expect(first.point.x).toBeCloseTo(-1, 6);
      expect(first.point.y).toBeCloseTo(0.2, 6);
      expect(first.point.z).toBeCloseTo(0.1, 6);
      expect(first.faceIndex).toBeGreaterThanOrEqual(0);
      expect(first.face.a).toBeGreaterThanOrEqual(0);
      expect(first.face.b).toBeGreaterThanOrEqual(0);
      expect(first.face.c).toBeGreaterThanOrEqual(0);
      // -X 面法线应为 (-1, 0, 0)
      expect(first.face.normal.x).toBeCloseTo(-1, 6);
      expect(Math.abs(first.face.normal.y)).toBeLessThan(1e-6);
      expect(Math.abs(first.face.normal.z)).toBeLessThan(1e-6);
      // uv 应存在(BoxGeometry 带 uv 属性)
      expect(first.uv).toBeDefined();
    });

    it('命中结果按 distance 升序', () => {
      const ray = new Ray(new Vector3(-5, 0.2, 0.1), new Vector3(1, 0, 0));
      const hits = mesh.raycast(ray);
      for (let i = 1; i < hits.length; i++) {
        expect(hits[i].distance).toBeGreaterThanOrEqual(hits[i - 1].distance);
      }
    });

    it('未命中返回空数组', () => {
      const ray = new Ray(new Vector3(-5, 5, 0.1), new Vector3(1, 0, 0));
      expect(mesh.raycast(ray)).toEqual([]);
    });
  });

  describe('raycast - 无 uv 几何体', () => {
    it('uv 字段为 undefined', () => {
      const geo = new BufferGeometry();
      geo.setAttribute('position', new BufferAttribute(new Float32Array([
        0, 0, 0, 1, 0, 0, 0, 1, 0,
      ]), 3));
      const mesh = new MeshBVH(geo, { maxLeafSize: 4 });
      const ray = new Ray(new Vector3(0.25, 0.25, -1), new Vector3(0, 0, 1));
      const hits = mesh.raycast(ray);
      expect(hits.length).toBe(1);
      expect(hits[0].uv).toBeUndefined();
    });
  });

  describe('closestPointToPoint', () => {
    const geo = new BoxGeometry(2, 2, 2);
    const mesh = new MeshBVH(geo, { maxLeafSize: 4 });

    it('查询点在 +X 外:最近点为 (1,0,0),距离 2', () => {
      const result = mesh.closestPointToPoint(new Vector3(3, 0, 0));
      expect(result).not.toBeNull();
      expect(result!.point.x).toBeCloseTo(1, 6);
      expect(Math.abs(result!.point.y)).toBeLessThan(1e-6);
      expect(Math.abs(result!.point.z)).toBeLessThan(1e-6);
      expect(result!.distance).toBeCloseTo(2, 6);
      expect(result!.faceIndex).toBeGreaterThanOrEqual(0);
    });

    it('查询点在 -Y 外:最近点为 (0,-1,0),距离 2', () => {
      const result = mesh.closestPointToPoint(new Vector3(0, -3, 0));
      expect(result).not.toBeNull();
      expect(result!.point.y).toBeCloseTo(-1, 6);
      expect(result!.distance).toBeCloseTo(2, 6);
    });

    it('查询点在角点外:最近点为 (1,1,1),距离 √3', () => {
      const result = mesh.closestPointToPoint(new Vector3(2, 2, 2));
      expect(result).not.toBeNull();
      expect(result!.point.x).toBeCloseTo(1, 6);
      expect(result!.point.y).toBeCloseTo(1, 6);
      expect(result!.point.z).toBeCloseTo(1, 6);
      expect(result!.distance).toBeCloseTo(Math.sqrt(3), 6);
    });

    it('球体表面最近点', () => {
      const sphere = new SphereGeometry(1, 16, 8);
      const sphereMesh = new MeshBVH(sphere, { maxLeafSize: 4 });
      const result = sphereMesh.closestPointToPoint(new Vector3(3, 0, 0));
      expect(result).not.toBeNull();
      expect(result!.distance).toBeCloseTo(2, 5);
      expect(result!.point.x).toBeCloseTo(1, 4);
    });
  });

  describe('一致性', () => {
    it('raycast 与 raycastFirst 最近命中一致', () => {
      const geo = new BoxGeometry(2, 2, 2);
      const mesh = new MeshBVH(geo, { maxLeafSize: 4 });
      const ray = new Ray(new Vector3(-5, 0.2, 0.1), new Vector3(1, 0, 0));
      const all = mesh.raycast(ray);
      // MeshBVH 没有公开 raycastFirst,但 BVH 有;这里通过 all[0] 验证
      expect(all.length).toBeGreaterThan(0);
      expect(all[0].distance).toBeCloseTo(4, 6);
    });
  });
});
