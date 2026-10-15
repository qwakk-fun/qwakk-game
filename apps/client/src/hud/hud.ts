/**
 * Debug HUD: frame timing, network and prediction health. Updated a few
 * times per second from numbers the game already tracks, so it costs nothing.
 */

export interface HudStats {
  fps: number;
  frameMsAvg: number;
  frameMsMax: number;
  pingMs: number;
  jitterMs: number;
  serverTick: number;
  players: number;
  backend: string;
  /** Position correction applied by the latest reconcile (m). */
  predErrorM: number;
  /** Rolling persistent drift and recent peak from the reconciler (world units). */
  driftEma: number;
  driftPeak: number;
  reconciles: number;
  pendingInputs: number;
  speed: number;
  grounded: boolean;
  netsim: string;
  sensitivity: number;
  pos: [number, number, number];
}

const fmt = (v: number, d = 1): string => (Number.isFinite(v) ? v.toFixed(d) : '-');

export class Hud {
  private readonly el: HTMLElement;
  visible: boolean;

  constructor(el: HTMLElement, visible: boolean) {
    this.el = el;
    this.visible = visible;
    this.el.style.display = visible ? '' : 'none';
  }

  toggle(): void {
    this.visible = !this.visible;
    this.el.style.display = this.visible ? '' : 'none';
  }

  render(s: HudStats): void {
    if (!this.visible) return;
    const err = s.predErrorM;
    const errClass = err > 0.25 ? 'warn' : 'ok';
    const lines = [
      `<span class="k">fps</span>      ${fmt(s.fps, 0)}  <span class="k">frame</span> ${fmt(s.frameMsAvg, 2)} ms (max ${fmt(s.frameMsMax, 1)})`,
      `<span class="k">render</span>   ${s.backend}`,
      `<span class="k">ping</span>     ${fmt(s.pingMs, 0)} ms  <span class="k">jitter</span> ${fmt(s.jitterMs, 0)} ms`,
      `<span class="k">tick</span>     ${s.serverTick}  <span class="k">players</span> ${s.players}`,
      `<span class="k">pred err</span> <span class="${errClass}">${fmt(err * 100, 1)} cm</span>  <span class="k">drift</span> ${fmt(s.driftEma * 100, 1)} / ${fmt(s.driftPeak * 100, 1)} cm`,
      `<span class="k">inputs</span>   ${s.pendingInputs} in flight  <span class="k">reconciles</span> ${s.reconciles}`,
      `<span class="k">speed</span>    ${fmt(s.speed, 2)} m/s ${s.grounded ? '' : '<span class="warn">air</span>'}`,
      `<span class="k">pos</span>      ${fmt(s.pos[0])} ${fmt(s.pos[1])} ${fmt(s.pos[2])}`,
      `<span class="k">fake net</span> ${s.netsim}`,
      `<span class="k">mouse</span>    ${fmt(s.sensitivity * 1000, 2)}  <span class="k">(- / =)</span>`,
    ];
    this.el.innerHTML = lines.join('\n');
  }
}
