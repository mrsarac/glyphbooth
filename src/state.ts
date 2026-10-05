// Everything the user can change lives in one plain Settings object. It is saved to localStorage, written into the
// URL hash (so a look can be shared as a link) and read back through `sanitize`, which never trusts its input.

export const MODES = [
  "ascii",
  "dither",
  "halftone",
  "braille",
  "pixel",
] as const;
export type Mode = (typeof MODES)[number];

export const SCENES = ["orb", "tunnel", "flow", "spectrum", "type"] as const;
export type Scene = (typeof SCENES)[number];

export const DITHERS = ["bayer", "noise"] as const;
export type DitherKind = (typeof DITHERS)[number];

export interface Palette {
  id: string;
  name: string;
  // Ordered from "empty" (the background) to "full ink".
  colors: string[];
  // A light background: dense glyphs then stand for dark areas, as ink on paper.
  light?: boolean;
}

export const PALETTES: Palette[] = [
  {
    id: "phosphor",
    name: "Phosphor",
    colors: ["#020c06", "#0a3a1a", "#16802f", "#4cff7a", "#d4ffe0"],
  },
  {
    id: "amber",
    name: "Amber",
    colors: ["#0d0700", "#3d1f00", "#a65c00", "#ffaa1d", "#ffe9bd"],
  },
  {
    id: "gameboy",
    name: "Game Boy",
    colors: ["#0f380f", "#306230", "#8bac0f", "#c4d97a"],
  },
  { id: "onebit", name: "1-bit", colors: ["#000000", "#ffffff"] },
  {
    id: "paper",
    name: "Ink & paper",
    colors: ["#f1eadb", "#b9b1a0", "#5c5750", "#151413"],
    light: true,
  },
  {
    id: "blueprint",
    name: "Blueprint",
    colors: ["#0a2552", "#22549e", "#8fbaf5", "#f4f9ff"],
  },
  {
    id: "magma",
    name: "Magma",
    colors: ["#000004", "#3b0f70", "#8c2981", "#de4968", "#fe9f6d", "#fcfdbf"],
  },
  {
    id: "sunset",
    name: "Synthwave",
    colors: ["#12041f", "#46186e", "#c2307f", "#ff7a59", "#ffd88a"],
  },
  {
    id: "cga",
    name: "CGA",
    colors: ["#000000", "#55ffff", "#ff55ff", "#ffffff"],
  },
  {
    id: "ice",
    name: "Ice",
    colors: ["#03070e", "#0e2a47", "#2f7cc1", "#9fd8ff", "#ffffff"],
  },
  {
    id: "riso",
    name: "Risograph",
    colors: ["#f4efe6", "#ff48b0", "#0078bf", "#1b1b1b"],
    light: true,
  },
];

export interface Charset {
  id: string;
  name: string;
  chars: string;
}

