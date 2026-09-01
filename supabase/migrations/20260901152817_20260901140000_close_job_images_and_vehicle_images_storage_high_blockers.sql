/*
# Close job-images and vehicle-images Storage HIGH security blockers

## Summary

Both the `job-images` and `vehicle-images` storage buckets are currently
PUBLIC with broad authenticated SELECT policies. This migration closes
both blockers by:

1. Making both buckets PRIVATE.
2. Replacing the broad SELECT policies with narrow, relationship-checked
   policies.
3. Adding a SECURITY DEFINER helper function `public.can_read_job_image()`
   that authorizes job-image reads based on the actual job/booking/provider
   relationship.

## Part A — job-images authorization helper

### `public.can_read_job_image(p_object_name text) RETURNS boolean`

- SECURITY DEFINER, STABLE
- search_path = pg_catalog, public
- Derives auth.uid() internally (no user-id argument)
- Returns FALSE if auth.uid() is null
- Parses the object name to extract the job_id (second path segment)
- Rejects support-photo paths (second segment = 'support')
- Rejects malformed paths

Authorization contract:

- ASSIGNED PROVIDER: may read before/after photos for their own assigned
  job during active lifecycle states: on_the_way, arrived, started,
  pending_approval.
- BOOKING CUSTOMER: may read before/after photos when they own the
  booking and the job is pending_approval or completed.
- All other authenticated users: FALSE.
- Anon: FALSE (not granted EXECUTE).

## Part B — job-images SELECT policy

- Drops `job_images_select_public` (broad authenticated SELECT).
- Creates `job_images_select_authorized` — narrow SELECT using
  `public.can_read_job_image(name)`.
- Existing INSERT/UPDATE/DELETE owner-prefix policies preserved unchanged.
- Bucket set to `public = false`.

## Part C — vehicle-images SELECT policy

- Drops `vehicle_images_select_public` (broad authenticated SELECT).
- Creates `vehicle_images_select_owner` — owner-only SELECT checking
  that the first path folder equals auth.uid().
- Existing INSERT/UPDATE/DELETE owner-prefix policies preserved unchanged.
- Bucket set to `public = false`.

## Security

- No existing Storage objects are modified, deleted, or moved.
- No existing DB photo values are modified.
- No schema changes to any table.
- service_role / postgres access is unaffected (bypasses RLS).
- Account deletion edge function uses service_role (bypasses RLS) —
  unaffected by bucket privacy.
*/

-- ============================================================
-- PART A — can_read_job_image helper function
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_read_job_image(p_object_name text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_segments text[];
  v_job_id text;
  v_job_record record;
BEGIN
  -- Fail closed if not authenticated
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Parse path segments: {userId}/{jobId}/{kind}-{timestamp}.{ext}
  v_segments := string_to_array(p_object_name, '/');

  -- Must have at least 3 segments (userId / jobId / filename)
  IF array_length(v_segments, 1) < 3 THEN
    RETURN FALSE;
  END IF;

  -- Reject support-photo paths: second segment = 'support'
  IF v_segments[2] = 'support' THEN
    RETURN FALSE;
  END IF;

  -- Extract job_id from second segment
  v_job_id := v_segments[2];

  -- Look up the job and its relationships
  SELECT
    j.status,
    j.provider_id,
    j.customer_id,
    pp.profile_id AS provider_profile_id
  INTO v_job_record
  FROM public.jobs j
  LEFT JOIN public.provider_profiles pp ON pp.id = j.provider_id
  WHERE j.id = v_job_id::uuid;

  -- If no matching job, deny
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- CHECK 1: Assigned provider (via provider_profiles.profile_id = auth.uid())
  IF v_job_record.provider_profile_id = v_uid THEN
    -- Provider may read during active lifecycle states
    IF v_job_record.status IN ('on_the_way', 'arrived', 'started', 'pending_approval') THEN
      RETURN TRUE;
    END IF;
    RETURN FALSE;
  END IF;

  -- CHECK 2: Booking customer (jobs.customer_id = auth.uid())
  IF v_job_record.customer_id = v_uid THEN
    -- Customer may read during pending_approval or completed
    IF v_job_record.status IN ('pending_approval', 'completed') THEN
      RETURN TRUE;
    END IF;
    RETURN FALSE;
  END IF;

  -- Deny everyone else
  RETURN FALSE;
END;
$$;

-- EXECUTE security: only authenticated can call
REVOKE EXECUTE ON FUNCTION public.can_read_job_image(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_job_image(text) TO authenticated;

-- ============================================================
-- PART B — job-images storage SELECT policy + private bucket
-- ============================================================

-- Drop broad SELECT policy
DROP POLICY IF EXISTS "job_images_select_public" ON storage.objects;

-- Create narrow authorized SELECT policy
CREATE POLICY "job_images_select_authorized" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'job-images'
    AND public.can_read_job_image(name)
  );

-- Make bucket private
UPDATE storage.buckets
SET public = false
WHERE id = 'job-images';

-- ============================================================
-- PART C — vehicle-images storage SELECT policy + private bucket
-- ============================================================

-- Drop broad SELECT policy
DROP POLICY IF EXISTS "vehicle_images_select_public" ON storage.objects;

-- Create owner-only SELECT policy
CREATE POLICY "vehicle_images_select_owner" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Make bucket private
UPDATE storage.buckets
SET public = false
WHERE id = 'vehicle-images';
