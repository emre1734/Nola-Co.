/*
# RLS Policies for Auth Flow

## Changes
- Adds row-level security policies for `profiles` and `provider_profiles` tables.
- Adds storage policies for the `avatars` bucket so authenticated users can upload and read their own avatars.

## Tables Modified
1. `profiles` — users can read/insert/update their own profile row (id = auth.uid())
2. `provider_profiles` — providers can read/insert/update their own extended profile (via join to profiles)
3. Storage `avatars` bucket — authenticated users can upload to their own folder and read all public avatars

## Security
- All policies are scoped to `authenticated` role only.
- Ownership checks use `auth.uid()`.
- SELECT on profiles is slightly relaxed (others can view) to support the marketplace lookup pattern.
*/

-- ============================================================
-- PROFILES
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own" ON profiles
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own" ON profiles
  FOR DELETE TO authenticated
  USING (auth.uid() = id);

-- ============================================================
-- PROVIDER_PROFILES
-- ============================================================
ALTER TABLE provider_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "provider_profiles_select" ON provider_profiles;
CREATE POLICY "provider_profiles_select" ON provider_profiles
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "provider_profiles_insert_own" ON provider_profiles;
CREATE POLICY "provider_profiles_insert_own" ON provider_profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = provider_profiles.profile_id
        AND profiles.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "provider_profiles_update_own" ON provider_profiles;
CREATE POLICY "provider_profiles_update_own" ON provider_profiles
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = provider_profiles.profile_id
        AND profiles.id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = provider_profiles.profile_id
        AND profiles.id = auth.uid()
    )
  );

-- ============================================================
-- STORAGE: avatars bucket policies
-- ============================================================
DROP POLICY IF EXISTS "avatars_select_public" ON storage.objects;
CREATE POLICY "avatars_select_public" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;
CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "avatars_delete_own" ON storage.objects;
CREATE POLICY "avatars_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
