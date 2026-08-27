/*
# Fix terminal-aware account deletion eligibility (v2 — latest-job-aware)

## Problem

The v1 migration used NOT EXISTS (any terminal job) which is incorrect
when multiple jobs exist for a booking — a cancelled job followed by an
active job would incorrectly pass. This version checks the LATEST job's
status using ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1,
matching the project's existing latest-job selection pattern.

## Changes

1. Replaces public.get_account_deletion_eligibility() with corrected
   terminal-aware logic that checks the latest job status for accepted
   bookings.

2. No schema/RLS/source/workflow changes. Pure RPC replacement.

## Customer rules (EVERY account)

- waiting → BLOCK (active_customer_booking)
- accepted + no job → BLOCK (active_customer_booking)
- accepted + latest job active → BLOCK (active_customer_job)
- accepted + latest job terminal (completed/cancelled) → pass
- terminal booking statuses → pass

## Provider rules (if provider_profiles exists)

- accepted + no job → BLOCK (active_provider_booking)
- accepted + latest job active → BLOCK (active_provider_job)
- accepted + latest job terminal → pass

## Latest job selection

ORDER BY created_at DESC NULLS LAST, id DESC LIMIT 1

## Security

- SECURITY DEFINER, SET search_path = pg_catalog, public
- Completely read-only
- Grants: PUBLIC/anon revoked, authenticated has EXECUTE
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

  -- 3b. Accepted bookings: block unless the latest job is terminal.
  --     Uses a correlated subquery to find the latest job by
  --     created_at DESC NULLS LAST, id DESC — deterministic ordering.
  --     COALESCE to '__none__' when no job exists, which is NOT IN
  --     ('completed','cancelled') → blocks (correct: no job = active).
  PERFORM 1 FROM public.bookings b
  WHERE b.customer_id = v_uid
    AND b.status = 'accepted'
    AND COALESCE(
      (SELECT j.status FROM public.jobs j
       WHERE j.booking_id = b.id
       ORDER BY j.created_at DESC NULLS LAST, j.id DESC
       LIMIT 1),
      '__none__'
    ) NOT IN ('completed', 'cancelled')
  LIMIT 1;

  IF FOUND THEN
    -- Distinguish blocker: active job vs booking with no job
    PERFORM 1 FROM public.bookings b
    JOIN public.jobs j ON j.booking_id = b.id
    WHERE b.customer_id = v_uid
      AND b.status = 'accepted'
      AND j.status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs j2
        WHERE j2.booking_id = b.id
          AND (j2.created_at, j2.id) > (j.created_at, j.id)
      )
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
    -- 4a. Accepted assigned bookings: block unless latest job is terminal
    PERFORM 1 FROM public.bookings b
    WHERE b.provider_id = v_pp_id
      AND b.status = 'accepted'
      AND COALESCE(
        (SELECT j.status FROM public.jobs j
         WHERE j.booking_id = b.id
         ORDER BY j.created_at DESC NULLS LAST, j.id DESC
         LIMIT 1),
        '__none__'
      ) NOT IN ('completed', 'cancelled')
    LIMIT 1;

    IF FOUND THEN
      -- Distinguish blocker: active job vs booking with no job
      PERFORM 1 FROM public.bookings b
      JOIN public.jobs j ON j.booking_id = b.id
      WHERE b.provider_id = v_pp_id
        AND b.status = 'accepted'
        AND j.status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
        AND NOT EXISTS (
          SELECT 1 FROM public.jobs j2
          WHERE j2.booking_id = b.id
            AND (j2.created_at, j2.id) > (j.created_at, j.id)
        )
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
