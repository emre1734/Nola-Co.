/*
# Push notifications: token storage + preferences

## Changes
1. New table `notification_tokens` — stores web push subscription
   endpoints per user/device. Each token is associated with:
   - authenticated user id (user_id)
   - user role at registration time (role)
   - platform (always "web" for this PWA)
   - VAPID endpoint + keys (p256dh, auth)
   - updated timestamp
   A user may have more than one device; inserts are upserted on
   (user_id, endpoint) so signing in on a new device never overwrites
   existing tokens.
2. New column `notifications_enabled` on `profiles` (boolean, default
   true) — master notification preference. When false, the backend
   push function skips sending to that user.
3. New column `notification_language` on `profiles` (text, nullable) —
   the user's preferred notification language. Falls back to English
   when null.

## Security
- `notification_tokens` RLS enabled with owner-scoped CRUD: a user can
  only read/insert/update/delete their own tokens (auth.uid() = user_id).
- `profiles` UPDATE policy already allows users to update their own row,
  so the new columns are covered by the existing policy.
- The edge function uses the service role key, which bypasses RLS, to
  read tokens for push delivery.

## Important Notes
1. Tokens are never overwritten on new sign-in — upsert on
   (user_id, endpoint) preserves other devices.
2. Invalid tokens (410 Gone / 404) are deleted by the edge function
   after a failed push attempt.
3. notifications_enabled defaults to true so existing users keep
   receiving notifications unless they opt out in Settings.
*/

-- ============================================================
-- 1. notification_tokens table
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'customer',
  platform text NOT NULL DEFAULT 'web',
  endpoint text NOT NULL,
  p256dh_key text NOT NULL,
  auth_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, endpoint)
);

ALTER TABLE notification_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notification_tokens_select_own" ON notification_tokens;
CREATE POLICY "notification_tokens_select_own" ON notification_tokens
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_tokens_insert_own" ON notification_tokens;
CREATE POLICY "notification_tokens_insert_own" ON notification_tokens
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_tokens_update_own" ON notification_tokens;
CREATE POLICY "notification_tokens_update_own" ON notification_tokens
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "notification_tokens_delete_own" ON notification_tokens;
CREATE POLICY "notification_tokens_delete_own" ON notification_tokens
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- Index for fast lookup by user
CREATE INDEX IF NOT EXISTS idx_notification_tokens_user_id
  ON notification_tokens (user_id);

-- ============================================================
-- 2. notifications_enabled column on profiles
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'notifications_enabled'
  ) THEN
    ALTER TABLE profiles ADD COLUMN notifications_enabled boolean NOT NULL DEFAULT true;
  END IF;
END $$;

-- ============================================================
-- 3. notification_language column on profiles
-- ============================================================
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'notification_language'
  ) THEN
    ALTER TABLE profiles ADD COLUMN notification_language text;
  END IF;
END $$;