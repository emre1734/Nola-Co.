-- Make generate_wishwash_id() SECURITY DEFINER so the BEFORE INSERT trigger
-- can read profiles.wishwash_id for uniqueness checking even though
-- authenticated users have no direct SELECT on that column.
-- The function is read-only (checks for existence of a wishwash_id) and
-- returns only a generated text ID — no PII is leaked.

ALTER FUNCTION public.generate_wishwash_id()
  SECURITY DEFINER
  SET search_path = pg_catalog, public;

-- Revoke EXECUTE from PUBLIC and anon; keep authenticated for the trigger.
REVOKE EXECUTE ON FUNCTION public.generate_wishwash_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.generate_wishwash_id() FROM anon;
