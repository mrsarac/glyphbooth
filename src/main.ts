// The app controller: owns the settings, runs the render loop and turns panel clicks, keys and dropped files into
// actions. Every action is guarded, so a refused camera or a blocked clipboard shows a message and the picture
// keeps going.

import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/800.css";
import "./styles.css";

import { AudioEngine } from "./audio/engine";
import {
  copyText,
  download,
  gridToHtml,
  gridToText,
  Recorder,
  timestamp,
} from "./export/capture";
import { FONT } from "./render/atlas";
import { Renderer } from "./render/renderer";
import { drawText, MediaSource } from "./sources/media";
import {
  applyPreset,
  clamp,
  DEFAULTS,
  fromHash,
  MODES,
  PALETTES,
  paletteById,
  PRESETS,
  randomize,
  sanitize,
  SCENES,
  toHash,
  type Scene,
  type Settings,
} from "./state";
import { detectLanguage, STRINGS, type Language } from "./ui/i18n";
import { Panel, type PanelActions, type PanelState } from "./ui/panel";

interface GlyphboothDebug {
  getSettings(): Settings;
  update(patch: Partial<Settings>): void;
  readonly frames: number;
  errors: string[];
}

declare global {
  interface Window {
    glyphbooth: GlyphboothDebug;
  }
}

const STORE_KEY = "glyphbooth.settings";
const LANG_KEY = "glyphbooth.lang";

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const canvas = byId<HTMLCanvasElement>("stage");
const splash = byId<HTMLElement>("splash");
const startButton = byId<HTMLButtonElement>("start");
const toastEl = byId<HTMLElement>("toast");
const fatalEl = byId<HTMLElement>("fatal");
const dropEl = byId<HTMLElement>("drop");
const showPanelButton = byId<HTMLButtonElement>("show-panel");

// --- Errors -------------------------------------------------------------------------------------------------------

const errors: string[] = [];

function reportError(error: unknown, log = true): void {
  const message = error instanceof Error ? error.message : String(error);
  // A broken frame would repeat 60 times a second; one entry is enough.
  if (errors.includes(message)) return;
  errors.push(message);
  if (log) console.error(error);
}

window.addEventListener("error", (event) =>
  reportError(event.error ?? event.message, false),
);
window.addEventListener("unhandledrejection", (event) =>
  reportError(event.reason, false),
);

// --- Settings and language ----------------------------------------------------------------------------------------

function loadSettings(): Settings {
  const shared = fromHash(location.hash);
  if (shared) return shared;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) return sanitize(JSON.parse(saved));
  } catch {
    // Private mode or broken JSON: start from the defaults.
  }
  return { ...DEFAULTS };
}

function loadLanguage(): Language {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "en" || saved === "tr") return saved;
  } catch {
    // Storage blocked: fall back to the browser language.
  }
  return detectLanguage(navigator.languages ?? [navigator.language]);
}

let settings = loadSettings();
const language = loadLanguage();
const t = STRINGS[language];
document.documentElement.lang = language;

let renderer: Renderer | null = null;
let engine: AudioEngine | null = null;
let media: MediaSource | null = null;
const recorder = new Recorder();
recorder.onError = (error) => {
  fail(t.recordFailed, error);
  sync();
};
const textCanvas = document.createElement("canvas");
let textDrawn: string | null = null;
let frames = 0;
let phase = 0;
let lastTime = -1;
let lastUi = 0;
let started = false;
let contextLost = false;
let pendingSnapshot = false;
let presetIndex = -1;
let panelHidden = false;
// Scenes are framed in the part of the screen the panel leaves free. `view` glides toward `viewTarget`, so the
// picture moves along with the panel as it slides in or out.
type View = [number, number, number, number];
const FULL_VIEW: View = [0.5, 0.5, 1, 1];
let viewTarget: View = [...FULL_VIEW];
const view: View = [...FULL_VIEW];

// --- Messages -----------------------------------------------------------------------------------------------------

let toastTimer = 0;
function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 2800);
}

// Expected failures (a refused permission, a blocked clipboard) are messages for the user, not runtime errors.
function fail(message: string, error: unknown): void {
  console.warn(message, error);
  toast(message);
}

function showFatal(message: string): void {
  fatalEl.textContent = message;
  fatalEl.hidden = false;
  splash.hidden = true;
  document.body.classList.add("fatal");
}

// --- Panel --------------------------------------------------------------------------------------------------------

