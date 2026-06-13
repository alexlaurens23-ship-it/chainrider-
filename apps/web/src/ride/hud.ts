import type { SimSnapshot } from "@chainrider/physics";
import { formatClock, formatScore } from "../ui/format";

export interface RideHud {
  update(snap: SimSnapshot, airSeconds: number, muted: boolean): void;
  /** Renderer draws the whole-track minimap + position dot into this. */
  readonly minimap: HTMLCanvasElement;
}

const MINIMAP_W = 200;
const MINIMAP_H = 64;

/** Fixed DOM overlays for the ride screen. Cleared when the router empties root. */
export function createRideHud(root: HTMLElement, trackName: string): RideHud {
  const tl = document.createElement("div");
  tl.className = "ride-hud-tl";
  tl.innerHTML = `
    <div class="track-name">${trackName}</div>
    <div class="score" id="rh-score">0</div>
    <div class="combo" id="rh-combo">x1</div>
    <div class="air" id="rh-air"></div>
  `;
  root.appendChild(tl);

  const tc = document.createElement("div");
  tc.className = "ride-hud-tc";
  tc.id = "rh-clock";
  tc.textContent = "0:00.0";
  root.appendChild(tc);

  const minimap = document.createElement("canvas");
  minimap.className = "ride-minimap";
  minimap.style.width = `${MINIMAP_W}px`;
  minimap.style.height = `${MINIMAP_H}px`;
  const dpr = window.devicePixelRatio || 1;
  minimap.width = Math.floor(MINIMAP_W * dpr);
  minimap.height = Math.floor(MINIMAP_H * dpr);
  root.appendChild(minimap);

  const legend = document.createElement("div");
  legend.className = "ride-legend";
  legend.innerHTML = `
    <b>W/↑</b> throttle &nbsp; <b>S/↓</b> brake<br/>
    <b>A/←</b> lean back &nbsp; <b>D/→</b> lean fwd<br/>
    <b>Space</b> jump &nbsp; <b>R</b> respawn<br/>
    <b>M</b> mute &nbsp; <b>Esc</b> quit
  `;
  root.appendChild(legend);

  const status = document.createElement("div");
  status.className = "hud-status";
  root.appendChild(status);

  const scoreEl = tl.querySelector<HTMLDivElement>("#rh-score")!;
  const comboEl = tl.querySelector<HTMLDivElement>("#rh-combo")!;
  const airEl = tl.querySelector<HTMLDivElement>("#rh-air")!;

  return {
    minimap,
    update(snap, airSeconds, muted) {
      scoreEl.textContent = formatScore(snap.score);
      comboEl.textContent = `x${snap.combo}`;
      comboEl.style.opacity = snap.combo > 1 ? "1" : "0.5";
      airEl.textContent = !snap.grounded && airSeconds > 0 ? `AIR ${airSeconds.toFixed(1)}s` : "";
      tc.textContent = formatClock(snap.simTime * 1000) + (muted ? "  🔇" : "");
      status.textContent = snap.crashed ? "CRASHED" : "";
      status.style.color = "#ff3c3c";
    },
  };
}

export { MINIMAP_W, MINIMAP_H };
