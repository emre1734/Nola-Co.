/*
# Fix dispatch_booking_wave_one idempotency

The previous version called find_eligible_providers on every invocation.
Since find_eligible_providers excludes providers who already have
booking_offers rows, a second call would find NEW providers (ranks 4, 5)
and create offers for them — effectively performing wave expansion,
which is NOT desired in this sprint.

Fix: Before calling find_eligible_providers, check if any wave 1 offers
already exist for this booking. If they do, return offers_already_exist
immediately without creating any new offers.
*/

CREATE OR REPLACE FUNCTION public.dispatch_booking_wave_one(p_booking_id uuid)
RETURNS TABLE(
  out_booking_id uuid,
  out_wave integer,
  out_candidate_count integer,
  out_created_offer_count integer,
  out_expires_at timestamptz,
  out_outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_booking RECORD;
  v_wave int := 1;
  v_expiry_interval interval := interval '90 seconds';
  v_existing_count int := 0;
  v_candidate_count int := 0;
  v_created_count int := 0;
  v_expires_at timestamptz;
  v_outcome text;
BEGIN
  -- 1. Load and validate the booking
  SELECT b.status, b.provider_id, b.latitude, b.longitude,
         b.booking_date, b.booking_time
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  IF v_booking.status IS DISTINCT FROM 'waiting' THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  IF v_booking.provider_id IS NOT NULL THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  IF v_booking.latitude IS NULL OR v_booking.longitude IS NULL THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  IF v_booking.booking_date IS NULL OR v_booking.booking_time IS NULL THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  -- 2. Idempotency check: if wave 1 offers already exist, do nothing
  SELECT count(*) INTO v_existing_count
  FROM public.booking_offers bo
  WHERE bo.booking_id = p_booking_id AND bo.wave = v_wave;

  IF v_existing_count > 0 THEN
    SELECT min(bo.expires_at) INTO v_expires_at
    FROM public.booking_offers bo
    WHERE bo.booking_id = p_booking_id AND bo.wave = v_wave;

    RETURN QUERY SELECT p_booking_id, v_wave, v_existing_count, 0, v_expires_at, 'offers_already_exist';
    RETURN;
  END IF;

  -- 3. Count eligible candidates (rank <= 3)
  SELECT count(*) INTO v_candidate_count
  FROM public.find_eligible_providers(p_booking_id)
  WHERE rank <= 3;

  IF v_candidate_count = 0 THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'no_eligible_providers';
    RETURN;
  END IF;

  -- 4. Insert pending offers (idempotent via ON CONFLICT ON CONSTRAINT)
  v_expires_at := now() + v_expiry_interval;

  WITH candidates AS (
    SELECT provider_id::uuid AS cand_provider_id
    FROM public.find_eligible_providers(p_booking_id)
    WHERE rank <= 3
  ),
  inserted AS (
    INSERT INTO public.booking_offers (booking_id, provider_id, wave, status, offered_at, expires_at)
    SELECT p_booking_id, c.cand_provider_id, v_wave, 'pending', now(), v_expires_at
    FROM candidates c
    ON CONFLICT ON CONSTRAINT booking_offers_booking_provider_unique DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_created_count FROM inserted;

  -- 5. Determine outcome
  IF v_created_count > 0 THEN
    v_outcome := 'offers_created';
  ELSE
    v_outcome := 'offers_already_exist';
    SELECT min(bo.expires_at) INTO v_expires_at
    FROM public.booking_offers bo
    WHERE bo.booking_id = p_booking_id AND bo.wave = v_wave;
  END IF;

  RETURN QUERY SELECT p_booking_id, v_wave, v_candidate_count, v_created_count, v_expires_at, v_outcome;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.dispatch_booking_wave_one(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispatch_booking_wave_one(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dispatch_booking_wave_one(uuid) FROM authenticated;