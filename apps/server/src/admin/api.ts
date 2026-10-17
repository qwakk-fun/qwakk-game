/**
 * The admin JSON API (/admin/api/*), behind a valid admin session (http.ts
 * checks the cookie, the Origin of every POST, the content type and the rate
 * limit before anything here runs). Every change is validated on the server
 * and written to the audit log: who, when, what, old and new value.
 *
 * Nothing a request says is trusted beyond its validated fields: room and
 * session ids are looked up in the live room table, player ids must be UUIDs.
 */
import { isIP } from 'node:net';
import { blockIp, listIpBlocks, MAX_BLOCK_MINUTES, unblockIp } from '../ops/ipBlocks.ts';
import { broadcastNotice, cleanNotice } from '../ops/notice.ts';
import { findRoom, liveRooms } from '../ops/rooms.ts';
import { EXTRA_WORD_RE } from '../meta/names.ts';
import { currentPreset, PRESETS, presetValues, settings, type Preset, type SettingValue, type SkillGroup } from '../settings/index.ts';
import { clientNumbers } from '../settings/clientNumbers.ts';
import type { AdminSession } from './sessions.ts';
import type { AdminStore } from './store.ts';

export interface ApiReply {
  status: number;
  body: unknown;
}

export interface ApiContext {
  session: AdminSession;
  store: AdminStore;
  overview(): Promise<unknown>;
  clearLeaderboardCache(): void;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ok = (body: unknown = { ok: true }): ApiReply => ({ status: 200, body });
const bad = (error: string, status = 400): ApiReply => ({ status, body: { error } });

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ').trim().slice(0, max) : '';
}

