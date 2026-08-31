/*
# Create get_my_profile() SECURITY DEFINER RPC

## Purpose

Provides a safe, owner-only read path for the authenticated user's full
profile row. This replaces the current direct `profiles.select('*')` read
used by AuthContext, so that a subsequent migration can lock down direct
SELECT access on `public.profiles` without breaking the app's ability to
load the logged-in user's own profile.

## What this migration does

1. Creates `public.get_my_profile()` — a SECURITY DEFINER, STABLE, read-only
   SQL function that returns the caller's own `public.profiles` row.
2. Revokes EXECUTE from PUBLIC and anon so unauthenticated clients cannot
   call it.
3. Grants EXECUTE to authenticated only.

## Security properties

- LANGUAGE sql, STABLE, SECURITY DEFINER
- search_path locked to pg_catalog, public
- Zero parameters — identity is derived solely from auth.uid()
- Returns only the row where id = auth.uid() (zero or one row)
- No dynamic SQL, no writes, no side effects
- EXECUTE granted to authenticated only; revoked from anon and PUBLIC

## What this migration does NOT do

- Does NOT modify any RLS policy on profiles.
- Does NOT modify any table-level or column-level grants on profiles.
- Does NOT modify INSERT/UPDATE/DELETE policies.
- Does NOT touch any other table, view, or function.

## Important notes

1. This function bypasses RLS (SECURITY DEFINER) but only returns the
   caller's own row — it is functionally equivalent to the current
   `select('*').eq('id', auth.uid())` query that AuthContext already uses.
2. The function returns SETOF public.profiles so the supabase-js client
   can use .maybeSingle() for zero-or-one handling.
3. After this migration is applied, AuthContext.fetchProfile() will call
   supabase.rpc('get_my_profile') instead of a direct table SELECT.
*/

-- ── 1. Create the function ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS SETOF public.profiles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  SELECT p.*
  FROM public.profiles AS p
  WHERE p.id = auth.uid();
$$;

-- ── 2. Lock down EXECUTE privileges ──────────────────────────────────

-- Revoke from everyone by default, then grant only to authenticated.
REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_profile() FROM anon;

-- Grant execute to authenticated users only.
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;
