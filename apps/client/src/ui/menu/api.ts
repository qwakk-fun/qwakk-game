/**
 * Meta API client (/api/session, /api/leaderboard, /api/me on the game server).
 *
 * Base URL: VITE_API_BASE when set at build time, else derived from
 * VITE_GAME_SERVER (ws -> http, wss -> https), else the page host on port 2567
 * (the same default the game uses). Kept free of game imports so the menu
 * loads without Three.js or Rapier.
 */
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
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_API_BASE) return env.VITE_API_BASE.replace(/\/+$/, '');
  if (env.VITE_GAME_SERVER) return env.VITE_GAME_SERVER.replace(/^ws(s?):/, 'http$1:').replace(/\/+$/, '');
  return `${location.protocol}//${location.hostname}:2567`;
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

export function fetchMe(token: string, mode = 'all'): Promise<MeData> {
  return call<MeData>(`/api/me?${new URLSearchParams({ mode })}`, { headers: { Authorization: `Bearer ${token}` } });
}
