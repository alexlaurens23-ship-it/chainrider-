/** Fixed simulation timestep in seconds. Identical in browser and Node; never derived from wall-clock time. */
export const SIM_DT = 1 / 60;

/** World gravity in m/s². */
export const GRAVITY_X = 0;
export const GRAVITY_Y = -10;

/** Solver iterations — must be identical everywhere for determinism. */
export const VELOCITY_ITERATIONS = 8;
export const POSITION_ITERATIONS = 3;

/** Friction of the chart-terrain chain fixture. */
export const GROUND_FRICTION = 0.6;
