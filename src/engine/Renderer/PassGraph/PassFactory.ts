// PassFactory — builds Pass instances from PassTemplate trees.
// Attachments are shared via a name-keyed cache so that multiple passes
// referencing the same attachment name resolve to the same PassAttachment
// instance (the data-flow edge between passes).

import {
  Pass,
  ParentPass,
  ClearPass,
  CopyPass,
  FullscreenPass,
  ComputePass,
  SelectorPass,
} from './Pass';
import { PassAttachment } from './PassAttachment';
import type { PassTemplate } from './PassTemplate';
import { Vector4 } from '../../Math/Vector4';

export class PassFactory {
  /**
   * Build a Pass tree from a template. Attachments are created and linked by
   * name. Attachments declared in `template.attachments` are materialized with
   * their full descriptor; attachments referenced only by inputName/outputName
   * are created with a default 'rgba8' descriptor.
   */
  static fromTemplate(
    template: PassTemplate,
    attachmentCache: Map<string, PassAttachment> = new Map(),
  ): Pass {
    const tplName = template.name;

    // 1. Create or fetch attachments from template.attachments (by name).
    if (template.attachments) {
      for (const desc of template.attachments) {
        if (!attachmentCache.has(desc.name)) {
          attachmentCache.set(desc.name, new PassAttachment(desc));
        }
      }
    }

    // 2. Build the Pass based on template.type.
    // 3. For parent/selector: recursively build children.
    // 4. For fullscreen/copy/clear: link input/output by name from attachmentCache.
    switch (template.type) {
      case 'parent': {
        const pass = new ParentPass(template.name);
        if (template.children) {
          for (const childTpl of template.children) {
            pass.addChild(PassFactory.fromTemplate(childTpl, attachmentCache));
          }
        }
        return pass;
      }
      case 'clear': {
        if (!template.outputName) {
          throw new Error(`ClearPass template "${tplName}" requires outputName`);
        }
        const target = PassFactory.getAttachment(template.outputName, attachmentCache);
        const cv = template.clearValue ?? [0, 0, 0, 1];
        return new ClearPass(template.name, target, new Vector4(cv[0], cv[1], cv[2], cv[3]));
      }
      case 'copy': {
        if (!template.inputName || !template.outputName) {
          throw new Error(`CopyPass template "${tplName}" requires inputName and outputName`);
        }
        const source = PassFactory.getAttachment(template.inputName, attachmentCache);
        const dest = PassFactory.getAttachment(template.outputName, attachmentCache);
        return new CopyPass(template.name, source, dest);
      }
      case 'raster': {
        // RasterPass is abstract — callers must subclass and build manually.
        throw new Error(`Cannot instantiate abstract RasterPass from template "${tplName}"`);
      }
      case 'fullscreen': {
        if (!template.shaderKey) {
          throw new Error(`FullscreenPass template "${tplName}" requires shaderKey`);
        }
        if (!template.inputName || !template.outputName) {
          throw new Error(`FullscreenPass template "${tplName}" requires inputName and outputName`);
        }
        const input = PassFactory.getAttachment(template.inputName, attachmentCache);
        const output = PassFactory.getAttachment(template.outputName, attachmentCache);
        return new FullscreenPass(template.name, template.shaderKey, input, output);
      }
      case 'compute': {
        if (!template.shaderKey) {
          throw new Error(`ComputePass template "${tplName}" requires shaderKey`);
        }
        return new ComputePass(template.name, template.shaderKey);
      }
      case 'selector': {
        const idx = template.selectorIndex ?? 0;
        const pass = new SelectorPass(template.name, () => idx);
        if (template.children) {
          for (const childTpl of template.children) {
            pass.addChild(PassFactory.fromTemplate(childTpl, attachmentCache));
          }
        }
        return pass;
      }
      default: {
        throw new Error(`Unknown pass type for template "${tplName}"`);
      }
    }
  }

  /** Helper: get-or-create an attachment by name from the cache. */
  private static getAttachment(
    name: string,
    cache: Map<string, PassAttachment>,
  ): PassAttachment {
    let a = cache.get(name);
    if (!a) {
      a = new PassAttachment({ name, format: 'rgba8', width: 0, height: 0 });
      cache.set(name, a);
    }
    return a;
  }
}
