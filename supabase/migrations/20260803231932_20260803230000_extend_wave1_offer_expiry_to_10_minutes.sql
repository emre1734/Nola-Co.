/*
# Extend Wave 1 offer expiry from 90 seconds to 10 minutes

## Reason
Wave expansion (Wave 2) is not yet implemented. With the old 90-second
expiry, Wave 1 offers disappeared before a provider could respond during
closed testing, leaving the booking with zero visible offers.

## Change
Single constant change: v_expiry_interval from '90 seconds' to '10 minutes'.

## Temporary
10 minutes is a temporary closed-test duration. The final production
behavior will be: Wave 1 expires → create Wave 2 offers → then expire
Wave 1. Wave 2 is not implemented in this migration.

## Idempotency preserved
ON CONFLICT ON CONSTRAINT booking_offers_booking_provider_unique DO NOTHING
means a second dispatch call does not update existing offers. Their
expires_at remains unchanged. Only newly created offers get the 10-minute
expiry.
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
  v_expiry_interval interval := interval '10 minutes';
  v_candidate_count int := 0;
  v_created_count int = 0;
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

  -- 2. Count eligible candidates (rank <= 3)
  SELECT count(*) INTO v_candidate_count
  FROM public.find_eligible_providers(p_booking_id)
  WHERE rank <= 3;

  IF v_candidate_count = 0 THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'no_eligible_providers';
    RETURN;
  END IF;

  -- 3. Insert pending offers (idempotent via ON CONFLICT ON CONSTRAINT)
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

  -- 4. Determine outcome
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
