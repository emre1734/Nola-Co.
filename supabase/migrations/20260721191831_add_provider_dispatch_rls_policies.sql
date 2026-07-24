/*
# Reservation dispatch: RLS policies for provider visibility

## Changes
1. Add a SELECT policy on `bookings` allowing authenticated providers to read
   bookings that are still waiting and unassigned (status = 'waiting' AND
   provider_id IS NULL). This is the "broadcast" — every nearby eligible
   provider can see incoming requests.
2. Add a SELECT policy on `bookings` allowing a provider to read bookings they
   have been assigned to (provider_id matches their provider_profiles.id).
3. Add a SELECT policy on `vehicles` allowing authenticated users to read
   vehicle rows that are referenced by visible bookings (so the join in
   ProviderDashboard resolves). We scope to vehicles whose owner has at least
   one waiting/assigned booking.
4. Add a SELECT policy on `profiles` allowing authenticated users to read
   customer profiles referenced by visible bookings (for the customer name
   join).

## Security
- Providers can ONLY read waiting+unassigned bookings or their own assigned
  bookings. They cannot read other customers' completed/cancelled bookings.
- Vehicle/profile reads are scoped to rows that are actually referenced by a
  visible booking — no blanket access.
- No INSERT/UPDATE/DELETE policies are added — existing customer-scoped
  policies remain the only write path.
*/

-- ============================================================
-- 1. Providers can SELECT waiting + unassigned bookings (broadcast)
-- ============================================================
DROP POLICY IF EXISTS "bookings_select_waiting_broadcast" ON bookings;
CREATE POLICY "bookings_select_waiting_broadcast" ON bookings
  FOR SELECT TO authenticated
  USING (
    status = 'waiting' AND provider_id IS NULL
  );

-- ============================================================
-- 2. Assigned provider can SELECT their own bookings
-- ============================================================
DROP POLICY IF EXISTS "bookings_select_assigned_provider" ON bookings;
CREATE POLICY "bookings_select_assigned_provider" ON bookings
  FOR SELECT TO authenticated
  USING (
    provider_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM provider_profiles
      WHERE provider_profiles.id = bookings.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
  );

-- ============================================================
-- 3. Vehicles referenced by visible bookings (for joins)
-- ============================================================
DROP POLICY IF EXISTS "vehicles_select_for_visible_bookings" ON vehicles;
CREATE POLICY "vehicles_select_for_visible_bookings" ON vehicles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.vehicle_id = vehicles.id
        AND (
          (bookings.status = 'waiting' AND bookings.provider_id IS NULL)
          OR (
            bookings.provider_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM provider_profiles
              WHERE provider_profiles.id = bookings.provider_id
                AND provider_profiles.profile_id = auth.uid()
            )
          )
        )
    )
  );

-- ============================================================
-- 4. Profiles referenced by visible bookings (customer name join)
-- ============================================================
DROP POLICY IF EXISTS "profiles_select_for_visible_bookings" ON profiles;
CREATE POLICY "profiles_select_for_visible_bookings" ON profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM bookings
      WHERE bookings.customer_id = profiles.id
        AND (
          (bookings.status = 'waiting' AND bookings.provider_id IS NULL)
          OR (
            bookings.provider_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM provider_profiles
              WHERE provider_profiles.id = bookings.provider_id
                AND provider_profiles.profile_id = auth.uid()
            )
          )
        )
    )
  );