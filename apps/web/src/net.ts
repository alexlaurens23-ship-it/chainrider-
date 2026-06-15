// Thin typed wrapper over the CHAINRIDER api. In dev, Vite proxies /api to
// http://localhost:8787; in production the api is served from the same origin.
import type { TrackPoint } from "@chainrider/physics";
import { getToken } from "./auth";

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
  // Attach the player JWT (if logged in) so authed routes accept the request.
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
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

/** Difficulty tiers — each is a separately generated, more dramatic track set (easiest → hardest). */
export type Tier = "VOLATILE" | "DEGEN" | "SAVAGE";
export const TIERS: Tier[] = ["VOLATILE", "DEGEN", "SAVAGE"];

export interface TierTracks {
  /** Window prize ladder [rank1Sol, rank2Sol, rank3Sol] for this tier. */
  prize: number[] | null;
  raw: TrackSummary | null;
  smooth: TrackSummary | null;
}

export interface MapEntry {
  id: number;
  slug: string;
  symbol: string;
  name: string;
  source: string;
  period: string;
  tiers: Record<Tier, TierTracks>;
  // NOTE: /api/maps still emits legacy `difficulty` + `tracks` (backed by one
  // tier) but the tier UI reads `tiers` only — intentionally omitted here so
  // nothing depends on them; remove from the API in a later cleanup.
}

/** prizeLadder[tier] = [rank1Sol, rank2Sol, rank3Sol]. */
export type PrizeLadder = Record<Tier, number[]>;

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
  /** The client's computed score — checked against the server re-sim, never ranked. */
  clientScore: number;
  timeMs: number;
  ticks: number;
  flips: number;
  crashes: number;
  maxCombo: number;
  finished: boolean;
  simVersion: number;
  inputLog: [number, number][];
}

export type VerifyStatus = "verified" | "flagged" | "failed" | "pending";

/** Server's authoritative verdict on a submitted run. */
export interface SubmitRunResult {
  verifyStatus: VerifyStatus;
  serverScore: number | null;
  /** Present only for verified + finished runs. */
  rankThisWindow?: number;
  rankAllTime?: number;
}

// ── Auth (wallet sign-in) ────────────────────────────────────────────────────

export interface NonceResponse {
  message: string;
}
/** /verify returns either a session or a needs-username signal. */
export type VerifyResponse =
  | { token: string; username: string; needsUsername?: undefined }
  | { needsUsername: true; token?: undefined; username?: undefined };
export interface SessionResponse {
  token: string;
  username: string;
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

export function submitRun(payload: SubmitRunPayload): Promise<SubmitRunResult> {
  return apiFetch<SubmitRunResult>("/runs/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function postJson<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function postNonce(walletAddress: string): Promise<NonceResponse> {
  return postJson<NonceResponse>("/auth/nonce", { walletAddress });
}

export function postVerify(walletAddress: string, signature: string): Promise<VerifyResponse> {
  return postJson<VerifyResponse>("/auth/verify", { walletAddress, signature });
}

export function postRegister(
  walletAddress: string,
  signature: string,
  username: string,
): Promise<SessionResponse> {
  return postJson<SessionResponse>("/auth/register", { walletAddress, signature, username });
}
