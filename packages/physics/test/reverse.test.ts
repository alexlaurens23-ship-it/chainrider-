import { describe, expect, it } from "vitest";
import { DEFAULT_TUNE, INPUT, SIM_DT, createSim, getSnapshot, stepSim } from "../src/index";
import type { TrackPoint } from "../src/index";

/** Long flat track; the bike spawns on the flat lead-in. */
const FLAT: TrackPoint[] = [
  [0, 0],
  [120, 0],
];

/** Throttle 90 ticks to build forward speed, then `n` ticks of `input`; return final forward speed (m/s). */
function speedAfter(input: number, n: number): number {
  const sim = createSim(FLAT);
  for (let i = 0; i < 90; i++) stepSim(sim, INPUT.THROTTLE);
  let prevX = getSnapshot(sim).chassis.x;
  for (let i = 0; i < n; i++) {
    prevX = getSnapshot(sim).chassis.x;
    stepSim(sim, input);
  }
  return (getSnapshot(sim).chassis.x - prevX) / SIM_DT;
}

describe("context-aware reverse", () => {
  it("forward braking still decelerates more than coasting, and never reverses while fast", () => {
    const cruising = speedAfter(INPUT.THROTTLE, 1); // speed before braking
    expect(cruising).toBeGreaterThan(4);
    const braked = speedAfter(INPUT.BRAKE, 30);
    const coasted = speedAfter(0, 30);
    // Braking sheds speed faster than just letting off the gas...
    expect(braked).toBeLessThan(coasted);
    // ...still moving forward (no reverse engaged while genuinely moving fast).
    expect(braked).toBeGreaterThan(0);
    expect(braked).toBeLessThan(cruising);
  });

  it("from a standstill, holding S/down for 2 s reverses > 3 m, grounded, no crash", () => {
    const sim = createSim(FLAT);
    const startX = getSnapshot(sim).chassis.x;
    let maxBackwardSpeed = 0;
    let prevX = startX;
    for (let i = 0; i < 120; i++) {
      stepSim(sim, INPUT.BRAKE);
      const x = getSnapshot(sim).chassis.x;
      const v = (x - prevX) / SIM_DT; // negative when reversing
      if (-v > maxBackwardSpeed) maxBackwardSpeed = -v;
      prevX = x;
    }
    const snap = getSnapshot(sim);
    expect(startX - snap.chassis.x).toBeGreaterThan(3); // backed up a meaningful distance
    expect(snap.grounded).toBe(true);
    expect(snap.crashes).toBe(0);
    // Capped — never a real riding speed (small margin for per-step overshoot).
    expect(maxBackwardSpeed).toBeLessThan(DEFAULT_TUNE.reverseMaxSpeed + 1);
  });
});
