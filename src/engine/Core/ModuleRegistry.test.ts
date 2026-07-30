import { describe, it, expect, beforeEach } from 'vitest';
import {
  ModuleRegistry,
  getDefaultModuleRegistry,
  resetDefaultModuleRegistry,
  type EngineModule,
} from './ModuleRegistry';

function makeModule(
  name: string,
  opts: Partial<Pick<EngineModule, 'dependencies' | 'onLoad' | 'onUnload' | 'version' | 'description'>> = {},
): EngineModule {
  return {
    name,
    version: opts.version ?? '1.0.0',
    description: opts.description ?? `${name} module`,
    dependencies: opts.dependencies ?? [],
    onLoad: opts.onLoad ?? (() => {}),
    onUnload: opts.onUnload ?? (() => {}),
    isActive: false,
  };
}

describe('ModuleRegistry', () => {
  let reg: ModuleRegistry;
  beforeEach(() => {
    reg = new ModuleRegistry();
  });

  describe('registerModule / getModule / getAvailableModules', () => {
    it('registers and retrieves a module', () => {
      const m = makeModule('Physics');
      expect(reg.registerModule(m)).toBe(false); // new registration → false
      expect(reg.getModule('Physics')).toBe(m);
      expect(reg.getAvailableModules()).toEqual(['Physics']);
    });

    it('registerModule overwrites existing and returns true', () => {
      reg.registerModule(makeModule('Physics', { version: '1.0.0' }));
      const overwritten = reg.registerModule(makeModule('Physics', { version: '2.0.0' }));
      expect(overwritten).toBe(true);
      expect(reg.getModule('Physics')?.version).toBe('2.0.0');
    });

    it('getModule returns undefined for unknown name', () => {
      expect(reg.getModule('nope')).toBeUndefined();
    });

    it('getAvailableModules returns a snapshot', () => {
      reg.registerModule(makeModule('A'));
      const list = reg.getAvailableModules();
      list.push('fake');
      expect(reg.getAvailableModules()).toEqual(['A']);
    });
  });

  describe('unregisterModule', () => {
    it('removes a registered module', () => {
      reg.registerModule(makeModule('A'));
      expect(reg.unregisterModule('A')).toBe(true);
      expect(reg.getModule('A')).toBeUndefined();
      expect(reg.getAvailableModules()).toEqual([]);
    });

    it('returns false for unknown name', () => {
      expect(reg.unregisterModule('nope')).toBe(false);
    });

    it('unloads a loaded module before unregistering', () => {
      let unloaded = false;
      reg.registerModule(makeModule('A', { onUnload: () => (unloaded = true) }));
      reg.loadModule('A');
      reg.unregisterModule('A');
      expect(unloaded).toBe(true);
    });
  });

  describe('checkDependencies', () => {
    it('returns true when no dependencies', () => {
      reg.registerModule(makeModule('A'));
      expect(reg.checkDependencies('A')).toBe(true);
    });

    it('returns true when all dependencies are registered', () => {
      reg.registerModule(makeModule('Base'));
      reg.registerModule(makeModule('Derived', { dependencies: ['Base'] }));
      expect(reg.checkDependencies('Derived')).toBe(true);
    });

    it('returns false when a dependency is missing', () => {
      reg.registerModule(makeModule('Derived', { dependencies: ['Missing'] }));
      expect(reg.checkDependencies('Derived')).toBe(false);
    });

    it('returns false for unknown module', () => {
      expect(reg.checkDependencies('nope')).toBe(false);
    });
  });

  describe('loadModule', () => {
    it('loads a module and calls onLoad + sets isActive', () => {
      let loaded = false;
      reg.registerModule(makeModule('A', { onLoad: () => (loaded = true) }));
      const ok = reg.loadModule('A');
      expect(ok).toBe(true);
      expect(loaded).toBe(true);
      expect(reg.getModule('A')?.isActive).toBe(true);
      expect(reg.getLoadedModules()).toContain('A');
    });

    it('returns false for unregistered module', () => {
      expect(reg.loadModule('nope')).toBe(false);
      expect(reg.getLoadedModules()).toEqual([]);
    });

    it('is idempotent (loading twice returns true, onLoad called once)', () => {
      let count = 0;
      reg.registerModule(makeModule('A', { onLoad: () => count++ }));
      expect(reg.loadModule('A')).toBe(true);
      expect(reg.loadModule('A')).toBe(true);
      expect(count).toBe(1);
      expect(reg.getLoadedModules()).toEqual(['A']);
    });

    it('recursively loads dependencies first', () => {
      const loadOrder: string[] = [];
      reg.registerModule(makeModule('Base', { onLoad: () => loadOrder.push('Base') }));
      reg.registerModule(makeModule('Mid', { dependencies: ['Base'], onLoad: () => loadOrder.push('Mid') }));
      reg.registerModule(makeModule('Top', { dependencies: ['Mid'], onLoad: () => loadOrder.push('Top') }));
      expect(reg.loadModule('Top')).toBe(true);
      expect(loadOrder).toEqual(['Base', 'Mid', 'Top']);
      expect(reg.getLoadedModules().sort()).toEqual(['Base', 'Mid', 'Top']);
    });

    it('fails if a dependency is not registered', () => {
      reg.registerModule(makeModule('Derived', { dependencies: ['Missing'] }));
      expect(reg.loadModule('Derived')).toBe(false);
      expect(reg.getLoadedModules()).toEqual([]);
      expect(reg.getModule('Derived')?.isActive).toBe(false);
    });

    it('fails if onLoad throws (isActive stays false, not in loadedModules)', () => {
      reg.registerModule(makeModule('A', { onLoad: () => { throw new Error('boom'); } }));
      expect(reg.loadModule('A')).toBe(false);
      expect(reg.getLoadedModules()).not.toContain('A');
      expect(reg.getModule('A')?.isActive).toBe(false);
    });

    it('fails if a dependency fails to load (chain aborts)', () => {
      reg.registerModule(makeModule('Base', { onLoad: () => { throw new Error('boom'); } }));
      reg.registerModule(makeModule('Derived', { dependencies: ['Base'] }));
      expect(reg.loadModule('Derived')).toBe(false);
      expect(reg.getLoadedModules()).toEqual([]);
    });
  });

  describe('unloadModule', () => {
    it('unloads a loaded module and calls onUnload', () => {
      let unloaded = false;
      reg.registerModule(makeModule('A', { onUnload: () => (unloaded = true) }));
      reg.loadModule('A');
      expect(reg.unloadModule('A')).toBe(true);
      expect(unloaded).toBe(true);
      expect(reg.getModule('A')?.isActive).toBe(false);
      expect(reg.getLoadedModules()).not.toContain('A');
    });

    it('returns false for not-loaded module', () => {
      reg.registerModule(makeModule('A'));
      expect(reg.unloadModule('A')).toBe(false);
    });

    it('refuses to unload a module still depended on by a loaded module', () => {
      reg.registerModule(makeModule('Base'));
      reg.registerModule(makeModule('Derived', { dependencies: ['Base'] }));
      reg.loadModule('Derived');
      expect(reg.unloadModule('Base')).toBe(false);
      expect(reg.getLoadedModules()).toContain('Base');
    });

    it('allows unload after dependent is unloaded first', () => {
      reg.registerModule(makeModule('Base'));
      reg.registerModule(makeModule('Derived', { dependencies: ['Base'] }));
      reg.loadModule('Derived');
      reg.unloadModule('Derived');
      expect(reg.unloadModule('Base')).toBe(true);
    });

    it('still completes unload if onUnload throws', () => {
      reg.registerModule(makeModule('A', { onUnload: () => { throw new Error('boom'); } }));
      reg.loadModule('A');
      expect(reg.unloadModule('A')).toBe(true);
      expect(reg.getLoadedModules()).not.toContain('A');
    });
  });

  describe('getLoadedModules', () => {
    it('returns snapshot of loaded module names', () => {
      reg.registerModule(makeModule('A'));
      reg.registerModule(makeModule('B'));
      reg.loadModule('A');
      expect(reg.getLoadedModules()).toEqual(['A']);
      reg.loadModule('B');
      expect(reg.getLoadedModules().sort()).toEqual(['A', 'B']);
    });
  });

  describe('getModuleInfo / listModules', () => {
    it('getModuleInfo returns serializable snapshot with active flag', () => {
      reg.registerModule(makeModule('A', { version: '2.1.0', description: 'desc', dependencies: ['B'] }));
      reg.registerModule(makeModule('B'));
      const info = reg.getModuleInfo('A');
      expect(info).toEqual({
        name: 'A',
        version: '2.1.0',
        description: 'desc',
        dependencies: ['B'],
        active: false,
      });
      reg.loadModule('A');
      expect(reg.getModuleInfo('A')?.active).toBe(true);
    });

    it('getModuleInfo returns undefined for unknown module', () => {
      expect(reg.getModuleInfo('nope')).toBeUndefined();
    });

    it('listModules returns info for all modules', () => {
      reg.registerModule(makeModule('A'));
      reg.registerModule(makeModule('B'));
      const list = reg.listModules();
      expect(list.map((m) => m.name).sort()).toEqual(['A', 'B']);
    });

    it('listModules dependencies array is a copy (mutating does not affect registry)', () => {
      reg.registerModule(makeModule('A', { dependencies: ['B'] }));
      const info = reg.listModules()[0];
      info.dependencies.push('fake');
      expect(reg.getModule('A')?.dependencies).toEqual(['B']);
    });
  });

  describe('exportManifest / importManifest', () => {
    it('exportManifest serializes all modules with active flag', () => {
      reg.registerModule(makeModule('A'));
      reg.registerModule(makeModule('B', { dependencies: ['A'] }));
      reg.loadModule('A');
      const manifest = reg.exportManifest();
      expect(manifest.modules).toHaveLength(2);
      const a = manifest.modules.find((m) => m.name === 'A');
      const b = manifest.modules.find((m) => m.name === 'B');
      expect(a?.active).toBe(true);
      expect(b?.active).toBe(false);
      expect(b?.dependencies).toEqual(['A']);
    });

    it('importManifest loads modules marked active', () => {
      reg.registerModule(makeModule('A'));
      reg.registerModule(makeModule('B'));
      const report = reg.importManifest({
        modules: [
          { name: 'A', version: '1.0.0', description: '', dependencies: [], active: true },
          { name: 'B', version: '1.0.0', description: '', dependencies: [], active: false },
        ],
      });
      expect(report.loaded).toEqual(['A']);
      expect(report.skipped).toEqual(['B']);
      expect(report.failed).toEqual([]);
      expect(reg.getLoadedModules()).toContain('A');
      expect(reg.getLoadedModules()).not.toContain('B');
    });

    it('importManifest reports failed for unregistered active modules', () => {
      const report = reg.importManifest({
        modules: [
          { name: 'Ghost', version: '1.0.0', description: '', dependencies: [], active: true },
        ],
      });
      expect(report.failed).toEqual(['Ghost']);
      expect(report.loaded).toEqual([]);
    });

    it('importManifest loads dependencies in order (transitive)', () => {
      reg.registerModule(makeModule('Base'));
      reg.registerModule(makeModule('Mid', { dependencies: ['Base'] }));
      const report = reg.importManifest({
        modules: [
          { name: 'Mid', version: '1.0.0', description: '', dependencies: ['Base'], active: true },
          { name: 'Base', version: '1.0.0', description: '', dependencies: [], active: false },
        ],
      });
      expect(report.loaded).toEqual(['Mid']);
      // Base loaded transitively even though marked inactive in manifest
      expect(reg.getLoadedModules().sort()).toEqual(['Base', 'Mid']);
    });

    it('importManifest handles empty modules array', () => {
      const report = reg.importManifest({ modules: [] });
      expect(report.loaded).toEqual([]);
      expect(report.failed).toEqual([]);
      expect(report.skipped).toEqual([]);
    });

    it('export → import round-trip reloads same active set', () => {
      reg.registerModule(makeModule('A'));
      reg.registerModule(makeModule('B', { dependencies: ['A'] }));
      reg.loadModule('B');
      const manifest = reg.exportManifest();
      // New registry with same module definitions
      const reg2 = new ModuleRegistry();
      reg2.registerModule(makeModule('A'));
      reg2.registerModule(makeModule('B', { dependencies: ['A'] }));
      const report = reg2.importManifest(manifest);
      expect(report.loaded.sort()).toEqual(['A', 'B']);
      expect(reg2.getLoadedModules().sort()).toEqual(['A', 'B']);
    });
  });

  describe('clear', () => {
    it('removes all modules and loaded state', () => {
      reg.registerModule(makeModule('A'));
      reg.registerModule(makeModule('B'));
      reg.loadModule('A');
      reg.clear();
      expect(reg.getAvailableModules()).toEqual([]);
      expect(reg.getLoadedModules()).toEqual([]);
      expect(reg.getModule('A')).toBeUndefined();
    });
  });

  describe('default singleton', () => {
    it('getDefaultModuleRegistry returns same instance', () => {
      resetDefaultModuleRegistry();
      const a = getDefaultModuleRegistry();
      const b = getDefaultModuleRegistry();
      expect(a).toBe(b);
    });

    it('resetDefaultModuleRegistry clears singleton', () => {
      const a = getDefaultModuleRegistry();
      a.registerModule(makeModule('A'));
      resetDefaultModuleRegistry();
      const b = getDefaultModuleRegistry();
      expect(b).not.toBe(a);
      expect(b.getAvailableModules()).toEqual([]);
    });
  });
});
