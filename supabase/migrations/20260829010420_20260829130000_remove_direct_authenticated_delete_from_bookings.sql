-- Remove direct authenticated DELETE access from bookings.
--
-- The bookings_delete_own policy allowed a customer to directly DELETE
-- their booking row, bypassing the authoritative cancel_booking RPC
-- and its state-transition guards. The frontend never uses direct
-- DELETE — all cancellation goes through cancel_booking (SECURITY
-- DEFINER). With RLS enabled and no DELETE policy, direct authenticated
-- DELETE is denied while cancel_booking continues to work unchanged.

DROP POLICY IF EXISTS bookings_delete_own ON public.bookings;
