/*
# Create can_provider_receive_jobs eligibility function

## Purpose
Single authoritative server-side rule that determines whether a Wash
Partner may receive/accept NEW jobs. Used by both accept_booking_offer
and find_eligible_providers to avoid duplicating eligibility logic.

## Logic
A provider can receive new jobs if:
  1. They have fewer than 3 completed jobs (free starter period), OR
  2. They have an active membership (state IN ('active','grace_period')
     AND expiry_time IS NOT NULL AND expiry_time > now())

Completed jobs are counted from the jobs table:
  SELECT count(*) FROM jobs WHERE provider_id = p_provider_id AND status = 'completed'

The stale provider_profiles.completed_jobs column is NOT used.

## Security
- SECURITY DEFINER so it can read provider_subscriptions (which has RLS)
  and jobs (which has restricted grants).
- search_path = pg_catalog, public
- GRANT EXECUTE TO authenticated (called by RPCs and frontend)
- The function only returns a boolean — no sensitive data is exposed.

## Important
A NULL expiry_time must NOT grant access. Only a verified, non-null,
future expiry_time counts as valid membership.
*/

CREATE OR REPLACE FUNCTION public.can_provider_receive_jobs(p_provider_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT
    -- Free starter period: fewer than 3 completed jobs
    (
      SELECT count(*) FROM public.jobs j
      WHERE j.provider_id = p_provider_id
        AND j.status = 'completed'
    ) < 3
    OR
    -- Active membership: valid state + non-null future expiry
    EXISTS (
      SELECT 1 FROM public.provider_subscriptions ps
      WHERE ps.provider_profile_id = p_provider_id
        AND ps.state IN ('active', 'grace_period')
        AND ps.expiry_time IS NOT NULL
        AND ps.expiry_time > now()
    )
$$;

-- Grant to authenticated (called by accept_booking_offer and find_eligible_providers
-- which are SECURITY DEFINER, and also potentially by frontend RPCs)
REVOKE EXECUTE ON FUNCTION public.can_provider_receive_jobs(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.can_provider_receive_jobs(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_provider_receive_jobs(uuid) TO authenticated;
