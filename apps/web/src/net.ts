// Thin typed wrapper over the CHAINRIDER api. In dev, Vite proxies /api to
// http://localhost:8787; in production the api is served from the same origin.
import type { TrackPoint } from "@chainrider/physics";

const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new ApiError(response.status, `${path} failed with status ${response.status}`);
  }
  return (await response.json()) as T;
}

export interface HealthResponse {
  status: string;
}

export function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}

// ── Track / map types (mirror apps/api responses) ───────────────────────────

export type Difficulty = "easy" | "medium" | "hard" | "insane";

export interface TrackStats {
  worldLength: number;
  maxSlopeDeg: number;
  volatility: number;
  difficulty: Difficulty;
  pointCount: number;
}

export interface TrackSummary {
  trackId: number;
  version: number;
  parTimeMs: number | null;
  stats: TrackStats;
}

export interface MapEntry {
  id: number;
  slug: string;
  symbol: string;
  name: string;
  source: string;
  period: string;
  difficulty: Difficulty;
  tracks: { raw: TrackSummary | null; smooth: TrackSummary | null };
}

/** prizeLadder[difficulty] = [rank1Sol, rank2Sol, rank3Sol]. */
export type PrizeLadder = Record<Difficulty, number[]>;

export interface MapsResponse {
  maps: MapEntry[];
  prizeLadder: PrizeLadder | null;
}

export interface TrackResponse {
  id: number;
  map_id: number;
  mode: "raw" | "smooth";
  version: number;
  points: TrackPoint[];
  point_count: number;
  world_length: number;
  max_slope_deg: number;
  volatility: number;
  par_time_ms: number | null;
  active: boolean;
  created_at: string;
  cr_maps: { slug: string; name: string };
}

export interface StatsResponse {
  ridesCompleted: number;
  totalSolPaid: number;
  config: { windowMinutes: number; maxScoreDefault: number };
}

export interface LeaderRow {
  rank: number;
  player: string;
  score: number;
  timeMs: number;
}

export interface SubmitRunPayload {
  trackId: number;
  mode: "raw" | "smooth";
  score: number;
  timeMs: number;
  ticks: number;
  flips: number;
  crashes: number;
  maxCombo: number;
  simVersion: number;
  inputLog: [number, number][];
}

export function getMaps(): Promise<MapsResponse> {
  return apiFetch<MapsResponse>("/maps");
}

export function getTrack(id: number): Promise<TrackResponse> {
  return apiFetch<TrackResponse>(`/tracks/${id}`);
}

// Frozen tracks and the active map list don't change between screens, so cache
// them in-memory for instant Home↔MapDetail navigation and sparkline reuse.
let mapsCache: MapsResponse | null = null;
const trackCache = new Map<number, TrackResponse>();

export async function getMapsCached(): Promise<MapsResponse> {
  if (!mapsCache) mapsCache = await getMaps();
  return mapsCache;
}

export async function getTrackCached(id: number): Promise<TrackResponse> {
  const hit = trackCache.get(id);
  if (hit) return hit;
  const track = await getTrack(id);
  trackCache.set(id, track);
  return track;
}

export function getStats(): Promise<StatsResponse> {
  return apiFetch<StatsResponse>("/stats");
}

export function getLeaderboard(trackId: number): Promise<LeaderRow[]> {
  return apiFetch<LeaderRow[]>(`/leaderboards/${trackId}`);
}

export function submitRun(payload: SubmitRunPayload): Promise<unknown> {
  return apiFetch<unknown>("/runs/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}
