// Stackmat-style start/stop logic driven by palm positions.
//
// "anywhere": rest both hands still anywhere -> ready; move either hand -> start; put both hands
//             back where they rested -> stop.
// "pads":     both hands inside the two (user-movable) pads -> ready; lift -> start; back on the pads -> stop.
// The space bar can stand in for "both hands down" in either mode.

import { inPad, Pad, Point } from "./hands";

export type TimerMode = "anywhere" | "pads";
export type TimerPhase = "idle" | "holding" | "ready" | "running";

const HOLD_MS = 550;
const STILL_MS = 150; // how long hands must be still before the hold even begins
const MIN_SOLVE_MS = 1500;
// Distances are fractions of the frame height.
const STILL_R = 0.03;
const START_R = 0.07;
export const STOP_R = 0.11;

export class HandTimer {
  phase: TimerPhase = "idle";
  /** where the hands rested when the timer armed (anywhere mode) */
  rest: Point[] | null = null;
  startAt = 0;

  private anchor: Point[] | null = null;
  private anchorAt = 0;
  private holdStart = 0;
  private armedBySpace = false;
  private offFrames = 0;
  private onFrames = 0;

  constructor(public mode: TimerMode, public pads: Pad[], public aspect = 16 / 9) {}

  private dist(a: Point, b: Point) {
    return Math.hypot((a.x - b.x) * this.aspect, a.y - b.y);
  }

  /** Each palm matched to a distinct target within r (either pairing). */
  private matches(palms: Point[], targets: Point[], r: number) {
    if (palms.length < 2) return false;
    const [a, b] = palms;
    const [p, q] = targets;
    return (this.dist(a, p) < r && this.dist(b, q) < r) || (this.dist(a, q) < r && this.dist(b, p) < r);
  }

  /** Which pads currently have a palm in them. */
  padsHit(palms: Point[]): [boolean, boolean] {
    return [palms.some((p) => inPad(p, this.pads[0])), palms.some((p) => inPad(p, this.pads[1]))];
  }

  /** Feed one frame. Returns "start" or "stop" when the clock should start or stop. */
  update(palms: Point[], now: number, space: boolean): "start" | "stop" | null {
    // Track how long both hands have been still.
    if (palms.length === 2 && this.anchor && this.matches(palms, this.anchor, STILL_R)) {
      /* still */
    } else {
      this.anchor = palms.length === 2 ? palms.map((p) => ({ ...p })) : null;
      this.anchorAt = now;
    }
    const still = !!this.anchor && now - this.anchorAt >= STILL_MS;
    const [p0, p1] = this.padsHit(palms);
    const handsDown = this.mode === "pads" ? p0 && p1 : still;

    switch (this.phase) {
      case "idle":
        if (handsDown || space) {
          this.phase = "holding";
          this.holdStart = now;
          this.armedBySpace = space && !handsDown;
        }
        return null;
      case "holding":
        if (!(this.armedBySpace ? space : handsDown)) this.phase = "idle";
        else if (now - this.holdStart >= HOLD_MS) {
          this.phase = "ready";
          this.rest = this.mode === "anywhere" && this.anchor ? this.anchor.map((p) => ({ ...p })) : null;
          this.offFrames = 0;
        }
        return null;
      case "ready": {
        let go: boolean;
        if (this.armedBySpace) go = !space;
        else if (this.mode === "pads") {
          this.offFrames = p0 && p1 ? 0 : this.offFrames + 1;
          go = this.offFrames >= 2;
        } else {
          const moved = palms.length === 2 && this.rest ? !this.matches(palms, this.rest, START_R) : false;
          this.offFrames = palms.length < 2 ? this.offFrames + 1 : 0;
          go = moved || this.offFrames >= 3; // a hand lifted out of view also counts
        }
        if (go) {
          this.phase = "running";
          this.startAt = now;
          this.onFrames = 0;
          return "start";
        }
        return null;
      }
      case "running": {
        if (now - this.startAt < MIN_SOLVE_MS) return null;
        const back =
          this.mode === "pads" ? p0 && p1 : !!this.rest && this.matches(palms, this.rest, STOP_R);
        this.onFrames = back ? this.onFrames + 1 : 0;
        if (this.onFrames >= 3) return this.stop();
        return null;
      }
    }
  }

  /** Stop from outside (a key press). */
  stop(): "stop" {
    this.phase = "idle";
    this.anchor = null;
    return "stop";
  }
}
