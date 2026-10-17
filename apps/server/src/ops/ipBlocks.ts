/**
 * Temporary IP blocks, in memory only: never written to disk, the database or
 * the audit log (CLAUDE.md: per-IP data stays in memory). A block has an end
 * (at most a day) and is gone on every server restart. Keys are the same as
 * the rate limits (`ipKey`: IPv4 address, IPv6 per /64), so a blocked IPv6
 * user cannot step to the next address.
 *
 * Checked at every WebSocket upgrade (meta admitSocket), every room join
 * (gameRoom onAuth) and every new session (createSession).
 */
import { ipKey } from '../meta/ip.ts';

export interface IpBlock {
  id: number;
  key: string;
  /** What the admin sees: a label, never stored ("Duck#1234 in istanbul" or "manual"). */
  label: string;
  until: number;
  createdAt: number;
}

export const MAX_BLOCK_MINUTES = 24 * 60;
const MAX_BLOCKS = 10_000;

const blocks = new Map<string, IpBlock>();
let nextId = 1;

export function isIpBlocked(ip: string, now = Date.now()): boolean {
  if (blocks.size === 0) return false;
  const key = ipKey(ip);
  const b = blocks.get(key);
  if (!b) return false;
  if (b.until <= now) {
    blocks.delete(key);
    return false;
  }
  return true;
}

export function blockIp(ip: string, minutes: number, label: string, now = Date.now()): IpBlock {
  const key = ipKey(ip);
  const m = Math.max(1, Math.min(MAX_BLOCK_MINUTES, Math.round(minutes)));
  if (blocks.size >= MAX_BLOCKS) prune(now);
  const b: IpBlock = { id: nextId++, key, label: label.slice(0, 80), until: now + m * 60_000, createdAt: now };
  blocks.set(key, b);
  return b;
}

export function unblockIp(id: number): IpBlock | null {
  for (const [key, b] of blocks) {
    if (b.id === id) {
      blocks.delete(key);
      return b;
    }
  }
  return null;
}

function prune(now: number): void {
  for (const [key, b] of blocks) if (b.until <= now) blocks.delete(key);
}

/** Active blocks for the admin panel: the address is masked (the last part hidden). */
export function listIpBlocks(now = Date.now()): { id: number; masked: string; label: string; until: number; createdAt: number }[] {
  prune(now);
  return [...blocks.values()].sort((a, b) => b.createdAt - a.createdAt).map((b) => ({ id: b.id, masked: maskKey(b.key), label: b.label, until: b.until, createdAt: b.createdAt }));
}

/** 203.0.113.7 as 203.0.113.x, an IPv6 /64 as its first two groups. */
export function maskKey(key: string): string {
  if (key.includes(':')) return `${key.split(':').slice(0, 2).join(':')}:...`;
  const p = key.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.x` : 'unknown';
}

export function clearIpBlocks(): void {
  blocks.clear();
}
