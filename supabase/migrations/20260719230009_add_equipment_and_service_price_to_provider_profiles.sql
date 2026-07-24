/*
# Add equipment + service_price to provider_profiles

## Purpose
Sprint 11.1 — Partner Equipment & Dynamic Pricing.
Lets each partner store the equipment they own and a custom service price
that is gated by their completed-jobs milestone.

## Changes

### New columns on `provider_profiles`
1. `equipment` (text[], default '{}')
   - The set of equipment items a partner owns.
   - Stored as an array of stable string keys (e.g. 'pressure_washer',
     'foam_cannon'). The full catalog is defined in the frontend lib.
   - Empty array by default so new partners start with nothing selected.
2. `service_price` (numeric, default 450, NOT NULL)
   - The partner's current custom service price in TRY.
   - Defaults to 450 (the fixed price for new partners with < 3 jobs).
   - A CHECK constraint enforces the absolute floor of 450 so no partner
     can ever store a price below the platform minimum, regardless of
     milestone. The frontend additionally enforces the tier-specific
     upper bound before saving.

### Constraint
- `provider_profiles_service_price_min`: service_price >= 450.

### Security
- No new tables. RLS already enabled on `provider_profiles`.
- Existing owner-scoped policies (select/insert/update/delete on
  auth.uid() = profile_id) already cover the new columns — partners
  read and update their own equipment/price through the same policy set.
- No policy changes required.

## Notes
- `completed_jobs` already exists and is reused for milestone tiers; no
  duplication.
- Migration is idempotent: uses DO $$ ... IF NOT EXISTS ... END $$ for
  the column adds and drops the CHECK constraint before re-creating it.
- No data loss: both new columns have safe defaults.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_profiles'
      AND column_name = 'equipment'
  ) THEN
    ALTER TABLE public.provider_profiles
      ADD COLUMN equipment text[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_profiles'
      AND column_name = 'service_price'
  ) THEN
    ALTER TABLE public.provider_profiles
      ADD COLUMN service_price numeric NOT NULL DEFAULT 450;
  END IF;
END $$;

-- Absolute platform minimum. Tier-specific upper bounds are enforced in
-- the frontend before the update is sent.
ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_service_price_min;
ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_service_price_min CHECK (service_price >= 450);
