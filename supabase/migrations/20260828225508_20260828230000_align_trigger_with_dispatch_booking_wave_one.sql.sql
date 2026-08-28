/*
# Align AFTER INSERT trigger with authoritative wave-1 helper

## Problem

trigger_dispatch_wave1() calls dispatch_next_wave(NEW.id), which creates
wave-1 offers with 90-second expiry. The dedicated wave-1 helper
dispatch_booking_wave_one() creates wave-1 offers with 10-minute expiry.
The Edge Function later calls dispatch_booking_wave_one but its inserts
are skipped by ON CONFLICT DO NOTHING because the trigger already created
offers. Result: normal wave-1 expiry is 90 seconds instead of 10 minutes.

## Fix

Change ONLY trigger_dispatch_wave1() to call dispatch_booking_wave_one
instead of dispatch_next_wave. This makes the trigger use the authoritative
wave-1 path with 10-minute expiry and ON CONFLICT DO NOTHING idempotency.

## Not changed

- Trigger timing (AFTER INSERT FOR EACH ROW)
- dispatch_booking_wave_one itself
- dispatch_next_wave (still used for wave 2+ escalation via cron)
- process_offer_expiry_and_escalation
- find_eligible_providers
- accept_booking_offer
- pg_cron schedule
- zero-offer recovery
- Edge Functions / frontend / RLS / Storage
*/

CREATE OR REPLACE FUNCTION public.trigger_dispatch_wave1()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if NEW.status = 'waiting' then
    perform public.dispatch_booking_wave_one(NEW.id);
  end if;
  return NEW;
end;
$function$;

-- Preserve grants
REVOKE ALL ON FUNCTION public.trigger_dispatch_wave1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_dispatch_wave1() FROM anon;
REVOKE ALL ON FUNCTION public.trigger_dispatch_wave1() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trigger_dispatch_wave1() TO service_role;
