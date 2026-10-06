// The glyph atlas: every character of the charset drawn once into one row of a texture, sorted from the least ink
// to the most. A 256-entry lookup table then maps a cell's tone to the glyph whose ink coverage matches it best.

export const EDGE_GLYPHS = ["|", "\\", "-", "/"];
export const GLYPH_W = 48;
export const GLYPH_H = 80;
// Glyphs per atlas row. A grid keeps the texture small enough for every GPU (WebGL2 only promises 2048 px).
export const ATLAS_COLUMNS = 16;
export const GLYPH_WEIGHT = 800;
export const FONT =
  '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';

export interface Atlas {
  canvas: HTMLCanvasElement;
  // Charset glyphs in atlas order (least ink first), then the four edge glyphs.
  glyphs: string[];
  edgeBase: number;
  lut: Uint8Array;
}

// Sorts characters by coverage, drops duplicates and characters that draw nothing (other than the space).
export function sortByCoverage(
  chars: string[],
  coverage: number[],
): { chars: string[]; coverage: number[] } {
  const seen = new Set<string>();
  const items: { char: string; coverage: number }[] = [];
  chars.forEach((char, index) => {
    if (seen.has(char)) return;
    seen.add(char);
    if (char !== " " && coverage[index] <= 0) return;
    items.push({ char, coverage: coverage[index] });
  });
  items.sort((a, b) => a.coverage - b.coverage);
  return {
    chars: items.map((i) => i.char),
    coverage: items.map((i) => i.coverage),
  };
}

// For each tone 0..255, the index of the glyph whose coverage (rescaled to 0..1) is closest.
export function buildLut(sortedCoverage: number[]): Uint8Array {
  const lut = new Uint8Array(256);
  if (sortedCoverage.length === 0) return lut;
  const min = sortedCoverage[0];
  const max = sortedCoverage[sortedCoverage.length - 1];
  const span = max - min || 1;
  const normalized = sortedCoverage.map((c) => (c - min) / span);
  for (let tone = 0; tone < 256; tone++) {
    const target = tone / 255;
    let best = 0;
    let bestDistance = Infinity;
    normalized.forEach((value, index) => {
      const distance = Math.abs(value - target);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    });
    lut[tone] = best;
  }
  return lut;
}

// The shade blocks are missing from the bundled font subset and would come from whatever system font exists, so
// they are drawn here: 8 px squares on a 16 px grid (still visible after the shrink to a cell), covering a quarter,
// a half, three quarters or all of the cell.
const SHADES: Record<string, number> = { "░": 1, "▒": 2, "▓": 3, "█": 4 };

function drawShade(ctx: CanvasRenderingContext2D, level: number, x: number, y: number): void {
  if (level >= 4) {
    ctx.fillRect(x, y, GLYPH_W, GLYPH_H);
    return;
  }
  for (let py = 0; py < GLYPH_H; py += 8) {
    for (let px = 0; px < GLYPH_W; px += 8) {
      const cx = (px / 8) % 2;
      const cy = (py / 8) % 2;
      // Quarter: one of four squares. Half: a checker. Three quarters: all but one of four.
      const on =
        level === 1 ? cx === 0 && cy === 0 : level === 2 ? cx === cy : !(cx === 1 && cy === 1);
      if (on) ctx.fillRect(x + px, y + py, 8, 8);
    }
  }
}

export function buildAtlas(charset: string): Atlas {
  const chars = Array.from(charset);
  const measure = document.createElement("canvas");
  measure.width = GLYPH_W;
  measure.height = GLYPH_H;
  const mctx = measure.getContext("2d", { willReadFrequently: true });
  if (!mctx) throw new Error("2D canvas is not available");

  const draw = (ctx: CanvasRenderingContext2D, char: string, x: number, y: number) => {
    ctx.fillStyle = "#fff";
    if (char in SHADES) {
      drawShade(ctx, SHADES[char], x, y);
      return;
    }
    // Bold strokes survive the shrink from 48×80 to a 14 px cell; regular weight turns into faint hairlines.
    ctx.font = `${GLYPH_WEIGHT} ${Math.round(GLYPH_H * 0.7)}px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char, x + GLYPH_W / 2, y + GLYPH_H / 2 + GLYPH_H * 0.04);
  };

  const coverage = chars.map((char) => {
    mctx.clearRect(0, 0, GLYPH_W, GLYPH_H);
    draw(mctx, char, 0, 0);
    const data = mctx.getImageData(0, 0, GLYPH_W, GLYPH_H).data;
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i];
    return sum / (255 * GLYPH_W * GLYPH_H);
  });

  const sorted = sortByCoverage(chars, coverage);
  const glyphs = [...sorted.chars, ...EDGE_GLYPHS];
  const canvas = document.createElement("canvas");
  canvas.width = GLYPH_W * ATLAS_COLUMNS;
  canvas.height = GLYPH_H * Math.ceil(glyphs.length / ATLAS_COLUMNS);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas is not available");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  glyphs.forEach((char, index) =>
    draw(ctx, char, (index % ATLAS_COLUMNS) * GLYPH_W, Math.floor(index / ATLAS_COLUMNS) * GLYPH_H),
  );

  return {
    canvas,
    glyphs,
    edgeBase: sorted.chars.length,
    lut: buildLut(sorted.coverage),
  };
}
