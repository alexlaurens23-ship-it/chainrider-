import { createSim, getSnapshot, getTrackInfo } from "@chainrider/physics";
import type { TrackInfo } from "@chainrider/physics";
import { getReplay, getTrackCached, type ReplayData } from "../net";
import type { Screen } from "../router";
import { createRideHud, type RideHud } from "../ride/hud";
import { createRideLoop, type RideLoop } from "../ride/loop";
import { createRideRenderer, type RideRenderer } from "../ride/render";

/**
 * Read-only replay: feed a stored input log through the SAME sim + renderer the
 * ride uses (zero new physics). No keyboard input, no submission, no login gate
 * — replays are public, shareable proof. Reached via #/replay/:runId.
 */
export function createReplayScreen(): Screen {
  let loop: RideLoop | null = null;
  let onResize: (() => void) | null = null;

  return {
    mount(root, params) {
      const runId = Number(params.runId);
      if (!Number.isInteger(runId)) {
        root.innerHTML = `<div class="page"><div class="empty-state">Bad run id.</div></div>`;
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.className = "game-canvas";
      root.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        root.innerHTML = `<div class="page"><div class="empty-state">Canvas2D not supported.</div></div>`;
        return;
      }
      const resize = (): void => {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
      };
      resize();
      onResize = resize;
      window.addEventListener("resize", resize);

      getReplay(runId)
        .then(async (replay) => {
          const track = await getTrackCached(replay.trackId);
          start(root, ctx, replay, track.points, track.par_time_ms ?? undefined);
        })
        .catch(() => {
          root.innerHTML = `<div class="page"><div class="topnav"><a href="#/">← HOME</a></div><div class="empty-state">Could not load replay.</div></div>`;
        });
    },

    unmount() {
      loop?.stop();
      if (onResize) window.removeEventListener("resize", onResize);
    },
  };

  function start(
    root: HTMLElement,
    ctx: CanvasRenderingContext2D,
    replay: ReplayData,
    points: [number, number][],
    parTimeMs: number | undefined,
  ): void {
    const probe = createSim(points, undefined, { parTimeMs });
    const trackInfo: TrackInfo = getTrackInfo(probe);
    const spawn = { x: trackInfo.spawnX, y: getSnapshot(probe).chassis.y };

    const hud: RideHud = createRideHud(root, `replay · ${replay.label}`);
    const renderer: RideRenderer = createRideRenderer(trackInfo, hud.minimap);
    renderer.reset(spawn.x, spawn.y);

    // Drive the loop from the stored log instead of the keyboard. readMask() is
    // called exactly once per fixed step (in tick order), so a local tick
    // counter mirrors sim.tick — same convention as the recorder/simulateReplay.
    const log = replay.inputLog;
    let replayTick = 0;
    let logIdx = 0;
    let curMask = 0;
    const replayReadMask = (): number => {
      while (logIdx < log.length && log[logIdx][0] <= replayTick) {
        curMask = log[logIdx][1];
        logIdx += 1;
      }
      replayTick += 1;
      return curMask;
    };

    // Banner + back link (read-only).
    const banner = document.createElement("div");
    banner.className = "replay-banner";
    banner.innerHTML = `<a href="#/">← BACK</a><span>@${replay.username} · replay${
      replay.serverScore != null ? ` · ${replay.serverScore.toLocaleString("en-US")}` : ""
    }</span>`;
    root.appendChild(banner);

    loop = createRideLoop(
      {
        points,
        parTimeMs,
        onFrame: (f) => {
          const dpr = window.devicePixelRatio || 1;
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          renderer.render(
            ctx,
            window.innerWidth,
            window.innerHeight,
            f.prev,
            f.curr,
            f.alpha,
            f.speed,
            loop!.tune,
            f.mask,
          );
          hud.update(f.curr, f.airSeconds, true);
        },
        onEnd: () => {
          const done = document.createElement("div");
          done.className = "hud-status";
          done.textContent = "REPLAY COMPLETE";
          root.appendChild(done);
        },
      },
      replayReadMask,
    );
  }
}
