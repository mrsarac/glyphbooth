// The three-pass WebGL2 pipeline: source → effect → post, plus a small readback pass for ASCII text export.

import {
  ATLAS_COLUMNS,
  buildAtlas,
  GLYPH_H,
  GLYPH_W,
  type Atlas,
} from "./atlas";
import {
  createTarget,
  createTexture,
  deleteTarget,
  Program,
  type Target,
} from "./gl";
import {
  cellSize,
  charsetFor,
  hexToRgb,
  paletteById,
  SCENES,
  type Settings,
} from "../state";
import commonGlsl from "./shaders/common.glsl?raw";
import vertexGlsl from "./shaders/fullscreen.vert?raw";
import sourceGlsl from "./shaders/source.frag?raw";
import effectGlsl from "./shaders/effect.frag?raw";
import postGlsl from "./shaders/post.frag?raw";
import cellsGlsl from "./shaders/cells.frag?raw";

const PRELUDE =
  "#version 300 es\nprecision highp float;\nprecision highp int;\n";
const MODE_INDEX = {
  ascii: 0,
  dither: 1,
  halftone: 2,
  braille: 3,
  pixel: 4,
} as const;
const FULL_VIEW: [number, number, number, number] = [0.5, 0.5, 1, 1];
// The source pass never needs more pixels than this on its longest side.
const SOURCE_MAX = 1600;

export interface AudioFrame {
  level: number;
  bass: number;
  mid: number;
  treble: number;
  beat: number;
  spectrum: Uint8Array;
}

export type MediaInput =
  HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;

export interface FrameInput {
  settings: Settings;
  time: number;
  phase: number;
  audio: AudioFrame;
  // null: draw the settings' scene. Otherwise the camera, screen, video or image.
  media: MediaInput | null;
  mirror: boolean;
  // The text canvas for the "type" scene.
  textCanvas: HTMLCanvasElement;
  // The area the scenes are framed in (not covered by the panel), in uv with y up: center x, y and size w, h.
  // Defaults to the whole screen.
  view?: [number, number, number, number];
}

export interface CellGrid {
  cols: number;
  rows: number;
  // Per cell, top row first: the character, and its color as [r, g, b] 0..255.
  chars: string[];
  colors: Uint8Array;
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private readonly vao: WebGLVertexArrayObject;
  private readonly source: Program;
  private readonly effect: Program;
  private readonly post: Program;
  private readonly cells: Program;
  private readonly mediaTex: WebGLTexture;
  private readonly textTex: WebGLTexture;
  private readonly spectrumTex: WebGLTexture;
  private readonly atlasTex: WebGLTexture;
  private readonly lutTex: WebGLTexture;
  private sourceTarget: Target | null = null;
  private effectTarget: Target | null = null;
  private atlas: Atlas | null = null;
  private atlasKey = "";
  private textVersion = -1;
  private width = 0;
  private height = 0;
  private lastFrame: FrameInput | null = null;
  // Whether the last frame drew media (camera, screen, file) rather than a scene. See invertFor.
  private mediaActive = false;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Could not create a vertex array");
    this.vao = vao;

    const fragment = (body: string) => PRELUDE + commonGlsl + "\n" + body;
    const vertex = PRELUDE + vertexGlsl;
    this.source = new Program(gl, vertex, fragment(sourceGlsl), "source");
    this.effect = new Program(gl, vertex, fragment(effectGlsl), "effect");
    this.post = new Program(gl, vertex, fragment(postGlsl), "post");
    this.cells = new Program(gl, vertex, fragment(cellsGlsl), "cells");

