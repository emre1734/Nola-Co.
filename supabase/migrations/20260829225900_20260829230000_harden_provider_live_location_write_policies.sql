/*
# Harden Provider Live-Location Write Policies to On-The-Way Only

## Problem
`provider_live_locations` currently has three provider write policies:

1. `provider_insert_live_location` — broad INSERT, checks only provider
   ownership with NO job lifecycle restriction.
2. `provider_update_live_location` — broad UPDATE, same issue.
3. `provider_write_own_location_while_on_the_way` — FOR ALL, which
   unintentionally grants DELETE authority during on_the_way.

The frontend never issues a DELETE against this table, but the FOR ALL
policy authorizes it anyway. The broad INSERT/UPDATE policies allow
writes regardless of job status.

## Fix
Replace all three policies with two explicit command-specific policies:

A. `provider_insert_live_location_while_on_the_way` (INSERT)
   - WITH CHECK: provider ownership + exact job_id/booking_id/provider_id
     relationship + job.status = 'on_the_way'

B. `provider_update_live_location_while_on_the_way` (UPDATE)
   - USING + WITH CHECK: same exact predicate

No DELETE policy is created. With the FOR ALL policy removed and no
replacement DELETE policy, RLS blocks all authenticated DELETE.

## What Does NOT Change
- `provider_select_own_live_location` — unchanged (provider can always
  read their own row)
- `customer_read_location_while_on_the_way` — unchanged (customer
  tracking via SECURITY DEFINER helper)
- `customer_has_active_tracking` — unchanged
- No table grants modified (DELETE grant remains but is blocked by RLS)
- No jobs/bookings policies changed
- No frontend or GPS code changes
- No data rows modified

## Pre-Migration Integrity Check
All 10 existing rows verified consistent:
  jobs.id = row.job_id
  AND jobs.booking_id = row.booking_id
  AND jobs.provider_id = row.provider_id
0 inconsistent rows.

## UPSERT Compatibility
The frontend upserts with onConflict: 'booking_id', sending booking_id,
job_id, provider_id, lat, lng, updated_at. When the row is new, the
INSERT policy applies. When the row exists (matched on booking_id), the
UPDATE policy applies. Both succeed only while the exact matching job is
on_the_way.
*/

-- =========================================================
-- 1. Drop broad and FOR ALL provider write policies
-- =========================================================

DROP POLICY IF EXISTS "provider_insert_live_location" ON public.provider_live_locations;
DROP POLICY IF EXISTS "provider_update_live_location" ON public.provider_live_locations;
DROP POLICY IF EXISTS "provider_write_own_location_while_on_the_way" ON public.provider_live_locations;

-- =========================================================
-- 2. Create narrow INSERT policy (on_the_way only)
-- =========================================================

CREATE POLICY "provider_insert_live_location_while_on_the_way"
  ON public.provider_live_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.provider_profiles pp
      JOIN public.jobs j ON j.provider_id = pp.id
      WHERE pp.profile_id = auth.uid()
        AND pp.id = provider_live_locations.provider_id
        AND j.id = provider_live_locations.job_id
        AND j.booking_id = provider_live_locations.booking_id
        AND j.provider_id = provider_live_locations.provider_id
        AND j.status = 'on_the_way'::public.job_status
    )
  );

-- =========================================================
-- 3. Create narrow UPDATE policy (on_the_way only)
-- =========================================================

CREATE POLICY "provider_update_live_location_while_on_the_way"
  ON public.provider_live_locations
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provider_profiles pp
      JOIN public.jobs j ON j.provider_id = pp.id
      WHERE pp.profile_id = auth.uid()
        AND pp.id = provider_live_locations.provider_id
        AND j.id = provider_live_locations.job_id
        AND j.booking_id = provider_live_locations.booking_id
        AND j.provider_id = provider_live_locations.provider_id
        AND j.status = 'on_the_way'::public.job_status
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.provider_profiles pp
      JOIN public.jobs j ON j.provider_id = pp.id
      WHERE pp.profile_id = auth.uid()
        AND pp.id = provider_live_locations.provider_id
        AND j.id = provider_live_locations.job_id
        AND j.booking_id = provider_live_locations.booking_id
        AND j.provider_id = provider_live_locations.provider_id
        AND j.status = 'on_the_way'::public.job_status
    )
  );
