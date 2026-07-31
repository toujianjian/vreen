// PassTemplate — JSON-serializable pass descriptors for data-driven
// construction. A PassTemplate tree can be registered in a PassLibrary and
// instantiated by PassFactory, enabling hot-reload and asset-driven pipelines.
//
// 与 Renderer/RenderPipelineManager 的 PipelinePass 互补:后者是代码内组装的
// 管线 pass,本模块是数据驱动的模板,可从 JSON/资产加载并热重载。

import type { PassAttachmentDescriptor } from './PassAttachment';

export interface PassTemplate {
  name: string;
  type: 'parent' | 'clear' | 'copy' | 'raster' | 'fullscreen' | 'compute' | 'selector';
  attachments?: PassAttachmentDescriptor[];
  /** For fullscreen/compute: shader key. */
  shaderKey?: string;
  /** For fullscreen/copy: input attachment name. */
  inputName?: string;
  /** For fullscreen/copy/clear: output attachment name. */
  outputName?: string;
  /** For clear: clear value [r, g, b, a]. */
  clearValue?: [number, number, number, number];
  /** For selector: index of child to execute. */
  selectorIndex?: number;
  /** Child pass templates (for parent/selector). */
  children?: PassTemplate[];
}

export class PassLibrary {
  private templates = new Map<string, PassTemplate>();
  register(template: PassTemplate): void {
    this.templates.set(template.name, template);
  }
  get(name: string): PassTemplate | undefined {
    return this.templates.get(name);
  }
  has(name: string): boolean {
    return this.templates.has(name);
  }
  list(): PassTemplate[] {
    return Array.from(this.templates.values());
  }
  clear(): void {
    this.templates.clear();
  }
}

export const defaultPassLibrary = new PassLibrary();