const fileInput = document.createElement("input");
fileInput.type = "file";
fileInput.accept = "image/*,video/*,audio/*";
fileInput.hidden = true;
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = "";
  if (file) void openFile(file);
});
document.body.append(fileInput);

const actions: PanelActions = {
  update: (patch) => update(patch),
  scene: (scene) => useScene(scene),
  camera: () => void toggleCamera(),
  screen: () => void useScreen(),
  openFile: (file) => void openFile(file),
  demo() {
    if (!engine) return;
    if (engine.demo.playing) engine.demo.stop();
    else engine.demo.start();
    sync();
  },
  mic: () => void toggleMic(),
  volume(value) {
    if (engine) engine.volume = value;
  },
  // The drawing buffer is cleared after each frame, so the PNG is taken right after the next render.
  snapshot() {
    pendingSnapshot = true;
  },
  record: () => void toggleRecord(),
  copyText: () => void copyAscii(),
  saveHtml,
  copyLink: () => void copyLink(),
  random: () => update(randomize(settings)),
  preset(id) {
    const index = PRESETS.findIndex((preset) => preset.id === id);
    if (index < 0) return;
    presetIndex = index;
    settings = applyPreset(settings, PRESETS[index]);
    persist();
    sync();
    panel.showPreset(id);
  },
  hide: () => setPanelHidden(true),
  language(lang) {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Without storage the choice cannot survive the reload.
    }
    persist(true);
    location.reload();
  },
};

const panel = new Panel(t, actions, fileInput);
document.body.append(panel.root);

function panelState(): PanelState {
  return {
    settings,
    source: media?.kind ?? "scene",
    sourceLabel: media?.label ?? "",
    demo: engine?.demo.playing ?? false,
    mic: engine?.micOn ?? false,
    volume: engine?.volume ?? 0.8,
    recording: recorder.recording,
    recordSeconds: recorder.recording
      ? (performance.now() - recorder.startedAt) / 1000
      : 0,
    language,
  };
}

function sync(): void {
  panel.sync(panelState());
  document.body.classList.toggle("recording", recorder.recording);
}

let saveTimer = 0;
// Sliders fire many times a second; storage and history are written once they settle.
function persist(now = false): void {
  window.clearTimeout(saveTimer);
  const write = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(settings));
    } catch {
      // Storage full or blocked: the link in the address bar still holds the look.
    }
    try {
      const hash = toHash(settings);
      history.replaceState(
        null,
        "",
        hash ? `#${hash}` : location.pathname + location.search,
      );
    } catch {
      // Safari throttles replaceState; the next change writes it again.
    }
  };
  if (now) write();
  else saveTimer = window.setTimeout(write, 200);
}

function update(patch: Partial<Settings>): void {
  settings = sanitize({ ...settings, ...patch });
  panel.presetCleared();
  persist();
  sync();
}

// Uses the panel's layout box (offset*), which ignores the slide transform, so the target is where the panel ends up.
function updateView(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const box = panel.root;
  if (!started || panelHidden || width === 0 || height === 0) {
    viewTarget = [...FULL_VIEW];
    return;
  }
  const sheet = box.offsetLeft < 1 && box.offsetWidth >= width - 1;
  if (sheet) {
    // Bottom sheet: frame the scene in the strip above it. uv y grows upward.
    const free = clamp(box.offsetTop / height, 0.3, 1);
    viewTarget = [0.5, 1 - free / 2, 1, free];
  } else {
    const free = clamp(box.offsetLeft / width, 0.3, 1);
    viewTarget = [free / 2, 0.5, free, 1];
  }
}

function setPanelHidden(hidden: boolean): void {
  panelHidden = hidden;
  updateView();
  document.body.classList.toggle("panel-hidden", hidden);
  panel.root.toggleAttribute("inert", hidden);
  if (hidden && panel.root.contains(document.activeElement))
    showPanelButton.focus();
}

showPanelButton.addEventListener("click", () => setPanelHidden(false));

// A link pasted into the address bar of an open tab only changes the hash.
window.addEventListener("hashchange", () => {
  const shared = fromHash(location.hash);
  if (shared && toHash(shared) !== toHash(settings)) {
    settings = shared;
    panel.presetCleared();
    sync();
  }
});

// --- Sources ------------------------------------------------------------------------------------------------------

function useScene(scene: Scene): void {
  if (media && media.kind !== "scene") media.useScene();
  update({ scene });
}

// A second click while the permission prompt is open would start a second stream and leak the first.
let cameraPending = false;

