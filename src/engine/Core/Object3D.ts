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

// Module-level temp objects(three.js 同款:复用避免每帧 GC 分配)。
const _position = new Vector3();
const _quaternion = new Quaternion();
const _scale = new Vector3();
const _m1 = new Matrix4();
const _v1 = new Vector3();
const _q1 = new Quaternion();
const _xAxis = new Vector3(1, 0, 0);
const _yAxis = new Vector3(0, 1, 0);
const _zAxis = new Vector3(0, 0, 1);

/**
 * 脏标记位掩码。当对象的某类数据变化时,通过位或运算标记;
 * SceneGraphProcessor / updateMatrixWorld 在下次遍历时只重算被标记的对象,
 * 避免对静态子树做重复矩阵乘法。
 *
 * - MATRIX       — 本地矩阵(matrix)需要从 position/rotation/scale 重算
 * - MATRIX_WORLD — 世界矩阵(matrixWorld)需要从 parent.matrixWorld * matrix 重算
 * - BOUNDS       — 包围盒需要重算(子类如 Mesh 覆盖此语义)
 * - VISIBLE      — 可见性变化(用于触发渲染列表重收集)
 */
export enum DirtyFlag {
  MATRIX = 1,
  MATRIX_WORLD = 2,
  BOUNDS = 4,
  VISIBLE = 8,
}

/** 所有脏标记位全置 1 的掩码,用于初始化与全量重算。 */
const ALL_DIRTY = DirtyFlag.MATRIX | DirtyFlag.MATRIX_WORLD | DirtyFlag.BOUNDS | DirtyFlag.VISIBLE;

/**
 * 内部使用的"绑定向量":把 Vector3._onChangeCallback 接到 owner.markDirty,
 * 实现 `obj.position.set(x,y,z)` / `obj.position.add(v)` 等**一切**分量修改
 * 自动标记脏矩阵(three.js Vector3._onChangeCallback 适配)。
 *
 * 字段类型对外仍是 Vector3(向后兼容直接赋值 `obj.position = new Vector3()`),
 * 直接赋值会丢失绑定(与 three.js 一致 —— three.js 中直接赋值同样不触发
 * _onChangeCallback,three.js 文档同样建议改字段而非替换实例)。
 */
class _BoundVector3 extends Vector3 {
  _owner: Object3D | null = null;

  constructor(x = 0, y = 0, z = 0) {
    super(x, y, z);
    // 所有 mutator 末尾都会调 _onChangeCallback;owner 绑定在
    // Object3D 构造函数里回填(此时 `this` 引用尚未完全就绪)。
    this._onChangeCallback = () => {
      if (this._owner !== null) this._owner.markDirty(DirtyFlag.MATRIX | DirtyFlag.MATRIX_WORLD);
    };
  }
}

/**
 * 内部使用的"绑定四元数":同 _BoundVector3,通过 Quaternion._onChangeCallback
 * 覆盖 setFromAxisAngle / slerp / setFromEuler 等所有 mutator。
 */
class _BoundQuaternion extends Quaternion {
  _owner: Object3D | null = null;

  constructor() {
    super();
    this._onChangeCallback = () => {
      if (this._owner !== null) this._owner.markDirty(DirtyFlag.MATRIX | DirtyFlag.MATRIX_WORLD);
    };
  }
}

export class Object3D {
  readonly id: number = nextId();
  readonly uuid: string;

  name: string = '';
  type: string = 'Object3D';
  /** 类型标记,供运行时分支识别基类实例(与 three.js Object3D.isObject3D 一致)。 */
  isObject3D: boolean = true;

  parent: Object3D | null = null;
  children: Object3D[] = [];

  /** 字段类型保持 Vector3/Quaternion 以兼容直接赋值(`obj.position = new Vector3()`);
   *  实际实例为 _BoundVector3/_BoundQuaternion,在构造函数里绑定 _owner,
   *  使**一切**分量修改 mutator 自动 markDirty(MATRIX | MATRIX_WORLD)。
   *  直接赋值 `obj.position = new Vector3()` 会替换为无绑定实例(与 three.js 一致)。 */
  position: Vector3 = new _BoundVector3();
  rotation: Quaternion = new _BoundQuaternion();
  scale: Vector3 = new _BoundVector3(1, 1, 1);

