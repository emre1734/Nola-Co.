/*
# Fix find_eligible_providers return type — ROW_NUMBER returns bigint

The ROW_NUMBER() window function returns bigint, but the function
signature declares rank as integer. Cast the ROW_NUMBER result to
integer to match the return type.
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
  SELECT b.status, b.provider_id, b.latitude, b.longitude,
         b.booking_date, b.booking_time, b.service_id
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_booking.status IS DISTINCT FROM 'waiting' THEN
    RETURN;
  END IF;

  IF v_booking.provider_id IS NOT NULL THEN
    RETURN;
  END IF;

  IF v_booking.latitude IS NULL OR v_booking.longitude IS NULL THEN
    RETURN;
  END IF;

  IF v_booking.booking_date IS NULL OR v_booking.booking_time IS NULL THEN
    RETURN;
  END IF;

  SELECT LOWER(SUBSTRING(TO_CHAR(v_booking.booking_date, 'Day') FROM 1 FOR 3))
  INTO v_booking_dow;

  v_booking_minutes := EXTRACT(HOUR FROM v_booking.booking_time) * 60
                     + EXTRACT(MINUTE FROM v_booking.booking_time);

  SELECT COALESCE(s.estimated_duration, 60) INTO v_service_duration
  FROM public.services s
  WHERE s.id = v_booking.service_id;

  RETURN QUERY
  WITH eligible AS (
    SELECT
      pp.id AS pid,
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
      AND v_booking_dow = ANY(pp.working_days)
      AND v_booking.booking_time::text >= pp.work_start_time
      AND v_booking.booking_time::text <= pp.work_end_time
      AND NOT EXISTS (
        SELECT 1 FROM public.jobs j
        WHERE j.provider_id = pp.id
          AND j.status IN ('on_the_way', 'arrived', 'started', 'pending_approval')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.bookings ab
        JOIN public.services abs ON abs.id = ab.service_id
        WHERE ab.provider_id = pp.id
          AND ab.status = 'accepted'
          AND ab.booking_date IS NOT NULL
          AND ab.booking_time IS NOT NULL
          AND ab.id != p_booking_id
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
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_rejections br
        WHERE br.booking_id = p_booking_id
          AND br.provider_id = pp.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.booking_offers bo
        WHERE bo.booking_id = p_booking_id
          AND bo.provider_id = pp.id
      )
  )
  SELECT
    e.pid,
    ROUND(e.dist_km::numeric, 2),
    (ROW_NUMBER() OVER (ORDER BY e.dist_km ASC, e.pid ASC))::integer AS rnk
  FROM eligible e
  WHERE e.dist_km <= v_radius_km
  ORDER BY e.dist_km ASC, e.pid ASC
  LIMIT 20;
END;
$$;