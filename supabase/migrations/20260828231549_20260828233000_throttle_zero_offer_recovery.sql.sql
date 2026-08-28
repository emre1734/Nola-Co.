/*
# Throttle zero-offer recovery to once per 5 minutes per booking

## Problem

process_offer_expiry_and_escalation() runs every 30 seconds via pg_cron.
The zero-offer recovery block retries dispatch_booking_wave_one() for every
qualifying waiting+zero-offer booking on every cycle. For bookings many
hours in the future with zero eligible providers, this causes unnecessary
repeated find_eligible_providers scans every 30 seconds.

## Fix

1. Add nullable column bookings.last_dispatch_attempt_at (timestamptz).
   No default, no backfill. Represents only zero-offer recovery attempts.

2. In process_offer_expiry_and_escalation, add a 5-minute throttle to the
   zero-offer recovery candidate query AND the post-lock recheck.

3. Set last_dispatch_attempt_at = now() BEFORE calling
   dispatch_booking_wave_one, OUTSIDE the exception-handling subblock so
   the timestamp persists even if the helper raises a caught exception.

## Not changed

- pg_cron schedule (30 seconds)
- pending offer expiry
- passed-time booking expiry (15 min grace)
- wave 2+ escalation (dispatch_next_wave)
- initial AFTER INSERT trigger (dispatch_booking_wave_one)
- dispatch_booking_wave_one / dispatch_next_wave / find_eligible_providers
- accept_booking_offer
- 1-minute initial recovery delay
- Edge Functions / frontend / RLS / Storage
*/

-- ============================================================
-- 1. Add last_dispatch_attempt_at column
-- ============================================================
ALTER TABLE public.bookings
  ADD COLUMN last_dispatch_attempt_at timestamptz;

-- ============================================================
-- 2. Replace process_offer_expiry_and_escalation with throttled
--    zero-offer recovery
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_offer_expiry_and_escalation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_booking  record;
  v_status  text;
  v_provider uuid;
  v_last_attempt timestamptz;
