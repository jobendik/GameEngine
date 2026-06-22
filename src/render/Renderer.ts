/**
 * Renderer — the GPU pipeline integrator for the Aether engine.
 *
 * Owns the WebGL2 context and orchestrates a forward HDR pipeline per frame:
 *   1. Shadow pass     — directional light depth into a sampleable depth texture.
 *   2. Opaque pass     — PBR lighting into a HALF_FLOAT HDR framebuffer.
 *   3. Transparent pass — blended PBR draws, sorted back-to-front, no depth write.
 *   4. Post-processing — bloom (threshold + separable blur), composite
 *                        (exposure + ACES tonemap + vignette + sRGB), FXAA, present.
 *
 * Implements {@link EngineModule} so it can be registered with the Engine and
 * receive `resize`/`dispose` lifecycle calls.
 */
import type { EngineModule } from '@/core';
import { Vec3, Mat3, Mat4, Color } from '@/core/math';
import { GLContext, Shader, VertexArray, Texture, Framebuffer } from './gl';
import type { Camera } from './Camera';
import { Light, LightType } from './Light';
import type { Material } from './Material';
import { Mesh } from './Mesh';
import type { GeometryData } from './Mesh';

import { PBR_VERT, PBR_FRAG, MAX_LIGHTS } from './shaders/pbr';
import { DEPTH_VERT, DEPTH_FRAG } from './shaders/depth';
import {
  FULLSCREEN_VERT,
  BRIGHT_PASS_FRAG,
  BLUR_FRAG,
  COMPOSITE_FRAG,
  FXAA_FRAG,
} from './shaders/postfx';

/** A single draw submission consumed by {@link Renderer.renderScene}. */
export interface Renderable {
  mesh: Mesh;
  material: Material;
  worldMatrix: Mat4;
  /** Whether this object casts into the shadow map. Default true. */
  castShadow?: boolean;
  /** Whether this object receives shadows. Default true. */
  receiveShadow?: boolean;
}

/** Tunable per-renderer settings (all optional, sensible HDR defaults). */
export interface RenderSettings {
  exposure?: number;
  bloom?: boolean;
  bloomStrength?: number;
  bloomThreshold?: number;
  fxaa?: boolean;
  ssao?: boolean;
  shadows?: boolean;
  shadowMapSize?: number;
  ambient?: Color;
  fogColor?: Color;
  fogDensity?: number;
  toneMapping?: 'aces' | 'reinhard' | 'none';
}

/** Fully-resolved settings with no optional fields. */
interface ResolvedSettings {
  exposure: number;
  bloom: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  fxaa: boolean;
  ssao: boolean;
  shadows: boolean;
  shadowMapSize: number;
  ambient: Color;
  fogColor: Color;
  fogDensity: number;
  toneMapping: 'aces' | 'reinhard' | 'none';
}

/** Number of separable blur ping-pong iterations for bloom. */
const BLOOM_ITERATIONS = 5;

export class Renderer implements EngineModule {
  readonly name = 'renderer';
  readonly glx: GLContext;
  readonly gl: WebGL2RenderingContext;
  settings: RenderSettings;

  private readonly resolved: ResolvedSettings;

  // Shader programs.
  private readonly pbrShader: Shader;
  private readonly depthShader: Shader;
  private readonly brightShader: Shader;
  private readonly blurShader: Shader;
  private readonly compositeShader: Shader;
  private readonly fxaaShader: Shader;

  // Framebuffers.
  private sceneFBO: Framebuffer;
  private shadowFBO: Framebuffer;
  private ldrFBO: Framebuffer;
  private bloomBright: Framebuffer;
  private bloomPing: Framebuffer;
  private bloomPong: Framebuffer;

  // Fullscreen-triangle VAO (no buffers; drawArrays of 3 verts).
  private readonly fsTriangle: WebGLVertexArrayObject;

  // Default 1x1 textures bound when a material map is absent.
  private readonly whiteTex: Texture;
  private readonly blackTex: Texture;
  private readonly normalTex: Texture;

