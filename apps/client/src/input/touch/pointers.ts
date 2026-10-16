/**
 * Multi-touch bookkeeping: which finger (pointer id) does what. A finger
 * keeps the role it started with until it lifts, so a thumb that drifts from
 * the stick into the look side keeps moving, and a fire thumb that slides
 * off the button keeps firing (and aiming, see touchControls.ts). Pure, unit
 * tested.
 */

/** What a finger does: the stick, a look drag, or a button by id. */
export type Role = 'stick' | 'look' | `btn:${string}`;

export interface Finger {
  id: number;
  role: Role;
  /** Where it landed and where it was last seen (CSS px). */
  x0: number;
  y0: number;
  x: number;
  y: number;
  /** Total travel since it landed (px), for the look slop. */
  travel: number;
  /** performance.now() when it landed. */
  t0: number;
}

export class FingerTracker {
  private readonly fingers = new Map<number, Finger>();

  /** A finger landed. A second down for a known id (a lost up) replaces the old one. */
  down(id: number, role: Role, x: number, y: number, t = 0): Finger {
    const f: Finger = { id, role, x0: x, y0: y, x, y, travel: 0, t0: t };
    this.fingers.set(id, f);
    return f;
  }

  /** A finger moved: its delta since the last event, or null for an unknown finger. */
  move(id: number, x: number, y: number): { dx: number; dy: number; finger: Finger } | null {
    const f = this.fingers.get(id);
    if (!f) return null;
    const dx = x - f.x;
    const dy = y - f.y;
    f.x = x;
    f.y = y;
    f.travel += Math.hypot(dx, dy);
    return { dx, dy, finger: f };
  }

  /** A finger lifted (or was cancelled): its record, or null. */
  up(id: number): Finger | null {
    const f = this.fingers.get(id) ?? null;
    this.fingers.delete(id);
    return f;
  }

  get(id: number): Finger | undefined {
    return this.fingers.get(id);
  }

  /** The finger holding this role, if any (the stick and each button take one finger). */
  holding(role: Role): Finger | undefined {
    for (const f of this.fingers.values()) if (f.role === role) return f;
    return undefined;
  }

  /** How many fingers hold this role. */
  count(role: Role): number {
    let n = 0;
    for (const f of this.fingers.values()) if (f.role === role) n++;
    return n;
  }

  get size(): number {
    return this.fingers.size;
  }

  /** Forget every finger (pause, page hidden); returns them so their buttons can be released. */
  clear(): Finger[] {
    const all = [...this.fingers.values()];
    this.fingers.clear();
    return all;
  }
}

/**
 * The role of a new finger: a button it landed on, else the stick on the
 * left side (one finger only; a second finger there looks), else a look drag.
 */
export function pickRole(button: string | null, x: number, width: number, stickTaken: boolean, moveShare: number): Role {
  if (button) return `btn:${button}`;
  if (x < width * moveShare && !stickTaken) return 'stick';
  return 'look';
}
