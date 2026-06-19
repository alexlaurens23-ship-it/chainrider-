import { INPUT } from "@chainrider/physics";
import type { RideInput } from "./input";

/** True on phones/tablets (any coarse pointer / touch capability). */
export function isTouchDevice(): boolean {
  return (
    "ontouchstart" in window ||
    navigator.maxTouchPoints > 0 ||
    window.matchMedia?.("(pointer: coarse)").matches === true
  );
}

function isPortrait(): boolean {
  return window.innerHeight > window.innerWidth;
}

export interface TouchControls {
  dispose(): void;
}

/**
 * On-screen thumb controls for touch devices. Each button drives the SAME input
 * mask the keyboard does (input.setBit with the existing INPUT bits) — no new
 * input path, no physics/scoring change. Lean ◀ ▶ sit bottom-left; GAS + JUMP
 * bottom-right. Pointer events give real multi-touch (hold GAS while tapping
 * JUMP); pointer capture + a blur/visibility safety net guarantee no stuck bit
 * if a touch is interrupted or the finger slides off. A portrait overlay nudges
 * the player to rotate (the game reads best in landscape).
 */
export function createTouchControls(root: HTMLElement, input: RideInput): TouchControls {
  const boundBits = [INPUT.THROTTLE, INPUT.JUMP, INPUT.LEAN_LEFT, INPUT.LEAN_RIGHT];
  const cleanups: Array<() => void> = [];

  const overlay = document.createElement("div");
  overlay.className = "touch-controls";
  overlay.innerHTML = `
    <div class="touch-cluster touch-left">
      <button class="touch-btn lean" data-label="LEAN" id="t-leanl" aria-label="Lean left">◀</button>
      <button class="touch-btn lean" data-label="LEAN" id="t-leanr" aria-label="Lean right">▶</button>
    </div>
    <div class="touch-cluster touch-right">
      <button class="touch-btn jump" id="t-jump" aria-label="Jump">JUMP</button>
      <button class="touch-btn gas" id="t-gas" aria-label="Gas">GAS</button>
    </div>
  `;
  root.appendChild(overlay);

  const rotate = document.createElement("div");
  rotate.className = "rotate-prompt";
  rotate.innerHTML = `<div class="rotate-inner"><div class="rotate-icon">⟳</div>Rotate your phone to landscape to ride</div>`;
  root.appendChild(rotate);

  /** Bind a button so any finger on it holds `bit`; releases only when the last
   *  finger lifts. Pointer capture keeps the press alive if the finger slides
   *  off the button, and pointercancel (interruption) always releases. */
  function bindHold(el: HTMLElement, bit: number): void {
    const pointers = new Set<number>();
    const press = (e: PointerEvent): void => {
      e.preventDefault();
      pointers.add(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
      input.setBit(bit, true);
      el.classList.add("active");
    };
    const release = (e: PointerEvent): void => {
      e.preventDefault();
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        input.setBit(bit, false);
        el.classList.remove("active");
      }
    };
    el.addEventListener("pointerdown", press);
    el.addEventListener("pointerup", release);
    el.addEventListener("pointercancel", release);
    cleanups.push(() => {
      el.removeEventListener("pointerdown", press);
      el.removeEventListener("pointerup", release);
      el.removeEventListener("pointercancel", release);
    });
  }

  bindHold(overlay.querySelector<HTMLElement>("#t-gas")!, INPUT.THROTTLE);
  bindHold(overlay.querySelector<HTMLElement>("#t-jump")!, INPUT.JUMP);
  bindHold(overlay.querySelector<HTMLElement>("#t-leanl")!, INPUT.LEAN_LEFT);
  bindHold(overlay.querySelector<HTMLElement>("#t-leanr")!, INPUT.LEAN_RIGHT);

  // Safety net: if the page is backgrounded / loses focus / a stray pointer is
  // cancelled, drop EVERY bit so nothing sticks on.
  const clearAll = (): void => {
    for (const bit of boundBits) input.setBit(bit, false);
    overlay.querySelectorAll(".touch-btn.active").forEach((b) => b.classList.remove("active"));
  };
  const onVisibility = (): void => {
    if (document.hidden) clearAll();
  };
  window.addEventListener("blur", clearAll);
  window.addEventListener("pointercancel", clearAll);
  document.addEventListener("visibilitychange", onVisibility);

  // Portrait → show the rotate prompt and release inputs (the overlay covers the
  // buttons, so a held finger shouldn't keep driving the bike).
  const updateOrientation = (): void => {
    const portrait = isPortrait();
    rotate.classList.toggle("show", portrait);
    overlay.classList.toggle("hidden", portrait);
    if (portrait) clearAll();
  };
  updateOrientation();
  window.addEventListener("resize", updateOrientation);
  window.addEventListener("orientationchange", updateOrientation);

  return {
    dispose() {
      clearAll();
      for (const fn of cleanups) fn();
      window.removeEventListener("blur", clearAll);
      window.removeEventListener("pointercancel", clearAll);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", updateOrientation);
      window.removeEventListener("orientationchange", updateOrientation);
      overlay.remove();
      rotate.remove();
    },
  };
}
