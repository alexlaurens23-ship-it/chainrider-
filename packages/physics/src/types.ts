import type { Body, Fixture, WheelJoint, World } from "planck";
import type { ScoreState } from "./scoring";

/** One terrain vertex: [x, y] in world meters. x must be strictly increasing. */
export type TrackPoint = [number, number];

/**
 * Input bitmask sampled once per fixed step and recorded as (tick, keymask)
 * in the replay log. Bit layout is part of the replay format — never reorder.
 */
export const INPUT = {
  THROTTLE: 1 << 0,
  BRAKE: 1 << 1,
  /** Rotate counter-clockwise (backflip direction when riding +x). */
  LEAN_LEFT: 1 << 2,
  /** Rotate clockwise (frontflip direction when riding +x). */
  LEAN_RIGHT: 1 << 3,
  JUMP: 1 << 4,
} as const;

/** Bitwise OR of `INPUT` flags for one fixed step. */
export type Keymask = number;

/** One replay-log entry. The keymask persists until the next entry's tick. */
export type InputLogEntry = [tick: number, keymask: number];

/**
 * Every physical/control parameter of the bike. Defaults (DEFAULT_TUNE) come
 * from CLAUDE.md Appendix A. All values are plain numbers so the playground
 * can expose a slider per key. A tune is part of a run's identity: replays
 * only reproduce under the exact tune they were recorded with.
 */
export interface BikeTune {
  /** Chassis box full width, m. */
  chassisWidth: number;
  /** Chassis box full height, m. */
  chassisHeight: number;
  chassisDensity: number;
  chassisFriction: number;
  wheelRadius: number;
  wheelDensity: number;
  wheelFriction: number;
  /** Axle-to-axle spacing, m. Axles sit at chassis-local x = ±wheelbase/2. */
  wheelbase: number;
  /** Axles sit this far below the chassis center, m. */
  axleDropY: number;
  suspensionHz: number;
  suspensionDamping: number;
  /** Max rear-wheel spin rate, rad/s. Motor target is -maxOmega (forward = +x). */
  maxOmega: number;
  maxMotorTorque: number;
  rearBrakeTorque: number;
  frontBrakeTorque: number;
  /** X-Moto attitude pattern: torque applied to chassis while leaning, N·m. */
  attitudeTorque: number;
  /** Per-step decay factor of the attitude torque (0.75 = lose 25%/step). */
  attitudeDecay: number;
  /** Attitude magnitude below which it snaps to zero. */
  attitudeMin: number;
  /** Max |chassis angular velocity| while fully airborne, rad/s. Grounded spin is uncapped. */
  chassisSpinCap: number;
  /** Attitude torque multiplier while holding lean-forward in a wheelie (rear down, front up). */
  wheelieRecoveryBoost: number;
  /** PD auto-level P gain pulling the grounded chassis toward the terrain slope, N·m/rad. */
  stabilizerStrength: number;
  /** PD auto-level D gain on chassis angular velocity while grounded, N·m·s/rad. */
  stabilizerDamping: number;
  /** Motor torque fraction left at maxOmega (taper is linear from TORQUE_CURVE_KNEE). */
  torqueFalloffFloor: number;
  /** Fraction of m·g·sin(slope) pushed along the surface while throttling uphill past 15°. */
  hillAssist: number;
  /** Motor torque fraction at ≥50° nose-up vs slope (scales from 25°; lean-back bypasses). */
  antiWheelieFloor: number;
  /** Linear impulse along chassis-up applied on jump press while grounded, N·s. */
  jumpImpulse: number;
  headRadius: number;
  /** Head sensor center in chassis-local coordinates. */
  headOffsetX: number;
  headOffsetY: number;
  /** Clean-landing / hard-landing chassis-vs-slope tolerance, degrees. */
  landingToleranceDeg: number;
  /** post-solve normal impulse above which a misaligned landing is a crash. */
  hardLandingImpulse: number;
  groundFriction: number;
  /** Below this speed (m/s), motor torque gets the launch boost (scales to ×1 at the threshold). */
  launchSpeedThreshold: number;
  /** Motor-torque multiplier at standstill for the low-speed launch assist. */
  launchBoost: number;
  /** At/below this forward speed (m/s), grounded, S/down reverses instead of braking. */
  reverseEngageSpeed: number;
  /** Rear motor torque while reversing, N·m (slow but usable). */
  reverseMotorTorque: number;
  /** Rear motor target speed while reversing, rad/s (positive = backward). */
  reverseMotorSpeed: number;
  /** Hard cap on backward chassis speed, m/s — reverse thrust cuts above it. */
  reverseMaxSpeed: number;
  /** Reverse incline traction: fraction of m·g·sin(slope) pushed back-up-slope when reversing up a steep wall. */
  reverseHillAssist: number;
  /** Reverse incline assist engages when backing up a slope steeper than this (degrees). */
  reverseHillMinSlopeDeg: number;
}

