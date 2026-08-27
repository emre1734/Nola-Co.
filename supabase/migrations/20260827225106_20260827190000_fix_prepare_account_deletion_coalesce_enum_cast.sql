/*
# Fix job_status enum/text COALESCE bug in prepare_account_deletion()

## Root cause

Identical to the bug fixed in get_account_deletion_eligibility():
COALESCE uses sentinel '__none__' as fallback for a subquery returning
jobs.status (type job_status enum). PostgreSQL resolves COALESCE's
common type as job_status and attempts to cast '__none__' to that enum,
which fails: ERROR: invalid input value for enum job_status: "__none__"

## Fix

Cast j.status to text inside BOTH latest-job subqueries so COALESCE
resolves to text type and the sentinel is accepted as a plain string.

No other changes: same signature, same SECURITY DEFINER, same search_path,
same lock order, same eligibility rules, same manifest capture, same PII
cleanup, same profile deletion, same grants.
*/

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_role             text;
  v_pp_id            uuid;
  v_manifest         jsonb := '[]'::jsonb;
  v_request_id       uuid;
  v_existing_stage   text;
  v_provider_auth_id uuid;
  v_target           jsonb;
  v_job_id           uuid;
BEGIN
  -- ============================================================
  -- IDEMPOTENCY: check for existing manifest row
  -- ============================================================
  SELECT id, stage INTO v_request_id, v_existing_stage
  FROM public.account_deletion_requests
  WHERE auth_user_id = p_user_id
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true,
      'prepared', true,
      'request_id', v_request_id,
      'stage', v_existing_stage
    );
  END IF;

  -- ============================================================
  -- LOCK ORDER: parent -> child
  -- ============================================================

  -- 1. Lock profiles row FOR UPDATE
  SELECT role::text INTO v_role
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- ============================================================
    -- FAIL CLOSED: profile missing + manifest missing
    -- ============================================================
    -- Once profile/FKs/photo URLs are detached, cross-user job-image
    -- prefixes may no longer be reconstructable. Creating an empty
    -- manifest would allow Auth deletion without Storage cleanup.
    -- Return an internal error; the Edge Function translates this to
    -- a non-sensitive public response. Auth deletion must NOT execute.
    RETURN jsonb_build_object(
      'success', false,
      'error', 'deletion_state_inconsistent'
    );
  END IF;

  -- 2. Lock provider_profiles row FOR UPDATE if it exists
  SELECT id INTO v_pp_id
  FROM public.provider_profiles
  WHERE profile_id = p_user_id
  FOR UPDATE;

  -- ============================================================
  -- ELIGIBILITY RE-CHECK (inside locked transaction)
  -- ============================================================

  -- CUSTOMER-SIDE: waiting bookings always block
  PERFORM 1 FROM public.bookings
  WHERE customer_id = p_user_id AND status = 'waiting'
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true, 'eligible', false,
      'role', v_role, 'blocker', 'active_customer_booking'
    );
  END IF;

  -- CUSTOMER-SIDE: accepted bookings block unless latest job is terminal
  PERFORM 1 FROM public.bookings b
  WHERE b.customer_id = p_user_id
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
    PERFORM 1 FROM public.bookings b
    JOIN public.jobs j ON j.booking_id = b.id
    WHERE b.customer_id = p_user_id
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
        'success', true, 'eligible', false,
        'role', v_role, 'blocker', 'active_customer_job'
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true, 'eligible', false,
        'role', v_role, 'blocker', 'active_customer_booking'
      );
    END IF;
  END IF;

  -- CUSTOMER-SIDE: independently active customer jobs
  PERFORM 1 FROM public.jobs
  WHERE customer_id = p_user_id
    AND status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'success', true, 'eligible', false,
      'role', v_role, 'blocker', 'active_customer_job'
    );
  END IF;

  -- PROVIDER-SIDE: accepted assigned bookings block unless latest job is terminal
  IF v_pp_id IS NOT NULL THEN
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
          'success', true, 'eligible', false,
          'role', v_role, 'blocker', 'active_provider_job'
        );
      ELSE
        RETURN jsonb_build_object(
          'success', true, 'eligible', false,
          'role', v_role, 'blocker', 'active_provider_booking'
        );
      END IF;
    END IF;

    -- PROVIDER-SIDE: independently active provider jobs
    PERFORM 1 FROM public.jobs
    WHERE provider_id = v_pp_id
      AND status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true, 'eligible', false,
        'role', v_role, 'blocker', 'active_provider_job'
      );
    END IF;
  END IF;

  -- ============================================================
  -- CAPTURE STORAGE CLEANUP TARGETS (before detachment)
  -- ============================================================

  -- 1. Avatars: {auth_user_id}/ prefix in 'avatars' bucket
  v_manifest := v_manifest || jsonb_build_array(jsonb_build_object('bucket', 'avatars', 'prefix', p_user_id || '/'));

  -- 2. Vehicle-images: {auth_user_id}/ prefix in 'vehicle-images' bucket
  v_manifest := v_manifest || jsonb_build_array(jsonb_build_object('bucket', 'vehicle-images', 'prefix', p_user_id || '/'));

  -- 3. Job-images: user's own uploads under {auth_user_id}/ in 'job-images' bucket
  v_manifest := v_manifest || jsonb_build_array(jsonb_build_object('bucket', 'job-images', 'prefix', p_user_id || '/'));

  -- 4. Cross-user job-images: customer's completed/cancelled jobs whose
  --    photos were uploaded by a PROVIDER under that provider's auth_user_id prefix.
  --    Resolve provider auth id and job id BEFORE profile/FK detachment.
  FOR v_provider_auth_id, v_job_id IN
    SELECT DISTINCT pp.profile_id, j.id
    FROM public.jobs j
    JOIN public.provider_profiles pp ON pp.id = j.provider_id
    WHERE j.customer_id = p_user_id
      AND j.status IN ('completed', 'cancelled')
      AND j.provider_id IS NOT NULL
      AND pp.profile_id != p_user_id
      AND (j.before_photo_url IS NOT NULL OR j.after_photo_url IS NOT NULL)
  LOOP
    v_target := jsonb_build_object('bucket', 'job-images', 'prefix', v_provider_auth_id || '/' || v_job_id || '/');
    IF NOT v_manifest @> jsonb_build_array(v_target) THEN
      v_manifest := v_manifest || jsonb_build_array(v_target);
    END IF;
  END LOOP;

  -- ============================================================
  -- PII CLEANUP — CUSTOMER RELATIONSHIPS
  -- ============================================================

  -- Terminal bookings owned by this user
  UPDATE public.bookings
  SET customer_note = NULL,
      latitude = NULL,
      longitude = NULL,
      address = NULL
  WHERE customer_id = p_user_id
    AND status IN ('completed', 'cancelled', 'expired', 'rejected');

  -- Terminal jobs where this user is the customer
  UPDATE public.jobs
  SET provider_note = NULL,
      before_photo_url = NULL,
      after_photo_url = NULL
  WHERE customer_id = p_user_id
    AND status IN ('completed', 'cancelled');

  -- ============================================================
  -- PII CLEANUP — PROVIDER RELATIONSHIPS
  -- ============================================================

  IF v_pp_id IS NOT NULL THEN
    -- Terminal jobs where this user is the provider
    UPDATE public.jobs
    SET provider_note = NULL,
        before_photo_url = NULL,
        after_photo_url = NULL
    WHERE provider_id = v_pp_id
      AND status IN ('completed', 'cancelled');
  END IF;

  -- ============================================================
  -- REVIEWS: CASCADE only, no recomputation
  -- ============================================================
  -- The deleting user's review rows are CASCADE-deleted by the
  -- existing FK from reviews.customer_id -> profiles.id.
  -- No provider_profiles.rating or total_reviews is modified.
  -- No invented rating formula is applied.

  -- ============================================================
  -- INSERT MANIFEST ROW (before profile delete)
  -- ============================================================
  -- Both the manifest INSERT and profile DELETE occur in the SAME
  -- PostgreSQL transaction. If either fails, both roll back.
  -- There is no committed state where the profile is deleted but
  -- the manifest insert rolled back.

  INSERT INTO public.account_deletion_requests (auth_user_id, storage_targets, stage)
  VALUES (p_user_id, v_manifest, 'pending')
  ON CONFLICT (auth_user_id) DO NOTHING
  RETURNING id INTO v_request_id;

  IF v_request_id IS NULL THEN
    SELECT id INTO v_request_id FROM public.account_deletion_requests WHERE auth_user_id = p_user_id LIMIT 1;
  END IF;

  -- ============================================================
  -- DELETE PROFILE
  -- ============================================================
  -- CASCADE deletes exclusive user data (addresses, vehicles,
  -- provider_profiles, booking_offers, booking_rejections, reviews,
  -- support_requests, transactions, notifications, etc.)
  -- SET NULL preserves shared terminal booking/job history.

  DELETE FROM public.profiles WHERE id = p_user_id;

  -- ============================================================
  -- RETURN SUCCESS
  -- ============================================================
  RETURN jsonb_build_object(
    'success', true,
    'eligible', true,
    'prepared', true,
    'request_id', v_request_id,
    'stage', 'pending'
  );
END;
$function$;

-- Preserve existing grants: service_role + postgres only
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(uuid) TO service_role;
