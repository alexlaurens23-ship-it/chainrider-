import { describe, expect, it } from "vitest";
import { dayBoundsUTC, pickDailyWinner, pickRandomTrackId, type DailyRun } from "../src/daily.js";

describe("dayBoundsUTC", () => {
  it("returns the UTC-midnight bounds of the day containing the instant", () => {
    const b = dayBoundsUTC(new Date("2026-06-16T14:05:47.000Z"));
    expect(b.challengeDate).toBe("2026-06-16");
    expect(b.startsAt).toBe("2026-06-16T00:00:00.000Z");
    expect(b.endsAt).toBe("2026-06-17T00:00:00.000Z");
  });
  it("handles the last second before midnight without rolling the date", () => {
    const b = dayBoundsUTC(new Date("2026-12-31T23:59:59.999Z"));
    expect(b.challengeDate).toBe("2026-12-31");
    expect(b.endsAt).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("pickRandomTrackId", () => {
  it("always returns one of the given ids, and draws across the full set", () => {
    const ids = Array.from({ length: 108 }, (_, i) => i + 1);
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) {
      const id = pickRandomTrackId(ids)!;
      expect(ids).toContain(id);
      seen.add(id);
    }
    // Over thousands of draws it should hit a large fraction of the 108 tracks
    // (not stuck on one) — proves it's random across the pool, not fixed.
    expect(seen.size).toBeGreaterThan(80);
  });
  it("returns null for an empty pool", () => {
    expect(pickRandomTrackId([])).toBeNull();
  });
});

describe("pickDailyWinner", () => {
  const run = (runId: number, serverScore: number, timeMs: number, playerId = `p${runId}`): DailyRun => ({
    runId,
    playerId,
    serverScore,
    timeMs,
  });

  it("picks the highest server_score", () => {
    const w = pickDailyWinner([run(1, 5000, 90000), run(2, 8200, 120000), run(3, 6100, 80000)]);
    expect(w?.runId).toBe(2);
  });
  it("breaks ties by lower time_ms", () => {
    const w = pickDailyWinner([run(1, 8000, 130000), run(2, 8000, 110000)]);
    expect(w?.runId).toBe(2);
  });
  it("returns null when there are no finishers", () => {
    expect(pickDailyWinner([])).toBeNull();
  });
});
