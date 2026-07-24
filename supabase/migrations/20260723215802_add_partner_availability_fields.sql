/*
# Add availability fields to provider_profiles

## Purpose
Sprint 13.1 — Partner Availability.
Lets each washer define their working days and working hours so the
platform knows when they are available to receive bookings.

## Changes

### New columns on `provider_profiles`
1. `working_days` (text[], default '{}')
   - Array of weekday short codes: 'mon','tue','wed','thu','fri','sat','sun'
   - Empty array by default — partner must select at least one day.
2. `work_start_time` (text, default '09:00')
   - Start of working hours, 24h HH:MM format.
3. `work_end_time` (text, default '18:00')
   - End of working hours, 24h HH:MM format.

### Constraints
- `provider_profiles_work_time_order`: work_end_time > work_start_time
  (enforced via text comparison since HH:MM sorts correctly as text)

### Security
- No new tables. RLS already enabled on provider_profiles.
- Existing owner-scoped policies already cover the new columns.
- No policy changes required.

## Notes
- Migration is idempotent (IF NOT EXISTS checks).
- No data loss: all columns have safe defaults.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_profiles'
      AND column_name = 'working_days'
  ) THEN
    ALTER TABLE public.provider_profiles
      ADD COLUMN working_days text[] NOT NULL DEFAULT '{}';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_profiles'
      AND column_name = 'work_start_time'
  ) THEN
    ALTER TABLE public.provider_profiles
      ADD COLUMN work_start_time text NOT NULL DEFAULT '09:00';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'provider_profiles'
      AND column_name = 'work_end_time'
  ) THEN
    ALTER TABLE public.provider_profiles
      ADD COLUMN work_end_time text NOT NULL DEFAULT '18:00';
  END IF;
END $$;

-- Ensure end time is after start time (HH:MM text comparison works correctly)
ALTER TABLE public.provider_profiles
  DROP CONSTRAINT IF EXISTS provider_profiles_work_time_order;
ALTER TABLE public.provider_profiles
  ADD CONSTRAINT provider_profiles_work_time_order CHECK (work_end_time > work_start_time);
