/*
# Fix dispatch_booking_wave_one ambiguous column reference (attempt 2)

ON CONFLICT requires column names or an index expression, not
table-qualified names. Use a CTE to avoid the ambiguity instead.
*/

CREATE OR REPLACE FUNCTION public.dispatch_booking_wave_one(p_booking_id uuid)
RETURNS TABLE(
  booking_id uuid,
  wave integer,
  candidate_count integer,
  created_offer_count integer,
  expires_at timestamptz,
  outcome text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_booking RECORD;
  v_wave int := 1;
  v_expiry_interval interval := interval '90 seconds';
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

  -- 2. Get eligible providers and select top 3
  -- Use a CTE so column names are unambiguous in ON CONFLICT
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
    ON CONFLICT (booking_id, provider_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_created_count FROM inserted;

  -- Count total candidates
  SELECT count(*) INTO v_candidate_count
  FROM public.find_eligible_providers(p_booking_id)
  WHERE rank <= 3;

  -- 3. Determine outcome
  IF v_candidate_count = 0 THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'no_eligible_providers';
    RETURN;
  END IF;

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