// The audio graph. Every sound source feeds one analyser; sources that should be heard (demo, files, videos) also
// go to the speakers and to the recorder. The microphone is analysed only, so it never feeds back into the speakers.

import type { AudioFrame } from "../render/renderer";
import { bandEnergy, BeatDetector, follow } from "./beat";
import { DemoSynth } from "./synth";

const SPECTRUM_BINS = 512;

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly recordStream: MediaStreamAudioDestinationNode;
  private readonly analyser: AnalyserNode;
  private readonly heard: GainNode;
  private readonly bins: Uint8Array<ArrayBuffer>;
  private readonly wave: Uint8Array<ArrayBuffer>;
  private readonly beats = new BeatDetector();
  private readonly elementSources = new WeakMap<
    HTMLMediaElement,
    MediaElementAudioSourceNode
  >();
  private mic: {
    stream: MediaStream;
    node: MediaStreamAudioSourceNode;
  } | null = null;
  private streamNode: MediaStreamAudioSourceNode | null = null;
  readonly demo: DemoSynth;
  readonly frame: AudioFrame = {
    level: 0,
    bass: 0,
    mid: 0,
    treble: 0,
    beat: 0,
    spectrum: new Uint8Array(SPECTRUM_BINS),
  };

  constructor() {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.55;
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.wave = new Uint8Array(this.analyser.fftSize);

    this.heard = this.ctx.createGain();
    this.heard.gain.value = 0.8;
    this.recordStream = this.ctx.createMediaStreamDestination();
    this.heard.connect(this.analyser);
    this.heard.connect(this.ctx.destination);
    this.heard.connect(this.recordStream);

    this.demo = new DemoSynth(this.ctx);
    this.demo.output.connect(this.heard);
  }

  get volume(): number {
    return this.heard.gain.value;
  }

  set volume(value: number) {
    this.heard.gain.setTargetAtTime(
      Math.max(0, Math.min(1, value)),
      this.ctx.currentTime,
      0.02,
    );
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== "running") await this.ctx.resume();
  }

  get micOn(): boolean {
    return this.mic !== null;
  }

  async startMic(): Promise<void> {
    if (this.mic) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      },
      video: false,
    });
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.analyser);
    // Recorded with the video, never sent to the speakers (that would feed back).
    node.connect(this.recordStream);
    this.mic = { stream, node };
  }

  stopMic(): void {
    if (!this.mic) return;
    this.mic.node.disconnect();
    this.mic.stream.getTracks().forEach((track) => track.stop());
    this.mic = null;
  }

  // Video and audio files: heard, analysed and recorded.
  attachElement(element: HTMLMediaElement): void {
    let node = this.elementSources.get(element);
    if (!node) {
      node = this.ctx.createMediaElementSource(element);
      this.elementSources.set(element, node);
    }
    node.disconnect();
    node.connect(this.heard);
  }

  // Screen capture audio: analysed only (it is already playing on the computer).
  attachStream(stream: MediaStream | null): void {
    this.streamNode?.disconnect();
    this.streamNode = null;
    if (stream && stream.getAudioTracks().length > 0) {
      this.streamNode = this.ctx.createMediaStreamSource(stream);
      this.streamNode.connect(this.analyser);
    }
  }

  update(dt: number, time: number): AudioFrame {
    const f = this.frame;
    this.analyser.getByteFrequencyData(this.bins);
    this.analyser.getByteTimeDomainData(this.wave);
    const rate = this.ctx.sampleRate;

    let sum = 0;
    for (let i = 0; i < this.wave.length; i++) {
      const v = (this.wave[i] - 128) / 128;
      sum += v * v;
    }
    const level = Math.min(1, Math.sqrt(sum / this.wave.length) * 3);
    f.level = follow(f.level, level, dt);
    f.bass = follow(
      f.bass,
      Math.min(1, bandEnergy(this.bins, rate, 30, 160) * 1.3),
      dt,
      0.02,
      0.18,
    );
    f.mid = follow(
      f.mid,
      Math.min(1, bandEnergy(this.bins, rate, 400, 2500) * 1.6),
      dt,
    );
    f.treble = follow(
      f.treble,
      Math.min(1, bandEnergy(this.bins, rate, 4000, 12000) * 2.2),
      dt,
      0.02,
      0.15,
    );

    const binHz = rate / 2 / this.bins.length;
    const low = this.bins.subarray(1, Math.max(3, Math.ceil(200 / binHz)));
    const lowNorm = Array.from(low, (v) => v / 255);
    if (this.beats.update(lowNorm, time)) f.beat = 1;
    else f.beat *= Math.exp(-dt / 0.12);

    // Spectrum for the shaders: the lower half of the bins holds nearly everything musical.
    f.spectrum.set(this.bins.subarray(0, SPECTRUM_BINS));
    return f;
  }

  get beatCount(): number {
    return this.beats.count;
  }
}
