/** The ban dialog (reason and duration), used from the room list and the player search. */
import { post } from '../api.ts';
import { COPY } from '../copy.ts';
import { h } from '../dom.ts';
import { confirmDialog, errorText, labeled, toast } from '../ui.ts';

const M = COPY.moderation;

/** Ask for a reason and a duration, then ban. True when the ban went through. */
export async function banDialog(playerId: string, who: string): Promise<boolean> {
  const reason = h('input', { type: 'text', maxlength: 200, placeholder: M.reason });
  const hours = h('select', {}, ...M.durations.map(([v, label]) => h('option', { value: v, selected: v === '24' }, label)));
  if (!(await confirmDialog(M.banTitle(who), { danger: true, confirmLabel: M.ban, fields: [labeled(M.reason, reason), labeled(M.duration, hours)] }))) return false;
  try {
    await post('bans/add', { playerId, reason: reason.value, hours: hours.value === '' ? null : Number(hours.value) });
    toast(M.banDone);
    return true;
  } catch (err) {
    toast(errorText(err), true);
    return false;
  }
}
