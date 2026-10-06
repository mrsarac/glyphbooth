// Produces the README images: docs/media/hero.png, docs/media/modes.png and docs/media/demo.gif.
// Run `npm run build` first, then `node scripts/capture-media.mjs`. Needs ffmpeg (FFMPEG env var or /opt/homebrew/bin/ffmpeg).
import { spawn, execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "docs", "media");
const PORT = 4174;
const URL = `http://localhost:${PORT}/`;
const FFMPEG = process.env.FFMPEG || "/opt/homebrew/bin/ffmpeg";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERO = {
  mode: "ascii",
  palette: "phosphor",
  charset: "detailed",
  scene: "orb",
  edges: true,
  size: 0.24,
  scanlines: 0.35,
  grain: 0.15,
  glitch: 0.5,
};

// Preset ids and settings come from src/state.ts.
const MODE_SHOTS = [
  { label: "Terminal / ASCII / orb", patch: { preset: "terminal", scene: "orb" } },
  { label: "Game Boy / dither / flow", patch: { preset: "gameboy", scene: "flow" } },
  { label: "Newsprint / halftone / orb", patch: { preset: "newsprint", scene: "orb" } },
  { label: "Braille ghost / braille / tunnel", patch: { preset: "braille", scene: "tunnel" } },
  { label: "LED wall / pixel / spectrum", patch: { preset: "led", scene: "spectrum" } },
  { label: "Pen sketch / ASCII / type", patch: { preset: "sketch", scene: "type", text: "GLYPH" } },
];

const GIF_LOOKS = [
  { preset: "terminal", scene: "orb" },
  { preset: "gameboy", scene: "flow" },
  { preset: "pop", scene: "orb" },
  { preset: "braille", scene: "tunnel" },
  { preset: "led", scene: "spectrum" },
];

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(URL)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`Preview server did not start on port ${PORT}. Did you run "npm run build"?`);
}

// The built bundle does not export PRESETS, so the array literal is read from src/state.ts and evaluated here.
async function loadPresets() {
  const source = readFileSync(join(root, "src", "state.ts"), "utf8");
  const start = source.indexOf("export const PRESETS");
  const end = source.indexOf("\n];", start);
  const body = source.slice(start, end + 3).replace(/^export const PRESETS: Preset\[\] =/, "const PRESETS =");
  const presets = new Function(`${body}; return PRESETS;`)();
  return Object.fromEntries(presets.map((p) => [p.id, p.settings]));
}

async function main() {
  const presets = await loadPresets();
  const resolvePatch = ({ preset, ...rest }) => ({ ...(preset ? presets[preset] : {}), ...rest });

  mkdirSync(outDir, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "glyphbooth-media-"));
  const server = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], {
    cwd: root,
    stdio: "ignore",
    detached: true,
  });
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({
      args: [
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const context = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      permissions: ["camera", "microphone"],
    });
    const page = await context.newPage();
    await page.goto(URL);
    await page.locator("#start:not([disabled])").click();
    await sleep(2500);

    const update = (patch) => page.evaluate((p) => window.glyphbooth.update(p), resolvePatch(patch));
    const setPanel = async (hidden) => {
      const isHidden = await page.evaluate(() => document.body.classList.contains("panel-hidden"));
      if (isHidden !== hidden) {
        await page.keyboard.press("h");
        await sleep(400);
      }
    };

    // (a) Hero: panel visible.
    await setPanel(false);
    await update(HERO);
    await sleep(1500);
    await page.screenshot({ path: join(outDir, "hero.png") });
    console.log("hero.png done");

    // (b) Modes: six screenshots, panel hidden, composed into a grid.
    await setPanel(true);
    const shots = [];
    for (const shot of MODE_SHOTS) {
      await update({ ...shot.patch, mirror: false });
      await sleep(1600);
      const buffer = await page.screenshot({ type: "png" });
      shots.push({ label: shot.label, url: `data:image/png;base64,${buffer.toString("base64")}` });
    }
    const grid = await context.newPage();
    await grid.setViewportSize({ width: 1600, height: 600 });
    const cells = shots
      .map((s) => `<figure><img src="${s.url}"><figcaption>${s.label}</figcaption></figure>`)
      .join("");
    await grid.setContent(`<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;background:#0b0b0d}
      .grid{display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(2,1fr);gap:4px;width:1600px;height:600px}
      figure{margin:0;position:relative;overflow:hidden}
      img{width:100%;height:100%;object-fit:cover;display:block}
      figcaption{position:absolute;left:10px;bottom:10px;padding:3px 8px;font:600 13px ui-monospace,Menlo,monospace;
        color:#fff;background:rgba(0,0,0,.65);border-radius:3px}
    </style><div class="grid">${cells}</div>`);
    await grid.waitForFunction(() => [...document.images].every((i) => i.complete));
    await grid.screenshot({ path: join(outDir, "modes.png") });
    await grid.close();
    console.log("modes.png done");

    // (c) GIF: ~6 s at ~12 fps, a new look every ~1.2 s.
    // A smaller viewport keeps software-rendered screenshots fast and the GIF small.
    await page.setViewportSize({ width: 960, height: 540 });
    await sleep(800);
    const FPS = 12;
    const DURATION = 6000;
    const LOOK_MS = 1200;
    const frameDir = join(tmp, "frames");
    mkdirSync(frameDir);
    // Time-based, so the clip lasts ~6 s even when software rendering captures fewer than 12 frames per second.
    const startedAt = Date.now();
    let look = -1;
    let count = 0;
    for (let elapsed = 0; elapsed < DURATION; elapsed = Date.now() - startedAt) {
      const index = Math.min(GIF_LOOKS.length - 1, Math.floor(elapsed / LOOK_MS));
      if (index !== look) {
        look = index;
        await update({ ...GIF_LOOKS[index], mirror: false, grain: 0 });
      }
      await page.screenshot({ path: join(frameDir, `f${String(count++).padStart(3, "0")}.jpg`), type: "jpeg", quality: 90 });
      const due = startedAt + (count * 1000) / FPS;
      if (Date.now() < due) await sleep(due - Date.now());
    }
    const realFps = Math.min(FPS, count / ((Date.now() - startedAt) / 1000)).toFixed(2);
    const gif = join(outDir, "demo.gif");
    execFileSync(
      FFMPEG,
      [
        "-y", "-loglevel", "error",
        "-framerate", realFps,
        "-i", join(frameDir, "f%03d.jpg"),
        "-vf", "scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle",
        "-loop", "0",
        gif,
      ],
      { stdio: "inherit" },
    );
    console.log(`demo.gif done (${(statSync(gif).size / 1048576).toFixed(1)} MB, ${realFps} fps)`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    try {
      process.kill(-server.pid, "SIGTERM"); // npx starts vite as a child, so stop the whole group
    } catch {
      server.kill("SIGTERM");
    }
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
