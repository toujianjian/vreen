// convertCustomToThree — 把自研 engine 的 scene graph（Group / Mesh / StandardMaterial）
// 转成 three.js 对象，使得预设生成器产生的自研对象能在标准 three.js 渲染路径下正常显示。
//
// PresetPreviews（Gallery 卡片）、ViewerPage 的默认渲染都走 three.js 的 r3f Canvas，
// 而预设生成器（@/three/generators）返回的是 @/engine 的自研对象（含自定义的
// BufferGeometry / StandardMaterial）。three.js 不认这些对象，模型会完全不可见。
//
// 转换策略：深度遍历自研对象树，对每个 Mesh 创建 THREE.Mesh，复制 geometry 数据
//（position / normal / uv / index）到 THREE.BufferAttribute，复制材质属性
//（baseColor / metallic / roughness / emissive）到 THREE.MeshStandardMaterial。

import * as THREE from 'three';
import type { Object3D as CustomObject3D } from '@/engine/Core/Object3D';
import type { BufferGeometry as CustomBufferGeometry } from '@/engine/Core/BufferGeometry';
import type { BufferAttribute as CustomBufferAttribute } from '@/engine/Core/BufferAttribute';
import type { StandardMaterial as CustomStandardMaterial } from '@/engine/Materials/StandardMaterial';
import type { Material as CustomMaterial } from '@/engine/Core/Material';
import { generateTextureSet } from './proceduralTextures';

/** 检测是否为自研 engine 的 Object3D（非 three.js）。
 *  用于在 normalizeObject / convertCustomToThree 等场景中区分运行时。 */
export function isCustomObject3D(root: unknown): root is CustomObject3D {
  if (!root || typeof root !== 'object') return false;
  const obj = root as Record<string, unknown>;
  return (
    typeof obj.type === 'string' &&
    obj.type !== 'Object3D' && // three.js Object3D 也有 type
    !(obj as { isObject3D?: boolean }).isObject3D &&
    typeof obj.updateMatrixWorld === 'function' &&
    typeof (obj as { updateWorldMatrix?: unknown }).updateWorldMatrix === 'function'
  );
}

/** 把自研 engine 的 scene graph 根节点转为一棵三.js 对象树。 */
export function convertToThreeObject(root: CustomObject3D): THREE.Object3D {
  return convertNode(root);
}

function convertNode(custom: CustomObject3D): THREE.Object3D {
  if ((custom as { isMesh?: boolean }).isMesh) {
    return convertMesh(custom as CustomObject3D & {
      geometry: CustomBufferGeometry;
      material: CustomMaterial | CustomMaterial[];
    });
  }
  // Group / 其他节点
  const group = new THREE.Group();
  group.name = custom.name;
  group.position.set(custom.position.x, custom.position.y, custom.position.z);
  group.quaternion.set(custom.rotation.x, custom.rotation.y, custom.rotation.z, custom.rotation.w);
  group.scale.set(custom.scale.x, custom.scale.y, custom.scale.z);
  group.visible = custom.visible;
  for (const child of custom.children) {
    group.add(convertNode(child as CustomObject3D));
  }
  return group;
}

function convertMesh(custom: CustomObject3D & {
  geometry: CustomBufferGeometry;
  material: CustomMaterial | CustomMaterial[];
  castShadow?: boolean;
  receiveShadow?: boolean;
}): THREE.Mesh {
  const geo = convertGeometry(custom.geometry);
  const mat = Array.isArray(custom.material)
    ? custom.material.map((m) => convertMaterial(m))
    : convertMaterial(custom.material);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = custom.name;
  mesh.position.set(custom.position.x, custom.position.y, custom.position.z);
  mesh.quaternion.set(custom.rotation.x, custom.rotation.y, custom.rotation.z, custom.rotation.w);
  mesh.scale.set(custom.scale.x, custom.scale.y, custom.scale.z);
  mesh.visible = custom.visible;
  mesh.castShadow = custom.castShadow ?? true;
  mesh.receiveShadow = custom.receiveShadow ?? true;
  return mesh;
}

function convertGeometry(custom: CustomBufferGeometry): THREE.BufferGeometry {
  // 自研 engine 的 CylinderGeometry/ConeGeometry 用 groups 跳过未实现的顶底面。
  // 检测到 groups 存在时,从 position 数据推断参数,用 THREE.js 内置几何体生成完整模型(含顶底面)。
  if (custom.groups && custom.groups.length > 0) {
    return rebuildCylinderGeometry(custom);
  }

  const geo = new THREE.BufferGeometry();

  // 复制 index
  if (custom.index) {
    const idxAttr = custom.index as CustomBufferAttribute;
    const rawArr = idxAttr.array as unknown as ArrayLike<number>;
    // 用 Array.from 统一取最大索引，无论底层是 Uint16/Uint32/Float32Array
    const max = Math.max(...Array.from(rawArr));
    if (rawArr instanceof Uint16Array || rawArr instanceof Uint32Array) {
      geo.setIndex(new THREE.BufferAttribute(rawArr.slice(), 1));
    } else {
      // Float32Array as index → 转成 Uint16/Uint32
      const arr = rawArr as unknown as ArrayLike<number>;
      if (max < 65536) {
        geo.setIndex(new THREE.BufferAttribute(new Uint16Array(arr as unknown as ArrayBuffer), 1));
      } else {
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(arr as unknown as ArrayBuffer), 1));
      }
    }
  }

  // 复制 vertex attributes
  for (const [name, attr] of Object.entries(custom.attributes)) {
    const customAttr = attr as CustomBufferAttribute;
    const array = customAttr.array.slice(); // 深拷贝
    const itemSize = customAttr.itemSize;
    // three.js 的需要是 Float32Array
    const f32 = array instanceof Float32Array ? array : new Float32Array(array);
    geo.setAttribute(name, new THREE.BufferAttribute(f32, itemSize));
  }

  // 必须计算 boundingSphere,否则 THREE.js 渲染器可能错误裁剪
  geo.computeBoundingSphere();

  return geo;
}

