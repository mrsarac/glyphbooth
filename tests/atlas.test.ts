import { describe, it, expect } from "vitest";
import { buildLut, sortByCoverage } from "../src/render/atlas";

describe("sortByCoverage", () => {
  it("sorts from least to most ink and keeps coverage aligned", () => {
    const out = sortByCoverage(["@", ".", "#"], [0.9, 0.1, 0.5]);
    expect(out.chars).toEqual([".", "#", "@"]);
    expect(out.coverage).toEqual([0.1, 0.5, 0.9]);
  });

  it("dedupes characters, keeping the first occurrence", () => {
    const out = sortByCoverage(["a", "b", "a"], [0.3, 0.2, 0.9]);
    expect(out.chars).toEqual(["b", "a"]);
    expect(out.coverage).toEqual([0.2, 0.3]);
  });

  it("drops characters that draw nothing, except the space", () => {
    const out = sortByCoverage([" ", "​", "x"], [0, 0, 0.4]);
    expect(out.chars).toEqual([" ", "x"]);
  });

  it("keeps the space even with zero coverage and puts it first", () => {
    const out = sortByCoverage(["x", " "], [0.4, 0]);
    expect(out.chars[0]).toBe(" ");
  });

  it("handles empty input", () => {
    expect(sortByCoverage([], [])).toEqual({ chars: [], coverage: [] });
  });
});

describe("buildLut", () => {
  const coverage = [0, 0.1, 0.25, 0.5, 0.9];

  it("has 256 entries", () => {
    expect(buildLut(coverage)).toHaveLength(256);
  });

  it("maps the darkest tone to glyph 0 and the lightest to the last glyph", () => {
    const lut = buildLut(coverage);
    expect(lut[0]).toBe(0);
    expect(lut[255]).toBe(coverage.length - 1);
  });

  it("is monotonic non-decreasing", () => {
    const lut = buildLut(coverage);
    for (let i = 1; i < lut.length; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });

  it("only produces valid glyph indices", () => {
    for (const value of buildLut(coverage)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(coverage.length);
    }
  });

  it("uses every glyph for an evenly spaced ramp", () => {
    const even = Array.from({ length: 10 }, (_, i) => i / 9);
    expect(new Set(buildLut(even)).size).toBe(10);
  });

  it("picks the glyph whose rescaled coverage is closest to the tone", () => {
    // Rescaled coverage: 0, 0.5, 1. Tone 128 (~0.502) must pick the middle glyph.
    const lut = buildLut([0.2, 0.5, 0.8]);
    expect(lut[128]).toBe(1);
    expect(lut[10]).toBe(0);
    expect(lut[250]).toBe(2);
  });

  it("returns all zeros for a single glyph", () => {
    const lut = buildLut([0.3]);
    expect(lut).toHaveLength(256);
    expect(Array.from(lut).every((v) => v === 0)).toBe(true);
  });

  it("returns all zeros for no glyphs", () => {
    const lut = buildLut([]);
    expect(lut).toHaveLength(256);
    expect(Array.from(lut).every((v) => v === 0)).toBe(true);
  });

  it("copes with glyphs that all have the same coverage", () => {
    const lut = buildLut([0.4, 0.4, 0.4]);
    expect(lut).toHaveLength(256);
    for (const value of lut) expect(value).toBeLessThan(3);
  });
});
