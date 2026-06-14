import { describe, expect, it } from "vitest";
import { INPUT, createSim, getSnapshot, stepSim } from "../src/index";
import type { TrackPoint } from "../src/index";

/** Flat approach, then a sustained 45° climb (run 78 / rise 78), flat summit. */
const INCLINE_45: TrackPoint[] = [
  [0, 0],
  [2, 0],
  [80, 78],
  [100, 78],
];

/** Throttle-hold for `ticks`, return the final chassis x. */
function climbX(launchBoost: number, ticks: number): number {
  const sim = createSim(INCLINE_45, { launchBoost });
  for (let i = 0; i < ticks; i++) stepSim(sim, INPUT.THROTTLE);
  return getSnapshot(sim).chassis.x;
}

describe("low-speed launch assist", () => {
  it("makes real forward progress up a 45° incline within 2 s, no crash", () => {
    const sim = createSim(INCLINE_45);
    const startX = getSnapshot(sim).chassis.x;
    for (let i = 0; i < 120; i++) stepSim(sim, INPUT.THROTTLE);
    const snap = getSnapshot(sim);
    // Cleared the flat run-up and climbed several metres up the 45° face.
    expect(snap.chassis.x).toBeGreaterThan(startX + 8);
    expect(snap.chassis.x).toBeGreaterThan(2);
    expect(snap.crashes).toBe(0);
  });

  it("the assist is responsible — boosted out-climbs an unboosted control", () => {
    // Same track + input; only launchBoost differs. The boost (default 1.8)
    // must get the bike measurably further up the steep climb than 1.0.
    const boosted = climbX(1.8, 120);
    const control = climbX(1.0, 120);
    expect(boosted).toBeGreaterThan(control);
  });
});
