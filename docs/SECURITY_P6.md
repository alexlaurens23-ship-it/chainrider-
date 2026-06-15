# SECURITY_P6 — adversarial review of CHAINRIDER auth + run submission

**Scope:** the *current* auth + run-submission code on `main` (commit `fa7b3fb`).
**Reviewer note — the threat model moved.** The original P6 used Phantom
wallet-signature login (nonce → `signMessage` → ed25519 verify). That was
**replaced** in P6-rev by username + 4-digit PIN + a pasted wallet address.
**There are no nonces or signatures in the live code** — `cr_auth_nonces` exists
but is unused. So probe #1 (nonce replay) is largely *N/A*; its live equivalent
is **PIN brute-force**, which is where the real auth risk now sits.

This document changes no behavior. It ranks concrete attacks; you pick which
fixes land in `P6b`.

## Severity summary

| # | Sev | Finding | Location |
|---|-----|---------|----------|
| H1 | **High** | Account lockout bypass via concurrent requests (lost-update on `failed_attempts`) | `accounts.ts` performLogin L203–221 / repo L276–283 |
| H2 | **High** | JWT verify doesn't pin algorithm; secret strength unenforced (forgery → full impersonation) | `auth.ts` L33, L37; `.env.example` |
| M3 | Medium | Payout-window double-create race; submit can attach to a closed window | `runs.ts` `getOrCreateOpenWindow` L63–85 |
| M4 | Medium | Submission/replay-queue DoS (racy rate-limit, unbounded serial queue, no time budget) | `runs.ts` L159–164, L51–56, L206 |
| M5 | Medium | Username lookup uses `ILIKE`; `_` is a LIKE wildcard (over-match, login DoS) | `accounts.ts` L240, L248 |
| M6 | Medium | 4-digit PIN brute-force ceiling — lockout fully resets every 15 min | `accounts.ts` `evaluateLogin` L70–88; `auth.ts` L13–25 |
| M7 | Medium | Runs accepted against INACTIVE/old track versions (no `active` check) | `runs.ts` L193–197 |
| L8 | Low | Login timing + status side-channels enumerate valid usernames | `accounts.ts` L191, L198 |
| L9 | Low | Signup reveals "wallet already claimed" distinctly (wallet enumeration/linkage) | `accounts.ts` L147–152 |
| L10 | Low | `CORS origin: true` reflects any origin | `index.ts` L18 |
| L11 | Low | Dead surface: unused `cr_auth_nonces` table | schema |

---

## H1 — Account lockout bypass via concurrent requests (High)

**Location:** `apps/api/src/accounts.ts` — `performLogin` reads `failed_attempts`
at L203–204, decides at L203–207, writes via `recordLoginResult` (L217) →
repo `update` at L276–283. Read-modify-write with no atomicity.

**Attack:** fire N wrong-PIN logins for one account *in parallel*. They all read
`failed_attempts = k` before any writes back, each computes `k+1`, each writes
`k+1`. The counter advances by 1 instead of N — the lock never trips. Repeat in
bursts to get effectively unlimited guesses against a 10⁴-space PIN. This defeats
the **mandatory** brute-force control.

**Mitigations already present:** the per-IP throttle (`auth.ts` L17–25) caps a
*single* IP at 20/15 min, so a one-host attacker is still limited. But that limiter
is in-memory (per-process, resets on restart, not shared across instances) and a
distributed/botnet attacker bypasses both it (many IPs) and the racy per-account
counter (concurrency) → unbounded guessing.

**Fix:** make the counter update atomic and authoritative in Postgres — e.g. a
`SECURITY DEFINER` function / single `update cr_players set failed_attempts =
failed_attempts + 1, locked_until = case when failed_attempts + 1 >= 5 then
now() + interval '15 min' end where id = $1 returning ...`, and derive the
lock decision from the returned row. Alternatively serialize per-account. Pair
with a durable, shared rate limiter (see M4/M6).

---

## H2 — JWT: algorithm not pinned + secret strength unenforced (High)

**Location:** `apps/api/src/auth.ts` — `signToken` L33 (`jwt.sign(..., { expiresIn }`)
and `verifyToken` L37 (`jwt.verify(token, jwtSecret())` — **no `algorithms`
option**). Secret comes from `process.env.JWT_SECRET` (L26–29) and throws only if
empty; `.env.example` ships it blank with no strength guidance.

