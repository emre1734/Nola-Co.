/*
# Fix Account Deletion Eligibility — Capability-Based Checks

## Purpose
The previous RPC branched exclusively by `profiles.role` and skipped
customer-side ownership checks for provider accounts. A provider account
can also own bookings as a customer (proven by the existing self-booking
guard). This meant a provider with an active customer-side booking could
be incorrectly reported as eligible.

This migration replaces the RPC with a capability/relationship-based model:
customer-side checks run for EVERY account first, then provider-side checks
run additionally if a `provider_profiles` row exists.

## What This Migration Does
- Replaces `public.get_account_deletion_eligibility()` with a corrected version.
- No schema, RLS, data, or frontend changes.

## Check Order (for every authenticated account)
1. Customer-side booking: block if `bookings.customer_id = auth.uid()` AND
   status IN ('waiting', 'accepted') → blocker = "active_customer_booking"
2. Customer-side job: block if `jobs.customer_id = auth.uid()` AND
   status IN ('on_the_way', 'arrived', 'started', 'pending_approval') →
   blocker = "active_customer_job"
3. Provider-side booking (only if provider_profiles exists): block if
   `bookings.provider_id = provider_profiles.id` AND status = 'accepted' →
   blocker = "active_provider_booking"
4. Provider-side job (only if provider_profiles exists): block if
   `jobs.provider_id = provider_profiles.id` AND
   status IN ('on_the_way', 'arrived', 'started', 'pending_approval') →
   blocker = "active_provider_job"

Pending booking_offers do NOT block.

## Return Contract
- Eligible: {"success": true, "eligible": true, "role": "customer"|"provider"}
- Blocked:  {"success": true, "eligible": false, "role": "...", "blocker": "active_customer_booking"|"active_customer_job"|"active_provider_booking"|"active_provider_job"}
- No auth:  {"success": false, "error": "not_authenticated"}
- No profile: {"success": false, "error": "profile_not_found"}

## Security
- SECURITY DEFINER, search_path = pg_catalog, public
- auth.uid() is sole identity authority — no user_id argument
- REVOKE from PUBLIC and anon; GRANT to authenticated only
- Completely read-only: no INSERT, UPDATE, DELETE, or mutating RPC calls
*/

CREATE OR REPLACE FUNCTION public.get_account_deletion_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_role    text;
  v_pp_id   uuid;
BEGIN
  -- 1. Authentication check
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- 2. Resolve profile and role
  SELECT role::text INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  -- 3. Customer-side booking check (runs for EVERY account)
  PERFORM 1 FROM public.bookings
  WHERE customer_id = v_uid
    AND status IN ('waiting', 'accepted')
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'eligible', false,
      'role', v_role,
      'blocker', 'active_customer_booking'
    );
  END IF;

  -- 4. Customer-side active job check (runs for EVERY account)
  PERFORM 1 FROM public.jobs
  WHERE customer_id = v_uid
    AND status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'eligible', false,
      'role', v_role,
      'blocker', 'active_customer_job'
    );
  END IF;

  -- 5. Resolve provider profile (may or may not exist)
  SELECT id INTO v_pp_id
  FROM public.provider_profiles
  WHERE profile_id = v_uid;

  -- 6. Provider-side checks (only if provider_profiles row exists)
  IF v_pp_id IS NOT NULL THEN
    -- 6a. Provider assigned booking check
    PERFORM 1 FROM public.bookings
    WHERE provider_id = v_pp_id
      AND status = 'accepted'
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'eligible', false,
        'role', v_role,
        'blocker', 'active_provider_booking'
      );
    END IF;

    -- 6b. Provider active job check
    PERFORM 1 FROM public.jobs
    WHERE provider_id = v_pp_id
      AND status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'eligible', false,
        'role', v_role,
        'blocker', 'active_provider_job'
      );
    END IF;
  END IF;

  -- 7. Eligible
  RETURN jsonb_build_object(
    'success', true,
    'eligible', true,
    'role', v_role
  );
END;
$function$;

-- ============================================================
-- Privileges: authenticated only
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.get_account_deletion_eligibility() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_account_deletion_eligibility() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_account_deletion_eligibility() TO authenticated;
