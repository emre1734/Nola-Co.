-- Replace the broad bookings_select_waiting_broadcast policy with a
-- pending-offer-provider-scoped SELECT policy.
--
-- The old policy allowed ANY authenticated user to read ALL waiting,
-- unassigned bookings — exposing customer location, notes, vehicle, etc.
--
-- The new policy allows SELECT only when the authenticated user owns a
-- provider profile that has a currently valid (pending, non-expired)
-- booking_offer for that specific waiting booking.

DROP POLICY IF EXISTS bookings_select_waiting_broadcast ON public.bookings;

CREATE POLICY bookings_select_pending_offer_provider
  ON public.bookings
  FOR SELECT
  TO authenticated
  USING (
    bookings.status = 'waiting'::booking_status
    AND bookings.provider_id IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.booking_offers bo
      JOIN public.provider_profiles pp
        ON pp.id = bo.provider_id
      WHERE bo.booking_id = bookings.id
        AND pp.profile_id = auth.uid()
        AND bo.status = 'pending'
        AND bo.expires_at > now()
    )
  );
