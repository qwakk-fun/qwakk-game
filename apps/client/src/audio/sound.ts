/**
 * Every sound in the game is synthesized here with WebAudio: no sample files,
 * so there is nothing to license (see LICENSES.md). Other players' guns are
 * placed in 3D with an HRTF panner; the listener follows the camera.
 */
import * as THREE from 'three/webgpu';

type Ctx = AudioContext;

export class Sound {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  volume = 0.7;
  private readonly fwd = new THREE.Vector3();
  private readonly up = new THREE.Vector3();

  /** Master volume, 0 to 1 (the menu's setting). */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.master) this.master.gain.value = this.volume;
  }

  /** Stop all audio (the game ended). */
  close(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }

  /** Browsers start audio only after a user gesture: call this from a click. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    void this.ctx.resume();
  }

  private get ready(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  /** Move the listener with the camera. */
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

  /** Output for a sound: straight to the master, or through a 3D panner at `at`. */
  private out(at?: THREE.Vector3): AudioNode | null {
    if (!this.ctx || !this.master) return null;
    if (!at) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.rolloffFactor = 1.1;
    p.positionX.value = at.x;
    p.positionY.value = at.y;
    p.positionZ.value = at.z;
    p.connect(this.master);
    return p;
  }

  private noiseBurst(dest: AudioNode, t: number, dur: number, f0: number, f1: number, gain: number, q = 0.8): void {
    const ctx = this.ctx as Ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  private tone(dest: AudioNode, t: number, type: OscillatorType, f0: number, f1: number, dur: number, gain: number): void {
    const ctx = this.ctx as Ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** Gunshot: a filtered noise crack plus a low thump. Local shots are louder and unpanned. */
  shot(weapon: number, at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    if (weapon === 0) {
      this.noiseBurst(dest, t, 0.16, 7000, 500, 0.9);
      this.tone(dest, t, 'sine', 140, 45, 0.14, 0.7);
    } else {
      this.noiseBurst(dest, t, 0.11, 9000, 900, 0.75);
      this.tone(dest, t, 'triangle', 220, 70, 0.09, 0.5);
    }
  }

  dryFire(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    this.tone(this.master, this.ctx.currentTime, 'square', 1800, 1200, 0.03, 0.15);
  }

  /** Reload: mag out, mag in, slide. Times fit the reload length. */
  reload(seconds: number, at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    const click = (when: number, f: number) => {
      this.noiseBurst(dest, t + when, 0.05, f, f / 3, 0.35, 4);
      this.tone(dest, t + when, 'square', f / 4, f / 6, 0.03, 0.12);
    };
    click(0.15, 3000);
    click(seconds * 0.55, 2400);
    click(seconds * 0.85, 4200);
  }

  /** Magazine moments of a reload (the clip's timeline): out, fresh from the pouch, seated. */
  magClick(e: 'out' | 'fresh' | 'in', at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    const f = e === 'out' ? 3000 : e === 'in' ? 4200 : 1700;
    this.noiseBurst(dest, t, 0.05, f, f / 3, e === 'fresh' ? 0.18 : 0.35, 4);
    this.tone(dest, t, 'square', f / 4, f / 6, 0.03, e === 'fresh' ? 0.06 : 0.12);
    // Seating the magazine: a second, lower clack.
    if (e === 'in') this.noiseBurst(dest, t + 0.07, 0.06, 1800, 600, 0.3, 4);
  }

  /** Short, ascending reward motif. Uses the player's existing volume/mute setting. */
  reward(level = 0): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const notes = level >= 10 ? [523, 659, 784, 1047] : level >= 5 ? [440, 554, 880] : level >= 3 ? [440, 659, 784] : [659, 880];
    notes.forEach((hz, i) => this.tone(this.master!, this.ctx!.currentTime + i * 0.085, 'sine', hz, hz, 0.16, 0.12));
  }

  /** Hit marker tick. */
  hit(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    this.tone(this.master, this.ctx.currentTime, 'square', 2600, 2200, 0.035, 0.18);
  }

  /** Headshot: a bright bell "ding". */
  headshot(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 'sine', 1760, 1740, 0.45, 0.35);
    this.tone(this.master, t, 'sine', 2640, 2620, 0.3, 0.18);
    this.tone(this.master, t, 'sine', 3520, 3500, 0.2, 0.08);
  }

  /** Kill confirm: a rising chime and a little quack. */
  kill(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 'triangle', 880, 880, 0.12, 0.3);
    this.tone(this.master, t + 0.08, 'triangle', 1320, 1320, 0.22, 0.3);
    this.quack(t + 0.12, 0.35);
  }

  /** A duck quack: a nasal buzz through a formant filter with a pitch drop. */
  quack(when?: number, gain = 0.3): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(420, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.16);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1150;
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    o.connect(f).connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.2);
  }

  /** Taking damage: a dull thud. */
  hurt(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 'sine', 110, 50, 0.18, 0.6);
    this.noiseBurst(this.master, t, 0.08, 1200, 300, 0.3);
  }

  /** Bullet passing close by or hitting near the player. */
  impactNear(at: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (dest) this.noiseBurst(dest, this.ctx.currentTime, 0.06, 5000, 1500, 0.25, 2);
  }

  /** Picking something up: a soft double click. */
  pickup(): void {
    const out = this.out();
    if (!this.ready || !out || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, 'triangle', 660, 880, 0.06, 0.12);
    this.tone(out, t + 0.07, 'triangle', 880, 1100, 0.07, 0.1);
  }

  /** A crate lid swinging open: a wooden creak, then the lid knocking back. 3D at the crate. */
  crateOpen(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'sawtooth', 190, 260, 0.22, 0.05);
    this.noiseBurst(dest, t, 0.18, 1800, 600, 0.12, 3);
    this.noiseBurst(dest, t + 0.32, 0.09, 900, 200, 0.4, 1);
    this.tone(dest, t + 0.32, 'sine', 160, 70, 0.12, 0.35);
  }

  /** A pickup or a request that did not go through: a short low double blip. */
  deny(): void {
    const out = this.out();
    if (!this.ready || !out || !this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(out, t, 'square', 240, 220, 0.06, 0.06);
    this.tone(out, t + 0.08, 'square', 180, 160, 0.08, 0.06);
  }

  /** Winning: a little rising quack fanfare. */
  victory(): void {
    const out = this.out();
    if (!this.ready || !out || !this.ctx) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1046].forEach((f, i) => this.tone(out, t + i * 0.12, 'square', f, f * 1.01, 0.16, 0.08));
    this.quack(t + 0.55, 0.35);
  }
}
