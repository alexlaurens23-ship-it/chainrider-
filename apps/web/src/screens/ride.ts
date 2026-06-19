import { SIM_VERSION, createSim, getSnapshot, getTrackInfo } from "@chainrider/physics";
import type { TrackInfo } from "@chainrider/physics";
import { isLoggedIn, requireLogin } from "../auth";
import { getMapsCached, getStats, getTrackCached, submitRun, TIERS, type TrackResponse } from "../net";
import type { Screen } from "../router";
import { createRideInput } from "../ride/input";
import { createRideLoop, type RideEnd, type RideLoop } from "../ride/loop";
import { createRideRenderer, type RideRenderer } from "../ride/render";
import { createRideHud, type RideHud } from "../ride/hud";
import { showRunComplete } from "../ride/runComplete";

const DEFAULT_MAX_SCORE = 50000;

export function createRideScreen(): Screen {
  // Per-track max score for star thresholds; refreshed from /api/stats on mount.
  let maxScore = DEFAULT_MAX_SCORE;
  let loop: RideLoop | null = null;
  let input: ReturnType<typeof createRideInput> | null = null;
  let dismissCard: (() => void) | null = null;
  let onResize: (() => void) | null = null;

  return {
    mount(root, params) {
      const trackId = Number(params.trackId);
      if (!Number.isInteger(trackId)) {
        root.innerHTML = `<div class="page"><div class="empty-state">Bad track id.</div></div>`;
        return;
      }

      // Riding requires an account (a deep-link here while logged out is gated
      // too — not just the RIDE button). Browsing the rest of the site is free.
      if (!isLoggedIn()) {
        root.innerHTML = `<div class="page">
          <div class="topnav"><a href="#/">← HOME</a></div>
          <div class="empty-state">Log in to ride this chart and compete for SOL.<br/><br/>
            <button class="btn-primary" id="gate-login">Log In / Sign Up</button>
          </div></div>`;
        const gate = (): void =>
          requireLogin(() => {
            root.replaceChildren();
            proceed();
          });
        root.querySelector<HTMLButtonElement>("#gate-login")?.addEventListener("click", gate);
        gate(); // open the modal immediately; the placeholder stays if cancelled
        return;
      }
      proceed();

      function proceed(): void {
      const canvas = document.createElement("canvas");
      canvas.className = "game-canvas";
      root.appendChild(canvas);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        root.innerHTML = `<div class="page"><div class="empty-state">Canvas2D not supported.</div></div>`;
        return;
      }

      function resize(): void {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(window.innerWidth * dpr);
        canvas.height = Math.floor(window.innerHeight * dpr);
      }
      resize();
      onResize = resize;
      window.addEventListener("resize", resize);

      getStats()
        .then((s) => {
          maxScore = s.config.maxScoreDefault || DEFAULT_MAX_SCORE;
        })
        .catch(() => {
          /* keep default; stars are cosmetic */
        });

      getTrackCached(trackId)
        .then((track) => start(root, ctx, track))
        .catch(() => {
          root.innerHTML = `<div class="page"><div class="topnav"><a href="#/">← HOME</a></div><div class="empty-state">Could not load track ${trackId}.</div></div>`;
        });
      }
    },

    unmount() {
      loop?.stop();
      input?.dispose();
      dismissCard?.();
      if (onResize) window.removeEventListener("resize", onResize);
    },
  };

  function start(root: HTMLElement, ctx: CanvasRenderingContext2D, track: TrackResponse): void {
    const points = track.points;
    const parTimeMs = track.par_time_ms ?? undefined;
    const trackName = `${track.cr_maps.name} · ${track.mode}`;

    // Probe sim once for the static track layout + spawn (the loop owns its own).
    const probe = createSim(points, undefined, { parTimeMs });
    const trackInfo: TrackInfo = getTrackInfo(probe);
    const spawn = { x: trackInfo.spawnX, y: getSnapshot(probe).chassis.y };

    const hud: RideHud = createRideHud(root, trackName);
    const renderer: RideRenderer = createRideRenderer(trackInfo, hud.minimap);

    // Label the finish flag with this track's rank-1 prize (from /api/maps tiers).
    getMapsCached()
      .then((res) => {
        for (const m of res.maps) {
          for (const tier of TIERS) {
            const tt = m.tiers[tier];
            if (tt?.raw?.trackId === track.id || tt?.smooth?.trackId === track.id) {
              renderer.setFinishPrize(tt.prize?.[0] ?? null);
              return;
            }
          }
        }
      })
      .catch(() => {
        /* prize label is cosmetic — ignore */
      });

    // New-player controls hint — shows briefly at the start of the ride, fades out.
    const hint = document.createElement("div");
    hint.className = "ride-controls-hint";
    hint.textContent = "W throttle · Space jump · A/D lean";
    root.appendChild(hint);
    window.setTimeout(() => hint.classList.add("fade"), 4000);
    window.setTimeout(() => hint.remove(), 5200);

    let muted = false;
    input = createRideInput({
      onRespawn: () => {
        loop?.respawn();
        renderer.reset(spawn.x, spawn.y);
      },
      onMute: () => {
        muted = !muted;
      },
      onQuit: () => loop?.quit(),
    });
    const readMask = input.mask;

    const begin = (): void => {
      dismissCard?.();
      dismissCard = null;
      renderer.reset(spawn.x, spawn.y);
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
            hud.update(f.curr, f.airSeconds, muted);
          },
          onEnd: (end) => onEnd(root, track, end),
        },
        readMask,
      );
    };

    begin();

    function onEnd(host: HTMLElement, trk: TrackResponse, end: RideEnd): void {
      const snap = end.snap;
      dismissCard = showRunComplete(
        host,
        {
          score: snap.score,
          speedScore: snap.speedScore,
          trickBonus: snap.trickBonus,
          effectiveTimeMs: snap.effectiveTimeMs || snap.simTime * 1000,
          finished: snap.finished,
          flips: snap.flips,
          backflips: snap.backflips,
          frontflips: snap.frontflips,
          crashes: snap.crashes,
          maxCombo: end.maxCombo,
          timeMs: snap.simTime * 1000,
          maxScore,
        },
        {
          // Auto-submits the moment the run ends (finish OR quit); the card
          // shows the saving/saved status. Returns the promise for that status.
          autoSubmit: () =>
            submitRun({
              trackId: trk.id,
              mode: trk.mode,
              clientScore: snap.score,
              timeMs: Math.round(snap.simTime * 1000),
              ticks: snap.tick,
              flips: snap.flips,
              crashes: snap.crashes,
              maxCombo: end.maxCombo,
              finished: snap.finished,
              simVersion: SIM_VERSION,
              inputLog: end.log,
            }),
          onRetry: () => begin(),
          onNewTrack: () => {
            location.hash = "#/";
          },
        },
      );
    }
  }
}
