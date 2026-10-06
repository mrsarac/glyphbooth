import { readFileSync, statSync } from "node:fs";
import { test as base, expect, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import type { Settings } from "../src/state";

declare global {
  interface Window {
    glyphbooth: {
      getSettings(): Settings;
      update(patch: Partial<Settings>): void;
      readonly frames: number;
      errors: string[];
    };
  }
}

const MODES = ["ascii", "dither", "halftone", "braille", "pixel"] as const;

// Every test collects console errors and uncaught exceptions, and must end with none, in the page's own error list too.
const test = base.extend<{ problems: string[] }>({
  problems: async ({ page }, use) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") problems.push(`console.error: ${msg.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    await use(problems);
    expect(problems, "console errors and page errors").toEqual([]);
    const appErrors = await page.evaluate(() => window.glyphbooth?.errors ?? []).catch(() => []);
    expect(appErrors, "window.glyphbooth.errors").toEqual([]);
  },
});

// `?quality=low` makes the app render at reduced resolution; without a GPU (CI) full-size frames take seconds.
async function start(page: Page, url = "/"): Promise<void> {
  await page.goto(url.replace(/^\/(?=[#]|$)/, "/?quality=low"));
  await expect(page.locator("#splash")).toBeVisible();
  await page.locator("#start").click();
  await expect(page.locator("body")).toHaveClass(/\bstarted\b/);
  await expect(page.locator("canvas#stage")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.glyphbooth.frames)).toBeGreaterThan(2);
}

const settings = (page: Page) => page.evaluate(() => window.glyphbooth.getSettings());

// Screenshots the canvas region and returns decoded pixels (RGBA).
async function canvasPixels(page: Page): Promise<PNG> {
  const buffer = await page.locator("canvas#stage").screenshot();
  return PNG.sync.read(buffer);
}

// Number of distinct colors and the standard deviation of luma over a sparse sample of pixels.
function stats(png: PNG): { colors: number; deviation: number } {
  const seen = new Set<number>();
  const lumas: number[] = [];
  for (let i = 0; i < png.data.length; i += 4 * 7) {
    const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
    seen.add((r << 16) | (g << 8) | b);
    lumas.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const mean = lumas.reduce((a, b) => a + b, 0) / lumas.length;
  const variance = lumas.reduce((a, b) => a + (b - mean) ** 2, 0) / lumas.length;
  return { colors: seen.size, deviation: Math.sqrt(variance) };
}

function differs(a: PNG, b: PNG): boolean {
  return a.width !== b.width || a.height !== b.height || !a.data.equals(b.data);
}

test.describe("Glyphbooth smoke", () => {
  test("loads cleanly, starts and renders frames", async ({ page, problems }) => {
    await page.goto("/?quality=low");
    await expect(page.locator("#splash")).toBeVisible();
    await expect(page.locator("#fatal")).toBeHidden();
    await page.locator("#start").click();
    await expect(page.locator("body")).toHaveClass(/\bstarted\b/);
    await expect(page.locator("#splash")).toBeHidden();
    await expect(page.locator(".panel")).toBeVisible();
    await expect(page.locator("#fatal")).toBeHidden();

    const before = await page.evaluate(() => window.glyphbooth.frames);
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => window.glyphbooth.frames);
    expect(after).toBeGreaterThan(before);
    expect(problems).toEqual([]);
  });

  test("every mode button sets the mode and draws a non-flat picture", async ({ page }) => {
    await start(page);
    const shots: Partial<Record<(typeof MODES)[number], PNG>> = {};
    for (const mode of MODES) {
      await page.locator(`[data-mode="${mode}"]`).click();
      await expect.poll(async () => (await settings(page)).mode).toBe(mode);
      // Let a couple of frames render in the new mode.
      const frames = await page.evaluate(() => window.glyphbooth.frames);
      await expect.poll(() => page.evaluate(() => window.glyphbooth.frames)).toBeGreaterThan(frames + 1);
      const png = await canvasPixels(page);
      const { colors, deviation } = stats(png);
      expect(colors, `${mode}: distinct colors`).toBeGreaterThan(3);
      expect(deviation, `${mode}: luma deviation`).toBeGreaterThan(3);
      shots[mode] = png;
    }
    // Different modes must not render identical pictures.
    for (let i = 1; i < MODES.length; i++) {
      expect(differs(shots[MODES[i - 1]]!, shots[MODES[i]]!), `${MODES[i - 1]} vs ${MODES[i]}`).toBe(true);
    }
  });

  test("keyboard shortcuts change settings", async ({ page }) => {
    await start(page);
    await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

    for (const [key, mode] of [["2", "dither"], ["3", "halftone"], ["4", "braille"], ["5", "pixel"], ["1", "ascii"]] as const) {
      await page.keyboard.press(key);
      await expect.poll(async () => (await settings(page)).mode, { message: `key ${key}` }).toBe(mode);
    }

    const palette = (await settings(page)).palette;
    await page.keyboard.press("p");
    await expect.poll(async () => (await settings(page)).palette).not.toBe(palette);

    const beforePreset = JSON.stringify(await settings(page));
    await page.keyboard.press("g");
    await expect.poll(async () => JSON.stringify(await settings(page))).not.toBe(beforePreset);

    const beforeRandom = await settings(page);
    await page.keyboard.press("r");
    await expect.poll(async () => JSON.stringify(await settings(page))).not.toBe(JSON.stringify(beforeRandom));

    await page.keyboard.press("n");
    await page.keyboard.press("h");
    await expect(page.locator("body")).toHaveClass(/panel-hidden/);
    await page.keyboard.press("h");
    await expect(page.locator("body")).not.toHaveClass(/panel-hidden/);
  });

  test("camera via C works with the fake device", async ({ page }) => {
    await start(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("c");
    await expect(page.locator('[data-source="camera"]')).toHaveAttribute("aria-pressed", "true", { timeout: 15_000 });
    const frames = await page.evaluate(() => window.glyphbooth.frames);
    await expect.poll(() => page.evaluate(() => window.glyphbooth.frames)).toBeGreaterThan(frames + 5);
    // Toggling again goes back to the scene.
    await page.keyboard.press("c");
    await expect(page.locator('[data-source="camera"]')).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator('[data-source="scene"]')).toHaveAttribute("aria-pressed", "true");
  });

  test("snapshot downloads a glyphbooth-*.png", async ({ page }) => {
    await start(page);
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.locator('[data-action="snapshot"]').click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^glyphbooth-.+\.png$/);
    const path = await download.path();
    const png = PNG.sync.read(readFileSync(path));
    expect(png.width).toBeGreaterThan(100);
    expect(png.height).toBeGreaterThan(100);
  });

  test("copy text puts a multi-line frame on the clipboard", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await start(page);
    await page.locator('[data-mode="ascii"]').click();
    await page.locator('[data-action="copy-text"]').click();
    await expect(page.locator("#toast")).not.toBeEmpty();
    await expect
      .poll(async () => (await page.evaluate(() => navigator.clipboard.readText())).split("\n").length)
      .toBeGreaterThan(5);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text.replace(/\s/g, "").length).toBeGreaterThan(20);
  });

  test("the URL hash is applied on load", async ({ page }) => {
    await start(page, "/#m=dither&p=gameboy");
    const s = await settings(page);
    expect(s.mode).toBe("dither");
    expect(s.palette).toBe("gameboy");
    await expect(page.locator('[data-mode="dither"]')).toHaveAttribute("aria-pressed", "true");
  });

  test("recording with V twice downloads a non-empty .webm", async ({ page }) => {
    await start(page);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press("v");
    await page.waitForTimeout(1500);
    const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("v")]);
    expect(download.suggestedFilename()).toMatch(/\.webm$/);
    const path = await download.path();
    expect(statSync(path).size).toBeGreaterThan(0);
  });

  test("dropping an image file switches the source to file", async ({ page }) => {
    await start(page);
    await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 96;
      const ctx = canvas.getContext("2d")!;
      const gradient = ctx.createLinearGradient(0, 0, 128, 96);
      gradient.addColorStop(0, "#000");
      gradient.addColorStop(1, "#fff");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 96);
      ctx.fillStyle = "#f00";
      ctx.fillRect(30, 20, 40, 40);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], "test.png", { type: "image/png" }));
      for (const type of ["dragenter", "dragover", "drop"]) {
        document.dispatchEvent(new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }
    });
    await expect(page.locator('[data-source="file"]')).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
    const frames = await page.evaluate(() => window.glyphbooth.frames);
    await expect.poll(() => page.evaluate(() => window.glyphbooth.frames)).toBeGreaterThan(frames + 2);
  });
});
