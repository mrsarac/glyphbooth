// The built-in demo track: a 16-bar loop synthesized live with Web Audio (kick, clap, hats, bass, arpeggio, pad).
// Nothing is sampled, so there are no license questions, and the app makes sound without any file or permission.

const BPM = 122;
const STEP = 60 / BPM / 4;
const LOOKAHEAD = 0.12;

// A minor: Am, F, C, G. Chord tones as MIDI notes, and the bass root.
const CHORDS = [
  { notes: [57, 60, 64], root: 33 },
  { notes: [53, 57, 60], root: 29 },
  { notes: [55, 60, 64], root: 36 },
  { notes: [55, 59, 62], root: 31 },
];
const ARP = [0, 1, 2, 1, 0, 2, 1, 2, 0, 1, 2, 3, 2, 1, 0, 1];

const freq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class DemoSynth {
  readonly output: GainNode;
  private readonly noise: AudioBuffer;
  private readonly delay: DelayNode;
  private readonly bus: AudioNode;
  private timer: number | null = null;
  private step = 0;
  private nextTime = 0;

  constructor(private readonly ctx: AudioContext) {
    this.output = ctx.createGain();
    this.output.gain.value = 0.55;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    compressor.connect(this.output);
    this.bus = compressor;

    this.delay = ctx.createDelay(1);
    this.delay.delayTime.value = STEP * 3;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = "lowpass";
    delayTone.frequency.value = 2400;
    this.delay.connect(delayTone);
    delayTone.connect(feedback);
    feedback.connect(this.delay);
    delayTone.connect(compressor);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }

  get playing(): boolean {
    return this.timer !== null;
  }

  start(): void {
    if (this.timer !== null) return;
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.05;
    this.timer = window.setInterval(() => this.schedule(), 25);
    this.schedule();
  }

  stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    while (this.nextTime < this.ctx.currentTime + LOOKAHEAD) {
      this.play(this.step, this.nextTime);
      this.nextTime += STEP;
      this.step = (this.step + 1) % (16 * 16);
    }
  }

  private play(step: number, t: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = CHORDS[bar % 4];
    const intro = bar < 2;
    const breakdown = bar >= 12 && bar < 14;
    const build = bar >= 14;

    if (!breakdown && s % 4 === 0) this.kick(t);
    if (!intro && !breakdown && (s === 4 || s === 12)) this.clap(t, 0.5);
    if (build && bar === 15 && s >= 8) this.clap(t, 0.15 + (s - 8) * 0.04);
    if (s % 4 === 2) this.hat(t, 0.16, 0.05);
    else if (!intro && s % 2 === 1) this.hat(t, 0.05, 0.03);
    if (!breakdown && s % 4 === 2) this.bass(chord.root, t, STEP * 1.6);
    if (bar >= 2 && s % 16 === 0) this.pad(chord.notes, t, STEP * 16);
    if (bar >= 4) {
      const index = ARP[s];
      const note = index === 3 ? chord.notes[0] + 12 : chord.notes[index];
      this.arp(note + 12, t, breakdown ? 0.07 : 0.045);
    }
  }

  private envelope(
    gain: GainNode,
    t: number,
    peak: number,
    attack: number,
    decay: number,
  ): void {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  private kick(t: number): void {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(150, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    this.envelope(gain, t, 1, 0.003, 0.38);
    osc.connect(gain).connect(this.bus);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  private noiseHit(
    t: number,
    filter: BiquadFilterType,
    frequency: number,
    peak: number,
    decay: number,
  ): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const band = this.ctx.createBiquadFilter();
    band.type = filter;
    band.frequency.value = frequency;
    const gain = this.ctx.createGain();
    this.envelope(gain, t, peak, 0.002, decay);
    source.connect(band).connect(gain).connect(this.bus);
    source.start(t, Math.random() * 0.5);
    source.stop(t + decay + 0.05);
  }

  private clap(t: number, peak: number): void {
    this.noiseHit(t, "bandpass", 1500, peak, 0.16);
    this.noiseHit(t + 0.012, "bandpass", 1100, peak * 0.6, 0.1);
  }

  private hat(t: number, peak: number, decay: number): void {
    this.noiseHit(t, "highpass", 7500, peak, decay);
  }

  private bass(midi: number, t: number, length: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = freq(midi);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 7;
    filter.frequency.setValueAtTime(900, t);
    filter.frequency.exponentialRampToValueAtTime(160, t + length);
    const gain = this.ctx.createGain();
    this.envelope(gain, t, 0.32, 0.005, length);
    osc.connect(filter).connect(gain).connect(this.bus);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  private arp(midi: number, t: number, peak: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = freq(midi);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    const gain = this.ctx.createGain();
    this.envelope(gain, t, peak, 0.004, STEP * 0.9);
    osc.connect(filter).connect(gain);
    gain.connect(this.bus);
    gain.connect(this.delay);
    osc.start(t);
    osc.stop(t + STEP + 0.05);
  }

  private pad(notes: number[], t: number, length: number): void {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1100;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + length * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    filter.connect(gain).connect(this.bus);
    for (const note of notes) {
      for (const detune of [-7, 7]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.value = freq(note);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(t);
        osc.stop(t + length + 0.05);
      }
    }
  }
}
