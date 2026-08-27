/*
# Account Deletion Eligibility RPC — Read-Only Check

## Purpose
Creates a single read-only RPC that the authenticated user can call to
determine whether they are currently eligible to enter the future
account-deletion flow.

This RPC NEVER deletes, cancels, updates, anonymizes, or detaches anything.
It is purely a status check.

## What This Migration Creates
- `public.get_account_deletion_eligibility()` — a SECURITY DEFINER function
  that returns jsonb indicating eligibility.

## How It Works
1. Resolves the caller's identity via `auth.uid()` — accepts NO user_id argument.
2. Looks up `public.profiles` by `id = auth.uid()`.
3. Determines role from `profiles.role` (customer or provider).
4. For CUSTOMERS: blocks deletion if any booking has status 'waiting' or
   'accepted', or if any job has status 'on_the_way', 'arrived', 'started',
   or 'pending_approval'.
5. For PROVIDERS: blocks deletion if any assigned booking has status
   'accepted', or if any job has status 'on_the_way', 'arrived', 'started',
   or 'pending_approval'.
6. Terminal states (cancelled, expired, completed, rejected for bookings;
   completed, cancelled for jobs) do NOT block.
7. Pending booking_offers do NOT block — they are cleaned by the future
   execution phase.

## Return Contract
- Eligible:  {"success": true, "eligible": true, "role": "customer"|"provider"}
- Blocked:   {"success": true, "eligible": false, "role": "...", "blocker": "active_booking"|"active_job"}
- No auth:   {"success": false, "error": "not_authenticated"}
- No profile: {"success": false, "error": "profile_not_found"}

No other user's personal data is returned. No addresses, names, coordinates,
photos, IDs, or booking details are exposed.

## Security
- SECURITY DEFINER with search_path = pg_catalog, public
- Execution REVOKE'd from PUBLIC and anon; GRANT'd only to authenticated
- No user_id argument — identity comes exclusively from auth.uid()
- Read-only: performs no INSERT, UPDATE, DELETE, or mutating RPC calls

## What This Migration Does NOT Do
- Does NOT implement account deletion
- Does NOT modify any RLS policies
- Does NOT modify any existing RPC, Edge Function, or frontend code
- Does NOT alter any table data
- Does NOT add deletion_requested_at or deletion tokens
- Does NOT change Migration A FK settings
*/

-- ============================================================
-- Create the eligibility check function
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_account_deletion_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile RECORD;
  v_blocker text;
BEGIN
  -- 1. Authentication check
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  -- 2. Resolve profile
  SELECT id, role INTO v_profile
  FROM public.profiles
  WHERE id = v_uid;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'profile_not_found');
  END IF;

  -- 3. Customer eligibility
  IF v_profile.role = 'customer' THEN
    -- Check for active bookings (waiting or accepted)
    PERFORM 1 FROM public.bookings
    WHERE customer_id = v_uid
      AND status IN ('waiting', 'accepted')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'eligible', false,
        'role', 'customer',
        'blocker', 'active_booking'
      );
    END IF;

    -- Check for active jobs
    PERFORM 1 FROM public.jobs
    WHERE customer_id = v_uid
      AND status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'eligible', false,
        'role', 'customer',
        'blocker', 'active_job'
      );
    END IF;

    -- Eligible
    RETURN jsonb_build_object(
      'success', true,
      'eligible', true,
      'role', 'customer'
    );

  -- 4. Provider eligibility
  ELSIF v_profile.role = 'provider' THEN
    -- Resolve provider_profile id
    PERFORM 1 FROM public.bookings
    WHERE provider_id IN (
      SELECT pp.id FROM public.provider_profiles pp
      WHERE pp.profile_id = v_uid
    )
      AND status = 'accepted'
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'eligible', false,
        'role', 'provider',
        'blocker', 'active_booking'
      );
    END IF;

    -- Check for active jobs
    PERFORM 1 FROM public.jobs
    WHERE provider_id IN (
      SELECT pp.id FROM public.provider_profiles pp
      WHERE pp.profile_id = v_uid
    )
      AND status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'eligible', false,
        'role', 'provider',
        'blocker', 'active_job'
      );
    END IF;

    -- Eligible
    RETURN jsonb_build_object(
      'success', true,
      'eligible', true,
      'role', 'provider'
    );

  -- 5. Unknown role
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'error', 'unknown_role'
    );
  END IF;
END;
$function$;

-- ============================================================
-- Privileges: authenticated only
-- ============================================================

REVOKE EXECUTE ON FUNCTION public.get_account_deletion_eligibility() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_account_deletion_eligibility() FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_account_deletion_eligibility() TO authenticated;
