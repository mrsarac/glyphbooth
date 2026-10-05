// What the picture comes from: a built-in scene (no media), the camera, the screen, or a dropped file.
// Only one is active at a time; switching always stops the previous camera or screen stream.

import type { AudioEngine } from "../audio/engine";
import type { MediaInput } from "../render/renderer";

export type SourceKind = "scene" | "camera" | "screen" | "file";

export class MediaSource {
  kind: SourceKind = "scene";
  label = "";
  private stream: MediaStream | null = null;
  private readonly video: HTMLVideoElement;
  private image: HTMLImageElement | null = null;
  private objectUrl: string | null = null;
  // Files that are only audio: the scene keeps drawing, the file is heard.
  private audioOnly = false;
  onEnded: (() => void) | null = null;

  constructor(private readonly audio: AudioEngine) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.loop = true;
    this.video.crossOrigin = "anonymous";
  }

  get input(): MediaInput | null {
    if (this.kind === "scene" || this.audioOnly) return null;
    if (this.image) return this.image;
    return this.video;
  }

  get mirrored(): boolean {
    return this.kind === "camera";
  }

  get mediaElement(): HTMLVideoElement | null {
    return this.kind === "file" && !this.image ? this.video : null;
  }

  private release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.audio.attachStream(null);
    this.video.pause();
    this.video.srcObject = null;
    this.video.removeAttribute("src");
    this.video.load();
    this.image = null;
    this.audioOnly = false;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  useScene(): void {
    this.release();
    this.kind = "scene";
    this.label = "";
  }

  async useCamera(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });
    this.release();
    await this.playStream(stream);
    this.kind = "camera";
    this.label = stream.getVideoTracks()[0]?.label ?? "Camera";
  }

  async useScreen(): Promise<void> {
    if (!navigator.mediaDevices.getDisplayMedia)
      throw new Error("Screen capture is not supported here");
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: true,
    });
    this.release();
    await this.playStream(stream);
    this.audio.attachStream(stream);
    this.kind = "screen";
    this.label = "Screen";
    stream.getVideoTracks()[0]?.addEventListener("ended", () => {
      if (this.stream === stream) {
        this.useScene();
        this.onEnded?.();
      }
    });
  }

  private async playStream(stream: MediaStream): Promise<void> {
    this.stream = stream;
    this.video.muted = true;
    this.video.srcObject = stream;
    await this.video.play();
  }

  async useFile(file: File): Promise<"image" | "video" | "audio"> {
    const type = file.type || guessType(file.name);
    const url = URL.createObjectURL(file);
    if (type.startsWith("image/")) {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      this.release();
      this.image = image;
      this.objectUrl = url;
      this.kind = "file";
      this.label = file.name;
      return "image";
    }
    if (type.startsWith("video/") || type.startsWith("audio/")) {
      this.release();
      this.objectUrl = url;
      this.video.muted = false;
      this.video.src = url;
      this.audio.attachElement(this.video);
      await this.video.play();
      this.audioOnly = type.startsWith("audio/") || this.video.videoWidth === 0;
      this.kind = "file";
      this.label = file.name;
      return this.audioOnly ? "audio" : "video";
    }
    URL.revokeObjectURL(url);
    throw new Error(`Unsupported file: ${file.name}`);
  }
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"].includes(ext))
    return "image/" + ext;
  if (["mp4", "webm", "mov", "m4v", "ogv"].includes(ext)) return "video/" + ext;
  if (["mp3", "wav", "ogg", "m4a", "aac", "flac", "opus"].includes(ext))
    return "audio/" + ext;
  return "";
}

// The "type" scene draws this canvas: the user's text, big and bold, white on black.
export function drawText(
  canvas: HTMLCanvasElement,
  text: string,
  font: string,
): void {
  const value = text.trim() || " ";
  const lines = value.split(/\\n|\n/).slice(0, 3);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = 220;
  ctx.font = `800 ${size}px ${font}`;
  const width = Math.max(
    ...lines.map((line) => ctx.measureText(line).width),
    size,
  );
  canvas.width = Math.ceil(width + size * 0.6);
  canvas.height = Math.ceil(size * 1.15 * lines.length + size * 0.4);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.font = `800 ${size}px ${font}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, index) => {
    const y =
      canvas.height / 2 + (index - (lines.length - 1) / 2) * size * 1.15;
    ctx.fillText(line, canvas.width / 2, y);
  });
  canvas.dataset.version = String(Number(canvas.dataset.version ?? 0) + 1);
}
