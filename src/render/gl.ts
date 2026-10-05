// Small WebGL2 helpers: compile programs, look up uniforms by name, make render targets.

export class Program {
  readonly program: WebGLProgram;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    vertexSource: string,
    fragmentSource: string,
    readonly name: string,
  ) {
    const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource, name);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource, name);
    const program = gl.createProgram();
    if (!program) throw new Error(`Could not create program ${name}`);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `Program ${name} failed to link: ${gl.getProgramInfoLog(program)}`,
      );
    }
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    this.program = program;
  }

  use(): this {
    this.gl.useProgram(this.program);
    return this;
  }

  private location(name: string): WebGLUniformLocation | null {
    if (!this.locations.has(name))
      this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name) ?? null;
  }

  // Uniforms the compiler removed as unused have no location; setting them is then a harmless no-op.
  f(name: string, ...values: number[]): this {
    const loc = this.location(name);
    if (!loc) return this;
    const gl = this.gl;
    if (values.length === 1) gl.uniform1f(loc, values[0]);
    else if (values.length === 2) gl.uniform2f(loc, values[0], values[1]);
    else if (values.length === 3)
      gl.uniform3f(loc, values[0], values[1], values[2]);
    else gl.uniform4f(loc, values[0], values[1], values[2], values[3]);
    return this;
  }

  i(name: string, value: number): this {
    const loc = this.location(name);
    if (loc) this.gl.uniform1i(loc, value);
    return this;
  }

  v3array(name: string, data: Float32Array): this {
    const loc = this.location(name);
    if (loc) this.gl.uniform3fv(loc, data);
    return this;
  }

  texture(name: string, unit: number, texture: WebGLTexture | null): this {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    return this.i(name, unit);
  }
}

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
  name: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error(`Could not create shader for ${name}`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader ${name} failed to compile: ${log}`);
  }
  return shader;
}

export interface Target {
  texture: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
  mipmapped: boolean;
}

export function createTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  mipmapped: boolean,
): Target {
  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();
  if (!texture || !framebuffer)
    throw new Error("Could not create a render target");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const levels = mipmapped
    ? Math.floor(Math.log2(Math.max(width, height))) + 1
    : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    mipmapped ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE)
    throw new Error(`Render target incomplete (${status})`);
  return { texture, framebuffer, width, height, mipmapped };
}

export function deleteTarget(
  gl: WebGL2RenderingContext,
  target: Target | null,
): void {
  if (!target) return;
  gl.deleteTexture(target.texture);
  gl.deleteFramebuffer(target.framebuffer);
}

export function createTexture(
  gl: WebGL2RenderingContext,
  filter: number,
  wrap: number = gl.CLAMP_TO_EDGE,
): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error("Could not create a texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    filter === gl.NEAREST ? gl.NEAREST : gl.LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  // One black pixel, so the texture is valid before its first real upload.
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  return texture;
}