**Attack:** (a) Not pinning `algorithms` on verify is the classic alg-confusion
footgun. `jsonwebtoken@9` rejects `alg:none` when a key is supplied, so this is
defense-in-depth rather than an open `none` bypass — but it should still be pinned.
(b) The real prize is a **weak/guessable `JWT_SECRET`**: HS256 tokens are forgeable
offline, so any attacker who guesses/brute-forces the secret can mint a token for
**any `playerId`**, impersonating arbitrary accounts and submitting/owning their
scores. A blank-by-default example invites a weak secret in prod.

**Fix:** `jwt.verify(token, secret, { algorithms: ["HS256"] })`; fail fast at
startup if `JWT_SECRET` is shorter than ~32 bytes of entropy; document generating
it with a CSPRNG. Optionally add `issuer`/`audience`. No token revocation exists
(7-day tokens) — acceptable, but note that `banned` is only re-checked on
`/runs/submit` (`runs.ts` L141–147); fine while that's the only authed route.

---

## M3 — Payout-window double-create race + closed-window attach (Medium)

**Location:** `apps/api/src/runs.ts` `getOrCreateOpenWindow` L63–85.

**Attack / bug:** the helper does SELECT-by-`starts_at` then INSERT, and there is
**no unique constraint on `cr_payout_windows(starts_at)`** (P6-rev added none).
Two concurrent first-submits of a new 30-min slot both miss the SELECT and both
INSERT → **two window rows for the same slot**. Runs then split across two
`window_id`s → split per-window leaderboards and payouts. Separately, the helper
matches purely on `starts_at` and never checks `status` — a late submit in a slot
the P7 cron has already **closed** attaches to a *closed* window (L66–71), so its
score silently won't be paid (or perturbs an idempotent re-close).

**Fix:** add `create unique index on cr_payout_windows (starts_at)` and use
`upsert(..., { onConflict: "starts_at", ignoreDuplicates: true })` then re-select;
make the cron the sole authority on `status` and have submit refuse to bucket into
a non-`open` window (or roll to the next open one).

---

## M4 — Submission / replay-queue DoS (Medium)

**Location:** `apps/api/src/runs.ts` — rate-limit L159–164 (read `lastSubmitMs`
then set, non-atomic), serial verify queue L51–56, awaited replay L206–221.
`MAX_INPUT_LOG = 90000` (L24) and `MAX_REPLAY_TICKS = 72000` (`runVerify.ts` L19)
bound a *single* replay, but nothing bounds the *queue*.

**Attack:** the 10s/player gate is a TOCTOU — parallel requests all read the same
`last` and pass together. Combined with the **single global serial queue**, a few
clients submitting max-size (90 000-entry / 72 000-tick) logs can keep the queue
busy; because each handler **awaits its queue position**, every other player's
submit latency grows unboundedly (queue has no depth cap, and `simulateReplay` is
synchronous JS with no per-run wall-clock budget / cancellation). Each rejected-but-
inserted run also writes a `pending` row first (L168–185), amplifying DB load.

**Fix:** make the rate-limit check-and-set atomic and add a per-player *in-flight*
guard (one un-finished submit at a time); cap queue depth and return `503` when
exceeded; run replays in a worker thread/pool with a hard timeout so one
pathological log can't wedge the queue; move the limiter to a shared store
(Redis) for multi-instance correctness. Consider validating `inputLog` entry
shape (`[int tick ≥ 0, int keymask]`, monotonic) before enqueueing.

---

## M5 — Username lookup uses ILIKE; `_` is a LIKE wildcard (Medium)

**Location:** `apps/api/src/accounts.ts` repo `findByUsername` L240 and
`usernameTaken` L248 (`.ilike("username", username)`). The username regex
(`auth.ts` L67) **allows `_`**, which in SQL `LIKE`/`ILIKE` means "any one char".

