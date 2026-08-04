/*
# Create accept_booking_offer RPC — Dispatch Engine Sprint 5

## Purpose
Creates a SECURITY DEFINER function that atomically:
1. Verifies the caller owns the offer (p_offer_id) and it's still pending
2. Marks the accepting provider's booking_offer as 'accepted'
3. Marks all other pending offers for the same booking as 'accepted_elsewhere'
4. Updates the booking: status → 'accepted', provider_id → offer's provider_id,
   accepted_at → now() — only if booking is still 'waiting' and unassigned
5. Returns { success: bool, booking_id: uuid | null, error: text | null }

This replaces the client-side two-step flow (direct bookings.update + separate
mark_booking_offer_accepted RPC) with a single atomic server-side operation.
RLS prevents clients from setting offer statuses to 'accepted' or
'accepted_elsewhere' directly — this function is the only path.

## Security
- SECURITY DEFINER with fixed search_path
- REVOKE from PUBLIC, anon, authenticated
- Only callable by authenticated users (GRANT EXECUTE to authenticated)
- Verifies the caller owns the offer via provider_profiles.profile_id = auth.uid()
- Verifies the offer is still pending and not expired
- Verifies the booking is still 'waiting' and unassigned before updating

## Return
JSONB: { "success": bool, "booking_id": uuid | null, "error": text | null }
*/

CREATE OR REPLACE FUNCTION public.accept_booking_offer(p_offer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_offer        RECORD;
  v_booking_id   uuid;
  v_provider_id  uuid;
  v_updated_rows integer;
BEGIN
  -- 1. Load the offer and verify ownership + status
  SELECT bo.booking_id, bo.provider_id, bo.status, bo.expires_at
    INTO v_offer
  FROM public.booking_offers bo
  WHERE bo.id = p_offer_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'booking_id', null, 'error', 'offer_not_found');
  END IF;

  -- Verify the caller owns this offer
  IF NOT EXISTS (
    SELECT 1 FROM public.provider_profiles pp
    WHERE pp.id = v_offer.provider_id
      AND pp.profile_id = auth.uid()
  ) THEN
    RETURN jsonb_build_object('success', false, 'booking_id', null, 'error', 'not_authorized');
  END IF;

  -- Verify the offer is still pending
  IF v_offer.status != 'pending' THEN
    RETURN jsonb_build_object('success', false, 'booking_id', null, 'error', 'offer_' || v_offer.status);
  END IF;

  -- Verify the offer hasn't expired
  IF v_offer.expires_at IS NOT NULL AND v_offer.expires_at < now() THEN
    RETURN jsonb_build_object('success', false, 'booking_id', null, 'error', 'offer_expired');
  END IF;

  v_booking_id  := v_offer.booking_id;
  v_provider_id := v_offer.provider_id;

  -- 2. Atomically update the booking — only if still 'waiting' and unassigned
  UPDATE public.bookings
    SET status       = 'accepted',
        provider_id  = v_provider_id,
        accepted_at  = now(),
        updated_at   = now()
    WHERE id          = v_booking_id
      AND status      = 'waiting'
      AND provider_id IS NULL;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    -- Booking was already taken, cancelled, or expired
    -- Still mark this offer as 'accepted_elsewhere' so the UI removes the card
    UPDATE public.booking_offers
      SET status = 'accepted_elsewhere', responded_at = now(), updated_at = now()
      WHERE id = p_offer_id AND status = 'pending';

    RETURN jsonb_build_object('success', false, 'booking_id', null, 'error', 'booking_unavailable');
  END IF;

  -- 3. Mark the accepting provider's offer as 'accepted'
  UPDATE public.booking_offers
    SET status = 'accepted', responded_at = now(), updated_at = now()
    WHERE id = p_offer_id AND status = 'pending';

  -- 4. Mark all other pending offers for this booking as 'accepted_elsewhere'
  UPDATE public.booking_offers
    SET status = 'accepted_elsewhere', responded_at = now(), updated_at = now()
    WHERE booking_id = v_booking_id
      AND provider_id != v_provider_id
      AND status = 'pending';

  RETURN jsonb_build_object('success', true, 'booking_id', v_booking_id, 'error', null);
END;
$$;

-- Grant execute to authenticated users only
REVOKE EXECUTE ON FUNCTION public.accept_booking_offer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_booking_offer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_booking_offer(uuid) TO authenticated;
