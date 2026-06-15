-- 006: P6b security hardening (paste into the Supabase SQL editor).
-- Non-destructive + idempotent.
--
-- Adds: (M6) an escalating-lockout counter, (H1) an ATOMIC login-failure
-- function so concurrent wrong-PIN requests can't lose updates and bypass the
-- lockout, and (M3) a unique constraint so a payout window can't double-create.

-- ── M6: consecutive-lockout counter (escalating backoff) ────────────────────
-- Persists across lock windows; reset to 0 only on a successful login.
alter table cr_players add column if not exists lockout_count integer not null default 0;

-- ── H1: atomic login-failure registration ───────────────────────────────────
-- One row-locked statement does read+increment+escalate+write, so N concurrent
-- wrong-PIN calls each take the lock in turn and the counter can't be lost.
-- Lock duration doubles per consecutive lockout: 15m, 30m, 60m, ... capped at
-- 64x (~16h). MUST stay in sync with evaluateLogin() in accounts.ts.
create or replace function cr_register_login_failure(p_id uuid)
returns table (failed_attempts integer, locked_until timestamptz, lockout_count integer)
language plpgsql
as $$
declare
  v_failed   integer;
  v_locked   timestamptz;
  v_count    integer;
  v_max      constant integer := 5;   -- LOCK_MAX_FAILS
  v_base_min constant integer := 15;  -- LOCK_MS (minutes)
begin
  select p.failed_attempts, p.locked_until, p.lockout_count
    into v_failed, v_locked, v_count
    from cr_players p
    where p.id = p_id
    for update;                       -- serialize concurrent failures

  if not found then
    return;
  end if;

  -- Already actively locked: a straggler request, do not escalate.
  if v_locked is not null and v_locked > now() then
    failed_attempts := v_failed; locked_until := v_locked; lockout_count := v_count;
    return next;
    return;
  end if;

  -- Expired lock: start a fresh in-window counter.
  if v_locked is not null then
    v_failed := 0;
    v_locked := null;
  end if;

  v_failed := v_failed + 1;
  if v_failed >= v_max then
    v_count  := v_count + 1;
    v_locked := now() + (v_base_min * power(2, least(v_count - 1, 6)))::int * interval '1 minute';
    v_failed := 0;                    -- reset window counter while locked
  end if;

  update cr_players
    set failed_attempts = v_failed, locked_until = v_locked, lockout_count = v_count
    where id = p_id;

  failed_attempts := v_failed; locked_until := v_locked; lockout_count := v_count;
  return next;
end;
$$;

grant execute on function cr_register_login_failure(uuid) to service_role;

-- ── M3: a payout window is unique per UTC-aligned start ──────────────────────
-- Prevents two concurrent first-submits from creating duplicate windows for the
-- same 30-min slot (which would split a slot's leaderboard/payouts).
create unique index if not exists cr_payout_windows_starts_at_key
  on cr_payout_windows (starts_at);
