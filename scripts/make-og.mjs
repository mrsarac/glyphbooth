// Renders public/og.png (1200x630 share card) from build/og-bg.png, a screenshot of the app with the panel hidden.
import { chromium } from '@playwright/test';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { writeFileSync, rmSync } from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = (p) => pathToFileURL(resolve(root, p)).href;
const font = (w) => url(`node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-${w}-normal.woff2`);

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:JB;font-weight:400;src:url(${font(400)})}
@font-face{font-family:JB;font-weight:800;src:url(${font(800)})}
*{box-sizing:border-box;margin:0}
body{width:1200px;height:630px;background:#030605;font-family:JB,monospace;color:#d8ffe4;position:relative;overflow:hidden}
.bg{position:absolute;top:0;left:235px;width:1200px;height:630px;background:url(${url('build/og-bg.png')});filter:brightness(1.25) contrast(1.1)}
.fade{position:absolute;inset:0;background:linear-gradient(90deg,#030605 0,#030605 38%,rgba(3,6,5,.85) 52%,rgba(3,6,5,0) 78%),radial-gradient(ellipse at 100% 50%,transparent 60%,#030605 100%)}
.scan{position:absolute;inset:0;background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 2px,transparent 2px 4px)}
.frame{position:absolute;inset:22px;border:2px solid rgba(76,255,122,.35);border-radius:22px}
.txt{position:absolute;left:72px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center}
.tag{font-size:22px;letter-spacing:.28em;color:#4cff7a;opacity:.85;margin-bottom:26px}
h1{font-weight:800;font-size:104px;line-height:1;letter-spacing:-.02em;color:#6dff93;text-shadow:0 0 28px rgba(76,255,122,.65),0 0 3px #b8ffcb}
p{margin-top:30px;font-size:31px;line-height:1.35;color:#d8ffe4;max-width:600px}
.dom{position:absolute;left:72px;bottom:58px;font-size:26px;color:#4cff7a;letter-spacing:.04em}
.dom b{display:inline-block;width:14px;height:26px;background:#4cff7a;vertical-align:-4px;margin-left:8px}
</style>
<div class="bg"></div><div class="fade"></div><div class="scan"></div><div class="frame"></div>
<div class="txt"><div class="tag">ASCII  ·  DITHER  ·  BRAILLE</div><h1>GLYPHBOOTH</h1>
<p>Camera, screen, video and music as live ASCII art.</p></div>
<div class="dom">glyphbooth.mustafasarac.com<b></b></div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
// file:// page so the font and image files can load.
const tmp = resolve(root, 'build/.og.html');
writeFileSync(tmp, html);
await page.goto(pathToFileURL(tmp).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: resolve(root, 'public/og.png') });
await browser.close();
rmSync(tmp);
console.log('wrote public/og.png');
