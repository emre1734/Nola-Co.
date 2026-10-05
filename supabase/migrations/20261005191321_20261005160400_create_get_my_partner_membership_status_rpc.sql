/*
# Create get_my_partner_membership_status RPC

## Purpose
Returns safe membership/trial status information to the authenticated
Wash Partner for ProviderDashboard UI display. The provider identity is
derived from auth.uid() — the client cannot pass an arbitrary
provider_profile_id.

## Returns jsonb with:
- completed_jobs (int) — count from jobs table (authoritative source)
- free_jobs_limit (int) — always 3
- free_jobs_remaining (int) — GREATEST(3 - completed_count, 0)
- membership_required (bool) — completed_count >= 3
- membership_active (bool) — same rule as can_provider_receive_jobs
- membership_state (text|null) — state from provider_subscriptions
- membership_expiry_time (timestamptz|null) — expiry from provider_subscriptions
- auto_renew (bool|null) — auto_renew from provider_subscriptions
- can_receive_jobs (bool) — result of can_provider_receive_jobs

## Does NOT return:
- purchase_token
- service account information
- Google credentials
- internal verification secrets
- provider_profile_id (client already has it from fetchData)

## Security
- SECURITY DEFINER so it can read provider_subscriptions and jobs
- search_path = pg_catalog, public
- GRANT EXECUTE TO authenticated
- Derives provider identity from auth.uid() via provider_profiles
*/

CREATE OR REPLACE FUNCTION public.get_my_partner_membership_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile_id     uuid := auth.uid();
  v_provider_id    uuid;
  v_completed_count int;
  v_membership      RECORD;
  v_can_receive     boolean;
BEGIN
  -- Resolve provider_profile_id from auth.uid()
  SELECT pp.id INTO v_provider_id
  FROM public.provider_profiles pp
  WHERE pp.profile_id = v_profile_id
  LIMIT 1;

  IF v_provider_id IS NULL THEN
    RETURN jsonb_build_object('error', 'provider_profile_not_found');
  END IF;

  -- Authoritative completed job count from jobs table
  SELECT count(*) INTO v_completed_count
  FROM public.jobs j
  WHERE j.provider_id = v_provider_id
    AND j.status = 'completed';

  -- Get the most recent active/grace_period membership (if any)
  SELECT ps.state, ps.expiry_time, ps.auto_renew
    INTO v_membership
  FROM public.provider_subscriptions ps
  WHERE ps.provider_profile_id = v_provider_id
  ORDER BY
    CASE WHEN ps.state IN ('active', 'grace_period') THEN 0 ELSE 1 END,
    ps.created_at DESC
  LIMIT 1;

  -- Check can_provider_receive_jobs
  v_can_receive := public.can_provider_receive_jobs(v_provider_id);

  RETURN jsonb_build_object(
    'completed_jobs', v_completed_count,
    'free_jobs_limit', 3,
    'free_jobs_remaining', GREATEST(3 - v_completed_count, 0),
    'membership_required', v_completed_count >= 3,
    'membership_active',
      v_membership.state IS NOT NULL
      AND v_membership.state IN ('active', 'grace_period')
      AND v_membership.expiry_time IS NOT NULL
      AND v_membership.expiry_time > now(),
    'membership_state', v_membership.state,
    'membership_expiry_time', v_membership.expiry_time,
    'auto_renew', v_membership.auto_renew,
    'can_receive_jobs', v_can_receive
  );
END;
$$;

-- Grant to authenticated only
REVOKE EXECUTE ON FUNCTION public.get_my_partner_membership_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_partner_membership_status() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_partner_membership_status() TO authenticated;
