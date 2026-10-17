/**
 * Meta API client (/api/session, /api/leaderboard, /api/me on the game server).
 *
 * Base URL: VITE_API_BASE when set at build time, else the game server's
 * origin (net/endpoint.ts: VITE_GAME_SERVER, else the page's own origin in
 * public builds, else the page host on port 2567 in dev and test builds).
 * Kept free of game imports so the menu loads without Three.js or Rapier.
 */
import type { ServerStatus } from '@qwakk/shared/lobby';
import { defaultApiBase, defaultGameServer } from '../../net/endpoint.ts';

export interface SessionInfo {
  token: string;
  expiresAt: number;
  deviceToken: string;
  playerId: string;
  name: string;
  tag: string;
}

export interface Standing {
  rank: number;
  name: string;
  tag: string;
  score: number;
  wins: number;
  kills: number;
  deaths: number;
  kd: number;
  matches: number;
  avgPlace: number;
  damage: number;
}

export interface LeaderboardData {
  season: { id: number; name: string; startsAt: string; endsAt: string | null };
  mode: 'all' | 'br' | 'dm';
  sort: string;
  total: number;
  updatedAt: string;
  rows: Standing[];
}

export interface MeData {
  player: { playerId: string; name: string; tag: string };
  total: number;
  standing: Standing | null;
  leaderboard: boolean;
}

/** An API error: `code` is the server's error string, or 'unreachable'. */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function apiBase(): string {
  return defaultApiBase();
}

/**
 * Game server WebSocket endpoint for the lobby (room list): the same default
 * as the game (net/endpoint.ts); `?server=` only in dev and test builds.
 */
export function gameServer(): string {
  if (import.meta.env.DEV || import.meta.env.VITE_DEVTOOLS === '1') {
    const fromUrl = new URLSearchParams(location.search).get('server');
    if (fromUrl) return fromUrl;
  }
  return defaultGameServer();
}

async function call<T>(path: string, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${apiBase()}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs), credentials: 'omit' });
  } catch {
    throw new ApiError('unreachable', 0);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const code = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : 'generic';
    throw new ApiError(code, res.status);
  }
  return body as T;
}

export function createSession(name: string, deviceToken?: string, turnstileToken?: string): Promise<SessionInfo> {
  return call<SessionInfo>('/api/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...(deviceToken ? { deviceToken } : {}), ...(turnstileToken ? { turnstileToken } : {}) }),
  });
}

export function fetchLeaderboard(mode: string, sort: string): Promise<LeaderboardData> {
  return call<LeaderboardData>(`/api/leaderboard?${new URLSearchParams({ mode, sort })}`);
}

/** The menu banner, maintenance and the rules the server runs now. */
export function fetchStatus(): Promise<ServerStatus> {
  return call<ServerStatus>('/api/status', {}, 5000);
}

export function fetchMe(token: string, mode = 'all'): Promise<MeData> {
  return call<MeData>(`/api/me?${new URLSearchParams({ mode })}`, { headers: { Authorization: `Bearer ${token}` } });
}
