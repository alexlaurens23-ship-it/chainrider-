import type { World } from "planck";

/** A 2D point in world meters (e.g. one vertex of a chart-terrain polyline). */
export interface Vec2Like {
  x: number;
  y: number;
}

/**
 * Input bitmask sampled once per fixed step and recorded as (stepIndex, keymask)
 * in the replay log. Bit layout is part of the replay format — never reorder.
 */
export const INPUT = {
  THROTTLE: 1 << 0,
  BRAKE: 1 << 1,
  LEAN_BACK: 1 << 2,
  LEAN_FORWARD: 1 << 3,
} as const;

/** Bitwise OR of `INPUT` flags for one fixed step. */
export type Keymask = number;

export interface SimOptions {
  /** Velocity solver iterations. Must match browser and Node (default 8). */
  velocityIterations?: number;
  /** Position solver iterations. Must match browser and Node (default 3). */
  positionIterations?: number;
}

/** Opaque-ish simulation handle. Treat as read-only outside this package. */
export interface Sim {
  world: World;
  /** Number of fixed steps taken since creation. Sim time = stepIndex * SIM_DT. */
  stepIndex: number;
  velocityIterations: number;
  positionIterations: number;
}

export interface SimSnapshot {
  stepIndex: number;
  /** Simulation time in seconds (stepIndex * SIM_DT) — never wall-clock. */
  simTime: number;
}