async function toggleCamera(): Promise<void> {
  if (!media || cameraPending) return;
  if (media.kind === "camera") {
    media.useScene();
  } else {
    cameraPending = true;
    try {
      await media.useCamera();
    } catch (error) {
      fail(t.cameraFailed, error);
      media.useScene();
    } finally {
      cameraPending = false;
    }
  }
  sync();
}

async function useScreen(): Promise<void> {
  if (!media) return;
  try {
    await media.useScreen();
  } catch (error) {
    fail(t.screenFailed, error);
  }
  sync();
}

async function openFile(file: File): Promise<void> {
  if (!media || !engine) return;
  try {
    const kind = await media.useFile(file);
    // A song or a video brings its own sound; two tracks at once is noise.
    if (kind !== "image") engine.demo.stop();
  } catch (error) {
    // MediaSource keeps the current source when a file cannot be read, so the camera survives a HEIC drop.
    fail(t.fileFailed, error);
  }
  sync();
}

async function toggleMic(): Promise<void> {
  if (!engine) return;
  if (engine.micOn) {
    engine.stopMic();
  } else {
    try {
      await engine.startMic();
    } catch (error) {
      fail(t.micFailed, error);
    }
  }
  sync();
}

// --- Export -------------------------------------------------------------------------------------------------------

function takeSnapshot(): void {
  canvas.toBlob((blob) => {
    if (!blob) {
      reportError(new Error("PNG export returned no image"));
      return;
    }
    download(blob, `glyphbooth-${timestamp()}.png`);
    toast(t.saved);
  }, "image/png");
}

async function toggleRecord(): Promise<void> {
  if (!engine) return;
  if (recorder.recording) {
    try {
      const blob = await recorder.stop();
      if (blob) {
        // Safari only records MP4; keep the extension honest.
        const ext = blob.type.includes("mp4") ? "mp4" : "webm";
        download(blob, `glyphbooth-${timestamp()}.${ext}`);
        toast(t.saved);
      }
    } catch (error) {
      fail(t.recordFailed, error);
    }
  } else {
    try {
      recorder.start(canvas, engine.recordStream.stream);
      toast(t.recording);
    } catch (error) {
      fail(t.recordFailed, error);
    }
  }
  sync();
}

async function copyAscii(): Promise<void> {
  const grid = renderer?.readCells();
  if (!grid) return;
  try {
    await copyText(gridToText(grid));
    toast(`${t.copied} ${grid.cols}×${grid.rows}`);
  } catch (error) {
    fail(t.copyFailed, error);
  }
}

function saveHtml(): void {
  const grid = renderer?.readCells();
  if (!grid) return;
  const background = paletteById(settings.palette).colors[0];
  const html = gridToHtml(grid, background);
  download(
    new Blob([html], { type: "text/html" }),
    `glyphbooth-${timestamp()}.html`,
  );
  toast(t.saved);
}

// The desktop app runs from file://, which means nothing to anyone else; share the web demo with the same look.
const WEB_URL = "https://mrsarac.github.io/glyphbooth/";

async function copyLink(): Promise<void> {
  persist(true);
  const link =
    location.protocol === "file:"
      ? `${WEB_URL}#${toHash(settings)}`
      : location.href;
  try {
    await copyText(link);
    toast(t.linkCopied);
  } catch (error) {
    fail(t.copyFailed, error);
  }
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) {
    console.warn(error);
  }
}

// --- Keyboard -----------------------------------------------------------------------------------------------------

// Only letters and digits, so every shortcut works on a Turkish keyboard too.
function onKey(event: KeyboardEvent): void {
  if (!started || event.ctrlKey || event.metaKey || event.altKey) return;
  const target = event.target as HTMLElement | null;
  // Sliders and checkboxes have no use for letters; text fields and selects do.
  const typing =
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement &&
      target.type !== "range" &&
      target.type !== "checkbox") ||
    target?.isContentEditable;
  if (typing) return;

  if (event.key === "Escape") {
    if (panelHidden) setPanelHidden(false);
    return;
  }
  // Holding S or V must not save or toggle over and over.
  if (event.repeat) return;

  const key = event.key.toLowerCase();
  if (/^[1-5]$/.test(key)) {
    actions.update({ mode: MODES[Number(key) - 1] });
    event.preventDefault();
    return;
  }
  switch (key) {
    case "g":
      presetIndex = (presetIndex + 1) % PRESETS.length;
      actions.preset(PRESETS[presetIndex].id);
      break;
    case "p": {
      const index = PALETTES.findIndex((p) => p.id === settings.palette);
      actions.update({ palette: PALETTES[(index + 1) % PALETTES.length].id });
      break;
    }
    case "r":
      actions.random();
      break;
    case "n":
      actions.scene(
        SCENES[(SCENES.indexOf(settings.scene) + 1) % SCENES.length],
      );
      break;
    case "c":
      actions.camera();
      break;
    case "m":
      actions.mic();
      break;
    case "d":
      actions.demo();
      break;
    case "s":
      actions.snapshot();
      break;
    case "v":
      actions.record();
      break;
    case "t":
      actions.copyText();
      break;
    case "f":
      void toggleFullscreen();
      break;
    case "h":
      setPanelHidden(!panelHidden);
      break;
    default:
      return;
  }
  event.preventDefault();
}

