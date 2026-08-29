/*
# Enforce non-empty provider working_days at database level

## Problem

provider_profiles.working_days defaults to '{}'::text[] and has no CHECK
constraint. A direct API/SQL write could create a provider with zero working
days. That provider would appear registered but be permanently excluded
from find_eligible_providers (ANY('{}') is always false).

## Fix

Add a CHECK constraint requiring at least one element in working_days.
Providers who do not want work use status = 'offline', not empty working_days.

## Not changed

- working_days default (remains '{}'::text[])
- working_days NOT NULL state
- Frontend validation (already blocks zero days in both paths)
- find_eligible_providers
- Working-hours constraints
- RLS / Edge Functions / Storage / bookings / offers
*/

ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_working_days_nonempty
  CHECK (cardinality(working_days) >= 1);
