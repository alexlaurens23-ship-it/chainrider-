import { DEFAULT_TUNE, SIM_DT, createSim, getSnapshot, getTrackInfo, stepSim } from "@chainrider/physics";
import type { BikeTune, InputLogEntry, Sim, SimSnapshot, TrackInfo } from "@chainrider/physics";
import { createTrail } from "../shared/trail";
import { createHud } from "./hud";
import { createInput } from "./input";
import { createPanel } from "./panel";
import { render } from "./render";
import { SELF_TEST_TICKS, createSelfTest } from "./selftest";
import { TEST_TRACK } from "./track";

/** Never simulate more than this much catch-up per frame (spiral-of-death guard). */
const MAX_FRAME_S = 0.25;

interface Recording {
  log: InputLogEntry[];
  lastMask: number;
}

/** Stop the playground: cancel its RAF and remove its listeners. */
export interface PlaygroundHandle {
  unmount(): void;
}

/**
 * Tuning playground. All physics and scoring live in @chainrider/physics —
 * this loop only samples keymasks, calls stepSim, and draws snapshots.
 * Mounts its canvas + overlays into `root` and returns a teardown handle.
 */
export function startPlayground(root: HTMLElement): PlaygroundHandle {
  const canvas = document.createElement("canvas");
  canvas.className = "game-canvas";
  root.appendChild(canvas);
  const renderCtx = canvas.getContext("2d");
  if (!renderCtx) throw new Error("Canvas2D not supported");
  const ctx: CanvasRenderingContext2D = renderCtx;

  let tune: BikeTune = { ...DEFAULT_TUNE };
  let sim: Sim = createSim(TEST_TRACK, tune);
  let trackInfo: TrackInfo = getTrackInfo(sim);
  let prev: SimSnapshot = getSnapshot(sim);
  let curr: SimSnapshot = prev;
  let recording: Recording | null = null;

  const input = createInput();
  const hud = createHud(root);
  const selfTest = createSelfTest(root);
  const trail = createTrail();

  function rebuild(): void {
    sim = createSim(TEST_TRACK, tune);
    trackInfo = getTrackInfo(sim);
    prev = getSnapshot(sim);
    curr = prev;
    trail.clear();
    if (recording) {
      recording = null;
      selfTest.cancel();
    }
  }

  input.onReset(rebuild);
  createPanel(root, (next) => {
    tune = next;
    rebuild();
  });
  selfTest.button(() => {
    rebuild();
    recording = { log: [], lastMask: 0 };
  });

  function resize(): void {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  }
  window.addEventListener("resize", resize);
  resize();

  // Fixed-timestep accumulator; rendering interpolates between sim states.
  // Wall-clock only feeds the accumulator and FPS readout — never the sim.
  let last = performance.now();
  let accumulator = 0;
  let fps = 60;
  let rafId = 0;
  let stopped = false;

  function frame(now: number): void {
    if (stopped) return;
    let frameTime = (now - last) / 1000;
    last = now;
    if (frameTime > MAX_FRAME_S) frameTime = MAX_FRAME_S;
    if (frameTime > 0) fps = fps * 0.9 + (1 / frameTime) * 0.1;
    accumulator += frameTime;

    while (accumulator >= SIM_DT) {
      prev = curr;
      const mask = input.mask();
      if (recording && mask !== recording.lastMask) {
        recording.log.push([sim.tick, mask]);
        recording.lastMask = mask;
      }
      stepSim(sim, mask);
      curr = getSnapshot(sim);
      accumulator -= SIM_DT;

      if (recording && (curr.finished || sim.tick >= SELF_TEST_TICKS)) {
        selfTest.finish(TEST_TRACK, tune, recording.log, sim.tick, curr);
        recording = null;
      } else if (recording) {
        selfTest.showRecording(SELF_TEST_TICKS - sim.tick);
      }
    }

    const alpha = accumulator / SIM_DT;
    const lerp = (a: number, b: number): number => a + (b - a) * alpha;
    if (!curr.crashed) trail.push(lerp(prev.rearWheel.x, curr.rearWheel.x), lerp(prev.rearWheel.y, curr.rearWheel.y));

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, window.innerWidth, window.innerHeight, {
      track: trackInfo,
      prev,
      curr,
      alpha,
      tune,
      mask: input.mask(),
      trail,
    });
    hud.update(curr, fps);

    rafId = requestAnimationFrame(frame);
  }
  rafId = requestAnimationFrame(frame);

  return {
    unmount() {
      stopped = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      input.dispose();
    },
  };
}
