/**
 * Dashboard: live numbers (players, connections, tick time, CPU, memory),
 * every open room with its phase and clock, and per room the humans in it
 * with Kick, Block IP and Ban. Refreshes every 3 s while the tab is visible.
 */
import { get, post } from '../api.ts';
import { COPY } from '../copy.ts';
import { clear, h } from '../dom.ts';
import type { Overview, RoomInfo, RoomPlayer } from '../types.ts';
import { button, card, clock, confirmDialog, duration, errorText, toast, type Page } from '../ui.ts';
import { banDialog } from './banDialog.ts';

const D = COPY.dashboard;
const REFRESH_MS = 3000;

function tile(label: string, value: string, sub = '', tone = ''): HTMLElement {
  return h('div', { class: `tile${tone ? ` is-${tone}` : ''}` }, h('div', { class: 'tile-label' }, label), h('div', { class: 'tile-value' }, value), sub ? h('div', { class: 'tile-sub' }, sub) : null);
}

function tickTone(p95: number): string {
  return p95 > 25 ? 'bad' : p95 > 15 ? 'warn' : '';
}

export function dashboardPage(): Page {
  const tiles = h('div', { class: 'tiles' });
  const banners = h('div', { class: 'banners' });
  const roomsEl = h('div', { class: 'rooms' });
  const liveEl = h('span', { class: 'live' }, D.live);
  const el = h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', {}, D.title), liveEl), banners, tiles, card(D.roomsTitle, roomsEl));
  const open = new Set<string>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let busy = false;

  async function refresh(): Promise<void> {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const o = await get<Overview>('overview');
      render(o);
      await renderOpenRooms(o.rooms);
    } catch (err) {
      clear(tiles, h('p', { class: 'error' }, errorText(err)));
    } finally {
      busy = false;
    }
  }

  function render(o: Overview): void {
    const s = o.server;
    clear(
      banners,
      o.status.maintenance ? h('div', { class: 'banner is-warn' }, D.maintenanceOn) : null,
      o.status.banner ? h('div', { class: 'banner' }, D.bannerOn(o.status.banner)) : null,
      s.persistent ? null : h('div', { class: 'banner is-warn' }, COPY.notSaved),
    );
    clear(
      tiles,
      tile(D.players, String(o.players.inGame), D.spectators(o.players.spectators)),
      tile(D.connections, String(o.players.connections), D.connectionsSub),
      tile(D.rooms, String(o.rooms.length), D.bots(o.players.bots)),
      tile(D.tick, `${s.tickP95Ms} ms`, D.tickSub(s.tickAvgMs, s.tickP95Ms), tickTone(s.tickP95Ms)),
      tile(D.cpu, `${s.cpuPct}%`, D.cpuSub, s.cpuPct > 120 ? 'warn' : ''),
      tile(D.memory, `${s.rssMb} MB`, D.memorySub(s.heapUsedMb), s.rssMb > 800 ? 'warn' : ''),
      tile(D.loop, `${s.loopDelayP99Ms} ms`, D.loopSub, s.loopDelayP99Ms > 30 ? 'warn' : ''),
      tile(D.uptime, duration(s.uptimeS), s.node),
      tile(D.version, s.version, s.commit),
      tile(D.database, s.db, '', s.db === 'up' || s.db === 'off' ? '' : 'bad'),
    );
    if (o.rooms.length === 0) {
      clear(roomsEl, h('p', { class: 'muted' }, D.noRooms));
      return;
    }
    clear(roomsEl, ...o.rooms.map((r) => roomRow(r)));
  }

  function roomRow(r: RoomInfo): HTMLElement {
    const label = r.label || r.roomId;
    const players = h('div', { class: 'room-players', 'data-room': r.roomId, hidden: !open.has(r.roomId) });
    const toggle = button(`${D.players_} (${r.humans + r.spectators})`, () => {
      if (open.has(r.roomId)) open.delete(r.roomId);
      else open.add(r.roomId);
      players.hidden = !open.has(r.roomId);
      if (!players.hidden) void loadPlayers(r, players);
    });
    const actions = h('div', { class: 'room-actions' }, toggle);
    if (r.kind === 'br')
      actions.append(
        button(
          D.close,
          async () => {
            if (!(await confirmDialog(D.closeConfirm(label, r.humans + r.spectators), { danger: true }))) return;
            try {
              await post('rooms/close', { roomId: r.roomId });
              toast(COPY.saved);
              void refresh();
            } catch (err) {
              toast(errorText(err), true);
            }
          },
          'danger',
        ),
      );
    const phase = COPY.phases[r.phase] ?? r.phase;
    return h(
      'article',
      { class: 'room' },
      h(
        'div',
        { class: 'room-main' },
        h('div', { class: 'room-name' }, h('span', { class: `badge is-${r.kind}` }, r.kind === 'dm' ? 'DM' : 'BR'), h('strong', {}, label), h('span', { class: 'muted mono' }, r.kind === 'br' ? `#${r.roomId.slice(0, 4).toUpperCase()}` : r.mapId)),
        h(
          'dl',
          { class: 'room-stats' },
          h('div', {}, h('dt', {}, D.cols.mode), h('dd', {}, r.mode)),
          h('div', {}, h('dt', {}, D.cols.ducks), h('dd', {}, `${r.humans} + ${r.bots} bots${r.spectators ? `, ${r.spectators} watching` : ''}`)),
          h('div', {}, h('dt', {}, D.cols.phase), h('dd', {}, r.secondsLeft > 0 ? `${phase} ${clock(r.secondsLeft)}` : phase)),
          h('div', {}, h('dt', {}, D.cols.tick), h('dd', { class: tickTone(r.tick.p95) ? `is-${tickTone(r.tick.p95)}` : '' }, r.tick.samples ? `${r.tick.p95} ms` : '-')),
        ),
        actions,
      ),
      players,
    );
  }

  async function renderOpenRooms(rooms: RoomInfo[]): Promise<void> {
    for (const r of rooms) {
      if (!open.has(r.roomId)) continue;
      const box = roomsEl.querySelector<HTMLElement>(`.room-players[data-room="${CSS.escape(r.roomId)}"]`);
      if (box) await loadPlayers(r, box);
    }
  }

  async function loadPlayers(r: RoomInfo, box: HTMLElement): Promise<void> {
    try {
      const data = await get<{ players: RoomPlayer[] }>(`rooms/players?room=${encodeURIComponent(r.roomId)}`);
      if (data.players.length === 0) {
        clear(box, h('p', { class: 'muted' }, D.noPlayers));
        return;
      }
      clear(box, h('ul', { class: 'plist' }, ...data.players.map((p) => playerRow(r, p))));
    } catch (err) {
      clear(box, h('p', { class: 'error' }, errorText(err)));
    }
  }

  function playerRow(r: RoomInfo, p: RoomPlayer): HTMLElement {
    const who = `${p.name}${p.tag ? `#${p.tag}` : ''}`;
    const act = async (path: string, body: unknown, msg: string, ask: string): Promise<void> => {
      if (!(await confirmDialog(ask, { danger: true }))) return;
      try {
        await post(path, body);
        toast(msg);
        void refresh();
      } catch (err) {
        toast(errorText(err), true);
      }
    };
    const meta = [p.spectator ? D.spectator : D.kd(p.kills, p.deaths), p.alive || p.spectator ? '' : D.dead, D.ping(p.pingMs), p.playerId ? '' : D.unsigned].filter(Boolean).join(' · ');
    return h(
      'li',
      { class: 'prow' },
      h('div', { class: 'prow-who' }, h('strong', {}, who), h('span', { class: 'muted' }, meta)),
      h(
        'div',
        { class: 'prow-actions' },
        button(D.kick, () => void act('rooms/kick', { roomId: r.roomId, sessionId: p.sessionId }, D.kicked, D.kickConfirm(who))),
        button(D.blockIp, () => void act('rooms/blockip', { roomId: r.roomId, sessionId: p.sessionId, minutes: 60 }, D.blocked, D.blockConfirm(who))),
        p.playerId ? button(D.ban, () => void banDialog(p.playerId!, who).then((done) => { if (done) void refresh(); }), 'danger') : null,
      ),
    );
  }

  const onVisible = (): void => {
    liveEl.textContent = document.hidden ? D.paused : D.live;
    if (!document.hidden) void refresh();
  };
  document.addEventListener('visibilitychange', onVisible);
  void refresh();
  timer = setInterval(() => void refresh(), REFRESH_MS);
  return {
    el,
    stop() {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
