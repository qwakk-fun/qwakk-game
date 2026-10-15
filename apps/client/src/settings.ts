/**
 * Player settings, saved in this browser (localStorage `qwakk.settings`).
 * Storage may be blocked (private mode, strict settings): every access is
 * wrapped and the defaults are used for the session.
 *
 * Sensitivity is stored as a multiplier of the game's default look speed
 * (0.0022 rad per mouse count). It is mirrored to `qwakk.sensitivity`, the
 * key the in-game -/= keys use, so both stay in step.
 */
/** Graphics preset the game applies: low shortens draw distances. */
export type Quality = 'low' | 'high';

export interface Settings {
  /** Look speed multiplier, 1 = default. */
  sensitivity: number;
  /** Base camera field of view in degrees. */
  fov: number;
  /** Master volume, 0 to 1. */
  volume: number;
  quality: Quality;
}

/** What the game entry takes (startGame's `settings`). */
export interface GameSettings {
  /** Radians per mouse count (the unit `Controls.sensitivity` uses). */
  sensitivity: number;
  fov: number;
  volume: number;
  quality: Quality;
}

export const BASE_SENSITIVITY = 0.0022;
export const LIMITS = {
  sensitivity: { min: 0.2, max: 3, step: 0.05 },
  fov: { min: 60, max: 100, step: 1 },
  volume: { min: 0, max: 1, step: 0.01 },
} as const;
export const DEFAULTS: Readonly<Settings> = { sensitivity: 1, fov: 75, volume: 0.7, quality: 'high' };

const KEY = 'qwakk.settings';
const LEGACY_SENS_KEY = 'qwakk.sensitivity';
const QUALITIES: readonly Quality[] = ['low', 'high'];

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked: keep it for this session only */
  }
}

/** Clamp anything into valid settings. */
export function sanitize(raw: unknown): Settings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    sensitivity: clamp(r.sensitivity, LIMITS.sensitivity.min, LIMITS.sensitivity.max, DEFAULTS.sensitivity),
    fov: Math.round(clamp(r.fov, LIMITS.fov.min, LIMITS.fov.max, DEFAULTS.fov)),
    volume: clamp(r.volume, LIMITS.volume.min, LIMITS.volume.max, DEFAULTS.volume),
    quality: QUALITIES.includes(r.quality as Quality) ? (r.quality as Quality) : DEFAULTS.quality,
  };
}

export function loadSettings(): Settings {
  const stored = read(KEY);
  if (stored) {
    try {
      return sanitize(JSON.parse(stored));
    } catch {
      /* fall through to defaults */
    }
  }
  // First run: pick up a sensitivity set earlier with the in-game -/= keys.
  const legacy = Number(read(LEGACY_SENS_KEY));
  return sanitize({ ...DEFAULTS, sensitivity: legacy > 0 ? legacy / BASE_SENSITIVITY : DEFAULTS.sensitivity });
}

export function saveSettings(s: Settings): Settings {
  const clean = sanitize(s);
  write(KEY, JSON.stringify(clean));
  write(LEGACY_SENS_KEY, String(clean.sensitivity * BASE_SENSITIVITY));
  return clean;
}

export function resetSettings(): Settings {
  return saveSettings({ ...DEFAULTS });
}

export function toGameSettings(s: Settings): GameSettings {
  return { sensitivity: s.sensitivity * BASE_SENSITIVITY, fov: s.fov, volume: s.volume, quality: s.quality };
}
