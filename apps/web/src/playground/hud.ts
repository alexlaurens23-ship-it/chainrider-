import type { SimSnapshot } from "@chainrider/physics";
import { getHealth } from "../net";

export interface Hud {
  update(snap: SimSnapshot, fps: number): void;
}

export function createHud(root: HTMLElement): Hud {
  const el = document.createElement("div");
  el.className = "hud";
  root.appendChild(el);

  const status = document.createElement("div");
  status.className = "hud-status";
  root.appendChild(status);

  let apiStatus = "api: checking…";
  getHealth()
    .then((h) => {
      apiStatus = `api: ${h.status}`;
    })
    .catch(() => {
      apiStatus = "api: offline";
    });

  return {
    update(snap, fps) {
      el.textContent =
        `SCORE ${snap.score}   COMBO x${snap.combo}\n` +
        `flips ${snap.flips} (back ${snap.backflips} / front ${snap.frontflips})\n` +
        `air ${snap.airTicks}t   wheelie ${snap.wheelieTicks}t   crashes ${snap.crashes}\n` +
        `tick ${snap.tick}   t ${snap.simTime.toFixed(1)}s   fps ${fps.toFixed(0)}\n` +
        `${apiStatus}\n` +
        `W/↑ throttle  S/↓ brake  A/← lean back  D/→ lean fwd  Space jump  R reset`;
      status.textContent = snap.finished ? "FINISHED" : snap.crashed ? "CRASHED" : "";
      status.style.color = snap.finished ? "#00ff88" : "#ff3c3c";
    },
  };
}
