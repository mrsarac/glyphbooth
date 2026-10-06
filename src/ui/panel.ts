// The control panel. Built once; `sync()` writes the current state back into the controls after any change, so
// keyboard shortcuts, presets and the panel never disagree.

import {
  CHARSETS,
  DITHERS,
  MODES,
  PALETTES,
  PRESETS,
  SCENES,
  type Mode,
  type Scene,
  type Settings,
} from "../state";
import type { SourceKind } from "../sources/media";
import type { Language, Strings } from "./i18n";

export interface PanelState {
  settings: Settings;
  source: SourceKind;
  sourceLabel: string;
  demo: boolean;
  mic: boolean;
  volume: number;
  recording: boolean;
  recordSeconds: number;
  language: Language;
}

export interface PanelActions {
  update(patch: Partial<Settings>): void;
  scene(scene: Scene): void;
  camera(): void;
  screen(): void;
  openFile(file: File): void;
  demo(): void;
  mic(): void;
  volume(value: number): void;
  snapshot(): void;
  record(): void;
  copyText(): void;
  saveHtml(): void;
  copyLink(): void;
  random(): void;
  preset(id: string): void;
  hide(): void;
  language(lang: Language): void;
}

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "className") {
      el.className = String(value);
    } else if (key in el && typeof value !== "string") {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

interface Slider {
  key: keyof Settings;
  input: HTMLInputElement;
  output: HTMLOutputElement;
  format: (value: number) => string;
}

export class Panel {
  readonly root: HTMLElement;
  private sliders: Slider[] = [];
  private modeButtons = new Map<Mode, HTMLButtonElement>();
  private sourceButtons = new Map<string, HTMLButtonElement>();
  private paletteButtons = new Map<string, HTMLButtonElement>();
  private refs: Record<string, HTMLElement> = {};

  constructor(
    private readonly t: Strings,
    private readonly actions: PanelActions,
    private readonly fileInput: HTMLInputElement,
  ) {
    this.root = this.build();
  }

  private section(title: string, ...children: Child[]): HTMLElement {
    return h(
      "section",
      { className: "section" },
      h("h2", {}, title),
      ...children,
    );
  }

  private slider(
    key: keyof Settings,
    label: string,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
  ): HTMLElement {
    const input = h("input", {
      type: "range",
      min: String(min),
      max: String(max),
      step: String(step),
      "aria-label": label,
    });
    const output = h("output", {});
    input.addEventListener("input", () =>
      this.actions.update({ [key]: Number(input.value) } as Partial<Settings>),
    );
    this.sliders.push({ key, input, output, format });
    return h(
      "label",
      { className: "slider" },
      h("span", { className: "slider-head" }, h("span", {}, label), output),
      input,
    );
  }

  private build(): HTMLElement {
    const t = this.t;
    const percent = (v: number) => `${Math.round(v * 100)}%`;
    const signed = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`;

    const sceneSelect = h(
      "select",
      {
        "aria-label": t.scene,
        onChange: () => this.actions.scene(sceneSelect.value as Scene),
      },
      ...SCENES.map((scene) => h("option", { value: scene }, t.scenes[scene])),
    );
    const textInput = h("input", {
      type: "text",
      maxLength: 40,
      placeholder: "HELLO",
      "aria-label": t.text,
      onInput: () => this.actions.update({ text: textInput.value }),
    });
    const sceneButton = h(
      "button",
      {
        type: "button",
        "data-source": "scene",
        onClick: () => this.actions.scene(sceneSelect.value as Scene),
      },
      t.scene,
    );
    const cameraButton = h(
      "button",
      {
        type: "button",
        "data-source": "camera",
        onClick: () => this.actions.camera(),
      },
      t.camera,
      h("kbd", {}, "C"),
    );
    const screenButton = h(
      "button",
      {
        type: "button",
        "data-source": "screen",
        onClick: () => this.actions.screen(),
      },
      t.screen,
    );
    const fileButton = h(
      "button",
      {
        type: "button",
        "data-source": "file",
        onClick: () => this.fileInput.click(),
      },
      t.openFile,
    );
    this.sourceButtons.set("scene", sceneButton);
    this.sourceButtons.set("camera", cameraButton);
    this.sourceButtons.set("screen", screenButton);
    this.sourceButtons.set("file", fileButton);

    const modeRow = h("div", { className: "segmented modes" });
    MODES.forEach((mode, index) => {
      const button = h(
        "button",
        {
          type: "button",
          "data-mode": mode,
          onClick: () => this.actions.update({ mode }),
        },
        t.modes[mode],
        h("kbd", {}, String(index + 1)),
      );
      this.modeButtons.set(mode, button);
      modeRow.append(button);
    });

    const presetSelect = h(
      "select",
      {
        "aria-label": t.preset,
        onChange: () =>
          presetSelect.value && this.actions.preset(presetSelect.value),
      },
      h("option", { value: "" }, "—"),
      ...PRESETS.map((preset) =>
        h("option", { value: preset.id }, preset.name),
      ),
    );

    const swatches = h("div", {
      className: "swatches",
      role: "radiogroup",
      "aria-label": t.palette,
    });
    PALETTES.forEach((palette) => {
      const button = h("button", {
        type: "button",
        className: "swatch",
        title: palette.name,
        "aria-label": palette.name,
        style: `background: linear-gradient(90deg, ${palette.colors.map((c, i) => `${c} ${(i / palette.colors.length) * 100}% ${((i + 1) / palette.colors.length) * 100}%`).join(", ")})`,
        onClick: () => this.actions.update({ palette: palette.id }),
      });
      this.paletteButtons.set(palette.id, button);
      swatches.append(button);
    });

    const colorPalette = h(
      "button",
      {
        type: "button",
        onClick: () => this.actions.update({ color: "palette" }),
      },
      t.colorPalette,
    );
    const colorSource = h(
      "button",
      {
        type: "button",
        onClick: () => this.actions.update({ color: "source" }),
      },
      t.colorSource,
    );
    const charsetSelect = h(
      "select",
      {
        "aria-label": t.charset,
        onChange: () => this.actions.update({ charset: charsetSelect.value }),
      },
      ...CHARSETS.map((charset) =>
        h(
          "option",
          { value: charset.id },
          charset.id === "custom" ? t.customChars : charset.name,
        ),
      ),
    );
    const customInput = h("input", {
      type: "text",
      maxLength: 64,
      "aria-label": t.customChars,
      onInput: () => this.actions.update({ customChars: customInput.value }),
    });
    const edges = h("input", {
      type: "checkbox",
      onChange: () => this.actions.update({ edges: edges.checked }),
    });
    const invert = h("input", {
      type: "checkbox",
      onChange: () => this.actions.update({ invert: invert.checked }),
    });
    const ditherSelect = h(
      "select",
      {
        "aria-label": t.dither,
        onChange: () =>
          this.actions.update({
            dither: ditherSelect.value as Settings["dither"],
          }),
      },
      ...DITHERS.map((kind) => h("option", { value: kind }, t.dithers[kind])),
    );

    const demoButton = h(
      "button",
      {
        type: "button",
        "data-action": "demo",
        onClick: () => this.actions.demo(),
      },
      t.demo,
      h("kbd", {}, "D"),
    );
    const micButton = h(
      "button",
      {
        type: "button",
        "data-action": "mic",
        onClick: () => this.actions.mic(),
      },
      t.mic,
      h("kbd", {}, "M"),
    );
    const volume = h("input", {
      type: "range",
      min: "0",
      max: "1",
      step: "0.01",
      "aria-label": t.volume,
      onInput: () => this.actions.volume(Number(volume.value)),
    });
    const meter = h(
      "div",
      { className: "meter", "aria-hidden": "true" },
      h("i", {}),
      h("i", {}),
      h("i", {}),
    );
    const recordButton = h(
      "button",
      {
        type: "button",
        className: "record",
        "data-action": "record",
        onClick: () => this.actions.record(),
      },
      t.record,
      h("kbd", {}, "V"),
    );
    const nowPlaying = h("div", { className: "now-playing" });

    const help = h(
      "details",
      { className: "help" },
      h("summary", {}, t.keys),
      h(
        "dl",
        {},
        ...t.help.flatMap(([key, label]) => [
          h("dt", {}, h("kbd", {}, key)),
          h("dd", {}, label),
        ]),
      ),
    );
    const langButton = h("button", { type: "button", className: "lang" });
    langButton.addEventListener("click", () =>
      this.actions.language(langButton.dataset.next as Language),
    );

    Object.assign(this.refs, {
      sceneSelect,
      textInput,
      textRow: h("div", { className: "row" }, textInput),
      presetSelect,
      colorPalette,
      colorSource,
      charsetSelect,
      customInput,
      edges,
      invert,
      ditherSelect,
      demoButton,
      micButton,
      volume,
      meter,
      recordButton,
      nowPlaying,
      langButton,
    });

    const asciiOnly = h(
      "div",
      { className: "only-ascii" },
      h(
        "label",
        { className: "field" },
        h("span", {}, t.charset),
        charsetSelect,
      ),
      h("div", { className: "row custom-row" }, customInput),
      h("label", { className: "check" }, edges, h("span", {}, t.edges)),
    );
    const ditherOnly = h(
      "div",
      { className: "only-dither" },
      h("label", { className: "field" }, h("span", {}, t.dither), ditherSelect),
    );
    this.refs.asciiOnly = asciiOnly;
    this.refs.ditherOnly = ditherOnly;
    this.refs.customRow = asciiOnly.querySelector(".custom-row") as HTMLElement;

    const spreadSlider = this.slider("spread", t.spread, 0, 1.5, 0.01, percent);
    spreadSlider.classList.add("only-dither-braille");
    this.refs.spreadSlider = spreadSlider;

    return h(
      "aside",
      { className: "panel", "aria-label": "Glyphbooth" },
      h(
        "header",
        { className: "panel-head" },
        h(
          "div",
          { className: "brand" },
          h("span", { className: "logo" }, "▓▒░"),
          " GLYPHBOOTH",
        ),
        h(
          "button",
          {
            type: "button",
            className: "icon",
            title: t.hidePanel,
            "aria-label": t.hidePanel,
            onClick: () => this.actions.hide(),
          },
          "H",
        ),
      ),
      h(
        "div",
        { className: "panel-body" },
        this.section(
          t.source,
          h(
            "div",
            { className: "segmented sources" },
            sceneButton,
            cameraButton,
            screenButton,
            fileButton,
          ),
          h(
            "label",
            { className: "field" },
            h("span", {}, t.scene),
            sceneSelect,
          ),
          this.refs.textRow,
          nowPlaying,
        ),
        this.section(
          t.look,
          modeRow,
          h(
            "div",
            { className: "row two" },
            h(
              "label",
              { className: "field" },
              h("span", {}, t.preset),
              presetSelect,
            ),
            h(
              "button",
              {
                type: "button",
                className: "accent",
                "data-action": "random",
                onClick: () => this.actions.random(),
              },
              t.random,
              h("kbd", {}, "R"),
            ),
          ),
          h("div", { className: "field" }, h("span", {}, t.palette), swatches),
          h(
            "div",
            { className: "field" },
            h("span", {}, t.colors),
            h("div", { className: "segmented" }, colorPalette, colorSource),
          ),
          asciiOnly,
          ditherOnly,
          h("label", { className: "check" }, invert, h("span", {}, t.invert)),
        ),
        this.section(
          t.tune,
          this.slider("size", t.size, 0, 1, 0.01, percent),
          spreadSlider,
          this.slider(
            "contrast",
            t.contrast,
            0.5,
            2.5,
            0.01,
            (v) => `${v.toFixed(2)}×`,
          ),
          this.slider("brightness", t.brightness, -0.5, 0.5, 0.01, signed),
          this.slider("reactivity", t.reactivity, 0, 2, 0.01, percent),
          this.slider("scanlines", t.scanlines, 0, 1, 0.01, percent),
          this.slider("grain", t.grain, 0, 1, 0.01, percent),
          this.slider("glitch", t.glitch, 0, 1, 0.01, percent),
        ),
        this.section(
          t.sound,
          h("div", { className: "segmented" }, demoButton, micButton),
          h(
            "label",
            { className: "slider" },
            h("span", { className: "slider-head" }, h("span", {}, t.volume)),
            volume,
          ),
          meter,
        ),
        this.section(
          t.capture,
          h(
            "div",
            { className: "grid-buttons" },
            h(
              "button",
              {
                type: "button",
                "data-action": "snapshot",
                onClick: () => this.actions.snapshot(),
              },
              t.snapshot,
              h("kbd", {}, "S"),
            ),
            recordButton,
            h(
              "button",
              {
                type: "button",
                "data-action": "copy-text",
                onClick: () => this.actions.copyText(),
              },
              t.copyText,
              h("kbd", {}, "T"),
            ),
            h(
              "button",
              {
                type: "button",
                "data-action": "save-html",
                onClick: () => this.actions.saveHtml(),
              },
              t.saveHtml,
            ),
            h(
              "button",
              {
                type: "button",
                "data-action": "copy-link",
                onClick: () => this.actions.copyLink(),
              },
              t.shareLink,
            ),
          ),
        ),
        h(
          "footer",
          { className: "panel-foot" },
          help,
          h(
            "div",
            { className: "foot-row" },
            langButton,
            h(
              "a",
              {
                href: "https://github.com/mrsarac/glyphbooth",
                target: "_blank",
                rel: "noopener",
              },
              "GitHub ↗",
            ),
          ),
        ),
      ),
    );
  }

  sync(state: PanelState): void {
    const s = state.settings;
    const t = this.t;
    for (const slider of this.sliders) {
      const value = s[slider.key] as number;
      if (document.activeElement !== slider.input)
        slider.input.value = String(value);
      slider.output.value = slider.format(value);
    }
    this.modeButtons.forEach((button, mode) =>
      button.setAttribute("aria-pressed", String(mode === s.mode)),
    );
    this.sourceButtons.forEach((button, kind) =>
      button.setAttribute("aria-pressed", String(kind === state.source)),
    );
    this.paletteButtons.forEach((button, id) =>
      button.setAttribute("aria-checked", String(id === s.palette)),
    );
    this.paletteButtons.forEach((button) =>
      button.setAttribute("role", "radio"),
    );

    const refs = this.refs;
    (refs.sceneSelect as HTMLSelectElement).value = s.scene;
    const text = refs.textInput as HTMLInputElement;
    if (document.activeElement !== text) text.value = s.text;
    refs.textRow.hidden = !(state.source === "scene" && s.scene === "type");
    const custom = refs.customInput as HTMLInputElement;
    if (document.activeElement !== custom) custom.value = s.customChars;
    refs.customRow.hidden = s.charset !== "custom";
    (refs.charsetSelect as HTMLSelectElement).value = s.charset;
    (refs.ditherSelect as HTMLSelectElement).value = s.dither;
    (refs.edges as HTMLInputElement).checked = s.edges;
    (refs.invert as HTMLInputElement).checked = s.invert;
    refs.colorPalette.setAttribute(
      "aria-pressed",
      String(s.color === "palette"),
    );
    refs.colorSource.setAttribute("aria-pressed", String(s.color === "source"));
    refs.asciiOnly.hidden = s.mode !== "ascii";
    refs.ditherOnly.hidden = s.mode !== "dither";
    refs.spreadSlider.hidden = s.mode !== "dither" && s.mode !== "braille";
    refs.demoButton.setAttribute("aria-pressed", String(state.demo));
    refs.micButton.setAttribute("aria-pressed", String(state.mic));
    const volume = refs.volume as HTMLInputElement;
    if (document.activeElement !== volume) volume.value = String(state.volume);

    const record = refs.recordButton;
    record.setAttribute("aria-pressed", String(state.recording));
    record.firstChild!.textContent = state.recording
      ? `${t.stop} ${formatSeconds(state.recordSeconds)}`
      : t.record;

    refs.nowPlaying.textContent = state.sourceLabel
      ? `${t.nowPlaying}: ${state.sourceLabel}`
      : "";
    refs.nowPlaying.hidden = !state.sourceLabel;

    const lang = refs.langButton;
    lang.dataset.next = state.language === "tr" ? "en" : "tr";
    lang.textContent = state.language === "tr" ? "English" : "Türkçe";
  }

  meter(bass: number, mid: number, treble: number): void {
    const bars = this.refs.meter.children;
    [bass, mid, treble].forEach((value, index) => {
      (bars[index] as HTMLElement).style.transform =
        `scaleX(${Math.min(1, value).toFixed(3)})`;
    });
  }

  presetCleared(): void {
    (this.refs.presetSelect as HTMLSelectElement).value = "";
  }

  showPreset(id: string): void {
    (this.refs.presetSelect as HTMLSelectElement).value = id;
  }
}

function formatSeconds(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
