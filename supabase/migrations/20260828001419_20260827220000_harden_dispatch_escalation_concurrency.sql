/*
# Harden dispatch escalation concurrency

## Problem

dispatch_next_wave() does not lock the bookings row before creating
new offers. Two overlapping cron executions can both select the same
booking, calculate the same next wave, and race on offer insertion.
Worse, accept_booking_offer can change a booking to 'accepted' while
dispatch_next_wave is creating new offers for it — accepted bookings
can receive new offers.

## Fix

1. dispatch_next_wave: lock the booking row FOR UPDATE before any
   wave calculation. After lock, re-check status='waiting' and
   provider_id IS NULL. Also re-check that no pending offers exist
   (a concurrent call may have just created the next wave). If any
   guard fails, return safely without creating offers.

2. process_offer_expiry_and_escalation: wrap each per-booking
   dispatch_next_wave call in an exception block so one booking's
   failure does not abort remaining bookings in the same cron tick.
   Failures are logged via RAISE LOG (standard PostgreSQL logging,
   not a silent swallow).

## Not changed

- pg_cron schedule
- zero-offer recovery
- booking-time expiry
- accept_booking_offer
- find_eligible_providers
- provider selection / ranking / distance / working_days rules
- offer expiry durations
- max wave rules
- terminalization semantics
- frontend / Edge Functions / RLS
*/

-- ============================================================
-- dispatch_next_wave: add booking lock + state re-check
-- ============================================================
CREATE OR REPLACE FUNCTION public.dispatch_next_wave(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_next_wave int;
  v_candidate record;
  v_found boolean := false;
  v_booking_status text;
  v_booking_provider_id uuid;
begin
  -- Lock the booking row BEFORE any wave calculation.
  -- This serializes concurrent dispatch_next_wave calls and
  -- blocks accept_booking_offer from modifying the same row
  -- until we are done.
  SELECT b.status::text, b.provider_id
  INTO v_booking_status, v_booking_provider_id
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  -- Booking not found — nothing to do
  IF NOT FOUND THEN
    return;
  END IF;

  -- Re-check: booking must still be 'waiting' and unassigned.
  -- accept_booking_offer may have changed it to 'accepted' while
  -- we were waiting for the lock.
  IF v_booking_status IS DISTINCT FROM 'waiting' OR v_booking_provider_id IS NOT NULL THEN
    return;
  END IF;

  -- Re-check: no pending offers should exist. A concurrent
  -- dispatch_next_wave call may have already created the next
  -- wave while we were waiting for the lock.
  IF EXISTS (
    SELECT 1 FROM public.booking_offers bo
    WHERE bo.booking_id = p_booking_id
      AND bo.status = 'pending'
  ) THEN
    return;
  END IF;

  -- Calculate next wave while holding the booking lock.
  -- Concurrent calls are serialized, so only one transaction
  -- can compute max(wave)+1 at a time.
  select coalesce(max(wave), 0) + 1 into v_next_wave
  from public.booking_offers
  where booking_id = p_booking_id;

  for v_candidate in
    select provider_id from public.find_eligible_providers(p_booking_id)
    order by rank
    limit 3
  loop
    v_found := true;
    insert into public.booking_offers (booking_id, provider_id, wave, status, offered_at, expires_at)
    values (
      p_booking_id,
      v_candidate.provider_id,
      v_next_wave,
      'pending',
      now(),
      now() + interval '90 seconds'
    );
  end loop;

  if not v_found and v_next_wave > 1 then
    update public.bookings
    set status = 'expired'
    where id = p_booking_id
      and status = 'waiting';
  end if;
end;
$function$;

-- Preserve grants
REVOKE ALL ON FUNCTION public.dispatch_next_wave(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.dispatch_next_wave(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.dispatch_next_wave(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_next_wave(uuid) TO service_role;

-- ============================================================
-- process_offer_expiry_and_escalation: per-booking exception isolation
-- ============================================================
CREATE OR REPLACE FUNCTION public.process_offer_expiry_and_escalation()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_booking record;
begin
  -- Expire pending offers past their expires_at
  update public.booking_offers
  set status = 'expired', responded_at = now()
  where status = 'pending'
    and expires_at < now();

  -- Escalate waiting bookings whose offers have all expired/rejected
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
    -- Isolate each booking so one failure does not abort
    -- processing for remaining bookings in this cron tick.
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
