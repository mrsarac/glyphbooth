import { describe, it, expect } from "vitest";
import {
  CHARSETS,
  DEFAULTS,
  MODES,
  PALETTES,
  PRESETS,
  applyPreset,
  cellSize,
  charsetFor,
  fromHash,
  hexToRgb,
  randomize,
  sanitize,
  toHash,
  type Settings,
} from "../src/state";

// Small deterministic RNG (mulberry32) so the randomize runs are reproducible.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("sanitize", () => {
  it.each([null, undefined, 42, "text", true, [], () => 1])(
    "returns defaults for non-object input %s",
    (input) => {
      expect(sanitize(input)).toEqual(DEFAULTS);
    },
  );

  it("drops unknown keys", () => {
    const out = sanitize({ evil: 1, mode: "dither" }) as unknown as Record<string, unknown>;
    expect(out.evil).toBeUndefined();
    expect(out.mode).toBe("dither");
  });

  it("falls back to defaults for wrong types", () => {
    const out = sanitize({ mode: 5, palette: {}, size: "abc", edges: 7, text: 12 });
    expect(out.mode).toBe(DEFAULTS.mode);
    expect(out.palette).toBe(DEFAULTS.palette);
    expect(out.size).toBe(DEFAULTS.size);
    expect(out.edges).toBe(DEFAULTS.edges);
    expect(out.text).toBe(DEFAULTS.text);
  });

  it("clamps out-of-range numbers", () => {
    const out = sanitize({
      size: 5,
      spread: -3,
      brightness: 99,
      contrast: 0,
      reactivity: 100,
      scanlines: -1,
      grain: 2,
      glitch: Number.POSITIVE_INFINITY,
    });
    expect(out.size).toBe(1);
    expect(out.spread).toBe(0);
    expect(out.brightness).toBe(0.5);
    expect(out.contrast).toBe(0.5);
    expect(out.reactivity).toBe(2);
    expect(out.scanlines).toBe(0);
    expect(out.grain).toBe(1);
    // Infinity is not finite: falls back to the default.
    expect(out.glitch).toBe(DEFAULTS.glitch);
  });

  it("ignores NaN", () => {
    expect(sanitize({ size: Number.NaN }).size).toBe(DEFAULTS.size);
  });

  it("parses numeric strings", () => {
    expect(sanitize({ size: "0.75" }).size).toBe(0.75);
    expect(sanitize({ contrast: "9" }).contrast).toBe(2.5);
  });

  it("falls back to the default palette for an unknown palette", () => {
    expect(sanitize({ palette: "nope" }).palette).toBe(DEFAULTS.palette);
  });

  it("understands string booleans", () => {
    const on = sanitize({ edges: "0", invert: "1", mirror: "false" });
    expect(on.edges).toBe(false);
    expect(on.invert).toBe(true);
    expect(on.mirror).toBe(false);
    expect(sanitize({ invert: "true" }).invert).toBe(true);
    expect(sanitize({ invert: "maybe" }).invert).toBe(DEFAULTS.invert);
  });

  it("truncates text to 40 and custom characters to 64", () => {
    const out = sanitize({ text: "x".repeat(100), customChars: "y".repeat(200) });
    expect(out.text).toHaveLength(40);
    expect(out.customChars).toHaveLength(64);
  });

  it("is idempotent", () => {
    const once = sanitize({ mode: "braille", size: 7, palette: "magma" });
    expect(sanitize(once)).toEqual(once);
  });
});

describe("hash round trip", () => {
  it("produces an empty hash for the defaults", () => {
    expect(toHash(DEFAULTS)).toBe("");
  });

  it("returns null for an empty hash or one without known keys", () => {
    expect(fromHash("")).toBeNull();
    expect(fromHash("#")).toBeNull();
    expect(fromHash("#zzz=1&foo=bar")).toBeNull();
  });

  it("only writes values that differ from the defaults", () => {
    const hash = toHash({ ...DEFAULTS, mode: "dither" });
    expect(hash).toBe("m=dither");
  });

  it("round-trips a handful of settings", () => {
    const samples: Settings[] = [
      { ...DEFAULTS, mode: "dither", palette: "gameboy", size: 0.5 },
      { ...DEFAULTS, mode: "braille", invert: true, mirror: false },
      { ...DEFAULTS, color: "source", edges: false, glitch: 0 },
      { ...DEFAULTS, brightness: -0.25, contrast: 2, spread: 1.5 },
      { ...DEFAULTS, scene: "spectrum", reactivity: 0 },
    ];
    for (const settings of samples) {
      expect(fromHash(toHash(settings))).toEqual(settings);
    }
  });

  it("round-trips text with spaces and Unicode", () => {
    const settings: Settings = { ...DEFAULTS, text: "MERHABA ĞÜŞ", scene: "type" };
    const hash = toHash(settings);
    expect(hash).not.toContain(" ");
    expect(fromHash(`#${hash}`)?.text).toBe("MERHABA ĞÜŞ");
  });

  it("round-trips text containing reserved URL characters", () => {
    const settings: Settings = { ...DEFAULTS, text: "a&b=c#d+e%f" };
    expect(fromHash(toHash(settings))?.text).toBe("a&b=c#d+e%f");
  });

  it("round-trips custom characters", () => {
    const settings: Settings = { ...DEFAULTS, charset: "custom", customChars: "ÇŞĞ▓░" };
    expect(fromHash(toHash(settings))).toEqual(settings);
  });

  it("round-trips every preset", () => {
    for (const preset of PRESETS) {
      const settings = applyPreset(DEFAULTS, preset);
      expect(fromHash(toHash(settings)) ?? DEFAULTS, preset.id).toEqual(settings);
    }
  });

  it("clamps hostile hash values", () => {
    const out = fromHash("#m=evil&s=99&p=nope");
    expect(out?.mode).toBe(DEFAULTS.mode);
    expect(out?.size).toBe(1);
    expect(out?.palette).toBe(DEFAULTS.palette);
  });
});

