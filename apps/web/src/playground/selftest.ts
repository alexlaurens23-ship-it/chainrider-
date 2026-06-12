import { simulateReplay } from "@chainrider/physics";
import type { BikeTune, InputLogEntry, SimSnapshot, TrackPoint } from "@chainrider/physics";

export const SELF_TEST_TICKS = 600;

export interface SelfTestUi {
  button(onStart: () => void): void;
  showRecording(ticksLeft: number): void;
  /** Compare the live run against a headless replay of its input log. */
  finish(
    track: TrackPoint[],
    tune: BikeTune,
    log: InputLogEntry[],
    ticks: number,
    live: SimSnapshot,
  ): void;
  cancel(): void;
}

export function createSelfTest(root: HTMLElement): SelfTestUi {
  const button = document.createElement("button");
  button.className = "selftest-btn";
  button.textContent = "DETERMINISM SELF-TEST";
  root.appendChild(button);

  const overlay = document.createElement("div");
  overlay.className = "selftest-overlay";
  root.appendChild(overlay);

  return {
    button(onStart) {
      button.addEventListener("click", () => {
        button.blur(); // keep Space as jump, not button re-click
        onStart();
      });
    },
    showRecording(ticksLeft) {
      overlay.className = "selftest-overlay recording";
      overlay.textContent = `RECORDING ${ticksLeft} ticks — ride!`;
    },
    finish(track, tune, log, ticks, live) {
      const replay = simulateReplay(track, tune, log, ticks);
      const pass =
        replay.score === live.score &&
        replay.finalChassis.x === live.chassis.x &&
        replay.finalChassis.y === live.chassis.y;
      overlay.className = `selftest-overlay ${pass ? "pass" : "fail"}`;
      overlay.textContent =
        `${pass ? "PASS" : "FAIL"} — determinism self-test (${ticks} ticks, ${log.length} input events)\n` +
        `live   score ${live.score}  x ${live.chassis.x}  y ${live.chassis.y}\n` +
        `replay score ${replay.score}  x ${replay.finalChassis.x}  y ${replay.finalChassis.y}`;
    },
    cancel() {
      overlay.className = "selftest-overlay";
      overlay.textContent = "";
    },
  };
}
