-- Revoke unnecessary TRUNCATE privilege from anon and authenticated.
--
-- TRUNCATE is a bulk-destructive operation not governed by RLS.
-- No application or client flow uses TRUNCATE. Removing it from
-- anon/authenticated is least-privilege hardening. service_role
-- and postgres retain all privileges unchanged.

REVOKE TRUNCATE ON TABLE public.bookings FROM anon, authenticated;
REVOKE TRUNCATE ON TABLE public.booking_offers FROM anon, authenticated;
