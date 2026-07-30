// AssetBundle 单元测试。
//
// 验证:
//   • createBundle / registerBundle / getBundleInfo / exportManifest
//   • loadBundle / unloadBundle / isBundleLoaded
//   • getAsset / hasAsset
//   • addDependency / getDependencies + 依赖加载顺序
//   • setCompression / setMaxConcurrentLoads
//   • getLoadingProgress / getLoadedBundles / getStats / clearCache
//   • 并发限流(maxConcurrentLoads)
//   • 自定义 loader 注入

import { describe, it, expect } from 'vitest';
import { AssetBundle, type AssetEntry } from './AssetBundle';

function sampleAssets(): AssetEntry[] {
  return [
    { name: 'mesh', type: 'mesh', size: 1024, hash: 'a1' },
    { name: 'tex', type: 'texture', size: 2048, hash: 'b2' },
  ];
}

describe('AssetBundle — createBundle / registerBundle', () => {
  it('createBundle 构造 manifest + 立即加载(若提供 data)', () => {
    const ab = new AssetBundle();
    const data = new Map<string, unknown>([['mesh', { v: 1 }], ['tex', { v: 2 }]]);
    const entry = ab.createBundle('player', sampleAssets(), data);
    expect(entry.name).toBe('player');
    expect(entry.manifest.assets).toHaveLength(2);
    expect(entry.manifest.totalSize).toBe(3072);
    expect(entry.manifest.version).toBe('1.0.0');
    expect(entry.manifest.checksum).toBeTruthy();
    expect(entry.isLoaded).toBe(true);
    expect(ab.isBundleLoaded('player')).toBe(true);
  });

  it('createBundle 不提供 data 时不标记为已加载', () => {
    const ab = new AssetBundle();
    ab.createBundle('player', sampleAssets());
    expect(ab.isBundleLoaded('player')).toBe(false);
  });

  it('createBundle 覆盖已存在的同名 bundle', () => {
    const ab = new AssetBundle();
    ab.createBundle('p', sampleAssets());
    ab.createBundle('p', [{ name: 'x', type: 'mesh', size: 1, hash: 'h' }]);
    expect(ab.getBundleInfo('p')!.assetCount).toBe(1);
  });

  it('registerBundle 仅注册不加载', () => {
    const ab = new AssetBundle();
    const manifest = {
      assets: sampleAssets(),
      totalSize: 3072,
      version: '2.0.0',
      checksum: 'abcdef',
    };
    const entry = ab.registerBundle('p', manifest);
    expect(entry.isLoaded).toBe(false);
    expect(ab.isBundleLoaded('p')).toBe(false);
    expect(ab.getBundleInfo('p')!.version).toBe('2.0.0');
    expect(ab.getBundleInfo('p')!.checksum).toBe('abcdef');
  });

  it('getBundleInfo 未注册返回 undefined', () => {
    const ab = new AssetBundle();
    expect(ab.getBundleInfo('missing')).toBeUndefined();
  });

  it('exportManifest 返回副本', () => {
    const ab = new AssetBundle();
    ab.createBundle('p', sampleAssets());
    const m1 = ab.exportManifest('p')!;
    const m2 = ab.exportManifest('p')!;
    expect(m1).not.toBe(m2);
    expect(m1.assets).not.toBe(m2.assets);
    expect(m1.assets[0]).not.toBe(m2.assets[0]);
    expect(m1.assets).toEqual(m2.assets);
    expect(ab.exportManifest('missing')).toBeUndefined();
  });
});

