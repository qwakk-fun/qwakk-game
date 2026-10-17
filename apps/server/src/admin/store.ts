/**
 * What the admin panel keeps: settings that differ from the defaults, the
 * audit log, bans, players hidden from the leaderboard and extra blocked name
 * words (migration 002_admin.sql). With the database up they are stored;
 * without one (dev, or the database down) they live in memory until the next
 * restart, and the panel says so. IP blocks are never here (memory only,
 * ops/ipBlocks.ts).
 *
 * `load()` reads everything into the live state (settings, ops/bans.ts, the
 * name filter) once the database is up.
 */
import type { Sql } from 'postgres';
import { setExtraBlocked } from '../meta/names.ts';
import { dropBan, listBans, putBan, replaceBans, type Ban } from '../ops/bans.ts';
import { settings, type SettingValue } from '../settings/index.ts';

export interface AuditEntry {
  id: number;
  at: string;
  actor: string;
  action: string;
  target: string;
  old: unknown;
  new: unknown;
}

export interface HiddenPlayer {
  playerId: string;
  reason: string;
  createdAt: number;
  name: string | null;
  tag: string | null;
}

export interface BlockedWord {
  word: string;
  whole: boolean;
  createdAt: number;
}

export interface PlayerRow {
  playerId: string;
  name: string;
  tag: string;
  createdAt: string;
  lastSeen: string;
  banned: boolean;
  hidden: boolean;
}

const MEMORY_AUDIT = 500;
/** Audit values are cut to this many characters of JSON, so a long text cannot bloat the log. */
const MAX_AUDIT_JSON = 2000;

/** An audit value as stored: null for none, a long one cut to MAX_AUDIT_JSON characters of its JSON. */
function auditValue(v: unknown): unknown {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(v);
  return s.length > MAX_AUDIT_JSON ? { cut: s.slice(0, MAX_AUDIT_JSON) } : v;
}

export class AdminStore {
  private readonly db: () => Sql | null;
  private readonly memAudit: AuditEntry[] = [];
  private memId = 0;
  private readonly memHidden = new Map<string, HiddenPlayer>();
  private readonly words = new Map<string, BlockedWord>();
  loaded = false;

  constructor(db: () => Sql | null) {
    this.db = db;
  }

  /** Is the database up (changes are stored)? */
  get persistent(): boolean {
    return this.db() !== null;
  }

  /** Read the stored state into the live game state. False when the database is not up yet. */
  async load(): Promise<boolean> {
    const sql = this.db();
    if (!sql) return false;
    const rows = await sql<{ key: string; value: unknown }[]>`select key, value from admin_settings`;
    const n = settings.load(rows);
    const bans = await sql<{ player_id: string; reason: string; created_at: Date; expires_at: Date | null }[]>`
      select player_id, reason, created_at, expires_at from bans where expires_at is null or expires_at > now()`;
    replaceBans(bans.map((b) => ({ playerId: b.player_id, reason: b.reason, createdAt: b.created_at.getTime(), expiresAt: b.expires_at ? b.expires_at.getTime() : null })));
    const words = await sql<{ word: string; whole: boolean; created_at: Date }[]>`select word, whole, created_at from blocked_names`;
    this.words.clear();
    for (const w of words) this.words.set(w.word, { word: w.word, whole: w.whole, createdAt: w.created_at.getTime() });
    setExtraBlocked([...this.words.values()]);
    this.loaded = true;
    console.log(`[admin] state loaded: ${n} settings, ${bans.length} bans, ${words.length} blocked words`);
    return true;
  }

  // ---- settings and audit ------------------------------------------------

  /** Store a setting (null deletes it: back to the default). */
  async saveSetting(key: string, value: SettingValue | null): Promise<void> {
    const sql = this.db();
    if (!sql) return;
    if (value === null) await sql`delete from admin_settings where key = ${key}`;
    else
      await sql`insert into admin_settings (key, value, updated_at) values (${key}, ${sql.json(value)}, now())
        on conflict (key) do update set value = excluded.value, updated_at = now()`;
  }

  async audit(actor: string, action: string, target: string, oldValue: unknown, newValue: unknown): Promise<void> {
    const sql = this.db();
    if (sql) {
      try {
        const o = auditValue(oldValue);
        const n = auditValue(newValue);
        await sql`insert into admin_audit (actor, action, target, old_value, new_value)
          values (${actor}, ${action}, ${target.slice(0, 200)}, ${o === null ? null : sql.json(o as never)}, ${n === null ? null : sql.json(n as never)})`;
        return;
      } catch (err) {
        console.error('[admin] audit write failed, kept in memory:', err instanceof Error ? err.message : err);
      }
    }
    this.memAudit.unshift({ id: ++this.memId, at: new Date().toISOString(), actor, action, target: target.slice(0, 200), old: auditValue(oldValue), new: auditValue(newValue) });
    if (this.memAudit.length > MEMORY_AUDIT) this.memAudit.length = MEMORY_AUDIT;
  }

