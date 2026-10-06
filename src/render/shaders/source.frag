// Pass 1: draws the picture that the effect pass turns into glyphs. Either a texture (camera, screen, video, image)
// or one of the built-in scenes, which react to the audio. Then brightness and contrast.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uTex;
uniform sampler2D uSpectrum;
uniform vec2 uRes;
uniform vec2 uTexRes;
// -1 texture, 0 orb, 1 tunnel, 2 flow, 3 spectrum, 4 type
uniform int uScene;
uniform float uTime;
// Tunnel travel, accumulated on the CPU so that speed changes never jump.
uniform float uPhase;
uniform float uMirror;
uniform float uBass;
uniform float uMid;
uniform float uTreble;
uniform float uLevel;
uniform float uBeat;
uniform float uReact;
uniform float uBrightness;
uniform float uContrast;

const float PI = 3.14159265;

vec3 cosPalette(float t, vec3 a, vec3 b, vec3 c, vec3 d) {
  return a + b * cos(6.28318 * (c * t + d));
}

vec2 aspectPoint(vec2 uv) {
  return (uv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
}

vec3 mediaScene(vec2 uv) {
  float screenAspect = uRes.x / uRes.y;
  float texAspect = uTexRes.x / max(uTexRes.y, 1.0);
  vec2 st = uv - 0.5;
  // Cover: fill the screen, crop what does not fit.
  if (screenAspect > texAspect) st.y *= texAspect / screenAspect;
  else st.x *= screenAspect / texAspect;
  st /= 1.0 + uBeat * 0.05 * uReact;
  st += 0.5;
  if (uMirror > 0.5) st.x = 1.0 - st.x;
  return texture(uTex, vec2(st.x, 1.0 - st.y)).rgb;
}

float orbField(vec3 p) {
  float radius = 1.0 + uBass * 0.28 * uReact + uBeat * 0.08 * uReact;
  float d = length(p) - radius;
  d += 0.22 * noise3(p * 2.1 + vec3(0.0, 0.0, uTime * 0.45)) * (0.55 + uMid * uReact);
  d += 0.05 * noise3(p * 7.0 - vec3(uTime * 0.8)) * (0.3 + uTreble * uReact);
  return d * 0.55;
}

vec3 orbScene(vec2 uv) {
  vec2 p = aspectPoint(uv) * 2.0;
  vec3 ro = vec3(0.0, 0.0, 3.4);
  vec3 rd = normalize(vec3(p, -1.9));
  float a = uTime * 0.18;
  mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));
  ro.xz = r * ro.xz;
  rd.xz = r * rd.xz;

  vec3 col = vec3(0.015, 0.02, 0.03);
  // Dust that twinkles with the high frequencies.
  vec2 grid = floor(uv * uRes / 6.0);
  float star = step(0.996, hash12(grid)) * (0.4 + uTreble * uReact) * (0.5 + 0.5 * sin(uTime * 3.0 + hash12(grid + 7.0) * 40.0));
  col += star;

  float t = 0.0;
  bool hit = false;
  for (int i = 0; i < 72; i++) {
    float d = orbField(ro + rd * t);
    if (d < 0.0015) { hit = true; break; }
    t += d;
    if (t > 7.0) break;
  }
  float halo = exp(-2.6 * max(length(p) - 0.85, 0.0));
  col += halo * vec3(0.35, 0.45, 0.8) * (0.12 + uBeat * 0.35 * uReact + uLevel * 0.2);
  if (hit) {
    vec3 q = ro + rd * t;
    vec2 e = vec2(0.003, -0.003);
    vec3 n = normalize(e.xyy * orbField(q + e.xyy) + e.yyx * orbField(q + e.yyx) + e.yxy * orbField(q + e.yxy) + e.xxx * orbField(q + e.xxx));
    vec3 light = normalize(vec3(0.6, 0.8, 0.6));
    float diffuse = max(dot(n, light), 0.0);
    float rim = pow(1.0 - max(dot(n, -rd), 0.0), 3.0);
    vec3 tint = mix(vec3(1.0, 0.55, 0.35), vec3(0.35, 0.7, 1.0), n.y * 0.5 + 0.5);
    col = tint * (0.08 + diffuse * 0.95) + rim * (0.5 + uTreble * uReact) * vec3(0.8, 0.9, 1.0);
  }
  return col;
}

vec3 tunnelScene(vec2 uv) {
  vec2 p = aspectPoint(uv);
  p += 0.06 * vec2(sin(uTime * 0.6), cos(uTime * 0.45));
  float r = max(length(p), 0.001);
  float a = atan(p.y, p.x);
  float z = 0.35 / r + uPhase;
  float twist = a / (2.0 * PI) * 10.0 + z * 0.4 + uTime * 0.1;
  float tiles = sin(twist * 2.0 * PI) * sin(z * PI * 2.0);
  float v = smoothstep(-0.15, 0.15, tiles);
  float ring = smoothstep(0.92, 1.0, 1.0 - abs(fract(z * 0.25) - 0.5) * 2.0) * (0.4 + uBeat * 1.4 * uReact);
  float depth = smoothstep(0.0, 0.45, r);
  vec3 tint = cosPalette(z * 0.05 + a * 0.05, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67));
  return (tint * (0.25 + v * 0.75) + ring) * depth;
}

