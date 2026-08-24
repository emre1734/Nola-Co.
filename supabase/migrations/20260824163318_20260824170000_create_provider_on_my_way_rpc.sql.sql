/*
# Create provider_on_my_way RPC — Atomic On My Way Transition

## Purpose
Moves the database-critical portion of the provider "On My Way" transition
into a single atomic PostgreSQL transaction. The previous implementation
in the job-progress Edge Function performed separate PostgREST calls
(SELECT booking, SELECT jobs, INSERT/UPDATE jobs) with no row locking,
creating a race window with a future customer cancellation action.

This RPC:
1. Resolves the authenticated caller's provider_profiles.id from auth.uid()
2. Locks the target booking row with SELECT ... FOR UPDATE
3. Validates booking.status = 'accepted' and booking.provider_id = caller
4. Preserves the existing idempotency / existing-job handling
5. Creates or transitions the job to 'on_the_way'
6. Returns the same structured response the Edge Function previously produced

## Security
- SECURITY DEFINER with fixed search_path = pg_catalog, public
- REVOKE from PUBLIC and anon; GRANT to authenticated only
- Provider identity resolved server-side from auth.uid() — no client-supplied
  provider_id is trusted
- No RLS changes — existing bookings/jobs RLS architecture is untouched

## What Does NOT Change
- booking.status remains 'accepted' (RPC does not touch bookings.status)
- No new job statuses invented
- No changes to GPS, tracking, provider_live_locations, ProviderDashboard
- No changes to any other job-progress action (arrived, start_wash, etc.)
- No customer cancellation logic is introduced
- jobs RLS and bookings RLS are untouched
*/

CREATE OR REPLACE FUNCTION public.provider_on_my_way(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_provider_id  uuid;
  v_booking      RECORD;
  v_existing_job RECORD;
BEGIN
  -- 1. Resolve the authenticated provider's provider_profiles.id.
  --    Do NOT trust any caller-supplied provider identifier.
  SELECT pp.id INTO v_provider_id
  FROM public.provider_profiles pp
  WHERE pp.profile_id = auth.uid();

  IF v_provider_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Provider profile not found');
  END IF;

  -- 2. Lock the target booking row for the duration of this transaction.
  --    FOR UPDATE acquires a row-level lock that blocks any concurrent
  --    UPDATE on the same booking row until this transaction commits.
  SELECT
    b.id, b.status, b.provider_id, b.customer_id
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking not found');
  END IF;

  -- 3. Validate booking state while holding the lock.

  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking was cancelled by the customer');
  END IF;

  IF v_booking.status = 'expired' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Booking has expired');
  END IF;

  IF v_booking.provider_id != v_provider_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This booking is not assigned to you');
  END IF;

  IF v_booking.status != 'accepted' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Booking status is ' || v_booking.status || ', expected accepted'
    );
  END IF;

  -- 4. Check for an existing job row — preserve the current idempotency
  --    and existing-job handling from the Edge Function.
  SELECT j.id, j.status INTO v_existing_job
  FROM public.jobs j
  WHERE j.booking_id = p_booking_id
  ORDER BY j.created_at DESC
  LIMIT 1;

  IF v_existing_job.id IS NOT NULL THEN
    -- Idempotent: if the job is already on_the_way, succeed without re-writing.
    -- This prevents spurious 409s for the common double-tap case.
    IF v_existing_job.status = 'on_the_way' THEN
      RETURN jsonb_build_object('success', true, 'status', 'on_the_way', 'idempotent', true);
    END IF;

    -- Validate the job is in the expected previous status.
    -- For on_my_way the required previous status is 'accepted' (the
    -- conceptual job state before travel starts).
    IF v_existing_job.status != 'accepted' THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'Job status is ' || v_existing_job.status || ', expected accepted',
        'current_status', v_existing_job.status,
        'expected_status', 'accepted'
      );
    END IF;

    -- Transition the existing job to on_the_way.
    UPDATE public.jobs
      SET status = 'on_the_way', updated_at = now()
      WHERE id = v_existing_job.id;
  ELSE
    -- No existing job row — create one with status on_the_way.
    -- customer_id comes from the booking, provider_id from the
    -- authenticated provider profile (never from the client).
    INSERT INTO public.jobs (booking_id, provider_id, customer_id, status)
    VALUES (p_booking_id, v_provider_id, v_booking.customer_id, 'on_the_way');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'on_the_way');
END;
$$;

-- Grant execute to authenticated users only
REVOKE EXECUTE ON FUNCTION public.provider_on_my_way(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.provider_on_my_way(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.provider_on_my_way(uuid) TO authenticated;
