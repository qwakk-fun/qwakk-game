import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BASE_SENSITIVITY, DEFAULTS, loadSettings, resetSettings, sanitize, saveSettings, toGameSettings } from '../../src/settings.ts';

class MemoryStorage {
  map = new Map<string, string>();
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const g = globalThis as { localStorage?: unknown };
let store: MemoryStorage;
beforeEach(() => {
  store = new MemoryStorage();
  g.localStorage = store;
});
afterEach(() => {
  delete g.localStorage;
});

describe('settings', () => {
  it('defaults on first run', () => {
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('persists and reloads, mirroring the in-game sensitivity key', () => {
    saveSettings({ sensitivity: 1.5, adsSensitivity: 0.6, fov: 90, volume: 0.25, quality: 'low' });
    expect(loadSettings()).toEqual({ sensitivity: 1.5, adsSensitivity: 0.6, fov: 90, volume: 0.25, quality: 'low' });
    expect(Number(store.getItem('qwakk.sensitivity'))).toBeCloseTo(1.5 * BASE_SENSITIVITY, 10);
  });

  it('clamps garbage', () => {
    expect(sanitize({ sensitivity: 99, adsSensitivity: 0, fov: -5, volume: 'loud', quality: 'medium' })).toEqual({ sensitivity: 3, adsSensitivity: 0.2, fov: 60, volume: DEFAULTS.volume, quality: DEFAULTS.quality });
    store.setItem('qwakk.settings', '{broken json');
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('picks up a sensitivity set with the -/= keys before the menu existed', () => {
    store.setItem('qwakk.sensitivity', String(BASE_SENSITIVITY * 2));
    expect(loadSettings().sensitivity).toBeCloseTo(2, 10);
  });

  it('resets', () => {
    saveSettings({ sensitivity: 2, adsSensitivity: 1.2, fov: 100, volume: 0, quality: 'low' });
    expect(resetSettings()).toEqual(DEFAULTS);
    expect(loadSettings()).toEqual(DEFAULTS);
  });

  it('works when storage throws (private mode)', () => {
    g.localStorage = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };
    expect(loadSettings()).toEqual(DEFAULTS);
    expect(saveSettings({ ...DEFAULTS, fov: 80 }).fov).toBe(80);
  });

  it('converts to the game unit', () => {
    expect(toGameSettings({ sensitivity: 1, adsSensitivity: 0.8, fov: 75, volume: 0.7, quality: 'high' })).toEqual({ sensitivity: BASE_SENSITIVITY, adsSensitivity: 0.8, fov: 75, volume: 0.7, quality: 'high' });
  });
});
