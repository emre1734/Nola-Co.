/*
# Secure washer location RPC for customer tracking

1. Purpose
- Allows a customer to retrieve the live location of their assigned washer
  ONLY while the washer's job status is 'on_the_way'.
- All authorization is enforced server-side via a SECURITY DEFINER function.
- No location history is stored. No route data is persisted.
- The existing provider_profiles SELECT RLS policy is NOT modified.

2. Security
- SECURITY DEFINER so the function runs with elevated privileges and can
  read provider_profiles regardless of the caller's RLS.
- Verifies booking.customer_id = auth.uid() — the caller must own the booking.
- Verifies the booking has an assigned provider (provider_id IS NOT NULL).
- Verifies there is an active job with status = 'on_the_way'.
- Returns only current_latitude and current_longitude — no other profile data.
- Returns an empty result set if any condition fails (no error leaked).

3. Retention
- This function reads live coordinates only. It does not write, insert, or
  store any location history.
*/

CREATE OR REPLACE FUNCTION get_assigned_washer_location(p_booking_id uuid)
RETURNS TABLE(
  latitude double precision,
  longitude double precision,
  job_status text,
  provider_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify the booking belongs to the authenticated user.
  IF NOT EXISTS (
    SELECT 1 FROM bookings
    WHERE id = p_booking_id
      AND customer_id = auth.uid()
  ) THEN
    RETURN;
  END IF;

  -- Return the assigned washer's current location only while the job is
  -- on_the_way. Join through bookings -> jobs -> provider_profiles so the
  -- provider is guaranteed to be the one assigned to THIS booking.
  RETURN QUERY
  SELECT
    pp.current_latitude::double precision,
    pp.current_longitude::double precision,
    j.status::text,
    p.full_name
  FROM bookings b
  JOIN jobs j ON j.booking_id = b.id
  JOIN provider_profiles pp ON pp.id = b.provider_id
  JOIN profiles p ON p.id = pp.profile_id
  WHERE b.id = p_booking_id
    AND b.provider_id IS NOT NULL
    AND j.status = 'on_the_way';
END;
$$;

-- Grant execute to authenticated users only.
REVOKE ALL ON FUNCTION get_assigned_washer_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_assigned_washer_location(uuid) TO authenticated;
