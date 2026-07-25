// SceneSerializer 测试 — Scene ↔ SceneJSON 往返
//
// 验证:
//   • 空 Scene 序列化/反序列化
//   • 嵌套 children 结构
//   • Mesh + geometry + material 完整往返
//   • background / fog 序列化
//   • userData 保留
//   • Object3D / Group / Mesh 多类型分派
//   • 多材质数组
import { describe, it, expect } from 'vitest';
import { Scene } from '../Core/Scene';
import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import { Object3D } from '../Core/Object3D';
import { BufferGeometry } from '../Core/BufferGeometry';
import { BufferAttribute } from '../Core/BufferAttribute';
import { Color } from '../Math/Color';
import { Fog } from '../Core/Fog';
import { FogExp2 } from '../Core/FogExp2';
import { StandardMaterial } from '../Materials/StandardMaterial';
import { PhongMaterial } from '../Materials/MeshPhongMaterial';
import { MeshBasicMaterial } from '../Materials/MeshBasicMaterial';
import type { Material } from '../Core/Material';
import {
  SceneSerializer,
  SCENE_SERIALIZER_VERSION,
  serializeObject,
  deserializeObject,
} from './SceneSerializer';
import type { SceneJSON } from './types';

function makeTriangleGeometry(): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(
    new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]),
    3,
  ));
  g.setIndex([0, 1, 2]);
  return g;
}

describe('SceneSerializer — 基础', () => {
  it('空 Scene 序列化为合法 JSON', () => {
    const scene = new Scene();
    const json = SceneSerializer.serialize(scene);
    expect(json.version).toBe(SCENE_SERIALIZER_VERSION);
    expect(json.objects).toEqual([]);
    expect(json.background).toBeNull();
    expect(json.fog).toBeNull();
    expect(json.environment).toBeNull();
    expect(json.metadata.generator).toBe('VREEN SceneSerializer');
    expect(json.metadata.created).toBeTruthy();
  });

  it('空 SceneJSON 反序列化为空 Scene', () => {
    const json: SceneJSON = {
      version: SCENE_SERIALIZER_VERSION,
      metadata: {},
      background: null,
      environment: null,
      fog: null,
      objects: [],
    };
    const scene = SceneSerializer.deserialize(json);
    expect(scene).toBeInstanceOf(Scene);
    expect(scene.children.length).toBe(0);
    expect(scene.background).toBeNull();
    expect(scene.fog).toBeNull();
  });
});

describe('SceneSerializer — background / fog', () => {
  it('Color 背景序列化为数字', () => {
    const scene = new Scene();
    scene.background = new Color(0xff8800);
    const json = SceneSerializer.serialize(scene);
    expect(json.background).toBe(0xff8800);
    const restored = SceneSerializer.deserialize(json);
    expect(restored.background).toBeInstanceOf(Color);
    expect((restored.background as Color).getHex()).toBe(0xff8800);
  });

  it('字符串背景往返', () => {
    const scene = new Scene();
    scene.background = '#abcdef';
    const json = SceneSerializer.serialize(scene);
    expect(json.background).toBe('#abcdef');
    const restored = SceneSerializer.deserialize(json);
    expect(restored.background).toBe('#abcdef');
  });

  it('Fog (线性雾) 往返', () => {
    const scene = new Scene();
    scene.fog = new Fog(0xaaaaaa, 1, 100);
    const json = SceneSerializer.serialize(scene);
    expect(json.fog).not.toBeNull();
    expect(json.fog!.type).toBe('Fog');
    expect(json.fog!.color).toBe(0xaaaaaa);
    expect(json.fog!.near).toBe(1);
    expect(json.fog!.far).toBe(100);
    const restored = SceneSerializer.deserialize(json);
    expect(restored.fog).toBeInstanceOf(Fog);
    expect((restored.fog as Fog).color.getHex()).toBe(0xaaaaaa);
    expect((restored.fog as Fog).near).toBe(1);
    expect((restored.fog as Fog).far).toBe(100);
  });

  it('FogExp2 (指数雾) 往返', () => {
    const scene = new Scene();
    scene.fog = new FogExp2(0x123456, 0.005);
    const json = SceneSerializer.serialize(scene);
    expect(json.fog).not.toBeNull();
    expect(json.fog!.type).toBe('FogExp2');
    expect(json.fog!.color).toBe(0x123456);
    expect(json.fog!.density).toBe(0.005);
    const restored = SceneSerializer.deserialize(json);
    expect(restored.fog).toBeInstanceOf(FogExp2);
    expect((restored.fog as FogExp2).color.getHex()).toBe(0x123456);
    expect((restored.fog as FogExp2).density).toBe(0.005);
  });
});

