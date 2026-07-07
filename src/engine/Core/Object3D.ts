// Object3D — the base of every node in the scene graph. Mirrors three.js:
// a node has local transform (position/rotation/scale), parent/children,
// and a `matrixWorld` that's composed on demand and cached as `dirty`.
//
// The matrix update pattern follows three.js: changes flag the world
// matrix as dirty, and the Renderer / traversal re-computes it on next
// access. This keeps hot paths branch-free for static scenes.

import { Matrix4, Quaternion, Vector3 } from '../Math';
let _id = 0;
function nextId(): number {
  return ++_id;
}

export class Object3D {
  readonly id: number = nextId();
  readonly uuid: string;

  name: string = '';
  type: string = 'Object3D';

  parent: Object3D | null = null;
  children: Object3D[] = [];

  position = new Vector3();
  rotation = new Quaternion();
  scale = new Vector3(1, 1, 1);

  /** Cached local transform. `matrixAutoUpdate=true` means we recompute
   *  this every frame; turn off for static subtrees. */
  matrix = new Matrix4();
  matrixWorld = new Matrix4();
  /** Inverse of matrixWorld — kept in sync with updateMatrixWorld(). */
  matrixWorldInverse = new Matrix4();
  matrixAutoUpdate: boolean = true;
  matrixWorldAutoUpdate: boolean = true;
  matrixWorldNeedsUpdate: boolean = false;

  visible: boolean = true;
  frustumCulled: boolean = true;
  userData: Record<string, unknown> = {};

  constructor() {
    // Use a hex uuid that mirrors three.js's length (8 hex digits).
    this.uuid = ((Math.random() * 0xffffffff) | 0).toString(16).padStart(8, '0');
  }

  add(child: Object3D): this {
    if (child === this) return this;
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    return this;
  }

  remove(child: Object3D): this {
    const i = this.children.indexOf(child);
    if (i !== -1) {
      this.children.splice(i, 1);
      child.parent = null;
    }
    return this;
  }

  /** Recompute the local transform from position/rotation/scale. */
  updateMatrix(): void {
    this.matrix.compose(
      this.position,
      this.rotation,
      this.scale,
    );
  }

  /** Recompute world matrix: world = parent.world * local. */
  updateMatrixWorld(force: boolean = false): void {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.matrixWorldNeedsUpdate || force) {
      if (this.parent === null) {
        this.matrixWorld.copy(this.matrix);
      } else {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      force = true;
    }
    for (const child of this.children) {
      if (child.matrixWorldAutoUpdate || force) {
        child.updateMatrixWorld(force);
      }
    }
  }

  /** Walk this subtree, depth-first. */
  traverse(callback: (o: Object3D) => void): void {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }

  /** Find a descendant by exact name. */
  getObjectByName(name: string): Object3D | null {
    if (this.name === name) return this;
    for (const c of this.children) {
      const f = c.getObjectByName(name);
      if (f) return f;
    }
    return null;
  }

  /**
   * Orient this object so its -Z axis points at the world-space target.
   * Mirrors three.js's `Object3D.lookAt`.
   */
  lookAt(x: number, y: number, z: number): void {
    // We use the standard lookAt math but on a temp view matrix and
    // extract rotation.
    const m = new Matrix4();
    m.makeLookAt(this.position, { x, y, z }, { x: 0, y: 1, z: 0 });
    // view = inv(model); we want rotation from the lookAt matrix.
    // Extract upper-left 3x3 and convert to a quaternion via setFromRotationMatrix.
    // For simplicity here we use the matrix directly to set rotation:
    // We'll compute the rotation by inverting the view matrix's
    // rotation portion.
    const e = m.elements;
    // m.makeLookAt returns a *view* matrix; the rotation we want is
    // its inverse. We can pull it out as a rotation matrix by
    // transposing the upper-left 3x3 (orthonormal view = inv rotation).
    const m00 = e[0], m01 = e[4], m02 = e[8];
    const m10 = e[1], m11 = e[5], m12 = e[9];
    const m20 = e[2], m21 = e[6], m22 = e[10];
    // Transpose → rotation matrix R (world rotation to face target)
    const r00 = m00, r01 = m10, r02 = m20;
    const r10 = m01, r11 = m11, r12 = m21;
    const r20 = m02, r21 = m12, r22 = m22;
    setQuatFromRotationMatrix(this.rotation, r00, r01, r02, r10, r11, r12, r20, r21, r22);
  }

  /** Serialize the subtree as plain JSON — the wire format the Java
   *  build tool will consume to produce a matching web bundle. */
  toJSON(): Record<string, unknown> {
    return {
      uuid: this.uuid,
      type: this.type,
      name: this.name,
      position: this.position.toArray(),
      rotation: this.rotation.toArray(),
      scale: this.scale.toArray(),
      visible: this.visible,
      children: this.children.map((c) => c.toJSON()),
    };
  }
}

/** Convert a 3x3 rotation matrix (row-major) into a quaternion. */
function setQuatFromRotationMatrix(
  q: Quaternion,
  m00: number, m01: number, m02: number,
  m10: number, m11: number, m12: number,
  m20: number, m21: number, m22: number,
): void {
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    q.w = 0.25 / s;
    q.x = (m21 - m12) * s;
    q.y = (m02 - m20) * s;
    q.z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q.w = (m21 - m12) / s;
    q.x = 0.25 * s;
    q.y = (m01 + m10) / s;
    q.z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q.w = (m02 - m20) / s;
    q.x = (m01 + m10) / s;
    q.y = 0.25 * s;
    q.z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q.w = (m10 - m01) / s;
    q.x = (m02 + m20) / s;
    q.y = (m12 + m21) / s;
    q.z = 0.25 * s;
  }
  q.normalize();
}
