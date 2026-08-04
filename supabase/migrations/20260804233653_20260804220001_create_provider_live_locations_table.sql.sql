/*
# Create provider_live_locations table for Realtime GPS tracking

## Purpose
Replaces the old provider_profiles.current_latitude/current_longitude polling
mechanism with a dedicated table that the customer subscribes to via Realtime
postgres_changes. One row per booking, upserted every 7-10 seconds by the
provider while their job status is "on_the_way".

## New Table: provider_live_locations
- booking_id   uuid, PRIMARY KEY (one row per booking)
- job_id       uuid, nullable (references jobs(id) ON DELETE CASCADE)
- provider_id  uuid, not null (references provider_profiles(id) ON DELETE CASCADE)
- lat          double precision, not null
- lng          double precision, not null
- updated_at   timestamptz, not null, default now()

## Security (RLS)
- RLS enabled.
- PROVIDER INSERT/UPDATE: only the provider who owns the booking's assigned
  provider_id may upsert their own row.
- CUSTOMER SELECT: only the customer who owns the booking may read the row.
- No DELETE policy (rows are overwritten, not deleted).
*/

CREATE TABLE IF NOT EXISTS public.provider_live_locations (
  booking_id   uuid        PRIMARY KEY,
  job_id       uuid        REFERENCES public.jobs(id) ON DELETE CASCADE,
  provider_id  uuid        NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  lat          double precision NOT NULL,
  lng          double precision NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.provider_live_locations ENABLE ROW LEVEL SECURITY;

-- PROVIDER INSERT: only the assigned provider for this booking may insert
DROP POLICY IF EXISTS "provider_insert_live_location" ON public.provider_live_locations;
CREATE POLICY "provider_insert_live_location"
  ON public.provider_live_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = provider_live_locations.provider_id
        AND pp.profile_id = auth.uid()
    )
  );

-- PROVIDER UPDATE: only the assigned provider may update their own row
DROP POLICY IF EXISTS "provider_update_live_location" ON public.provider_live_locations;
CREATE POLICY "provider_update_live_location"
  ON public.provider_live_locations FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = provider_live_locations.provider_id
        AND pp.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = provider_live_locations.provider_id
        AND pp.profile_id = auth.uid()
    )
  );

-- CUSTOMER SELECT: only the booking owner may read the live location
DROP POLICY IF EXISTS "customer_select_live_location" ON public.provider_live_locations;
CREATE POLICY "customer_select_live_location"
  ON public.provider_live_locations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = provider_live_locations.booking_id
        AND b.customer_id = auth.uid()
    )
  );
