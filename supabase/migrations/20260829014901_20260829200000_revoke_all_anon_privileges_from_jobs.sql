-- Remove all anon table privileges from public.jobs.
--
-- anon has no RLS policies on jobs and no legitimate unauthenticated
-- flow uses the jobs table. All 7 grants are unnecessary and are
-- revoked as defense-in-depth / least-privilege hardening.
--
-- authenticated grants, service_role grants, postgres grants,
-- RLS, and the select_own_jobs_as_provider policy are unchanged.

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
ON TABLE public.jobs FROM anon;
