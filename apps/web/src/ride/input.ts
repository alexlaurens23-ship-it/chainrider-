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

export interface RideInput {
  /** Current keymask. The loop samples this exactly once per fixed step. */
  mask(): Keymask;
  /** Remove all window listeners (call on unmount). */
  dispose(): void;
}

export interface RideInputHandlers {
  onRespawn(): void;
  onMute(): void;
  onQuit(): void;
}

/**
 * Keyboard → keymask for the ride screen. Same INPUT bit layout as the sim,
 * plus R (respawn), M (mute), Esc (quit). Returns dispose() so the router can
 * tear down listeners cleanly.
 */
export function createRideInput(handlers: RideInputHandlers): RideInput {
  let mask = 0;

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const bit = KEY_BITS[e.code];
    if (bit) {
      mask |= bit;
      e.preventDefault();
      return;
    }
    if (e.code === "KeyR") handlers.onRespawn();
    else if (e.code === "KeyM") handlers.onMute();
    else if (e.code === "Escape") handlers.onQuit();
  };
  const onKeyUp = (e: KeyboardEvent): void => {
    const bit = KEY_BITS[e.code];
    if (bit) {
      mask &= ~bit;
      e.preventDefault();
    }
  };
  const onBlur = (): void => {
    mask = 0;
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return {
    mask: () => mask,
    dispose() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    },
  };
}
