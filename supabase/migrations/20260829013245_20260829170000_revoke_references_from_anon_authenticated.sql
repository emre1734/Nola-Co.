-- Revoke unnecessary REFERENCES privilege from anon and authenticated.
--
-- REFERENCES is required only to CREATE or ALTER foreign key constraints,
-- not to INSERT/UPDATE/SELECT rows that participate in existing FKs.
-- No application runtime flow creates or alters FK constraints.

REVOKE REFERENCES ON TABLE public.bookings FROM anon, authenticated;
REVOKE REFERENCES ON TABLE public.booking_offers FROM anon, authenticated;