  // Scratch matrices (reused to avoid per-frame allocation).
  private readonly modelMat = new Mat4();
  private readonly normalMat = new Mat3();
  private readonly lightView = new Mat4();
  private readonly lightProj = new Mat4();
  private readonly lightSpace = new Mat4();
  private readonly tmpVec = new Vec3();
  private readonly tmpEye = new Vec3();
  private readonly sceneCenter = new Vec3();

  private width: number;
  private height: number;

  constructor(glx: GLContext, settings: RenderSettings = {}) {
    this.glx = glx;
    this.gl = glx.gl;
    this.settings = settings;
    this.resolved = this.resolveSettings(settings);

    const gl = this.gl;

    this.width = Math.max(1, glx.drawingBufferWidth);
    this.height = Math.max(1, glx.drawingBufferHeight);

    // --- Compile shaders ---
    this.pbrShader = new Shader(gl, PBR_VERT, PBR_FRAG);
    this.depthShader = new Shader(gl, DEPTH_VERT, DEPTH_FRAG);
    this.brightShader = new Shader(gl, FULLSCREEN_VERT, BRIGHT_PASS_FRAG);
    this.blurShader = new Shader(gl, FULLSCREEN_VERT, BLUR_FRAG);
    this.compositeShader = new Shader(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);
    this.fxaaShader = new Shader(gl, FULLSCREEN_VERT, FXAA_FRAG);

    // --- Default textures ---
    this.whiteTex = Texture.white(gl);
    this.blackTex = Texture.black(gl);
    this.normalTex = Texture.normalFlat(gl);

    // --- Fullscreen triangle VAO (attribute-less) ---
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Renderer: failed to create fullscreen VAO.');
    this.fsTriangle = vao;

    // --- Framebuffers ---
    const shadowSize = this.resolved.shadowMapSize;
    this.shadowFBO = new Framebuffer(gl, {
      width: shadowSize,
      height: shadowSize,
      colorAttachments: 1,
      colorType: gl.UNSIGNED_BYTE,
      depth: true,
      depthTexture: true,
    });
    this.sceneFBO = new Framebuffer(gl, {
      width: this.width,
      height: this.height,
      colorType: gl.HALF_FLOAT,
      depth: true,
    });
    this.ldrFBO = new Framebuffer(gl, {
      width: this.width,
      height: this.height,
      colorType: gl.UNSIGNED_BYTE,
      depth: false,
    });
    const bw = Math.max(1, this.width >> 1);
    const bh = Math.max(1, this.height >> 1);
    this.bloomBright = new Framebuffer(gl, {
      width: bw,
      height: bh,
      colorType: gl.HALF_FLOAT,
      depth: false,
    });
    this.bloomPing = new Framebuffer(gl, {
      width: bw,
      height: bh,
      colorType: gl.HALF_FLOAT,
      depth: false,
    });
    this.bloomPong = new Framebuffer(gl, {
      width: bw,
      height: bh,
      colorType: gl.HALF_FLOAT,
      depth: false,
    });
  }

  /** Resize all render targets to the current drawing-buffer size. */
  resize(w: number, h: number): void {
    this.width = Math.max(1, w);
    this.height = Math.max(1, h);
    this.sceneFBO.resize(this.width, this.height);
    this.ldrFBO.resize(this.width, this.height);
    const bw = Math.max(1, this.width >> 1);
    const bh = Math.max(1, this.height >> 1);
    this.bloomBright.resize(bw, bh);
    this.bloomPing.resize(bw, bh);
    this.bloomPong.resize(bw, bh);
  }

  /** Build a {@link Mesh} from geometry using this renderer's GL context. */
  createMesh(data: GeometryData): Mesh {
    return new Mesh(this.gl, data);
  }

  /** Create a GPU texture from an image/canvas/video source. */
  createTextureFromImage(img: TexImageSource): Texture {
    return Texture.fromImage(this.gl, img, { mipmaps: true });
  }

