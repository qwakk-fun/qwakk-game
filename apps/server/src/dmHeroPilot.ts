/**
 * How a bot hero flies: short hops, never a long stay in the sky. On the
 * ground with most of its energy back, it now and then presses and holds Jump
 * for a short burst (more often while it fights, for the height), then lets go
 * and glides down. It only adds the Jump button to the frame its brain wrote,
 * through the same input path as a human (Arena.botFrame), so the flight is
 * the shared sim's and nothing else. Server only: Math.random is fine.
 */
import { Button, HERO_FLIGHT, isHero, type InputFrame, type PlayerSim } from '@qwakk/shared';

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class HeroPilot {
  /** Ticks left holding Jump in the current hop. */
  private hold = 0;
  /** Ticks until the next hop may start. */
  private wait = Math.round(rand(20, 60));

  /** Add the hero's flight to this tick's frame (no-op for a duck without the cape). */
  apply(self: PlayerSim, f: InputFrame, fighting: boolean): InputFrame {
    if (!isHero(self) || self.alive !== 1) {
      this.hold = 0;
      return f;
    }
    if (this.hold > 0) {
      this.hold--;
      f.buttons |= Button.Jump;
      return f;
    }
    if (this.wait > 0) {
      this.wait--;
      return f;
    }
    // A hop needs the ground under it, most of the bar, and a fresh press (Jump up last tick).
    if (self.grounded === 1 && self.dmEnergy >= HERO_FLIGHT.energyTicks * 0.6 && (self.prevButtons & Button.Jump) === 0) {
      this.hold = Math.round(fighting ? rand(14, 32) : rand(8, 22));
      this.wait = Math.round(fighting ? rand(45, 110) : rand(90, 200));
      f.buttons |= Button.Jump;
    }
    return f;
  }
}
