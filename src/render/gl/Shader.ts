import type { Vec3, Mat3, Mat4, Color } from '@/core/math';
import type { Texture } from './Texture';
import type { GL } from './GLContext';

/**
 * Shader — a linked GLSL ES 3.00 program with:
 *  - `#define KEY VALUE` injection (placed immediately after the `#version` line),
 *  - a tiny `#include "name"` preprocessor resolving from a static chunk registry,
 *  - cached uniform locations and convenience setters.
 *
 * Uniform setters silently no-op when the uniform is missing/optimised out
 * (cached location === null/-1), so callers never need to guard.
 */
export class Shader {
  readonly program: WebGLProgram;

  private readonly gl: GL;
  private readonly locations = new Map<string, WebGLUniformLocation | null>();

  /** Shared `#include` chunk registry across all shaders. */
  private static readonly chunks = new Map<string, string>();

  constructor(
    gl: GL,
    vertSrc: string,
    fragSrc: string,
    defines?: Record<string, string | number | boolean>,
  ) {
    this.gl = gl;

    const defineBlock = Shader.buildDefines(defines);
    const vs = Shader.compile(
      gl,
      gl.VERTEX_SHADER,
      Shader.preprocess(vertSrc, defineBlock),
      'vertex',
    );
    const fs = Shader.compile(
      gl,
      gl.FRAGMENT_SHADER,
      Shader.preprocess(fragSrc, defineBlock),
      'fragment',
    );

    const program = gl.createProgram();
    if (!program) throw new Error('Shader: gl.createProgram() returned null.');
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    // Shaders can be detached/deleted after a successful link.
    gl.detachShader(program, vs);
    gl.detachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) ?? '(no link log)';
      gl.deleteProgram(program);
      throw new Error(`Shader: program link failed:\n${log}`);
    }

    this.program = program;
  }

  /** Bind this program as the active GL program. */
  use(): void {
    this.gl.useProgram(this.program);
  }

  // ----- uniform setters (cached by name) -----

  setFloat(name: string, v: number): void {
    const loc = this.loc(name);
    if (loc !== null) this.gl.uniform1f(loc, v);
  }

  setInt(name: string, v: number): void {
    const loc = this.loc(name);
    if (loc !== null) this.gl.uniform1i(loc, v);
  }

  setVec2(name: string, x: number, y: number): void {
    const loc = this.loc(name);
    if (loc !== null) this.gl.uniform2f(loc, x, y);
  }

  /** Accepts a Vec3 (x/y/z) or a Color (r/g/b) — detects which at runtime. */
  setVec3(name: string, v: Vec3 | Color): void {
    const loc = this.loc(name);
    if (loc === null) return;
    // Color exposes .r/.g/.b; Vec3 exposes .x/.y/.z. Detect by presence.
    const c = v as Partial<Color>;
    if (typeof c.r === 'number' && typeof c.g === 'number' && typeof c.b === 'number') {
      this.gl.uniform3f(loc, c.r, c.g, c.b);
    } else {
      const p = v as Vec3;
      this.gl.uniform3f(loc, p.x, p.y, p.z);
    }
  }

  setVec3f(name: string, x: number, y: number, z: number): void {
    const loc = this.loc(name);
    if (loc !== null) this.gl.uniform3f(loc, x, y, z);
  }

  setVec4(name: string, x: number, y: number, z: number, w: number): void {
    const loc = this.loc(name);
    if (loc !== null) this.gl.uniform4f(loc, x, y, z, w);
  }

  setMat3(name: string, m: Mat3): void {
    const loc = this.loc(name);
    if (loc !== null) this.gl.uniformMatrix3fv(loc, false, m.data);
  }

  setMat4(name: string, m: Mat4): void {
    const loc = this.loc(name);
    if (loc !== null) this.gl.uniformMatrix4fv(loc, false, m.data);
  }

  /** Bind `tex` to texture `unit` and point sampler uniform `name` at it. */
  setTexture(name: string, tex: Texture, unit: number): void {
    const loc = this.loc(name);
    if (loc === null) return;
    tex.bind(unit);
    this.gl.uniform1i(loc, unit);
  }

  dispose(): void {
    this.gl.deleteProgram(this.program);
    this.locations.clear();
  }

  /** Register a reusable GLSL chunk addressable via `#include "name"`. */
  static registerChunk(name: string, src: string): void {
    Shader.chunks.set(name, src);
  }

  // ----- internals -----

  /** Cached uniform-location lookup (null when absent / optimised out). */
  private loc(name: string): WebGLUniformLocation | null {
    let l = this.locations.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.program, name);
      this.locations.set(name, l);
    }
    return l;
  }

  /** Build the injected `#define` block (one per line, trailing newline). */
  private static buildDefines(defines?: Record<string, string | number | boolean>): string {
    if (!defines) return '';
    let out = '';
    for (const key in defines) {
      const raw = defines[key];
      const value = typeof raw === 'boolean' ? (raw ? '1' : '0') : String(raw);
      out += `#define ${key} ${value}\n`;
    }
    return out;
  }

  /**
   * Resolve `#include "name"` directives and inject the define block right
   * after the `#version 300 es` line (GLSL requires #version to be first).
   */
  private static preprocess(src: string, defineBlock: string): string {
    const included = Shader.resolveIncludes(src, new Set<string>());
    return Shader.injectDefines(included, defineBlock);
  }

  /** Recursively expand `#include "name"` from the chunk registry. */
  private static resolveIncludes(src: string, stack: Set<string>): string {
    return src.replace(/^[ \t]*#include[ \t]+"([^"]+)"[ \t]*$/gm, (_m, name: string) => {
      if (stack.has(name)) {
        throw new Error(`Shader: circular #include detected for chunk "${name}".`);
      }
      const chunk = Shader.chunks.get(name);
      if (chunk === undefined) {
        throw new Error(`Shader: #include "${name}" not found in chunk registry.`);
      }
      const next = new Set(stack);
      next.add(name);
      return Shader.resolveIncludes(chunk, next);
    });
  }

  /** Place the define block on the line immediately after `#version ...`. */
  private static injectDefines(src: string, defineBlock: string): string {
    if (!defineBlock) return src;
    const lines = src.split('\n');
    let versionLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*#version\b/.test(lines[i])) {
        versionLine = i;
        break;
      }
    }
    const block = defineBlock.endsWith('\n') ? defineBlock.slice(0, -1) : defineBlock;
    if (versionLine === -1) {
      // No #version line — prepend defines (caller's source is non-standard).
      return `${block}\n${src}`;
    }
    lines.splice(versionLine + 1, 0, block);
    return lines.join('\n');
  }

  /** Compile one stage, throwing a detailed, line-numbered error on failure. */
  private static compile(gl: GL, stage: number, source: string, label: string): WebGLShader {
    const shader = gl.createShader(stage);
    if (!shader) throw new Error(`Shader: gl.createShader(${label}) returned null.`);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader) ?? '(no info log)';
      const numbered = Shader.numberSource(source);
      gl.deleteShader(shader);
      throw new Error(`Shader: ${label} compile failed:\n${log}\n--- source ---\n${numbered}`);
    }
    return shader;
  }

  /** Prefix each source line with a 1-based, right-aligned line number. */
  private static numberSource(source: string): string {
    const lines = source.split('\n');
    const width = String(lines.length).length;
    return lines.map((l, i) => `${String(i + 1).padStart(width, ' ')} | ${l}`).join('\n');
  }
}
