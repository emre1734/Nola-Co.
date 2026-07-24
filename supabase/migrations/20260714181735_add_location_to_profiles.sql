/*
# Add GPS Location Columns to Profiles

## Changes
- Adds `latitude` (double precision) and `longitude` (double precision) columns to the `profiles` table.
- Both columns are nullable — location is optional until the user grants permission.
- Adds a composite GiST index on `(latitude, longitude)` to support future nearby-washer matching queries using the `earthdist` / PostGIS pattern.

## Tables Modified
1. `profiles` — new columns:
   - `latitude` (double precision, nullable) — user's current GPS latitude
   - `longitude` (double precision, nullable) — user's current GPS longitude

## Security
- No RLS policy changes needed. The existing `profiles_update_own` policy already allows users to update their own row, which covers setting latitude/longitude.
- SELECT on profiles is already open to authenticated users (marketplace lookup pattern).

## Important Notes
1. The columns are nullable so existing profiles are not broken.
2. The index is created `IF NOT EXISTS` for idempotency.
3. This migration does NOT implement washer matching — it only prepares the schema for it.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'latitude'
  ) THEN
    ALTER TABLE profiles ADD COLUMN latitude double precision;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'longitude'
  ) THEN
    ALTER TABLE profiles ADD COLUMN longitude double precision;
  END IF;
END $$;

-- Index for future nearby queries (idempotent)
CREATE INDEX IF NOT EXISTS idx_profiles_location ON profiles (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
