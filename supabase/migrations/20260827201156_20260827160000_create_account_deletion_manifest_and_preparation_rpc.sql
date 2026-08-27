/*
# Account Deletion Backend — Manifest Table + Internal Preparation RPC

## Overview

Creates the durable storage-cleanup manifest table and the internal
service-role-only preparation RPC that performs locked, race-safe
database cleanup before the Edge Function handles Storage and Auth
deletion.

## Phase 1: Manifest Table

### public.account_deletion_requests

Durable tombstone table that survives profile/auth CASCADE deletion.
Stores Storage cleanup targets so the Edge Function can retry after
crashes. Contains NO PII — only opaque UUIDs and Storage bucket/prefix
paths.

Columns:
- id (uuid PK, default gen_random_uuid())
- auth_user_id (uuid NOT NULL, UNIQUE, NO FK to profiles/auth.users)
- storage_targets (jsonb NOT NULL DEFAULT '[]')
- stage (text NOT NULL DEFAULT 'pending', CHECK in pending/storage_done/completed)
- created_at (timestamptz NOT NULL DEFAULT now())
- updated_at (timestamptz NOT NULL DEFAULT now())
- completed_at (timestamptz NULL)

Security:
- RLS ENABLED
- No ordinary-user policies
- REVOKE ALL from PUBLIC, anon, authenticated
- Only service_role and SECURITY DEFINER owner access

## Phase 2: Internal Preparation RPC

### public.prepare_account_deletion(p_user_id uuid)

SECURITY DEFINER, service-role-only. NOT callable by authenticated/anon.

Idempotent: if manifest row already exists for p_user_id, returns
existing request_id and stage without repeating destructive work.

Lock order (parent -> child):
1. profiles FOR UPDATE (blocks customer booking INSERT via FK KEY SHARE)
2. provider_profiles FOR UPDATE if exists (blocks accept_booking_offer)

Re-checks terminal-aware eligibility inside the locked transaction.
If blocked, returns blocker and mutates nothing.

If eligible:
1. Captures Storage cleanup targets (prefixes, not URLs)
2. Nulls PII on terminal retained bookings/jobs
3. Recomputes surviving provider_profiles rating/total_reviews after review CASCADE
4. Inserts manifest row
5. Deletes profile (CASCADE deletes exclusive data, SET NULL preserves shared history)

## Review/Rating Handling

reviews table has CASCADE FKs to profiles (customer_id), provider_profiles
(provider_id), and jobs (job_id). When a customer profile is deleted,
their authored reviews are CASCADE-deleted. Surviving provider_profiles
may have stale rating/total_reviews.

No trigger or RPC currently updates rating/total_reviews — they are
static defaults (5.00 / 0). The reviews table is empty in production.
The preparation RPC recomputes affected surviving providers' aggregates
using: AVG(reviews.rating) and COUNT(reviews.rating) for reviews where
provider_id = that provider. Falls back to defaults (5.00 / 0) when no
reviews remain.
*/

-- ============================================================
-- Phase 1: Manifest Table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id  uuid NOT NULL,
  storage_targets jsonb NOT NULL DEFAULT '[]'::jsonb,
  stage         text NOT NULL DEFAULT 'pending'
    CHECK (stage IN ('pending', 'storage_done', 'completed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

-- No FK to profiles or auth.users — must survive CASCADE deletion
CREATE UNIQUE INDEX IF NOT EXISTS uq_account_deletion_requests_auth_user_id
  ON public.account_deletion_requests (auth_user_id);

ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;

-- Deny all ordinary-user access
REVOKE ALL ON public.account_deletion_requests FROM PUBLIC;
REVOKE ALL ON public.account_deletion_requests FROM anon;
REVOKE ALL ON public.account_deletion_requests FROM authenticated;

-- ============================================================
-- Phase 2: Internal Preparation RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.prepare_account_deletion(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_role           text;
  v_pp_id          uuid;
  v_manifest       jsonb := '[]'::jsonb;
  v_request_id     uuid;
  v_existing_stage text;
  v_provider_auth_id uuid;
  v_target         jsonb;
  v_affected_pp_id uuid;
  v_job_id         uuid;
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
    -- Profile already deleted but no manifest row exists.
    -- Create one so the Edge Function can finish Storage/Auth cleanup.
    INSERT INTO public.account_deletion_requests (auth_user_id, storage_targets, stage)
    VALUES (p_user_id, '[]'::jsonb, 'pending')
    ON CONFLICT (auth_user_id) DO NOTHING
    RETURNING id INTO v_request_id;

    IF v_request_id IS NULL THEN
      SELECT id INTO v_request_id FROM public.account_deletion_requests WHERE auth_user_id = p_user_id LIMIT 1;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'prepared', true,
      'request_id', v_request_id,
      'stage', 'pending'
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
      (SELECT j.status FROM public.jobs j
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
        (SELECT j.status FROM public.jobs j
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
  -- REVIEW/RATING RECOMPUTATION
  -- ============================================================
  -- When the customer profile is CASCADE-deleted, their reviews are
  -- removed. Surviving provider_profiles may have stale aggregates.
  -- Recompute using the same semantics: AVG(rating) rounded to 2
  -- decimals, COUNT of reviews. Default to 5.00 / 0 when no reviews.

  FOR v_affected_pp_id IN
    SELECT DISTINCT provider_id FROM public.reviews
    WHERE customer_id = p_user_id
  LOOP
    UPDATE public.provider_profiles pp
    SET rating = COALESCE(
        (SELECT ROUND(AVG(r.rating), 2) FROM public.reviews r WHERE r.provider_id = v_affected_pp_id),
        5.00
      ),
      total_reviews = COALESCE(
        (SELECT COUNT(*) FROM public.reviews r WHERE r.provider_id = v_affected_pp_id),
        0
      )
    WHERE pp.id = v_affected_pp_id;
  END LOOP;

  -- ============================================================
  -- INSERT MANIFEST ROW (before profile delete)
  -- ============================================================

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

-- Revoke from all ordinary users
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.prepare_account_deletion(uuid) FROM authenticated;

-- Grant only to service_role
GRANT EXECUTE ON FUNCTION public.prepare_account_deletion(uuid) TO service_role;
