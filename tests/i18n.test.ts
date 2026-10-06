import { describe, it, expect } from "vitest";
import { STRINGS, detectLanguage } from "../src/ui/i18n";

// Flattens nested objects/arrays into "path" -> leaf, so both languages can be compared key by key.
function flatten(value: unknown, path = ""): Record<string, unknown> {
  if (typeof value === "string") return { [path]: value };
  if (Array.isArray(value)) {
    return value.reduce<Record<string, unknown>>(
      (acc, item, i) => ({ ...acc, ...flatten(item, `${path}[${i}]`) }),
      {},
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce<Record<string, unknown>>(
      (acc, [k, v]) => ({ ...acc, ...flatten(v, path ? `${path}.${k}` : k) }),
      {},
    );
  }
  return { [path]: value };
}

describe("STRINGS", () => {
  const en = flatten(STRINGS.en);
  const tr = flatten(STRINGS.tr);

  it("en and tr have identical key sets, recursively", () => {
    expect(Object.keys(tr).sort()).toEqual(Object.keys(en).sort());
  });

  it("covers scenes, modes and dithers in both languages", () => {
    for (const lang of [STRINGS.en, STRINGS.tr]) {
      expect(Object.keys(lang.scenes).sort()).toEqual(["flow", "orb", "spectrum", "tunnel", "type"]);
      expect(Object.keys(lang.modes).sort()).toEqual(["ascii", "braille", "dither", "halftone", "pixel"]);
      expect(Object.keys(lang.dithers).sort()).toEqual(["bayer", "noise"]);
    }
  });

  it("help tables have the same length and the same keys", () => {
    expect(STRINGS.tr.help).toHaveLength(STRINGS.en.help.length);
    expect(STRINGS.tr.help.map(([key]) => key)).toEqual(STRINGS.en.help.map(([key]) => key));
  });

  it("every leaf is a non-empty string in both languages", () => {
    for (const [lang, flat] of [["en", en], ["tr", tr]] as const) {
      for (const [path, value] of Object.entries(flat)) {
        expect(typeof value, `${lang}:${path}`).toBe("string");
        expect((value as string).trim().length, `${lang}:${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("tr is actually translated for most strings", () => {
    const same = Object.keys(en).filter((k) => en[k] === tr[k]);
    // Brand names and mode names legitimately stay the same, but never the majority.
    expect(same.length).toBeLessThan(Object.keys(en).length / 3);
  });
});

describe("detectLanguage", () => {
  it("picks Turkish for tr and tr-TR", () => {
    expect(detectLanguage(["tr"])).toBe("tr");
    expect(detectLanguage(["tr-TR"])).toBe("tr");
    expect(detectLanguage(["TR-tr"])).toBe("tr");
  });

  it("picks Turkish when it appears anywhere in the list", () => {
    expect(detectLanguage(["en-US", "tr"])).toBe("tr");
  });

  it("defaults to English", () => {
    expect(detectLanguage([])).toBe("en");
    expect(detectLanguage(["en-US", "de"])).toBe("en");
  });

  it("does not match languages that merely contain 'tr'", () => {
    expect(detectLanguage(["xtr"])).toBe("en");
  });
});
