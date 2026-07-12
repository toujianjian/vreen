// BufferAttribute — a typed array + itemSize + count. Mirrors three.js.
// We keep one `Float32Array` per attribute so the WebGL2 vertex array
// object can be configured with `gl.vertexAttribPointer(..., gl.FLOAT, ...,
// 0, 0, 0)`.
//
// `version` increments on every `setXxx()` so the renderer can rebuild
// only the dirty GPU buffers instead of re-uploading everything.

export type AttributeKind = 'position' | 'normal' | 'uv' | 'color' | 'tangent';

export class BufferAttribute {
  array: Float32Array;
  itemSize: number;
  count: number;
  /** Increments on every write — used to detect CPU-side changes. */
  version: number = 0;
  /** Hint passed to gl.bufferData. */
  usage: number; // gl.STATIC_DRAW / DYNAMIC_DRAW / STREAM_DRAW

  constructor(
    array: ArrayLike<number> | Float32Array,
    itemSize: number,
    usage: number = 0x88e4 /* gl.STATIC_DRAW */,
  ) {
    // Always store as a Float32Array (the only vertex attribute type we use
    // in the WebGL2 renderer for now). Other types can be added later.
    this.array = array instanceof Float32Array ? array : Float32Array.from(array);
    this.itemSize = itemSize;
    this.count = Math.floor(this.array.length / itemSize);
    this.usage = usage;
  }

  get x(): number { return this.array[0]; }
  set x(v: number) { this.array[0] = v; this.version++; }
  get y(): number { return this.array[1]; }
  set y(v: number) { this.array[1] = v; this.version++; }
  get z(): number { return this.array[2]; }
  set z(v: number) { this.array[2] = v; this.version++; }

  setX(index: number, x: number): this { this.array[index * this.itemSize + 0] = x; this.version++; return this; }
  setY(index: number, y: number): this { this.array[index * this.itemSize + 1] = y; this.version++; return this; }
  setZ(index: number, z: number): this { this.array[index * this.itemSize + 2] = z; this.version++; return this; }
  setXY(index: number, x: number, y: number): this {
    const o = index * this.itemSize;
    this.array[o] = x; this.array[o + 1] = y; this.version++; return this;
  }
  setXYZ(index: number, x: number, y: number, z: number): this {
    const o = index * this.itemSize;
    this.array[o] = x; this.array[o + 1] = y; this.array[o + 2] = z; this.version++; return this;
  }

  /** Replace the whole backing array. */
  setArray(arr: ArrayLike<number>): this {
    if (arr instanceof Float32Array) {
      this.array = arr;
    } else {
      this.array = Float32Array.from(arr);
    }
    this.count = Math.floor(this.array.length / this.itemSize);
    this.version++;
    return this;
  }

  /**
   * Set the GL usage hint. Accepts a three.js-style string or a raw GL enum
   * number. Renderer reads `usage` directly when calling `gl.bufferData`,
   * so this is the only way to switch between STATIC_DRAW / DYNAMIC_DRAW.
   */
  setUsage(usage: 'Static' | 'Dynamic' | 'Stream' | number): this {
    if (typeof usage === 'number') {
      this.usage = usage;
    } else {
      switch (usage) {
        case 'Static':  this.usage = 0x88e4; break; // gl.STATIC_DRAW
        case 'Dynamic': this.usage = 0x88e8; break; // gl.DYNAMIC_DRAW
        case 'Stream':  this.usage = 0x88e0; break; // gl.STREAM_DRAW
      }
    }
    return this;
  }

  /**
   * Mark the attribute dirty. Equivalent to mutating the array directly,
   * but lets helpers (LineMesh etc.) signal "I just wrote into .array,
   * please re-upload" without touching version arithmetic themselves.
   */
  set needsUpdate(v: boolean) {
    if (v) this.version++;
  }
}