/** Locked tune (P2 final, 2026-06-12) — found in the playground. Source of truth over Appendix A. */
export const DEFAULT_TUNE: BikeTune = {
  chassisWidth: 1.9,
  chassisHeight: 0.55,
  chassisDensity: 10,
  chassisFriction: 0.2,
  wheelRadius: 0.34,
  wheelDensity: 0.9,
  wheelFriction: 1.9,
  wheelbase: 1.5,
  axleDropY: 0.4,
  suspensionHz: 5,
  suspensionDamping: 0.85,
  maxOmega: 62,
  maxMotorTorque: 41,
  rearBrakeTorque: 55,
  frontBrakeTorque: 23,
  attitudeTorque: 70,
  attitudeDecay: 0.42,
  attitudeMin: 8.5,
  chassisSpinCap: 6.5,
  wheelieRecoveryBoost: 1.7,
  stabilizerStrength: 90,
  stabilizerDamping: 12,
  torqueFalloffFloor: 0.35,
  hillAssist: 0.6, // P8.5: slightly stronger up-slope push so a stuck bike climbs out of ruts
  antiWheelieFloor: 0.4,
  jumpImpulse: 5,
  headRadius: 0.18,
  headOffsetX: 0.1,
  headOffsetY: 0.55,
  landingToleranceDeg: 30,
  hardLandingImpulse: 40,
  groundFriction: 1.45,
  launchSpeedThreshold: 3,
  launchBoost: 1.8,
  reverseEngageSpeed: 1.5,
  reverseMotorTorque: 60,
  reverseMotorSpeed: 17,
  reverseMaxSpeed: 5.5,
  reverseHillAssist: 0.65, // P8.5: stronger reverse-rock so the bike backs out of a rut
  reverseHillMinSlopeDeg: 15,
};

export interface SimOptions {
  /** Par time for the finish bonus: max(0, (parTimeMs - timeMs) / 100). */
  parTimeMs?: number;
}

export interface Checkpoint {
  x: number;
  /** Chassis-center spawn y (already includes wheel radius + axle drop). */
  y: number;
}

/** Static track facts the renderer reads once. Plain data, never mutated. */
export interface TrackInfo {
  /** Full terrain polyline: lead-in + chart points + run-out. */
  terrain: TrackPoint[];
  spawnX: number;
  finishX: number;
  killY: number;
  checkpoints: Checkpoint[];
}

/**
 * Simulation handle. Mutable state lives here so stepSim stays a pure
 * function of (sim, keymask). Treat as opaque outside this package.
 */
export interface Sim {
  world: World;
  tune: BikeTune;
  track: TrackInfo;
  parTimeMs: number | undefined;

  ground: Body;
  chassis: Body;
  rearWheel: Body;
  frontWheel: Body;
  headFixture: Fixture;
  rearJoint: WheelJoint;
  frontJoint: WheelJoint;

  /** Number of fixed steps taken since creation. Sim time = tick * SIM_DT. */
  tick: number;
  prevKeymask: Keymask;
  /** Decaying lean torque (X-Moto attitude pattern). */
  attitude: number;
  /** Head world position after the previous step, for the swept death check. */
  prevHeadX: number;
  prevHeadY: number;

  /** Ticks remaining in the post-crash freeze; 0 = riding. */
  freezeTicks: number;
  /** Index into track.checkpoints of the latest checkpoint reached. */
  checkpointIndex: number;

  score: ScoreState;
  finished: boolean;
  /** Tick at which the run finished (finish bonus already applied). */
  finishTick: number;
}

export interface BodyPose {
  x: number;
  y: number;
  angle: number;
}

/** Everything the renderer needs. Plain data only — no Planck objects. */
export interface SimSnapshot {
  chassis: BodyPose;
  rearWheel: BodyPose;
  frontWheel: BodyPose;
  /** Rider head (sensor center) in world coordinates. */
  head: { x: number; y: number };

  score: number;
  /** Speed component (set at finish; 0 during the run / DNF). */
  speedScore: number;
  /** Weighted trick component. */
  trickBonus: number;
  /** Finish time + crash penalties, ms (set at finish). */
  effectiveTimeMs: number;
  combo: number;
  flips: number;
  backflips: number;
  frontflips: number;
  crashes: number;
  /** Total fully-airborne ticks this run. */
  airTicks: number;
  grounded: boolean;
  rearGrounded: boolean;
  frontGrounded: boolean;
  /** Current wheelie streak in ticks. */
  wheelieTicks: number;
  /** True while frozen after a crash (pre-respawn). */
  crashed: boolean;
  finished: boolean;
  tick: number;
  /** Simulation time in seconds (tick * SIM_DT) — never wall-clock. */
  simTime: number;
}

/** Result of a headless replay — what the server persists and ranks. */
export interface FinalResult {
  score: number;
  /** Speed component (0 on DNF). */
  speedScore: number;
  /** Weighted trick component. */
  trickBonus: number;
  /** Finish time + crash penalties, ms. */
  effectiveTimeMs: number;
  /** Finish time if finished, else total simulated time. Ms of sim time. */
  timeMs: number;
  ticks: number;
  flips: number;
  backflips: number;
  frontflips: number;
  crashes: number;
  finished: boolean;
  simVersion: number;
  finalChassis: BodyPose;
  /** Furthest forward (max) chassis-center x reached during the run, world meters. */
  maxX: number;
}
