/**
 * Every tunable number of the touch controls (input/touch). Sizes are CSS
 * pixels; the layout itself lives in touch.css.
 */
export const TOUCH = {
  /** Joystick: how far the knob travels from where the thumb landed (px). */
  stickRadius: 56,
  /** Below this share of the radius the stick reads as centered. */
  stickDeadZone: 0.12,
  /** At or past this share of the radius (and pushed forward) the duck sprints. */
  sprintAt: 0.92,
  /** Sprint also needs the push to point this much forward (the sim's own rule is MOVE.sprintMinForward). */
  sprintMinForward: 0.6,
  /** A thumb dragged this far past the ring pulls the stick's center along, so it never runs out of room (px). */
  stickFollow: 24,
  /** Look: radians per CSS pixel of drag at a touch sensitivity of 1. */
  lookRadPerPx: 0.0052,
  /** Vertical look is a little slower than horizontal (thumbs drift up and down while turning). */
  lookPitchScale: 0.8,
  /** A drag must move this far before it turns the camera, so a tap on the screen does not jitter the aim (px). */
  lookSlop: 2,
  /** The fire button also aims while held: its drag turns the camera at this share of the look speed. */
  fireDragLook: 1,
  /** After a button opens a screen, the tap's own click is dropped for this long (ms). */
  clickGuardMs: 450,
  /** Buttons show a pressed state at least this long so a quick tap is visible (ms). */
  pressFlashMs: 90,
  /** The left half of the screen (minus the buttons) moves; the right half looks. Share of the width. */
  moveZoneShare: 0.42,
} as const;

/** Touch sensitivity setting range (a multiplier of TOUCH.lookRadPerPx). */
export const TOUCH_SENS = { min: 0.3, max: 3, step: 0.05, default: 1 } as const;
