/*
# Create booking_rejections table

1. Purpose
- Allows a Wash Partner (provider) to reject a pending booking request for
  themselves only. The booking's global status is NOT changed — it remains
  "waiting" and visible to other eligible providers. The rejection is
  persisted so the same booking does not reappear for the rejecting provider
  after refresh, logout/login, or app restart.

2. New Tables
- `booking_rejections`
  - `id` (uuid, primary key)
  - `booking_id` (uuid, not null, references bookings(id) ON DELETE CASCADE)
  - `provider_id` (uuid, not null, references provider_profiles(id) ON DELETE CASCADE)
  - `rejected_at` (timestamptz, default now())
  - UNIQUE constraint on (booking_id, provider_id) so a provider can reject a
    given booking only once.

3. Security (RLS)
- Enable RLS on `booking_rejections`.
- SELECT: a provider can read only their own rejections.
- INSERT: a provider can insert only their own rejections.
- UPDATE/DELETE: a provider can modify only their own rejections (not used
  by the app today, but included for completeness and safety).

4. Indexes
- Index on `provider_id` for fast lookups when filtering pending bookings.
- Index on `booking_id` for fast cascade checks.

5. Important notes
- The bookings table is NOT modified. Booking status stays untouched.
- Other providers are unaffected — they can still see and accept the booking.
- Rejections are scoped per-provider via RLS using auth.uid() matched
  against provider_profiles.profile_id.
*/

CREATE TABLE IF NOT EXISTS booking_rejections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES provider_profiles(id) ON DELETE CASCADE,
  rejected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_rejections_booking_provider_unique UNIQUE (booking_id, provider_id)
);

ALTER TABLE booking_rejections ENABLE ROW LEVEL SECURITY;

-- A provider may read only their own rejections.
DROP POLICY IF EXISTS "select_own_rejections" ON booking_rejections;
CREATE POLICY "select_own_rejections" ON booking_rejections
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider_profiles
      WHERE provider_profiles.id = booking_rejections.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
  );

-- A provider may insert only their own rejections.
DROP POLICY IF EXISTS "insert_own_rejections" ON booking_rejections;
CREATE POLICY "insert_own_rejections" ON booking_rejections
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider_profiles
      WHERE provider_profiles.id = booking_rejections.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
  );

-- A provider may update only their own rejections.
DROP POLICY IF EXISTS "update_own_rejections" ON booking_rejections;
CREATE POLICY "update_own_rejections" ON booking_rejections
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider_profiles
      WHERE provider_profiles.id = booking_rejections.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM provider_profiles
      WHERE provider_profiles.id = booking_rejections.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
  );

-- A provider may delete only their own rejections.
DROP POLICY IF EXISTS "delete_own_rejections" ON booking_rejections;
CREATE POLICY "delete_own_rejections" ON booking_rejections
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM provider_profiles
      WHERE provider_profiles.id = booking_rejections.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS idx_booking_rejections_provider_id
  ON booking_rejections(provider_id);

CREATE INDEX IF NOT EXISTS idx_booking_rejections_booking_id
  ON booking_rejections(booking_id);
