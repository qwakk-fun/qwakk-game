/**
 * Cloudflare Turnstile, only when VITE_TURNSTILE_SITEKEY is set at build time.
 * The script loads on demand (when a NEW guest needs a session), never on
 * page load, so returning players and dev builds never contact Cloudflare.
 */
interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export function turnstileSiteKey(): string {
  return (import.meta.env as Record<string, string | undefined>).VITE_TURNSTILE_SITEKEY ?? '';
}

export function turnstileEnabled(): boolean {
  return turnstileSiteKey() !== '';
}

let loading: Promise<TurnstileApi> | null = null;

function loadScript(): Promise<TurnstileApi> {
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile missing')));
    s.onerror = () => {
      loading = null;
      reject(new Error('turnstile blocked'));
    };
    document.head.append(s);
  });
  return loading;
}

/** Run the check in `host` and resolve with its token. */
export async function getTurnstileToken(host: HTMLElement): Promise<string> {
  const api = await loadScript();
  host.hidden = false;
  return new Promise<string>((resolve, reject) => {
    const id = api.render(host, {
      sitekey: turnstileSiteKey(),
      theme: 'dark',
      appearance: 'interaction-only',
      callback: (token: string) => {
        resolve(token);
        setTimeout(() => {
          api.remove(id);
          host.hidden = true;
        }, 0);
      },
      'error-callback': () => reject(new Error('turnstile_failed')),
      'expired-callback': () => reject(new Error('turnstile_failed')),
    });
  });
}
