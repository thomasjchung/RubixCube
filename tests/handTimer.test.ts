import { describe, expect, it } from "vitest";
import { HandTimer } from "../src/vision/handTimer";
import { DEFAULT_PADS } from "../src/vision/hands";

const jitter = (p: { x: number; y: number }, k: number) => ({ x: p.x + Math.sin(k) * 0.002, y: p.y + Math.cos(k) * 0.002 });

function run(t: HandTimer, frames: { palms: { x: number; y: number }[]; space?: boolean }[], t0 = 0) {
  const events: [string, number][] = [];
  frames.forEach((f, i) => {
    const e = t.update(f.palms.map((p) => jitter(p, i)), t0 + i * 33, !!f.space);
    if (e) events.push([e, t0 + i * 33]);
  });
  return events;
}

const rep = <T,>(n: number, v: T) => Array.from({ length: n }, () => v);

describe("hand timer", () => {
  it("anywhere: rest, lift, solve, return", () => {
    const t = new HandTimer("anywhere", DEFAULT_PADS);
    const rest = [{ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.45 }]; // middle of the frame, not the bottom
    const up = [{ x: 0.42, y: 0.25 }, { x: 0.58, y: 0.25 }];
    const ev = run(t, [...rep(30, { palms: rest }), ...rep(90, { palms: up }), ...rep(10, { palms: rest })]);
    expect(ev.map((e) => e[0])).toEqual(["start", "stop"]);
    const dur = ev[1][1] - ev[0][1];
    expect(dur).toBeGreaterThan(2900);
    expect(dur).toBeLessThan(3200);
  });

  it("anywhere: hands that never settle don't arm the timer", () => {
    const t = new HandTimer("anywhere", DEFAULT_PADS);
    const frames = Array.from({ length: 60 }, (_, i) => ({ palms: [{ x: 0.3 + (i % 2) * 0.05, y: 0.4 }, { x: 0.7, y: 0.4 }] }));
    expect(run(t, frames)).toEqual([]);
    expect(t.phase).not.toBe("ready");
  });

  it("anywhere: losing a hand from view starts it", () => {
    const t = new HandTimer("anywhere", DEFAULT_PADS);
    const rest = [{ x: 0.3, y: 0.8 }, { x: 0.7, y: 0.8 }];
    const ev = run(t, [...rep(30, { palms: rest }), ...rep(5, { palms: [rest[0]] })]);
    expect(ev.map((e) => e[0])).toEqual(["start"]);
  });

  it("pads: custom pad positions", () => {
    const pads = [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.7, y: 0.1, w: 0.2, h: 0.2 }];
    const t = new HandTimer("pads", pads);
    const on = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }];
    const bottom = [{ x: 0.2, y: 0.9 }, { x: 0.8, y: 0.9 }];
    const ev = run(t, [...rep(30, { palms: bottom }), ...rep(30, { palms: on }), ...rep(60, { palms: bottom }), ...rep(5, { palms: on })]);
    expect(ev.map((e) => e[0])).toEqual(["start", "stop"]);
  });

  it("space bar", () => {
    const t = new HandTimer("anywhere", DEFAULT_PADS);
    const ev = run(t, [...rep(25, { palms: [], space: true }), ...rep(5, { palms: [] })]);
    expect(ev.map((e) => e[0])).toEqual(["start"]);
  });
});