export const CHARSETS: Charset[] = [
  { id: "classic", name: "Classic", chars: " .:-=+*#%@" },
  {
    id: "detailed",
    name: "Detailed",
    chars:
      " .'`^\",:;Il!i><~+_-?][}{1)(|tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  { id: "blocks", name: "Blocks", chars: " ░▒▓█" },
  { id: "binary", name: "Binary", chars: " 01" },
  { id: "dots", name: "Dots", chars: " ·∙•●" },
  { id: "custom", name: "Your text", chars: "" },
];

export type ColorMode = "palette" | "source";

export interface Settings {
  mode: Mode;
  palette: string;
  color: ColorMode;
  charset: string;
  customChars: string;
  edges: boolean;
  dither: DitherKind;
  // 0..1, mapped to a cell or pixel size per mode (see cellSize).
  size: number;
  spread: number;
  brightness: number;
  contrast: number;
  invert: boolean;
  mirror: boolean;
  scene: Scene;
  text: string;
  reactivity: number;
  scanlines: number;
  grain: number;
  glitch: number;
}

export const DEFAULTS: Settings = {
  mode: "ascii",
  palette: "phosphor",
  color: "palette",
  charset: "detailed",
  customChars: "GLYPHBOOTH",
  edges: true,
  dither: "bayer",
  size: 0.3,
  spread: 1,
  brightness: 0,
  contrast: 1.15,
  invert: false,
  mirror: true,
  scene: "orb",
  text: "HELLO",
  reactivity: 1,
  scanlines: 0.25,
  grain: 0.15,
  glitch: 0.5,
};

export interface Preset {
  id: string;
  name: string;
  settings: Partial<Settings>;
}

export const PRESETS: Preset[] = [
  {
    id: "terminal",
    name: "Terminal",
    settings: {
      mode: "ascii",
      palette: "phosphor",
      color: "palette",
      charset: "detailed",
      edges: true,
      size: 0.3,
      scanlines: 0.35,
      grain: 0.15,
      glitch: 0.5,
    },
  },
  {
    id: "sketch",
    name: "Pen sketch",
    settings: {
      mode: "ascii",
      palette: "paper",
      color: "palette",
      charset: "classic",
      edges: true,
      size: 0.22,
      scanlines: 0,
      grain: 0.3,
      glitch: 0.2,
    },
  },
  {
    id: "color-ascii",
    name: "Color ASCII",
    settings: {
      mode: "ascii",
      palette: "onebit",
      color: "source",
      charset: "detailed",
      edges: false,
      size: 0.25,
      scanlines: 0.1,
      grain: 0.1,
      glitch: 0.6,
    },
  },
  {
    id: "gameboy",
    name: "Game Boy",
    settings: {
      mode: "dither",
      palette: "gameboy",
      color: "palette",
      dither: "bayer",
      size: 0.35,
      spread: 1,
      scanlines: 0.15,
      grain: 0,
      glitch: 0.3,
    },
  },
  {
    id: "mac",
    name: "1-bit Mac",
    settings: {
      mode: "dither",
      palette: "onebit",
      color: "palette",
      dither: "bayer",
      size: 0.15,
      spread: 1,
      scanlines: 0,
      grain: 0,
      glitch: 0.2,
    },
  },
  {
    id: "thermal",
    name: "Thermal",
    settings: {
      mode: "dither",
      palette: "magma",
      color: "palette",
      dither: "noise",
      size: 0.2,
      spread: 0.8,
      scanlines: 0.2,
      grain: 0.1,
      glitch: 0.7,
    },
  },
  {
    id: "newsprint",
    name: "Newsprint",
    settings: {
      mode: "halftone",
      palette: "paper",
      color: "palette",
      size: 0.3,
      scanlines: 0,
      grain: 0.35,
      glitch: 0.2,
    },
  },
  {
    id: "pop",
    name: "Pop art",
    settings: {
      mode: "halftone",
      palette: "riso",
      color: "palette",
      size: 0.45,
      scanlines: 0,
      grain: 0.2,
      glitch: 0.4,
    },
  },
  {
    id: "braille",
    name: "Braille ghost",
    settings: {
      mode: "braille",
      palette: "ice",
      color: "palette",
      size: 0.3,
      scanlines: 0.2,
      grain: 0.1,
      glitch: 0.6,
    },
  },
  {
    id: "led",
    name: "LED wall",
    settings: {
      mode: "pixel",
      palette: "sunset",
      color: "source",
      size: 0.35,
      scanlines: 0,
      grain: 0.05,
      glitch: 0.6,
    },
  },
  {
    id: "blueprint",
    name: "Blueprint",
    settings: {
      mode: "ascii",
      palette: "blueprint",
      color: "palette",
      charset: "classic",
      edges: true,
      size: 0.3,
      scanlines: 0.1,
      grain: 0.15,
      glitch: 0.3,
    },
  },
  {
    id: "amber",
    name: "Amber CRT",
    settings: {
      mode: "ascii",
      palette: "amber",
      color: "palette",
      charset: "blocks",
      edges: false,
      size: 0.28,
      scanlines: 0.5,
      grain: 0.2,
      glitch: 0.5,
    },
  },
];

export function paletteById(id: string): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

export function charsetFor(
  settings: Pick<Settings, "charset" | "customChars">,
): string {
  if (settings.charset === "custom") {
    // A space keeps dark areas empty; without it the whole frame would be covered in letters.
    const chars = Array.from(
      new Set(Array.from(" " + settings.customChars.replace(/\s+/g, ""))),
    ).join("");
    return chars.length >= 2 ? chars : CHARSETS[0].chars;
  }
  return (CHARSETS.find((c) => c.id === settings.charset) ?? CHARSETS[0]).chars;
}

// The on-screen size in pixels of one cell (or one dither pixel), from the normalized size slider.
export function cellSize(mode: Mode, size: number): number {
  const s = clamp(size, 0, 1);
  switch (mode) {
    case "ascii":
      return Math.round(6 + s * 26);
    case "dither":
      return Math.max(1, Math.round(1 + s * 7));
    case "halftone":
      return Math.round(4 + s * 28);
    case "braille":
      return Math.round(4 + s * 14);
    case "pixel":
      return Math.round(3 + s * 37);
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return [0, 0, 0];
  const n = parseInt(match[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const NUMBER_RANGES: Record<string, [number, number]> = {
  size: [0, 1],
  spread: [0, 1.5],
  brightness: [-0.5, 0.5],
  contrast: [0.5, 2.5],
  reactivity: [0, 2],
  scanlines: [0, 1],
  grain: [0, 1],
  glitch: [0, 1],
};

// Turns anything (parsed JSON, URL parameters, old saved state) into valid Settings. Unknown keys are dropped, bad
// values fall back to the defaults, numbers are clamped and text is shortened.
export function sanitize(input: unknown): Settings {
  const out: Settings = { ...DEFAULTS };
  if (!input || typeof input !== "object") return out;
  const raw = input as Record<string, unknown>;

  const pick = <T extends string>(
    value: unknown,
    allowed: readonly T[],
    fallback: T,
  ): T =>
    typeof value === "string" && (allowed as readonly string[]).includes(value)
      ? (value as T)
      : fallback;
  const bool = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === "boolean") return value;
    if (value === "1" || value === "true") return true;
    if (value === "0" || value === "false") return false;
    return fallback;
  };
  const text = (value: unknown, fallback: string, max: number): string =>
    typeof value === "string" ? value.slice(0, max) : fallback;

  out.mode = pick(raw.mode, MODES, DEFAULTS.mode);
  out.palette = pick(
    raw.palette,
    PALETTES.map((p) => p.id),
    DEFAULTS.palette,
  );
  out.color = pick(raw.color, ["palette", "source"] as const, DEFAULTS.color);
  out.charset = pick(
    raw.charset,
    CHARSETS.map((c) => c.id),
    DEFAULTS.charset,
  );
  out.customChars = text(raw.customChars, DEFAULTS.customChars, 64);
  out.edges = bool(raw.edges, DEFAULTS.edges);
  out.dither = pick(raw.dither, DITHERS, DEFAULTS.dither);
  out.invert = bool(raw.invert, DEFAULTS.invert);
  out.mirror = bool(raw.mirror, DEFAULTS.mirror);
  out.scene = pick(raw.scene, SCENES, DEFAULTS.scene);
  out.text = text(raw.text, DEFAULTS.text, 40);

  for (const [key, [min, max]] of Object.entries(NUMBER_RANGES)) {
    const value = typeof raw[key] === "string" ? Number(raw[key]) : raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      (out as unknown as Record<string, number>)[key] = clamp(value, min, max);
    }
  }
  return out;
}

const SHORT: Record<keyof Settings, string> = {
  mode: "m",
  palette: "p",
  color: "c",
  charset: "cs",
  customChars: "cc",
  edges: "e",
  dither: "d",
  size: "s",
  spread: "sp",
  brightness: "b",
  contrast: "k",
  invert: "i",
  mirror: "mi",
  scene: "sc",
  text: "t",
  reactivity: "r",
  scanlines: "sl",
  grain: "g",
  glitch: "gl",
};

// Only values that differ from the defaults go into the link, so shared links stay short.
export function toHash(settings: Settings): string {
  const params = new URLSearchParams();
  for (const key of Object.keys(SHORT) as (keyof Settings)[]) {
    const value = settings[key];
    if (value === DEFAULTS[key]) continue;
    if (typeof value === "boolean") params.set(SHORT[key], value ? "1" : "0");
    else if (typeof value === "number")
      params.set(SHORT[key], String(Math.round(value * 1000) / 1000));
    else params.set(SHORT[key], value);
  }
  return params.toString();
}

export function fromHash(hash: string): Settings | null {
  const clean = hash.replace(/^#/, "");
  if (!clean) return null;
  const params = new URLSearchParams(clean);
  const raw: Record<string, string> = {};
  for (const key of Object.keys(SHORT) as (keyof Settings)[]) {
    const value = params.get(SHORT[key]);
    if (value !== null) raw[key] = value;
  }
  if (Object.keys(raw).length === 0) return null;
  return sanitize({ ...DEFAULTS, ...raw });
}

export function applyPreset(settings: Settings, preset: Preset): Settings {
  return sanitize({ ...settings, ...preset.settings });
}

// Random but always good-looking: a preset as the base, then a few nudges.
export function randomize(
  settings: Settings,
  random: () => number = Math.random,
): Settings {
  const preset = PRESETS[Math.floor(random() * PRESETS.length)];
  const palette = PALETTES[Math.floor(random() * PALETTES.length)];
  return sanitize({
    ...settings,
    ...preset.settings,
    palette: random() < 0.6 ? palette.id : preset.settings.palette,
    size: clamp(
      (preset.settings.size ?? settings.size) + (random() - 0.5) * 0.2,
      0.05,
      0.8,
    ),
  });
}
