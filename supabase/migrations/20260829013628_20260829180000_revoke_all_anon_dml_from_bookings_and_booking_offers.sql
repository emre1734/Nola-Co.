-- Remove all remaining anon DML access from bookings and booking_offers.
--
-- Unauthenticated users have no legitimate need to read or write
-- bookings or booking_offers. All booking functionality requires
-- an authenticated session. Edge Functions use the service_role key
-- and are unaffected by anon grant removal.

REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.bookings FROM anon;
REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_offers FROM anon;
