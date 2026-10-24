/**
 * The plaza fountain's water, synthesized (no sample files): small water
 * sounds are mostly air bubbles ringing as they form, a short sine whose
 * pitch rises while it fades (smaller bubbles ring higher and shorter). The
 * fountain is three layers of them under a soft low-pass:
 *
 * - stream: a dense babble of tiny bubbles plus a faint wash, rendered once
 *   into a seamless 9 s buffer and played by two loops at different rates and
 *   offsets, each with its own slow swell (so it never repeats audibly);
 * - drops: single droplet plinks scheduled live at random, a few per second
 *   with a wandering rate;
 * - splashes: now and then a short soft burst of filtered noise (water
 *   slapping the basin).
 *
 * Everything sits behind one gain the hub fades by the listener's distance
 * (`fountainFade`), so it is quiet unless you are near, and nothing is
 * scheduled while it is silent. Levels are in FOUNTAIN.
 */

export const FOUNTAIN = {
  /** Linear gains of the layers into the fountain bus. */
  streamGain: 0.036,
  dropGain: 0.07,
  splashGain: 0.06,
  /** The bus: a gentle low-pass (Hz) and a high-pass that keeps out rumble. */
  lowpass: 4500,
  highpass: 140,
  /** Distance fade (m from the listener): full up to `near`, silent from `far` (smoothstep between). */
  near: 7,
  far: 22,
  /** The panner: inverse distance law from `ref` m on top of the fade. */
  ref: 4,
  rolloff: 1,
  /** Drops per second wander between these; splashes are this many per second on average. */
  dropRateMin: 2,
  dropRateMax: 7,
  splashRate: 1.4,
  /** Seconds of events scheduled ahead of the audio clock. */
  lookahead: 0.25,
  /** The stream buffer (s) and its bubble density (per second). */
  streamSeconds: 9,
  streamDensity: 240,
} as const;

/** Distance gain of the fountain bus: 1 near it, a smooth fade to 0 at FOUNTAIN.far. */
export function fountainFade(distance: number): number {
  const t = (distance - FOUNTAIN.near) / (FOUNTAIN.far - FOUNTAIN.near);
  if (t <= 0) return 1;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

type Rand = () => number;

/**
 * Add one bubble into `out` at sample `at` (wrapping round the end when
 * `wrap`): a sine from `f0` rising by `rise` (ratio over its life) with an
 * exponential decay `tau` (s) and a short attack.
 */
function addBubble(out: Float32Array, rate: number, at: number, f0: number, rise: number, tau: number, amp: number, wrap: boolean): void {
  const len = Math.min(Math.ceil(tau * 5 * rate), out.length);
  const attack = Math.max(1, Math.round(0.0006 * rate));
  const sigma = (rise - 1) / (tau * 5);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / rate;
    const f = f0 * (1 + sigma * t);
    phase += (2 * Math.PI * f) / rate;
    const env = Math.exp(-t / tau) * Math.min(1, i / attack);
    let k = at + i;
    if (k >= out.length) {
      if (!wrap) break;
      k -= out.length;
    }
    out[k]! += Math.sin(phase) * env * amp;
  }
}

function normalizeRms(buf: Float32Array, target: number): void {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i]! * buf[i]!;
  const rms = Math.sqrt(sum / buf.length) || 1;
  const k = target / rms;
  for (let i = 0; i < buf.length; i++) buf[i]! *= k;
}

/** Log-uniform between a and b. */
function logUniform(r: Rand, a: number, b: number): number {
  return a * Math.pow(b / a, r());
}

/**
 * The stream: a seamless loop (bubbles wrap round the end, the wash's
 * envelope has whole cycles over the length) at an RMS of 0.25.
 */
