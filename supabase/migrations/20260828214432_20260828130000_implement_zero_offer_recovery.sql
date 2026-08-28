/*
# Implement zero-offer waiting booking recovery

## Goal

Recover valid waiting bookings that have zero booking_offers
because initial wave-1 dispatch failed or was never executed.
Only future/current-time bookings are recovered; past-time
bookings are already terminalized by the passed-time expiry
branch that runs before this block.

## Candidate rule

status = 'waiting'
provider_id IS NULL
booking_date IS NOT NULL
booking_time IS NOT NULL
requested Istanbul datetime >= now() - 15 minutes  (not yet expired)
NOT EXISTS (any booking_offers for this booking)
created_at < now() - 1 minute  (recovery delay to avoid
  racing the INSERT trigger and Edge Function initial dispatch)

## Wave-1 helper reused

dispatch_booking_wave_one(p_booking_id) is the authoritative
wave-1 dispatch function. It has its own status/provider_id
guards, uses ON CONFLICT DO NOTHING for idempotency, and uses
10-minute offer expiry for wave 1. We reuse it directly — no
provider selection logic is duplicated.

## Locking

Each candidate is locked FOR UPDATE before dispatch. Post-lock
re-checks: status='waiting', provider_id IS NULL, zero offers,
time window, recovery delay. Only then dispatch_booking_wave_one
is called.

## Placement

Block 3 in process_offer_expiry_and_escalation(), after
passed-time expiry (block 2) and before later-wave escalation
(block 4).

## Scope

Only process_offer_expiry_and_escalation() is modified.
dispatch_booking_wave_one, dispatch_next_wave, accept_booking_offer,
find_eligible_providers, trigger_dispatch_wave1, pg_cron schedule,
frontend, RLS — all unchanged.
*/

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
  loop
    begin
      -- Lock the booking row. Serializes against accept_booking_offer,
      -- the INSERT trigger, and concurrent cron executions.
      select b.status::text, b.provider_id
      into v_status, v_provider
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

      -- Reuse the authoritative wave-1 dispatch function.
      -- It has its own status/provider_id guards and uses
      -- ON CONFLICT DO NOTHING for idempotency.
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
