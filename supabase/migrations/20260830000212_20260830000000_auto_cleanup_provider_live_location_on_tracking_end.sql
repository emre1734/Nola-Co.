/*
# Automatic Cleanup of provider_live_locations When Job Leaves on_the_way

## Purpose
When a job transitions FROM on_the_way TO any other status, the
provider's live GPS location is no longer needed. Customer tracking
ends, provider writes are rejected by RLS, and the row becomes stale.

This migration creates a DB trigger that automatically deletes the
exact provider_live_locations row at the lifecycle boundary —
atomically with the job status update.

## What Does NOT Change
- No RLS policies modified
- No grants modified
- No cron jobs created
- No Edge Functions or frontend code changed
- No schema or FK changes
- No data rows manually modified

## Concurrency Note
A GPS write already in flight around the transition may race at the
transaction/snapshot level. RLS already rejects writes after the
transition commits. This trigger is primary lifecycle cleanup; a
future lifecycle-aware pg_cron safety-net remains planned separately.
*/

-- =========================================================
-- 1. Trigger function: cleanup_provider_live_location_after_tracking_end
-- =========================================================

CREATE OR REPLACE FUNCTION public.cleanup_provider_live_location_after_tracking_end()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
BEGIN
  IF OLD.status = 'on_the_way'::public.job_status
     AND NEW.status IS DISTINCT FROM 'on_the_way'::public.job_status
  THEN
    DELETE FROM public.provider_live_locations
    WHERE provider_live_locations.job_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

-- =========================================================
-- 2. Revoke direct EXECUTE from non-owner roles
-- =========================================================
-- The function exists only as trigger infrastructure. Normal clients
-- must not call it directly. PostgreSQL trigger execution uses the
-- function owner's privileges (SECURITY DEFINER) and is not affected
-- by EXECUTE grants on the function — triggers fire regardless of
-- the calling role's EXECUTE permission on the function.

REVOKE EXECUTE ON FUNCTION public.cleanup_provider_live_location_after_tracking_end() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_provider_live_location_after_tracking_end() FROM anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_provider_live_location_after_tracking_end() FROM authenticated;

-- =========================================================
-- 3. Trigger: trg_cleanup_provider_live_location_on_tracking_end
-- =========================================================

CREATE TRIGGER trg_cleanup_provider_live_location_on_tracking_end
  AFTER UPDATE OF status ON public.jobs
  FOR EACH ROW
  WHEN (
    OLD.status = 'on_the_way'::public.job_status
    AND NEW.status IS DISTINCT FROM 'on_the_way'::public.job_status
  )
  EXECUTE FUNCTION public.cleanup_provider_live_location_after_tracking_end();
