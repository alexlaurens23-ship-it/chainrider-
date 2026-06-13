import {
  DEFAULT_TUNE,
  SIM_DT,
  createSim,
  getSnapshot,
  getTrackInfo,
  stepSim,
} from "@chainrider/physics";
import type { BikeTune, InputLogEntry, Sim, SimSnapshot, TrackPoint } from "@chainrider/physics";

const MAX_FRAME_S = 0.25;
/** 20 minutes at 60 Hz — the run is force-ended past this. */
export const MAX_RIDE_TICKS = 20 * 60 * 60;

export interface RideFrame {
  prev: SimSnapshot;
  curr: SimSnapshot;
  alpha: number;
  /** Horizontal speed (m/s) derived from successive snapshots — for the camera. */
  speed: number;
  /** Seconds of the current airborne streak. */
  airSeconds: number;
}

export interface RideEnd {
  snap: SimSnapshot;
  maxCombo: number;
  log: InputLogEntry[];
}

export interface RideLoopOptions {
  points: TrackPoint[];
  parTimeMs?: number;
  onFrame(frame: RideFrame): void;
  onEnd(end: RideEnd): void;
}

export interface RideLoop {
  readonly tune: BikeTune;
  spawn(): { x: number; y: number };
  respawn(): void;
  stop(): void;
  /** Force-end now (e.g. Esc quit) with the current state. */
  quit(): void;
  log(): InputLogEntry[];
  maxCombo(): number;
}

/**
 * Fixed-timestep ride loop. Mirrors the playground accumulator exactly; all
 * physics/scoring stays in @chainrider/physics. Records the change-only
 * [tick, keymask] input log that P6 re-simulates server-side.
 */
export function createRideLoop(
  options: RideLoopOptions,
  readMask: () => number,
): RideLoop {
  const tune: BikeTune = { ...DEFAULT_TUNE };
  let sim: Sim = createSim(options.points, tune, { parTimeMs: options.parTimeMs });
  let prev: SimSnapshot = getSnapshot(sim);
  let curr: SimSnapshot = prev;

  let log: InputLogEntry[] = [];
  let lastMask = 0;
  let maxCombo = 1;
  let airTicks = 0;
  let ended = false;
  let rafId = 0;

  let last = performance.now();
  let accumulator = 0;

  function rebuild(): void {
    sim = createSim(options.points, tune, { parTimeMs: options.parTimeMs });
    prev = getSnapshot(sim);
    curr = prev;
    log = [];
    lastMask = 0;
    maxCombo = 1;
    airTicks = 0;
    accumulator = 0;
    last = performance.now();
  }

  function end(): void {
    if (ended) return;
    ended = true;
    cancelAnimationFrame(rafId);
    options.onEnd({ snap: curr, maxCombo, log });
  }

  function frame(now: number): void {
    if (ended) return;
    let frameTime = (now - last) / 1000;
    last = now;
    if (frameTime > MAX_FRAME_S) frameTime = MAX_FRAME_S;
    accumulator += frameTime;

    while (accumulator >= SIM_DT) {
      prev = curr;
      const mask = readMask();
      if (mask !== lastMask) {
        log.push([sim.tick, mask]);
        lastMask = mask;
      }
      stepSim(sim, mask);
      curr = getSnapshot(sim);
      accumulator -= SIM_DT;

      if (curr.combo > maxCombo) maxCombo = curr.combo;
      airTicks = curr.grounded ? 0 : airTicks + 1;

      if (curr.finished || sim.tick >= MAX_RIDE_TICKS) {
        // Drain remaining frame draw once, then end.
        accumulator = 0;
        break;
      }
    }

    const speed = (curr.chassis.x - prev.chassis.x) / SIM_DT;
    options.onFrame({ prev, curr, alpha: accumulator / SIM_DT, speed, airSeconds: airTicks * SIM_DT });

    if (curr.finished || sim.tick >= MAX_RIDE_TICKS) {
      end();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    tune,
    spawn() {
      const info = getTrackInfo(sim);
      return { x: info.spawnX, y: prev.chassis.y };
    },
    respawn() {
      if (ended) return;
      rebuild();
    },
    stop() {
      ended = true;
      cancelAnimationFrame(rafId);
    },
    quit() {
      end();
    },
    log: () => log,
    maxCombo: () => maxCombo,
  };
}
