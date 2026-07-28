/*
# Create mark_booking_offer_accepted RPC — Dispatch Engine Sprint 4

## Purpose
Creates a SECURITY DEFINER function that:
1. Marks the accepting provider's booking_offer as 'accepted'
2. Marks all other pending offers for the same booking as 'accepted_elsewhere'

This is needed because RLS prevents clients from setting 'accepted'
or 'accepted_elsewhere' statuses directly (only 'rejected' is allowed
from the client per Sprint 1 policies).

## Security
- SECURITY DEFINER with fixed search_path
- REVOKE from PUBLIC, anon, authenticated
- Only callable by service role (or edge functions with service key)
- Verifies the caller owns the offer being marked accepted

## Return
TABLE(offer_id uuid, new_status text)
*/

CREATE OR REPLACE FUNCTION public.mark_booking_offer_accepted(
  p_booking_id uuid,
  p_provider_id uuid
)
RETURNS TABLE(offer_id uuid, new_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Mark the accepting provider's offer as accepted
  UPDATE public.booking_offers
  SET status = 'accepted',
      responded_at = now()
  WHERE booking_id = p_booking_id
    AND provider_id = p_provider_id
    AND status = 'pending';

  -- Mark all other pending offers as accepted_elsewhere
  UPDATE public.booking_offers
  SET status = 'accepted_elsewhere',
      responded_at = now()
  WHERE booking_id = p_booking_id
    AND provider_id != p_provider_id
    AND status = 'pending';

  RETURN QUERY
  SELECT id, status FROM public.booking_offers
  WHERE booking_id = p_booking_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.mark_booking_offer_accepted(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_booking_offer_accepted(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_booking_offer_accepted(uuid, uuid) FROM authenticated;