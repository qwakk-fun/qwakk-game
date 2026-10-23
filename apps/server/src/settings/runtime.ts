/**
 * The effective value of every runtime setting (settings/defs.ts), held in
 * memory. The admin panel changes them (and stores them, admin/store.ts); the
 * game reads them through the small getters here or through the objects the
 * change listeners keep up to date (bot skills, weapon damage), so the hot
 * paths read a plain field, never a lookup.
 *
 * Values are validated here: numbers are clamped into their range (and
 * rounded for integers), booleans must be booleans, text is trimmed, cut to
 * its length and stripped of control characters. An environment variable
 * named by a setting (test and benchmark switches) wins over the stored value.
 */
import { SETTING_DEFS, type SettingDef, type SettingValue } from './defs.ts';

export type SetResult = { ok: true; value: SettingValue; old: SettingValue; clamped: boolean; changed: boolean } | { ok: false; error: string };
export type Listener = (key: string, value: SettingValue, old: SettingValue) => void;

export interface SettingView extends SettingDef {
  value: SettingValue;
  isDefault: boolean;
  /** Set when an environment variable decides the value. */
  lockedBy: string | null;
}

/** Control characters and the line and paragraph separators, never kept in a text setting. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;

export class RuntimeSettings {
  readonly defs: ReadonlyMap<string, SettingDef>;
  private readonly stored = new Map<string, SettingValue>();
  private readonly env: NodeJS.ProcessEnv;
  private readonly listeners = new Set<Listener>();

  constructor(defs: readonly SettingDef[], env: NodeJS.ProcessEnv = {}) {
    this.defs = new Map(defs.map((d) => [d.key, d]));
    this.env = env;
  }

  /** Check and normalize a raw value for `key`. */
  validate(key: string, raw: unknown): { ok: true; value: SettingValue; clamped: boolean } | { ok: false; error: string } {
    const d = this.defs.get(key);
    if (!d) return { ok: false, error: 'unknown_setting' };
    if (d.kind === 'bool') return typeof raw === 'boolean' ? { ok: true, value: raw, clamped: false } : { ok: false, error: 'expected_boolean' };
    if (d.kind === 'text') {
      if (typeof raw !== 'string') return { ok: false, error: 'expected_text' };
      const clean = raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
      const max = d.maxLength ?? 200;
      return { ok: true, value: clean.slice(0, max), clamped: clean.length > max };
    }
    const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(n)) return { ok: false, error: 'expected_number' };
    let v = d.kind === 'int' ? Math.round(n) : n;
    if (d.min !== undefined) v = Math.max(d.min, v);
    if (d.max !== undefined) v = Math.min(d.max, v);
    // Keep stored numbers short: at most 6 decimals.
    if (d.kind === 'number') v = Math.round(v * 1e6) / 1e6;
    return { ok: true, value: v, clamped: v !== n };
  }

  /** The environment variable deciding `key` right now, or null. */
  lockedBy(key: string): string | null {
    const d = this.defs.get(key);
    return d?.env && this.envValue(d) !== undefined ? d.env : null;
  }

  private envValue(d: SettingDef): SettingValue | undefined {
    const raw = d.env ? this.env[d.env]?.trim() : undefined;
    if (!raw) return undefined;
    // QWAKK_DM_ROOMS opens the first N catalog rooms (the benchmark).
    if (d.key.startsWith('dm.room.')) {
      const n = Number(raw);
      if (!Number.isInteger(n)) return undefined;
      const order = [...this.defs.keys()].filter((k) => k.startsWith('dm.room.'));
      return order.indexOf(d.key) < n;
    }
    // Switches: 1 / true on, 0 / false off (QWAKK_DM_HERO=0 for tests).
    if (d.kind === 'bool') return raw === '1' || raw === 'true' ? true : raw === '0' || raw === 'false' ? false : undefined;
    const v = this.validate(d.key, raw);
    return v.ok ? v.value : undefined;
  }

  get(key: string): SettingValue {
    const d = this.defs.get(key);
    if (!d) throw new Error(`unknown setting ${key}`);
    return this.envValue(d) ?? this.stored.get(key) ?? d.default;
  }

  num(key: string): number {
    const v = this.get(key);
    return typeof v === 'number' ? v : Number(v);
  }

  bool(key: string): boolean {
    return this.get(key) === true;
  }

  text(key: string): string {
    const v = this.get(key);
    return typeof v === 'string' ? v : String(v);
  }

  /** Change a setting in memory (the caller stores it). Listeners run when the effective value changed. */
  set(key: string, raw: unknown): SetResult {
    const v = this.validate(key, raw);
    if (!v.ok) return v;
    const d = this.defs.get(key)!;
    const old = this.get(key);
    if (v.value === d.default) this.stored.delete(key);
    else this.stored.set(key, v.value);
    const now = this.get(key);
    const changed = now !== old;
    if (changed) this.emit(key, now, old);
    return { ok: true, value: v.value, old, clamped: v.clamped, changed };
  }

  /** Back to the default. */
  reset(key: string): SetResult {
    const d = this.defs.get(key);
    if (!d) return { ok: false, error: 'unknown_setting' };
    return this.set(key, d.default);
  }

  /** Stored values from the database at start: unknown keys and bad values are skipped (with a warning). */
  load(rows: readonly { key: string; value: unknown }[]): number {
    let n = 0;
    for (const r of rows) {
      const res = this.set(r.key, r.value);
      if (res.ok) n++;
      else console.warn(`[settings] stored setting ${r.key} skipped: ${res.error}`);
    }
    return n;
  }

  /** Is `key` at its default (nothing stored)? */
  isDefault(key: string): boolean {
    return !this.stored.has(key);
  }

  /** Every setting with its effective value, for the admin panel. */
  list(): SettingView[] {
    return [...this.defs.values()].map((d) => ({ ...d, value: this.get(d.key), isDefault: !this.stored.has(d.key), lockedBy: this.lockedBy(d.key) }));
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(key: string, value: SettingValue, old: SettingValue): void {
    for (const fn of this.listeners) {
      try {
        fn(key, value, old);
      } catch (err) {
        console.error(`[settings] listener for ${key} failed:`, err instanceof Error ? err.message : err);
      }
    }
  }
}

/** The process-wide settings (env switches from process.env). */
export const settings = new RuntimeSettings(SETTING_DEFS, process.env);
