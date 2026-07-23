// Renderer — 抽象渲染器接口。
//
// 设计目标(对标 Phase 2.1.1):
//   - 让 WebGL2Renderer 实现此接口,后续可插拔 WebGPU 后端(Phase 5.1)
//     或 Headless/software renderer(测试用)。
//   - 接口只暴露"任何渲染器都必须提供"的最小能力:渲染、resize、
//     资源释放、统计。WebGL2 特有的能力(getProgram / post-processing
//     细节开关 / shadow map 配置)不在接口里,调用方需要时直接用
//     WebGL2Renderer 具体类型。
//   - 场景与相机类型保持为具体类(Scene / Camera),因为当前引擎
//     没有抽象 Scene 接口,强行抽会引入大量泛型噪音。后续若需要
//     多后端共享 Scene,再抽 SceneGraph 接口。
//
// 不变量:
//   - render() 必须是同步的(GPU 命令立即入队),异步资源编译在
//     内部完成或由调用方在 render 前确保就绪。
//   - resize() 幂等,同一尺寸重复调用不触发实际重分配。
//   - dispose() 后再调用 render() 行为未定义(调用方负责)。

import type { Camera } from '../Cameras/Camera';
import type { Scene } from '../Core/Scene';
import type { RendererStats } from './WebGL2Renderer';

/**
 * 渲染器抽象接口。所有渲染后端(WebGL2 / WebGPU / Headless)都应实现。
 *
 * 接口刻意保持窄:只包含"渲染一帧"和"生命周期管理"所需的方法。
 * 后端特有能力通过具体类型访问。
 */
export interface Renderer {
  /** 渲染目标 canvas。后端构造时绑定,生命周期内不变。 */
  readonly canvas: HTMLCanvasElement;

  /** 渲染一帧。scene + camera 的当前状态会被读取并提交 GPU。 */
  render(scene: Scene, camera: Camera): void;

  /** 调整渲染目标 backing store 尺寸(已含 pixelRatio 处理)。 */
  resize(width: number, height: number): void;

  /** 释放所有 GPU 资源(programs / FBOs / VBOs / textures)。 */
  dispose(): void;

  /** 上一帧的统计快照(UI / HUD 读取)。 */
  readonly stats: RendererStats;
}
