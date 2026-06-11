import { Chain, Vec2, World } from "planck";
import {
  GRAVITY_X,
  GRAVITY_Y,
  GROUND_FRICTION,
  POSITION_ITERATIONS,
  SIM_DT,
  VELOCITY_ITERATIONS,
} from "./constants";
import type { Keymask, Sim, SimOptions, SimSnapshot, Vec2Like } from "./types";

/**
 * Create a deterministic simulation over a frozen track polyline.
 * Currently builds the world and terrain only; the bike rig lands next.
 */
export function createSim(trackPoints: readonly Vec2Like[], options: SimOptions = {}): Sim {
  if (trackPoints.length < 2) {
    throw new Error(`createSim requires at least 2 track points, got ${trackPoints.length}`);
  }

  const world = new World({ gravity: new Vec2(GRAVITY_X, GRAVITY_Y) });

  const ground = world.createBody({ type: "static" });
  ground.createFixture({
    shape: new Chain(
      trackPoints.map((p) => new Vec2(p.x, p.y)),
      false,
    ),
    friction: GROUND_FRICTION,
  });

  return {
    world,
    stepIndex: 0,
    velocityIterations: options.velocityIterations ?? VELOCITY_ITERATIONS,
    positionIterations: options.positionIterations ?? POSITION_ITERATIONS,
  };
}

/**
 * Advance the simulation by exactly one fixed step. `keymask` is the input
 * sampled for this step; it will drive the bike rig once that exists, and is
 * accepted now so the replay-facing signature never changes.
 */
export function stepSim(sim: Sim, keymask: Keymask): void {
  void keymask;
  sim.world.step(SIM_DT, sim.velocityIterations, sim.positionIterations);
  sim.stepIndex += 1;
}

/** Cheap observable state — grows with the rig (positions, score, crash flags). */
export function getSnapshot(sim: Sim): SimSnapshot {
  return {
    stepIndex: sim.stepIndex,
    simTime: sim.stepIndex * SIM_DT,
  };
}
