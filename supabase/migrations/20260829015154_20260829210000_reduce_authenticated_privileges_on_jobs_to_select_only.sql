-- Reduce authenticated privileges on public.jobs to SELECT only.
--
-- Authenticated clients only need SELECT on jobs (via the
-- select_own_jobs_as_provider RLS policy). All writes go through
-- SECURITY DEFINER RPCs (provider_on_my_way) or the service_role
-- job-progress Edge Function.
--
-- INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER are revoked.
-- SELECT is retained.
--
-- anon (already zero), service_role, and postgres are unchanged.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.jobs FROM authenticated;
