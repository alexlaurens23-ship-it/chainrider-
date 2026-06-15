-- 005 — username + PIN + wallet accounts (P6-rev; replaces wallet-signature auth)
--
-- Non-destructive + idempotent. Paste into the Supabase SQL editor.
-- cr_players already has: id (uuid), username, wallet_address, banned,
-- created_at, last_login_at. This adds the PIN hash + brute-force lockout state
-- and enforces wallet "claimed once" + case-insensitive unique usernames.
--
-- cr_auth_nonces (from P6) is intentionally left in place — it is simply no
-- longer used. No need to drop it.

-- PIN is stored ONLY as a bcrypt hash (never plaintext). Nullable: pre-existing
-- rows (none today) would have no PIN; the app always sets it on signup.
alter table cr_players add column if not exists pin_hash text;

-- Brute-force lockout counters (the PIN is only 4 digits).
alter table cr_players add column if not exists failed_attempts integer not null default 0;
alter table cr_players add column if not exists locked_until timestamptz;

-- A wallet address belongs to ONE account, globally — claimed once, immutable.
create unique index if not exists cr_players_wallet_address_key
  on cr_players (wallet_address);

-- Case-insensitive username uniqueness, enforced at the DB (the app also checks).
create unique index if not exists cr_players_username_lower_key
  on cr_players (lower(username));
