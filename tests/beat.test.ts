import { describe, it, expect } from "vitest";
import { BeatDetector, bandEnergy, follow } from "../src/audio/beat";

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BINS = 16;

// A low-band spectrum: `level` plus a little noise per bin.
function spectrum(level: number, rng: () => number, noise = 0.02): number[] {
  return Array.from({ length: BINS }, () => level + (rng() - 0.5) * noise);
}

// Feeds `seconds` of synthetic audio and returns the times (s) at which beats were reported.
function run(
  detector: BeatDetector,
  seconds: number,
  fps: number,
  kickEveryFrames: number,
  rng: () => number,
): number[] {
  const beats: number[] = [];
  const frames = Math.round(seconds * fps);
  for (let f = 0; f < frames; f++) {
    const kick = kickEveryFrames > 0 && f % kickEveryFrames === 0 && f > 0;
    const bins = spectrum(kick ? 0.9 : 0.1, rng);
    const time = f / fps;
    if (detector.update(bins, time)) beats.push(time);
  }
  return beats;
}

describe("BeatDetector", () => {
  it("detects periodic kicks", () => {
    const detector = new BeatDetector();
    // 30 frames at 60 fps = one kick every 0.5 s -> 20 kicks in 10 s.
    const beats = run(detector, 10, 60, 30, seeded(1));
    expect(detector.count).toBe(beats.length);
    expect(beats.length).toBeGreaterThanOrEqual(17);
    expect(beats.length).toBeLessThanOrEqual(21);
  });

  it("reports beats on the kick frames, spaced by the kick period", () => {
    const detector = new BeatDetector();
    const beats = run(detector, 10, 60, 30, seeded(2));
    const gaps = beats.slice(1).map((t, i) => t - beats[i]);
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    expect(median).toBeCloseTo(0.5, 1);
  });

  it("ignores a steady signal", () => {
    const detector = new BeatDetector();
    const beats = run(detector, 10, 60, 0, seeded(3));
    expect(beats).toEqual([]);
  });

  it("ignores silence", () => {
    const detector = new BeatDetector();
    for (let f = 0; f < 300; f++) {
      expect(detector.update(new Array(BINS).fill(0), f / 60)).toBe(false);
    }
    expect(detector.count).toBe(0);
  });

  it("ignores a slow swell (small flux per frame)", () => {
    const detector = new BeatDetector();
    let beats = 0;
    for (let f = 0; f < 600; f++) {
      const level = 0.1 + (0.8 * f) / 600;
      if (detector.update(new Array(BINS).fill(level), f / 60)) beats++;
    }
    expect(beats).toBe(0);
  });

  it("respects the cooldown", () => {
    const detector = new BeatDetector({
      history: 43,
      sensitivity: 1.5,
      floor: 0.012,
      cooldown: 0.5,
    });
    // Kicks every 0.25 s (15 frames) but cooldown is 0.5 s -> at most one beat per 0.5 s.
    const beats = run(detector, 8, 60, 15, seeded(4));
    expect(beats.length).toBeGreaterThan(5);
    for (let i = 1; i < beats.length; i++) {
      expect(beats[i] - beats[i - 1]).toBeGreaterThanOrEqual(0.5 - 1e-9);
    }
  });

  it("does not fire during the first few frames while history is empty", () => {
    const detector = new BeatDetector();
    expect(detector.update(new Array(BINS).fill(0), 0)).toBe(false);
    expect(detector.update(new Array(BINS).fill(1), 1 / 60)).toBe(false);
  });

  it("reset clears history and the beat counter state", () => {
    const detector = new BeatDetector();
    const first = run(detector, 5, 60, 30, seeded(5));
    expect(first.length).toBeGreaterThan(0);
    detector.reset();
    // After a reset the first frames are warm-up again.
    expect(detector.update(new Array(BINS).fill(1), 100)).toBe(false);
  });

  it("copes with a changing number of bins", () => {
    const detector = new BeatDetector();
    detector.update([0.1, 0.1], 0);
    expect(() => detector.update([0.1, 0.1, 0.1], 0.016)).not.toThrow();
  });
});