describe('AssetBundle — loadBundle / unloadBundle', () => {
  it('loadBundle 未注册时 reject', async () => {
    const ab = new AssetBundle();
    await expect(ab.loadBundle('missing')).rejects.toThrow(/not registered/);
  });

  it('loadBundle 无 loader 时标记为 loaded', async () => {
    const ab = new AssetBundle();
    ab.createBundle('p', sampleAssets());
    await ab.loadBundle('p');
    expect(ab.isBundleLoaded('p')).toBe(true);
  });

  it('loadBundle 已加载时直接 resolve(幂等)', async () => {
    const ab = new AssetBundle();
    ab.createBundle('p', sampleAssets());
    await ab.loadBundle('p');
    await expect(ab.loadBundle('p')).resolves.toBeUndefined();
  });

  it('loadBundle 重复调用返回同一 Promise(去重)', async () => {
    const ab = new AssetBundle();
    ab.createBundle('p', sampleAssets());
    const p1 = ab.loadBundle('p');
    const p2 = ab.loadBundle('p');
    expect(p1).toBe(p2);
    await p1;
  });

  it('loadBundle 注入 loader 后写入 data + cache', async () => {
    const ab = new AssetBundle({
      loader: async (name) => {
        expect(name).toBe('p');
        return new Map([['mesh', { v: 1 }], ['tex', { v: 2 }]]);
      },
    });
    ab.registerBundle('p', {
      assets: sampleAssets(),
      totalSize: 3072,
      version: '1.0.0',
      checksum: 'x',
    });
    await ab.loadBundle('p');
    expect(ab.getAsset('p', 'mesh')).toEqual({ v: 1 });
    expect(ab.hasAsset('p', 'mesh')).toBe(true);
  });

  it('loadBundle loader 抛错时 reject 且 isLoaded 仍为 false', async () => {
    const ab = new AssetBundle({
      loader: async () => { throw new Error('boom'); },
    });
    ab.registerBundle('p', {
      assets: sampleAssets(),
      totalSize: 3072,
      version: '1.0.0',
      checksum: 'x',
    });
    await expect(ab.loadBundle('p')).rejects.toThrow('boom');
    expect(ab.isBundleLoaded('p')).toBe(false);
  });

  it('unloadBundle 清理 data + cache + loadedBundles', () => {
    const ab = new AssetBundle();
    const data = new Map([['mesh', { v: 1 }]]);
    ab.createBundle('p', sampleAssets(), data);
    expect(ab.unloadBundle('p')).toBe(true);
    expect(ab.isBundleLoaded('p')).toBe(false);
    expect(ab.getAsset('p', 'mesh')).toBeUndefined();
    // 重新加载后可再次使用。
    expect(ab.unloadBundle('p')).toBe(false); // 已卸载
    expect(ab.unloadBundle('missing')).toBe(false);
  });
});

describe('AssetBundle — getAsset / hasAsset', () => {
  it('未加载 bundle 返回 undefined', () => {
    const ab = new AssetBundle();
    ab.createBundle('p', sampleAssets());
    expect(ab.getAsset('p', 'mesh')).toBeUndefined();
    expect(ab.hasAsset('p', 'mesh')).toBe(false);
  });

  it('已加载 bundle 但 assetName 不存在返回 undefined', () => {
    const ab = new AssetBundle();
    ab.createBundle('p', sampleAssets(), new Map([['mesh', { v: 1 }]]));
    expect(ab.getAsset('p', 'missing')).toBeUndefined();
    // hasAsset 也参考 manifest,故 manifest 中存在的 name 返回 true。
    expect(ab.hasAsset('p', 'tex')).toBe(true);
  });

  it('getAsset 泛型返回', () => {
    const ab = new AssetBundle();
    ab.createBundle('p', sampleAssets(), new Map([['mesh', { v: 42 }]]));
    const v = ab.getAsset<{ v: number }>('p', 'mesh');
    expect(v?.v).toBe(42);
  });
});

describe('AssetBundle — 依赖', () => {
  it('addDependency / getDependencies', () => {
    const ab = new AssetBundle();
    ab.createBundle('a', sampleAssets());
    ab.createBundle('b', sampleAssets());
    expect(ab.addDependency('a', 'b')).toBe(true);
    expect(ab.getDependencies('a')).toEqual(['b']);
    expect(ab.getDependencies('b')).toEqual([]);
    expect(ab.addDependency('missing', 'b')).toBe(false);
  });

  it('addDependency 重复添加去重', () => {
    const ab = new AssetBundle();
    ab.createBundle('a', sampleAssets());
    ab.addDependency('a', 'b');
    ab.addDependency('a', 'b');
    expect(ab.getDependencies('a')).toEqual(['b']);
  });

  it('loadBundle 先加载依赖', async () => {
    const order: string[] = [];
    const ab = new AssetBundle({
      loader: async (name) => {
        order.push(name);
        return new Map();
      },
    });
    ab.registerBundle('dep', { assets: [], totalSize: 0, version: '1', checksum: 'd' });
    ab.registerBundle('main', { assets: [], totalSize: 0, version: '1', checksum: 'm' });
    ab.addDependency('main', 'dep');
    await ab.loadBundle('main');
    expect(order).toEqual(['dep', 'main']);
  });

  it('getDependencies 未注册返回空数组', () => {
    const ab = new AssetBundle();
    expect(ab.getDependencies('missing')).toEqual([]);
  });
});

