/**
 * Notices: a message to everyone in game right now (a HUD line), the menu
 * banner and maintenance mode (both settings, so they survive a restart).
 */
import { get, post } from '../api.ts';
import { COPY } from '../copy.ts';
import { clear, h } from '../dom.ts';
import type { SettingsData } from '../types.ts';
import { button, card, confirmDialog, errorText, labeled, toast, type Page } from '../ui.ts';

const N = COPY.notices;
const NOTICE_MAX = 200;
const BANNER_MAX = 160;

function counted(input: HTMLInputElement | HTMLTextAreaElement, max: number): HTMLElement {
  const n = h('span', { class: 'muted small counter' }, N.chars(input.value.length, max));
  input.addEventListener('input', () => (n.textContent = N.chars(input.value.length, max)));
  return n;
}

export function noticesPage(): Page {
  // ---- message in game ----
  const text = h('textarea', { rows: 3, maxlength: NOTICE_MAX, placeholder: N.announcePlaceholder });
  const sendForm = h('form', { class: 'stack' }, text, h('div', { class: 'row-between' }, counted(text, NOTICE_MAX), h('button', { type: 'submit', class: 'btn btn-primary' }, N.send)));
  sendForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = text.value.trim();
    if (!t) return toast(COPY.errors.empty_text!, true);
    if (!(await confirmDialog(N.sendConfirm(t)))) return;
    try {
      const r = await post<{ rooms: number }>('announce', { text: t });
      toast(N.sent(r.rooms));
      text.value = '';
    } catch (err) {
      toast(errorText(err), true);
    }
  });

  // ---- banner and maintenance ----
  const banner = h('input', { type: 'text', maxlength: BANNER_MAX, placeholder: N.bannerPlaceholder });
  const note = h('input', { type: 'text', maxlength: BANNER_MAX });
  const state = h('p', { class: 'state' });
  const toggleBox = h('div', {});
  let maintenance = false;

  async function set(key: string, value: unknown): Promise<boolean> {
    try {
      await post('settings/set', { key, value });
      toast(COPY.saved);
      return true;
    } catch (err) {
      toast(errorText(err), true);
      return false;
    }
  }

  function paint(): void {
    state.textContent = maintenance ? N.stateOn : N.stateOff;
    state.className = `state ${maintenance ? 'is-on' : ''}`;
    clear(
      toggleBox,
      maintenance
        ? button(N.maintenanceOff, async () => {
            if (await set('ops.maintenance', false)) {
              maintenance = false;
              paint();
            }
          }, 'primary')
        : button(N.maintenanceOn, async () => {
            if (!(await confirmDialog(N.maintenanceConfirm, { danger: true }))) return;
            if (note.value.trim() !== noteSaved) await set('ops.maintenanceMessage', note.value);
            if (await set('ops.maintenance', true)) {
              maintenance = true;
              paint();
            }
          }, 'danger'),
    );
  }
  let noteSaved = '';

  async function load(): Promise<void> {
    try {
      const d = await get<SettingsData>('settings');
      const v = (k: string): unknown => d.settings.find((s) => s.key === k)?.value;
      banner.value = String(v('ops.banner') ?? '');
      note.value = noteSaved = String(v('ops.maintenanceMessage') ?? '');
      maintenance = v('ops.maintenance') === true;
      paint();
    } catch (err) {
      toast(errorText(err), true);
    }
  }

  const bannerForm = h(
    'form',
    { class: 'stack' },
    banner,
    h('div', { class: 'row-between' }, counted(banner, BANNER_MAX), h('div', { class: 'row' }, button(N.clear, async () => {
      if (await set('ops.banner', '')) banner.value = '';
    }), h('button', { type: 'submit', class: 'btn btn-primary' }, N.save))),
  );
  bannerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void set('ops.banner', banner.value);
  });

  const noteSave = button(N.save, async () => {
    if (await set('ops.maintenanceMessage', note.value)) noteSaved = note.value.trim();
  });

  const el = h(
    'div',
    { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', {}, N.title)),
    h(
      'div',
      { class: 'grid-2' },
      card(N.announceTitle, h('p', { class: 'muted small' }, N.announceSub), sendForm),
      card(N.bannerTitle, h('p', { class: 'muted small' }, N.bannerSub), bannerForm),
      card(N.maintenanceTitle, h('p', { class: 'muted small' }, N.maintenanceSub), state, labeled(N.messageLabel, note), h('div', { class: 'row' }, noteSave, toggleBox)),
    ),
  );
  void load();
  return { el };
}
