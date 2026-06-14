import { describe, expect, it } from "vitest";
import { DEFAULT_TUNE, createSim, getTrackInfo, terrainYAt } from "../src/index";
import type { TrackPoint } from "../src/index";

/** Flat approach, a sustained 40° incline (run 30 / rise 30·tan40° ≈ 25.17), flat summit. */
const RISE_40 = 30 * Math.tan((40 * Math.PI) / 180);
const INCLINE_40: TrackPoint[] = [
  [0, 0],
  [10, 0],
  [40, RISE_40],
  [60, RISE_40],
];

describe("checkpoint respawn clearance", () => {
  it("places both wheels above the terrain at every checkpoint, incl. the 40° section", () => {
    // Checkpoints back the respawn pose: respawn() snaps the bike to a
    // checkpoint and setBikePose puts the wheels at cp.x ± halfBase, at
    // cp.y − axleDropY. So testing the checkpoint geometry tests the respawn.
    const sim = createSim(INCLINE_40);
    const { terrain, checkpoints } = getTrackInfo(sim);
    const halfBase = DEFAULT_TUNE.wheelbase / 2;

    let onIncline = 0;
    for (const cp of checkpoints) {
      const wheelBottom = cp.y - DEFAULT_TUNE.axleDropY - DEFAULT_TUNE.wheelRadius;
      // No initial penetration: each wheel bottom sits above its local terrain.
      expect(wheelBottom).toBeGreaterThan(terrainYAt(terrain, cp.x - halfBase));
      expect(wheelBottom).toBeGreaterThan(terrainYAt(terrain, cp.x + halfBase));
      if (cp.x > 10 && cp.x < 40) onIncline++;
    }
    // Guard: the test only proves the fix if some checkpoints land on the steep
    // section (where the old code clipped the uphill wheel under the surface).
    expect(onIncline).toBeGreaterThan(0);
  });
});
