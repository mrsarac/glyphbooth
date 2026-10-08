# Glyphbooth

Turn your camera, screen, video and music into live ASCII, dither, halftone, braille and pixel art, in the browser or as a desktop app.

[![License: MIT](https://img.shields.io/github/license/mrsarac/glyphbooth)](LICENSE)
[![Release](https://img.shields.io/github/v/release/mrsarac/glyphbooth)](https://github.com/mrsarac/glyphbooth/releases/latest)

English | [Türkçe](README.tr.md)

<p align="center"><img src="docs/media/hero.png" alt="Glyphbooth turning an animated orb into green ASCII art" width="860"></p>

**Live demo:** [glyphbooth.mustafasarac.com](https://glyphbooth.mustafasarac.com/)

## Why

Text-mode and dithered visuals are fun to play with, and Glyphbooth makes them live: point it at your webcam, your screen, a video, an image, a word you type, or a song, and it redraws the picture as characters, dots or pixels that move with the beat. It runs entirely on your computer, with plain WebGL2 shaders and no account.

## Quick start

**In the browser:** open [glyphbooth.mustafasarac.com](https://glyphbooth.mustafasarac.com/) and press **Start**. A scene and a built-in beat play at once. No permission is asked until you press `C` (camera) or `M` (microphone).

**Desktop app:** download the latest file from [Releases](https://github.com/mrsarac/glyphbooth/releases/latest).

| System | File |
|---|---|
| macOS, Apple Silicon (M1 and newer) | `Glyphbooth-<version>-mac-arm64.dmg` |
| macOS, Intel | `Glyphbooth-<version>-mac-x64.dmg` |
| Windows 10 and newer, 64-bit | `Glyphbooth-<version>-win-x64.exe` |
| Linux, 64-bit | `Glyphbooth-<version>-linux-x86_64.AppImage` |

The macOS app is not notarized by Apple yet, so the first launch needs one extra step. See [First launch on macOS](#first-launch-on-macos).

**From source:** you need Node.js 22 or newer and a browser or GPU with WebGL2.

```bash
git clone https://github.com/mrsarac/glyphbooth.git
cd glyphbooth
npm ci
npm run dev        # web app with hot reload
npm run app        # build, then open in Electron
```

<p align="center"><img src="docs/media/demo.gif" alt="Glyphbooth cycling through five looks" width="800"></p>

## Features

**Sources**
- Camera, screen capture, video files, images, typed text, or a built-in animated scene (orb, tunnel, flow, spectrum, type).
- Drag and drop an image, video or song onto the window.

**Looks**
- Five modes: ASCII, dither, halftone, braille and pixel.
- 12 presets, 11 palettes and 6 character sets, including your own characters.
- ASCII edge lines: strokes follow the edges of the picture with `| / - \`.
- Bayer grid or blue-noise dithering.
- Tuning: size, brightness, contrast, scanlines, grain, glitch, invert, mirror.

**Sound**
- Beat detection drives zoom, color split and flash. Set how strongly the picture reacts.
- Sound comes from a built-in demo track, the microphone or an audio file.

**Share**
- Save a PNG.
- Record video with sound (WebM; Safari records MP4).
- Copy the picture as plain-text ASCII to the clipboard.
- Save the picture as colored HTML.
- Copy a link that holds your whole look in the URL.

The interface is in English or Turkish, chosen from your browser language.

<p align="center"><img src="docs/media/modes.png" alt="Six looks in a 3 by 2 grid: Terminal, Game Boy, Newsprint, Braille ghost, LED wall and Pen sketch" width="860"></p>

## Keyboard shortcuts

Every shortcut is a letter or a digit, so they work on any keyboard layout.

| Key | Action |
|---|---|
| `1` to `5` | Mode: ASCII, Dither, Halftone, Braille, Pixel |
| `G` | Next preset |
| `P` | Next palette |
| `R` | Surprise me (random look) |
| `N` | Next scene |
| `C` | Camera |
| `M` | Microphone |
| `D` | Demo beat on or off |
| `S` | Save PNG |
| `V` | Start or stop video recording |
| `T` | Copy as text |
| `F` | Full screen |
| `H` | Hide or show the panel |

## How it works

Glyphbooth uses raw WebGL2 shaders and no graphics library. Each frame has three passes, plus an optional read-back for text export.

```mermaid
flowchart LR
    A[Camera / screen / video /<br/>image / text / scene] --> B[Source pass<br/>texture + mipmaps]
    B --> C[Effect pass<br/>ASCII, dither, halftone,<br/>braille, pixel]
    C --> D[Post pass<br/>color split, scanlines,<br/>grain, beat flash]
    D --> E[Screen / PNG / video]
    B --> F[cells.frag<br/>one pixel per cell]
    F --> G[Plain text / colored HTML]
    H[Audio: demo track,<br/>mic or file] --> I[Beat detection] --> D
```

1. **Source pass** ([`source.frag`](src/render/shaders/source.frag)) draws the camera, video, image or scene into a texture, then builds mipmaps. The mipmaps give the average color of any cell in one texture read.
2. **Effect pass** ([`effect.frag`](src/render/shaders/effect.frag)) turns the source into the chosen mode.
3. **Post pass** ([`post.frag`](src/render/shaders/post.frag)) adds color split, scanlines, grain, vignette and the beat flash.

Details behind the modes:

- **Glyph atlas** ([`atlas.ts`](src/render/atlas.ts)). Every character of the set is drawn once with JetBrains Mono, then sorted by how much ink it covers. A 256-entry lookup table maps a cell's brightness to the glyph with the closest coverage.
- **Edge glyphs.** A Sobel filter finds the edge direction in each cell. The shader then picks `|`, `/`, `-` or `\`.
- **Dither.** An 8×8 Bayer matrix or interleaved gradient noise sets the threshold. The result snaps to the nearest palette color.
- **Beat detection** ([`beat.ts`](src/audio/beat.ts)). Spectral flux of the audio, compared with its recent average, marks a beat.
- **Demo track** ([`synth.ts`](src/audio/synth.ts)). Drums and bass are synthesized with the Web Audio API. There is no audio file and no copyright question.
- **Text export** ([`capture.ts`](src/export/capture.ts)). [`cells.frag`](src/render/shaders/cells.frag) writes one pixel per cell. The CPU reads them back and rebuilds the same characters as plain text or colored HTML.
- **State.** All settings are one plain object in [`state.ts`](src/state.ts). It is saved in local storage and written into the URL hash, so a look can be shared as a link.

The design notes (in Turkish) are in [`docs/PLAN.tr.md`](docs/PLAN.tr.md).

## First launch on macOS

The `.dmg` is ad-hoc signed and not notarized by Apple. macOS blocks the first launch. Choose one of the two ways to open it.

**Way 1: System Settings**

1. Open the `.dmg` and drag **Glyphbooth** into **Applications**.
2. Open **Glyphbooth** once. macOS shows a warning. Click **Done**.
3. Open **System Settings → Privacy & Security**. Scroll down to **Security**.
4. Click **Open Anyway** next to "Glyphbooth was blocked", then confirm with your password.

**Way 2: Terminal**

1. Drag **Glyphbooth** into **Applications**.
2. Run this command:
   ```bash
   xattr -dr com.apple.quarantine /Applications/Glyphbooth.app
   ```
3. Open **Glyphbooth** as usual.

**Camera, microphone and screen**

- macOS asks for permission the first time you use each source. Click **Allow**.
- If you clicked **Don't Allow**, open **System Settings → Privacy & Security**, pick **Camera**, **Microphone** or **Screen Recording**, and turn on **Glyphbooth**. Then restart the app.
- Screen capture on macOS has no system audio. Use the microphone, a file or the demo beat.

## First launch on Windows

Windows SmartScreen may warn about an unknown publisher.

1. Click **More info**.
2. Click **Run anyway**.

Screen capture on Windows includes system sound.

## First launch on Linux

1. Make the file executable: `chmod +x Glyphbooth-*-linux-x86_64.AppImage`
2. Run it: `./Glyphbooth-*-linux-x86_64.AppImage`

If it does not start, install FUSE 2: `sudo apt install libfuse2t64` on Ubuntu 24.04, or `sudo apt install libfuse2` on Ubuntu 22.04.

Ubuntu 24.04 restricts the Chromium sandbox with AppArmor. If the app aborts with a SUID sandbox message, run it with `--no-sandbox`:

```bash
./Glyphbooth-*-linux-x86_64.AppImage --no-sandbox
```

## Privacy

Everything runs on your computer. The app makes no network requests: camera frames, microphone sound and your files are never uploaded. There is no analytics and no account. Your settings stay in your browser's local storage. A shared link holds only look settings, never media.

## Development

Run the checks (CI runs the same steps):

```bash
npm run typecheck
npm test            # unit tests (Vitest)
npm run test:e2e    # smoke tests in Chromium with a fake camera (Playwright)
```

The e2e tests need a browser once: `npx playwright install chromium`.

Build installers (the file lands in `release/`; build each one on its own platform):

```bash
npm run dist:mac
npm run dist:win
npm run dist:linux
```

Regenerate the images in this README (needs `npm run build` first and ffmpeg):

```bash
node scripts/capture-media.mjs
```

## Status / limits

Glyphbooth is an early release (v0.1). It works, but expect rough edges.

- **WebGL2 required.** Browsers or GPUs without WebGL2 are not supported.
- **macOS builds are not notarized** by Apple yet; the first launch needs the steps above. Windows builds are not code-signed, so SmartScreen may warn.
- **No system audio on macOS** screen capture.
- **Recording format depends on the browser:** WebM in most browsers, MP4 in Safari.
- **Automated tests cover Chromium only.** The e2e smoke tests run in Chromium; other browsers have no automated coverage.

Ideas for later versions. None of these ship yet:

- macOS system audio capture (ScreenCaptureKit).
- GIF export.
- MIDI controller support for live performance.
- Face detection, so glyph density can focus on the face.
- Terminal mode: print the same output with `glyphbooth --tty`.

## Contributing

Bug reports and small pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Credits

- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) by JetBrains, under the SIL Open Font License 1.1. It ships with the app through [`@fontsource/jetbrains-mono`](https://fontsource.org/fonts/jetbrains-mono).
- Inspired by *Visualizer* by Luis Bizarro, an audio-reactive particle visualizer with ink and ASCII modes. Glyphbooth shares no code with it.

## License

[MIT](LICENSE) © 2026 Mustafa Saraç
