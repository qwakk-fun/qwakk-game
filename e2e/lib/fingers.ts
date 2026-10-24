/**
 * Real touch input for the browser tests: DevTools Input.dispatchTouchEvent,
 * which the page sees as touch pointer events (several fingers at once).
 * Every event lists all fingers still down, as a touch screen reports them;
 * a finger lifts with a move event that leaves it out (the last with touchEnd).
 */
import type { CDPSession, Page } from 'playwright';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Fingers {
  private readonly pts = new Map<number, { x: number; y: number }>();
  private readonly cdp: CDPSession;
  constructor(cdp: CDPSession) {
    this.cdp = cdp;
  }
  private async send(type: 'touchStart' | 'touchMove' | 'touchEnd'): Promise<void> {
    const touchPoints = [...this.pts].map(([id, p]) => ({ id, x: p.x, y: p.y, radiusX: 6, radiusY: 6, force: 1 }));
    await this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  }
  async down(id: number, x: number, y: number): Promise<void> {
    this.pts.set(id, { x, y });
    await this.send('touchStart');
  }
  async up(id: number): Promise<void> {
    this.pts.delete(id);
    await this.send(this.pts.size === 0 ? 'touchEnd' : 'touchMove');
  }
  async tap(x: number, y: number, holdMs = 60): Promise<void> {
    const id = 90 + Math.floor(Math.random() * 9);
    await this.down(id, x, y);
    await sleep(holdMs);
    await this.up(id);
  }
}

/** The middle of an element on screen (CSS px). */
export async function center(p: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await p.locator(selector).boundingBox();
  if (!box) throw new Error(`${selector} is not on screen`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