  /** Cached local transform. `matrixAutoUpdate=true` means we recompute
   *  this every frame; turn off for static subtrees. */
  matrix = new Matrix4();
  matrixWorld = new Matrix4();
  /** Inverse of matrixWorld — kept in sync with updateMatrixWorld(). */
  matrixWorldInverse = new Matrix4();
  matrixAutoUpdate: boolean = true;
  matrixWorldAutoUpdate: boolean = true;
  matrixWorldNeedsUpdate: boolean = false;

  /**
   * 脏标记位掩码(见 DirtyFlag)。初始为 ALL_DIRTY,确保首次 updateMatrixWorld
   * 即使 force=false 也会从 position/rotation/scale 重算 matrix/matrixWorld。
   * 通过 markDirty(flag) 标记、clearDirty(flag) 清除、isDirty(flag) 查询。
   */
  _dirtyFlags: number = ALL_DIRTY;

  visible: boolean = true;
  frustumCulled: boolean = true;
  /** 渲染顺序(小的先渲染,用于半透明物体从后往前排序)。默认 0。 */
  renderOrder: number = 0;
  userData: Record<string, unknown> = {};

  constructor() {
    // Use a hex uuid that mirrors three.js's length (8 hex digits).
    this.uuid = ((Math.random() * 0xffffffff) | 0).toString(16).padStart(8, '0');
    // 绑定 position/rotation/scale 的 _owner,使 set/copy 触发 markDirty。
    // 字段初始化器已创建 _BoundVector3/_BoundQuaternion 实例;这里回填 owner。
    (this.position as _BoundVector3)._owner = this;
    (this.rotation as _BoundQuaternion)._owner = this;
    (this.scale as _BoundVector3)._owner = this;
  }

  /**
   * 标记自身及所有后代的脏标记位。调用 position/rotation/scale 的 set/copy 时
   * 由 _Bound* 子类自动触发;也可手动调用以通知 SceneGraphProcessor 重算。
   *
   * 传播到后代的原因:父节点本地矩阵变化后,所有后代的世界矩阵
   * (matrixWorld = parent.matrixWorld * local)都失效,必须重算。
   */
  markDirty(flag: number): void {
    this._dirtyFlags |= flag;
    // MATRIX_WORLD 变化时同步旧的 matrixWorldNeedsUpdate 标志以兼容现有代码。
    if ((flag & DirtyFlag.MATRIX_WORLD) !== 0) {
      this.matrixWorldNeedsUpdate = true;
    }
    // 传播到后代:父节点变化会级联影响子节点的世界矩阵/包围盒/可见性。
    const children = this.children;
    for (let i = 0; i < children.length; i++) {
      children[i].markDirty(flag);
    }
  }

  /**
   * 清除自身的脏标记位(不传播到后代)。updateMatrixWorld 在重算后调用。
   * 后代的清除通过 updateMatrixWorld 的 force=true 级联完成。
   */
  clearDirty(flag: number): void {
    this._dirtyFlags &= ~flag;
    if ((flag & DirtyFlag.MATRIX_WORLD) !== 0) {
      this.matrixWorldNeedsUpdate = false;
    }
  }

  /** 查询是否被标记了指定脏位(任意一位命中即返回 true)。 */
  isDirty(flag: number): boolean {
    return (this._dirtyFlags & flag) !== 0;
  }

  /** 查询所有指定脏位是否全部命中。 */
  isAllDirty(flag: number): boolean {
    return (this._dirtyFlags & flag) === flag;
  }

  /** 清除所有脏标记。等价于 clearDirty(ALL_DIRTY)。 */
  clearAllDirty(): void {
    this._dirtyFlags = 0;
    this.matrixWorldNeedsUpdate = false;
  }

  add(child: Object3D): this {
    if (child === this) return this;
    if (child.parent) child.parent.remove(child);
    child.parent = this;
    this.children.push(child);
    // 父子关系变化 → 子节点世界矩阵失效,标记以触发重算。
    child.markDirty(DirtyFlag.MATRIX_WORLD);
    return this;
  }