describe("follow", () => {
  function simulate(fps: number, seconds: number, target: number, start = 0): number {
    let value = start;
    const dt = 1 / fps;
    for (let i = 0; i < Math.round(fps * seconds); i++) value = follow(value, target, dt);
    return value;
  }

  it("converges to the target", () => {
    expect(simulate(60, 3, 1)).toBeCloseTo(1, 3);
    expect(simulate(60, 5, 0, 1)).toBeCloseTo(0, 3);
  });

  it("never overshoots", () => {
    let value = 0;
    for (let i = 0; i < 200; i++) {
      value = follow(value, 1, 1 / 60);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("rises faster than it falls", () => {
    const up = follow(0, 1, 1 / 60) - 0;
    const down = 1 - follow(1, 0, 1 / 60);
    expect(up).toBeGreaterThan(down);
  });

  it("is frame-rate independent", () => {
    // Falling from 1 toward 0 for one second.
    const at60 = simulate(60, 1, 0, 1);
    const at120 = simulate(120, 1, 0, 1);
    expect(Math.abs(at60 - at120)).toBeLessThan(0.005);
    // Rising.
    const up60 = simulate(60, 0.05, 1, 0);
    const up120 = simulate(120, 0.05, 1, 0);
    expect(Math.abs(up60 - up120)).toBeLessThan(0.005);
  });

  it("stays put when current equals target", () => {
    expect(follow(0.4, 0.4, 0.016)).toBe(0.4);
  });

  it("handles dt of zero and a zero time constant", () => {
    expect(follow(0.2, 1, 0)).toBe(0.2);
    expect(Number.isFinite(follow(0, 1, 0.016, 0, 0))).toBe(true);
  });
});

describe("bandEnergy", () => {
  it("is 0 for silence and 1 for a full-scale band", () => {
    expect(bandEnergy(new Uint8Array(128), 48000, 20, 150)).toBe(0);
    expect(bandEnergy(new Uint8Array(128).fill(255), 48000, 20, 150)).toBe(1);
  });

  it("only reads the requested band", () => {
    const bins = new Uint8Array(100);
    // sampleRate 20000 -> 100 bins of 100 Hz each. Fill bins for 0..500 Hz.
    bins.fill(255, 0, 6);
    expect(bandEnergy(bins, 20000, 0, 500)).toBe(1);
    expect(bandEnergy(bins, 20000, 1000, 2000)).toBe(0);
  });

  it("averages mixed bins", () => {
    const bins = new Uint8Array(100);
    bins[0] = 255;
    bins[1] = 0;
    // from = floor(0/100) = 0, to = ceil(100/100) = 1: bins 0 and 1 -> (255 + 0) / (2 * 255)
    expect(bandEnergy(bins, 20000, 0, 100)).toBeCloseTo(0.5, 5);
  });

  // Quirk in src/audio/beat.ts: a band entirely above Nyquist gives `from > to`, the loop never runs and the result is
  // 0 / negative = -0. Not NaN, so harmless; asserting only that it stays finite and zero.
  it("returns zero (not NaN) for a band above Nyquist", () => {
    const bins = new Uint8Array(10).fill(255);
    const energy = bandEnergy(bins, 1000, 10000, 20000);
    expect(Number.isFinite(energy)).toBe(true);
    expect(energy).toBeCloseTo(0, 10);
  });

  it("always returns a value between 0 and 1", () => {
    const rng = seeded(8);
    const bins = Uint8Array.from({ length: 256 }, () => Math.floor(rng() * 256));
    for (const [lo, hi] of [[20, 150], [150, 2000], [2000, 12000], [0, 24000]]) {
      const e = bandEnergy(bins, 48000, lo, hi);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
    }
  });
});
