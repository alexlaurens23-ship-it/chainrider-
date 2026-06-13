import type { Difficulty } from "../net";

const DIFFICULTY_COLORS: Record<Difficulty, string> = {
  easy: "#3ef0a0",
  medium: "#ffc24b",
  hard: "#ff8a3c",
  insane: "#ff3c5a",
};

export function difficultyColor(d: Difficulty): string {
  return DIFFICULTY_COLORS[d] ?? "#9fb4c8";
}

/** Trim trailing zeros: 0.15 -> "0.15", 0.1 -> "0.1", 1 -> "1". */
export function formatSol(n: number): string {
  return Number(n.toFixed(4)).toString();
}

export function formatScore(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** ms -> M:SS.t (run clock). */
export function formatClock(ms: number): string {
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const tenths = Math.floor((totalSec * 10) % 10);
  return `${m}:${s.toString().padStart(2, "0")}.${tenths}`;
}

/** ms -> MM:SS (countdown). */
export function formatCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}
