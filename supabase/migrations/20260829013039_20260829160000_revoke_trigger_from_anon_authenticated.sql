-- Revoke unnecessary TRIGGER privilege from anon and authenticated.
--
-- TRIGGER privilege is only required to CREATE or DROP triggers, not
-- to fire them. Existing triggers fire automatically during INSERT/
-- UPDATE operations regardless of the executing role's TRIGGER grant.
-- No application flow creates or drops triggers at runtime.

REVOKE TRIGGER ON TABLE public.bookings FROM anon, authenticated;
REVOKE TRIGGER ON TABLE public.booking_offers FROM anon, authenticated;
