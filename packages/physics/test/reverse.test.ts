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

/** Flat lead, a steep ~45° left wall, a flat valley floor, a steep ~45° right wall, flat. */
const V_VALLEY: TrackPoint[] = [
  [0, 0],
  [12, 0],
  [33, -21],
  [47, -21],
  [68, 0],
  [80, 0],
];

interface EscapeRun {
  entry: { x: number; y: number; crashes: number };
  final: { x: number; y: number; crashes: number };
}

/**
 * Get the bike to rest at the bottom of the V (it settles upright on the valley
 * floor), then hold reverse for 3 s. The entry phase is identical for any
 * `reverseHillAssist` (assist only acts while reversing), so it's a fair control.
 */
function escapeV(reverseHillAssist: number): EscapeRun {
  const sim = createSim(V_VALLEY, { reverseHillAssist });
  // Drive toward the valley, then coast and settle on the floor (grounded, slow).
  for (let i = 0; i < 200 && getSnapshot(sim).chassis.x < 14; i++) stepSim(sim, INPUT.THROTTLE);
  let prevX = getSnapshot(sim).chassis.x;
  for (let i = 0; i < 400; i++) {
    prevX = getSnapshot(sim).chassis.x;
    stepSim(sim, 0);
    const s = getSnapshot(sim);
    if (s.grounded && s.chassis.x > 30 && Math.abs((s.chassis.x - prevX) / SIM_DT) < 0.4) break;
  }
  const e = getSnapshot(sim);
  const entry = { x: e.chassis.x, y: e.chassis.y, crashes: e.crashes };

  for (let i = 0; i < 180; i++) stepSim(sim, INPUT.BRAKE);
  const s = getSnapshot(sim);
  return { entry, final: { x: s.chassis.x, y: s.chassis.y, crashes: s.crashes } };
}

describe("reverse incline traction (steep-valley escape)", () => {
  it("climbs backward up the entry wall out of a steep V within 3 s, no new crash", () => {
    const r = escapeV(DEFAULT_TUNE.reverseHillAssist);
    expect(r.entry.x).toBeGreaterThan(30); // really started at the valley floor
    // Backed meaningfully up the entry (left) wall: x decreased and y rose.
    expect(r.entry.x - r.final.x).toBeGreaterThan(6);
    expect(r.final.y - r.entry.y).toBeGreaterThan(5);
    // No crash while reversing out (entry crash from dropping in is incidental).
    expect(r.final.crashes).toBe(r.entry.crashes);
  });

  it("the assist is what enables escape — without it the bike stays stuck", () => {
    const assisted = escapeV(DEFAULT_TUNE.reverseHillAssist);
    const control = escapeV(0); // no reverse incline assist → rear wheel slips
    expect(assisted.entry.x).toBeCloseTo(control.entry.x, 1); // identical entry
    expect(assisted.final.y).toBeGreaterThan(control.final.y + 3); // climbs higher
    expect(assisted.final.x).toBeLessThan(control.final.x); // further back up the wall
  });
});
