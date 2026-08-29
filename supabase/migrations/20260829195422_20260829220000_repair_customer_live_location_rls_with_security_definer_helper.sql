/*
# Repair Customer Live-Location Authorization

## Problem
The existing `customer_read_location_while_on_the_way` policy on
`provider_live_locations` is broken for customers. Its USING expression
joins `public.jobs`, but `jobs` has RLS enabled and customers have NO
jobs SELECT policy. PostgreSQL applies RLS transitively to subqueries
inside policy expressions, so the join returns zero rows for any
customer — the policy always evaluates FALSE.

The broad `customer_select_live_location` policy (which only checks
booking ownership with no job-status filter) is therefore the ONLY
functioning customer tracking authorization. It allows customers to
read provider GPS coordinates for any booking they own, regardless of
whether the job is still on_the_way — a privacy exposure.

## Fix
1. Create a narrow SECURITY DEFINER boolean helper:
   `public.customer_has_active_tracking(p_booking_id uuid) RETURNS boolean`
   - SECURITY DEFINER — runs as function owner (postgres), bypassing
     RLS on bookings and jobs.
   - STABLE — read-only, no side effects.
   - search_path = pg_catalog, public — prevents search_path injection.
   - Derives customer identity from auth.uid() — no user_id parameter.
   - Returns TRUE only when:
     a) the booking exists and belongs to auth.uid()
     b) a job exists for that booking with status = 'on_the_way'
   - Returns only a boolean — no PII, no coordinates.

2. Replace the broken `customer_read_location_while_on_the_way` policy
   to call the helper instead of directly joining jobs. Scope to
   `TO authenticated`.

3. Drop the broad `customer_select_live_location` policy now that the
   narrow replacement works.

## What Does NOT Change
- No customer SELECT policy added to `public.jobs`.
- No changes to jobs grants or policies.
- No changes to provider location policies (insert/update/select/all).
- No changes to bookings policies.
- No frontend or GPS code changes.
- No changes to Realtime publication.
- No changes to table grants on provider_live_locations.
*/

-- =========================================================
-- 1. SECURITY DEFINER boolean helper
-- =========================================================

CREATE OR REPLACE FUNCTION public.customer_has_active_tracking(p_booking_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.bookings b
    JOIN public.jobs j ON j.booking_id = b.id
    WHERE b.id = p_booking_id
      AND b.customer_id = auth.uid()
      AND j.status = 'on_the_way'::public.job_status
  );
END;
$$;

-- =========================================================
-- 2. Function EXECUTE security
-- =========================================================

-- Revoke from PUBLIC and anon (PostgreSQL grants EXECUTE to PUBLIC
-- by default for new functions).
REVOKE EXECUTE ON FUNCTION public.customer_has_active_tracking(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.customer_has_active_tracking(uuid) FROM anon;

-- Grant to authenticated only.
GRANT EXECUTE ON FUNCTION public.customer_has_active_tracking(uuid) TO authenticated;

-- =========================================================
-- 3. Replace broken customer tracking SELECT policy
-- =========================================================

-- Drop the old broken policy (its USING directly joins jobs, which is
-- filtered by jobs RLS and always returns FALSE for customers).
DROP POLICY IF EXISTS "customer_read_location_while_on_the_way" ON public.provider_live_locations;

-- Create the fixed narrow policy that calls the SECURITY DEFINER
-- helper. The helper bypasses jobs RLS internally, so the job-status
-- check actually evaluates for customers.
CREATE POLICY "customer_read_location_while_on_the_way"
  ON public.provider_live_locations
  FOR SELECT
  TO authenticated
  USING (public.customer_has_active_tracking(provider_live_locations.booking_id));

-- =========================================================
-- 4. Drop the broad customer policy
-- =========================================================

-- This policy allowed any booking owner to read provider GPS
-- regardless of job status. The narrow replacement above now
-- enforces the on_the_way lifecycle boundary.
DROP POLICY IF EXISTS "customer_select_live_location" ON public.provider_live_locations;
