// ShadowMapManager 单元测试。
//
// 覆盖:构造默认值、属性切换、getShadowMap 对未知光源返回 null、
//       enabled=false 时 render() 不触碰 GL、dispose() 不崩溃。
//
// 设计说明:WebGL2RenderingContext 在 node 测试环境不可用,所以本测试
// 只验证"不需要 GL 调用"的 API 表面。GL 相关路径(实际 FBO 分配、
// shader 编译、draw call)需要浏览器环境或 WebGL mock,留作集成测试。
//
// 为了让构造不立即触发 GL 调用,ShadowMapManager 的 GL 资源都是懒分配:
// program 在首次 _getDepthProgram 时编译,FBO 在首次 _getShadowResources
// 时创建。enabled=false 时 render() 直接 return,不会走到这些路径。
//
// 测试中传入 `{} as WebGL2RenderingContext` 占位;只在 enabled=false 路径
// 调用 render(),避免触发真实 GL 调用。

import { describe, it, expect } from 'vitest';
import { ShadowMapManager, type ShadowType } from './ShadowMapManager';
import { DirectionalLight } from '../Lights/DirectionalLight';
import { AmbientLight } from '../Lights/AmbientLight';
import { Scene } from '../Core/Scene';
import type { Camera } from '../Cameras/Camera';

/** 构造一个不触碰 GL 的 ShadowMapManager(enabled=false)。 */
function makeManager(): ShadowMapManager {
  const gl = {} as WebGL2RenderingContext;
  return new ShadowMapManager(gl, { enabled: false });
}

/** Camera 是抽象类,用类型断言占位(render 在 enabled=false 时不读 camera)。 */
function makeCamera(): Camera {
  return {} as Camera;
}


describe('ShadowMapManager', () => {
  describe('构造与默认值', () => {
    it('默认:type=pcf, enabled=false, renderSingleSided=true, defaultMapSize=1024', () => {
      const m = new ShadowMapManager({} as WebGL2RenderingContext);
      expect(m.type).toBe('pcf');
      expect(m.enabled).toBe(false);
      expect(m.renderSingleSided).toBe(true);
      expect(m.defaultMapSize).toBe(1024);
    });

    it('接受选项覆盖', () => {
      const m = new ShadowMapManager({} as WebGL2RenderingContext, {
        type: 'basic',
        enabled: true,
        renderSingleSided: false,
        defaultMapSize: 2048,
      });
      expect(m.type).toBe('basic');
      expect(m.enabled).toBe(true);
      expect(m.renderSingleSided).toBe(false);
      expect(m.defaultMapSize).toBe(2048);
    });

    it('gl 引用被保留', () => {
      const gl = {} as WebGL2RenderingContext;
      const m = new ShadowMapManager(gl);
      expect(m.gl).toBe(gl);
    });
  });

  describe('属性切换', () => {
    it('type 可在 basic 与 pcf 间切换', () => {
      const m = makeManager();
      const types: ShadowType[] = ['basic', 'pcf', 'basic', 'pcf'];
      for (const t of types) {
        m.type = t;
        expect(m.type).toBe(t);
      }
    });

    it('enabled 可切换 true/false', () => {
      const m = makeManager();
      expect(m.enabled).toBe(false);
      m.enabled = true;
      expect(m.enabled).toBe(true);
      m.enabled = false;
      expect(m.enabled).toBe(false);
    });

    it('renderSingleSided 可切换', () => {
      const m = makeManager();
      expect(m.renderSingleSided).toBe(true);
      m.renderSingleSided = false;
      expect(m.renderSingleSided).toBe(false);
    });

    it('defaultMapSize 可调整', () => {
      const m = makeManager();
      m.defaultMapSize = 512;
      expect(m.defaultMapSize).toBe(512);
    });
  });

  describe('getShadowMap', () => {
    it('对未参与过 render 的光源返回 null', () => {
      const m = makeManager();
      const light = new DirectionalLight();
      light.castShadow = true;
      expect(m.getShadowMap(light)).toBeNull();
    });

    it('getLightViewProjection 对未知光源返回 null', () => {
      const m = makeManager();
      const light = new DirectionalLight();
      light.castShadow = true;
      expect(m.getLightViewProjection(light)).toBeNull();
    });

    it('对非 castShadow 光源也返回 null(不强制 castShadow 检查)', () => {
      const m = makeManager();
      const light = new DirectionalLight();
      light.castShadow = false;
      expect(m.getShadowMap(light)).toBeNull();
    });
  });

  describe('render (enabled=false)', () => {
    it('enabled=false 时 render() 立即返回,不抛异常', () => {
      const m = makeManager();
      const scene = new Scene();
      const camera = makeCamera();
      const lights: Array<AmbientLight | DirectionalLight> = [
        new DirectionalLight(),
      ];
      expect(() => m.render(lights, scene, camera)).not.toThrow();
    });

    it('enabled=false 时即使光源 castShadow=true 也不分配 FBO', () => {
      const m = makeManager();
      const scene = new Scene();
      const camera = makeCamera();
      const light = new DirectionalLight();
      light.castShadow = true;
      expect(() => m.render([light], scene, camera)).not.toThrow();
      // 未分配过阴影贴图
      expect(m.getShadowMap(light)).toBeNull();
    });

    it('空光源数组时 render() 不抛异常', () => {
      const m = new ShadowMapManager({} as WebGL2RenderingContext, { enabled: true });
      const scene = new Scene();
      const camera = makeCamera();
      expect(() => m.render([], scene, camera)).not.toThrow();
    });

    it('所有光源都不 castShadow 时 render() 不抛异常', () => {
      const m = new ShadowMapManager({} as WebGL2RenderingContext, { enabled: true });
      const scene = new Scene();
      const camera = makeCamera();
      const light = new DirectionalLight();
      light.castShadow = false;
      expect(() => m.render([light], scene, camera)).not.toThrow();
    });
  });

  describe('dispose', () => {
    it('对空管理器 dispose 不抛异常', () => {
      const m = makeManager();
      expect(() => m.dispose()).not.toThrow();
    });

    it('dispose 可重复调用', () => {
      const m = makeManager();
      m.dispose();
      m.dispose();
      expect(true).toBe(true);
    });
  });

  describe('invalidateSceneBounds', () => {
    it('可在未渲染前调用且不抛异常', () => {
      const m = makeManager();
      expect(() => m.invalidateSceneBounds()).not.toThrow();
    });
  });

  describe('isCastShadowLight', () => {
    it('对 DirectionalLight + castShadow=true 返回 true', async () => {
      const { isCastShadowLight } = await import('./ShadowMapManager');
      const light = new DirectionalLight();
      light.castShadow = true;
      expect(isCastShadowLight(light)).toBe(true);
    });

    it('对 DirectionalLight + castShadow=false 返回 false', async () => {
      const { isCastShadowLight } = await import('./ShadowMapManager');
      const light = new DirectionalLight();
      light.castShadow = false;
      expect(isCastShadowLight(light)).toBe(false);
    });

    it('对 AmbientLight 返回 false', async () => {
      const { isCastShadowLight } = await import('./ShadowMapManager');
      const amb = new AmbientLight();
      expect(isCastShadowLight(amb)).toBe(false);
    });
  });
});
