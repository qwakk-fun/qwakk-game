/**
 * The signed-in duck's Hunt Season progression as the server stores it
 * (`/api/duck`, the game session token): level, XP, Tüy, gear, the skill
 * tree. The menu's My Duck page and the plaza's shop panel both read and
 * change it through here; every change is a request the server checks (the
 * client only names what to buy, wear or raise), and the answer is the new
 * stored state. Pure DOM-free logic, no game imports.
 */
import type { DuckProgressView } from '@qwakk/shared/duck';
import { ApiError, call } from '../api.ts';

type Listener = () => void;

/** A key that makes a retried purchase or respec a no-op on the server (8 to 64 of [A-Za-z0-9_-]). */
export function idemKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export class DuckStore {
  view: DuckProgressView | null = null;
  /** The last load failed (offline, the database down). */
  failed = false;
  loading = false;
  /** A write in flight (buttons wait). */
  busy = false;
  private readonly listeners = new Set<Listener>();
  private readonly token: () => Promise<string | null>;
  private seq = 0;
  /**
   * One idempotency key per user action (a purchase of one item, a respec),
   * kept until the server answered for sure: a retry after a lost answer
   * (offline, a timeout, a server error) sends the same key, so the server
   * answers the stored result instead of charging again.
   */
  private readonly keys = new Map<string, string>();

  constructor(token: () => Promise<string | null>) {
    this.token = token;
  }

  on(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** The duck changed (switch duck, log out): forget what we had. */
  reset(): void {
    this.seq++;
    this.keys.clear();
    this.view = null;
    this.failed = false;
    this.loading = false;
    this.busy = false;
    this.emit();
  }

  async load(): Promise<void> {
    const seq = ++this.seq;
    this.loading = true;
    this.emit();
    try {
      const token = await this.token();
      if (!token) throw new ApiError('needs_account', 403);
      const r = await call<{ duck: DuckProgressView }>('/api/duck', { headers: { Authorization: `Bearer ${token}` } });
      if (seq !== this.seq) return;
      this.view = r.duck;
      this.failed = false;
    } catch {
      if (seq !== this.seq) return;
      this.failed = true;
    } finally {
      if (seq === this.seq) {
        this.loading = false;
        this.emit();
      }
    }
  }

  /** A checked write; resolves to null on success or the server's error code. `action`: the idempotency key's action (buy, respec). */
  async act(path: 'buy' | 'equip' | 'tree' | 'respec', body: Record<string, string>, action?: string): Promise<string | null> {
    if (this.busy) return 'busy';
    this.busy = true;
    this.emit();
    const seq = this.seq;
    let key: string | undefined;
    if (action) {
      key = this.keys.get(action) ?? idemKey();
      this.keys.set(action, key);
    }
    try {
      const token = await this.token();
      if (!token) return 'needs_account';
      const r = await call<{ duck: DuckProgressView }>(`/api/duck/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(key ? { ...body, key } : body),
      });
      if (seq === this.seq) this.view = r.duck;
      if (action) this.keys.delete(action);
      return null;
    } catch (err) {
      // The server answered for sure (a refusal): the next try is a new action. Unsure (no answer, a server error, a limit): keep the key.
      const sure = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
      if (action && sure) this.keys.delete(action);
      return err instanceof ApiError ? err.code : 'generic';
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  buy(item: string): Promise<string | null> {
    return this.act('buy', { item }, `buy:${item}`);
  }

  equip(item: string): Promise<string | null> {
    return this.act('equip', { item });
  }

  spend(node: string): Promise<string | null> {
    return this.act('tree', { node });
  }

  respec(): Promise<string | null> {
    return this.act('respec', {}, 'respec');
  }
}
