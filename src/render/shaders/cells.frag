// Readback pass: one output pixel per ASCII cell. R holds the cell's tone, G the edge direction (0 none, 1..4),
// so the CPU can rebuild the exact same characters as plain text. With uOut = 1 it writes the cell's color.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uSrc;
uniform vec2 uRes;
uniform vec2 uSrcRes;
uniform vec2 uCell;
uniform float uInvert;
uniform int uEdges;
uniform int uOut;

vec3 cellSample(vec2 centerPx, float sizePx) {
  float lod = log2(max(sizePx * uSrcRes.x / uRes.x, 1.0));
  return textureLod(uSrc, centerPx / uRes, lod).rgb;
}

float tone(vec3 c) {
  float t = clamp(luma(c), 0.0, 1.0);
  return uInvert > 0.5 ? 1.0 - t : t;
}

void main() {
  vec2 id = floor(gl_FragCoord.xy);
  vec2 center = (id + 0.5) * uCell;
  vec3 src = cellSample(center, uCell.y);
  if (uOut == 1) {
    outColor = vec4(src, 1.0);
    return;
  }
  float t = tone(src);
  float edge = 0.0;
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
      float bin = mod(floor(atan(gy, gx) / 0.7853982 + 0.5), 4.0);
      edge = (bin + 1.0) / 255.0;
    }
  }
  outColor = vec4(t, edge, 0.0, 1.0);
}