  /** Newest first; `before` pages back by id. */
  async listAudit(before: number | null, limit: number): Promise<AuditEntry[]> {
    const sql = this.db();
    if (!sql) return this.memAudit.filter((e) => before === null || e.id < before).slice(0, limit);
    const rows = await sql<{ id: string; at: Date; actor: string; action: string; target: string; old_value: unknown; new_value: unknown }[]>`
      select id, at, actor, action, target, old_value, new_value from admin_audit
      where (${before}::bigint is null or id < ${before}::bigint)
      order by id desc limit ${limit}`;
    const mem = this.memAudit.filter((e) => before === null);
    return [...mem, ...rows.map((r) => ({ id: Number(r.id), at: r.at.toISOString(), actor: r.actor, action: r.action, target: r.target, old: r.old_value, new: r.new_value }))].slice(0, limit);
  }

  // ---- bans ----------------------------------------------------------------

  async addBan(b: Ban, actor: string): Promise<void> {
    const sql = this.db();
    if (sql) {
      await sql`insert into bans (player_id, reason, created_at, expires_at, created_by)
        values (${b.playerId}, ${b.reason}, ${new Date(b.createdAt)}, ${b.expiresAt === null ? null : new Date(b.expiresAt)}, ${actor})
        on conflict (player_id) do update set reason = excluded.reason, created_at = excluded.created_at, expires_at = excluded.expires_at, created_by = excluded.created_by`;
    }
    putBan(b);
  }

  async removeBan(playerId: string): Promise<boolean> {
    const sql = this.db();
    if (sql) await sql`delete from bans where player_id = ${playerId}`;
    return dropBan(playerId);
  }

  /** Active bans with the player's name and tag when known. */
  async listBans(): Promise<(Ban & { name: string | null; tag: string | null })[]> {
    const list = listBans();
    const names = await this.namesOf(list.map((b) => b.playerId));
    return list.map((b) => ({ ...b, name: names.get(b.playerId)?.name ?? null, tag: names.get(b.playerId)?.tag ?? null }));
  }

  // ---- leaderboard -----------------------------------------------------------

  async hide(playerId: string, reason: string, actor: string): Promise<void> {
    const sql = this.db();
    if (sql)
      await sql`insert into leaderboard_hidden (player_id, reason, created_by) values (${playerId}, ${reason}, ${actor})
        on conflict (player_id) do update set reason = excluded.reason`;
    else this.memHidden.set(playerId, { playerId, reason, createdAt: Date.now(), name: null, tag: null });
  }

  async unhide(playerId: string): Promise<boolean> {
    const sql = this.db();
    if (!sql) return this.memHidden.delete(playerId);
    const r = await sql`delete from leaderboard_hidden where player_id = ${playerId}`;
    return r.count > 0;
  }

  async listHidden(): Promise<HiddenPlayer[]> {
    const sql = this.db();
    if (!sql) return [...this.memHidden.values()];
    const rows = await sql<{ player_id: string; reason: string; created_at: Date; name: string | null; tag: number | null }[]>`
      select h.player_id, h.reason, h.created_at, p.name, p.tag from leaderboard_hidden h
      left join players p on p.id = h.player_id order by h.created_at desc limit 500`;
    return rows.map((r) => ({ playerId: r.player_id, reason: r.reason, createdAt: r.created_at.getTime(), name: r.name, tag: r.tag === null ? null : String(r.tag) }));
  }

  // ---- blocked name words ---------------------------------------------------

  async addWord(word: string, whole: boolean, actor: string): Promise<void> {
    const sql = this.db();
    if (sql)
      await sql`insert into blocked_names (word, whole, created_by) values (${word}, ${whole}, ${actor})
        on conflict (word) do update set whole = excluded.whole`;
    this.words.set(word, { word, whole, createdAt: Date.now() });
    setExtraBlocked([...this.words.values()]);
  }

  async removeWord(word: string): Promise<boolean> {
    const sql = this.db();
    if (sql) await sql`delete from blocked_names where word = ${word}`;
    const had = this.words.delete(word);
    setExtraBlocked([...this.words.values()]);
    return had;
  }

  listWords(): BlockedWord[] {
    return [...this.words.values()].sort((a, b) => a.word.localeCompare(b.word));
  }

  // ---- players ----------------------------------------------------------------

  /** Guests whose name starts with `q` (case-insensitive), or the one with this exact id. Null: no database. */
  async searchPlayers(q: string): Promise<PlayerRow[] | null> {
    const sql = this.db();
    if (!sql) return null;
    const isId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(q);
    const pattern = `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = await sql<{ id: string; name: string; tag: number; created_at: Date; last_seen: Date; hidden: boolean }[]>`
      select p.id, p.name, p.tag, p.created_at, p.last_seen, (h.player_id is not null) as hidden
      from players p left join leaderboard_hidden h on h.player_id = p.id
      where ${isId ? sql`p.id = ${q}::uuid` : sql`lower(p.name) like lower(${pattern})`}
      order by p.last_seen desc limit 50`;
    const banned = new Set(listBans().map((b) => b.playerId));
    return rows.map((r) => ({ playerId: r.id, name: r.name, tag: String(r.tag), createdAt: r.created_at.toISOString(), lastSeen: r.last_seen.toISOString(), banned: banned.has(r.id), hidden: r.hidden }));
  }

  private async namesOf(ids: string[]): Promise<Map<string, { name: string; tag: string }>> {
    const sql = this.db();
    const out = new Map<string, { name: string; tag: string }>();
    if (!sql || ids.length === 0) return out;
    const rows = await sql<{ id: string; name: string; tag: number }[]>`select id, name, tag from players where id = any(${ids}::uuid[])`;
    for (const r of rows) out.set(r.id, { name: r.name, tag: String(r.tag) });
    return out;
  }
}
