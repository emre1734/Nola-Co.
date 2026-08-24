/*
# Create get_customer_booking_job_status RPC

1. Purpose
   - Provides a minimal, customer-safe way for the HomeScreen to learn the
     current job status for one of its active bookings.
   - The customer's Realtime subscription on public.jobs is blocked by RLS
     (only providers have SELECT on jobs). Rather than opening broad customer
     SELECT access to the jobs table, this SECURITY DEFINER function performs
     an ownership check internally and returns ONLY the job status string.

2. Authorization
   - SECURITY DEFINER so it can read the jobs table regardless of RLS.
   - Verifies bookings.customer_id = auth.uid() before returning anything.
   - REVOKE execute from PUBLIC and anon; GRANT execute to authenticated only.
   - search_path set to pg_catalog, public.

3. Data returned
   - On success: { success: true, job_status: <status | null> }
   - Booking not found: { success: false, error: 'booking_not_found' }
   - Wrong customer: { success: false, error: 'not_authorized' }
   - Only jobs.status is exposed — no other jobs columns.

4. No changes to existing tables, RLS, or other RPCs.
*/

CREATE OR REPLACE FUNCTION public.get_customer_booking_job_status(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_customer_id uuid;
  v_job_status text;
BEGIN
  -- Verify the booking exists and belongs to the authenticated user.
  SELECT customer_id INTO v_customer_id
  FROM public.bookings
  WHERE id = p_booking_id;

  IF v_customer_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'booking_not_found');
  END IF;

  IF v_customer_id <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  -- Find the latest job for this booking. Return only the status.
  SELECT j.status::text INTO v_job_status
  FROM public.jobs j
  WHERE j.booking_id = p_booking_id
  ORDER BY j.created_at DESC
  LIMIT 1;

  RETURN jsonb_build_object('success', true, 'job_status', v_job_status);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_customer_booking_job_status(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_customer_booking_job_status(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_customer_booking_job_status(uuid) TO authenticated;
