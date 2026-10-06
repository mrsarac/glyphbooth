// Getting the art out: PNG stills, WebM video with sound, and the ASCII frame as text or as a colored HTML page.

import type { CellGrid } from "../render/renderer";

export function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function pickVideoType(
  isSupported: (type: string) => boolean,
): string | null {
  const types = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4;codecs=avc1,mp4a",
    "video/mp4",
  ];
  return types.find((type) => isSupported(type)) ?? null;
}

// Below about a second the encoder may not have written a single chunk yet.
const MIN_RECORD_MS = 1000;

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  startedAt = 0;
  // Called when the browser stops a running recording on its own (encoder error, track ended).
  onError: ((error: unknown) => void) | null = null;

  get recording(): boolean {
    return this.recorder !== null;
  }

  start(canvas: HTMLCanvasElement, audio: MediaStream | null): void {
    if (this.recorder) return;
    if (typeof MediaRecorder === "undefined")
      throw new Error("Recording is not supported here");
    const type = pickVideoType((t) => MediaRecorder.isTypeSupported(t));
    if (!type) throw new Error("No supported video format");
    const stream = canvas.captureStream(60);
    audio?.getAudioTracks().forEach((track) => stream.addTrack(track));
    this.chunks = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: type,
        videoBitsPerSecond: 12_000_000,
      });
      recorder.start(250);
    } catch (error) {
      // Without this the canvas capture track would keep running.
      stream.getVideoTracks().forEach((track) => track.stop());
      throw error;
    }
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    recorder.onerror = (event) => {
      if (this.recorder !== recorder) return;
      this.recorder = null;
      this.chunks = [];
      stream.getVideoTracks().forEach((track) => track.stop());
      this.onError?.(event);
    };
    this.recorder = recorder;
    this.startedAt = performance.now();
  }

  stop(): Promise<Blob | null> {
    const recorder = this.recorder;
    if (!recorder) return Promise.resolve(null);
    this.recorder = null;
    return new Promise((resolve) => {
      let done = false;
      // Resolves exactly once, whether the recorder stops cleanly, errors, or was already dead.
      const finish = (blob: Blob | null) => {
        if (done) return;
        done = true;
        recorder.stream.getVideoTracks().forEach((track) => track.stop());
        this.chunks = [];
        resolve(blob && blob.size > 0 ? blob : null);
      };
      recorder.onstop = () =>
        finish(new Blob(this.chunks, { type: recorder.mimeType }));
      recorder.onerror = () => finish(null);
      if (recorder.state === "inactive") {
        finish(null);
        return;
      }
      const wait = Math.max(0, MIN_RECORD_MS - (performance.now() - this.startedAt));
      window.setTimeout(() => {
        if (recorder.state === "inactive") {
          finish(null);
          return;
        }
        try {
          // Flush what the encoder holds, so a short take still produces data.
          recorder.requestData();
          recorder.stop();
        } catch {
          finish(null);
        }
      }, wait);
    });
  }
}

export function gridToText(grid: CellGrid): string {
  const lines: string[] = [];
  for (let y = 0; y < grid.rows; y++) {
    lines.push(
      grid.chars
        .slice(y * grid.cols, (y + 1) * grid.cols)
        .join("")
        .replace(/\s+$/, ""),
    );
  }
  return lines.join("\n");
}

const escapeHtml = (char: string) =>
  char === "<"
    ? "&lt;"
    : char === ">"
      ? "&gt;"
      : char === "&"
        ? "&amp;"
        : char === '"'
          ? "&quot;"
          : char;

// A self-contained HTML page: every character keeps the color of its cell. Runs of the same color share one span.
export function gridToHtml(
  grid: CellGrid,
  background: string,
  title = "Glyphbooth",
): string {
  const rows: string[] = [];
  for (let y = 0; y < grid.rows; y++) {
    let row = "";
    let run = "";
    let runColor = "";
    for (let x = 0; x < grid.cols; x++) {
      const i = y * grid.cols + x;
      const char = grid.chars[i];
      const r = grid.colors[i * 3];
      const g = grid.colors[i * 3 + 1];
      const b = grid.colors[i * 3 + 2];
      const max = Math.max(r, g, b, 20);
      const color = `#${[r, g, b]
        .map((v) =>
          Math.round((v / max) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")}`;
      if (color !== runColor && run) {
        row += `<span style="color:${runColor}">${run}</span>`;
        run = "";
      }
      runColor = color;
      run += escapeHtml(char);
    }
    if (run) row += `<span style="color:${runColor}">${run}</span>`;
    rows.push(row);
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title.replace(/[<>&"]/g, escapeHtml)}</title>
<style>html,body{margin:0;background:${background}}pre{margin:0;padding:24px;font:10px/1.15 ui-monospace,Menlo,Consolas,monospace;white-space:pre}</style>
</head><body><pre>${rows.join("\n")}</pre>
<!-- Made with Glyphbooth: https://github.com/mrsarac/glyphbooth -->
</body></html>
`;
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Fall through to the old way, which works where the Clipboard API is blocked.
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("Clipboard is not available");
}
