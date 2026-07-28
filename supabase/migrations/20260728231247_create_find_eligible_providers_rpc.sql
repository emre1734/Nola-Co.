/*
# Create find_eligible_providers RPC — Dispatch Engine Sprint 2

## Purpose
Creates a SECURITY DEFINER Postgres function that finds and ranks
eligible Washers for a given booking. This is a read-only candidate
finder — it does NOT create booking_offers, assign providers, or
modify any booking.

## RPC Signature
  find_eligible_providers(p_booking_id uuid)
  RETURNS TABLE(provider_id uuid, approximate_distance_km numeric, rank integer)

## Security
- SECURITY DEFINER so it can read provider_profiles, jobs, and
  booking_rejections/booking_offers across RLS boundaries.
- Fixed search_path set to 'pg_catalog', 'public' to prevent
  search_path injection.
- Returns only dispatch-relevant fields: provider_id, distance, rank.
  No coordinates, no profile data, no customer data.
- Intended for server-side dispatch logic only. Not granted to anon
  or authenticated roles for broad client execution.

## Eligibility Filters
1. Profile role = 'provider'
2. Profile is_active = true
3. provider_profiles.status = 'available' (online and accepting)
4. provider_profiles.is_verified = true (approved)
5. Booking day-of-week is in provider_profiles.working_days
6. Booking time is within work_start_time..work_end_time
7. No blocking active job (jobs.status in on_the_way/arrived/started/pending_approval)
8. No schedule conflict with existing accepted bookings (time overlap check)
9. Not already rejected this booking (booking_rejections)
10. Not already offered this booking (booking_offers)
11. Provider has dispatch coordinates (profiles.latitude/longitude not null)
12. Distance <= configurable radius (default 5 km)

## Filters Omitted (no schema support)
- Equipment requirement: services table has no equipment_requirement column.
  provider_profiles.equipment exists but no service-to-equipment mapping.
- Service-type support: no table links providers to supported services.
  All providers are assumed to support all active services.

## Distance
- Haversine formula in SQL (no PostGIS installed).
- Booking location: bookings.latitude / bookings.longitude
- Provider location: profiles.latitude / profiles.longitude (permanent
  onboarding location, NOT provider_profiles.current_latitude/current_longitude
  which are live tracking coordinates)

## Ranking
1. Shortest approximate_distance_km ascending
2. provider_id ascending as deterministic tie-breaker

## Limits
- Returns at most 20 candidates, ordered by rank ascending.
- Initial search radius: 5 km (configurable constant in function body).
*/

CREATE OR REPLACE FUNCTION public.find_eligible_providers(p_booking_id uuid)
RETURNS TABLE(
  provider_id uuid,
  approximate_distance_km numeric,
  rank integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_booking RECORD;
  v_booking_dow text;
  v_booking_minutes int;
  v_service_duration int;
  v_radius_km numeric := 5.0;
BEGIN
  -- Load the booking
  SELECT b.status, b.provider_id, b.latitude, b.longitude,
         b.booking_date, b.booking_time, b.service_id
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  -- Booking not found
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Booking is not dispatchable
  IF v_booking.status IS DISTINCT FROM 'waiting' THEN
    RETURN;
  END IF;

  -- Booking already assigned
  IF v_booking.provider_id IS NOT NULL THEN
    RETURN;
  END IF;

  -- Booking must have location coordinates
  IF v_booking.latitude IS NULL OR v_booking.longitude IS NULL THEN
    RETURN;
  END IF;

  -- Booking must have date and time
  IF v_booking.booking_date IS NULL OR v_booking.booking_time IS NULL THEN
    RETURN;
  END IF;

  -- Day of week: convert to short lowercase code matching working_days format
  SELECT LOWER(SUBSTRING(TO_CHAR(v_booking.booking_date, 'Day') FROM 1 FOR 3))
  INTO v_booking_dow;

  -- Convert booking time to minutes since midnight for overlap checks
  v_booking_minutes := EXTRACT(HOUR FROM v_booking.booking_time) * 60
                     + EXTRACT(MINUTE FROM v_booking.booking_time);

  -- Get service estimated duration (default 60 min)
  SELECT COALESCE(s.estimated_duration, 60) INTO v_service_duration
  FROM public.services s
  WHERE s.id = v_booking.service_id;

  -- Return ranked eligible providers
  RETURN QUERY
  WITH eligible AS (
    SELECT
      pp.id AS pid,
      -- Haversine distance in km
      (
        6371.0 * 2.0 * ATAN2(
          SQRT(
            POWER(SIN(RADIANS(p.latitude - v_booking.latitude) / 2.0), 2) +
            COS(RADIANS(v_booking.latitude)) * COS(RADIANS(p.latitude)) *
            POWER(SIN(RADIANS(p.longitude - v_booking.longitude) / 2.0), 2)
          ),
          SQRT(1.0 - (
            POWER(SIN(RADIANS(p.latitude - v_booking.latitude) / 2.0), 2) +
            COS(RADIANS(v_booking.latitude)) * COS(RADIANS(p.latitude)) *
            POWER(SIN(RADIANS(p.longitude - v_booking.longitude) / 2.0), 2)
          ))
        )
      ) AS dist_km
    FROM public.provider_profiles pp
    JOIN public.profiles p ON p.id = pp.profile_id
    WHERE p.role = 'provider'
      AND p.is_active = true
      AND pp.status = 'available'
      AND pp.is_verified = true
      AND p.latitude IS NOT NULL
      AND p.longitude IS NOT NULL
      -- Working days: booking day must be in the provider's working_days array
      AND v_booking_dow = ANY(pp.working_days)
      -- Working hours: booking time must be within work window
      AND v_booking.booking_time::text >= pp.work_start_time
      AND v_booking.booking_time::text <= pp.work_end_time
      -- No blocking active job
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.provider_id = pp.id
          AND j.status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
      )
      -- No schedule conflict with existing accepted bookings
      AND NOT EXISTS (
        SELECT 1 FROM public.bookings ab
        JOIN public.services abs ON abs.id = ab.service_id
        WHERE ab.provider_id = pp.id
          AND ab.status = 'accepted'
          AND ab.booking_date IS NOT NULL
          AND ab.booking_time IS NOT NULL
          AND ab.id != p_booking_id
          -- Overlap check: [req_start, req_end] intersects [exist_start, exist_end]
          AND (
            v_booking_minutes < (
              EXTRACT(HOUR FROM ab.booking_time) * 60
              + EXTRACT(MINUTE FROM ab.booking_time)
              + COALESCE(abs.estimated_duration, 60)
            )
            AND (
              EXTRACT(HOUR FROM ab.booking_time) * 60
              + EXTRACT(MINUTE FROM ab.booking_time)
            ) < (v_booking_minutes + v_service_duration)
          )
      )
      -- Not already rejected
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_rejections br
        WHERE br.booking_id = p_booking_id
          AND br.provider_id = pp.id
      )
      -- Not already offered
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_offers bo
        WHERE bo.booking_id = p_booking_id
          AND bo.provider_id = pp.id
      )
  )
  SELECT
    e.pid,
    ROUND(e.dist_km::numeric, 2),
    ROW_NUMBER() OVER (ORDER BY e.dist_km ASC, e.pid ASC) AS rnk
  FROM eligible e
  WHERE e.dist_km <= v_radius_km
  ORDER BY e.dist_km ASC, e.pid ASC
  LIMIT 20;
END;
$$;