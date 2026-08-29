// ModelLoader — 引擎侧唯一的模型导入入口，零 three.js 依赖。
//
// 背景：上传路径曾经按格式分流 —— .glb 走引擎 GLBLoader，而 .obj/.fbx/.stl/.ply
// 会绕道 src/three/loaders.ts 用 three.js 的 OBJLoader / FBXLoader / STLLoader /
// PLYLoader 解析。现在所有格式都直接走引擎自己的解析器，three.js 不再是导入链
// 上的一环：
//
//   glb   → GLBLoader        GLB 容器 + glTF 2.0 构建（含动画 / 蒙皮）
//   obj   → parseOBJ         文本解析，每个 o/g 段一个 Mesh
//   fbx   → parseFbxBinary   仅二进制 FBX（ASCII FBX 会抛明确错误）
//   stl   → parseSTL         纯几何 → 包成 Mesh
//   ply   → parsePLY         纯几何 → 包成 Mesh
//   gltf  → 不支持           引擎读单文件 GLB 容器；多文件 glTF（JSON + 外部
//                            .bin）缺少资源解析上下文，需要重新导出为 .glb
//
// API:
//   const bytes = await file.arrayBuffer();
//   const { root, animations } = await loadModelBytes(bytes, 'obj');
//   scene.add(root);

import { Group } from '../Core/Group';
import { Mesh } from '../Core/Mesh';
import type { BufferGeometry } from '../Core/BufferGeometry';
import { StandardMaterial } from '../Materials/StandardMaterial';
import type { AnimationClip } from '../Animation';
import { GLBLoader } from './GLBLoader';
import { parseOBJ } from './OBJLoader';
import { parseFbxBinary } from './FBXLoader';
import { parseSTL } from './STLLoader';
import { parsePLY } from './PLYLoader';
import { createLogger } from '@/lib/logger';

const log = createLogger('ModelLoader');

/** 引擎可直接导入的格式（与 app 侧 ModelFormat 同形）。 */
export type EngineModelFormat = 'glb' | 'gltf' | 'obj' | 'fbx' | 'stl' | 'ply';

export interface EngineModel {
  root: Group;
  animations: AnimationClip[];
  format: EngineModelFormat;
}

const GLTF_NOT_SUPPORTED =
  '.gltf is not supported by the engine loader: it reads the single-file .glb container, ' +
  'while multi-file glTF (JSON + external .bin) has no resource-resolution context here. ' +
  'Re-export the model as a single .glb file and try again.';

/**
 * 用引擎自己的解析器把模型文件字节变成引擎场景图。
 * 不碰 three.js —— 任何格式的导入都不需要它。
 */
export async function loadModelBytes(
  bytes: ArrayBuffer,
  format: EngineModelFormat,
): Promise<EngineModel> {
  const t0 = performance.now();
  const model =
    format === 'glb'
      ? await loadGlb(bytes)
      : format === 'obj'
        ? loadObj(bytes)
        : format === 'fbx'
          ? loadFbx(bytes)
          : format === 'stl'
            ? loadGeometry(parseSTL(bytes), 'stl', 'STL_ROOT')
            : format === 'ply'
              ? loadGeometry(parsePLY(bytes), 'ply', 'PLY_ROOT')
              : await Promise.reject(new Error(GLTF_NOT_SUPPORTED));
  log.info(
    `imported ${format.toUpperCase()} via engine loaders in ${(performance.now() - t0).toFixed(1)}ms ` +
      `(${model.root.children.length} top-level children, ${model.animations.length} clips)`,
  );
  return model;
}

async function loadGlb(bytes: ArrayBuffer): Promise<EngineModel> {
  const result = await new GLBLoader().load(bytes);
  return { root: result.root, animations: result.animations, format: 'glb' };
}

function loadObj(bytes: ArrayBuffer): EngineModel {
  const text = new TextDecoder().decode(new Uint8Array(bytes));
  const { root } = parseOBJ(text);
  return { root, animations: [], format: 'obj' };
}

function loadFbx(bytes: ArrayBuffer): EngineModel {
  const result = parseFbxBinary(new Uint8Array(bytes));
  return { root: result.root, animations: [], format: 'fbx' };
}

/** STL / PLY 只有几何数据，补一个默认材质 + 网格包装成统一的 Group 根。 */
function loadGeometry(geom: BufferGeometry, format: 'stl' | 'ply', rootName: string): EngineModel {
  if (!geom.getAttribute('normal')) geom.computeVertexNormals();
  geom.computeBoundingBox();
  const mesh = new Mesh(geom, new StandardMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = rootName;
  const root = new Group();
  root.name = rootName;
  root.add(mesh);
  return { root, animations: [], format };
}