  /**
   * Render one full frame: shadow pass, opaque + transparent PBR, post FX,
   * presenting the final LDR result to the default framebuffer.
   */
  renderScene(camera: Camera, renderables: Renderable[], lights: Light[]): void {
    const gl = this.gl;
    // Re-resolve settings each frame so live edits to `settings` take effect.
    Object.assign(this.resolved, this.resolveSettings(this.settings));

    camera.updateMatrices();

    // Partition opaque vs transparent.
    const opaque: Renderable[] = [];
    const transparent: Renderable[] = [];
    for (const r of renderables) {
      if (r.material.transparent || r.material.opacity < 1) transparent.push(r);
      else opaque.push(r);
    }

    // Identify the primary shadow-casting directional light.
    const dirLight = this.findDirectionalLight(lights);
    const shadowsActive =
      this.resolved.shadows && dirLight !== null && dirLight.castShadow;

    // --- 1. SHADOW PASS ---
    if (shadowsActive && dirLight) {
      this.renderShadowPass(dirLight, renderables);
    } else {
      this.lightSpace.identity();
    }

    // --- 2. OPAQUE PASS ---
    this.sceneFBO.bind();
    gl.viewport(0, 0, this.width, this.height);
    const fog = this.resolved.fogColor;
    gl.clearColor(fog.r, fog.g, fog.b, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    this.pbrShader.use();
    this.bindSceneUniforms(camera, dirLight, lights, shadowsActive);

    for (const r of opaque) {
      this.drawRenderable(r);
    }

    // --- 3. TRANSPARENT PASS (sorted back-to-front, no depth write) ---
    if (transparent.length > 0) {
      this.sortBackToFront(transparent, camera);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const r of transparent) {
        this.drawRenderable(r);
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // --- 4. POST-PROCESSING ---
    this.renderPostFX();

    // Restore a clean default state.
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    this.pbrShader.dispose();
    this.depthShader.dispose();
    this.brightShader.dispose();
    this.blurShader.dispose();
    this.compositeShader.dispose();
    this.fxaaShader.dispose();

    this.sceneFBO.dispose();
    this.shadowFBO.dispose();
    this.ldrFBO.dispose();
    this.bloomBright.dispose();
    this.bloomPing.dispose();
    this.bloomPong.dispose();

    this.whiteTex.dispose();
    this.blackTex.dispose();
    this.normalTex.dispose();

    gl.deleteVertexArray(this.fsTriangle);
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  private resolveSettings(s: RenderSettings): ResolvedSettings {
    return {
      exposure: s.exposure ?? 1.0,
      bloom: s.bloom ?? true,
      bloomStrength: s.bloomStrength ?? 0.6,
      bloomThreshold: s.bloomThreshold ?? 1.0,
      fxaa: s.fxaa ?? true,
      ssao: s.ssao ?? true,
      shadows: s.shadows ?? true,
      shadowMapSize: s.shadowMapSize ?? 2048,
      ambient: s.ambient ?? new Color(0.03, 0.03, 0.04, 1),
      fogColor: s.fogColor ?? new Color(0.5, 0.6, 0.7, 1),
      fogDensity: s.fogDensity ?? 0.0,
      toneMapping: s.toneMapping ?? 'aces',
    };
  }

  /** First directional light, preferring one that casts shadows. */
  private findDirectionalLight(lights: Light[]): Light | null {
    let fallback: Light | null = null;
    for (const l of lights) {
      if (l.type === LightType.Directional) {
        if (l.castShadow) return l;
        if (fallback === null) fallback = l;
      }
    }
    return fallback;
  }

  /** Render shadow-casters' depth from the directional light's ortho frustum. */
  private renderShadowPass(dirLight: Light, renderables: Renderable[]): void {
    const gl = this.gl;

    // Fit a fixed ortho box around the scene centroid of shadow casters.
    this.computeSceneCenter(renderables);
    const extent = 40;
    const near = 0.1;
    const far = 200;
    const dist = far * 0.4;

    const dir = this.tmpVec.copy(dirLight.direction);
    if (dir.lengthSq() < 1e-8) dir.set(0, -1, 0);
    dir.normalize();

    // Eye = center - dir * dist (light looks along `dir`).
    this.tmpEye.copy(this.sceneCenter).addScaled(dir, -dist);
    this.lightView.lookAt(this.tmpEye, this.sceneCenter, Vec3.UP);
    this.lightProj.ortho(-extent, extent, -extent, extent, near, far);
    this.lightSpace.multiplyMatrices(this.lightProj, this.lightView);

    this.shadowFBO.bind();
    gl.viewport(0, 0, this.shadowFBO.width, this.shadowFBO.height);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    // Front-face culling reduces peter-panning / acne for closed geometry.
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);

    this.depthShader.use();
    this.depthShader.setMat4('uLightSpaceMatrix', this.lightSpace);

    for (const r of renderables) {
      if (r.castShadow === false) continue;
      this.depthShader.setMat4('uModel', r.worldMatrix);
      r.mesh.draw();
    }

    gl.cullFace(gl.BACK);
    gl.disable(gl.CULL_FACE);
  }

  /** Average bounding-sphere centers of shadow casters into sceneCenter. */
  private computeSceneCenter(renderables: Renderable[]): void {
    this.sceneCenter.set(0, 0, 0);
    let count = 0;
    for (const r of renderables) {
      if (r.castShadow === false) continue;
      r.worldMatrix.getPosition(this.tmpVec);
      this.sceneCenter.add(this.tmpVec);
      count++;
    }
    if (count > 0) this.sceneCenter.scale(1 / count);
  }

  /** Upload camera, lights, ambient, fog, and shadow uniforms once per pass. */
  private bindSceneUniforms(
    camera: Camera,
    dirLight: Light | null,
    lights: Light[],
    shadowsActive: boolean,
  ): void {
    const sh = this.pbrShader;
    const r = this.resolved;

    sh.setMat4('uView', camera.view);
    sh.setMat4('uProj', camera.projection);
    sh.setVec3('uCamPos', camera.position);
    sh.setVec3('uAmbient', r.ambient);

    // Directional light (color * intensity premultiplied).
    if (dirLight) {
      this.tmpVec.copy(dirLight.direction);
      if (this.tmpVec.lengthSq() < 1e-8) this.tmpVec.set(0, -1, 0);
      this.tmpVec.normalize();
      sh.setVec3f('uDirLightDir', this.tmpVec.x, this.tmpVec.y, this.tmpVec.z);
      const c = dirLight.color;
      const i = dirLight.intensity;
      sh.setVec3f('uDirLightColor', c.r * i, c.g * i, c.b * i);
    } else {
      sh.setVec3f('uDirLightDir', 0, -1, 0);
      sh.setVec3f('uDirLightColor', 0, 0, 0);
    }

    // Punctual lights (point/spot), nearest to the camera up to MAX_LIGHTS.
    const punctual = this.selectPunctualLights(camera, lights);
    sh.setInt('uNumLights', punctual.length);
    for (let i = 0; i < punctual.length; i++) {
      const l = punctual[i];
      const c = l.color;
      const ii = l.intensity;
      sh.setVec3f(`uLightPos[${i}]`, l.position.x, l.position.y, l.position.z);
      sh.setVec3f(`uLightColor[${i}]`, c.r * ii, c.g * ii, c.b * ii);
      this.tmpVec.copy(l.direction);
      if (this.tmpVec.lengthSq() < 1e-8) this.tmpVec.set(0, -1, 0);
      this.tmpVec.normalize();
      sh.setVec3f(`uLightDir[${i}]`, this.tmpVec.x, this.tmpVec.y, this.tmpVec.z);
      sh.setFloat(`uLightRange[${i}]`, l.range);
      sh.setFloat(`uLightType[${i}]`, l.type === LightType.Spot ? 2 : 1);
      sh.setVec2(
        `uLightCone[${i}]`,
        Math.cos(l.innerCone),
        Math.cos(l.outerCone),
      );
    }

    // Shadow.
    sh.setMat4('uLightSpaceMatrix', this.lightSpace);
    sh.setInt('uShadowEnabled', shadowsActive ? 1 : 0);
    if (shadowsActive && this.shadowFBO.depthTexture) {
      sh.setTexture('uShadowMap', this.shadowFBO.depthTexture, 8);
    } else {
      sh.setTexture('uShadowMap', this.whiteTex, 8);
    }

    // Fog.
    sh.setVec3('uFogColor', r.fogColor);
    sh.setFloat('uFogDensity', r.fogDensity);
  }

  /** Pick the nearest point/spot lights to the camera, capped at MAX_LIGHTS. */
  private selectPunctualLights(camera: Camera, lights: Light[]): Light[] {
    const punctual: Light[] = [];
    for (const l of lights) {
      if (l.type === LightType.Point || l.type === LightType.Spot) punctual.push(l);
    }
    if (punctual.length <= MAX_LIGHTS) return punctual;

    const cam = camera.position;
    punctual.sort((a, b) => {
      const da =
        (a.position.x - cam.x) ** 2 +
        (a.position.y - cam.y) ** 2 +
        (a.position.z - cam.z) ** 2;
      const db =
        (b.position.x - cam.x) ** 2 +
        (b.position.y - cam.y) ** 2 +
        (b.position.z - cam.z) ** 2;
      return da - db;
    });
    return punctual.slice(0, MAX_LIGHTS);
  }

  /** Sort transparent renderables far-to-near for correct over-blending. */
  private sortBackToFront(list: Renderable[], camera: Camera): void {
    const cam = camera.position;
    list.sort((a, b) => {
      a.worldMatrix.getPosition(this.tmpVec);
      const da =
        (this.tmpVec.x - cam.x) ** 2 +
        (this.tmpVec.y - cam.y) ** 2 +
        (this.tmpVec.z - cam.z) ** 2;
      b.worldMatrix.getPosition(this.tmpVec);
      const db =
        (this.tmpVec.x - cam.x) ** 2 +
        (this.tmpVec.y - cam.y) ** 2 +
        (this.tmpVec.z - cam.z) ** 2;
      return db - da;
    });
  }

  /** Upload per-object transforms + material, set cull state, and draw. */
  private drawRenderable(r: Renderable): void {
    const gl = this.gl;
    const sh = this.pbrShader;
    const mat = r.material;

    this.modelMat.copy(r.worldMatrix);
    this.normalMat.normalFromMat4(this.modelMat);
    sh.setMat4('uModel', this.modelMat);
    sh.setMat3('uNormalMatrix', this.normalMat);

    // Material scalar/color uniforms.
    sh.setVec3('uAlbedo', mat.albedo);
    sh.setFloat('uMetallic', mat.metallic);
    sh.setFloat('uRoughness', mat.roughness);
    const e = mat.emissive;
    const ei = mat.emissiveIntensity;
    sh.setVec3f('uEmissive', e.r * ei, e.g * ei, e.b * ei);
    sh.setFloat('uOpacity', mat.opacity);
    sh.setVec2('uTiling', mat.tiling.x, mat.tiling.y);

    // Texture maps with `has` flags; bind defaults when absent.
    this.bindMap(sh, 'uAlbedoMap', 'uHasAlbedoMap', mat.albedoMap, this.whiteTex, 0);
    this.bindMap(sh, 'uNormalMap', 'uHasNormalMap', mat.normalMap, this.normalTex, 1);
    this.bindMap(
      sh,
      'uMRMap',
      'uHasMRMap',
      mat.metallicRoughnessMap,
      this.whiteTex,
      2,
    );
    this.bindMap(
      sh,
      'uEmissiveMap',
      'uHasEmissiveMap',
      mat.emissiveMap,
      this.blackTex,
      3,
    );
    this.bindMap(sh, 'uAoMap', 'uHasAoMap', mat.aoMap, this.whiteTex, 4);

    // Face culling: double-sided materials disable backface culling.
    if (mat.doubleSided) {
      gl.disable(gl.CULL_FACE);
    } else {
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
    }

    r.mesh.draw();
  }

  /** Bind a material map (or a default) to a texture unit and set its has-flag. */
  private bindMap(
    sh: Shader,
    sampler: string,
    flag: string,
    tex: Texture | undefined,
    fallback: Texture,
    unit: number,
  ): void {
    if (tex) {
      sh.setTexture(sampler, tex, unit);
      sh.setInt(flag, 1);
    } else {
      sh.setTexture(sampler, fallback, unit);
      sh.setInt(flag, 0);
    }
  }

  /** Bloom + tonemap + FXAA, presenting to the default framebuffer. */
  private renderPostFX(): void {
    const gl = this.gl;
    const r = this.resolved;

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.fsTriangle);

    let bloomTex: Texture | null = null;
    if (r.bloom) {
      bloomTex = this.renderBloom();
    }

    // --- COMPOSITE ---
    const compositeTarget = r.fxaa ? this.ldrFBO : null;
    if (compositeTarget) {
      compositeTarget.bind();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    this.compositeShader.use();
    this.compositeShader.setTexture('uScene', this.sceneFBO.colorTextures[0], 0);
    this.compositeShader.setTexture('uBloom', bloomTex ?? this.blackTex, 1);
    this.compositeShader.setFloat('uExposure', r.exposure);
    this.compositeShader.setFloat('uBloomStrength', r.bloomStrength);
    this.compositeShader.setInt('uBloomEnabled', r.bloom ? 1 : 0);
    this.compositeShader.setInt('uToneMapping', this.toneMapId(r.toneMapping));
    this.compositeShader.setFloat('uVignette', 0.6);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- FXAA (composite -> screen) ---
    if (r.fxaa) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.fxaaShader.use();
      this.fxaaShader.setTexture('uTex', this.ldrFBO.colorTextures[0], 0);
      this.fxaaShader.setVec2('uTexel', 1 / this.width, 1 / this.height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  /** Threshold bright pixels then ping-pong separable Gaussian blur. */
  private renderBloom(): Texture {
    const gl = this.gl;
    const r = this.resolved;
    const bw = this.bloomBright.width;
    const bh = this.bloomBright.height;

    // Bright-pass extract from the HDR scene.
    this.bloomBright.bind();
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.brightShader.use();
    this.brightShader.setTexture('uScene', this.sceneFBO.colorTextures[0], 0);
    this.brightShader.setFloat('uThreshold', r.bloomThreshold);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Separable Gaussian: alternate horizontal/vertical between ping & pong.
    this.blurShader.use();
    let src = this.bloomBright;
    let dstPing = this.bloomPing;
    let dstPong = this.bloomPong;

    for (let i = 0; i < BLOOM_ITERATIONS; i++) {
      // Horizontal -> ping.
      dstPing.bind();
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.blurShader.setTexture('uTex', src.colorTextures[0], 0);
      this.blurShader.setVec2('uDirection', 1 / bw, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Vertical -> pong.
      dstPong.bind();
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.blurShader.setTexture('uTex', dstPing.colorTextures[0], 0);
      this.blurShader.setVec2('uDirection', 0, 1 / bh);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      src = dstPong;
      // Swap ping/pong roles for the next iteration.
      const t = dstPing;
      dstPing = dstPong;
      dstPong = t;
    }

    return src.colorTextures[0];
  }

  private toneMapId(mode: 'aces' | 'reinhard' | 'none'): number {
    if (mode === 'aces') return 1;
    if (mode === 'reinhard') return 2;
    return 0;
  }
}
