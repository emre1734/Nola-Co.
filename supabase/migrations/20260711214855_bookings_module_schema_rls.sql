/*
# Bookings module: schema + RLS

## Changes
1. Column changes on `bookings`:
   - `address_id` is now nullable — the booking flow does not require an address yet (Google Maps not implemented).
   - `extra_services` (jsonb, nullable) — stores the list of optional extras selected by the customer.
2. RLS enabled on `bookings` with 4 owner-scoped CRUD policies using `auth.uid() = customer_id`.
3. RLS enabled on `services` with a SELECT policy so authenticated users can browse available services.

## Security
- `bookings` policies enforce `auth.uid() = customer_id` for all CRUD operations.
- `services` SELECT is open to authenticated users (read-only marketplace catalog).
*/

-- ============================================================
-- 1. bookings column changes
-- ============================================================
ALTER TABLE bookings ALTER COLUMN address_id DROP NOT NULL;

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS extra_services jsonb;

-- ============================================================
-- 2. RLS on bookings
-- ============================================================
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bookings_select_own" ON bookings;
CREATE POLICY "bookings_select_own" ON bookings
  FOR SELECT TO authenticated
  USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS "bookings_insert_own" ON bookings;
CREATE POLICY "bookings_insert_own" ON bookings
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "bookings_update_own" ON bookings;
CREATE POLICY "bookings_update_own" ON bookings
  FOR UPDATE TO authenticated
  USING (auth.uid() = customer_id)
  WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "bookings_delete_own" ON bookings;
CREATE POLICY "bookings_delete_own" ON bookings
  FOR DELETE TO authenticated
  USING (auth.uid() = customer_id);

-- ============================================================
-- 3. RLS on services (read-only for authenticated users)
-- ============================================================
ALTER TABLE services ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "services_select_authenticated" ON services;
CREATE POLICY "services_select_authenticated" ON services
  FOR SELECT TO authenticated
  USING (is_active = true);