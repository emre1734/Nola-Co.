/*
# Close profiles cross-user PII exposure

## Purpose

Closes a HIGH privacy vulnerability where any authenticated user could read
sensitive PII (email, phone, latitude, longitude, role, etc.) from other
users' profile rows via direct table SELECT.

## What this migration does

### A. SECURITY DEFINER relationship helper

Creates `public.provider_can_view_customer_profile(p_customer_id uuid)` — a
STABLE, SECURITY DEFINER boolean function that returns TRUE only when the
caller (derived from auth.uid()) has a legitimate provider relationship with
the given customer:

  CASE 1 — Assigned provider: caller's provider_profiles row is the
           provider_id on any booking for this customer (covers active,
           accepted, and historical/recent-job relationships).

  CASE 2 — Pending offer: caller has a pending, unexpired booking_offer on
           a waiting, unassigned booking for this customer.

The function bypasses RLS (SECURITY DEFINER) so it can see booking/offer rows
regardless of the caller's direct RLS visibility on those tables. It returns
only a boolean — no PII is leaked through the function.

### B. Replace broad profiles SELECT policies

DROPS:
  - profiles_select_own (was USING(true) — exposed ALL profiles to ALL
    authenticated users)
  - profiles_select_for_visible_bookings (exposed customer profiles to any
    authenticated user when booking was waiting/unassigned)

CREATES:
  - profiles_select_own: auth.uid() = id (owner can see own row)
  - profiles_select_for_provider_relationship: calls the helper function
    to allow only assigned providers and providers with valid pending offers

### C. Column-level SELECT privileges

REVOKES table-level SELECT from authenticated.
GRANTS SELECT (id, full_name) only — the only columns needed for cross-user
display (ProviderDashboard embedded joins request only full_name).

Sensitive columns (email, phone, latitude, longitude, role, is_active, city,
avatar_url, wishwash_id, notifications_enabled, notification_language) are
no longer directly selectable by authenticated clients.

The existing get_my_profile() SECURITY DEFINER RPC continues to return the
caller's full own profile independently of these column grants.

## What this migration does NOT do

- Does NOT modify INSERT/UPDATE/DELETE policies on profiles.
- Does NOT modify UPDATE/INSERT/DELETE grants on profiles.
- Does NOT modify get_my_profile().
- Does NOT modify any other table's policies or grants.
- Does NOT modify any frontend code.
- Does NOT modify anon grants (backlog item).

## Important notes

1. The helper function is SECURITY DEFINER to avoid cross-table RLS
   visibility issues. RLS policies on bookings/booking_offers/provider_profiles
   may restrict what the caller can see, which would silently break
   inline subquery logic in the RLS policy. The helper bypasses RLS on
   those tables but returns only a boolean.

2. The assigned-provider branch (CASE 1) does not filter by booking status.
   This is intentional: ProviderDashboard recent-jobs display needs
   customer full_name for historical jobs, which are linked through
   completed bookings where the provider was assigned.

3. Column-level SELECT on only (id, full_name) is safe for PostgREST
   embedded joins. ProviderDashboard queries like
   `profiles!bookings_customer_id_fkey(full_name)` select only full_name,
   which remains granted. The conflict target for UPSERT is the primary
   key (id), which also remains granted.

4. INSERT and UPDATE table-level grants are preserved. Onboarding UPSERTs
   and profile/location UPDATEs continue to work because:
   - INSERT privilege: unchanged (table-level)
   - UPDATE privilege: unchanged (table-level)
   - ON CONFLICT (id) requires SELECT on id: granted
   - RETURNING clause: PostgREST only returns columns with SELECT privilege
*/

-- ══════════════════════════════════════════════════════════════════
-- A. SECURITY DEFINER RELATIONSHIP HELPER
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.provider_can_view_customer_profile(
  p_customer_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  SELECT
    -- CASE 1: Caller is the assigned provider for any booking
    --         where this user is the customer.
    EXISTS (
      SELECT 1
      FROM public.provider_profiles AS pp
      JOIN public.bookings AS b ON b.provider_id = pp.id
      WHERE pp.profile_id = auth.uid()
        AND b.customer_id = p_customer_id
    )
    OR
    -- CASE 2: Caller has a pending, unexpired offer on a waiting,
    --         unassigned booking for this customer.
    EXISTS (
      SELECT 1
      FROM public.provider_profiles AS pp
      JOIN public.booking_offers AS bo ON bo.provider_id = pp.id
      JOIN public.bookings AS b ON b.id = bo.booking_id
      WHERE pp.profile_id = auth.uid()
        AND b.customer_id = p_customer_id
        AND b.status = 'waiting'::booking_status
        AND b.provider_id IS NULL
        AND bo.status = 'pending'
        AND bo.expires_at > now()
    );
$$;

-- Lock down EXECUTE: authenticated only
REVOKE ALL ON FUNCTION public.provider_can_view_customer_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_can_view_customer_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.provider_can_view_customer_profile(uuid) TO authenticated;

-- ══════════════════════════════════════════════════════════════════
-- B. REPLACE PROFILES SELECT POLICIES
-- ══════════════════════════════════════════════════════════════════

-- Drop the broad/unsafe SELECT policies
DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_select_for_visible_bookings ON public.profiles;

-- 1. Owner can see own row
CREATE POLICY profiles_select_own
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- 2. Provider with legitimate relationship can see customer's row
CREATE POLICY profiles_select_for_provider_relationship
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.provider_can_view_customer_profile(public.profiles.id));

-- ══════════════════════════════════════════════════════════════════
-- C. COLUMN-LEVEL SELECT PRIVILEGES
-- ══════════════════════════════════════════════════════════════════

-- Revoke table-level SELECT from authenticated
REVOKE SELECT ON TABLE public.profiles FROM authenticated;

-- Grant column-level SELECT on only safe display columns
GRANT SELECT (id, full_name) ON TABLE public.profiles TO authenticated;
