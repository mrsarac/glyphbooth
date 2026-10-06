import { describe, it, expect } from "vitest";
import { gridToHtml, gridToText, pickVideoType, timestamp } from "../src/export/capture";
import type { CellGrid } from "../src/render/renderer";

function grid(rows: string[], color: [number, number, number] | ((i: number) => [number, number, number]) = [255, 255, 255]): CellGrid {
  const cols = rows[0].length;
  const chars = Array.from(rows.join(""));
  const colors = new Uint8Array(chars.length * 3);
  chars.forEach((_, i) => {
    const [r, g, b] = typeof color === "function" ? color(i) : color;
    colors.set([r, g, b], i * 3);
  });
  return { cols, rows: rows.length, chars, colors };
}

describe("gridToText", () => {
  it("joins rows with newlines", () => {
    expect(gridToText(grid(["ab", "cd"]))).toBe("ab\ncd");
  });

  it("trims trailing spaces but keeps leading ones", () => {
    expect(gridToText(grid(["a  ", "  b", "   "]))).toBe("a\n  b\n");
  });

  it("handles a single-row grid and an empty grid", () => {
    expect(gridToText(grid(["xyz"]))).toBe("xyz");
    expect(gridToText({ cols: 0, rows: 0, chars: [], colors: new Uint8Array(0) })).toBe("");
  });

  it("keeps multi-codepoint glyphs such as block characters", () => {
    expect(gridToText(grid(["░▒▓█"]))).toBe("░▒▓█");
  });
});

describe("gridToHtml", () => {
  it("escapes <, >, & and double quotes in characters", () => {
    const html = gridToHtml(grid(['<>&"']), "#000");
    expect(html).toContain("&lt;&gt;&amp;&quot;");
    expect(html).not.toContain("<>&");
  });

  // BUG src/export/capture.ts: escapeHtml compares a whole string with single characters (`char === "<"`), so the
  // `<title>` is never escaped. Harmless with the default title, but wrong for any other. Remove `.fails` after the fix.
  it("escapes the title", () => {
    const html = gridToHtml(grid(["a"]), "#000", "<b>x</b>");
    expect(html).toContain("<title>&lt;b&gt;x&lt;/b&gt;</title>");
  });

  it("merges runs of the same color into one span", () => {
    const html = gridToHtml(grid(["abcd"]), "#000");
    expect(html.match(/<span /g)).toHaveLength(1);
    expect(html).toContain(">abcd</span>");
  });

  it("starts a new span when the color changes", () => {
    const html = gridToHtml(
      grid(["abcd"], (i) => (i < 2 ? [255, 0, 0] : [0, 0, 255])),
      "#000",
    );
    expect(html.match(/<span /g)).toHaveLength(2);
    expect(html).toContain('<span style="color:#ff0000">ab</span>');
    expect(html).toContain('<span style="color:#0000ff">cd</span>');
  });

  it("normalises dim colors up to full brightness of their hue", () => {
    const html = gridToHtml(grid(["a"], [50, 25, 0]), "#000");
    expect(html).toContain("color:#ff8000");
  });

  it("does not divide by zero for black cells", () => {
    const html = gridToHtml(grid(["a"], [0, 0, 0]), "#000");
    expect(html).toContain("color:#000000");
    expect(html).not.toContain("NaN");
  });

  it("contains the background color and a pre block with one line per row", () => {
    const html = gridToHtml(grid(["ab", "cd"]), "#123456");
    expect(html).toContain("background:#123456");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    const pre = /<pre>([\s\S]*?)<\/pre>/.exec(html)?.[1] ?? "";
    expect(pre.split("\n")).toHaveLength(2);
  });

  it("does not leave a stray span for an empty grid", () => {
    const html = gridToHtml({ cols: 0, rows: 0, chars: [], colors: new Uint8Array(0) }, "#000");
    expect(html).not.toContain("<span");
  });
});

describe("pickVideoType", () => {
  it("prefers VP9 + Opus WebM when everything is supported", () => {
    expect(pickVideoType(() => true)).toBe("video/webm;codecs=vp9,opus");
  });

  it("falls back down the list", () => {
    expect(pickVideoType((t) => t !== "video/webm;codecs=vp9,opus")).toBe("video/webm;codecs=vp8,opus");
    expect(pickVideoType((t) => t === "video/webm")).toBe("video/webm");
    expect(pickVideoType((t) => t.startsWith("video/mp4"))).toBe("video/mp4;codecs=avc1,mp4a");
    expect(pickVideoType((t) => t === "video/mp4")).toBe("video/mp4");
  });

  it("prefers WebM over MP4", () => {
    expect(pickVideoType((t) => t === "video/webm" || t === "video/mp4")).toBe("video/webm");
  });

  it("returns null when nothing is supported", () => {
    expect(pickVideoType(() => false)).toBeNull();
  });
});

describe("timestamp", () => {
  it("formats as YYYYMMDD-HHMMSS in local time", () => {
    expect(timestamp(new Date(2026, 9, 6, 14, 5, 9))).toBe("20261006-140509");
  });

  it("zero-pads every field", () => {
    expect(timestamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("20260102-030405");
  });

  it("defaults to the current time with the right shape", () => {
    expect(timestamp()).toMatch(/^\d{8}-\d{6}$/);
  });
});
