// Material — minimal interface that the WebGL2Renderer drives via a
// `program` slot. The Phong / Standard materials in step2.2 will
// implement this. Keeping it as an interface for now lets us plug in
// different shaders (unlit, phong, custom) without changing Mesh.

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
}
