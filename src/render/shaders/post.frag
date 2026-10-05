// Pass 3: the screen. Color split and slice glitches on beats, scanlines, a soft vignette and film grain.

in vec2 vUv;
out vec4 outColor;

uniform sampler2D uImage;
uniform vec2 uRes;
uniform float uTime;
uniform float uScan;
uniform float uGrain;
uniform float uGlitch;
uniform float uBeat;

void main() {
  vec2 uv = vUv;
  float frame = floor(uTime * 24.0);
  float slice = step(1.0 - uBeat * uGlitch * 0.12, hash12(vec2(floor(uv.y * 36.0), frame)));
  uv.x += slice * (hash12(vec2(frame, 3.0)) - 0.5) * 0.06;
  float split = uGlitch * (0.6 + uBeat * 5.0) / uRes.x;
  vec3 col = vec3(
    texture(uImage, uv + vec2(split, 0.0)).r,
    texture(uImage, uv).g,
    texture(uImage, uv - vec2(split, 0.0)).b
  );
  float line = 0.5 + 0.5 * cos(gl_FragCoord.y * 2.0943951);
  col *= 1.0 - uScan * 0.4 * line;
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.45;
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 500.0) - 0.5) * uGrain * 0.14;
  outColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