describe('SceneSerializer — 嵌套 children', () => {
  it('Group + Object3D 嵌套往返', () => {
    const scene = new Scene();
    const group = new Group();
    group.name = 'root-group';
    group.position.set(1, 2, 3);
    const child1 = new Object3D();
    child1.name = 'child-a';
    child1.scale.set(2, 2, 2);
    const child2 = new Object3D();
    child2.name = 'child-b';
    child2.visible = false;
    group.add(child1);
    group.add(child2);
    scene.add(group);

    const json = SceneSerializer.serialize(scene);
    expect(json.objects.length).toBe(1);
    expect(json.objects[0].type).toBe('Group');
    expect(json.objects[0].name).toBe('root-group');
    expect(json.objects[0].position).toEqual([1, 2, 3]);
    expect(json.objects[0].children.length).toBe(2);
    expect(json.objects[0].children[0].name).toBe('child-a');
    expect(json.objects[0].children[0].scale).toEqual([2, 2, 2]);
    expect(json.objects[0].children[1].name).toBe('child-b');
    expect(json.objects[0].children[1].visible).toBe(false);

    const restored = SceneSerializer.deserialize(json);
    expect(restored.children.length).toBe(1);
    const rGroup = restored.children[0];
    expect(rGroup).toBeInstanceOf(Group);
    expect(rGroup.name).toBe('root-group');
    expect(rGroup.position.toArray()).toEqual([1, 2, 3]);
    expect(rGroup.children.length).toBe(2);
    expect(rGroup.children[0].name).toBe('child-a');
    expect(rGroup.children[0].scale.toArray()).toEqual([2, 2, 2]);
    expect(rGroup.children[1].name).toBe('child-b');
    expect(rGroup.children[1].visible).toBe(false);
  });
});

