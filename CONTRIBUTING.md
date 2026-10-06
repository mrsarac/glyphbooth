# Contributing to Glyphbooth

Thanks for helping. Small, focused changes are easiest to review.

## Setup

You need Node.js 22 or newer.

```bash
git clone https://github.com/mrsarac/glyphbooth.git
cd glyphbooth
npm ci
npm run dev
```

## Before you open a pull request

1. Run the type check: `npm run typecheck`
2. Run the unit tests: `npm test`
3. Run the smoke tests: `npm run test:e2e` (first time: `npx playwright install chromium`)

All three must pass. CI runs the same steps.

## Rules

- **Keep shaders and `cells.frag` in sync.** `src/render/shaders/cells.frag` reads back one pixel per ASCII cell (tone and edge direction) so the text export matches the screen. If you change how `effect.frag` or `common.glsl` computes tone or edges, make the same change in `cells.frag`. `tests/dither.test.ts` checks some of this.
- **One change per pull request.** A bug fix, a feature or a refactor, not all three.
- **Use conventional commit messages**: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.
- **Add a test** for new pure logic (state, atlas, beat detection, dither, export). Put it in `tests/`.
- **Follow the surrounding style.** Match naming and comment density of the file you edit.
- **Keep the app local.** No network calls, no analytics, no uploads.

## Reporting a bug

Use the bug report template. Include your OS, whether you use the browser or the desktop app, your GPU, and the steps to reproduce.
