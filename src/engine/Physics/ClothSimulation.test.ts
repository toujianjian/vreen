// ClothSimulation 测试。

import { describe, it, expect } from 'vitest';
import { ClothSimulation } from './ClothSimulation';
import { Vector3 } from '../Math/Vector3';

describe('ClothSimulation', () => {
  describe('createGrid', () => {
    it('创建 width × height 网格,顶点数 = gridW * gridH', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, { width: 5, height: 5 });
      // gridW=5, gridH=5 → 25 顶点
      expect(cloth.particles.length).toBe(25);
      expect(cloth.resolution).toBe(25);
    });

    it('顶点中心在原点,XY 平面', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      // 4 顶点,中心在原点 → 角点 (±1, ±1, 0)
      const positions = cloth.particles.map((p) => p.position);
      const xs = positions.map((p) => p.x).sort((a, b) => a - b);
      const ys = positions.map((p) => p.y).sort((a, b) => a - b);
      expect(xs[0]).toBeCloseTo(-1);
      expect(xs[3]).toBeCloseTo(1);
      expect(ys[0]).toBeCloseTo(-1);
      expect(ys[3]).toBeCloseTo(1);
      // z 全为 0
      expect(positions.every((p) => p.z === 0)).toBe(true);
    });

    it('约束包含水平 / 垂直 / 对角', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      // 2x2 网格:
      //   水平:2 行 × 1 = 2
      //   垂直:1 列 × 2 = 2 (实际 2 列 × 1 行 = 2)
      //   对角:1 cell × 2 = 2
      // 合计 6
      expect(cloth.constraints.length).toBe(6);
    });

    it('拒绝 width/height < 2', () => {
      const cloth = new ClothSimulation();
      expect(() => cloth.createGrid(1, 2, 2)).toThrowError(/width\/height/);
    });

    it('拒绝 resolution < 2', () => {
      const cloth = new ClothSimulation();
      expect(() => cloth.createGrid(2, 2, 1)).toThrowError(/resolution/);
    });
  });

  describe('pin / unpin', () => {
    it('pin 设置 pinned + invMass=0', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      cloth.pin(0, 0);
      const i = cloth.indexOf(0, 0);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(cloth.particles[i].pinned).toBe(true);
      expect(cloth.particles[i].invMass).toBe(0);
    });

    it('unpin 恢复 invMass', () => {
      const cloth = new ClothSimulation({ mass: 2 });
      cloth.createGrid(2, 2, 2);
      cloth.pin(1, 1);
      cloth.unpin(1, 1);
      const i = cloth.indexOf(1, 1);
      expect(cloth.particles[i].pinned).toBe(false);
      expect(cloth.particles[i].invMass).toBeCloseTo(0.5);
    });

    it('pin 越界抛错', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      expect(() => cloth.pin(99, 0)).toThrowError(/out of range/);
    });

    it('indexOf 越界返回 -1', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      expect(cloth.indexOf(-1, 0)).toBe(-1);
      expect(cloth.indexOf(99, 99)).toBe(-1);
    });
  });

  describe('addConstraint', () => {
    it('默认 restLength 取当前距离', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      // 第一个约束是 (0,0)-(1,0),水平相邻,距离 = stepX
      const c = cloth.constraints[0];
      const a = cloth.particles[c.p1].position;
      const b = cloth.particles[c.p2].position;
      expect(c.restLength).toBeCloseTo(a.distanceTo(b));
    });

    it('越界索引抛错', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      expect(() => cloth.addConstraint(0, 999)).toThrowError(/out of range/);
    });
  });

  describe('applyForce', () => {
    it('累加到非固定粒子的 acceleration', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      cloth.applyForce(new Vector3(0, -10, 0));
      // 4 个粒子,invMass = 1(mass=1)→ acceleration.y = -10
      expect(cloth.particles[0].acceleration.y).toBeCloseTo(-10);
    });

    it('跳过 pinned 粒子', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      cloth.pin(0, 0);
      cloth.applyForce(new Vector3(0, -10, 0));
      const i = cloth.indexOf(0, 0);
      expect(cloth.particles[i].acceleration.y).toBe(0);
    });
  });

  describe('update (Verlet)', () => {
    it('重力让非固定粒子下落', () => {
      const cloth = new ClothSimulation({ gravity: 9.8, damping: 0, iterations: 1 });
      cloth.createGrid(2, 2, 2);
      const i = cloth.indexOf(1, 0); // 顶部右侧
      const y0 = cloth.particles[i].position.y;
      cloth.update(1 / 60);
      // 1 帧后位置 y 应小于初始 y(下落)
      expect(cloth.particles[i].position.y).toBeLessThan(y0);
    });

    it('pinned 粒子位置不变', () => {
      const cloth = new ClothSimulation({ gravity: 9.8 });
      cloth.createGrid(2, 2, 2);
      const i = cloth.indexOf(0, 0);
      cloth.pin(0, 0);
      const p0 = cloth.particles[i].position.clone();
      cloth.update(1 / 60);
      expect(cloth.particles[i].position.x).toBeCloseTo(p0.x);
      expect(cloth.particles[i].position.y).toBeCloseTo(p0.y);
      expect(cloth.particles[i].position.z).toBeCloseTo(p0.z);
    });

    it('update 后加速度清零', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      cloth.applyForce(new Vector3(1, 0, 0));
      cloth.update(1 / 60);
      expect(cloth.particles[0].acceleration.x).toBe(0);
    });

    it('约束保持网格拓扑(相邻顶点距离接近 restLength)', () => {
      const cloth = new ClothSimulation({ gravity: 0, damping: 0, iterations: 8 });
      cloth.createGrid(2, 2, 4);
      // 把所有粒子都 pin(完全静止),约束求解应保持原始距离
      for (let j = 0; j < 4; j++) {
        for (let i = 0; i < 4; i++) cloth.pin(i, j);
      }
      cloth.update(1 / 60);
      for (const c of cloth.constraints) {
        const a = cloth.particles[c.p1].position;
        const b = cloth.particles[c.p2].position;
        const d = a.distanceTo(b);
        expect(d).toBeCloseTo(c.restLength, 4);
      }
    });

    it('挂住顶部两角,重力让中部下垂', () => {
      const cloth = new ClothSimulation({ gravity: 9.8, damping: 0.01, iterations: 8 });
      cloth.createGrid(2, 2, 5);
      cloth.pin(0, 0);
      cloth.pin(4, 0);
      const midY0 = cloth.particles[cloth.indexOf(2, 2)].position.y;
      // 多步迭代让中部下垂
      for (let i = 0; i < 60; i++) cloth.update(1 / 60);
      const midY1 = cloth.particles[cloth.indexOf(2, 2)].position.y;
      expect(midY1).toBeLessThan(midY0);
    });
  });

  describe('collide (球体)', () => {
    it('把陷入球内的粒子推到球面外', () => {
      const cloth = new ClothSimulation({ gravity: 0 });
      cloth.createGrid(2, 2, 5);
      // 中心放一个半径 0.5 的球
      const sphere = { center: new Vector3(0, 0, 0), radius: 0.5 };
      // 把粒子 0 强行推到球内
      cloth.particles[0].position.set(0.1, 0, 0);
      cloth.collide(sphere);
      const dx = cloth.particles[0].position.x - sphere.center.x;
      const dy = cloth.particles[0].position.y - sphere.center.y;
      const dz = cloth.particles[0].position.z - sphere.center.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      expect(d).toBeGreaterThanOrEqual(0.5 - 1e-6);
    });

    it('跳过 pinned 粒子', () => {
      const cloth = new ClothSimulation({ gravity: 0 });
      cloth.createGrid(2, 2, 2);
      cloth.pin(0, 0);
      const i = cloth.indexOf(0, 0);
      cloth.particles[i].position.set(0, 0, 0);
      const before = cloth.particles[i].position.clone();
      cloth.collide({ center: new Vector3(0, 0, 0), radius: 1 });
      expect(cloth.particles[i].position.x).toBeCloseTo(before.x);
      expect(cloth.particles[i].position.y).toBeCloseTo(before.y);
    });
  });

  describe('getMeshData', () => {
    it('返回 positions / indices / normals / gridW / gridH', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 4);
      const data = cloth.getMeshData();
      expect(data.positions.length).toBe(16 * 3);
      // 4x4 grid → 3x3 cells → 18 三角形 → 54 索引
      expect(data.indices.length).toBe(3 * 3 * 6);
      expect(data.normals.length).toBe(16 * 3);
      expect(data.gridW).toBe(4);
      expect(data.gridH).toBe(4);
    });

    it('indices 在大网格下用 Uint32Array', () => {
      const cloth = new ClothSimulation();
      // 创建一个大网格使得索引数 > 65536
      // gridW=100, gridH=100 → 99*99 cells * 6 = 58806 索引(< 65536)
      // 改为 gridW=200, gridH=200 → 199*199*6 = 237606 > 65536
      cloth.createGrid(10, 10, { width: 200, height: 200 });
      const data = cloth.getMeshData();
      expect(data.indices instanceof Uint32Array).toBe(true);
    });

    it('indices 在小网格下用 Uint16Array', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 4);
      const data = cloth.getMeshData();
      expect(data.indices instanceof Uint16Array).toBe(true);
    });

    it('positions 反映 particles 当前位置', () => {
      const cloth = new ClothSimulation();
      cloth.createGrid(2, 2, 2);
      cloth.particles[0].position.set(5, 6, 7);
      const data = cloth.getMeshData();
      expect(data.positions[0]).toBeCloseTo(5);
      expect(data.positions[1]).toBeCloseTo(6);
      expect(data.positions[2]).toBeCloseTo(7);
    });

    it('normals 在静态 XY 平面网格上应近似 +Z', () => {
      const cloth = new ClothSimulation({ gravity: 0 });
      cloth.createGrid(2, 2, 4);
      const data = cloth.getMeshData();
      // 取非边界顶点 (i=1, j=1) → index = 1*4 + 1 = 5
      // 边界顶点的切线退化(right/down 被钳到自身),法线为 0,故避开。
      const vIdx = 5;
      const o = vIdx * 3;
      const nx = data.normals[o];
      const ny = data.normals[o + 1];
      const nz = data.normals[o + 2];
      // 未变形 XY 网格,法线应 ≈ (0, 0, 1)
      expect(Math.abs(nx)).toBeLessThan(0.5);
      expect(Math.abs(ny)).toBeLessThan(0.5);
      expect(nz).toBeGreaterThan(0.5);
    });
  });

  describe('构造选项', () => {
    it('自定义质量 / 阻尼 / 刚度 / 迭代次数 / 重力', () => {
      const cloth = new ClothSimulation({
        mass: 2,
        damping: 0.05,
        stiffness: 0.8,
        iterations: 10,
        gravity: 5,
      });
      expect(cloth.mass).toBe(2);
      expect(cloth.damping).toBeCloseTo(0.05);
      expect(cloth.stiffness).toBeCloseTo(0.8);
      expect(cloth.iterations).toBe(10);
      expect(cloth.gravity).toBeCloseTo(5);
      cloth.createGrid(2, 2, 2);
      expect(cloth.particles[0].mass).toBe(2);
      expect(cloth.particles[0].invMass).toBeCloseTo(0.5);
    });
  });
});
