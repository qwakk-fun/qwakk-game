/**
 * Settings: every server-only number, grouped, with its range, default, when
 * it applies and a reset. A field saves when it changes (the server checks
 * and clamps it and logs it). Bot groups have a difficulty preset; their
 * knobs fold away under it. The client-simulated numbers are listed read only.
 */
import { get, post } from '../api.ts';
import { COPY } from '../copy.ts';
import { clear, h } from '../dom.ts';
import type { Overview, Setting, SettingsData, SettingValue } from '../types.ts';
import { button, card, confirmDialog, errorText, toast, type Page } from '../ui.ts';

const S = COPY.settings;
const GROUPS = ['dm', 'dmBot', 'br', 'brBot', 'raid', 'weapons'] as const;

function fmt(v: SettingValue, unit?: string): string {
  if (typeof v === 'boolean') return v ? S.on : S.off;
  return unit ? `${v} ${unit}` : String(v);
}

export function settingsPage(): Page {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted' }, COPY.loading));
  const el = h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', {}, S.title), h('span', { class: 'muted' }, S.sub)), body);
  const openGroups = new Set<string>();

  async function load(): Promise<void> {
    try {
      render(await get<SettingsData>('settings'));
    } catch (err) {
      clear(body, h('p', { class: 'error' }, errorText(err)), button(COPY.retry, () => void load()));
    }
  }

  function render(data: SettingsData): void {
    const sections: HTMLElement[] = [];
    if (!data.persistent) sections.push(h('div', { class: 'banner is-warn' }, COPY.notSaved));
    for (const g of GROUPS) {
      const list = data.settings.filter((s) => s.group === g);
      if (list.length === 0) continue;
      const rows = list.map((s) => row(s));
      if (g === 'dmBot' || g === 'brBot') {
        const preset = data.presets[g];
        const details = h('details', { class: 'fold', open: openGroups.has(g) }, h('summary', {}, S.knobs(list.length)), ...rows);
        details.addEventListener('toggle', () => (details.open ? openGroups.add(g) : openGroups.delete(g)));
        sections.push(card(S.groups[g] ?? g, presetBar(g, preset), details));
      } else sections.push(card(S.groups[g] ?? g, ...rows));
    }
    const client = h(
      'details',
      { class: 'fold' },
      h('summary', {}, S.clientTitle),
      h('p', { class: 'muted' }, S.clientSub),
      h('table', { class: 'table compact' }, h('tbody', {}, ...data.clientNumbers.map((n) => h('tr', {}, h('td', { class: 'muted' }, n.group), h('td', {}, n.label), h('td', { class: 'mono' }, n.value))))),
    );
    sections.push(card(null, client));
    clear(body, ...sections);
  }

  function presetBar(group: 'dmBot' | 'brBot', current: string): HTMLElement {
    const bar = h('div', { class: 'segmented', role: 'group', 'aria-label': S.preset });
    for (const p of ['easy', 'normal', 'hard']) {
      const b = h('button', { type: 'button', class: `seg${current === p ? ' is-on' : ''}`, 'aria-pressed': current === p ? 'true' : 'false' }, S.presets[p] ?? p);
      b.addEventListener('click', async () => {
        if (!(await confirmDialog(S.presetConfirm(S.groups[group] ?? group, S.presets[p] ?? p)))) return;
        try {
          await post('settings/preset', { group, preset: p });
          toast(COPY.saved);
          await load();
        } catch (err) {
          toast(errorText(err), true);
        }
      });
      bar.append(b);
    }
    return h('div', { class: 'preset' }, h('span', { class: 'preset-label' }, S.preset), bar, current === 'custom' ? h('span', { class: 'badge' }, S.presets.custom) : null);
  }

  function row(s: Setting): HTMLElement {
    const id = `set-${s.key.replace(/\W/g, '-')}`;
    const meta = h('p', { class: 'setting-meta' });
    const reset = button(S.reset, () => void save(s, null), 'ghost', { class: 'btn btn-ghost btn-sm' });
    let control: HTMLElement;
    let setValue: (v: SettingValue) => void;
    if (s.kind === 'bool') {
      const input = h('input', { id, type: 'checkbox', role: 'switch', checked: s.value === true, disabled: Boolean(s.lockedBy) });
      input.addEventListener('change', () => void save(s, input.checked, input));
      control = h('label', { class: 'switch' }, input, h('span', { class: 'switch-track', 'aria-hidden': 'true' }));
      setValue = (v) => (input.checked = v === true);
    } else {
      const input = h('input', { id, type: 'number', inputmode: s.kind === 'int' ? 'numeric' : 'decimal', min: s.min, max: s.max, step: s.step ?? (s.kind === 'int' ? 1 : 'any'), value: String(s.value), disabled: Boolean(s.lockedBy) });
      input.addEventListener('change', () => void save(s, Number(input.value), input));
      control = h('div', { class: 'num' }, input, s.unit ? h('span', { class: 'unit' }, s.unit) : null);
      setValue = (v) => (input.value = String(v));
    }
    const paint = (): void => {
      reset.hidden = s.isDefault || Boolean(s.lockedBy);
      const parts = [S.defaultIs(fmt(s.default, s.unit))];
      if (s.min !== undefined && s.max !== undefined) parts.push(`${s.min} to ${s.max}`);
      if (s.lockedBy) parts.push(S.lockedBy(s.lockedBy));
      meta.textContent = parts.join(' · ');
      rowEl.classList.toggle('is-changed', !s.isDefault);
    };

    async function save(target: Setting, value: SettingValue | null, input?: HTMLInputElement): Promise<void> {
      // Closing a deathmatch room with players in it: ask first.
      if (target.key.startsWith('dm.room.') && value === false) {
        const room = (await get<Overview>('overview').catch(() => null))?.rooms.find((r) => `dm.room.${r.roomId}` === target.key);
        const n = room ? room.humans + room.spectators : 0;
        if (n > 0 && !(await confirmDialog(S.closeDmConfirm(room?.label ?? target.label, n), { danger: true }))) {
          setValue(target.value);
          return;
        }
      }
      if (input) input.disabled = true;
      try {
        const r = value === null ? await post<{ value: SettingValue; isDefault: boolean; clamped: boolean }>('settings/reset', { key: target.key }) : await post<{ value: SettingValue; isDefault: boolean; clamped: boolean }>('settings/set', { key: target.key, value });
        target.value = r.value;
        target.isDefault = r.isDefault;
        setValue(r.value);
        toast(r.clamped ? S.clamped : COPY.saved, r.clamped);
      } catch (err) {
        setValue(target.value);
        toast(errorText(err), true);
      } finally {
        if (input) input.disabled = Boolean(target.lockedBy);
        paint();
      }
    }

    const rowEl = h(
      'div',
      { class: 'setting' },
      h('div', { class: 'setting-text' }, h('div', { class: 'setting-title' }, h('label', { for: id }, s.label), h('span', { class: `applies is-${s.applies}` }, S.applies[s.applies] ?? s.applies)), h('p', { class: 'setting-help' }, s.help), meta),
      h('div', { class: 'setting-control' }, control, reset),
    );
    paint();
    return rowEl;
  }

  void load();
  return { el };
}
