-- Reduce authenticated DML grants to the minimum required.
--
-- public.bookings: authenticated needs only SELECT + INSERT.
--   UPDATE: removed (no direct caller; lifecycle writes use
--     SECURITY DEFINER RPCs / service_role).
--   DELETE: removed (cancellation uses cancel_booking RPC).
--
-- public.booking_offers: authenticated needs only SELECT + UPDATE.
--   INSERT: removed (offer creation is backend / SECURITY DEFINER).
--   DELETE: removed (no direct caller, no DELETE policy).

REVOKE UPDATE, DELETE ON TABLE public.bookings FROM authenticated;
REVOKE INSERT, DELETE ON TABLE public.booking_offers FROM authenticated;
