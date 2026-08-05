# WebXR Module — VR/AR/MR Session Management

> **VREEN Engine** · `src/engine/WebXR/`
>
> 沉浸式 XR 会话管理模块,适配自 [three.js WebXR](https://github.com/mrdoob/three.js/tree/dev/src/renderers/webxr) (`WebXRManager` / `WebXRController` + `examples/jsm/webxr/`) 与 [o3de Atom XR pass](https://www.o3de.org/docs/atom-guide/dev-guide/xr/) + OpenXR 集成思路。提供完整的 VR / AR / MR 会话生命周期、控制器输入 (含手部 25 关节追踪 + 捏合检测)、以及 AR 世界理解子系统 (光照估计 / 平面检测 / 深度感知遮挡)。
>
> **设计原则**:纯逻辑可测试。核心类只消费 `WebXRProvider` / `XRSessionHandle` / `XRFrameHandle` 纯数据接口,浏览器原生 `navigator.xr` 副作用隔离在 `BrowserWebXRProvider` 胶水层。测试注入 `MockWebXRProvider`,无需 XR 设备 / WebGL。

---

## 目录

- [概述](#概述)
- [架构](#架构)
- [核心概念](#核心概念)
  - [会话模式与参考空间](#会话模式与参考空间)
  - [Provider 抽象 (可测试性)](#provider-抽象-可测试性)
  - [帧循环与渲染解耦](#帧循环与渲染解耦)
- [模块清单](#模块清单)
- [API 参考](#api-参考)
  - [WebXRManager](#webxrmanager)
  - [WebXRController](#webxrcontroller)
  - [WebXRSessionButton](#webxrsessionbutton)
  - [XRLightEstimation](#xrlightestimation)
  - [XRPlaneTracker](#xrplanetracker)
  - [WebXRDepthSensing](#webxrdepthsensing)
  - [BrowserWebXRProvider](#browserwebxrprovider)
- [使用示例](#使用示例)
  - [VR 基础:进入会话 + 控制器拾取](#vr-基础进入会话--控制器拾取)
  - [AR:平面检测 + 物体放置](#ar-平面检测--物体放置)
  - [AR:光照估计驱动场景光照](#ar-光照估计驱动场景光照)
  - [AR:深度感知遮挡](#ar-深度感知遮挡)
  - [手部追踪 + 捏合手势](#手部追踪--捏合手势)
- [与 three.js / o3de 的差异](#与-threejs--o3de-的差异)
- [测试](#测试)
- [集成说明](#集成说明)

---

## 概述

WebXR 是 W3C 标准化的 Web 沉浸式设备 API,支持 VR 头显 (Quest / Vive / Index)、AR 设备 (手机 ARCore/ARKit、HoloLens)、以及桌面 inline 模式。VREEN 作为「全息 3D 显示系统」,WebXR 是其沉浸式呈现的核心通路。

本模块把 three.js 的 WebXR 实现 (与 WebGLRenderer 强耦合) 重构为**数据驱动 + 渲染解耦**架构:

| 关注点 | three.js | VREEN |
|--------|----------|-------|
| 会话管理 | 嵌入 `WebGLRenderer.xr` | 独立 `WebXRManager`,渲染层通过回调消费 |
| 帧数据 | 直接操作 FBO / 层 / 纹理 | 纯数据 `XRViewerPose` + `XRViewData` 传给渲染层 |
| 浏览器 API | 直接调 `navigator.xr` | `WebXRProvider` 接口抽象,可注入 Mock |
| 可测试性 | 需真实设备 / WebGL | 43 个单元测试,无设备依赖 |
| AR 子系统 | 分散在 examples | 统一的 `XRLightEstimation` / `XRPlaneTracker` / `WebXRDepthSensing` |

---

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                      应用 / 渲染层                          │
│  (读取 viewerPose.views 设置 ArrayCamera / 视口 / 层掩码)    │
└───────────────▲─────────────────────────────────────────────┘
                │ onFrame(time, frame, viewerPose)
┌───────────────┴─────────────────────────────────────────────┐
│                     WebXRManager                            │
│  会话生命周期 · 参考空间 · 帧循环 · 控制器注册表 · 事件       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │ WebXRController│  │ XRLightEst.  │  │ XRPlaneTracker   │   │
│  │ (射线/握持/手) │  │ (光照估计)    │  │ (平面检测)       │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
│  ┌──────────────────┐                                        │
│  │ WebXRDepthSensing │                                        │
│  └──────────────────┘                                        │
└───────────────▲─────────────────────────────────────────────┘
                │ WebXRProvider / XRSessionHandle / XRFrameHandle (纯数据接口)
┌───────────────┴─────────────────────────────────────────────┐
│              BrowserWebXRProvider (胶水层)                   │
│  包装 navigator.xr / XRSession / XRFrame / XRPose            │
│  → 转换为 VREEN Vector3 / Quaternion / Matrix4              │
└─────────────────────────────────────────────────────────────┘
                │ W3C WebXR Device API
                ▼
         浏览器 / XR 设备
```

---

## 核心概念

### 会话模式与参考空间

**会话模式** (`XRSessionMode`,W3C 规范):

| 模式 | 用途 | 特征 |
|------|------|------|
| `immersive-vr` | VR 头显 | 全屏双目渲染,opaque 环境 |
| `immersive-ar` | AR 设备/手机 | 透视现实世界,additive/alpha-blend |
| `inline` | 桌面预览 | 非沉浸,画布内 6DoF 鼠标控制 |

**参考空间** (`XRReferenceSpaceType`):

| 类型 | 原点 | 追踪域 |
|------|------|--------|
| `viewer` | 用户当前位置 | 不旋转,适合 inline |
| `local` | 启动位置 | 小范围 6DoF |
| `local-floor` | 启动位置地板高度 | VR 默认 (无地板检测) |
| `bounded-floor` | 房间尺度 | 需边界定义 (Quest Guardian) |
| `unbounded` | 任意大空间 | 大空间 AR/VR |

默认使用 `local-floor`。可通过 `setReferenceSpaceType()` 在会话启动前配置。传送 (teleportation) 用 `getOffsetReferenceSpace()` 重定位原点。

### Provider 抽象 (可测试性)

`WebXRProvider` 接口把所有浏览器副作用 (`navigator.xr` / DOM / WebGL) 隔离:

```typescript
interface WebXRProvider {
  readonly available: boolean;
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  requestSession(mode: XRSessionMode, options: XRSessionOptions): Promise<XRSessionHandle>;
  offerSession?(mode: XRSessionMode, options: XRSessionOptions): Promise<XRSessionHandle>;
}
```

- **生产**:`BrowserWebXRProvider` 包装真实 `navigator.xr`。
- **测试**:`MockWebXRProvider` 注入可控会话状态 (viewer pose / 控制器 / 平面 / 光照 / 深度)。

`WebXRManager` / `WebXRController` 只消费 `XRSessionHandle` / `XRFrameHandle` 纯数据快照,完全不接触 DOM 类型。这让会话状态机、控制器姿态、手势检测、平面跟踪等核心逻辑可在 Node.js / vitest 中单元测试。

### 帧循环与渲染解耦

每帧 `WebXRManager` 通过 `requestAnimationFrame` 驱动,提取:

1. **Viewer pose** — 头部变换 + 各眼视图 (viewMatrix + projectionMatrix + viewport)。
2. **控制器姿态** — 从 `session.inputSources` 快照更新各 `WebXRController`。
3. **AR 子系统数据** — 平面增量、光照估计、深度数据,派发事件。

渲染层通过 `setAnimationLoop(callback)` 注册帧回调,收到 `viewerPose` 后设置 `ArrayCamera` (左右眼) / 视口 / 层掩码,无需直接接触 WebXR API。

---

## 模块清单

| 文件 | 职责 |
|------|------|
| [WebXRTypes.ts](./WebXRTypes.ts) | 类型定义 + `WebXRProvider` / `XRSessionHandle` / `XRFrameHandle` 接口 |
| [WebXRManager.ts](./WebXRManager.ts) | 会话生命周期 / 参考空间 / 帧循环 / 控制器注册表 / 事件 |
| [WebXRController.ts](./WebXRController.ts) | 目标射线 / 握持 / 手部空间 + 按钮边沿 + 捏合检测 |
| [WebXRSessionButton.ts](./WebXRSessionButton.ts) | `createVRButton` / `createARButton` DOM 入口 + 特征检测 |
| [XRLightEstimation.ts](./XRLightEstimation.ts) | AR 光照估计 (主光 + 球谐环境光) |
| [XRPlaneTracker.ts](./XRPlaneTracker.ts) | AR 平面检测 (added/changed/removed + 边界框 + 放置查询) |
| [WebXRDepthSensing.ts](./WebXRDepthSensing.ts) | AR 深度感知 (深度纹理 + 遮挡测试) |
| [BrowserWebXRProvider.ts](./BrowserWebXRProvider.ts) | 浏览器原生 API 适配器 (生产) |
| [index.ts](./index.ts) | Barrel 导出 |
| [WebXR.test.ts](./WebXR.test.ts) | 43 个单元测试 (MockWebXRProvider) |

---

## API 参考

### WebXRManager

会话管理器。负责请求/启动/结束会话、管理参考空间、驱动帧循环、维护控制器注册表、转发事件。

```typescript
class WebXRManager {
  constructor(provider: WebXRProvider, options?: WebXRManagerOptions);

  // 状态
  enabled: boolean;          // 是否启用 XR 渲染
  isPresenting: boolean;     // 是否正在呈现
  cameraAutoUpdate: boolean; // 是否自动更新摄像机

  // 会话
  isSessionSupported(mode: XRSessionMode): Promise<boolean>;
  startSession(mode: XRSessionMode, options?: XRSessionOptions): Promise<void>;
  setSession(handle: XRSessionHandle | null): Promise<void>;
  end(): Promise<void>;
  getSession(): XRSessionHandle | null;

  // 参考空间
  setReferenceSpaceType(type: XRReferenceSpaceType): void;
  getReferenceSpace(): XRReferenceSpaceHandle | null;
  setReferenceSpace(space: XRReferenceSpaceHandle): void;  // 传送/重定位

  // 控制器
  getController(index: number): WebXRController;       // 目标射线空间
  getControllerGrip(index: number): WebXRController;   // 握持空间
  getHand(index: number): WebXRController;             // 手部空间
  getControllers(): readonly WebXRController[];

  // 渲染配置
  setFramebufferScaleFactor(value: number): void;
  setFoveation(value: number): void;    // 0=全分辨率, 1=最大边缘降采样
  getFoveation(): number;

  // 帧循环
  setAnimationLoop(cb: ((time, frame, viewerPose) => void) | null): void;

  // AR 子系统
  enableLightEstimation(): Promise<XRLightProbeHandle | null>;
  getLightEstimate(): XRLightEstimate | null;
  getPlanes(): ReadonlyMap<string, XRPlaneData>;
  getDepthData(): XRDepthData | null;
  hasDepthSensing(): boolean;

  // 事件
  addEventListener(type: WebXREventType, listener: WebXRManagerListener): void;
  removeEventListener(type: WebXREventType, listener: WebXRManagerListener): void;

  // 环境
  getEnvironmentBlendMode(): XREnvironmentBlendMode | undefined;
  getVisibilityState(): XRVisibilityState | undefined;

  dispose(): void;
}
```

**事件类型** (`WebXREventType`):
`sessionstart` / `sessionend` / `visibilitychange` / `inputsourceschange` / `planesdetected` / `lightestimate` / `depthsensing` / `requestfailed`

### WebXRController

单个 XR 控制器状态机,维护三个空间 + 输入事件。

```typescript
class WebXRController {
  readonly targetRay: XRSpace;   // 目标射线空间 (指向/拾取)
  readonly grip: XRSpace;        // 握持空间 (手柄模型挂载)
  readonly hand: XRHandState;    // 手部空间 (25 关节 + 捏合)
  handedness: XRHandedness;      // 'left' | 'right' | 'none'
  targetRayMode: XRTargetRayMode;
  profiles: string[];            // 手柄配置文件 (模型加载)
  buttons: XRButtonState[];      // 按钮快照
  axes: XRGamepadAxes;           // 触摸板/拇指摇杆

  connect(inputSource: XRInputSourceSnapshot): void;
  disconnect(): void;
  update(input: XRInputSourceSnapshot | null): void;

  addEventListener(type: XRInputEventType, listener: XRControllerListener): void;
  removeEventListener(type: XRInputEventType, listener: XRControllerListener): void;

  pulse(manager, index, intensity, durationMs): void;  // 手柄振动
}
```

**事件类型** (`XRInputEventType`):
- `select` / `selectstart` / `selectend` — 扳机按钮 (按钮 0)
- `squeeze` / `squeezestart` / `squeezeend` — 握持按钮 (按钮 1)
- `connected` / `disconnected` — 输入源连接/断开
- `pinchstart` / `pinchend` — 手部捏合 (食指指尖 ↔ 拇指指尖距离 < 0.02m)
- `move` — 目标射线姿态变化

**捏合检测**:食指指尖与拇指指尖距离 ≤ `pinchDistance - pinchThreshold` (0.015m) 触发 `pinchstart`,超过 `pinchDistance + pinchThreshold` (0.025m) 触发 `pinchend`。滞后区间 (0.015~0.025m) 防抖,避免抖动反复触发。

### WebXRSessionButton

DOM 按钮工厂,封装会话请求 + 特征检测 + UI 状态切换。

```typescript
function createVRButton(manager: WebXRManager, sessionInit?: XRSessionOptions, style?: XRButtonStyleOptions): HTMLElement;
function createARButton(manager: WebXRManager, sessionInit?: XRSessionOptions, style?: XRButtonStyleOptions): HTMLElement;
function createXRButton(manager: WebXRManager, mode: XRSessionMode, sessionInit?: XRSessionOptions, style?: XRButtonStyleOptions): HTMLElement;

function registerSessionGrantedListener(provider): void;  // 头显佩戴自动进入
function resetXRButtonState(): void;                       // 测试重置
```

**特征检测流程**:
1. `navigator.xr` 不存在 → 显示 "WEBXR NOT AVAILABLE" (或 "WEBXR NEEDS HTTPS" 若非安全上下文)。
2. `isSessionSupported(mode)` → false → 显示 "VR/AR NOT SUPPORTED"。
3. 请求失败 → 显示 "VR/AR NOT ALLOWED"。
4. 支持 → "ENTER VR/AR" 按钮,点击进入会话,会话中变 "EXIT VR/AR"。

**sessiongranted**:头显佩戴时设备主动授予会话,`registerSessionGrantedListener` 监听后自动触发按钮点击进入。

按钮默认赛博朋克风格 (neon-cyan 边框 + 等宽字体),与 VREEN 主题一致。

### XRLightEstimation

AR 光照估计跟踪器,把 W3C `XRLightEstimate` 转换为引擎友好参数。

```typescript
class XRLightEstimation {
  state: XRLightEstimateState;  // 当前光照状态
  onEstimationStart?: () => void;
  onEstimationEnd?: () => void;

  update(estimate: XRLightEstimate | null): void;
  reset(): void;
}
```

**输出** (`XRLightEstimateState`):
- `directionalLight.color` — 归一化 RGB (各通道 / 最大通道,0~1)。
- `directionalLight.intensity` — 强度标量 (原始最大通道值,WebXR 可 >1)。
- `directionalLight.position` — 主光方向 (世界空间)。
- `sphericalHarmonics` — 27 个球谐系数 (9 个 RGB),用于 IBL 环境光。
- `estimationActive` — 是否正在接收估计。

**归一化逻辑** (适配 three.js `SessionLightProbe.onXRFrame`):WebXR 返回的主光强度各通道可超过 1.0,需归一化颜色 (各通道除以最大通道值),强度 = 最大通道值。

### XRPlaneTracker

AR 平面检测跟踪器,维护平面注册表 + 边界框缓存 + 放置查询。

```typescript
class XRPlaneTracker {
  applyDelta(delta: { added, changed, removed }): PlaneDeltaEvent;
  sync(all: ReadonlyMap<string, XRPlaneData>): void;
  get(id: string): XRPlaneData | undefined;
  getAll(): XRPlaneData[];
  getByOrientation(orientation: 'horizontal' | 'vertical'): XRPlaneData[];
  getBounds(id: string): PlaneBounds | null;              // AABB (缓存)
  findNearestHorizontalSurface(point: Vector3, maxDistance?: number): { planeId, surfacePoint } | null;
  get count(): number;
  clear(): void;

  addEventListener(listener: PlaneTrackerListener): void;
  removeEventListener(listener: PlaneTrackerListener): void;
}
```

**用途**:
- 物体放置 (`findNearestHorizontalSurface`):在真实桌面/地板找最近放置点。
- 碰撞:虚拟角色站在真实地板上。
- 遮挡:虚拟物体被真实墙面遮挡。

### WebXRDepthSensing

AR 深度感知跟踪器,管理深度纹理 + 遮挡测试。

```typescript
class WebXRDepthSensing {
  state: DepthSensingState;
  update(data: XRDepthData | null): void;
  reset(): void;
  hasTexture(): boolean;
  sampleDepth(u: number, v: number, sample: (u, v) => number | null): number | null;
  isOccluded(pointDepth: number, u: number, v: number, sample): boolean;
}
```

**遮挡测试** (`isOccluded`):采样深度图某点的真实深度 (米),与虚拟点的相机空间深度比较。真实物体更近 → 虚拟点被遮挡。渲染层据此写 `gl_FragDepth` 或用遮挡 mesh。

### BrowserWebXRProvider

浏览器原生 WebXR API 适配器。

```typescript
class BrowserWebXRProvider implements WebXRProvider {
  readonly available: boolean;  // 'xr' in navigator
  isSessionSupported(mode): Promise<boolean>;
  requestSession(mode, options): Promise<XRSessionHandle>;
  offerSession(mode, options): Promise<XRSessionHandle>;
}

function createBrowserWebXRProvider(): BrowserWebXRProvider;
```

负责把 W3C `XRSession` / `XRFrame` / `XRPose` / `XRViewerPose` / `XRInputSource` / `XRPlane` / `XRLightEstimate` / `XRDepthInformation` 转换为 VREEN 纯数据类型 (用 `Vector3` / `Quaternion` / `Matrix4`)。是唯一的浏览器侧胶水层,不做单元测试。

---

## 使用示例

### VR 基础:进入会话 + 控制器拾取

```typescript
import { WebXRManager, createVRButton, BrowserWebXRProvider } from '@/engine/WebXR';

const provider = createBrowserWebXRProvider();
const manager = new WebXRManager(provider);

// 渲染层每帧回调。
manager.setAnimationLoop((time, frame, viewerPose) => {
  if (!viewerPose) return;
  // 用 viewerPose.views 设置 ArrayCamera (左/右眼)。
  for (const view of viewerPose.views) {
    cameraL.projectionMatrix.copy(view.projectionMatrix);
    cameraL.matrix.copy(view.viewMatrix).invert();
    // ... 设置视口
  }
});

// 控制器拾取。
const controller = manager.getController(0);
controller.addEventListener('selectstart', () => {
  // 从 controller.targetRay.position 沿方向射线检测。
  raycaster.set(controller.targetRay.position, forward);
  const hits = raycaster.intersectObjects(scene.children);
  if (hits[0]) selectObject(hits[0].object);
});

// DOM 按钮。
document.body.appendChild(createVRButton(manager));

// 或编程式进入。
await manager.startSession('immersive-vr', {
  optionalFeatures: ['local-floor', 'bounded-floor', 'layers'],
});
```

### AR:平面检测 + 物体放置

```typescript
import { XRPlaneTracker } from '@/engine/WebXR';

const tracker = new XRPlaneTracker();
manager.addEventListener('planesdetected', (e) => {
  if (e.planes) tracker.applyDelta(e.planes);
});

// 用户点击屏幕放置物体。
function onPlaceTap(worldPoint: Vector3) {
  const surface = tracker.findNearestHorizontalSurface(worldPoint, 5);
  if (surface) {
    placeObjectAt(surface.surfacePoint);
  }
}

// 查询所有水平面 (地板/桌面)。
const floors = tracker.getByOrientation('horizontal');
```

### AR:光照估计驱动场景光照

```typescript
import { XRLightEstimation } from '@/engine/WebXR';

const light = new XRLightEstimation();
light.onEstimationStart = () => console.log('光照估计激活');
await manager.enableLightEstimation();

// 每帧更新。
manager.setAnimationLoop((time, frame, pose) => {
  light.update(manager.getLightEstimate());
  if (light.state.estimationActive) {
    sunLight.color.setRGB(
      light.state.directionalLight.color.r,
      light.state.directionalLight.color.g,
      light.state.directionalLight.color.b,
    );
    sunLight.intensity = light.state.directionalLight.intensity;
    sunLight.position.copy(light.state.directionalLight.position);
    // 球谐系数 → IBL 环境光。
    envMap.setSH(light.state.sphericalHarmonics);
  }
});
```

### AR:深度感知遮挡

```typescript
import { WebXRDepthSensing } from '@/engine/WebXR';

const depth = new WebXRDepthSensing();
manager.addEventListener('depthsensing', (e) => {
  depth.update(e.depth);
});

// 渲染层:用深度纹理写 gl_FragDepth。
if (depth.state.active) {
  depthMaterial.uniforms.depthTexture.value = depth.state.texture;
  depthMaterial.uniforms.depthSize.value = [depth.state.width, depth.state.height];
  // 虚拟物体被真实物体遮挡。
}

// 编程式遮挡查询。
const realDepth = depth.sampleDepth(u, v, (u, v) => readDepthTex(u, v));
if (realDepth !== null && realDepth < virtualPointDepth) {
  // 被遮挡,丢弃片元。
}
```

### 手部追踪 + 捏合手势

```typescript
const handCtrl = manager.getHand(0);
handCtrl.addEventListener('pinchstart', (e) => {
  console.log(`${e.handedness} 手捏合`);
  // 从食指指尖位置开始拖拽。
  const indexTip = handCtrl.hand.joints.get('index-finger-tip');
  startDrag(indexTip.position);
});
handCtrl.addEventListener('pinchend', () => endDrag());

// 读取 25 个关节姿态 (渲染手部网格)。
for (const [name, joint] of handCtrl.hand.joints) {
  handMesh.setJointMatrix(name, joint.matrix);
}
```

---

## 与 three.js / o3de 的差异

| 方面 | three.js | o3de | VREEN |
|------|----------|------|-------|
| 架构 | `WebXRManager` 嵌入 `WebGLRenderer`,直接操作 FBO/层/纹理 | Atom XR pass + OpenXR,原生 C++ | 独立 `WebXRManager`,渲染层通过回调消费纯数据 |
| 测试 | 需设备/WebGL | 需设备 | 43 单元测试,MockWebXRProvider 注入 |
| AR 光照 | `XREstimatedLight` (Group + LightProbe + DirectionalLight) | Atom IBL | `XRLightEstimation` 纯数据,渲染层消费 |
| AR 平面 | `XRPlanes` (Mesh 可视化) | Recast/RVO | `XRPlaneTracker` 纯数据 + 放置查询 |
| AR 深度 | `WebXRDepthSensing` (ShaderMaterial 写 gl_FragDepth) | Atom depth | `WebXRDepthSensing` 纯数据 + 遮挡测试 API |
| 手部 | `XRHandModelFactory` (Oculus 手模型) | EMotionFX hand | 25 关节纯数据 + 捏合滞后防抖 |
| 按钮 | `VRButton`/`ARButton`/`XRButton` | ImGui | `createVRButton`/`createARButton` 赛博朋克风格 |

---

## 测试

43 个单元测试,覆盖:

- **WebXRController** (8):连接/断开、姿态可见性、select/squeeze 边沿、捏合检测、滞后防抖、矩阵解析、move 事件。
- **WebXRManager** (15):会话支持检测、启动/结束/重复启动、requestfailed、参考空间、foveation、帧回调 viewerPose、输入源 connect/disconnect、visibilitychange、环境混合模式、光探针、平面检测、dispose。
- **XRLightEstimation** (4):归一化、estimationstart/end、reset、null 安全。
- **XRPlaneTracker** (7):增量应用、朝向过滤、边界框、最近水平面查询、范围限制、缓存失效、事件。
- **WebXRDepthSensing** (6):更新、null 标记、采样转换、非 active 安全、遮挡测试、reset。

```bash
npx vitest run src/engine/WebXR/WebXR.test.ts
```

---

## 集成说明

- **HTTPS 要求**:WebXR 需安全上下文 (HTTPS 或 localhost)。`createVRButton` 自动检测并提示。
- **渲染层集成**:渲染器需在 `setAnimationLoop` 回调中读取 `viewerPose.views`,设置 `ArrayCamera` (左/右眼) + 视口 + 层掩码 (左眼 layer 1,右眼 layer 2)。`manager.enabled` 标志指示渲染层切换到 XR 模式。
- **控制器模型**:控制器 `profiles` 字段提供厂商配置文件 URL,可用 `XRControllerModelFactory` (未来扩展) 加载 glTF 手柄模型。
- **性能**:`setFoveation(1.0)` 启用最大注视点渲染 (边缘降采样),在 Quest 等设备上显著提升帧率。`setFramebufferScaleFactor` 调整帧缓冲分辨率。
- **降级**:浏览器不支持 WebXR 时,`provider.available = false`,`isSessionSupported` 返回 false,`startSession` 抛错并派发 `requestfailed`,应用可降级到桌面模式。