function obj(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

/** A setting change: memory first (it applies at once), then the store and the audit log. */
async function changeSetting(ctx: ApiContext, key: string, value: unknown, reset: boolean): Promise<ApiReply> {
  const d = settings.defs.get(key);
  if (!d) return bad('unknown_setting');
  if (d.key.startsWith('br.mode.') && value === false && !reset) {
    const on = ['br.mode.solo', 'br.mode.duo', 'br.mode.squad'].filter((k) => k !== key && settings.bool(k));
    if (on.length === 0) return bad('last_mode');
  }
  const r = reset ? settings.reset(key) : settings.set(key, value);
  if (!r.ok) return bad(r.error);
  await ctx.store.saveSetting(key, settings.isDefault(key) ? null : r.value);
  if (r.changed || reset) await ctx.store.audit(ctx.session.actor, reset ? 'setting.reset' : 'setting.set', key, r.old, settings.get(key));
  return ok({ key, value: settings.get(key), clamped: r.clamped, isDefault: settings.isDefault(key), lockedBy: settings.lockedBy(key) });
}

async function applyPreset(ctx: ApiContext, body: Record<string, unknown>): Promise<ApiReply> {
  const group = body.group === 'dmBot' || body.group === 'brBot' ? (body.group as SkillGroup) : null;
  const preset = typeof body.preset === 'string' && (PRESETS as readonly string[]).includes(body.preset) ? (body.preset as Preset) : null;
  if (!group || !preset) return bad('bad_preset');
  const values = presetValues(group, preset);
  const before: Record<string, SettingValue> = {};
  for (const [id, v] of Object.entries(values)) {
    const key = `${group}.${id}`;
    before[key] = settings.get(key);
    settings.set(key, v);
    await ctx.store.saveSetting(key, settings.isDefault(key) ? null : settings.get(key));
  }
  await ctx.store.audit(ctx.session.actor, 'setting.preset', `${group}: ${preset}`, before, values);
  return ok({ group, preset: currentPreset(settings, group) });
}

function settingsView(): unknown {
  return {
    settings: settings.list(),
    presets: { dmBot: currentPreset(settings, 'dmBot'), brBot: currentPreset(settings, 'brBot') },
    clientNumbers: clientNumbers(),
  };
}

function playerTarget(roomId: string, p: { name: string; tag: string }): string {
  return `${p.name}${p.tag ? `#${p.tag}` : ''} in ${roomId}`;
}

export async function handleApi(method: string, route: string, query: URLSearchParams, rawBody: unknown, ctx: ApiContext): Promise<ApiReply> {
  const body = obj(rawBody);
  const { store, session } = ctx;
  const actor = session.actor;
  switch (`${method} ${route}`) {
    case 'GET overview':
      return ok(await ctx.overview());
    case 'GET me':
      return ok({ actor, expiresAt: session.expiresAt, persistent: store.persistent });

    // ---- settings ----
    case 'GET settings':
      return ok({ ...(settingsView() as object), persistent: store.persistent });
    case 'POST settings/set':
      return changeSetting(ctx, String(body.key ?? ''), body.value, false);
    case 'POST settings/reset':
      return changeSetting(ctx, String(body.key ?? ''), undefined, true);
    case 'POST settings/preset':
      return applyPreset(ctx, body);

    // ---- rooms ----
    case 'GET rooms/players': {
      const room = findRoom(query.get('room') ?? '');
      if (!room) return bad('no_room', 404);
      return ok({ room: room.roomInfo(), players: room.roomPlayers() });
    }
    case 'POST rooms/kick': {
      const room = findRoom(String(body.roomId ?? ''));
      const p = room?.roomPlayers().find((x) => x.sessionId === body.sessionId);
      if (!room || !p) return bad('no_player', 404);
      room.removePlayer(p.sessionId);
      await store.audit(actor, 'room.kick', playerTarget(room.roomId, p), null, { reason: str(body.reason, 200) });
      return ok();
    }
    case 'POST rooms/close': {
      const room = findRoom(String(body.roomId ?? ''));
      if (!room) return bad('no_room', 404);
      const info = room.roomInfo();
      if (info.kind === 'dm') return bad('dm_room_use_setting');
      await room.close();
      await store.audit(actor, 'room.close', room.roomId, { humans: info.humans, phase: info.phase }, null);
      return ok();
    }
    case 'POST rooms/blockip': {
      const room = findRoom(String(body.roomId ?? ''));
      const p = room?.roomPlayers().find((x) => x.sessionId === body.sessionId);
      const ip = room && p ? room.ipOf(p.sessionId) : null;
      if (!room || !p || !ip) return bad('no_player', 404);
      const minutes = Number(body.minutes);
      if (!Number.isFinite(minutes) || minutes < 1) return bad('bad_minutes');
      const b = blockIp(ip, minutes, playerTarget(room.roomId, p));
      if (body.kick !== false) room.removePlayer(p.sessionId);
      // The audit log names the block and the player, never the address.
      await store.audit(actor, 'ip.block', `block #${b.id} (${b.label})`, null, { minutes: Math.round((b.until - b.createdAt) / 60_000) });
      return ok({ id: b.id, until: b.until });
    }

    // ---- IP blocks (memory only) ----
    case 'GET ipblocks':
      return ok({ blocks: listIpBlocks(), maxMinutes: MAX_BLOCK_MINUTES });
    case 'POST ipblocks/add': {
      const ip = str(body.ip, 64);
      if (!isIP(ip)) return bad('bad_ip');
      const minutes = Number(body.minutes);
      if (!Number.isFinite(minutes) || minutes < 1) return bad('bad_minutes');
      const label = str(body.label, 60) || 'manual';
      const b = blockIp(ip, minutes, label);
      await store.audit(actor, 'ip.block', `block #${b.id} (${b.label})`, null, { minutes: Math.round((b.until - b.createdAt) / 60_000) });
      return ok({ id: b.id, until: b.until });
    }
    case 'POST ipblocks/remove': {
      const b = unblockIp(Number(body.id));
      if (!b) return bad('no_block', 404);
      await store.audit(actor, 'ip.unblock', `block #${b.id} (${b.label})`, null, null);
      return ok();
    }

    // ---- bans ----
    case 'GET bans':
      return ok({ bans: await store.listBans() });
    case 'POST bans/add': {
      const playerId = String(body.playerId ?? '').toLowerCase();
      if (!UUID_RE.test(playerId)) return bad('bad_player');
      const hours = body.hours === null || body.hours === undefined || body.hours === '' ? null : Number(body.hours);
      if (hours !== null && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 365 * 5)) return bad('bad_hours');
      const now = Date.now();
      const ban = { playerId, reason: str(body.reason, 200), createdAt: now, expiresAt: hours === null ? null : now + Math.round(hours * 3600_000) };
      await store.addBan(ban, actor);
      let removed = 0;
      for (const r of liveRooms) removed += r.removePlayerId(playerId);
      await store.audit(actor, 'ban.add', playerId, null, { reason: ban.reason, expiresAt: ban.expiresAt === null ? null : new Date(ban.expiresAt).toISOString(), removedFromRooms: removed });
      return ok({ removed });
    }
    case 'POST bans/remove': {
      const playerId = String(body.playerId ?? '').toLowerCase();
      if (!UUID_RE.test(playerId)) return bad('bad_player');
      const had = await store.removeBan(playerId);
      await store.audit(actor, 'ban.remove', playerId, { banned: had }, { banned: false });
      return ok();
    }

    // ---- players and the leaderboard ----
    case 'GET players': {
      const q = str(query.get('q'), 40);
      if (q.length < 2) return bad('query_too_short');
      const rows = await store.searchPlayers(q);
      if (rows === null) return bad('no_database', 503);
      return ok({ players: rows });
    }
    case 'GET leaderboard/hidden':
      return ok({ hidden: await store.listHidden() });
    case 'POST leaderboard/hide': {
      const playerId = String(body.playerId ?? '').toLowerCase();
      if (!UUID_RE.test(playerId)) return bad('bad_player');
      const reason = str(body.reason, 200);
      await store.hide(playerId, reason, actor);
      ctx.clearLeaderboardCache();
      await store.audit(actor, 'leaderboard.hide', playerId, null, { reason });
      return ok();
    }
    case 'POST leaderboard/unhide': {
      const playerId = String(body.playerId ?? '').toLowerCase();
      if (!UUID_RE.test(playerId)) return bad('bad_player');
      await store.unhide(playerId);
      ctx.clearLeaderboardCache();
      await store.audit(actor, 'leaderboard.unhide', playerId, null, null);
      return ok();
    }

    // ---- blocked name words ----
    case 'GET names':
      return ok({ words: store.listWords() });
    case 'POST names/add': {
      const word = String(body.word ?? '').trim().toLowerCase();
      if (!EXTRA_WORD_RE.test(word)) return bad('bad_word');
      const whole = body.whole === true;
      await store.addWord(word, whole, actor);
      await store.audit(actor, 'name.add', word, null, { whole });
      return ok();
    }
    case 'POST names/remove': {
      const word = String(body.word ?? '').trim().toLowerCase();
      if (!EXTRA_WORD_RE.test(word)) return bad('bad_word');
      const had = await store.removeWord(word);
      await store.audit(actor, 'name.remove', word, { blocked: had }, { blocked: false });
      return ok();
    }

    // ---- notices ----
    case 'POST announce': {
      const text = cleanNotice(body.text);
      if (!text) return bad('empty_text');
      const rooms = broadcastNotice(text);
      await store.audit(actor, 'notice.send', `${rooms} rooms`, null, { text });
      return ok({ rooms });
    }

    // ---- audit log ----
    case 'GET audit': {
      const before = query.get('before');
      const b = before && /^\d{1,18}$/.test(before) ? Number(before) : null;
      const limit = Math.max(1, Math.min(200, Number(query.get('limit') ?? 50) || 50));
      return ok({ entries: await store.listAudit(b, limit), persistent: store.persistent });
    }
    default:
      return bad('not_found', 404);
  }
}