vec3 flowScene(vec2 uv) {
  // Broad shapes: finer warping turns into noise once it is cut into cells.
  vec2 p = aspectPoint(uv) * 1.5;
  float t = uTime * 0.12;
  vec2 q = vec2(fbm(vec3(p, t)), fbm(vec3(p + vec2(5.2, 1.3), t)));
  vec2 r = vec2(
    fbm(vec3(p + 4.0 * q + vec2(1.7, 9.2), t * 1.3 + uBass * 0.35 * uReact)),
    fbm(vec3(p + 4.0 * q + vec2(8.3, 2.8), t * 1.1))
  );
  float f = fbm(vec3(p + 3.5 * r, t));
  vec3 col = cosPalette(f * 0.8 + uMid * 0.15 * uReact + uTime * 0.02, vec3(0.5), vec3(0.5), vec3(1.0, 0.9, 0.8), vec3(0.0, 0.15, 0.3));
  // fbm sits around 0, so lift it: the scene should fill the frame, not show a few bright specks on black.
  float light = clamp(0.45 + f * 1.4 + length(q) * 0.5, 0.0, 1.25);
  // Deep blues have almost no luma, and the effect pass works on luma: lift the color so brightness follows light.
  col = col * 0.6 + 0.4;
  return col * light * (0.85 + uBeat * 0.35 * uReact);
}

vec3 spectrumScene(vec2 uv) {
  vec2 p = aspectPoint(uv);
  float r = length(p);
  float a = atan(p.x, p.y);
  float u = abs(a) / PI;
  float bars = 72.0;
  float slot = floor(u * bars);
  float uq = (slot + 0.5) / bars;
  float magnitude = texture(uSpectrum, vec2(pow(uq, 1.7) * 0.75, 0.5)).r;
  magnitude = pow(magnitude, 1.4) * (0.6 + 0.6 * uReact);
  float inner = 0.16 + uBass * 0.05 * uReact;
  float outer = inner + 0.02 + magnitude * 0.3;
  float gap = step(0.18, fract(u * bars)) * step(fract(u * bars), 0.82);
  float bar = step(inner, r) * step(r, outer) * gap;
  vec3 tint = mix(vec3(0.15, 0.75, 1.0), vec3(1.0, 0.3, 0.65), uq);
  vec3 col = tint * bar * (0.55 + magnitude * 1.2);
  float disk = 1.0 - smoothstep(inner - 0.03, inner - 0.02, r);
  col += disk * (0.15 + uBeat * 0.75 * uReact) * vec3(1.0);
  float echo = smoothstep(0.004, 0.0, abs(r - (inner + 0.36 + uBeat * 0.05))) * 0.6;
  col += echo * tint;
  col += 0.04 * (fbm(vec3(p * 3.0, uTime * 0.1)) + 0.5);
  return col;
}

vec3 typeScene(vec2 uv) {
  vec2 st = uv - 0.5;
  st.x += sin(st.y * 9.0 + uTime * 2.0) * 0.018 * (0.25 + uBass * 1.4 * uReact);
  st.y += sin(st.x * 7.0 + uTime * 1.4) * 0.014 * (0.25 + uMid * 1.4 * uReact);
  st /= 1.0 + uBeat * 0.07 * uReact;
  float screenAspect = uRes.x / uRes.y;
  float texAspect = uTexRes.x / max(uTexRes.y, 1.0);
  vec2 box = screenAspect > texAspect ? vec2(0.8 * texAspect / screenAspect, 0.8) : vec2(0.9, 0.9 * screenAspect / texAspect);
  vec2 tuv = st / box + 0.5;
  float inside = step(0.0, tuv.x) * step(tuv.x, 1.0) * step(0.0, tuv.y) * step(tuv.y, 1.0);
  float ink = texture(uTex, vec2(tuv.x, 1.0 - tuv.y)).r * inside;
  float background = 0.09 * (fbm(vec3(aspectPoint(uv) * 2.5, uTime * 0.15)) + 0.6);
  vec3 tint = cosPalette(uv.x * 0.4 + uTime * 0.05, vec3(0.75), vec3(0.25), vec3(1.0), vec3(0.0, 0.33, 0.67));
  return vec3(background) + ink * tint;
}

void main() {
  vec3 col;
  if (uScene == 0) col = orbScene(vUv);
  else if (uScene == 1) col = tunnelScene(vUv);
  else if (uScene == 2) col = flowScene(vUv);
  else if (uScene == 3) col = spectrumScene(vUv);
  else if (uScene == 4) col = typeScene(vUv);
  else col = mediaScene(vUv);
  col = (col - 0.5) * uContrast + 0.5 + uBrightness;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
