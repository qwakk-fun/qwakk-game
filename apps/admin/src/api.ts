/**
 * Calls to the admin API on this origin (/admin/api/*). The session cookie
 * goes along by itself (same origin, HttpOnly); the browser adds the Origin
 * header the server checks on every POST. A 401 means the session ended:
 * back to the login page.
 */

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/admin/api/${path}`, { ...init, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new ApiError('unreachable', 0);
  }
  if (res.status === 401) {
    location.assign('/admin?e=expired');
    throw new ApiError('unauthorized', 401);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const code = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `http_${res.status}`;
    throw new ApiError(code, res.status);
  }
  return body as T;
}

export function get<T>(path: string): Promise<T> {
  return call<T>(path);
}

export function post<T = { ok: true }>(path: string, body: unknown): Promise<T> {
  return call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
