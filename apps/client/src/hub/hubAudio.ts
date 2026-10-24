/**
 * The plaza's sounds, all synthesized with WebAudio (no sample files, nothing
 * to license): a soft breeze, birds chirping now and then in the trees, the
 * fountain's splash and a low hum at each portal (both placed in 3D), quacks
 * from ducks, a pop for the UI and a whoosh into a portal.
 */
import * as THREE from 'three/webgpu';

export class HubAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private volume = 0.7;
  private nextChirp = 0;
  private loops: AudioNode[] = [];
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly spots: { at: THREE.Vector3; kind: 'fountain' | 'portal'; pitch: number }[] = [];

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume * 0.8;
  }

  /** Places the ambience comes from (set before unlock, or it starts on the next unlock). */
  addSpot(at: THREE.Vector3, kind: 'fountain' | 'portal', pitch = 1): void {
    this.spots.push({ at: at.clone(), kind, pitch });
  }

  /** Audio starts only after a user gesture: call from a click or tap. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume * 0.8;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.startLoops();
    }
    void this.ctx.resume();
  }

  private get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  private panner(at: THREE.Vector3, ref = 4, rolloff = 1.2): PannerNode {
    const ctx = this.ctx as AudioContext;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
    p.connect(this.master as GainNode);
    return p;
  }

  private noiseLoop(dest: AudioNode, type: BiquadFilterType, freq: number, q: number, gain: number): void {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(f).connect(g).connect(dest);
    src.start();
    this.loops.push(src);
  }

  private startLoops(): void {
    const ctx = this.ctx as AudioContext;
    // The breeze: very low filtered noise with a slow swell.
    const breeze = ctx.createGain();
    breeze.gain.value = 0.05;
    breeze.connect(this.master as GainNode);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.03;
    lfo.connect(lfoGain).connect(breeze.gain);
    lfo.start();
    this.loops.push(lfo);
    this.noiseLoop(breeze, 'lowpass', 420, 0.5, 1);
    for (const s of this.spots) {
      if (s.kind === 'fountain') {
        // Splashing water: bright noise through a band, placed at the fountain.
        this.noiseLoop(this.panner(s.at, 3, 1.4), 'bandpass', 2400, 0.7, 0.16);
        this.noiseLoop(this.panner(s.at, 3, 1.4), 'lowpass', 700, 0.6, 0.08);
      } else {
        // The portal hum: two detuned low tones through a soft filter.
        const out = this.panner(s.at, 2.5, 1.6);
        const g = ctx.createGain();
        g.gain.value = 0.05;
        g.connect(out);
        for (const f of [55 * s.pitch, 55 * s.pitch * 1.503]) {
          const o = ctx.createOscillator();
          o.type = 'triangle';
          o.frequency.value = f;
          o.detune.value = Math.random() * 8 - 4;
          o.connect(g);
          o.start();
          this.loops.push(o);
        }
      }
    }
  }

  listen(camera: THREE.Camera): void {
    if (!this.ready || !this.ctx) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const f = this.fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const u = this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    if (l.positionX) {
      l.positionX.value = p.x;
      l.positionY.value = p.y;
      l.positionZ.value = p.z;
      l.forwardX.value = f.x;
      l.forwardY.value = f.y;
      l.forwardZ.value = f.z;
      l.upX.value = u.x;
      l.upY.value = u.y;
      l.upZ.value = u.z;
    }
  }

  /** Birds: a short chirp from somewhere around the listener every few seconds. */
  tick(listener: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const now = this.ctx.currentTime;
    if (now < this.nextChirp) return;
    this.nextChirp = now + 2.5 + Math.random() * 5;
    const a = Math.random() * Math.PI * 2;
    const at = new THREE.Vector3(listener.x + Math.cos(a) * 18, listener.y + 6, listener.z + Math.sin(a) * 18);
    const out = this.panner(at, 6, 1);
    const base = 2600 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 4);
    for (let i = 0; i < notes; i++) {
      const t = now + i * (0.09 + Math.random() * 0.05);
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), t);
      o.frequency.exponentialRampToValueAtTime(base * (1.3 + Math.random() * 0.4), t + 0.06);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.08);
    }
  }

  /** A duck quack (3D when `at` is given), a little higher or lower each time. */
  quack(at?: THREE.Vector3, gain = 0.32): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const k = 0.9 + Math.random() * 0.25;
    const out = at ? this.panner(at, 4, 1.1) : this.master;
    for (const [dt, f0] of [[0, 430], [0.17, 400]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0 * k, t + dt);
      o.frequency.exponentialRampToValueAtTime(260 * k, t + dt + 0.15);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1150;
      f.Q.value = 3;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(gain, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.16);
      o.connect(f).connect(g).connect(out);
      o.start(t + dt);
      o.stop(t + dt + 0.18);
    }
  }

  /** A soft UI pop (a bubble opens, an invite arrives). */
  pop(high = false): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(high ? 880 : 620, t);
    o.frequency.exponentialRampToValueAtTime(high ? 1320 : 930, t + 0.08);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.16);
  }

  /** Into a portal: a rising whoosh. */
  whoosh(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.4;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, 0, 0.85);
  }

  close(): void {
    for (const n of this.loops) {
      try {
        (n as AudioScheduledSourceNode).stop();
      } catch {
        /* already stopped */
      }
    }
    this.loops = [];
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}
