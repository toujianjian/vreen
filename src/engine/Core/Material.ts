// Material — minimal interface that the WebGL2Renderer drives via a
// `program` slot. The Phong / Standard materials in step2.2 will
// implement this. Keeping it as an interface for now lets us plug in
// different shaders (unlit, phong, custom) without changing Mesh.

/** 线性 RGB 颜色,各通道 0..1。与 StandardMaterial.baseColor 一致。 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** onBeforeCompile 接收的 shader 对象(参考 three.js)。
 *  Renderer 在编译前构造此对象,材质/用户可在编译前注入 GLSL chunk
 *  或追加 uniforms/defines。 */
export interface ShaderObject {
  vertexShader: string;
  fragmentShader: string;
  /** Uniform 名 → 值(可选;renderer 已有的 uniforms 会被合并)。 */
  uniforms?: Record<string, unknown>;
  /** `#define` 名 → 值(空字符串表示无值宏)。 */
  defines?: Record<string, string>;
}

export interface Material {
  /** Globally unique id. Used as the dictionary key when the Inspector
   *  collects all materials across the scene. */
  readonly uuid: string;
  /** Identifier used by Mesh.material[id] lookups. */
  readonly type: string;
  /** Render hint: 'opaque' | 'transparent' | 'wireframe'. */
  renderOrder: number;
  /** Whether the renderer should depth-test this material. */
  depthTest: boolean;
  /** Whether the renderer should depth-write this material. */
  depthWrite: boolean;
  /** Force wireframe rendering regardless of GL_LINE_STRIP availability. */
  wireframe: boolean;
  /** Free-form data, e.g. uniform overrides. */
  userData: Record<string, unknown>;
  /** 在 shader 编译前调用,允许外部注入/修改 GLSL chunk。默认 no-op。
   *  参考 three.js Material.onBeforeCompile(shader, renderer)。 */
  onBeforeCompile(shader: ShaderObject, renderer?: unknown): void;
  /** 缓存 key;默认基于 onBeforeCompile 的字符串源码,renderer 用它
   *  决定是否复用已编译的 program。参考 three.js customProgramCacheKey。 */
  customProgramCacheKey(): string;
}

let _materialId = 0;
function nextMaterialUuid(): string {
  // 8-char hex matches the Object3D uuid shape; unique enough for
  // per-mesh material identity.
  return ((++_materialId) * 0x9e3779b1 & 0xffffffff).toString(16).padStart(8, '0');
}

/**
 * A baseline material with sensible defaults. Concrete materials in
 * step2.2 (Phong, Standard) extend this; tests can use it as a no-op.
 */
export class BasicMaterial implements Material {
  readonly uuid: string = nextMaterialUuid();
  readonly type: string = 'Basic';
  renderOrder: number = 0;
  depthTest: boolean = true;
  depthWrite: boolean = true;
  wireframe: boolean = false;
  userData: Record<string, unknown> = {};

  onBeforeCompile(_shader: ShaderObject, _renderer?: unknown): void {
    // 默认 no-op;子类或实例可覆盖以注入 shader chunk。
  }

  customProgramCacheKey(): string {
    return this.onBeforeCompile.toString();
  }
}
