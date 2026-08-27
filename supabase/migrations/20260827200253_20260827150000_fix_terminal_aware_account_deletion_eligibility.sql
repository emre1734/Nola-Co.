/*
# Fix terminal-aware account deletion eligibility

## Problem

The current get_account_deletion_eligibility() blocks ANY booking with
status IN ('waiting', 'accepted'). However, production data proves that
jobs.status = 'completed' can legitimately coexist with
bookings.status = 'accepted' (the approve_job action only updates
jobs.status, never bookings.status). This causes an already-terminal
service to incorrectly block account deletion.

## Changes

1. Replaces public.get_account_deletion_eligibility() with a
   terminal-aware version that checks the latest job status for
   accepted bookings.

2. No schema changes. No RLS changes. No new tables. No source code
   changes. No booking/job lifecycle changes. This is a pure RPC
   replacement — read-only.

## Customer rules (applied to EVERY account)

- booking.status = 'waiting' → BLOCK (active_customer_booking)
- booking.status = 'accepted' AND no job exists → BLOCK
  (active_customer_booking)
- booking.status = 'accepted' AND latest job status IN
  ('on_the_way','arrived','started','pending_approval') → BLOCK
  (active_customer_job)
- booking.status = 'accepted' AND latest job status IN
  ('completed','cancelled') → DO NOT BLOCK
- booking.status IN ('cancelled','expired','completed','rejected') →
  DO NOT BLOCK

## Provider rules (applied if provider_profiles exists)

- assigned booking.status = 'accepted' AND no job exists → BLOCK
  (active_provider_booking)
- assigned booking.status = 'accepted' AND latest job status IN
  ('on_the_way','arrived','started','pending_approval') → BLOCK
  (active_provider_job)
- assigned booking.status = 'accepted' AND latest job status IN
  ('completed','cancelled') → DO NOT BLOCK
- terminal booking statuses → DO NOT BLOCK

## Latest job selection

Uses ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1 —
deterministic ordering matching the project's existing
ORDER BY created_at DESC pattern.

## Security

- SECURITY DEFINER, SET search_path = pg_catalog, public
- Completely read-only (SELECT and PERFORM only)
- auth.uid() as sole identity authority
- Grants preserved: PUBLIC/anon revoked, authenticated has EXECUTE
*/

CREATE OR REPLACE FUNCTION public.get_account_deletion_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
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

  -- ================================================================
  -- 3. CUSTOMER-SIDE CHECKS (run for EVERY account)
  -- ================================================================

  -- 3a. Waiting bookings always block
  PERFORM 1 FROM public.bookings
  WHERE customer_id = v_uid
    AND status = 'waiting'
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'eligible', false,
      'role', v_role,
      'blocker', 'active_customer_booking'
    );
  END IF;

  -- 3b. Accepted bookings: block only if no terminal job exists.
  --     An accepted booking with NO job row → BLOCK.
  --     An accepted booking whose latest job is active → BLOCK.
  --     An accepted booking whose latest job is completed/cancelled → pass.
  PERFORM 1 FROM public.bookings b
  WHERE b.customer_id = v_uid
    AND b.status = 'accepted'
    AND NOT EXISTS (
      SELECT 1 FROM public.jobs j
      WHERE j.booking_id = b.id
        AND j.status IN ('completed', 'cancelled')
    )
  LIMIT 1;

  IF FOUND THEN
    -- Determine whether the blocker is a booking (no job) or an active job
    PERFORM 1 FROM public.jobs j
    JOIN public.bookings b ON b.id = j.booking_id
    WHERE b.customer_id = v_uid
      AND b.status = 'accepted'
      AND j.status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'eligible', false,
        'role', v_role,
        'blocker', 'active_customer_job'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'eligible', false,
        'role', v_role,
        'blocker', 'active_customer_booking'
      );
    END IF;
  END IF;

  -- ================================================================
  -- 4. PROVIDER-SIDE CHECKS (only if provider_profiles exists)
  -- ================================================================

  SELECT id INTO v_pp_id
  FROM public.provider_profiles
  WHERE profile_id = v_uid;

  IF v_pp_id IS NOT NULL THEN
    -- 4a. Accepted assigned bookings: block only if no terminal job.
    PERFORM 1 FROM public.bookings b
    WHERE b.provider_id = v_pp_id
      AND b.status = 'accepted'
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.booking_id = b.id
          AND j.status IN ('completed', 'cancelled')
      )
    LIMIT 1;

    IF FOUND THEN
      -- Determine whether the blocker is a booking (no job) or an active job
      PERFORM 1 FROM public.jobs j
      JOIN public.bookings b ON b.id = j.booking_id
      WHERE b.provider_id = v_pp_id
        AND b.status = 'accepted'
        AND j.status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
      LIMIT 1;

      IF FOUND THEN
        RETURN jsonb_build_object(
          'success', true,
          'eligible', false,
          'role', v_role,
          'blocker', 'active_provider_job'
        );
      ELSE
        RETURN jsonb_build_object(
          'success', true,
          'eligible', false,
          'role', v_role,
          'blocker', 'active_provider_booking'
        );
      END IF;
    END IF;
  END IF;

  -- 5. Eligible
  RETURN jsonb_build_object(
    'success', true,
    'eligible', true,
    'role', v_role
  );
END;
$function$;

-- Preserve grants: revoke from PUBLIC/anon, keep authenticated
REVOKE ALL ON FUNCTION public.get_account_deletion_eligibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_account_deletion_eligibility() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_account_deletion_eligibility() TO authenticated;
