/*
# Create dispatch_booking_wave_one RPC — Dispatch Engine Sprint 3

## Purpose
Creates a SECURITY DEFINER Postgres function that generates Wave 1
booking offers for the closest 3 eligible Washers.

This is the secure server-side dispatch entry point. It:
1. Validates the booking is dispatchable
2. Reuses find_eligible_providers(p_booking_id) to get ranked candidates
3. Selects the closest 3 (rank <= 3)
4. Inserts pending booking_offers rows with 90-second expiry
5. Returns a safe summary

It does NOT:
- Assign the booking to a provider
- Create a job
- Change booking status
- Send push notifications
- Implement wave expansion

## Why RPC (not Edge Function)
All required work is pure database logic:
- Booking validation is a SELECT
- Eligibility ranking is an existing RPC
- Offer insertion is an INSERT with ON CONFLICT DO NOTHING
- The entire operation is atomic within a single function call
No external API calls, secrets, or network access is needed.
A Postgres RPC is simpler, faster, and inherently transactional.

## Security
- SECURITY DEFINER with fixed search_path = pg_catalog, public
- REVOKE EXECUTE from PUBLIC, anon, authenticated
- Only the service role (or future edge function with service key) can call it
- Customers cannot call it with arbitrary booking IDs

## Idempotency
- Uses ON CONFLICT (booking_id, provider_id) DO NOTHING
- Calling twice for the same booking creates no duplicate offers
- Existing offer expiry is NOT extended (DO NOTHING, not DO UPDATE)
- Existing statuses (rejected, accepted, expired) are NOT reset
- If all 3 offers already exist, returns offers_already_exist

## Return Shape
  TABLE(
    booking_id uuid,
    wave integer,
    candidate_count integer,
    created_offer_count integer,
    expires_at timestamptz,
    outcome text
  )

  Outcomes:
  - offers_created: at least one new offer was inserted
  - offers_already_exist: offers already existed for all 3 candidates
  - no_eligible_providers: find_eligible_providers returned 0 rows
  - booking_not_dispatchable: booking is not in a dispatchable state
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
  -- ============================================================
  -- 1. Load and validate the booking
  -- ============================================================
  SELECT b.status, b.provider_id, b.latitude, b.longitude,
         b.booking_date, b.booking_time
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  -- Booking not found
  IF NOT FOUND THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  -- Booking must be in 'waiting' status (dispatchable initial status)
  IF v_booking.status IS DISTINCT FROM 'waiting' THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  -- Booking must not already have a provider assigned
  IF v_booking.provider_id IS NOT NULL THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  -- Booking must have location coordinates
  IF v_booking.latitude IS NULL OR v_booking.longitude IS NULL THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  -- Booking must have date and time
  IF v_booking.booking_date IS NULL OR v_booking.booking_time IS NULL THEN
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'booking_not_dispatchable';
    RETURN;
  END IF;

  -- ============================================================
  -- 2. Get eligible providers (reuse existing RPC)
  -- ============================================================
  -- Store candidates in a temporary structure
  CREATE TEMP TABLE IF NOT EXISTS _wave_candidates AS
  SELECT provider_id, rank
  FROM public.find_eligible_providers(p_booking_id)
  WHERE rank <= 3;

  -- Refresh temp table contents (in case it existed from a prior call in same session)
  TRUNCATE TABLE _wave_candidates;
  INSERT INTO _wave_candidates
  SELECT provider_id, rank
  FROM public.find_eligible_providers(p_booking_id)
  WHERE rank <= 3;

  SELECT count(*) INTO v_candidate_count FROM _wave_candidates;

  -- No eligible providers
  IF v_candidate_count = 0 THEN
    DROP TABLE IF EXISTS _wave_candidates;
    RETURN QUERY SELECT p_booking_id, v_wave, 0, 0, NULL::timestamptz, 'no_eligible_providers';
    RETURN;
  END IF;

  -- ============================================================
  -- 3. Insert pending offers (idempotent via ON CONFLICT DO NOTHING)
  -- ============================================================
  v_expires_at := now() + v_expiry_interval;

  INSERT INTO public.booking_offers (booking_id, provider_id, wave, status, offered_at, expires_at)
  SELECT p_booking_id, c.provider_id, v_wave, 'pending', now(), v_expires_at
  FROM _wave_candidates c
  ON CONFLICT (booking_id, provider_id) DO NOTHING;

  GET DIAGNOSTICS v_created_count = ROW_COUNT;

  DROP TABLE IF EXISTS _wave_candidates;

  -- ============================================================
  -- 4. Determine outcome
  -- ============================================================
  IF v_created_count > 0 THEN
    v_outcome := 'offers_created';
  ELSE
    v_outcome := 'offers_already_exist';
    -- Return the earliest existing expiry so caller has a reference
    SELECT min(expires_at) INTO v_expires_at
    FROM public.booking_offers
    WHERE booking_id = p_booking_id AND wave = v_wave;
  END IF;

  RETURN QUERY SELECT p_booking_id, v_wave, v_candidate_count, v_created_count, v_expires_at, v_outcome;
END;
$$;

-- ============================================================
-- Security: Revoke broad access, allow only service role
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.dispatch_booking_wave_one(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.dispatch_booking_wave_one(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.dispatch_booking_wave_one(uuid) FROM authenticated;