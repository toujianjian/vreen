// ShaderProgram — thin wrapper around gl.createProgram / compileShader /
// linkProgram. Caches uniform / attribute locations so per-draw lookup
// is a Map.get instead of a string-keyed object.

export class ShaderProgram {
  readonly gl: WebGL2RenderingContext;
  readonly program: WebGLProgram;
  /** Pre-resolved uniform locations. */
  uniforms: Map<string, WebGLUniformLocation> = new Map();
  /** Pre-resolved attribute locations. */
  attributes: Map<string, number> = new Map();

  constructor(
    gl: WebGL2RenderingContext,
    vertSrc: string,
    fragSrc: string,
    defines: string[] = [],
  ) {
    this.gl = gl;
    const vert = compileShader(gl, gl.VERTEX_SHADER, prependDefines(defines) + vertSrc);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, prependDefines(defines) + fragSrc);
    const prog = gl.createProgram();
    if (!prog) throw new Error('createProgram() returned null');
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? '(no log)';
      gl.deleteProgram(prog);
      throw new Error(`Program link failed: ${log}`);
    }
    // Once linked we can drop the source objects; the program owns them.
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    this.program = prog;
    this.collectUniforms();
    this.collectAttributes();
  }

  use(): void {
    this.gl.useProgram(this.program);
  }

  /** Apply a uniform. Unknown names are silently ignored. */
  setUniform1f(name: string, v: number): void {
    const loc = this.uniforms.get(name);
    if (loc === undefined) return;
    this.gl.uniform1f(loc, v);
  }
  setUniform1i(name: string, v: number): void {
    const loc = this.uniforms.get(name);
    if (loc === undefined) return;
    this.gl.uniform1f(loc, v); // treat bool/int as 1f — fine for sampler-fake
  }
  setUniform2f(name: string, x: number, y: number): void {
    const loc = this.uniforms.get(name);
    if (loc === undefined) return;
    this.gl.uniform2f(loc, x, y);
  }
  setUniform3f(name: string, x: number, y: number, z: number): void {
    const loc = this.uniforms.get(name);
    if (loc === undefined) return;
    this.gl.uniform3f(loc, x, y, z);
  }
  setUniform4f(name: string, x: number, y: number, z: number, w: number): void {
    const loc = this.uniforms.get(name);
    if (loc === undefined) return;
    this.gl.uniform4f(loc, x, y, z, w);
  }
  setUniformMatrix4fv(name: string, m: Float32Array): void {
    const loc = this.uniforms.get(name);
    if (loc === undefined) return;
    this.gl.uniformMatrix4fv(loc, false, m);
  }
  setUniformMatrix3fv(name: string, m: Float32Array): void {
    const loc = this.uniforms.get(name);
    if (loc === undefined) return;
    this.gl.uniformMatrix3fv(loc, false, m);
  }
  /** Bind a 2D sampler to a texture unit. */
  setUniformSampler(name: string, unit: number): void {
    const loc = this.uniforms.get(name);
    if (loc === undefined) return;
    this.gl.uniform1i(loc, unit);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
  }

  // ── private ─────────────────────────────────────────────────────────
  private collectUniforms(): void {
    const gl = this.gl;
    const n = gl.getProgramParameter(this.program, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(this.program, i);
      if (!info) continue;
      // Strip [0] suffix on array uniforms so callers don't have to.
      const name = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(this.program, info.name);
      if (loc) this.uniforms.set(name, loc);
    }
  }

  private collectAttributes(): void {
    const gl = this.gl;
    const n = gl.getProgramParameter(this.program, gl.ACTIVE_ATTRIBUTES) as number;
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveAttrib(this.program, i);
      if (!info) continue;
      const loc = gl.getAttribLocation(this.program, info.name);
      if (loc >= 0) this.attributes.set(info.name, loc);
    }
  }
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  src: string,
): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader() returned null');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '(no log)';
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    gl.deleteShader(sh);
    throw new Error(`${kind} shader compile failed: ${log}`);
  }
  return sh;
}

/** Convert a list of #define names into a single #define block. */
function prependDefines(defines: string[]): string {
  if (defines.length === 0) return '';
  return '#define ' + defines.join('\n#define ') + '\n';
}
