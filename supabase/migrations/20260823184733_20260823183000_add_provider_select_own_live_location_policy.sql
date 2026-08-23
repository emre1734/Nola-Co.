-- Add provider SELECT policy for provider_live_locations
--
-- The provider's UPSERT (INSERT ... ON CONFLICT (booking_id) DO UPDATE)
-- requires SELECT visibility on the target row to evaluate the conflict
-- clause. Without a provider SELECT policy, only customer-only SELECT
-- policies existed, and the ON CONFLICT clause was blocked by RLS —
-- causing "new row violates row-level security policy" on every upsert.
--
-- This policy allows a provider to SELECT only rows whose provider_id
-- matches their own provider_profiles row (provider_profiles.id =
-- provider_live_locations.provider_id AND provider_profiles.profile_id
-- = auth.uid()). It does not grant visibility into other providers' rows.

CREATE POLICY "provider_select_own_live_location"
  ON public.provider_live_locations FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.provider_profiles pp
      WHERE pp.id = provider_live_locations.provider_id
        AND pp.profile_id = auth.uid()
    )
  );
