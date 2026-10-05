/*
# Add membership eligibility check to accept_booking_offer

## Purpose
Enforce server-side that a Wash Partner with 3+ completed jobs and no
active membership cannot accept NEW booking offers. This is the
authoritative enforcement point — it cannot be bypassed by frontend
manipulation, multiple devices, or direct RPC calls.

## Change
After ALL existing validation passes (ownership, pending status, expiry,
self-booking guard) and BEFORE the atomic booking UPDATE, the function
now calls can_provider_receive_jobs(v_provider_id). If false, it returns
{success: false, booking_id: null, error: 'membership_required'} with
no mutations.

## Preserved
- Function signature, return type (jsonb), SECURITY DEFINER, search_path
- Existing ownership validation (provider_profiles.profile_id = auth.uid())
- Pending-offer and expiry validation
- Self-booking guard
- First-accept-wins atomic booking assignment
- accepted / accepted_elsewhere offer updates
- Existing error/return conventions
- No changes to find_eligible_providers, dispatch, RLS, schema, or
  the job-progress Edge Function

## Important
The check is placed BEFORE the booking UPDATE, so a locked provider's
acceptance attempt does not mutate any rows. The third active job is
never interrupted because the check only runs when accepting a NEW job.
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
  v_customer_id  uuid;
  v_profile_id   uuid;
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

  -- Self-booking guard: reject if the accepting provider is the booking creator
  SELECT b.customer_id INTO v_customer_id
  FROM public.bookings b
  WHERE b.id = v_booking_id;

  SELECT pp.profile_id INTO v_profile_id
  FROM public.provider_profiles pp
  WHERE pp.id = v_provider_id;

  IF v_customer_id IS NOT NULL
     AND v_profile_id IS NOT NULL
     AND v_customer_id = v_profile_id THEN
    RETURN jsonb_build_object('success', false, 'booking_id', null, 'error', 'self_booking_not_allowed');
  END IF;

  -- Membership eligibility check: providers with 3+ completed jobs
  -- must have an active membership to accept new jobs.
  IF NOT public.can_provider_receive_jobs(v_provider_id) THEN
    RETURN jsonb_build_object('success', false, 'booking_id', null, 'error', 'membership_required');
  END IF;

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

-- Preserve existing grants
REVOKE EXECUTE ON FUNCTION public.accept_booking_offer(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.accept_booking_offer(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_booking_offer(uuid) TO authenticated;