describe('AssetBundle — 并发限流', () => {
  it('setMaxConcurrentLoads 至少 1', () => {
    const ab = new AssetBundle();
    ab.setMaxConcurrentLoads(0);
    expect(ab.maxConcurrentLoads).toBe(1);
    ab.setMaxConcurrentLoads(8);
    expect(ab.maxConcurrentLoads).toBe(8);
  });

  it('maxConcurrentLoads=1 时串行加载', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const ab = new AssetBundle({
      maxConcurrentLoads: 1,
      loader: async (name) => {
        active++;
        maxActive = Math.max(maxActive, active);
        order.push(`start:${name}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end:${name}`);
        active--;
        return new Map();
      },
    });
    for (const n of ['a', 'b', 'c']) {
      ab.registerBundle(n, { assets: [], totalSize: 0, version: '1', checksum: n });
    }
    await Promise.all([ab.loadBundle('a'), ab.loadBundle('b'), ab.loadBundle('c')]);
    expect(maxActive).toBe(1);
    // 串行:start:a < end:a < start:b < end:b < start:c < end:c
    expect(order).toEqual([
      'start:a', 'end:a',
      'start:b', 'end:b',
      'start:c', 'end:c',
    ]);
  });

  it('maxConcurrentLoads=3 时最多 3 个并发', async () => {
    let active = 0;
    let maxActive = 0;
    const ab = new AssetBundle({
      maxConcurrentLoads: 3,
      loader: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return new Map();
      },
    });
    for (const n of ['a', 'b', 'c', 'd', 'e']) {
      ab.registerBundle(n, { assets: [], totalSize: 0, version: '1', checksum: n });
    }
    await Promise.all(['a', 'b', 'c', 'd', 'e'].map((n) => ab.loadBundle(n)));
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});

describe('AssetBundle — 配置 / 统计', () => {
  it('setCompression 切换标志', () => {
    const ab = new AssetBundle();
    expect(ab.compressionEnabled).toBe(false);
    ab.setCompression(true);
    expect(ab.compressionEnabled).toBe(true);
  });

  it('构造参数 compressionEnabled', () => {
    const ab = new AssetBundle({ compressionEnabled: true });
    expect(ab.compressionEnabled).toBe(true);
  });

  it('getLoadedBundles 返回已加载列表', () => {
    const ab = new AssetBundle();
    ab.createBundle('a', [], new Map());
    ab.createBundle('b', []);
    expect(ab.getLoadedBundles()).toEqual(['a']);
  });

  it('getStats 反映注册/加载数', async () => {
    const ab = new AssetBundle();
    ab.createBundle('a', sampleAssets(), new Map([['mesh', 1]]));
    ab.createBundle('b', sampleAssets());
    let stats = ab.getStats();
    expect(stats.registeredBundles).toBe(2);
    expect(stats.loadedBundles).toBe(1);
    expect(stats.totalAssets).toBe(1);
    expect(stats.totalLoadedBytes).toBe(3072);
    expect(stats.cacheSize).toBe(1);

    await ab.loadBundle('b');
    stats = ab.getStats();
    expect(stats.loadedBundles).toBe(2);
  });

  it('clearCache 清理 cache 但不影响 bundle data', () => {
    const ab = new AssetBundle();
    ab.createBundle('a', sampleAssets(), new Map([['mesh', 1]]));
    expect(ab.cache.size).toBe(1);
    ab.clearCache();
    expect(ab.cache.size).toBe(0);
    // bundle data 仍在。
    expect(ab.getAsset('a', 'mesh')).toBe(1);
  });

  it('getLoadingProgress 反映进度', async () => {
    const ab = new AssetBundle({
      maxConcurrentLoads: 1,
      loader: async () => {
        await new Promise((r) => setTimeout(r, 20));
        return new Map();
      },
    });
    ab.registerBundle('a', { assets: [], totalSize: 0, version: '1', checksum: 'a' });
    ab.registerBundle('b', { assets: [], totalSize: 0, version: '1', checksum: 'b' });
    const pa = ab.loadBundle('a');
    const pb = ab.loadBundle('b');
    // 此时 a 在加载,b 在队列。
    const prog = ab.getLoadingProgress();
    expect(prog.active).toBe(1);
    expect(prog.queued).toBe(1);
    expect(prog.completed).toBe(0);
    await Promise.all([pa, pb]);
    // 完成后 ratio=1(无新任务进队列时)。
    const finalProg = ab.getLoadingProgress();
    expect(finalProg.completed).toBeGreaterThanOrEqual(2);
  });
});

describe('AssetBundle — manifest 校验和', () => {
  it('相同 name+assets 生成相同 checksum', () => {
    const ab1 = new AssetBundle();
    const ab2 = new AssetBundle();
    ab1.createBundle('p', sampleAssets());
    ab2.createBundle('p', sampleAssets());
    expect(ab1.getBundleInfo('p')!.checksum).toBe(ab2.getBundleInfo('p')!.checksum);
  });

  it('不同 name 生成不同 checksum', () => {
    const ab = new AssetBundle();
    ab.createBundle('p1', sampleAssets());
    ab.createBundle('p2', sampleAssets());
    expect(ab.getBundleInfo('p1')!.checksum).not.toBe(ab.getBundleInfo('p2')!.checksum);
  });
});