/** 自研 CylinderGeometry 不含顶底面。从 position 数据推断参数,
 *  用 THREE.CylinderGeometry 重建含完整顶底面的几何体。 */
function rebuildCylinderGeometry(custom: CustomBufferGeometry): THREE.BufferGeometry {
  const posAttr = custom.attributes.position as CustomBufferAttribute | undefined;
  if (!posAttr) return new THREE.BufferGeometry();

  const pos = posAttr.array;
  const count = posAttr.count;

  // 找 Y 范围
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < count * 3; i += 3) {
    const y = pos[i];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const height = maxY - minY || 1;

  // 收集每个 Y 层的半径:遍历所有顶点,按 y 聚类
  const eps = 0.001;
  const rings: { y: number; radii: number[] }[] = [];
  for (let i = 0; i < count; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    const r = Math.hypot(x, z);
    let found = false;
    for (const ring of rings) {
      if (Math.abs(ring.y - y) < eps) {
        ring.radii.push(r);
        found = true;
        break;
      }
    }
    if (!found) rings.push({ y, radii: [r] });
  }
  rings.sort((a, b) => a.y - b.y);

  if (rings.length < 2) return new THREE.BufferGeometry();

  const bottomRing = rings[0];
  const topRing = rings[rings.length - 1];
  // 用中位数半径
  const bottomR = median(bottomRing.radii);
  const topR = median(topRing.radii);
  // 径向分段数:自研引擎每环有 radialSegments + 1 个顶点(末位与首位位置重叠)
  const radialSegments = bottomRing.radii.length - 1;

  const isCone = topR < bottomR * 0.01 || bottomR < topR * 0.01;

  // 用 THREE.js 内置几何体(含顶底面)
  const threeGeo = isCone
    ? new THREE.ConeGeometry(Math.max(bottomR, topR), height, radialSegments, 1, !isCone)
    : new THREE.CylinderGeometry(topR, bottomR, height, radialSegments, 1, false);

  // 将几何体居中到原点(我们的 cylinder 以 Y 轴对称,中心在原点,与 THREE.js 一致)
  // THREE.js CylinderGeometry 也是 Y 轴对称,中心在原点,所以无需偏移

  return threeGeo;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function convertMaterial(custom: CustomMaterial): THREE.Material {
  const std = custom as unknown as CustomStandardMaterial;
  const mat = new THREE.MeshStandardMaterial();

  if (std.baseColor) {
    mat.color.setRGB(std.baseColor.r, std.baseColor.g, std.baseColor.b);
  }
  if (std.metallic !== undefined) mat.metalness = std.metallic;
  if (std.roughness !== undefined) mat.roughness = std.roughness;
  if (std.emissive) {
    mat.emissive.setRGB(std.emissive.r, std.emissive.g, std.emissive.b);
  }
  if (std.emissiveIntensity !== undefined) mat.emissiveIntensity = std.emissiveIntensity;
  if (std.opacity !== undefined) {
    mat.opacity = std.opacity;
    // StandardMaterial 没有 transparent 属性,显式判断
    const hasTransparent = (std as unknown as { transparent?: boolean }).transparent;
    mat.transparent = hasTransparent !== undefined ? hasTransparent : std.opacity < 1;
  }
  if (std.wireframe !== undefined) mat.wireframe = std.wireframe;
  // 继承 depthWrite / depthTest（自研材质有默认值 true）
  if (std.depthWrite !== undefined) mat.depthWrite = std.depthWrite;
  if (std.depthTest !== undefined) mat.depthTest = std.depthTest;
  // 双面渲染:自研 engine 的几何体绕序可能和 THREE.js 默认不同
  mat.side = THREE.DoubleSide;

  mat.name = (std as unknown as { name?: string }).name || custom.type || 'converted';

  // 生成程序化纹理
  const texes = generateTextureSet(
    mat.color,
    mat.metalness,
    mat.roughness,
    mat.emissive,
    mat.emissiveIntensity,
  );
  mat.map = texes.map;
  if (texes.roughnessMap) mat.roughnessMap = texes.roughnessMap;
  if (texes.emissiveMap) mat.emissiveMap = texes.emissiveMap;
  if (texes.normalMap) mat.normalMap = texes.normalMap;
  mat.needsUpdate = true;

  return mat;
}