describe('SceneSerializer — Mesh + geometry + material', () => {
  it('Mesh with StandardMaterial 往返', () => {
    const scene = new Scene();
    const geom = makeTriangleGeometry();
    const mat = new StandardMaterial();
    mat.baseColor = { r: 0.8, g: 0.2, b: 0.1 };
    mat.metallic = 0.7;
    mat.roughness = 0.3;
    const mesh = new Mesh(geom, mat);
    mesh.name = 'triangle';
    mesh.position.set(5, 0, 0);
    scene.add(mesh);

    const json = SceneSerializer.serialize(scene);
    const meshJSON = json.objects[0];
    expect(meshJSON.type).toBe('Mesh');
    expect(meshJSON.name).toBe('triangle');
    expect(meshJSON.geometry).toBeDefined();
    expect(typeof meshJSON.geometry).toBe('object');
    expect(meshJSON.material).toBeDefined();
    expect(typeof meshJSON.material).toBe('object');
    const matJSON = meshJSON.material as { type: string; uniforms: Record<string, unknown> };
    expect(matJSON.type).toBe('Standard');
    expect(matJSON.uniforms.baseColor).toEqual({ r: 0.8, g: 0.2, b: 0.1 });
    expect(matJSON.uniforms.metallic).toBe(0.7);
    expect(matJSON.uniforms.roughness).toBe(0.3);

    const restored = SceneSerializer.deserialize(json);
    expect(restored.children.length).toBe(1);
    const rMesh = restored.children[0];
    expect(rMesh).toBeInstanceOf(Mesh);
    expect(rMesh.name).toBe('triangle');
    expect(rMesh.position.toArray()).toEqual([5, 0, 0]);
    const rMat = (rMesh as Mesh).material as StandardMaterial;
    expect(rMat.type).toBe('Standard');
    expect(rMat.baseColor).toEqual({ r: 0.8, g: 0.2, b: 0.1 });
    expect(rMat.metallic).toBe(0.7);
    expect(rMat.roughness).toBe(0.3);
    // geometry
    const rGeom = (rMesh as Mesh).geometry;
    expect(rGeom.attributes.position.itemSize).toBe(3);
    expect(Array.from(rGeom.attributes.position.array)).toEqual([0, 0, 0, 1, 0, 0, 1, 1, 0]);
    expect(rGeom.index).not.toBeNull();
  });

  it('Mesh with material 数组往返', () => {
    const scene = new Scene();
    const geom = makeTriangleGeometry();
    geom.groups = [{ start: 0, count: 3, materialIndex: 0 }];
    const mat1 = new MeshBasicMaterial({ color: { r: 1, g: 0, b: 0 } });
    const mat2 = new PhongMaterial({ color: { r: 0, g: 1, b: 0 } });
    const mesh = new Mesh(geom, [mat1, mat2]);
    scene.add(mesh);

    const json = SceneSerializer.serialize(scene);
    const meshJSON = json.objects[0];
    expect(Array.isArray(meshJSON.material)).toBe(true);
    const mats = meshJSON.material as Array<{ type: string; uniforms: Record<string, unknown> }>;
    expect(mats.length).toBe(2);
    expect(mats[0].type).toBe('MeshBasic');
    expect(mats[1].type).toBe('Phong');

    const restored = SceneSerializer.deserialize(json);
    const rMesh = restored.children[0] as Mesh;
    expect(Array.isArray(rMesh.material)).toBe(true);
    const rMats = rMesh.material as Material[];
    expect(rMats.length).toBe(2);
    expect(rMats[0].type).toBe('MeshBasic');
    expect(rMats[1].type).toBe('Phong');
  });

  it('userData 往返', () => {
    const scene = new Scene();
    const mesh = new Mesh(makeTriangleGeometry(), new StandardMaterial());
    mesh.userData = { tag: 'enemy', hp: 100 };
    scene.add(mesh);

    const json = SceneSerializer.serialize(scene);
    expect(json.objects[0].userData).toEqual({ tag: 'enemy', hp: 100 });

    const restored = SceneSerializer.deserialize(json);
    expect(restored.children[0].userData).toEqual({ tag: 'enemy', hp: 100 });
  });
});

describe('SceneSerializer — 对象分派', () => {
  it('serializeObject / deserializeObject 直接调用', () => {
    const group = new Group();
    group.name = 'g';
    const obj = new Object3D();
    obj.name = 'o';
    group.add(obj);
    const json = serializeObject(group);
    expect(json.type).toBe('Group');
    expect(json.children[0].type).toBe('Object3D');
    const restored = deserializeObject(json);
    expect(restored).toBeInstanceOf(Group);
    expect(restored.children[0]).toBeInstanceOf(Object3D);
  });

  it('未注册 type 退化为 Object3D', () => {
    const json = {
      uuid: 'abc',
      type: 'CustomType',
      name: 'custom',
      position: [0, 0, 0] as [number, number, number],
      rotation: [0, 0, 0, 1] as [number, number, number, number],
      scale: [1, 1, 1] as [number, number, number],
      visible: true,
      children: [],
    };
    const obj = deserializeObject(json);
    expect(obj).toBeInstanceOf(Object3D);
    expect(obj.name).toBe('custom');
  });
});

describe('SceneSerializer — 实例 API', () => {
  it('new SceneSerializer().serialize 等价于静态方法', () => {
    const scene = new Scene();
    scene.add(new Object3D());
    const s = new SceneSerializer();
    const j1 = s.serialize(scene);
    const j2 = SceneSerializer.serialize(scene);
    expect(j1.objects.length).toBe(j2.objects.length);
    expect(j1.version).toBe(j2.version);
  });

  it('generator 选项自定义', () => {
    const scene = new Scene();
    const json = SceneSerializer.serialize(scene, { generator: 'MyTool' });
    expect(json.metadata.generator).toBe('MyTool');
  });
});