**Attack / bug:** `b_b` is a *pattern* matching `bob`, `bab`, `b7b`, … So
`usernameTaken("b_b")` reports taken when `bob` exists (namespace squatting /
confusing UX), and `findByUsername("b_b")` resolves to another user's row.
`maybeSingle()` **throws when the pattern matches >1 row**, so a name like
`a_c` can hard-error logins for everyone matching it (a targeted login DoS).
It is *not* a PIN bypass (the matched user's hash is still required), and the DB
`unique(lower(username))` index is the real uniqueness guard — but the app logic
is wrong and inconsistent with it.

**Fix:** match exactly: `.eq("username", username)` on the already-lowercased
value (usernames are stored lowercased by `performSignup` L134 / `createPlayer`),
relying on the `lower(username)` unique index. Never feed user input to `ILIKE`
without escaping `%`/`_`.

---

## M6 — 4-digit PIN brute-force ceiling (Medium)

**Location:** `apps/api/src/accounts.ts` `evaluateLogin` L70–88; per-IP limiter
`auth.ts` L13–25.

**Issue:** even with the lockout working perfectly, an expired lock **fully resets
`failed_attempts` to 0** (L74–77), so a patient attacker gets a fresh 5 guesses
every 15 min = ~480/day/account, indefinitely. Against a 10⁴ keyspace that's a
~10–20 day crack per targeted account (faster with the H1 race or a botnet vs the
in-memory per-IP cap). A 4-digit PIN is simply weak.

**Fix:** escalate on repeat offenses (exponential backoff / progressively longer
locks that *don't* fully reset), add a CAPTCHA/proof-of-work after N lockouts,
and/or allow longer PINs (6+). Persist/shared the IP limiter. Treat together
with H1 (atomic counter) — the two compound.

---

## M7 — Runs accepted against INACTIVE / old track versions (Medium)

**Location:** `apps/api/src/runs.ts` L193–197 — loads `cr_tracks` by `id` and
checks only existence, never `active`.

**Attack:** tracks are versioned and frozen; regeneration leaves older, now-
`active=false` rows in `cr_tracks` (still served by `tracksRoutes`). A crafted
submit can target an inactive id and be verified/ranked against *those* frozen
points. **Today's blast radius is limited** — the paying pool filters
`active=true` (`payoutPool.ts` L36) and leaderboards are stubbed (`[]`), so an
inactive run neither pays nor shows. But it (a) spends scarce verify-queue budget
on arbitrary ids, (b) will mis-rank the moment `/leaderboards/:trackId` is
implemented if that query forgets `active`, and (c) lets scores be pre-seeded onto
a version that could later be re-activated.

**Fix:** select `active` and reject submissions where `active !== true`
(`400`/`409`); make every future ranking/leaderboard query filter `active`.

---

## L8 — Login timing + status side-channels enumerate usernames (Low)

`performLogin` returns immediately for an unknown user (`accounts.ts` L191) *before*
any bcrypt, while a real user pays a ~bcrypt-cost(10) compare — a measurable timing
oracle for "does this username exist". The `423` lock response (L198) also reveals
existence distinctly from the generic `401`. Usernames are public leaderboard names,
so value is low. **Fix:** run a dummy `bcrypt.compare` against a fixed throwaway
hash on the not-found path to equalize timing; keep messages generic.

## L9 — Signup distinguishes "wallet already claimed" (Low)

`performSignup` returns a distinct `409 "wallet already claimed by another account"`
(`accounts.ts` L150–152), letting anyone probe whether a given wallet is registered
(privacy/linkage). **Fix (optional):** a single generic "username or wallet
unavailable" message.

## L10 — `CORS origin: true` (Low)

`index.ts` L18 reflects any `Origin`. Because auth is a `Bearer` token in
`localStorage` (not a cookie), another origin can't read the token and there's no
CSRF ambient-credential vector — but lock CORS to known origins for defense-in-depth.

## L11 — Dead `cr_auth_nonces` table (Low)

P6-rev stopped using nonces but left the table. Drop it in a later migration to
shrink attack surface and avoid confusion.

---

## Probe-by-probe answers

1. **Nonce replay** — *N/A in live code.* Wallet-signature login and nonces were
   removed in P6-rev; `cr_auth_nonces` is unused (L11). There is no captured
   nonce/signature to replay. The live equivalent risk is PIN brute-force →
   **H1** (race bypass) and **M6** (4-digit ceiling).
2. **JWT** — Secret is env-only and the server refuses to boot without it (`auth.ts`
   L26–29). Every authed route *does* verify (only `/runs/submit`, via `requireAuth`
   → `verifyToken` → `jwt.verify`, `auth.ts` L55–65); no route trusts a client header
   or client `playerId`. Gaps: **algorithm not pinned + no enforced secret strength →
   H2** (forgery = impersonation). `playerId`/`wallet` can't be swapped without
   forging the signature.
3. **Score integrity** — *Cannot submit for another wallet*: the run is bound to
   `player_id` from the verified JWT (`runs.ts` L171); the wallet never appears in the
   submit body and payout goes to the player's immutable bound wallet.
   *server_score is the only ranking input*: **confirmed** — `clientScore` is used
   only inside `verifyRun`'s comparison (`runVerify.ts` L76) and stored as
   `client_score`; ranking reads `server_score` exclusively (`runs.ts` `rankByScore`
   L94–104) and the pool ranks tracks, not client stats. *Inactive/old track
   exploit*: **open → M7**.
4. **Window bucketing** — Double-create **is** possible (no unique constraint) and a
   submit **can** attach to a closed window → **M3**.
5. **Rate limit** — Keyed to the **verified `playerId`**, not a client value
   (`runs.ts` L160) — good, can't be spoofed. But the check-and-set is **racy**
   (parallel bypass) and in-memory/single-instance → **M4**.
6. **Replay DoS** — Single-replay is bounded (`MAX_INPUT_LOG` 90 000, `MAX_REPLAY_TICKS`
   72 000) and `simulateReplay` rejects non-monotonic logs (→ `failed`), so no infinite
   loop. But the **global serial queue is unbounded** with no per-run time budget, and
   the racy limiter lets a burst back it up for everyone → **M4**.
7. **Username** — *Unicode look-alikes*: **defended** — ASCII-only regex
   `^[a-z0-9_]{3,16}$` (`auth.ts` L67). *Many usernames→one wallet / one username→many
   wallets*: prevented by DB `unique(wallet_address)` + `unique(lower(username))`
   (sql/005) plus app checks. *Injection*: none (supabase-js parameterizes; `inputLog`
   is jsonb param) — but the `ILIKE` **wildcard** semantics bug is real → **M5**.

## Confirmed-good (no change needed)

- `server_score` is the sole ranking/payout number; no client stat is trusted in
  ranking.
- Runs are bound to the JWT's `playerId`; a player cannot submit for another account
  or wallet.
- All authed access goes through `requireAuth` → real `jwt.verify`; no header trust.
- PINs are bcrypt-hashed (cost 10), never stored/returned/logged in plaintext
  (`accounts.ts` L38–48); the run path never logs the PIN.
- Usernames are ASCII-only (no homoglyph impersonation); wallet uniqueness +
  immutability enforced at the DB.

## Suggested fix order for P6b

H1 and H2 first (they break the two mandatory controls — lockout and token
integrity), then M3/M4 (payout correctness + availability), then M5/M6/M7, then
the Lows. M5 is a tiny, high-value change (`.ilike` → `.eq`).

---

## Resolution (P6b, 2026-06-15)

**Applied:** H1, H2, M3, M4, M5, M6, M7.
- H1/M6 → atomic, escalating lockout via `cr_register_login_failure` (sql/006) +
  `accounts.ts` (`performLogin` delegates the increment; `evaluateLogin` escalates).
- H2 → `algorithms:['HS256']` in `verifyToken`; boot refuses `JWT_SECRET` < 32
  chars (`assertJwtSecretStrength` in `index.ts`). Owner secret already 64 chars.
- M3 → unique index on `cr_payout_windows(starts_at)` (sql/006) + upsert/onConflict
  + `status='open'` guard in `getOrCreateOpenWindow`.
- M4 → bounded verify queue (503 past `MAX_VERIFY_INFLIGHT`) + 2 s per-run budget.
- M5 → `.ilike` → `.eq` (lowercased) for username lookups.
- M7 → `/submit` rejects non-`active` track versions.

**Accepted (not changed), per owner:** L8 (enumeration), L9 (wallet-claimed message),
L10 (CORS — set at deploy), L11 (dead `cr_auth_nonces` table — harmless).

Requires `apps/api/sql/006_security.sql` pasted in Supabase before next login.
