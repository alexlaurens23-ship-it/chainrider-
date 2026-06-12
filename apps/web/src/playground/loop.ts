import { DEFAULT_TUNE, SIM_DT, createSim, getSnapshot, getTrackInfo, stepSim } from "@chainrider/physics";
import type { BikeTune, InputLogEntry, Sim, SimSnapshot, TrackInfo } from "@chainrider/physics";
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

/**
 * Tuning playground. All physics and scoring live in @chainrider/physics —
 * this loop only samples keymasks, calls stepSim, and draws snapshots.
 */
export function startPlayground(): void {
  const canvasEl = document.querySelector<HTMLCanvasElement>("#game");
  if (!canvasEl) throw new Error("missing #game canvas");
  const renderCtx = canvasEl.getContext("2d");
  if (!renderCtx) throw new Error("Canvas2D not supported");
  const canvas: HTMLCanvasElement = canvasEl;
  const ctx: CanvasRenderingContext2D = renderCtx;

  let tune: BikeTune = { ...DEFAULT_TUNE };
  let sim: Sim = createSim(TEST_TRACK, tune);
  let trackInfo: TrackInfo = getTrackInfo(sim);
  let prev: SimSnapshot = getSnapshot(sim);
  let curr: SimSnapshot = prev;
  let recording: Recording | null = null;

  const input = createInput();
  const hud = createHud(document.body);
  const selfTest = createSelfTest(document.body);

  function rebuild(): void {
    sim = createSim(TEST_TRACK, tune);
    trackInfo = getTrackInfo(sim);
    prev = getSnapshot(sim);
    curr = prev;
    if (recording) {
      recording = null;
      selfTest.cancel();
    }
  }

  input.onReset(rebuild);
  createPanel(document.body, (next) => {
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

  function frame(now: number): void {
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

    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render(ctx, window.innerWidth, window.innerHeight, {
      track: trackInfo,
      prev,
      curr,
      alpha: accumulator / SIM_DT,
      tune,
    });
    hud.update(curr, fps);

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
