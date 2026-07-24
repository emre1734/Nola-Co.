/*
# Vehicles module: schema + RLS + storage policies

## Changes
1. Columns added to `vehicles` table:
   - `vehicle_type` (text, nullable) — e.g. Sedan, SUV, Truck, Motorcycle
   - `image_url` (text, nullable) — public URL of the vehicle photo in the `vehicle-images` bucket
   - `brand` (text, nullable) — free-text brand name (e.g. "Toyota") for flexible entry without requiring a row in `vehicle_brands`
   - `model` (text, nullable) — free-text model name (e.g. "Camry") for flexible entry without requiring a row in `vehicle_models`
2. Constraint changes:
   - `brand_id` and `model_id` are now nullable so users can enter brand/model as free text instead of being forced to pick from the (currently empty) `vehicle_models` lookup table.
3. RLS enabled on `vehicles` with 4 owner-scoped CRUD policies (select/insert/update/delete), scoped to `authenticated` using `auth.uid() = profile_id`.
4. Storage policies for the `vehicle-images` bucket:
   - SELECT: any authenticated user can read vehicle images (public bucket)
   - INSERT/UPDATE/DELETE: authenticated users can manage objects under their own folder `vehicle-images/<uid>/`

## Security
- All table policies use `auth.uid()` ownership checks against `profile_id`.
- Storage upload/update/delete policies check `(storage.foldername(name))[1] = auth.uid()::text` so a user can only write to their own folder.
- No `USING (true)` shortcuts — all policies enforce real ownership.
*/

-- ============================================================
-- 1. Add columns to vehicles
-- ============================================================
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_type text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS image_url text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS brand text;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS model text;

-- Make brand_id and model_id nullable so free-text brand/model can be used instead
ALTER TABLE vehicles ALTER COLUMN brand_id DROP NOT NULL;
ALTER TABLE vehicles ALTER COLUMN model_id DROP NOT NULL;

-- ============================================================
-- 2. RLS on vehicles
-- ============================================================
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vehicles_select_own" ON vehicles;
CREATE POLICY "vehicles_select_own" ON vehicles
  FOR SELECT TO authenticated
  USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "vehicles_insert_own" ON vehicles;
CREATE POLICY "vehicles_insert_own" ON vehicles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "vehicles_update_own" ON vehicles;
CREATE POLICY "vehicles_update_own" ON vehicles
  FOR UPDATE TO authenticated
  USING (auth.uid() = profile_id)
  WITH CHECK (auth.uid() = profile_id);

DROP POLICY IF EXISTS "vehicles_delete_own" ON vehicles;
CREATE POLICY "vehicles_delete_own" ON vehicles
  FOR DELETE TO authenticated
  USING (auth.uid() = profile_id);

-- ============================================================
-- 3. Storage policies for vehicle-images bucket
-- ============================================================
DROP POLICY IF EXISTS "vehicle_images_select_public" ON storage.objects;
CREATE POLICY "vehicle_images_select_public" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vehicle-images');

DROP POLICY IF EXISTS "vehicle_images_insert_own" ON storage.objects;
CREATE POLICY "vehicle_images_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'vehicle-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "vehicle_images_update_own" ON storage.objects;
CREATE POLICY "vehicle_images_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'vehicle-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "vehicle_images_delete_own" ON storage.objects;
CREATE POLICY "vehicle_images_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'vehicle-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );