/** Settings tab: sliders saved on every change (settings.ts). */
import { DEFAULTS, LIMITS, loadSettings, resetSettings, saveSettings, type Quality, type Settings } from '../../settings.ts';
import { COPY } from './copy.ts';
import { h } from './dom.ts';

const S = COPY.settings;

interface SliderSpec {
  key: 'sensitivity' | 'fov' | 'volume';
  label: string;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}

const SLIDERS: SliderSpec[] = [
  { key: 'sensitivity', label: S.sensitivity, ...LIMITS.sensitivity, format: (v) => `${v.toFixed(2)}x` },
  { key: 'fov', label: S.fov, ...LIMITS.fov, format: (v) => `${Math.round(v)}°` },
  { key: 'volume', label: S.volume, ...LIMITS.volume, format: (v) => `${Math.round(v * 100)}%` },
];

export class SettingsPanel {
  readonly el: HTMLElement;
  private settings: Settings = loadSettings();
  private readonly inputs = new Map<string, { input: HTMLInputElement; out: HTMLOutputElement; spec: SliderSpec }>();
  private readonly qualityButtons: HTMLButtonElement[] = [];
  private readonly saved: HTMLElement;
  private savedTimer = 0;

  constructor(showQuality: boolean) {
    this.saved = h('span', { class: 'qm-saved', role: 'status' });
    const rows = SLIDERS.map((spec) => {
      const id = `qm-set-${spec.key}`;
      const input = h('input', { id, type: 'range', min: spec.min, max: spec.max, step: spec.step });
      const out = h('output', { for: id, class: 'qm-val' });
      input.addEventListener('input', () => this.update({ [spec.key]: Number(input.value) }));
      this.inputs.set(spec.key, { input, out, spec });
      return h('div', { class: 'qm-set-row' }, h('label', { for: id }, spec.label), out, input);
    });
    const quality = showQuality
      ? h(
          'div',
          { class: 'qm-set-row' },
          h('span', { class: 'qm-set-label', id: 'qm-q-label' }, S.quality),
          h(
            'div',
            { class: 'qm-seg', role: 'radiogroup', 'aria-labelledby': 'qm-q-label' },
            ...(Object.entries(S.qualities) as [Quality, string][]).map(([q, text]) => {
              const b = h('button', { type: 'button', role: 'radio', 'data-q': q }, text);
              b.addEventListener('click', () => this.update({ quality: q }));
              this.qualityButtons.push(b);
              return b;
            }),
          ),
        )
      : null;
    const reset = h('button', { type: 'button', class: 'qm-btn qm-btn-ghost qm-btn-sm' }, S.reset);
    reset.addEventListener('click', () => {
      this.settings = resetSettings();
      this.render();
      this.flashSaved();
    });
    this.el = h(
      'div',
      { class: 'qm-panel-inner qm-settings' },
      h('div', { class: 'qm-panel-head' }, h('h2', {}, S.heading), h('p', { class: 'qm-sub' }, S.sub)),
      h('div', { class: 'qm-set-list' }, ...rows, quality),
      h('div', { class: 'qm-set-foot' }, reset, this.saved),
    );
    this.render();
  }

  get current(): Settings {
    return this.settings;
  }

  private update(patch: Partial<Settings>): void {
    this.settings = saveSettings({ ...this.settings, ...patch });
    this.render();
    this.flashSaved();
  }

  private flashSaved(): void {
    this.saved.textContent = S.saved;
    clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => (this.saved.textContent = ''), 1400);
  }

  private render(): void {
    for (const { input, out, spec } of this.inputs.values()) {
      const v = this.settings[spec.key];
      if (Number(input.value) !== v) input.value = String(v);
      out.textContent = spec.format(v);
      const pct = ((v - spec.min) / (spec.max - spec.min)) * 100;
      input.style.setProperty('--fill', `${pct}%`);
      input.setAttribute('aria-valuetext', spec.format(v));
      input.classList.toggle('is-default', v === DEFAULTS[spec.key]);
    }
    for (const b of this.qualityButtons) {
      const on = b.dataset.q === this.settings.quality;
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }
}
