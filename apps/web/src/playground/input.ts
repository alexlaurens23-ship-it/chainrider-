import { INPUT } from "@chainrider/physics";
import type { Keymask } from "@chainrider/physics";

const KEY_BITS: Record<string, number> = {
  KeyW: INPUT.THROTTLE,
  ArrowUp: INPUT.THROTTLE,
  KeyS: INPUT.BRAKE,
  ArrowDown: INPUT.BRAKE,
  KeyA: INPUT.LEAN_LEFT,
  ArrowLeft: INPUT.LEAN_LEFT,
  KeyD: INPUT.LEAN_RIGHT,
  ArrowRight: INPUT.LEAN_RIGHT,
  Space: INPUT.JUMP,
};

export interface PlaygroundInput {
  /** Current keymask. The loop samples this exactly once per fixed step. */
  mask(): Keymask;
  /** Called when the user presses R. */
  onReset(cb: () => void): void;
}

export function createInput(): PlaygroundInput {
  let mask = 0;
  let resetCb: (() => void) | null = null;

  window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    const bit = KEY_BITS[e.code];
    if (bit) {
      mask |= bit;
      e.preventDefault();
    } else if (e.code === "KeyR") {
      resetCb?.();
    }
  });
  window.addEventListener("keyup", (e) => {
    const bit = KEY_BITS[e.code];
    if (bit) {
      mask &= ~bit;
      e.preventDefault();
    }
  });
  // Don't carry stale input across focus loss.
  window.addEventListener("blur", () => {
    mask = 0;
  });

  return {
    mask: () => mask,
    onReset: (cb) => {
      resetCb = cb;
    },
  };
}
