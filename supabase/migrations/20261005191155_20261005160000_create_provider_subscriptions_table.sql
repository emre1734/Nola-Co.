/*
# Create provider_subscriptions table for Wash Partner membership

## Purpose
Stores Google Play subscription entitlement data for Wash Partners.
This is the authoritative source for membership state. Only server-side
Edge Functions (service role) may write to this table. The frontend
can read a limited safe subset via the get_my_partner_membership_status
RPC — purchase_token is never exposed to the client.

## New Table: provider_subscriptions
- id (uuid PK)
- provider_profile_id (uuid FK → provider_profiles.id ON DELETE CASCADE)
- product_id (text) — Google Play subscription product ID
- purchase_token (text, UNIQUE) — Google Play purchase token for verification
- state (text) — active | grace_period | on_hold | paused | expired | canceled
- expiry_time (timestamptz, nullable) — verified expiry from Google Play
- auto_renew (boolean, default true) — Google Play autoRenewing flag
- last_verified_at (timestamptz) — last Google Play Developer API verification
- last_rtdn_type (text, nullable) — last RTDN notification type
- created_at, updated_at (timestamptz)

## Security — RLS enabled
- SELECT: provider can read ONLY their own rows (via profile_id link)
  BUT purchase_token is excluded from client access via column-level
  privileges — only the safe RPC exposes membership status.
- No INSERT/UPDATE/DELETE for authenticated or anon.
  All mutations go through Edge Functions using service role.

## Indexes
- idx_provider_subs_profile (provider_profile_id) — entitlement lookups
- idx_provider_subs_active (provider_profile_id) WHERE state IN ('active','grace_period')
- unique on purchase_token
*/

CREATE TABLE IF NOT EXISTS public.provider_subscriptions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_profile_id uuid NOT NULL REFERENCES public.provider_profiles(id) ON DELETE CASCADE,
  product_id          text NOT NULL,
  purchase_token      text NOT NULL,
  state               text NOT NULL DEFAULT 'active',
  expiry_time         timestamptz,
  auto_renew          boolean NOT NULL DEFAULT true,
  last_verified_at    timestamptz NOT NULL DEFAULT now(),
  last_rtdn_type      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provider_subscriptions_purchase_token_unique UNIQUE (purchase_token)
);

-- Index for entitlement lookups by provider
CREATE INDEX IF NOT EXISTS idx_provider_subs_profile
  ON public.provider_subscriptions(provider_profile_id);

-- Index for active/grace_period lookups (the only states that grant access)
CREATE INDEX IF NOT EXISTS idx_provider_subs_active
  ON public.provider_subscriptions(provider_profile_id)
  WHERE state IN ('active', 'grace_period');

-- updated_at trigger (reuse existing update_updated_at if present, else create)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_provider_subscriptions_updated'
  ) THEN
    CREATE TRIGGER trg_provider_subscriptions_updated
      BEFORE UPDATE ON public.provider_subscriptions
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
  END IF;
END $$;

-- Enable RLS
ALTER TABLE public.provider_subscriptions ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (idempotent)
DROP POLICY IF EXISTS "select_own_subscriptions" ON public.provider_subscriptions;
DROP POLICY IF EXISTS "insert_own_subscriptions" ON public.provider_subscriptions;
DROP POLICY IF EXISTS "update_own_subscriptions" ON public.provider_subscriptions;
DROP POLICY IF EXISTS "delete_own_subscriptions" ON public.provider_subscriptions;

-- SELECT: provider can read their own rows (for UI display of safe fields)
-- purchase_token is further protected by column-level REVOKE below
CREATE POLICY "select_own_subscriptions"
  ON public.provider_subscriptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles pp
      WHERE pp.id = provider_subscriptions.provider_profile_id
        AND pp.profile_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies — only service role can mutate
-- (service role bypasses RLS)

-- Revoke all DML from anon
REVOKE ALL ON public.provider_subscriptions FROM anon;

-- Grant only SELECT to authenticated (RLS scopes it to own rows)
GRANT SELECT ON public.provider_subscriptions TO authenticated;

-- Hide purchase_token from authenticated and anon (column-level)
-- Only service role can read it
REVOKE ALL (purchase_token) ON public.provider_subscriptions FROM authenticated;
REVOKE ALL (purchase_token) ON public.provider_subscriptions FROM anon;
