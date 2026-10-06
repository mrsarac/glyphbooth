// Beat detection by spectral flux: how much the low-frequency spectrum rose since the last frame, compared with its
// own recent average. Pure and deterministic, so it is unit tested with synthetic spectra.

export interface BeatOptions {
  // Frames of history for the adaptive threshold (~0.7 s at 60 fps).
  history: number;
  // Flux must exceed mean × sensitivity + floor.
  sensitivity: number;
  floor: number;
  // Minimum seconds between two beats.
  cooldown: number;
}

export const DEFAULT_BEAT_OPTIONS: BeatOptions = {
  history: 43,
  sensitivity: 1.5,
  floor: 0.012,
  cooldown: 0.17,
};

export class BeatDetector {
  private previous: Float32Array | null = null;
  private readonly fluxes: number[] = [];
  private lastBeat = -Infinity;
  count = 0;

  constructor(private readonly options: BeatOptions = DEFAULT_BEAT_OPTIONS) {}

  // `bins` are magnitudes 0..1 of the low band. Returns true on the frame a beat starts.
  update(bins: ArrayLike<number>, time: number): boolean {
    const current = Float32Array.from(bins);
    let flux = 0;
    if (this.previous && this.previous.length === current.length) {
      for (let i = 0; i < current.length; i++)
        flux += Math.max(0, current[i] - this.previous[i]);
      flux /= current.length;
    }
    this.previous = current;

    const mean = this.fluxes.length
      ? this.fluxes.reduce((a, b) => a + b, 0) / this.fluxes.length
      : 0;
    this.fluxes.push(flux);
    if (this.fluxes.length > this.options.history) this.fluxes.shift();

    const ready = this.fluxes.length >= 4;
    const isBeat =
      ready &&
      flux > mean * this.options.sensitivity + this.options.floor &&
      time - this.lastBeat >= this.options.cooldown;
    if (isBeat) {
      this.lastBeat = time;
      this.count++;
    }
    return isBeat;
  }

  reset(): void {
    this.previous = null;
    this.fluxes.length = 0;
    this.lastBeat = -Infinity;
  }
}

// Moves `current` toward `target`, fast when rising and slow when falling, independent of frame rate.
export function follow(
  current: number,
  target: number,
  dt: number,
  attack = 0.03,
  release = 0.25,
): number {
  const tau = target > current ? attack : release;
  const k = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
  return current + (target - current) * k;
}

// Average magnitude (0..1) of the FFT bins between two frequencies.
export function bandEnergy(
  bins: Uint8Array,
  sampleRate: number,
  low: number,
  high: number,
): number {
  const binHz = sampleRate / 2 / bins.length;
  const from = Math.max(0, Math.floor(low / binHz));
  // A band that starts above Nyquist holds no bins: a clean 0, not an empty loop and -0.
  if (from > bins.length - 1) return 0;
  const to = Math.min(bins.length - 1, Math.max(from, Math.ceil(high / binHz)));
  let sum = 0;
  for (let i = from; i <= to; i++) sum += bins[i];
  return sum / ((to - from + 1) * 255);
}
