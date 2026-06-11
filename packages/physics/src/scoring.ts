/**
 * Scoring constants — the single source of truth for run scoring.
 * Hard rule: scoring lives ONLY in this package; web and api import it.
 * Bump `version` whenever any rule changes so old runs stay comparable.
 */
export const SCORING = {
  version: 1,
  pointsPerMeter: 1,
  airTimePointsPerSecond: 10,
  flipBonus: 100,
  crashPenalty: 0,
} as const;

export type ScoringConstants = typeof SCORING;