export function renderStream(rate: number, rand: Rand, seconds: number = FOUNTAIN.streamSeconds, density: number = FOUNTAIN.streamDensity): Float32Array {
  const n = Math.round(seconds * rate);
  const out = new Float32Array(n);
  const count = Math.round(seconds * density);
  for (let i = 0; i < count; i++) {
    const f0 = logUniform(rand, 700, 4200);
    // Smaller bubbles ring higher and shorter, and most of them are faint.
    const tau = 0.009 * Math.pow(1200 / f0, 0.9) * (0.7 + rand() * 0.6);
    const u = rand();
    const amp = (0.15 + 0.85 * u * u * u) * Math.pow(1200 / f0, 0.35);
    addBubble(out, rate, Math.floor(rand() * n), f0, 1.15 + rand() * 0.6, tau, amp, true);
  }
  normalizeRms(out, 0.22);
  // The wash: soft band-limited noise (two one-pole filters, run twice round
  // the loop so the seam matches) under a lapping envelope.
  const wash = new Float32Array(n);
  for (let i = 0; i < n; i++) wash[i] = rand() * 2 - 1;
  const lp = 1 - Math.exp((-2 * Math.PI * 1400) / rate);
  const hp = 1 - Math.exp((-2 * Math.PI * 300) / rate);
  let low = 0;
  let base = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      low += (wash[i]! - low) * lp;
      base += (low - base) * hp;
      if (pass === 1) wash[i] = low - base;
    }
  }
  const cycles = [3, 7, 13, 23].map((c) => [c, rand() * Math.PI * 2] as const);
  for (let i = 0; i < n; i++) {
    let e = 0;
    for (const [c, p] of cycles) e += Math.sin((2 * Math.PI * c * i) / n + p);
    wash[i]! *= 0.6 + 0.2 * e;
  }
  normalizeRms(wash, 0.1);
  for (let i = 0; i < n; i++) out[i]! += wash[i]!;
  return out;
}

/** One droplet plink at 1 kHz (play it faster or slower for other sizes), peak about 0.8. */
export function renderDrop(rate: number, rand: Rand): Float32Array {
  const tau = 0.022 + rand() * 0.02;
  const out = new Float32Array(Math.ceil(tau * 5 * rate) + 1);
  addBubble(out, rate, 0, 1000, 1.8 + rand() * 0.9, tau, 0.8, false);
  // The tiny tick of the impact before the bubble rings.
  const click = Math.round(0.002 * rate);
  for (let i = 0; i < click && i < out.length; i++) out[i]! += (rand() * 2 - 1) * 0.12 * (1 - i / click);
  return out;
}

function toBuffer(ctx: BaseAudioContext, data: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
  b.getChannelData(0).set(data);
  return b;
}

export class FountainSound {
  private readonly ctx: BaseAudioContext;
  private readonly rand: Rand;
  private readonly noise: AudioBuffer;
  private readonly drops: AudioBuffer[];
  private readonly bus: GainNode;
  private readonly dropBus: GainNode;
  private readonly splashBus: GainNode;
  /** The distance fade (FOUNTAIN.near and far), set by `setDistance`. */
  private readonly fade: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private fadeNow = 0;
  private nextDrop = 0;
  private nextSplash = 0;
  private dropRate: number = FOUNTAIN.dropRateMin;