begin
  -- 1. Expire pending offers past their expires_at
  update public.booking_offers
  set status = 'expired', responded_at = now()
  where status = 'pending'
    and expires_at < now();

  -- 2. Terminalize waiting bookings whose requested Istanbul-local
  --    service time passed more than 15 minutes ago.
  for v_booking in
    select b.id
    from public.bookings b
    where b.status = 'waiting'
      and b.booking_date IS NOT NULL
      and b.booking_time IS NOT NULL
      and ((b.booking_date + b.booking_time) AT TIME ZONE 'Europe/Istanbul')
          < (now() - interval '15 minutes')
  loop
    begin
      select b.status::text, b.provider_id
      into v_status, v_provider
      from public.bookings b
      where b.id = v_booking.id
      for update;

      if not found then
        continue;
      end if;

      if v_status is distinct from 'waiting' or v_provider is not null then
        continue;
      end if;

      if not exists (
        select 1 from public.bookings b
        where b.id = v_booking.id
        and ((b.booking_date + b.booking_time) AT TIME ZONE 'Europe/Istanbul')
            < (now() - interval '15 minutes')
      ) then
        continue;
      end if;

      update public.bookings
      set status = 'expired', updated_at = now()
      where id = v_booking.id
        and status = 'waiting';

      update public.booking_offers
      set status = 'expired', responded_at = now(), updated_at = now()
      where booking_id = v_booking.id
        and status = 'pending';

    exception when others then
      raise log 'process_offer_expiry_and_escalation: passed-time expiry failed for booking %: %',
        v_booking.id, sqlerrm;
    end;
  end loop;

  -- 3. Recover valid zero-offer waiting bookings whose initial
  --    wave-1 dispatch failed or was never executed. Only future/
  --    current-time bookings qualify — past-time bookings were
  --    terminalized in block 2. A 1-minute recovery delay avoids
  --    racing the INSERT trigger and Edge Function initial dispatch.
  --    A 5-minute throttle limits repeated find_eligible_providers
  --    scans for bookings with zero eligible providers.
  for v_booking in
    select b.id
    from public.bookings b
    where b.status = 'waiting'
      and b.provider_id IS NULL
      and b.booking_date IS NOT NULL
      and b.booking_time IS NOT NULL
      and ((b.booking_date + b.booking_time) AT TIME ZONE 'Europe/Istanbul')
          >= (now() - interval '15 minutes')
      and b.created_at < (now() - interval '1 minute')
      and NOT EXISTS (
        select 1 from public.booking_offers bo
        where bo.booking_id = b.id
      )
      and (
        b.last_dispatch_attempt_at IS NULL
        or b.last_dispatch_attempt_at < (now() - interval '5 minutes')
      )
  loop
    -- Lock the booking row. Serializes against accept_booking_offer,
    -- the INSERT trigger, and concurrent cron executions.
    select b.status::text, b.provider_id, b.last_dispatch_attempt_at
    into v_status, v_provider, v_last_attempt
    from public.bookings b
    where b.id = v_booking.id
    for update;

    if not found then
      continue;
    end if;

    -- Re-check: must still be waiting and unassigned
    if v_status is distinct from 'waiting' or v_provider is not null then
      continue;
    end if;

    -- Re-check: still zero offers (a concurrent dispatch may have
    -- created offers while we waited for the lock)
    if exists (
      select 1 from public.booking_offers bo
      where bo.booking_id = v_booking.id
    ) then
      continue;
    end if;

    -- Re-check: still within valid recovery window
    if not exists (
      select 1 from public.bookings b
      where b.id = v_booking.id
      and ((b.booking_date + b.booking_time) AT TIME ZONE 'Europe/Istanbul')
          >= (now() - interval '15 minutes')
    ) then
      continue;
    end if;

    -- Re-check: recovery delay still elapsed
    if not exists (
      select 1 from public.bookings b
      where b.id = v_booking.id
      and b.created_at < (now() - interval '1 minute')
    ) then
      continue;
    end if;

    -- Re-check: 5-minute throttle still satisfied
    if v_last_attempt is not null
       and v_last_attempt >= (now() - interval '5 minutes') then
      continue;
    end if;

    -- Stamp the attempt timestamp BEFORE calling the dispatch helper.
    -- This UPDATE is outside the exception-handling subblock below so
    -- the timestamp persists even if dispatch_booking_wave_one raises
    -- a caught exception. The BEFORE UPDATE trigger will also set
    -- updated_at = now(), which is safe (updated_at has no business
    -- semantics — not used for ordering, filtering, or dispatch logic).
    update public.bookings
    set last_dispatch_attempt_at = now()
    where id = v_booking.id;

    -- Dispatch in an isolated subblock so a helper exception does
    -- not abort remaining bookings in this cron tick. The timestamp
    -- UPDATE above is already committed to the transaction and will
    -- NOT be rolled back by this subblock's exception handler.
    begin
      perform public.dispatch_booking_wave_one(v_booking.id);
    exception when others then
      raise log 'process_offer_expiry_and_escalation: zero-offer recovery failed for booking %: %',
        v_booking.id, sqlerrm;
    end;
  end loop;

  -- 4. Escalate waiting bookings whose offers have all expired/rejected
  for v_booking in
    select b.id
    from public.bookings b
    where b.status = 'waiting'
      and exists (select 1 from public.booking_offers bo where bo.booking_id = b.id)
      and not exists (
        select 1 from public.booking_offers bo
        where bo.booking_id = b.id and bo.status = 'pending'
      )
  loop
    begin
      perform public.dispatch_next_wave(v_booking.id);
    exception when others then
      raise log 'process_offer_expiry_and_escalation: dispatch_next_wave failed for booking %: %',
        v_booking.id, sqlerrm;
    end;
  end loop;
end;
$function$;

-- Preserve grants
REVOKE ALL ON FUNCTION public.process_offer_expiry_and_escalation() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.process_offer_expiry_and_escalation() FROM anon;
REVOKE ALL ON FUNCTION public.process_offer_expiry_and_escalation() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.process_offer_expiry_and_escalation() TO service_role;
