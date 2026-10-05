// Pass 2: rebuilds the source picture as glyphs, dither, halftone dots, braille or pixels. Every mode reads the
// source one cell at a time: the source texture has mipmaps, so one textureLod read gives the cell's average color.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSrc;
uniform sampler2D uAtlas;
uniform sampler2D uLut;
uniform vec2 uRes;
uniform vec2 uSrcRes;
// 0 ascii, 1 dither, 2 halftone, 3 braille, 4 pixel
uniform int uMode;
uniform vec2 uCell;
uniform vec2 uGlyphPx;
uniform vec2 uAtlasGrid;
uniform int uEdgeBase;
uniform int uEdges;
uniform vec3 uRamp[8];
uniform int uRampN;
// 0 palette, 1 the source's own colors
uniform int uColor;
uniform float uInvert;
// 0 bayer, 1 noise
uniform int uDither;
uniform float uSpread;

vec3 cellSample(vec2 centerPx, float sizePx) {
  float lod = log2(max(sizePx * uSrcRes.x / uRes.x, 1.0));
  return textureLod(uSrc, centerPx / uRes, lod).rgb;
}

float tone(vec3 c) {
  float t = clamp(luma(c), 0.0, 1.0);
  return uInvert > 0.5 ? 1.0 - t : t;
}

vec3 rampAt(float t) {
  float x = clamp(t, 0.0, 1.0) * float(uRampN - 1);
  int i = int(floor(x));
  int j = min(i + 1, uRampN - 1);
  return mix(uRamp[i], uRamp[j], fract(x));
}

vec3 rampStep(int i) {
  return uRamp[clamp(i, 0, uRampN - 1)];
}

vec3 inkColor(float t, vec3 src) {
  if (uColor == 1) {
    float m = max(max(src.r, src.g), src.b);
    return clamp(src / max(m, 0.08), 0.0, 1.0);
  }
  return rampAt(mix(0.4, 1.0, t));
}

float threshold(vec2 cell) {
  float th = uDither == 0 ? bayer8(ivec2(cell)) : ign(cell);
  return 0.5 + (th - 0.5) * uSpread;
}

vec3 ascii(vec2 frag) {
  vec2 id = floor(frag / uCell);
  vec2 center = (id + 0.5) * uCell;
  vec3 src = cellSample(center, uCell.y);
  float t = tone(src);
  int glyph = int(texelFetch(uLut, ivec2(int(t * 255.0 + 0.5), 0), 0).r * 255.0 + 0.5);

  if (uEdges == 1) {
    vec2 dx = vec2(uCell.x, 0.0);
    vec2 dy = vec2(0.0, uCell.y);
    float tl = tone(cellSample(center - dx + dy, uCell.y));
    float tc = tone(cellSample(center + dy, uCell.y));
    float tr = tone(cellSample(center + dx + dy, uCell.y));
    float ml = tone(cellSample(center - dx, uCell.y));
    float mr = tone(cellSample(center + dx, uCell.y));
    float bl = tone(cellSample(center - dx - dy, uCell.y));
    float bc = tone(cellSample(center - dy, uCell.y));
    float br = tone(cellSample(center + dx - dy, uCell.y));
    float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
    float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
    if (length(vec2(gx, gy)) > 0.55) {
      float angle = atan(gy, gx);
      int bin = int(mod(floor(angle / 0.7853982 + 0.5), 4.0));
      glyph = uEdgeBase + bin;
    }
  }

  vec2 local = clamp(fract(frag / uCell), 0.02, 0.98);
  vec2 slot = vec2(mod(float(glyph), uAtlasGrid.x), floor(float(glyph) / uAtlasGrid.x));
  vec2 atlasUv = (slot + vec2(local.x, 1.0 - local.y)) / uAtlasGrid;
  float lod = log2(max(uGlyphPx.y / uCell.y, 1.0));
  float coverage = textureLod(uAtlas, atlasUv, lod).r;
  return mix(uRamp[0], inkColor(t, src), coverage);
}

vec3 dither(vec2 frag) {
  float px = uCell.x;
  vec2 id = floor(frag / px);
  vec3 src = cellSample((id + 0.5) * px, px);
  float th = threshold(id);
  if (uColor == 1) {
    float levels = 3.0;
    return floor(clamp(src, 0.0, 1.0) * (levels - 1.0) + th) / (levels - 1.0);
  }
  float x = tone(src) * float(uRampN - 1);
  int index = int(floor(x)) + (fract(x) > th ? 1 : 0);
  return rampStep(index);
}

vec3 halftone(vec2 frag) {
  float s = uCell.x;
  float c = cos(0.7853982);
  float sn = sin(0.7853982);
  mat2 rot = mat2(c, sn, -sn, c);
  vec2 p = rot * frag;
  vec2 id = floor(p / s);
  vec2 center = (id + 0.5) * s;
  vec3 src = cellSample(transpose(rot) * center, s);
  float t = tone(src);
  float radius = sqrt(t) * s * 0.72;
  float coverage = 1.0 - smoothstep(radius - 0.8, radius + 0.8, length(p - center));
  return mix(uRamp[0], inkColor(t, src), coverage);
}

vec3 braille(vec2 frag) {
  float s = uCell.x;
  vec2 cell = vec2(s, s * 2.0);
  vec2 sub = vec2(s * 0.5);
  vec2 origin = floor(frag / cell) * cell;
  vec2 subIndex = min(floor((frag - origin) / sub), vec2(1.0, 3.0));
  // Pull the dots toward the middle of the cell, so cells read as separate braille characters.
  vec2 center = origin + cell * 0.1 + (subIndex + 0.5) * sub * 0.8;
  vec3 src = cellSample(origin + (subIndex + 0.5) * sub, sub.x);
  float t = tone(src);
  vec2 globalSub = floor(origin / sub) + subIndex;
  float on = t > threshold(globalSub) ? 1.0 : 0.0;
  float radius = sub.x * 0.3;
  float dotMask = 1.0 - smoothstep(radius - 0.7, radius + 0.7, length(frag - center));
  float coverage = dotMask * mix(0.07, 1.0, on);
  return mix(uRamp[0], inkColor(max(t, 0.6), src), coverage);
}

vec3 pixel(vec2 frag) {
  float s = uCell.x;
  vec2 id = floor(frag / s);
  vec3 src = cellSample((id + 0.5) * s, s);
  float t = tone(src);
  vec3 col = uColor == 1 ? src : rampAt(t);
  if (s >= 6.0) {
    vec2 local = frag - id * s;
    float gap = step(local.x, 1.0) + step(local.y, 1.0);
    col = mix(col, uRamp[0], clamp(gap, 0.0, 1.0) * 0.7);
  }
  return col;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec3 col;
  if (uMode == 0) col = ascii(frag);
  else if (uMode == 1) col = dither(frag);
  else if (uMode == 2) col = halftone(frag);
  else if (uMode == 3) col = braille(frag);
  else col = pixel(frag);
  outColor = vec4(col, 1.0);
}
