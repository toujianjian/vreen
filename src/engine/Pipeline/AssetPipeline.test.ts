import { describe, it, expect } from 'vitest';
import { AssetPipeline, type PipelineAsset, type PipelineStep } from './AssetPipeline';

describe('AssetPipeline', () => {
  describe('addStep / getStep / removeStep', () => {
    it('addStep 添加步骤,stepCount 增加', () => {
      const p = new AssetPipeline();
      expect(p.stepCount).toBe(0);
      p.addStep({ name: 'a', process: (a) => a });
      expect(p.stepCount).toBe(1);
      p.addStep({ name: 'b', process: (a) => a });
      expect(p.stepCount).toBe(2);
    });

    it('addStep 同名覆盖', () => {
      const p = new AssetPipeline();
      const s1: PipelineStep = { name: 'x', process: (a) => a };
      const s2: PipelineStep = { name: 'x', process: (a) => ({ ...a, metadata: { replaced: true } }) };
      p.addStep(s1);
      p.addStep(s2);
      expect(p.stepCount).toBe(1);
      expect(p.getStep('x')).toBe(s2);
    });

    it('addStep 名为空抛错', () => {
      const p = new AssetPipeline();
      expect(() => p.addStep({ name: '', process: (a) => a })).toThrow();
    });

    it('getStep 未找到返回 undefined', () => {
      const p = new AssetPipeline();
      expect(p.getStep('missing')).toBeUndefined();
    });

    it('getStep 找到返回步骤', () => {
      const p = new AssetPipeline();
      const s = { name: 'foo', process: (a: PipelineAsset) => a };
      p.addStep(s);
      expect(p.getStep('foo')).toBe(s);
    });

    it('removeStep 移除后 stepCount 减少', () => {
      const p = new AssetPipeline();
      p.addStep({ name: 'a', process: (a) => a });
      p.addStep({ name: 'b', process: (a) => a });
      p.addStep({ name: 'c', process: (a) => a });
      expect(p.removeStep('b')).toBe(true);
      expect(p.stepCount).toBe(2);
      expect(p.getStep('b')).toBeUndefined();
    });

    it('removeStep 不存在的名返回 false', () => {
      const p = new AssetPipeline();
      expect(p.removeStep('missing')).toBe(false);
    });

    it('removeStep 后索引重建正确', () => {
      const p = new AssetPipeline();
      p.addStep({ name: 'a', process: (a) => a });
      p.addStep({ name: 'b', process: (a) => a });
      p.addStep({ name: 'c', process: (a) => a });
      p.removeStep('a');
      // 移除 a 后,b/c 仍在
      expect(p.getStep('b')).toBeDefined();
      expect(p.getStep('c')).toBeDefined();
      expect(p.getStepNames()).toEqual(['b', 'c']);
    });

    it('getStepNames 按添加顺序', () => {
      const p = new AssetPipeline();
      p.addStep({ name: 'first', process: (a) => a });
      p.addStep({ name: 'second', process: (a) => a });
      p.addStep({ name: 'third', process: (a) => a });
      expect(p.getStepNames()).toEqual(['first', 'second', 'third']);
    });
  });

  describe('process', () => {
    it('空管线返回原资源', async () => {
      const p = new AssetPipeline();
      const asset: PipelineAsset = { type: 'geometry', data: { x: 1 } };
      const out = await p.process(asset);
      expect(out).toBe(asset);
    });

    it('步骤按顺序执行,前一步输出作为下一步输入', async () => {
      const p = new AssetPipeline();
      p.addStep({ name: 'add1', process: (a) => ({ ...a, data: { n: (a.data as any).n + 1 } }) });
      p.addStep({ name: 'mul2', process: (a) => ({ ...a, data: { n: (a.data as any).n * 2 } }) });
      p.addStep({ name: 'add10', process: (a) => ({ ...a, data: { n: (a.data as any).n + 10 } }) });
      const out = await p.process({ type: 'num', data: { n: 5 } });
      // (5 + 1) * 2 + 10 = 22
      expect((out.data as any).n).toBe(22);
    });

    it('步骤可返回新对象(不可变)', async () => {
      const p = new AssetPipeline();
      const original: PipelineAsset = { type: 'geometry', data: { v: 1 } };
      p.addStep({ name: 'replace', process: () => ({ type: 'geometry', data: { v: 999 } }) });
      const out = await p.process(original);
      expect(out.data).toEqual({ v: 999 });
      expect(original.data).toEqual({ v: 1 });
    });

    it('异步步骤被 await', async () => {
      const p = new AssetPipeline();
      p.addStep({
        name: 'async',
        process: async (a) => {
          await new Promise(r => setTimeout(r, 10));
          return { ...a, data: { async: true } };
        },
      });
      const out = await p.process({ type: 'geometry', data: {} });
      expect((out.data as any).async).toBe(true);
    });

    it('步骤抛错时,错误以 step name 标注', async () => {
      const p = new AssetPipeline();
      p.addStep({
        name: 'fail',
        process: () => { throw new Error('boom'); },
      });
      await expect(p.process({ type: 'x', data: {} })).rejects.toThrow(/fail/);
    });

    it('asset.name 设置后被缓存', async () => {
      const p = new AssetPipeline();
      p.addStep({ name: 'tag', process: (a) => ({ ...a, data: { tagged: true } }) });
      await p.process({ type: 'geometry', data: {}, name: 'asset1' });
      const cached = p.getAsset('asset1');
      expect(cached).toBeDefined();
      expect((cached!.data as any).tagged).toBe(true);
    });
  });

  describe('processBatch', () => {
    it('成功处理多个资源', async () => {
      const p = new AssetPipeline();
      p.addStep({ name: 'inc', process: (a) => ({ ...a, data: { n: (a.data as any).n + 1 } }) });
      const assets = [
        { type: 'num', data: { n: 1 } },
        { type: 'num', data: { n: 2 } },
        { type: 'num', data: { n: 3 } },
      ];
      const result = await p.processBatch(assets);
      expect(result.succeeded.length).toBe(3);
      expect(result.failed.length).toBe(0);
      expect((result.succeeded[0].data as any).n).toBe(2);
      expect((result.succeeded[1].data as any).n).toBe(3);
      expect((result.succeeded[2].data as any).n).toBe(4);
    });

    it('部分失败不影响其他', async () => {
      const p = new AssetPipeline();
      p.addStep({
        name: 'maybeFail',
        process: (a) => {
          if ((a.data as any).fail) throw new Error('intentional');
          return a;
        },
      });
      const assets = [
        { type: 'x', data: { fail: false }, name: 'a' },
        { type: 'x', data: { fail: true }, name: 'b' },
        { type: 'x', data: { fail: false }, name: 'c' },
      ];
      const result = await p.processBatch(assets);
      expect(result.succeeded.length).toBe(2);
      expect(result.failed.length).toBe(1);
      expect(result.failed[0].asset.name).toBe('b');
      expect(result.failed[0].error.message).toContain('intentional');
    });

    it('空数组返回空结果', async () => {
      const p = new AssetPipeline();
      const r = await p.processBatch([]);
      expect(r.succeeded.length).toBe(0);
      expect(r.failed.length).toBe(0);
    });
  });

  describe('clearAssets', () => {
    it('清空缓存', async () => {
      const p = new AssetPipeline();
      p.addStep({ name: 'noop', process: (a) => a });
      await p.process({ type: 'x', data: {}, name: 'a1' });
      expect(p.getAsset('a1')).toBeDefined();
      p.clearAssets();
      expect(p.getAsset('a1')).toBeUndefined();
    });
  });
});
