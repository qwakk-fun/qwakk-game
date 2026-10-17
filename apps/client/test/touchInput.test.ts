/**
 * Touch input mapping: the stick vector and sprint threshold, look drags to
 * yaw and pitch, multi-touch finger roles, and the Controls latches that make
 * a tap shorter than a tick still count.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Button, NET } from '@qwakk/shared';
import { TOUCH } from '../src/input/touch/constants.ts';
import { FingerTracker, pickRole } from '../src/input/touch/pointers.ts';
import { applyLook, followCenter, stickVector } from '../src/input/touch/stick.ts';

const R = TOUCH.stickRadius;

describe('stick', () => {
  it('reads zero at the center and inside the dead zone', () => {
    expect(stickVector(0, 0)).toMatchObject({ mx: 0, mz: 0, sprint: false });
    const s = stickVector(R * TOUCH.stickDeadZone * 0.9, 0);
    expect(s.mx).toBe(0);
    expect(s.mz).toBe(0);
    expect(s.knobX).toBeGreaterThan(0);
  });

  it('maps screen up to forward and right to strafe right', () => {
    const up = stickVector(0, -R);
    expect(up.mz).toBeCloseTo(1, 6);
    expect(up.mx).toBeCloseTo(0, 6);
    const right = stickVector(R, 0);
    expect(right.mx).toBeCloseTo(1, 6);
    const back = stickVector(0, R);
    expect(back.mz).toBeCloseTo(-1, 6);
  });

  it('ramps the speed from the dead zone to the ring and clamps past it', () => {
    const half = stickVector(0, -R / 2);
    expect(half.mz).toBeCloseTo((0.5 - TOUCH.stickDeadZone) / (1 - TOUCH.stickDeadZone), 6);
    expect(half.sprint).toBe(false);
    const far = stickVector(0, -R * 3);
    expect(far.mz).toBeCloseTo(1, 6);
    expect(far.knobY).toBeCloseTo(-R, 6);
    expect(Math.hypot(stickVector(R * 2, -R * 2).mx, stickVector(R * 2, -R * 2).mz)).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('sprints only at the edge and pushed forward', () => {
    expect(stickVector(0, -R * TOUCH.sprintAt).sprint).toBe(true);
    expect(stickVector(0, -R * (TOUCH.sprintAt - 0.05)).sprint).toBe(false);
    // Forward diagonal at the edge: still sprinting.
    expect(stickVector(R * 0.7, -R * 0.7).sprint).toBe(true);
    // Sideways or back at the edge: no sprint.
    expect(stickVector(R, 0).sprint).toBe(false);
    expect(stickVector(0, R).sprint).toBe(false);
  });

  it('pulls its center along when the thumb runs past the ring', () => {
    expect(followCenter(100, 100, 100, 100 - R)).toEqual({ cx: 100, cy: 100 });
    const c = followCenter(100, 100, 100, 100 - (R + TOUCH.stickFollow + 30));
    expect(c.cx).toBeCloseTo(100, 6);
    expect(c.cy).toBeCloseTo(70, 6);
  });

  it('never returns NaN', () => {
    const s = stickVector(Number.NaN, 5);
    expect(s).toMatchObject({ mx: 0, mz: 0, sprint: false });
  });
});

describe('look', () => {
  it('turns right on a drag right and looks up on a drag up', () => {
    const k = TOUCH.lookRadPerPx;
    const r = applyLook(0, 0, 100, 0, k);
    expect(r.yaw).toBeCloseTo(-100 * k, 9);
    expect(r.pitch).toBe(0);
    const u = applyLook(0, 0, 0, -50, k);
    expect(u.pitch).toBeCloseTo(50 * k * TOUCH.lookPitchScale, 9);
  });

  it('scales with the aim multiplier and clamps pitch', () => {
    const k = TOUCH.lookRadPerPx;
    expect(applyLook(0, 0, 100, 0, k, 0.5).yaw).toBeCloseTo(-50 * k, 9);
    expect(applyLook(0, 0, 0, -1e6, k).pitch).toBe(NET.maxPitch);
    expect(applyLook(0, 0, 0, 1e6, k).pitch).toBe(NET.minPitch);
  });

  it('wraps yaw', () => {
    const r = applyLook(Math.PI - 0.01, 0, -100, 0, TOUCH.lookRadPerPx);
    expect(r.yaw).toBeLessThan(0);
    expect(r.yaw).toBeGreaterThan(-Math.PI);
  });
});

describe('fingers', () => {
  const W = 844;
  it('gives the left side to the stick, the right side to look, buttons to buttons', () => {
    expect(pickRole(null, 100, W, false, TOUCH.moveZoneShare)).toBe('stick');
    expect(pickRole(null, 700, W, false, TOUCH.moveZoneShare)).toBe('look');
    expect(pickRole('fire', 100, W, false, TOUCH.moveZoneShare)).toBe('btn:fire');
    // A second finger on the left while the stick is held looks instead.
    expect(pickRole(null, 100, W, true, TOUCH.moveZoneShare)).toBe('look');
  });

  it('tracks stick, look and fire at once, each with its own deltas', () => {
    const t = new FingerTracker();
    t.down(1, 'stick', 120, 300);
    t.down(2, 'look', 600, 200);
    t.down(3, 'btn:fire', 770, 310);
    expect(t.size).toBe(3);
    expect(t.holding('stick')?.id).toBe(1);
    expect(t.move(2, 630, 190)).toMatchObject({ dx: 30, dy: -10 });
    expect(t.move(1, 120, 260)).toMatchObject({ dx: 0, dy: -40 });
    expect(t.move(3, 775, 310)).toMatchObject({ dx: 5, dy: 0 });
    expect(t.get(2)?.travel).toBeCloseTo(Math.hypot(30, 10), 9);
    // Lifting the look finger leaves the other two alone.
    expect(t.up(2)?.role).toBe('look');
    expect(t.holding('stick')?.id).toBe(1);
    expect(t.holding('btn:fire')?.id).toBe(3);
    expect(t.move(2, 0, 0)).toBeNull();
    expect(t.up(2)).toBeNull();
    expect(t.clear().map((f) => f.id).sort()).toEqual([1, 3]);
    expect(t.size).toBe(0);
  });

  it('keeps a finger in its role when it wanders to the other side', () => {
    const t = new FingerTracker();
    t.down(7, 'stick', 100, 300);
    t.move(7, 700, 300);
    expect(t.get(7)?.role).toBe('stick');
    expect(t.count('stick')).toBe(1);
  });
});

describe('Controls with touch', () => {
  const g = globalThis as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  beforeAll(() => {
    for (const k of ['document', 'window', 'localStorage']) saved[k] = g[k];
    const noop = { addEventListener() {}, removeEventListener() {} };
    g.document = { ...noop, pointerLockElement: null };
    g.window = { ...noop };
    g.localStorage = { getItem: () => null, setItem() {} };
  });
  afterAll(() => {
    for (const k of Object.keys(saved)) g[k] = saved[k];
  });

  const make = async () => {
    const { Controls } = await import('../src/input/controls.ts');
    const c = new Controls({} as HTMLElement);
    c.touchActive = true;
    return c;
  };

  it('counts a fire tap released before the next tick, once', async () => {
    const c = await make();
    c.setTouchHeld(Button.Fire, true);
    c.setTouchHeld(Button.Fire, false);
    expect(c.sample().buttons & Button.Fire).toBe(Button.Fire);
    expect(c.sample().buttons & Button.Fire).toBe(0);
  });

  it('stops input while typing and discards held or latched actions on close', async () => {
    const c = await make();
    c.setTouchMove(1, 1);
    c.setTouchHeld(Button.Fire | Button.Aim, true);
    c.tapTouch(Button.Jump | Button.Reload);
    c.swapWeapon();
    c.setTyping(true);
    const yaw = c.yaw;
    c.lookBy(100, 100);
    expect(c.yaw).toBe(yaw);
    expect(c.sample()).toEqual({ mx: 0, mz: 0, buttons: 0 });
    c.setTouchMove(1, 0);
    c.tapTouch(Button.Jump);
    c.setTyping(false);
    expect(c.sample()).toEqual({ mx: 0, mz: 0, buttons: 0 });
    c.dispose();
  });

  it('holds fire across ticks while the finger stays down', async () => {
    const c = await make();
    c.setTouchHeld(Button.Fire, true);
    for (let i = 0; i < 3; i++) expect(c.sample().buttons & Button.Fire).toBe(Button.Fire);
    c.setTouchHeld(Button.Fire, false);
    expect(c.sample().buttons & Button.Fire).toBe(0);
  });

  it('sends taps (jump, reload, deploy) for exactly one tick', async () => {
    const c = await make();
    c.tapTouch(Button.Jump | Button.Reload);
    const b = c.sample().buttons;
    expect(b & Button.Jump).toBe(Button.Jump);
    expect(b & Button.Reload).toBe(Button.Reload);
    expect(c.sample().buttons & (Button.Jump | Button.Reload)).toBe(0);
  });

  it('toggles crouch and aim through the held state', async () => {
    const c = await make();
    c.setTouchHeld(Button.Crouch, !c.touchHeldHas(Button.Crouch));
    expect(c.sample().buttons & Button.Crouch).toBe(Button.Crouch);
    expect(c.sample().buttons & Button.Crouch).toBe(Button.Crouch);
    c.setTouchHeld(Button.Crouch, !c.touchHeldHas(Button.Crouch));
    expect(c.sample().buttons & Button.Crouch).toBe(0);
  });

  it('sends the stick axes and sprint, and swaps weapons', async () => {
    const c = await make();
    const s = stickVector(0, -R);
    c.setTouchMove(s.mx, s.mz);
    c.setTouchHeld(Button.Sprint, s.sprint);
    const f = c.sample();
    expect(f.mz).toBeCloseTo(1, 6);
    expect(f.buttons & Button.Sprint).toBe(Button.Sprint);
    c.currentSlot = 0;
    c.swapWeapon();
    expect(c.sample().buttons & Button.Slot2).toBe(Button.Slot2);
    c.clearTouch();
    const z = c.sample();
    expect(z.mx).toBe(0);
    expect(z.mz).toBe(0);
    expect(z.buttons & Button.Sprint).toBe(0);
  });

  it('turns the camera by drags, slower while aiming', async () => {
    const c = await make();
    c.yaw = 0;
    c.pitch = 0;
    c.lookBy(100, 0);
    const full = -c.yaw;
    c.yaw = 0;
    c.lookScale = 0.5;
    c.lookBy(100, 0);
    expect(-c.yaw).toBeCloseTo(full / 2, 9);
    expect(full).toBeCloseTo(100 * c.touchRadPerPx, 9);
  });

  it('never asks for pointer lock while touch drives', async () => {
    const c = await make();
    expect(() => c.requestLock()).not.toThrow();
  });
});
