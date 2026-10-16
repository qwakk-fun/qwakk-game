import type { IncomingMessage, Server as HttpServer } from 'node:http';

/**
 * The client address for rate limits. Kept in memory only, never stored.
 *
 * X-Forwarded-For is client-controlled except for the entries our own proxies
 * appended, so it is read only when TRUST_PROXY says how many proxies we run
 * (CapRover's nginx: 1), taking that many entries from the RIGHT. Without
 * TRUST_PROXY the socket address is used and the header is ignored.
 */
export function clientIp(remoteAddress: string | undefined, forwardedFor: string | string[] | null | undefined, trustProxyHops: number): string {
  if (trustProxyHops > 0 && forwardedFor) {
    const list = (Array.isArray(forwardedFor) ? forwardedFor.join(',') : forwardedFor)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const pick = list[list.length - trustProxyHops] ?? list[0];
    if (pick) return normalizeIp(pick);
  }
  return normalizeIp(remoteAddress ?? 'unknown');
}

/** Strip IPv4-mapped IPv6 prefixes and ports. */
export function normalizeIp(ip: string): string {
  let s = ip.trim().toLowerCase();
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']') > 0 ? s.indexOf(']') : undefined);
  if (s.startsWith('::ffff:') && s.includes('.')) s = s.slice(7);
  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(s)) s = s.slice(0, s.lastIndexOf(':'));
  return s || 'unknown';
}

/**
 * Rate-limit key for an address. IPv6 users usually get a whole /64, so one
 * person could rotate through billions of addresses: limit the /64 instead.
 */
export function ipKey(ip: string): string {
  const s = normalizeIp(ip);
  if (!s.includes(':')) return s;
  const [head = '', tail = ''] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = s.includes('::') ? [...h, ...new Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t] : h;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/**
 * Make Colyseus see the address WE trust. Colyseus 0.18 builds `context.ip`
 * from X-Real-IP, then the first X-Forwarded-For hop, then X-Client-IP, all
 * client-controlled. Before Colyseus reads the upgrade request, overwrite
 * X-Real-IP with our own answer (socket address, or the TRUST_PROXY hop) and
 * drop X-Client-IP, so `context.ip` in onAuth is safe for `allowJoin`.
 */
export function guardClientIp(req: IncomingMessage, trustProxyHops: number): string {
  const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], trustProxyHops);
  delete req.headers['x-client-ip'];
  req.headers['x-real-ip'] = ip;
  return ip;
}

/**
 * Rewrite the headers of every upgrade (joins) and plain request (matchmaking,
 * where room creation is limited per IP, see matchmaking.ts) before ANY
 * listener sees it. A prepended listener is not enough: Colyseus prepends its
 * own matchmaking listener when the server starts listening, after we are
 * installed, and copies the headers right away. So the guard sits in `emit`.
 */
export function installClientIpGuard(server: HttpServer, trustProxyHops: number): void {
  const emit = server.emit.bind(server) as (event: string | symbol, ...args: unknown[]) => boolean;
  server.emit = ((event: string | symbol, ...args: unknown[]): boolean => {
    if (event === 'request' || event === 'upgrade') guardClientIp(args[0] as IncomingMessage, trustProxyHops);
    return emit(event, ...args);
  }) as typeof server.emit;
}
