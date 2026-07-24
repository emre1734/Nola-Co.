/*
# Add before/after photo columns to jobs + job-images storage policies

## Changes
1. New columns on `jobs` (both nullable, no default):
   - `before_photo_url` (text) — public URL of the partner's before-wash photo in the `job-images` bucket.
   - `after_photo_url`  (text) — public URL of the partner's after-wash photo in the `job-images` bucket (added now for symmetry; not used by this task).
2. Storage policies for the existing `job-images` bucket:
   - SELECT: any authenticated user can read job images (public bucket).
   - INSERT/UPDATE/DELETE: authenticated users can manage objects under their own folder `job-images/<uid>/`.

## Security
- No existing columns or data are modified; both new columns are nullable additions.
- Storage upload/update/delete policies check `(storage.foldername(name))[1] = auth.uid()::text` so a partner can only write to their own folder, matching the existing `vehicle-images` pattern.
- No `USING (true)` shortcuts — all policies enforce real ownership.
- The `jobs` table RLS setup is intentionally left unchanged. The `jobs` table has RLS enabled with no client-facing policies; job mutations continue to go through the `job-progress` edge function using the service role key. The new `before_photo_url` is written by the edge function, not by the client.
*/

-- ============================================================
-- 1. Add nullable photo columns to jobs
-- ============================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS before_photo_url text;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS after_photo_url text;

-- ============================================================
-- 2. Storage policies for the existing job-images bucket
-- ============================================================
DROP POLICY IF EXISTS "job_images_select_public" ON storage.objects;
CREATE POLICY "job_images_select_public" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'job-images');

DROP POLICY IF EXISTS "job_images_insert_own" ON storage.objects;
CREATE POLICY "job_images_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'job-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "job_images_update_own" ON storage.objects;
CREATE POLICY "job_images_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'job-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'job-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "job_images_delete_own" ON storage.objects;
CREATE POLICY "job_images_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'job-images'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
