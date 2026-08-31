/*
# Close cross-user SELECT exposure on provider_profiles

## Problem
The existing `provider_profiles_select` policy uses `USING (true)`, allowing
any authenticated user to read every provider_profiles row — including
sensitive permanent service/dispatch coordinates (current_latitude,
current_longitude). No customer or unrelated provider needs direct access
to another provider's profile row.

## Changes
1. Drop the broad `provider_profiles_select` policy.
2. Create `provider_profiles_select_own` scoped to `auth.uid() = profile_id`
   so authenticated users can only SELECT their own provider row.
3. Revoke table-level SELECT from authenticated.
4. Grant column-level SELECT only on columns required by current owner UI:
   id, profile_id, status, rating, total_reviews, completed_jobs, equipment,
   service_price, working_days, work_start_time, work_end_time, bio.
   - profile_id is included because frontend queries filter on it.
5. Exclude direct SELECT on sensitive/internal columns:
   current_latitude, current_longitude, is_verified, cancelled_jobs,
   service_radius, created_at, updated_at.

## What is NOT changed
- INSERT policy (provider_profiles_insert_own) — unchanged.
- UPDATE policy (provider_profiles_update_own) — unchanged.
- authenticated INSERT/UPDATE/DELETE grants — unchanged.
- anon grants — unchanged (out of scope for this task).
- service_role/postgres access — unchanged.
- Backend SECURITY DEFINER functions (find_eligible_providers, dispatch) —
  continue reading all columns under elevated authority.
- Live tracking — uses provider_live_locations, unaffected.

## Security
- Owner-only row visibility: auth.uid() = profile_id.
- No cross-user SELECT policy.
- Sensitive coordinates not directly selectable by authenticated clients.
*/

-- 1. Replace broad SELECT policy with owner-only policy
DROP POLICY IF EXISTS "provider_profiles_select" ON public.provider_profiles;

CREATE POLICY "provider_profiles_select_own"
  ON public.provider_profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id);

-- 2. Revoke table-level SELECT from authenticated, then grant column-level
REVOKE SELECT ON public.provider_profiles FROM authenticated;

GRANT SELECT (
  id,
  profile_id,
  status,
  rating,
  total_reviews,
  completed_jobs,
  equipment,
  service_price,
  working_days,
  work_start_time,
  work_end_time,
  bio
) ON public.provider_profiles TO authenticated;