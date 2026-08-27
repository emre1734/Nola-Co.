/*
# Fix job_status enum/text COALESCE bug in get_account_deletion_eligibility()

## Root cause

The deployed function uses COALESCE with a sentinel string '__none__'
as the fallback for a subquery returning jobs.status (type job_status enum).
PostgreSQL resolves COALESCE's common type as job_status and attempts to
cast '__none__' to that enum, which fails:

  ERROR: invalid input value for enum job_status: "__none__"
  SQLSTATE: 22P02

## Fix

Cast j.status to text inside BOTH latest-job subqueries so COALESCE
resolves to text type and the sentinel is accepted as a plain string.

No other changes: same arguments, same return type, same SECURITY DEFINER,
same search_path, same lifecycle semantics, same grants.
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
  --     j.status::text so COALESCE resolves to text, not job_status enum.
  PERFORM 1 FROM public.bookings b
  WHERE b.customer_id = v_uid
    AND b.status = 'accepted'
    AND COALESCE(
      (SELECT j.status::text FROM public.jobs j
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
        (SELECT j.status::text FROM public.jobs j
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

-- Preserve existing grants
REVOKE ALL ON FUNCTION public.get_account_deletion_eligibility() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_account_deletion_eligibility() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_account_deletion_eligibility() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_account_deletion_eligibility() TO service_role;
