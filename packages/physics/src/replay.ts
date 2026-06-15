import { SIM_DT, SIM_VERSION } from "./constants";
import { createSim, getSnapshot, stepSim } from "./sim";
import type { BikeTune, FinalResult, InputLogEntry, TrackPoint } from "./types";

/**
 * Headless deterministic replay of a recorded input log — what the server
 * calls to validate a submitted run (hard rule 4: client scores are never
 * trusted). Pure function: same (track, tune, log) → same FinalResult.
 *
 * Log convention: entries are [tick, keymask], sorted by tick; a keymask
 * persists until the next entry's tick. Stops at the finish flag or maxTicks.
 */
export function simulateReplay(
  trackPoints: readonly TrackPoint[],
  tune: Partial<BikeTune> | undefined,
  inputLog: readonly InputLogEntry[],
  maxTicks: number,
  parTimeMs?: number,
): FinalResult {
  for (let i = 1; i < inputLog.length; i++) {
    if (inputLog[i][0] <= inputLog[i - 1][0]) {
      throw new Error(`input log ticks must be strictly increasing (entry ${i})`);
    }
  }

  const sim = createSim(trackPoints, tune, { parTimeMs });
  let keymask = 0;
  let next = 0;
  // Furthest forward the chassis ever reached (used by the server's progress
  // check — a crash respawns backward to a checkpoint, so final-x understates
  // real travel). Purely observed; never feeds physics or scoring.
  let maxX = sim.chassis.getPosition().x;
  while (sim.tick < maxTicks) {
    // sim.tick is the index of the step about to be taken.
    while (next < inputLog.length && inputLog[next][0] <= sim.tick) {
      keymask = inputLog[next][1];
      next += 1;
    }
    stepSim(sim, keymask);
    const x = sim.chassis.getPosition().x;
    if (x > maxX) maxX = x;
    if (sim.finished) break;
  }

  const snap = getSnapshot(sim);
  const s = sim.score;
  return {
    score: s.score,
    speedScore: s.speedScore,
    trickBonus: s.trickBonus,
    effectiveTimeMs: s.effectiveTimeMs,
    timeMs: (sim.finished ? sim.finishTick : sim.tick) * SIM_DT * 1000,
    ticks: sim.tick,
    flips: s.flips,
    backflips: s.backflips,
    frontflips: s.frontflips,
    crashes: s.crashes,
    finished: sim.finished,
    simVersion: SIM_VERSION,
    finalChassis: snap.chassis,
    maxX,
  };
}