describe("charsetFor", () => {
  it("returns the named charset", () => {
    expect(charsetFor({ charset: "blocks", customChars: "" })).toBe(" ░▒▓█");
  });

  it("falls back to classic for an unknown charset id", () => {
    expect(charsetFor({ charset: "nope", customChars: "" })).toBe(CHARSETS[0].chars);
  });

  it("dedupes custom characters, drops whitespace and starts with a space", () => {
    const chars = charsetFor({ charset: "custom", customChars: "A B  C A\tB\n" });
    expect(chars).toBe(" ABC");
  });

  it("keeps surrogate pairs intact", () => {
    const chars = charsetFor({ charset: "custom", customChars: "😀😀a" });
    expect(Array.from(chars)).toEqual([" ", "😀", "a"]);
  });

  it("falls back when the custom text is too short", () => {
    expect(charsetFor({ charset: "custom", customChars: "" })).toBe(CHARSETS[0].chars);
    expect(charsetFor({ charset: "custom", customChars: "   " })).toBe(CHARSETS[0].chars);
  });

  it("accepts a single distinct custom character (plus the space)", () => {
    expect(charsetFor({ charset: "custom", customChars: "x" })).toBe(" x");
  });
});

describe("cellSize", () => {
  const steps = Array.from({ length: 101 }, (_, i) => i / 100);

  it.each(MODES)("is monotonic non-decreasing in size for %s", (mode) => {
    let previous = -Infinity;
    for (const s of steps) {
      const value = cellSize(mode, s);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
    expect(cellSize(mode, 1)).toBeGreaterThan(cellSize(mode, 0));
  });

  it.each(MODES)("stays within sane bounds for %s", (mode) => {
    for (const s of [-5, 0, 0.5, 1, 5]) {
      const value = cellSize(mode, s);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(64);
    }
  });

  it("clamps size outside 0..1", () => {
    expect(cellSize("ascii", -1)).toBe(cellSize("ascii", 0));
    expect(cellSize("ascii", 9)).toBe(cellSize("ascii", 1));
  });

  it("keeps dither at least one whole pixel", () => {
    expect(cellSize("dither", 0)).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(cellSize("dither", 0.37))).toBe(true);
  });
});

describe("presets and palettes", () => {
  it.each(PRESETS.map((p) => [p.id, p] as const))(
    "preset %s keeps all its settings through sanitize",
    (_id, preset) => {
      const cleaned = sanitize({ ...DEFAULTS, ...preset.settings });
      for (const [key, value] of Object.entries(preset.settings)) {
        expect(cleaned[key as keyof Settings], key).toEqual(value);
      }
    },
  );

  it("has unique preset and palette ids", () => {
    expect(new Set(PRESETS.map((p) => p.id)).size).toBe(PRESETS.length);
    expect(new Set(PALETTES.map((p) => p.id)).size).toBe(PALETTES.length);
  });

  it.each(PALETTES.map((p) => [p.id, p] as const))(
    "palette %s has 2..8 valid hex colors",
    (_id, palette) => {
      expect(palette.colors.length).toBeGreaterThanOrEqual(2);
      expect(palette.colors.length).toBeLessThanOrEqual(8);
      for (const color of palette.colors) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
    },
  );

  it("light palettes have a light first color", () => {
    for (const palette of PALETTES.filter((p) => p.light)) {
      const [r, g, b] = hexToRgb(palette.colors[0]);
      expect((r + g + b) / 3).toBeGreaterThan(0.6);
    }
  });
});

describe("hexToRgb", () => {
  it("converts to 0..1 channels", () => {
    expect(hexToRgb("#000000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#ffffff")).toEqual([1, 1, 1]);
    const [r, g, b] = hexToRgb("#ff8000");
    expect(r).toBe(1);
    expect(g).toBeCloseTo(128 / 255, 5);
    expect(b).toBe(0);
  });

  it("accepts a missing # and uppercase", () => {
    expect(hexToRgb("FF0000")).toEqual([1, 0, 0]);
  });

  it("returns black for invalid input", () => {
    expect(hexToRgb("nope")).toEqual([0, 0, 0]);
    expect(hexToRgb("#fff")).toEqual([0, 0, 0]);
  });
});

describe("randomize", () => {
  it("always returns valid settings (200 seeded runs)", () => {
    const rng = seeded(1234);
    let current: Settings = { ...DEFAULTS };
    for (let i = 0; i < 200; i++) {
      current = randomize(current, rng);
      expect(sanitize(current)).toEqual(current);
      expect(PALETTES.some((p) => p.id === current.palette)).toBe(true);
      expect(current.size).toBeGreaterThanOrEqual(0.05);
      expect(current.size).toBeLessThanOrEqual(0.8);
    }
  });

  it("survives extreme RNG outputs", () => {
    for (const value of [0, 0.999999999]) {
      const out = randomize(DEFAULTS, () => value);
      expect(sanitize(out)).toEqual(out);
    }
  });

  it("does not touch settings the presets leave alone", () => {
    const base: Settings = { ...DEFAULTS, text: "KEEP ME", scene: "tunnel", mirror: false };
    const out = randomize(base, seeded(7));
    expect(out.text).toBe("KEEP ME");
    expect(out.scene).toBe("tunnel");
    expect(out.mirror).toBe(false);
  });

  it("produces variety", () => {
    const rng = seeded(99);
    const modes = new Set(Array.from({ length: 100 }, () => randomize(DEFAULTS, rng).mode));
    expect(modes.size).toBeGreaterThan(2);
  });
});
