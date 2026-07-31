// PassAttachment — texture attachment descriptor + instance.
// Adapted from o3de Atom RPI PassAttachment. Describes a render target / depth
// texture that a Pass reads (input) or writes (output). The PassGraph owns the
// attachment pool; PassAttachment instances are the handoff between passes and
// form the data-flow edges of the render graph.
//
// 与 Renderer/RenderPass.ts 的 PostProcessingFBOs 互补:后者是固定 FBO 池
// (ping-pong),本模块是按名寻址的附件池,支持任意拓扑的 render-to-texture 子图。

import { Vector4 } from '../../Math/Vector4';

export type PassAttachmentFormat =
  | 'rgba8'
  | 'rgba16f'
  | 'rgba32f'
  | 'r8'
  | 'r16f'
  | 'r32f'
  | 'depth24stencil8'
  | 'depth32f';

export interface PassAttachmentDescriptor {
  name: string;
  format: PassAttachmentFormat;
  /** 0 = inherit from pipeline. */
  width: number;
  /** 0 = inherit from pipeline. */
  height: number;
  /** default 1. */
  mipLevels?: number;
  /** MSAA samples, default 1. */
  samples?: number;
  /** clear color/depth when loaded. */
  clearValue?: Vector4;
  /** default 'clear' for color, 'clear' for depth. */
  loadOp?: 'clear' | 'load' | 'dontcare';
  storeOp?: 'store' | 'dontcare';
}

export class PassAttachment {
  descriptor: PassAttachmentDescriptor;
  /** The actual texture handle (set by the pipeline when allocating). Null until allocated. */
  texture: WebGLTexture | null = null;
  /** Current size (filled when pipeline sizes attachments). */
  width: number = 0;
  height: number = 0;
  /** True if the texture was written this frame (for debug/validation). */
  written: boolean = false;

  constructor(descriptor: PassAttachmentDescriptor) {
    this.descriptor = descriptor;
  }
  get name(): string {
    return this.descriptor.name;
  }
  get format(): PassAttachmentFormat {
    return this.descriptor.format;
  }
}