  remove(child: Object3D): this {
    const i = this.children.indexOf(child);
    if (i !== -1) {
      this.children.splice(i, 1);
      child.parent = null;
      // 脱离父节点后世界矩阵 = 本地矩阵,标记以触发重算。
      child.markDirty(DirtyFlag.MATRIX_WORLD);
    }
    return this;
  }

  /** Recompute the local transform from position/rotation/scale.
   *  延迟更新:只有 isDirty(MATRIX) 时才重算,避免对静态子树做重复 compose。 */
  updateMatrix(): void {
    if (!this.isDirty(DirtyFlag.MATRIX)) return;
    this.matrix.compose(
      this.position,
      this.rotation,
      this.scale,
    );
    this.clearDirty(DirtyFlag.MATRIX);
  }

  /** Recompute world matrix: world = parent.world * local.
   *
   *  延迟更新策略:
   *  - 本地矩阵只在 isDirty(MATRIX) 时重算(updateMatrix 内部判定)
   *  - 世界矩阵只在 isDirty(MATRIX_WORLD) 或 force 或旧标志 matrixWorldNeedsUpdate 时重算
   *  - 本节点世界矩阵变化后,后代必须重算 → 把 force 置 true 级联
   *  - 清除 MATRIX_WORLD 脏位;后代在递归中被 force=true 触发重算并各自清位 */
  updateMatrixWorld(force: boolean = false): void {
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (force || this.matrixWorldNeedsUpdate || this.isDirty(DirtyFlag.MATRIX_WORLD)) {
      if (this.parent === null) {
        this.matrixWorld.copy(this.matrix);
      } else {
        this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
      }
      this.matrixWorldNeedsUpdate = false;
      this.clearDirty(DirtyFlag.MATRIX_WORLD);
      // 本节点世界矩阵变了 → 所有后代的世界矩阵都失效,强制重算。
      force = true;
    }
    for (const child of this.children) {
      if (child.matrixWorldAutoUpdate || force) {
        child.updateMatrixWorld(force);
      }
    }
  }

