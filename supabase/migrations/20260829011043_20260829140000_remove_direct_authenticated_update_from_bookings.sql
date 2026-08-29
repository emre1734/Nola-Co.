-- Remove direct authenticated UPDATE access from bookings.
--
-- The bookings_update_own policy allowed a customer to directly UPDATE
-- their booking row with no column or lifecycle-state restrictions,
-- potentially bypassing controlled RPCs (cancel_booking,
-- accept_booking_offer, etc.). The frontend never uses direct
-- bookings UPDATE — all lifecycle changes go through SECURITY DEFINER
-- RPCs or Edge Functions. With RLS enabled and no UPDATE policy,
-- direct authenticated UPDATE is denied while backend authority
-- continues unchanged.

DROP POLICY IF EXISTS bookings_update_own ON public.bookings;
