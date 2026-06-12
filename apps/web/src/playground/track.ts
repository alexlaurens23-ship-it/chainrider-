import type { TrackPoint } from "@chainrider/physics";

/**
 * Hardcoded tuning track: flat → up-ramp → gap (deep notch) → descending
 * bumps → big jump → landing. x strictly increasing (createSim requirement).
 * The sim adds a 20 m flat lead-in and 30 m run-out around these points.
 */
export const TEST_TRACK: TrackPoint[] = [
  // flat start
  [0, 0],
  [30, 0],
  // up-ramp to a lip
  [36, 1.5],
  [41, 3.8],
  [44, 5],
  // the gap: sheer notch you must clear
  [45, -6],
  [54, -6],
  [55, 1.5],
  // landing slope after the gap
  [60, 1],
  [64, 1],
  // descending bumps
  [68, 2],
  [72, -0.5],
  [76, 1],
  [80, -1.5],
  [84, 0],
  [88, -2.5],
  [92, -1],
  [96, -2.5],
  // big jump: long ramp, big drop behind it
  [102, 1.5],
  [104, 2.5],
  [105, -8],
  [118, -8],
  [122, -3],
  // landing downslope and run to the finish
  [128, -4],
  [140, -4],
];
