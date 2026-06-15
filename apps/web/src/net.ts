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

/** sessionStorage key for the owner admin key (separate from the player JWT). */
export const ADMIN_KEY_STORAGE = "cr_admin_key";

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  // Attach the player JWT (if logged in) so authed routes accept the request.
  const token = getToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  // Attach the admin key (only set on #/admin) for X-Admin-Key-gated routes.
  const adminKey = sessionStorage.getItem(ADMIN_KEY_STORAGE);
  if (adminKey) headers.set("x-admin-key", adminKey);
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!response.ok) {
    // Surface the server's { error } message (e.g. lockout text) when present.
    let message = `${path} failed with status ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON body — keep the default message */
    }
    throw new ApiError(response.status, message);
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

// ── Auth (username + PIN + wallet) ───────────────────────────────────────────

export interface SignupPayload {
  username: string;
  pin: string;
  walletAddress: string;
  walletAddressConfirm: string;
}
export interface LoginPayload {
  username: string;
  pin: string;
}
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

// ── Leaderboards + payout board (P7) ─────────────────────────────────────────

export type LeaderboardScope = "alltime" | "window";

export interface GlobalEntry {
  rank: number;
  username: string;
  score: number;
  timeMs: number;
  flips: number;
  createdAt: string;
}

export interface MyBoard {
  allTimeRank: number | null;
  best: { rank: number; score: number; timeMs: number; flips: number; createdAt: string }[];
}

export interface PayoutBoardRow {
  rank: number;
  trackId: number;
  prizeSol: number;
  symbol: string | null;
  period: string | null;
  tier: string | null;
  mode: string | null;
  label: string;
  leader: { username: string; score: number } | null;
}
export interface PayoutBoard {
  endsAt: string;
  tracks: PayoutBoardRow[];
}

export function getPayoutBoard(): Promise<PayoutBoard> {
  return apiFetch<PayoutBoard>("/leaderboards/payout-board");
}

export function getGlobalLeaderboard(
  trackId: number,
  scope: LeaderboardScope,
): Promise<GlobalEntry[]> {
  return apiFetch<GlobalEntry[]>(`/leaderboards/${trackId}/global?scope=${scope}`);
}

export function getMyLeaderboard(trackId: number): Promise<MyBoard> {
  return apiFetch<MyBoard>(`/leaderboards/${trackId}/me`);
}

// ── Public receipts + replay (P7) ────────────────────────────────────────────

export interface ReceiptRow {
  paidAt: string | null;
  label: string;
  username: string;
  amountSol: number;
  txSig: string | null;
}
export function getPaidReceipts(): Promise<ReceiptRow[]> {
  return apiFetch<ReceiptRow[]>("/payouts/paid");
}

export interface ReplayData {
  trackId: number;
  inputLog: [number, number][];
  username: string;
  label: string;
  serverScore: number | null;
  verifyStatus: string;
  timeMs: number;
}
export function getReplay(runId: number): Promise<ReplayData> {
  return apiFetch<ReplayData>(`/runs/${runId}/replay`);
}

// ── Admin payout panel (X-Admin-Key, P7) ─────────────────────────────────────

export interface PendingPayout {
  id: number;
  windowId: number;
  windowStartsAt: string | null;
  trackId: number;
  runId: number;
  rank: number;
  amountSol: number;
  username: string;
  wallet: string;
  label: string;
}
export interface PendingPayouts {
  totalSol: number;
  payouts: PendingPayout[];
}
export function getPendingPayouts(): Promise<PendingPayouts> {
  return apiFetch<PendingPayouts>("/admin/payouts/pending");
}
export function markPaid(id: number, txSig: string): Promise<{ ok: boolean }> {
  return postJson(`/admin/payouts/${id}/paid`, { txSig });
}
export function skipPayout(id: number, reason: string): Promise<{ ok: boolean }> {
  return postJson(`/admin/payouts/${id}/skip`, { reason });
}

export interface FlaggedRun {
  runId: number;
  username: string;
  clientScore: number;
  serverScore: number | null;
  timeMs: number;
  createdAt: string;
  windowId: number | null;
  label: string;
}
export function getFlaggedRuns(): Promise<FlaggedRun[]> {
  return apiFetch<FlaggedRun[]>("/admin/runs/flagged");
}
export function approveRun(id: number): Promise<{ ok: boolean }> {
  return postJson(`/admin/runs/${id}/approve`, {});
}
export function rejectRun(id: number): Promise<{ ok: boolean }> {
  return postJson(`/admin/runs/${id}/reject`, {});
}

export interface WindowHistoryRow {
  id: number;
  startsAt: string;
  endsAt: string;
  status: string;
  totalSol: number;
  pendingCount: number;
  paidCount: number;
}
export function getWindowHistory(): Promise<WindowHistoryRow[]> {
  return apiFetch<WindowHistoryRow[]>("/admin/windows");
}

/** TESTING ONLY (remove before launch): force-close a window now (runs closeWindow). */
export function forceCloseWindow(
  id: number,
): Promise<{ ok: boolean; windowId: number; inserted: number; skippedAlreadyPaid: number }> {
  return postJson(`/admin/windows/${id}/close`, {});
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

export function postSignup(payload: SignupPayload): Promise<SessionResponse> {
  return postJson<SessionResponse>("/auth/signup", payload);
}

export function postLogin(payload: LoginPayload): Promise<SessionResponse> {
  return postJson<SessionResponse>("/auth/login", payload);
}
