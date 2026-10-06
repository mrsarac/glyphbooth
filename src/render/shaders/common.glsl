// Shared helpers: hashing, value noise, fbm and the dither threshold patterns.

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1, 0, 0));
  float c = hash13(i + vec3(0, 1, 0));
  float d = hash13(i + vec3(1, 1, 0));
  float e = hash13(i + vec3(0, 0, 1));
  float g = hash13(i + vec3(1, 0, 1));
  float h = hash13(i + vec3(0, 1, 1));
  float k = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, g, u.x), mix(h, k, u.x), u.y), u.z) * 2.0 - 1.0;
}

float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    sum += amp * noise3(p);
    p = p * 2.03 + vec3(1.7, 9.2, 4.1);
    amp *= 0.5;
  }
  return sum;
}

// The classic 8x8 ordered dither matrix, built from the bits of x and y. Returns (0..63 + 0.5) / 64.
float bayer8(ivec2 p) {
  int x = p.x & 7;
  int y = p.y & 7;
  int xr = x ^ y;
  int v = ((xr & 1) << 5) | ((y & 1) << 4) | ((xr & 2) << 2) | ((y & 2) << 1) | ((xr & 4) >> 1) | ((y & 4) >> 2);
  return (float(v) + 0.5) / 64.0;
}

// Interleaved gradient noise: a cheap pattern that looks like blue noise.
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

float luma(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// Edge lines for ASCII: Sobel over the 3x3 cell neighbourhood (tones 0..1). Returns the direction bin 0..3
// (vertical, falling diagonal, horizontal, rising diagonal) or -1. Only strong steps count, so edges read as sparse
// outlines instead of covering every gradient, and only on cells with ink of their own, so flat dark areas stay
// clean. Shared by the effect pass and the text readback, so both always pick the same characters.
const float EDGE_THRESHOLD = 1.4;
const float EDGE_MIN_TONE = 0.12;

int edgeBin(float tl, float tc, float tr, float ml, float t, float mr, float bl, float bc, float br) {
  float gx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);
  float gy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);
  if (t < EDGE_MIN_TONE || length(vec2(gx, gy)) < EDGE_THRESHOLD) return -1;
  return int(mod(floor(atan(gy, gx) / 0.7853982 + 0.5), 4.0));
}