window.addEventListener("keydown", onKey);

// Browsers may suspend audio (another tab took the device, the tab slept); any gesture or return wakes it.
const resumeAudio = () => void engine?.resume().catch(() => {});
window.addEventListener("pointerdown", resumeAudio);
window.addEventListener("keydown", resumeAudio);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") resumeAudio();
});

// --- Drag and drop ------------------------------------------------------------------------------------------------

let dragDepth = 0;
const carriesFiles = (event: DragEvent) =>
  Array.from(event.dataTransfer?.types ?? []).includes("Files");

window.addEventListener("dragenter", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  if (started) dropEl.hidden = false;
});
window.addEventListener("dragover", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = started ? "copy" : "none";
});
window.addEventListener("dragleave", (event) => {
  if (!carriesFiles(event)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dropEl.hidden = true;
});
// Without preventDefault the browser would navigate away to the dropped file.
window.addEventListener("drop", (event) => {
  if (!carriesFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  dropEl.hidden = true;
  const file = event.dataTransfer?.files[0];
  if (file && started) void openFile(file);
});

// With the panel hidden the picture is a performance; a resting mouse pointer goes away. Touch never hides the
// show-panel button, because a phone has no H key to bring the panel back.
let idleTimer = 0;
const wake = (event: PointerEvent) => {
  document.body.classList.remove("idle");
  window.clearTimeout(idleTimer);
  if (event.pointerType !== "mouse") return;
  idleTimer = window.setTimeout(
    () => document.body.classList.add("idle"),
    2500,
  );
};
window.addEventListener("pointermove", wake, { passive: true });
window.addEventListener("pointerdown", wake, { passive: true });

// --- Renderer -----------------------------------------------------------------------------------------------------

// `?quality=low` renders at a fraction of the screen resolution. The end-to-end tests use it on CI machines without a
// GPU, where software WebGL needs seconds per full-size frame. The canvas keeps its CSS size, so the picture just softens.
const lowQuality = new URLSearchParams(location.search).get("quality") === "low";

function resize(): void {
  updateView();
  if (!renderer) return;
  const dpr = lowQuality ? 0.3 : Math.min(window.devicePixelRatio || 1, 2);
  try {
    renderer.resize(canvas.clientWidth * dpr, canvas.clientHeight * dpr);
  } catch (error) {
    // The old targets are still in place, so the picture keeps its previous size.
    reportError(error);
  }
}

function createRenderer(): boolean {
  try {
    renderer = new Renderer(canvas);
  } catch (error) {
    renderer = null;
    if (!(error instanceof Error && error.message.includes("WebGL2")))
      reportError(error);
    showFatal(t.noWebgl);
    return false;
  }
  resize();
  return true;
}

new ResizeObserver(resize).observe(canvas);
window.addEventListener("resize", resize);

canvas.addEventListener("webglcontextlost", (event) => {
  // Tells the browser we want the context back.
  event.preventDefault();
  contextLost = true;
});
canvas.addEventListener("webglcontextrestored", () => {
  contextLost = false;
  // Every texture, program and target died with the old context.
  if (createRenderer()) textDrawn = null;
});

function loop(now: number): void {
  requestAnimationFrame(loop);
  const time = now / 1000;
  const dt = lastTime < 0 ? 1 / 60 : clamp(time - lastTime, 0, 0.1);
  lastTime = time;
  if (!renderer || !engine || !media || contextLost) return;
  try {
    const audio = engine.update(dt, time);
    phase += dt * (0.6 + audio.level * 2 * settings.reactivity);
    const glide = 1 - Math.exp(-dt / 0.14);
    for (let i = 0; i < 4; i++) view[i] += (viewTarget[i] - view[i]) * glide;
    if (settings.text !== textDrawn) {
      drawText(textCanvas, settings.text, FONT);
      textDrawn = settings.text;
    }
    renderer.render({
      settings,
      time,
      phase,
      audio,
      media: media.input,
      mirror: media.mirrored && settings.mirror,
      textCanvas,
      view,
    });
    frames++;
    if (pendingSnapshot) {
      pendingSnapshot = false;
      takeSnapshot();
    }
    if (time - lastUi >= 0.1) {
      lastUi = time;
      panel.meter(audio.bass, audio.mid, audio.treble);
      if (recorder.recording) sync();
    }
  } catch (error) {
    reportError(error);
  }
}

// The atlas and the text canvas are drawn with JetBrains Mono; until it loads they would use a fallback font.
// Turkish letters (Ş Ğ İ ı) live in a separate subset file, which only loads when asked for by its characters.
const fontsReady = Promise.race([
  Promise.all([
    document.fonts.load('500 56px "JetBrains Mono"'),
    document.fonts.load('800 56px "JetBrains Mono"'),
    document.fonts.load('800 56px "JetBrains Mono"', "ŞĞİıÇÖÜ"),
  ]),
  new Promise((resolve) => window.setTimeout(resolve, 4000)),
]);
void fontsReady
  .catch((error) => console.warn(error))
  .then(() => {
    renderer?.invalidateAtlas();
    textDrawn = null;
  });

// Any subset that arrives later (a Turkish letter typed into the text scene) redraws the glyphs with it.
document.fonts.addEventListener("loadingdone", () => {
  renderer?.invalidateAtlas();
  textDrawn = null;
});

// --- Start --------------------------------------------------------------------------------------------------------

function start(): void {
  if (started || !renderer) return;
  try {
    // Created inside the click: browsers only allow sound after a gesture.
    engine = new AudioEngine();
    media = new MediaSource(engine);
  } catch (error) {
    reportError(error);
    return;
  }
  started = true;
  startButton.disabled = true;
  media.onEnded = sync;
  engine.resume().catch((error) => console.warn(error));
  engine.demo.start();
  document.body.classList.add("started");
  updateView();
  window.setTimeout(() => (splash.hidden = true), 700);
  sync();
  requestAnimationFrame(loop);
}

// The splash wordmark: block characters arrive as noise and settle, left to right.
function animateWordmark(pre: HTMLElement): void {
  const lines = (pre.textContent ?? "").split("\n");
  const width = Math.max(...lines.map((line) => line.length));
  const noise = ".:-=+*#%@";
  const settle = lines.map((line) =>
    Array.from(line, (_, x) => (x / width) * 0.75 + Math.random() * 0.4),
  );
  const paint = (elapsed: number) => {
    pre.innerHTML = lines
      .map((line, y) => {
        let html = "";
        let run = "";
        let runTag = "";
        Array.from(line).forEach((char, x) => {
          // b: the solid letter, i: its drop shadow outline.
          const tag = char === "█" ? "b" : char === " " ? "" : "i";
          const shown =
            tag === "b" && elapsed < settle[y][x]
              ? noise[Math.floor(Math.random() * noise.length)]
              : char;
          if (tag !== runTag && run) {
            html += runTag ? `<${runTag}>${run}</${runTag}>` : run;
            run = "";
          }
          runTag = tag;
          run += shown;
        });
        if (run) html += runTag ? `<${runTag}>${run}</${runTag}>` : run;
        return html;
      })
      .join("\n");
  };
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
    paint(Infinity);
    return;
  }
  const t0 = performance.now();
  const step = (now: number) => {
    const elapsed = (now - t0) / 1000;
    paint(elapsed);
    if (elapsed < 1.2 && !started) requestAnimationFrame(step);
    else paint(Infinity);
  };
  requestAnimationFrame(step);
}

function boot(): void {
  byId("tagline").textContent = t.tagline;
  byId("start-label").textContent = t.start;
  byId("start-hint").textContent = t.startHint;
  byId("drop-label").textContent = t.dropHere;
  showPanelButton.setAttribute("aria-label", t.showPanel);
  showPanelButton.title = t.showPanel;
  sync();
  animateWordmark(splash.querySelector(".wordmark") as HTMLElement);
  if (!createRenderer()) return;
  startButton.disabled = false;
  startButton.addEventListener("click", start);
  startButton.focus();
}

window.glyphbooth = {
  getSettings: () => ({ ...settings }),
  update: (patch) => update(patch),
  get frames() {
    return frames;
  },
  errors,
};

boot();
