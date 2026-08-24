/*
# Add provider read-only SELECT policy on jobs

## Purpose
jobs has RLS enabled with zero policies, blocking all direct client access.
Providers need to SELECT their own assigned jobs for:
  1. earnings / recent completed jobs display
  2. active-job detection before accepting another booking

All job mutations continue through the job-progress Edge Function (service role).
No INSERT/UPDATE/DELETE policies are added.

## Identity model
auth.uid() → profiles.id → provider_profiles.profile_id → provider_profiles.id → jobs.provider_id
*/

CREATE POLICY "select_own_jobs_as_provider"
ON public.jobs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.provider_profiles pp
    WHERE pp.id = jobs.provider_id
      AND pp.profile_id = auth.uid()
  )
);
