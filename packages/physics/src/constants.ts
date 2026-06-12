/** Fixed simulation timestep in seconds. Identical in browser and Node; never derived from wall-clock time. */
export const SIM_DT = 1 / 60;

/** World gravity in m/s². */
export const GRAVITY_X = 0;
export const GRAVITY_Y = -10;

/** Solver iterations — must be identical everywhere for determinism. */
export const VELOCITY_ITERATIONS = 8;
export const POSITION_ITERATIONS = 3;

/**
 * Replay-format / physics version. Bump on ANY change to physics behavior,
 * scoring rules, tune defaults, terrain construction, or the input bit layout —
 * the server rejects runs whose simVersion it cannot reproduce.
 */
export const SIM_VERSION = 5;

/** Flat terrain extensions around the chart polyline, in meters. */
export const LEAD_IN_METERS = 20;
export const RUN_OUT_METERS = 30;
/** Finish flag sits this far into the run-out, past the last chart point. */
export const FINISH_FLAG_OFFSET = 10;
/** Kill floor sits this far below the lowest terrain vertex. */
export const KILL_FLOOR_DROP = 30;

/** Checkpoints every this fraction of the spawn→finish x-span. */
export const CHECKPOINT_FRACTION = 0.15;
/** Ticks the sim stays frozen after a crash before respawning. */
export const CRASH_FREEZE_TICKS = 60;