  /** `out` is where the fountain plays (a panner at the fountain); `noise` any white noise buffer. */
  constructor(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, rand: Rand = Math.random) {
    this.ctx = ctx;
    this.rand = rand;
    this.noise = noise;
    this.fade = ctx.createGain();
    this.fade.gain.value = 0;
    this.fade.connect(out);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = FOUNTAIN.lowpass;
    lowpass.Q.value = 0.5;
    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = FOUNTAIN.highpass;
    highpass.Q.value = 0.5;
    this.bus = ctx.createGain();
    this.bus.connect(highpass).connect(lowpass).connect(this.fade);
    this.dropBus = ctx.createGain();
    this.dropBus.gain.value = FOUNTAIN.dropGain;
    this.dropBus.connect(this.bus);
    this.splashBus = ctx.createGain();
    this.splashBus.gain.value = FOUNTAIN.splashGain;
    this.splashBus.connect(this.bus);
    this.drops = [0, 1, 2, 3].map(() => toBuffer(ctx, renderDrop(ctx.sampleRate, rand)));

    // The stream: two loops of one buffer, out of step, each swelling slowly on its own.
    const stream = toBuffer(ctx, renderStream(ctx.sampleRate, rand));
    for (const [playback, swell] of [[1, 0.09], [0.86, 0.14]] as const) {
      const src = ctx.createBufferSource();
      src.buffer = stream;
      src.loop = true;
      src.playbackRate.value = playback;
      const g = ctx.createGain();
      g.gain.value = FOUNTAIN.streamGain * 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = swell;
      const depth = ctx.createGain();
      depth.gain.value = FOUNTAIN.streamGain * 0.5 * 0.3;
      lfo.connect(depth).connect(g.gain);
      src.connect(g).connect(this.bus);
      src.start(ctx.currentTime, rand() * FOUNTAIN.streamSeconds);
      lfo.start(ctx.currentTime);
      this.sources.push(src, lfo);
    }
  }

  /** The listener is this far away (m): fade the fountain in or out smoothly. */
  setDistance(distance: number): void {
    const v = fountainFade(distance);
    if (Math.abs(v - this.fadeNow) < 0.002) return;
    this.fadeNow = v;
    this.fade.gain.setTargetAtTime(v, this.ctx.currentTime, 0.12);
  }

  /** Set the fade at once (offline renders and tests). */
  setFade(v: number): void {
    this.fadeNow = v;
    this.fade.gain.value = v;
  }

  /** Schedule drops and splashes up to `until` (audio clock s). Call often (every frame); nothing while silent. */
  schedule(until: number = this.ctx.currentTime + FOUNTAIN.lookahead): void {
    const now = this.ctx.currentTime;
    if (this.fadeNow <= 0.001) {
      this.nextDrop = this.nextSplash = 0;
      return;
    }
    const r = this.rand;
    if (this.nextDrop < now) this.nextDrop = now + r() * 0.2;
    if (this.nextSplash < now) this.nextSplash = now + r() * 0.5;
    while (this.nextDrop < until) {
      this.drop(this.nextDrop);
      // A random walk of the rate: busier and calmer stretches.
      this.dropRate = Math.min(FOUNTAIN.dropRateMax, Math.max(FOUNTAIN.dropRateMin, this.dropRate + (r() - 0.5) * 1.6));
      this.nextDrop += -Math.log(1 - r() * 0.999) / this.dropRate;
    }
    while (this.nextSplash < until) {
      this.splash(this.nextSplash);
      this.nextSplash += 0.15 - Math.log(1 - r() * 0.999) / FOUNTAIN.splashRate;
    }
  }

  private drop(t: number): void {
    const r = this.rand;
    const src = this.ctx.createBufferSource();
    src.buffer = this.drops[Math.floor(r() * this.drops.length)] ?? null;
    // 450 Hz to 1.6 kHz: bigger drops ring lower and longer.
    src.playbackRate.value = logUniform(r, 0.45, 1.6);
    const g = this.ctx.createGain();
    const u = r();
    g.gain.value = 0.25 + 0.75 * u * u;
    src.connect(g).connect(this.dropBus);
    src.start(t);
  }

  private splash(t: number): void {
    const r = this.rand;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = logUniform(r, 700, 2400);
    f.Q.value = 0.8 + r() * 0.6;
    const g = ctx.createGain();
    const peak = 0.3 + r() * 0.7;
    const attack = 0.015 + r() * 0.03;
    const decay = 0.06 + r() * 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.splashBus);
    const len = attack + decay + 0.02;
    src.start(t, r() * Math.max(0, this.noise.duration - len), len);
  }

  stop(): void {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.sources.length = 0;
  }
}
