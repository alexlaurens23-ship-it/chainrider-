import { describe, expect, it } from "vitest";
import { rankOfPlayer, topPerPlayer, type LeaderboardRun } from "../src/leaderboards.js";

function run(playerId: string, score: number, timeMs: number): LeaderboardRun {
  return { playerId, username: playerId, serverScore: score, timeMs, flips: 0, createdAt: "t" };
}

describe("topPerPlayer", () => {
  it("keeps one row per player (their best), score-desc then time-asc, ranked", () => {
    const rows = [
      run("a", 100, 5000),
      run("a", 120, 6000), // a's best (higher score wins even if slower)
      run("b", 120, 5500), // ties a on score, faster → ranks above a
      run("c", 90, 4000),
    ];
    const board = topPerPlayer(rows, 10);
    expect(board.map((e) => e.username)).toEqual(["b", "a", "c"]);
    expect(board.map((e) => e.rank)).toEqual([1, 2, 3]);
    expect(board[0]).toMatchObject({ username: "b", score: 120, timeMs: 5500 });
    expect(board[1]).toMatchObject({ username: "a", score: 120, timeMs: 6000 });
  });

  it("caps at N", () => {
    const rows = Array.from({ length: 30 }, (_, i) => run(`p${i}`, 1000 - i, 1000));
    expect(topPerPlayer(rows, 20)).toHaveLength(20);
    expect(topPerPlayer(rows, 20)[0].username).toBe("p0");
  });

  it("empty input → []", () => {
    expect(topPerPlayer([], 20)).toEqual([]);
  });
});

describe("rankOfPlayer", () => {
  const rows = [run("a", 120, 6000), run("b", 120, 5500), run("c", 90, 4000)];

  it("returns the 1-based rank among per-player bests", () => {
    expect(rankOfPlayer(rows, "b")).toBe(1);
    expect(rankOfPlayer(rows, "a")).toBe(2);
    expect(rankOfPlayer(rows, "c")).toBe(3);
  });

  it("null when the player has no run", () => {
    expect(rankOfPlayer(rows, "ghost")).toBeNull();
  });
});
