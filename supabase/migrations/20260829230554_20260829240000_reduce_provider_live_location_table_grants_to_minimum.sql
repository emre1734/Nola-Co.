/*
# Reduce Table Grants on provider_live_locations to Minimum Required

## Problem
`provider_live_locations` currently grants ALL 7 privileges to both
`anon` and `authenticated`. The authorization contract only requires:

- authenticated: SELECT (customer tracking + provider own-location read),
  INSERT (new location row), UPDATE (upsert on conflict)
- anon: nothing (this table is only accessed by signed-in users)
- service_role / postgres: unchanged

DELETE, TRUNCATE, REFERENCES, and TRIGGER are not needed by any runtime
operation:
- DELETE: no frontend caller, no DELETE RLS policy
- TRUNCATE: not used by application runtime
- REFERENCES: only needed for creating FK constraints, not runtime
- TRIGGER: only needed for creating triggers; the existing RI triggers
  are system-generated and fire automatically regardless of caller
  TRIGGER privilege

## Fix
1. REVOKE ALL on provider_live_locations FROM anon
   → anon ends with zero privileges
2. REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER FROM authenticated
   → authenticated keeps SELECT, INSERT, UPDATE only
3. service_role and postgres grants: untouched

## What Does NOT Change
- No RLS policies modified
- No table schema, constraints, or foreign keys modified
- No data rows modified
- No frontend or GPS code changes
- No Edge Functions or Realtime changes
*/

-- =========================================================
-- 1. Revoke ALL from anon
-- =========================================================

REVOKE ALL ON TABLE public.provider_live_locations FROM anon;

-- =========================================================
-- 2. Revoke unneeded privileges from authenticated
-- =========================================================

REVOKE DELETE ON TABLE public.provider_live_locations FROM authenticated;
REVOKE TRUNCATE ON TABLE public.provider_live_locations FROM authenticated;
REVOKE REFERENCES ON TABLE public.provider_live_locations FROM authenticated;
REVOKE TRIGGER ON TABLE public.provider_live_locations FROM authenticated;

-- SELECT, INSERT, UPDATE remain granted to authenticated.