  /** three.js-compat `updateWorldMatrix(updateParents, updateChildren)`.
   *  与 `updateMatrixWorld(force)` 的区别:按需选择是否上溯更新祖先 / 下推更新后代,
   *  而 updateMatrixWorld 总是递归整棵子树。语义对齐 three.js r169:
   *  - updateParents=true:沿 parent 链向上,若祖先仍脏则先更新祖先
   *  - updateChildren=true:沿子树向下递归(force 级联)
   *  世界空间 getter(getWorldPosition 等)均调用本方法(updateParents=true,
   *  updateChildren=false),保证只花遍历祖先的代价。 */
  updateWorldMatrix(updateParents: boolean, updateChildren: boolean): void {
    const parent = this.parent;
    if (updateParents === true && parent !== null) {
      parent.updateWorldMatrix(true, false);
    }
    if (this.matrixAutoUpdate) this.updateMatrix();
    if (this.parent === null) {
      this.matrixWorld.copy(this.matrix);
    } else {
      this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.matrix);
    }
    this.matrixWorldNeedsUpdate = false;
    this.clearDirty(DirtyFlag.MATRIX_WORLD);
    if (updateChildren === true) {
      for (const child of this.children) {
        child.updateWorldMatrix(false, true);
      }
    }
  }

  /** World-space position of the object's origin. */
  getWorldPosition(target: Vector3 = new Vector3()): Vector3 {
    this.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.matrixWorld);
  }

  /** World-space rotation of the object. */
  getWorldQuaternion(target: Quaternion = new Quaternion()): Quaternion {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_position, target, _scale);
    return target;
  }

  /** World-space scale of the object. */
  getWorldScale(target: Vector3 = new Vector3()): Vector3 {
    this.updateWorldMatrix(true, false);
    this.matrixWorld.decompose(_position, _quaternion, target);
    return target;
  }

  /** World-space direction the object is "looking" (along its local -Z axis).
   *  VREEN 约定与 Camera.getWorldDirection / SceneUtils.getWorldDirection 一致:返回 -Z
   *  (three.js 返回 +Z)。 */
  getWorldDirection(target: Vector3 = new Vector3()): Vector3 {
    this.updateWorldMatrix(true, false);
    const e = this.matrixWorld.elements;
    return target.set(-e[8], -e[9], -e[10]).normalize();
  }

  /** Convert a point in local space to world space (point, not vector). */
  localToWorld(point: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return point.applyMatrix4(this.matrixWorld);
  }

  /** Convert a point in world space to local space (point, not vector). */
  worldToLocal(point: Vector3): Vector3 {
    this.updateWorldMatrix(true, false);
    return point.applyMatrix4(_m1.copy(this.matrixWorld).invert());
  }

  /** Move this object so it becomes a child of parent, preserving its
   *  world transform (three.js Object3D.attach). */
  attach(object: Object3D): this {
    this.updateWorldMatrix(true, false);
    _m1.copy(this.matrixWorld).invert();
    if (object.parent !== null) {
      object.parent.updateWorldMatrix(true, false);
      _m1.multiply(object.parent.matrixWorld);
    }
    object.applyMatrix4(_m1);
    this.add(object);
    object.updateWorldMatrix(false, true);
    return this;
  }

  /** Apply a matrix to the object's local transform: premultiply into the
   *  local matrix, then decompose back into position/rotation/scale. */
  applyMatrix4(matrix: Matrix4): this {
    if (this.matrixAutoUpdate) this.updateMatrix();
    this.matrix.premultiply(matrix);
    this.matrix.decompose(this.position, this.rotation, this.scale);
    return this;
  }

  /** Apply a quaternion to the object's rotation (premultiply). */
  applyQuaternion(q: Quaternion): this {
    this.rotation.premultiply(q);
    return this;
  }

  /** Rotate this object around an axis given in local space. */
  rotateOnAxis(axis: Vector3, angle: number): this {
    _q1.setFromAxisAngle(axis, angle);
    this.rotation.multiply(_q1);
    return this;
  }

  /** Rotate this object around an axis given in world space. */
  rotateOnWorldAxis(axis: Vector3, angle: number): this {
    _q1.setFromAxisAngle(axis, angle);
    this.rotation.premultiply(_q1);
    return this;
  }

  /** Rotate this object around its local X axis by `angle` radians. */
  rotateX(angle: number): this {
    return this.rotateOnAxis(_xAxis, angle);
  }

  /** Rotate this object around its local Y axis by `angle` radians. */
  rotateY(angle: number): this {
    return this.rotateOnAxis(_yAxis, angle);
  }

  /** Rotate this object around its local Z axis by `angle` radians. */
  rotateZ(angle: number): this {
    return this.rotateOnAxis(_zAxis, angle);
  }

  /** Translate this object along an axis given in local space by `distance`. */
  translateOnAxis(axis: Vector3, distance: number): this {
    _v1.copy(axis).applyQuaternion(this.rotation);
    this.position.add(_v1.multiplyScalar(distance));
    return this;
  }

  /** Translate along the object's local X axis. */
  translateX(distance: number): this {
    return this.translateOnAxis(_xAxis, distance);
  }

  /** Translate along the object's local Y axis. */
  translateY(distance: number): this {
    return this.translateOnAxis(_yAxis, distance);
  }

  /** Translate along the object's local Z axis. */
  translateZ(distance: number): this {
    return this.translateOnAxis(_zAxis, distance);
  }

  /** Detach this object from its parent (no-op if it has none). */
  removeFromParent(): this {
    const parent = this.parent;
    if (parent !== null) parent.remove(this);
    return this;
  }

  /** Remove all children. Reverse iteration so index shifts never skip a node. */
  clear(): this {
    for (let i = this.children.length - 1; i >= 0; i--) {
      this.remove(this.children[i]);
    }
    return this;
  }

  /** Walk this subtree, depth-first. */
  traverse(callback: (o: Object3D) => void): void {
    callback(this);
    for (const child of this.children) child.traverse(callback);
  }

  /** Walk the subtree, depth-first, skipping descendants of invisible nodes. */
  traverseVisible(callback: (o: Object3D) => void): void {
    if (this.visible === false) return;
    callback(this);
    for (const child of this.children) child.traverseVisible(callback);
  }

  /** Walk up the parent chain, nearest ancestor first. */
  traverseAncestors(callback: (o: Object3D) => void): void {
    const parent = this.parent;
    if (parent !== null) {
      callback(parent);
      parent.traverseAncestors(callback);
    }
  }

  /** Find a descendant by exact name (three.js semantics: includes self). */
  getObjectByName(name: string): Object3D | null {
    if (this.name === name) return this;
    for (const c of this.children) {
      const f = c.getObjectByName(name);
      if (f) return f;
    }
    return null;
  }

  /** Find a descendant by its numeric id (includes self). */
  getObjectById(id: number): Object3D | null {
    if (this.id === id) return this;
    for (const c of this.children) {
      const f = c.getObjectById(id);
      if (f) return f;
    }
    return null;
  }

  /** Find a descendant matching `property === value` (includes self). */
  getObjectByProperty(name: string, value: unknown): Object3D | null {
    if ((this as unknown as Record<string, unknown>)[name] === value) return this;
    for (const c of this.children) {
      const f = c.getObjectByProperty(name, value);
      if (f) return f;
    }
    return null;
  }

  /** 射线检测钩子。基类 Object3D 不可被命中(无几何体),子类(如 Mesh /
   *  InstancedMesh)覆盖此方法把命中结果 push 进 intersects。
   *  参数用 unknown 以避免 Core/Raycaster 循环依赖;子类覆盖时收窄到具体类型。 */
  raycast(_raycaster: unknown, _intersects: unknown[]): void {
    // no-op
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

  /**
   * 复制源对象的状态到 this(three.js Object3D.copy 语义)。复制:
   *  name / position / rotation / scale / matrix / matrixWorld /
   *  matrixWorldInverse / matrixAutoUpdate / matrixWorldAutoUpdate /
   *  matrixWorldNeedsUpdate / visible / frustumCulled / renderOrder /
   *  userData(深拷贝 JSON)。
   *
   *  `recursive=true` 时同时深拷贝子树(每个子节点 clone 后 add 到 this)。
   *  position/rotation/scale 是 _Bound* 绑定向量,copy 自动触发 markDirty,
   *  因此 clone 后的对象无需额外 updateMatrixWorld 即可正确 compose。
   *
   *  VREEN 的 Object3D 没有 three.js 的 `up` 向量字段(相机朝上统一 +Y),
   *  故不复制 up;`matrixWorldInverse` 在 VREEN 中是持久字段,一并复制保持
   *  clone 完整性(three.js 会在 updateMatrixWorld 时按需重算,复制无害)。
   */
  copy(source: Object3D, recursive: boolean = true): this {
    this.name = source.name;
    this.position.copy(source.position);
    this.rotation.copy(source.rotation);
    this.scale.copy(source.scale);
    this.matrix.copy(source.matrix);
    this.matrixWorld.copy(source.matrixWorld);
    this.matrixWorldInverse.copy(source.matrixWorldInverse);
    this.matrixAutoUpdate = source.matrixAutoUpdate;
    this.matrixWorldAutoUpdate = source.matrixWorldAutoUpdate;
    this.matrixWorldNeedsUpdate = source.matrixWorldNeedsUpdate;
    this.visible = source.visible;
    this.frustumCulled = source.frustumCulled;
    this.renderOrder = source.renderOrder;
    this.userData = JSON.parse(JSON.stringify(source.userData));
    if (recursive) {
      // three.js Object3D.copy 语义:先移除现有 children,再克隆 source 子树,
      // 避免 copy 到已有对象时残留 stale 子节点。
      for (let i = 0; i < this.children.length; i++) {
        this.remove(this.children[i]);
      }
      for (const child of source.children) {
        this.add(child.clone());
      }
    }
    return this;
  }

  /**
   * 返回本对象的一个新副本(类型保持子类)。`new this.constructor()`
   * 使 Group/Mesh/Bone 等子类 clone 出正确类型;子类可在构造参数里
   * 传默认值(如 Mesh 的 geometry/material)再 copy 覆盖。
   */
  clone(recursive: boolean = true): Object3D {
    return new (this.constructor as new () => Object3D)().copy(this, recursive);
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
