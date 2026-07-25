// FurShell 单元测试。
//
// 覆盖:构造默认值、generate 生成 shellCount 个 mesh、setShellCount 重新生成、
// update 推进时间、dispose 清空、shellCount clamp、子节点挂载、shell 共享 geometry。
// 不依赖 WebGL 上下文(纯数据/场景图测试)。

import { describe, it, expect } from 'vitest';
import { FurShell } from './FurShell';
import { FurMaterial } from '../Materials/FurMaterial';
import { Mesh } from './Mesh';
import { BoxGeometry } from '../Geometries/BoxGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';

function makeBaseMesh(): Mesh {
  // 用 BoxGeometry 作为基础网格,材质用 StandardMaterial(实际渲染时
  // FurShell 会把 shell 的材质替换为 FurMaterial 的 clone)
  return new Mesh(new BoxGeometry(1, 1, 1), new StandardMaterial());
}

describe('FurShell', () => {
  it('默认构造:shellCount 16,shells 空,未 generate', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat });
    expect(shell.shellCount).toBe(16);
    expect(shell.shells).toEqual([]);
    expect(shell.isGenerated()).toBe(false);
    expect(shell.getElapsedTime()).toBe(0);
  });

  it('generate 生成 shellCount 个 shell mesh', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 8 });
    shell.generate();
    expect(shell.shells.length).toBe(8);
    expect(shell.isGenerated()).toBe(true);
  });

  it('shell mesh 默认作为 baseMesh 子节点挂载', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    expect(baseMesh.children.length).toBe(4);
    for (const s of shell.shells) {
      expect(s.parent).toBe(baseMesh);
    }
  });

  it('attachToBase=false 时不挂载到 baseMesh', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({
      baseMesh,
      furMaterial: furMat,
      shellCount: 4,
      attachToBase: false,
    });
    shell.generate();
    expect(baseMesh.children.length).toBe(0);
    for (const s of shell.shells) {
      expect(s.parent).toBeNull();
    }
  });

  it('每个 shell 共享 baseMesh.geometry', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    for (const s of shell.shells) {
      expect(s.geometry).toBe(baseMesh.geometry);
    }
  });

  it('每个 shell 的 material 是 FurMaterial 实例且 clone 自 furMaterial', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial({ furLength: 0.3, furDensity: 0.7 });
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    for (const s of shell.shells) {
      expect(s.material).toBeInstanceOf(FurMaterial);
      const m = s.material as FurMaterial;
      expect(m).not.toBe(furMat);
      expect(m.furLength).toBeCloseTo(0.3, 6);
      expect(m.furDensity).toBeCloseTo(0.7, 6);
    }
  });

  it('shell 的 shellLayer 在 [0,1] 范围内且首层 0、末层 1', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    const layers = shell.shells.map((s) => (s.material as FurMaterial).shellLayer);
    expect(layers[0]).toBeCloseTo(0, 6);
    expect(layers[3]).toBeCloseTo(1, 6);
    for (const l of layers) {
      expect(l).toBeGreaterThanOrEqual(0);
      expect(l).toBeLessThanOrEqual(1);
    }
  });

  it('shell.castShadow 与 receiveShadow 均为 false', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    for (const s of shell.shells) {
      expect(s.castShadow).toBe(false);
      expect(s.receiveShadow).toBe(false);
    }
  });

  it('update 推进时间,所有 shell 的 time 同步', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    shell.update(0.016);
    expect(shell.getElapsedTime()).toBeCloseTo(0.016, 6);
    expect(furMat.time).toBeCloseTo(0.016, 6);
    for (const s of shell.shells) {
      const m = s.material as FurMaterial;
      expect(m.time).toBeCloseTo(0.016, 6);
    }
    shell.update(0.032);
    expect(shell.getElapsedTime()).toBeCloseTo(0.048, 6);
  });

  it('update 同步源 furMaterial 参数到各 shell', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial({ furLength: 0.1 });
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    // 修改源 furMaterial 参数
    furMat.furLength = 0.5;
    furMat.furDensity = 0.9;
    shell.update(0.016);
    for (const s of shell.shells) {
      const m = s.material as FurMaterial;
      expect(m.furLength).toBeCloseTo(0.5, 6);
      expect(m.furDensity).toBeCloseTo(0.9, 6);
    }
  });

  it('update 在 generate 之前是 no-op', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat });
    expect(() => shell.update(0.016)).not.toThrow();
    expect(shell.getElapsedTime()).toBe(0);
  });

  it('update 负数 dt 被夹为 0', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    shell.update(-0.5);
    expect(shell.getElapsedTime()).toBe(0);
  });

  it('setShellCount 改变层数并重新 generate', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    expect(shell.shells.length).toBe(4);
    shell.setShellCount(8);
    expect(shell.shellCount).toBe(8);
    expect(shell.shells.length).toBe(8);
  });

  it('setShellCount 在未 generate 时不触发 generate', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat });
    shell.setShellCount(8);
    expect(shell.shellCount).toBe(8);
    expect(shell.shells.length).toBe(0);
    expect(shell.isGenerated()).toBe(false);
  });

  it('shellCount clamp 到 [2, 64]', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell1 = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 1 });
    expect(shell1.shellCount).toBe(2);
    const shell2 = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 100 });
    expect(shell2.shellCount).toBe(64);
    const shell3 = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 0 });
    expect(shell3.shellCount).toBe(2);
  });

  it('setShellCount 也 clamp', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat });
    shell.setShellCount(0);
    expect(shell.shellCount).toBe(2);
    shell.setShellCount(1000);
    expect(shell.shellCount).toBe(64);
  });

  it('dispose 清空 shells 与子节点挂载', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    expect(baseMesh.children.length).toBe(4);
    shell.dispose();
    expect(shell.shells.length).toBe(0);
    expect(shell.isGenerated()).toBe(false);
    expect(baseMesh.children.length).toBe(0);
  });

  it('重复 generate 先清空旧 shells', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    const firstShells = shell.shells.slice();
    shell.generate();
    expect(shell.shells.length).toBe(4);
    // 新 shells 应是不同实例(重新创建)
    for (let i = 0; i < 4; i++) {
      expect(shell.shells[i]).not.toBe(firstShells[i]);
    }
    // baseMesh 子节点数仍是 4(旧的被 remove,新的被 add)
    expect(baseMesh.children.length).toBe(4);
  });

  it('getShells 返回 shells 数组副本引用', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 3 });
    shell.generate();
    const arr = shell.getShells();
    expect(arr.length).toBe(3);
    expect(arr).toBe(shell.shells);
  });

  it('shell 的 renderOrder 递增且 >= 100', () => {
    const baseMesh = makeBaseMesh();
    const furMat = new FurMaterial();
    const shell = new FurShell({ baseMesh, furMaterial: furMat, shellCount: 4 });
    shell.generate();
    for (let i = 0; i < 4; i++) {
      expect(shell.shells[i].renderOrder).toBe(100 + i);
    }
  });
});
