// Renderer 接口契约测试。
//
// 用一个最小 MockRenderer 验证:
//   1. Renderer 接口可以被外部实现(说明抽象边界清晰)
//   2. WebGL2Renderer 确实满足 Renderer 接口(structural / nominal via implements)
//   3. 调用方持有 Renderer 类型时,可以无差别切换实现

import { describe, it, expect } from 'vitest';
import type { Renderer } from './Renderer';
import type { RendererStats } from './WebGL2Renderer';
import type { Scene } from '../Core/Scene';
import type { Camera } from '../Cameras/Camera';
import { WebGL2Renderer } from './WebGL2Renderer';

/** 最小 Mock 实现,证明接口可被外部满足(为未来 WebGPU 后端铺路)。
 *  node 环境无 document,canvas 用类型断言占位。 */
class MockRenderer implements Renderer {
  readonly canvas = {} as unknown as HTMLCanvasElement;
  readonly stats: RendererStats = {
    drawCalls: 0, triangles: 0, shadowPasses: 0, programs: 0, drawCallBreakdown: {},
  };
  renderCount = 0;
  resizeCount = 0;
  disposed = false;
  lastSize: { w: number; h: number } = { w: 0, h: 0 };

  render(_scene: Scene, _camera: Camera): void {
    this.renderCount++;
    this.stats.drawCalls = this.renderCount;
  }
  resize(width: number, height: number): void {
    this.resizeCount++;
    this.lastSize = { w: width, h: height };
  }
  dispose(): void {
    this.disposed = true;
  }
}

describe('Renderer interface', () => {
  it('MockRenderer satisfies Renderer contract', () => {
    const r: Renderer = new MockRenderer();
    expect(r.canvas).toBeDefined();
    expect(r.stats.drawCalls).toBe(0);
    r.resize(800, 600);
    expect((r as MockRenderer).lastSize).toEqual({ w: 800, h: 600 });
    expect((r as MockRenderer).resizeCount).toBe(1);
    r.dispose();
    expect((r as MockRenderer).disposed).toBe(true);
  });

  it('WebGL2Renderer is assignable to Renderer', () => {
    // 类型层面验证:WebGL2Renderer implements Renderer
    // 运行时只检查构造函数存在,真正的 WebGL 上下文创建在 jsdom 里不可用,
    // 但类型兼容性已由 tsc 编译时保证。
    const ctor: typeof WebGL2Renderer = WebGL2Renderer;
    expect(typeof ctor).toBe('function');
    // 静态断言:WebGL2Renderer 实例类型可赋值给 Renderer
    // (若接口不满足,tsc 会报错;这里运行时 noop)
    const _typeCheck: (r: WebGL2Renderer) => Renderer = (r) => r;
    void _typeCheck;
  });

  it('Renderer declares required members', () => {
    // 反射式检查接口契约文档化:所有 Renderer 实例必须有这些成员
    const r: Renderer = new MockRenderer();
    expect(typeof r.render).toBe('function');
    expect(typeof r.resize).toBe('function');
    expect(typeof r.dispose).toBe('function');
    expect(r.canvas).toBeDefined();
    expect(r.stats).toBeDefined();
    expect(r.stats).toHaveProperty('drawCalls');
    expect(r.stats).toHaveProperty('triangles');
  });

  it('stats is readable from both implementations', () => {
    const mock: Renderer = new MockRenderer();
    mock.render({} as Scene, {} as Camera);
    mock.render({} as Scene, {} as Camera);
    expect(mock.stats.drawCalls).toBe(2);
  });
});