    this.mediaTex = createTexture(gl, gl.LINEAR);
    this.textTex = createTexture(gl, gl.LINEAR);
    this.spectrumTex = createTexture(gl, gl.LINEAR);
    this.atlasTex = createTexture(gl, gl.LINEAR_MIPMAP_LINEAR);
    this.lutTex = createTexture(gl, gl.NEAREST);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  }

  resize(width: number, height: number): void {
    width = Math.max(1, Math.floor(width));
    height = Math.max(1, Math.floor(height));
    if (width === this.width && height === this.height) return;
    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.gl;
    const scale = Math.min(1, SOURCE_MAX / Math.max(width, height));
    deleteTarget(gl, this.sourceTarget);
    deleteTarget(gl, this.effectTarget);
    this.sourceTarget = createTarget(
      gl,
      Math.round(width * scale),
      Math.round(height * scale),
      true,
    );
    this.effectTarget = createTarget(gl, width, height, false);
  }

  private ensureAtlas(settings: Settings): Atlas {
    const charset = charsetFor(settings);
    if (this.atlas && this.atlasKey === charset) return this.atlas;
    const atlas = buildAtlas(charset);
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      atlas.canvas,
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      256,
      1,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      atlas.lut,
    );
    this.atlas = atlas;
    this.atlasKey = charset;
    return atlas;
  }

  // Call when the glyph font has finished loading, so the atlas is drawn again with it.
  invalidateAtlas(): void {
    this.atlasKey = "";
  }

  invalidateText(): void {
    this.textVersion = -1;
  }

  private upload(
    texture: WebGLTexture,
    media: MediaInput,
  ): [number, number] | null {
    const gl = this.gl;
    let w = 0;
    let h = 0;
    if (media instanceof HTMLVideoElement) {
      if (media.readyState < 2 || media.videoWidth === 0) return null;
      w = media.videoWidth;
      h = media.videoHeight;
    } else if (media instanceof HTMLImageElement) {
      if (!media.complete || media.naturalWidth === 0) return null;
      w = media.naturalWidth;
      h = media.naturalHeight;
    } else {
      w = media.width;
      h = media.height;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);
    return [w, h];
  }

  render(frame: FrameInput): void {
    const gl = this.gl;
    const { settings, audio } = frame;
    if (!this.sourceTarget || !this.effectTarget) return;
    this.lastFrame = frame;
    gl.bindVertexArray(this.vao);

    // Spectrum: 512 bins as one row.
    gl.bindTexture(gl.TEXTURE_2D, this.spectrumTex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R8,
      audio.spectrum.length,
      1,
      0,
      gl.RED,
      gl.UNSIGNED_BYTE,
      audio.spectrum,
    );

    let scene = SCENES.indexOf(settings.scene);
    this.mediaActive = false;
    let texRes: [number, number] = [1, 1];
    let tex = this.mediaTex;
    if (frame.media) {
      const size = this.upload(this.mediaTex, frame.media);
      if (size) {
        scene = -1;
        this.mediaActive = true;
        texRes = size;
      }
    }
    if (scene === SCENES.indexOf("type")) {
      tex = this.textTex;
      const version = Number(frame.textCanvas.dataset.version ?? 0);
      if (version !== this.textVersion) {
        this.upload(this.textTex, frame.textCanvas);
        this.textVersion = version;
      }
      texRes = [frame.textCanvas.width, frame.textCanvas.height];
    }

    const react = settings.reactivity;
    const src = this.sourceTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, src.framebuffer);
    gl.viewport(0, 0, src.width, src.height);
    this.source
      .use()
      .texture("uTex", 0, tex)
      .texture("uSpectrum", 1, this.spectrumTex)
      .f("uRes", src.width, src.height)
      .f("uTexRes", texRes[0], texRes[1])
      .i("uScene", scene)
      .f("uTime", frame.time)
      .f("uPhase", frame.phase)
      .f("uMirror", frame.mirror ? 1 : 0)
      .f("uView", ...(frame.view ?? FULL_VIEW))
      .f("uBass", audio.bass)
      .f("uMid", audio.mid)
      .f("uTreble", audio.treble)
      .f("uLevel", audio.level)
      .f("uBeat", audio.beat)
      .f("uReact", react)
      .f("uBrightness", settings.brightness)
      .f("uContrast", settings.contrast);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, src.texture);
    gl.generateMipmap(gl.TEXTURE_2D);

    const atlas = this.ensureAtlas(settings);
    const palette = paletteById(settings.palette);
    const ramp = new Float32Array(24);
    palette.colors
      .slice(0, 8)
      .forEach((hex, index) => ramp.set(hexToRgb(hex), index * 3));
    const invert = this.invertFor(settings);
    const size = cellSize(settings.mode, settings.size) * this.pixelRatio();
    const cell = this.cellFor(settings, size);

    const fx = this.effectTarget;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fx.framebuffer);
    gl.viewport(0, 0, fx.width, fx.height);
    this.effect
      .use()
      .texture("uSrc", 0, src.texture)
      .texture("uAtlas", 1, this.atlasTex)
      .texture("uLut", 2, this.lutTex)
      .f("uRes", fx.width, fx.height)
      .f("uSrcRes", src.width, src.height)
      .i("uMode", MODE_INDEX[settings.mode])
      .f("uCell", cell[0], cell[1])
      .f("uGlyphPx", GLYPH_W, GLYPH_H)
      .f(
        "uAtlasGrid",
        ATLAS_COLUMNS,
        Math.ceil(atlas.glyphs.length / ATLAS_COLUMNS),
      )
      .i("uEdgeBase", atlas.edgeBase)
      .i("uEdges", settings.edges ? 1 : 0)
      .v3array("uRamp", ramp)
      .i("uRampN", Math.min(8, palette.colors.length))
      .i("uColor", settings.color === "source" ? 1 : 0)
      .f("uInvert", invert ? 1 : 0)
      .i("uDither", settings.dither === "noise" ? 1 : 0)
      .f("uSpread", settings.spread);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    this.post
      .use()
      .texture("uImage", 0, fx.texture)
      .f("uRes", this.width, this.height)
      .f("uTime", frame.time)
      .f("uScan", settings.scanlines)
      .f("uGrain", settings.grain)
      .f("uGlitch", settings.glitch)
      .f("uBeat", audio.beat * Math.min(react, 1.5));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Light palettes read as ink on paper. For media that means dark areas get the ink, so the tone is inverted. A
  // scene is a bright shape on black: inverting it would bury the paper under dense glyphs, so scenes keep their
  // tone and the bright shape becomes the ink.
  private invertFor(settings: Settings): boolean {
    const light = Boolean(paletteById(settings.palette).light);
    return settings.invert !== (light && this.mediaActive);
  }

  private pixelRatio(): number {
    return this.width / Math.max(1, this.canvas.clientWidth || this.width);
  }

  private cellFor(settings: Settings, size: number): [number, number] {
    if (settings.mode === "ascii") return [size, size * (GLYPH_H / GLYPH_W)];
    return [size, size];
  }

  // Reads the current frame back as ASCII characters. Uses the ASCII grid of the current settings, whatever the
  // mode on screen, so "copy as text" always works.
  readCells(maxCols = 240): CellGrid | null {
    const frame = this.lastFrame;
    const src = this.sourceTarget;
    if (!frame || !src || !this.atlas) return null;
    const gl = this.gl;
    const settings = frame.settings;
    const atlas = this.ensureAtlas(settings);
    let size = cellSize("ascii", settings.size) * this.pixelRatio();
    size = Math.max(size, this.width / maxCols);
    const cell: [number, number] = [size, size * (GLYPH_H / GLYPH_W)];
    const cols = Math.max(1, Math.floor(this.width / cell[0]));
    const rows = Math.max(1, Math.floor(this.height / cell[1]));
    const invert = this.invertFor(settings);

    const target = createTarget(gl, cols, rows, false);
    const tones = new Uint8Array(cols * rows * 4);
    const colors = new Uint8Array(cols * rows * 4);
    try {
      gl.bindVertexArray(this.vao);
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      gl.viewport(0, 0, cols, rows);
      this.cells
        .use()
        .texture("uSrc", 0, src.texture)
        .f("uRes", this.width, this.height)
        .f("uSrcRes", src.width, src.height)
        .f("uCell", cell[0], cell[1])
        .f("uInvert", invert ? 1 : 0)
        .i("uEdges", settings.edges ? 1 : 0)
        .i("uOut", 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, tones);
      this.cells.i("uOut", 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, cols, rows, gl.RGBA, gl.UNSIGNED_BYTE, colors);
    } finally {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      deleteTarget(gl, target);
    }

    const chars: string[] = [];
    const rgb = new Uint8Array(cols * rows * 3);
    let out = 0;
    // GL rows start at the bottom; text starts at the top.
    for (let y = rows - 1; y >= 0; y--) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const edge = tones[i + 1];
        const glyph =
          edge > 0 && edge <= 4
            ? atlas.edgeBase + edge - 1
            : atlas.lut[tones[i]];
        chars.push(atlas.glyphs[glyph] ?? " ");
        rgb[out * 3] = colors[i];
        rgb[out * 3 + 1] = colors[i + 1];
        rgb[out * 3 + 2] = colors[i + 2];
        out++;
      }
    }
    return { cols, rows, chars, colors: rgb };
  }
}
