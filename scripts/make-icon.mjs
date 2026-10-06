// Renders build/icon.svg to build/icon.png (1024x1024, transparent corners).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(resolve(root, 'build/icon.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(
  `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`,
);
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(root, 'build/icon.png'), omitBackground: true });
await browser.close();
console.log('wrote build/icon.png');
