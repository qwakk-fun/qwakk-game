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

  /** Deathmatch kill stack gained: a quick rising pair, a step higher per stack (1 to 5). */
  stackUp(stacks: number): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const base = 440 * Math.pow(2, (Math.min(5, stacks) * 2) / 12);
    this.tone(this.master, t, 'triangle', base, base * 1.5, 0.14, 0.16);
    this.tone(this.master, t + 0.07, 'sine', base * 1.5, base * 2, 0.18, 0.12);
    if (stacks >= 5) this.noiseBurst(this.master, t, 0.3, 9000, 2500, 0.08, 2);
  }

  /** Caped hero announced: a short brass-like fanfare (louder when it is you). */
  heroFanfare(mine: boolean): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const g = mine ? 0.2 : 0.11;
    [392, 523, 659, 784].forEach((hz, i) => {
      this.tone(this.master!, t + i * 0.09, 'sawtooth', hz, hz, i === 3 ? 0.5 : 0.12, g * 0.6);
      this.tone(this.master!, t + i * 0.09, 'triangle', hz * 2, hz * 2, i === 3 ? 0.5 : 0.12, g * 0.5);
    });
  }

  /** A hero takes off: an upward whoosh, in 3D. */
  heroTakeOff(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t, 0.45, 600, 5000, 0.35, 3);
    this.tone(dest, t, 'sine', 180, 520, 0.3, 0.14);
  }

  /** A hero lands: a soft thump and a puff, in 3D. */
  heroLand(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'sine', 120, 50, 0.18, 0.35);
    this.noiseBurst(dest, t, 0.25, 2500, 300, 0.25, 1);
  }

  /** The hero compass updated: a faint blip. */
  heroPing(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    this.tone(this.master, this.ctx.currentTime, 'sine', 1320, 1320, 0.09, 0.05);
  }

  // ---- Hunt Season (all synthesized) ----

  /** A hunter's duck call (wooden, nasal, a two-note honk), in 3D: a decoy thrower is near, or a decoy is about to pop. */
  duckCall(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    for (const [dt, f0, f1] of [[0, 520, 300], [0.16, 480, 260]] as const) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f0, t + dt);
      o.frequency.exponentialRampToValueAtTime(f1, t + dt + 0.13);
      const f = this.ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 900;
      f.Q.value = 5;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + dt);
      g.gain.exponentialRampToValueAtTime(0.22, t + dt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.14);
      o.connect(f).connect(g).connect(dest);
      o.start(t + dt);
      o.stop(t + dt + 0.16);
    }
  }

  /** The Big Hunter's whistle: two shrill toots, in 3D. */
  whistle(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    for (const dt of [0, 0.38]) {
      this.tone(dest, t + dt, 'sine', 2900, 3200, 0.28, 0.25);
      this.tone(dest, t + dt, 'sine', 3050, 3350, 0.28, 0.12);
      this.noiseBurst(dest, t + dt, 0.25, 7000, 4000, 0.05, 6);
    }
  }

  /** Wave start: a hunting horn (a low, then a rising brass note); the boss wave plays it twice, lower. */
  horn(boss = false): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const base = boss ? 147 : 196;
    const notes = boss ? [base, base, base * 1.5] : [base, base * 1.5];
    notes.forEach((hz, i) => {
      const at = t + i * 0.42;
      this.tone(this.master!, at, 'sawtooth', hz, hz * 1.01, 0.5, 0.12);
      this.tone(this.master!, at, 'triangle', hz * 2, hz * 2.02, 0.5, 0.08);
    });
  }

  /** A wave cleared: a short bright cheer of notes. */
  waveClear(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [523, 659, 784, 1047].forEach((hz, i) => this.tone(this.master!, t + i * 0.07, 'triangle', hz, hz, 0.22, 0.12));
  }

  /** A decoy pops: a hollow wooden bonk and a puff, in 3D. */
  decoyPop(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'sine', 300, 90, 0.2, 0.45);
    this.tone(dest, t, 'square', 700, 300, 0.06, 0.12);
    this.noiseBurst(dest, t, 0.35, 3000, 300, 0.4, 1);
  }

  /** A trap snaps shut: a sharp clack and a rope zip, in 3D. */
  trapSnap(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t, 0.05, 6000, 1500, 0.5, 4);
    this.noiseBurst(dest, t + 0.04, 0.25, 4000, 900, 0.2, 2);
  }

  /** The core takes a hit (throttled by the server): a dull crystal knock. */
  coreKnock(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 'sine', 160, 70, 0.18, 0.18);
  }

  /** A bread cannon fires: a deep wooden thump and a puff of flour, in 3D (louder and unpanned when it is ours). */
  cannonThump(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'sine', 120, 38, 0.4, 0.8);
    this.tone(dest, t, 'triangle', 260, 90, 0.12, 0.25);
    this.noiseBurst(dest, t, 0.3, 2400, 180, 0.5, 0.7);
  }

  /** A loaf lands: a soft doughy bonk and a crumbly burst, in 3D. */
  breadBonk(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'sine', 210, 70, 0.22, 0.5);
    this.tone(dest, t + 0.02, 'square', 520, 260, 0.05, 0.08);
    this.noiseBurst(dest, t, 0.4, 2600, 260, 0.35, 0.9);
  }

  /** Something big goes into the moat: a splash, in 3D. */
  splash(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t, 0.5, 5000, 700, 0.55, 1.2);
    this.noiseBurst(dest, t + 0.12, 0.6, 1800, 300, 0.25, 0.8);
    this.tone(dest, t, 'sine', 240, 90, 0.25, 0.2);
  }

  /** The drawbridge moves: a run of chain rattles and a ratchet, in 3D. */
  chainRattle(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 9; i++) this.noiseBurst(dest, t + i * 0.11 + Math.random() * 0.03, 0.06, 7000, 2200, 0.22, 5);
    this.tone(dest, t, 'sawtooth', 70, 55, 0.9, 0.06);
  }

  /** The lever: a heavy wooden clunk. */
  leverClunk(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'sine', 180, 80, 0.15, 0.4);
    this.noiseBurst(dest, t, 0.08, 3000, 800, 0.3, 3);
  }

  /** Hunters hammer the gate (throttled by the server): a hollow wooden thud, in 3D. */
  gateKnock(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'sine', 130, 60, 0.2, 0.4);
    this.noiseBurst(dest, t, 0.12, 1500, 300, 0.2, 2);
  }

  /** The gate breaks: a crack and splinters, in 3D. */
  gateBreak(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(dest, t, 0.08, 8000, 2000, 0.7, 3);
    this.tone(dest, t, 'sine', 160, 45, 0.5, 0.5);
    for (let i = 1; i < 5; i++) this.noiseBurst(dest, t + i * 0.07, 0.07, 5000, 1500, 0.2, 4);
  }

  /** A duck repairing the gate: a light hammer tap. */
  repairTap(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'square', 1200, 700, 0.04, 0.05);
    this.tone(dest, t, 'sine', 330, 200, 0.07, 0.15);
  }

  /** The cannon overheats: a steam hiss. */
  overheatHiss(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(this.master, t, 1.1, 9000, 3000, 0.25, 0.5);
  }

  /** A card picked: a soft click and a sparkle. */
  cardPick(): void {
    if (!this.ready || !this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.tone(this.master, t, 'triangle', 880, 1320, 0.12, 0.12);
    this.tone(this.master, t + 0.06, 'sine', 1760, 1760, 0.18, 0.06);
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

  /**
   * An explosion: a low sine thump with a pitch drop, a wide noise burst
   * sweeping down, and a crackle tail. `distance` (m) dulls and delays nothing
   * (the panner does the level); far blasts lose their top end.
   */
  explosion(at?: THREE.Vector3, distance = 0): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    const top = distance > 60 ? 900 : distance > 25 ? 2200 : 5000;
    this.tone(dest, t, 'sine', 95, 28, 0.9, 1.0);
    this.tone(dest, t, 'triangle', 60, 22, 0.6, 0.5);
    this.noiseBurst(dest, t, 0.8, top, 80, 1.1, 0.6);
    this.noiseBurst(dest, t + 0.05, 1.3, top * 0.5, 60, 0.45, 0.4);
    for (let i = 0; i < 5; i++) this.noiseBurst(dest, t + 0.12 + Math.random() * 0.5, 0.06, 3000, 900, 0.12, 2);
  }

  /** A rocket leaving the launcher: a hollow pop and a rising rushing hiss. */
  rocketLaunch(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    this.tone(dest, t, 'sine', 180, 60, 0.18, 0.6);
    this.rush(dest, t, 0.7, 400, 2600, 0.5);
  }

  /** A rocket rushing past close by. */
  rocketWhoosh(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (dest) this.rush(dest, this.ctx.currentTime, 0.45, 2400, 500, 0.45);
  }

  /** Band-passed noise whose center sweeps from f0 to f1 (whooshes). */
  private rush(dest: AudioNode, t: number, dur: number, f0: number, f1: number, gain: number): void {
    const ctx = this.ctx as Ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.Q.value = 1.4;
    filt.frequency.setValueAtTime(f0, t);
    filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(t, Math.random() * 0.4, dur + 0.05);
  }

  /** A grenade throw: a short cloth whoosh (and a pin click for our own). */
  grenadeThrow(at?: THREE.Vector3): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    if (!at) this.tone(dest, t, 'square', 3200, 2600, 0.025, 0.08);
    this.rush(dest, t + 0.03, 0.22, 900, 2400, 0.25);
  }

  /** A grenade bouncing: a small metallic tick, louder for a harder bounce (0..1). */
  grenadeTick(at?: THREE.Vector3, strength = 1): void {
    if (!this.ready || !this.ctx) return;
    const dest = this.out(at);
    if (!dest) return;
    const t = this.ctx.currentTime;
    const k = Math.max(0.15, Math.min(1, strength));
    this.tone(dest, t, 'triangle', 2100 + Math.random() * 300, 1500, 0.07, 0.22 * k);
    this.noiseBurst(dest, t, 0.04, 6000, 2000, 0.14 * k, 3);
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
