/// <reference types="node" />
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

// A direct port of bayer8() from src/render/shaders/common.glsl, returning the integer 0..63.
function bayer8Int(px: number, py: number): number {
  const x = px & 7;
  const y = py & 7;
  const xr = x ^ y;
  return ((xr & 1) << 5) | ((y & 1) << 4) | ((xr & 2) << 2) | ((y & 2) << 1) | ((xr & 4) >> 1) | ((y & 4) >> 2);
}

describe("bayer8 (ported from common.glsl)", () => {
  it("the GLSL source still contains the formula this port mirrors", () => {
    const glsl = read("render/shaders/common.glsl");
    expect(glsl).toContain(
      "((xr & 1) << 5) | ((y & 1) << 4) | ((xr & 2) << 2) | ((y & 2) << 1) | ((xr & 4) >> 1) | ((y & 4) >> 2)",
    );
    expect(glsl).toContain("(float(v) + 0.5) / 64.0");
  });

  it("is a permutation of 0..63 over the 8x8 grid", () => {
    const values: number[] = [];
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) values.push(bayer8Int(x, y));
    expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 64 }, (_, i) => i));
  });

  it("tiles every 8 pixels and handles negative coordinates", () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        expect(bayer8Int(x + 8, y + 16)).toBe(bayer8Int(x, y));
        expect(bayer8Int(x - 8, y - 8)).toBe(bayer8Int(x, y));
      }
    }
  });

  it("has the standard 2x2 ordered-dither pattern at the top level", () => {
    // [0 2; 3 1] scaled by 16.
    expect([bayer8Int(0, 0), bayer8Int(1, 0), bayer8Int(0, 1), bayer8Int(1, 1)].map((v) => v >> 4)).toEqual([0, 2, 3, 1]);
  });

  it("every aligned 2x2 block holds all four quartiles, so neighbours are spread", () => {
    for (let by = 0; by < 8; by += 2) {
      for (let bx = 0; bx < 8; bx += 2) {
        const quartiles = [
          bayer8Int(bx, by),
          bayer8Int(bx + 1, by),
          bayer8Int(bx, by + 1),
          bayer8Int(bx + 1, by + 1),
        ].map((v) => v >> 4);
        expect([...quartiles].sort()).toEqual([0, 1, 2, 3]);
      }
    }
  });

  it("horizontally adjacent cells never have close values", () => {
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 7; x++) {
        expect(Math.abs(bayer8Int(x, y) - bayer8Int(x + 1, y))).toBeGreaterThanOrEqual(16);
      }
    }
  });

  it("thresholding at tone t turns on about t of the cells", () => {
    for (const t of [0.25, 0.5, 0.75]) {
      let on = 0;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) if ((bayer8Int(x, y) + 0.5) / 64 < t) on++;
      expect(on).toBe(Math.round(t * 64));
    }
  });
});

describe("shader uniforms", () => {
  const renderer = read("render/renderer.ts");
  const shaders: Record<string, string> = {
    source: read("render/shaders/source.frag"),
    effect: read("render/shaders/effect.frag"),
    post: read("render/shaders/post.frag"),
    cells: read("render/shaders/cells.frag"),
  };

  const declared = (source: string): Set<string> =>
    new Set(
      [...source.matchAll(/^\s*uniform\s+\w+\s+(\w+)\s*(?:\[\d+\])?\s*;/gm)].map((m) => m[1]),
    );

  // Each statement of the renderer that starts with `this.<program>` is one chain of uniform calls.
  function usedUniforms(program: string): Set<string> {
    const used = new Set<string>();
    for (const statement of renderer.split(";")) {
      const head = new RegExp(`^\\s*(?:/\\/[^\\n]*\\n\\s*)*this\\.${program}\\b`).test(statement);
      if (!head) continue;
      for (const m of statement.matchAll(/\.(?:f|i|texture|v3array)\(\s*"(u\w+)"/g)) used.add(m[1]);
    }
    return used;
  }

  it("the parser finds uniforms for every program (guards against a silent no-op test)", () => {
    for (const program of Object.keys(shaders)) {
      expect(usedUniforms(program).size, program).toBeGreaterThan(2);
      expect(declared(shaders[program]).size, program).toBeGreaterThan(2);
    }
  });

  it.each(Object.keys(shaders))("every uniform set from renderer.ts for '%s' is declared in its shader", (program) => {
    const known = declared(shaders[program]);
    for (const name of usedUniforms(program)) {
      expect(known.has(name), `${name} is set on '${program}' but not declared in ${program}.frag`).toBe(true);
    }
  });

  it.each(Object.keys(shaders))("every uniform declared in '%s' is set by renderer.ts", (program) => {
    const used = usedUniforms(program);
    for (const name of declared(shaders[program])) {
      expect(used.has(name), `${name} is declared in ${program}.frag but never set`).toBe(true);
    }
  });

  it("the shared common.glsl declares no uniforms (it is prepended to every program)", () => {
    expect(declared(read("render/shaders/common.glsl")).size).toBe(0);
  });
});
