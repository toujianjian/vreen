# GPUPicking Module — O(1) Object Picking via Offscreen ID Rendering

> **VREEN Engine** · `src/engine/Renderer/GPUPicking.ts`
>
> GPU 加速物体拾取模块,适配自 [three.js ColorPickMesh](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/interactive/SelectionBox.js) 的颜色编码思路与 [o3de Atom EditorMeshPickPass](https://www.o3de.org/docs/atom-guide/dev-guide/atom-features/#editor-mesh-pick-pass)。把每个可拾取物体编码为唯一 24-bit `pickId`,渲染到离屏 MRT FBO,`pick(x, y)` 用 `readPixels` 单像素 O(1) 读取并解码,适合海量物体的编辑器框选 / 悬停高亮 / 点击选中场景。
>
> **设计原则**:纯逻辑可测试。`encodeId24` / `decodeId24` / `encodeId24Uniform` 是与 GLSL `encodeId24()` 位级 1:1 的纯函数,无 WebGL 依赖,可在 Node / 无头环境测试。`GPUPicking` 类的 GL 调用集中在 `render()` / `pick()` / `dispose()`,`register` / `unregister` / `lookup` 等映射操作不依赖 GL。

---

## 目录

- [概述](#概述)
- [架构](#架构)
- [核心概念](#核心概念)
  - [pickId 与 Object3D.id 的区别](#pickid-与-object3did-的区别)
  - [24-bit ID 编码 / 解码](#24-bit-id-编码--解码)
  - [MRT 双附件(物体 id + 实例 id)](#mrt-双附件物体-id--实例-id)
  - [深度测试保证最前面物体](#深度测试保证最前面物体)
- [模块清单](#模块清单)
- [API 参考](#api-参考)
  - [纯函数](#纯函数)
  - [GPUPicking 类](#gpupicking-类)
  - [GPUPickResult](#gpupickresult)
  - [GPUPickingOptions](#gpupickingoptions)
- [Shader 参考](#shader-参考)
- [使用示例](#使用示例)
  - [基础:注册 + 单点拾取](#基础注册--单点拾取)
  - [InstancedMesh 逐实例拾取](#instancedmesh-逐实例拾取)
  - [框选(box select)](#框选box-select)
  - [与 Raycaster 级联(精确命中点)](#与-raycaster-级联精确命中点)
  - [分辨率缩放(性能优先)](#分辨率缩放性能优先)
- [与 CPU Raycaster 的关系](#与-cpu-raycaster-的关系)
- [与 three.js / o3de 的差异](#与-threejs--o3de-的差异)
- [性能考量](#性能考量)
- [测试](#测试)
- [集成说明](#集成说明)

---

## 概述

物体拾取(picking)是编辑器 / 交互式应用的核心能力:用户点击屏幕,引擎需要判断"点中了哪个物体"。两种主流方案:

| 方案 | 复杂度 | 返回信息 | 适用场景 |
|------|--------|----------|----------|
| **CPU Raycaster** | O(三角形数) | 精确 `faceIndex` / `uv` / `point` / `instanceId` | 需要精确命中点(放置标记、绘制贴花)、场景物体较少 |
| **GPU Picking** | O(1)(单像素 `readPixels`) | `object` + `instanceId`(无 faceIndex/uv) | 海量物体的编辑器框选 / 悬停高亮 / 点击选中 |

VREEN 同时提供两条路径,且可**级联**:GPUPicking 先 O(1) 确定命中物体,再对该单物体调 `Raycaster.intersectObject` 取精确 `faceIndex` / `uv` / `point`(O(该物体三角形数),通常很小)。这样既保留 O(1) 的拾取响应,又能在需要时拿到精确命中信息。

本模块对标 o3de Atom 的 `EditorMeshPickPass`(离屏 ID 渲染)与 three.js 的 `SelectionBox` / `ColorPickMesh`(颜色编码),并在以下方面增强:

- **MRT 双附件**:物体 id 与实例 id 分离到两个 RGBA8 附件,避免单纹理 24-bit 容量限制。
- **InstancedMesh 逐实例 id**:每个实例有独立 `a_instanceId` 属性,可直接定位到具体实例。
- **框选去重**:`pickRect` 一次性读矩形区域,去重返回命中物体集合。
- **`resolutionScale`**:支持半分辨率渲染(0.5x),框选大区域时性能提升 4 倍。
- **1:1 CPU/GPU 编解码参考**:`encodeId24` / `decodeId24` 纯函数与 GLSL 位级一致,无头可测。

---

## 架构

```
┌─────────────────────────────────────────────────────────────────┐
│                     应用 / 编辑器层                              │
│  (鼠标事件 → pixelX/pixelY → pickAt / pickRect → 选中物体)       │
└───────────────▲─────────────────────────────────────────────────┘
                │ pickAt(gl, camera, x, y) / pickRect(...)
┌───────────────┴─────────────────────────────────────────────────┐
│                       GPUPicking                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ id ↔ object  │  │ render(gl,cam)│  │ pick(gl,x,y)         │   │
│  │ 双向映射     │  │ 离屏 ID 渲染  │  │ readPixels + decode  │   │
│  └──────────────┘  └──────┬───────┘  └──────────▲───────────┘   │
│                           │                      │               │
│  ┌────────────────────────▼──────────────────────┴───────────┐  │
│  │  MRTTarget (2 × RGBA8 + DEPTH24)                          │  │
│  │  attachment 0: object pickId (RGB) + alpha(命中标记)       │  │
│  │  attachment 1: instanceId (RGB) + alpha(命中标记)          │  │
│  │  depth attachment: DEPTH_COMPONENT24(最前面物体)           │  │
│  └────────────────────────▲──────────────────────────────────┘  │
│                           │                                     │
│  ┌────────────────────────┴──────────────────────────────────┐  │
│  │  ShaderProgram (PICK_VERT + PICK_FRAG)                    │  │
│  │  ShaderProgram (PICK_INSTANCED_VERT + PICK_FRAG)          │  │
│  └────────────────────────▲──────────────────────────────────┘  │
│                           │                                     │
│  ┌────────────────────────┴──────────────────────────────────┐  │
│  │  VAO / Buffer 缓存(WeakMap<BufferGeometry, GeomResources>)│  │
│  │  + Instanced 缓存(WeakMap<InstancedMesh, InstancedResources>)│  │
│  └───────────────────────────────────────────────────────────┘  │
└────────────────────────▲────────────────────────────────────────┘
                         │ WebGL2 API
                         ▼
                  浏览器 GPU
```

---

## 核心概念

### pickId 与 Object3D.id 的区别

- **`Object3D.id`**:引擎全局自增(从 1 开始),可能很大且稀疏(场景里只有 10 个物体,id 可能是 1, 47, 102, ...)。不适合直接编码到 24-bit 颜色(虽然够大,但稀疏浪费编码空间,且 `id` 在反序列化 / 跨会话时不保证稳定)。
- **`pickId`**:`GPUPicking` 本地分配的稠密递增 id(从 1 开始,0 保留给"背景/无命中")。`register(object)` 时分配,`unregister` 后不回收(避免映射混乱),`clear()` / `dispose()` 后重置为 1。稠密性保证 pickId 永远 ≤ 已注册物体数 + 1,远小于 2^24 上限。

### 24-bit ID 编码 / 解码

pickId 编码为 RGB 三字节(每个 0..255),写入 RGBA8 纹理的 R/G/B 通道,A 通道作为"命中标记"(255 = 命中,0 = 背景)。

**编码公式**(与 GLSL `encodeId24()` 1:1):

```typescript
function encodeId24(id: number): [number, number, number] {
  const u = id >>> 0;
  return [u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff];
}
```

```glsl
vec3 encodeId24(uint id) {
  float r = float(id & 0xFFu) / 255.0;
  float g = float((id >> 8) & 0xFFu) / 255.0;
  float b = float((id >> 16) & 0xFFu) / 255.0;
  return vec3(r, g, b);
}
```

**解码公式**:

```typescript
function decodeId24(r: number, g: number, b: number): number {
  return (r & 0xff) | ((g & 0xff) << 8) | ((b & 0xff) << 16);
}
```

**容量**:24-bit 最多编码 2^24 = 16,777,216(约 1677 万)个物体。`MAX_PICK_ID = 0xffffff`。超过抛 `RangeError`。

### MRT 双附件(物体 id + 实例 id)

单个 RGBA8 纹理的 RGB 用于物体 id 后,A 通道只剩"命中标记"功能,无法再编码实例 id。本模块用 **MRTTarget(colorCount=2)** 渲染到两个颜色附件:

| 附件 | 格式 | R | G | B | A |
|------|------|---|---|---|---|
| attachment 0 | RGBA8 | pickId 字节 0 | pickId 字节 1 | pickId 字节 2 | 255(命中)/ 0(背景) |
| attachment 1 | RGBA8 | instanceId 字节 0 | instanceId 字节 1 | instanceId 字节 2 | 255(实例)/ 0(非实例) |

`pick()` 先 `readBuffer(COLOR_ATTACHMENT0)` + `readPixels` 读物体 id;再 `readBuffer(COLOR_ATTACHMENT1)` + `readPixels` 读实例 id。两次读取都是 1 像素,O(1)。

### 深度测试保证最前面物体

拾取 FBO 带深度附件(`DEPTH_COMPONENT24`),`render()` 时启用 `DEPTH_TEST` + `depthMask(true)` + `LEQUAL`。多个物体重叠时,只有最前面的物体 id 写入颜色附件(后面的被深度测试丢弃)。这样 `pick()` 读到的就是用户视觉上"看到"的物体。

---

## 模块清单

| 文件 | 职责 |
|------|------|
| `GPUPicking.ts` | 拾取器主类 + 纯函数(`encodeId24` / `decodeId24` / `encodeId24Uniform`) |
| `GPUPicking.test.ts` | 44 个单元测试(纯函数 + 映射 + GPU 路径 MockGL2) |
| `Materials/shaders.ts` | `PICK_VERT` / `PICK_INSTANCED_VERT` / `PICK_FRAG` shader 常量 |
| `MRTTarget.ts`(复用) | 离屏 MRT FBO(2 RGBA8 + 深度) |
| `ShaderProgram.ts`(复用) | shader 编译 / uniform 设置 |

---

## API 参考

### 纯函数

#### `encodeId24(id: number): [number, number, number]`

把 24-bit pickId 编码为 `[r, g, b]` 三字节(0..255)。与 GLSL `encodeId24()` 1:1。

- **参数**:`id` ∈ [0, `MAX_PICK_ID`]
- **返回**:`[r, g, b]`,每个 0..255
- **抛错**:`id < 0` 或 `id > MAX_PICK_ID` 时抛 `RangeError`

#### `decodeId24(r: number, g: number, b: number): number`

把 `[r, g, b]`(0..255)解码为 24-bit pickId。`encodeId24` 的逆函数。忽略高位字节(只取低 8 位),直接配合 `Uint8Array` 读出的 `readPixels` 数据。

#### `encodeId24Uniform(id: number): [number, number, number]`

把 pickId 编码为归一化 `[r, g, b]`(0..1),供直接写入 GLSL `u_pickId` uniform。等价于 `encodeId24(id).map(v => v / 255)`。

#### `MAX_PICK_ID`

常量 `0xffffff`(2^24 - 1 = 16,777,215)。pickId 上限。

### GPUPicking 类

#### `constructor(opts?: GPUPickingOptions)`

创建拾取器。默认 `resolutionScale=1.0`、`skipInvisible=true`。

#### `register(object: Object3D): number`

注册一个可拾取物体。**幂等**:同一物体重复注册返回已有 pickId。

- **返回**:分配的 pickId(1 .. MAX_PICK_ID)
- **抛错**:pickId 溢出(超过 1677 万)时抛 `Error`

#### `registerAll(objects: Iterable<Object3D>): { registered: number; skipped: number }`

批量注册。`skipInvisible=true` 时跳过 `visible=false` 的物体。返回 `{registered, skipped}` 统计。

#### `unregister(object: Object3D): void`

注销物体。释放其 pickId(**不回收** id,避免映射混乱;新物体会拿到更大的 id)。

#### `clear(): void`

清空所有注册,并重置 pickId 计数器为 1。

#### `has(object: Object3D): boolean`

查询物体是否已注册。

#### `count: number`(getter)

已注册物体数量。

#### `lookup(pickId: number): Object3D | null`

按 pickId 查物体(找不到返回 null)。

#### `pickIdOf(object: Object3D): number`

获取物体的 pickId(未注册返回 0,即"背景")。

#### `getRegisteredObjects(): Object3D[]`

返回所有已注册物体数组(顺序不保证)。

#### `render(gl, camera, canvasW?, canvasH?): void`

把所有已注册物体渲染到拾取 FBO。

- 调用前需确保 `camera.matrixWorld` / `matrixWorldInverse` 已更新。
- `canvasW` / `canvasH` 不传时用 `gl.canvas.width / height`。
- 跳过:`visible=false`(若 `skipInvisible`)、非 `Mesh` 物体、无 `position` 属性的几何体。

#### `pick(gl, pixelX, pixelY): GPUPickResult | null`

读取 `(pixelX, pixelY)` 像素的物体 id(假设 `render()` 已调用)。

- **坐标**:左下角原点(GL 约定)。`pixelX/pixelY` 是 canvas 像素,内部按 `resolutionScale` 缩放到 FBO 像素。
- **返回**:命中结果;背景(无命中,`alpha=0`)返回 `null`。

#### `pickAt(gl, camera, pixelX, pixelY, canvasW?, canvasH?): GPUPickResult | null`

便捷:`render()` + `pick()` 一次完成。适合单次点击拾取(每帧只拾取一次时用,避免重复渲染)。

#### `pickRect(gl, x0, y0, x1, y1): Object3D[]`

框选:读取矩形区域内所有像素的物体 id(去重)。

- **坐标**:`(x0, y0)` 左下角,`(x1, y1)` 右上角(canvas 像素)。
- **返回**:命中物体数组(去重,不含实例 id;框选通常只关心物体级选中)。无命中返回空数组。

#### `dispose(gl): void`

释放所有 GL 资源(FBO / 纹理 / program / VAO / buffer)。调用后实例不可再用,需重新 `new`。同时 `clear()` 映射。

#### `width: number` / `height: number` / `resolutionScale: number`(getter)

当前 FBO 尺寸与缩放因子。

### GPUPickResult

```typescript
interface GPUPickResult {
  object: Object3D | null;  // 命中物体(查不到映射时为 null)
  pickId: number;           // 命中物体的 pickId
  instanceId: number;       // 实例索引(InstancedMesh: 0..count-1;普通 Mesh: -1)
}
```

### GPUPickingOptions

```typescript
interface GPUPickingOptions {
  resolutionScale?: number;  // FBO 分辨率缩放(默认 1.0;0.5 = 半分辨率)
  skipInvisible?: boolean;   // register 时跳过 invisible 物体(默认 true)
}
```

---

## Shader 参考

### `PICK_VERT`(普通 Mesh 顶点 shader)

```glsl
layout(location = 0) in vec3 a_position;
uniform mat4 u_model, u_view, u_projection;
uniform vec3 u_pickId;   // 24-bit pickId 编码为 0..1 的 r,g,b
flat out vec3 v_pickId;
flat out float v_instanceId;   // -1.0 = 非实例化

void main() {
  v_pickId = u_pickId;
  v_instanceId = -1.0;
  gl_Position = u_projection * u_view * u_model * vec4(a_position, 1.0);
}
```

### `PICK_INSTANCED_VERT`(InstancedMesh 顶点 shader)

```glsl
layout(location = 0) in vec3 a_position;
layout(location = 3) in mat4 a_instanceMatrix;
layout(location = 7) in float a_instanceId;   // 0..count-1
uniform mat4 u_view, u_projection;
uniform vec3 u_pickId;
flat out vec3 v_pickId;
flat out float v_instanceId;

void main() {
  v_pickId = u_pickId;
  v_instanceId = a_instanceId;
  vec4 worldPos = a_instanceMatrix * vec4(a_position, 1.0);
  gl_Position = u_projection * u_view * worldPos;
}
```

### `PICK_FRAG`(共用 fragment shader)

```glsl
flat in vec3 v_pickId;
flat in float v_instanceId;
layout(location = 0) out vec4 outObjectId;
layout(location = 1) out vec4 outInstanceId;

vec3 encodeId24(uint id) {
  float r = float(id & 0xFFu) / 255.0;
  float g = float((id >> 8) & 0xFFu) / 255.0;
  float b = float((id >> 16) & 0xFFu) / 255.0;
  return vec3(r, g, b);
}

void main() {
  outObjectId = vec4(v_pickId, 1.0);
  if (v_instanceId < 0.0) {
    outInstanceId = vec4(0.0, 0.0, 0.0, 0.0);
  } else {
    uint id = uint(v_instanceId + 0.5);
    outInstanceId = vec4(encodeId24(id), 1.0);
  }
}
```

**注意**:`flat` 限定符保证 `v_pickId` / `v_instanceId` 不被光栅器插值(per-object / per-instance 的值在三角形内部应保持恒定)。

---

## 使用示例

### 基础:注册 + 单点拾取

```typescript
import { GPUPicking } from '@/engine/Renderer';

const picker = new GPUPicking();

// 场景加载时注册所有可拾取物体
scene.traverse((obj) => {
  if (obj.isMesh) picker.register(obj);
});

// 鼠标点击时
canvas.addEventListener('click', (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = canvas.height - (e.clientY - rect.top);  // DOM Y 翻转 → GL Y

  const result = picker.pickAt(gl, camera, x, y);
  if (result) {
    console.log('命中:', result.object.name, 'pickId:', result.pickId);
    selectionSystem.select(result.object);
  } else {
    selectionSystem.deselectAll();
  }
});
```

### InstancedMesh 逐实例拾取

```typescript
const trees = new InstancedMesh(treeGeom, treeMat, 1000);
// 设置每个实例的 matrix...
picker.register(trees);

const result = picker.pickAt(gl, camera, mx, my);
if (result?.object === trees) {
  console.log('命中第', result.instanceId, '棵树');
  highlightInstance(trees, result.instanceId);
}
```

### 框选(box select)

```typescript
// 鼠标拖拽结束时(x0,y0 = 拖拽起点,x1,y1 = 终点)
const selected = picker.pickRect(gl, x0, y0, x1, y1);
// 注意:pickRect 不自动 render,需先调 render
picker.render(gl, camera);
const selected = picker.pickRect(gl, x0, y0, x1, y1);
selectionSystem.selectMany(selected);
```

### 与 Raycaster 级联(精确命中点)

```typescript
// GPUPicking 先 O(1) 确定命中物体
const gpuHit = picker.pickAt(gl, camera, mx, my);
if (!gpuHit?.object) return;

// 需要精确命中点时,对该单物体调 Raycaster
const raycaster = new Raycaster();
raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
const hits = raycaster.intersectObject(gpuHit.object, false);  // recursive=false
if (hits.length > 0) {
  const precise = hits[0];
  console.log('精确命中点:', precise.point, 'faceIndex:', precise.faceIndex);
  placeDecal(precise.point, precise.face!.normal);
}
```

### 分辨率缩放(性能优先)

```typescript
// 框选大区域时用半分辨率,4 倍性能提升
const picker = new GPUPicking({ resolutionScale: 0.5 });
// 拾取精度略降(像素对齐到 2x2 块),但对物体级选中几乎无影响
```

---

## 与 CPU Raycaster 的关系

| 维度 | `Core/Raycaster` | `Renderer/GPUPicking` |
|------|------------------|----------------------|
| **算法** | CPU 逐三角形 ray-triangle 求交 | GPU 离屏 ID 渲染 + `readPixels` |
| **复杂度** | O(三角形数) | O(1)(单像素读取) |
| **返回** | `distance` / `point` / `faceIndex` / `uv` / `instanceId` | `object` / `pickId` / `instanceId` |
| **精度** | 像素级精确 | 像素级(受 `resolutionScale` 影响) |
| **依赖** | 无 WebGL(纯数学) | 需 WebGL2 上下文 |
| **适用** | 精确命中点、物体少 | 海量物体、框选、悬停高亮 |
| **级联** | 作为 GPUPicking 的精修步骤 | 先确定物体,再交 Raycaster |

**推荐策略**:编辑器默认用 GPUPicking 做悬停高亮 / 点击选中(O(1) 响应);需要放置标记 / 绘制贴花等精确命中点时,级联 Raycaster 对单物体精修。

---

## 与 three.js / o3de 的差异

| 关注点 | three.js | o3de Atom | VREEN |
|--------|----------|-----------|-------|
| **拾取方式** | `SelectionBox` + 颜色编码(单纹理) | `EditorMeshPickPass`(离屏 ID 渲染) | MRT 双附件(物体 id + 实例 id) |
| **实例 id** | 无内置支持(需手动编码) | 支持 | 内置 `a_instanceId` 属性,自动编码 |
| **框选** | `SelectionBox`(全屏读) | 支持 | `pickRect` 去重返回 |
| **可测试性** | 需 WebGL | 需引擎运行 | 纯函数 1:1,无头可测 |
| **与 Raycaster 集成** | 二选一 | 独立 | 级联策略(GPU → CPU 精修) |
| **分辨率缩放** | 无 | 无 | `resolutionScale`(0.5x 提速 4 倍) |

---

## 性能考量

- **`render()` 成本**:与场景可拾取物体数 + 三角形数成正比(每个 Mesh 一次 draw call)。建议仅在 `pick` / `pickRect` 调用前 `render`,而非每帧渲染。
- **`pick()` 成本**:O(1)。`readPixels` 单像素 + 两次(物体 id + 实例 id)。GPU→CPU 回读有 ~1ms 同步开销,避免每帧多次调用。
- **`pickRect()` 成本**:O(矩形面积)。一次性 `readPixels` 读整个矩形,去重。比逐像素 `pick` 快得多。
- **`resolutionScale=0.5`**:FBO 像素数 1/4,`render()` 与 `pickRect` 都快 ~4 倍。拾取精度略降(像素对齐到 2x2 块),物体级选中几乎无影响。
- **VAO / Buffer 缓存**:per-geometry WeakMap 缓存,仅 `position` / `index` 版本变更时重传。InstancedMesh 的 `instanceMatrix` 版本变更时重传。
- **内存**:per-geometry 复制一份 position / index buffer(独立于 WebGL2Renderer 的缓存,避免耦合)。FBO 内存 = `width × height × (2 × 4 + 4)` 字节(2 RGBA8 + DEPTH24)。800×600 ≈ 5.76 MB。

---

## 测试

44 个单元测试,覆盖:

1. **纯函数**(15 个):`encodeId24` / `decodeId24` round-trip(0 / 1 / 255 / 256 / 65535 / 65536 / MAX_PICK_ID / 随机值)、与 GPU 编码公式一致性、越界抛错、`decodeId24` 高位字节忽略、`encodeId24Uniform` 归一化。
2. **映射**(11 个):`register` 从 1 开始、幂等、`unregister` 清除、不回收 id、`clear` 重置、`lookup` / `pickIdOf` / `has`、`registerAll` + `skipInvisible`、`getRegisteredObjects`。
3. **GPU 路径**(13 个,MockGL2):`render` 空集 warn、普通 Mesh `drawElements`、无索引 `drawArrays`、InstancedMesh `drawElementsInstanced`、跳过非 Mesh、跳过 invisible、`pick` 命中 + instanceId=-1、背景返回 null、InstancedMesh instanceId、未知 pickId object=null、`pick` 在 render 前返回 null、`pickAt` = render + pick、canvas 尺寸参数。
4. **pickRect**(3 个):去重、全背景空数组、未 render 空数组。
5. **dispose / options**(4 个):`resolutionScale` 影响缩放、默认 1.0、dispose 后尺寸归零 + 映射清空、dispose 后 id 从 1 重新开始。

测试用 `MockGL2` 实现 GPUPicking / MRTTarget / ShaderProgram 调用的 GL 方法子集,`ShaderProgram.setUniform*` 在 location 缺失时静默 no-op,因此 `render()` 的完整编排(绑 FBO / 设状态 / 遍历物体 / 绑 VAO / draw)能在 Node 环境跑通。`readPixels` 可植入返回值模拟命中。

```bash
npx vitest run src/engine/Renderer/GPUPicking.test.ts
```

---

## 集成说明

- **与 `Editor/SelectionSystem` 集成**:`SelectionSystem.pick(raycaster, scene)` 当前走 CPU Raycaster。可新增 `pickWithGPU(picker, gl, camera, x, y)` 方法调 `picker.pickAt` 后 `select(result.object)`,或保持 `SelectionSystem` 不变,由调用方在 GPUPicking 命中后调 `selectionSystem.select`。两者解耦,不强制耦合。
- **与 `WebGL2Renderer` 集成**:GPUPicking 自管理 VAO / buffer,不复用渲染器缓存,避免耦合。可在渲染器主循环后追加一次 `picker.render(gl, camera)`(若需要每帧拾取),或仅在鼠标事件回调里按需 `pickAt`。
- **资源生命周期**:`dispose(gl)` 释放所有 GL 资源。WeakMap 缓存的 VAO / buffer 在 `dispose` 时通过 side-set 显式删除(WeakMap 不可遍历)。场景卸载时务必调 `dispose`。
- **`camera` 矩阵更新**:`render()` 读 `camera.matrixWorldInverse` 与 `camera.projectionMatrix`。调用前确保 `camera.updateMatrixWorld()` 已执行(通常由渲染器主循环完成)。
