/*
# Add permanent public WishWash ID to profiles (re-applied, idempotent)

## Summary
Every registered user receives one permanent, public, immutable WishWash ID
in the format `WW-XXXXXX` (uppercase letters and digits, confusing characters
O/I/L/0/1 excluded). This ID is for support and future platform features and
is NOT the Supabase UUID (which remains internal).

## Changes to `profiles`
1. New column `wishwash_id` (text) — unique, required, immutable.
2. Auto-generated on every new profile insert via a BEFORE INSERT trigger.
3. Backfilled once for all existing profiles that lack one.
4. Locked to NOT NULL after backfill.
5. A BEFORE UPDATE trigger prevents any change to `wishwash_id` (immutability).

## New database functions
- `generate_wishwash_id()` — produces a unique `WW-XXXXXX` string, retrying
  until the value does not already exist in `profiles.wishwash_id`.
- `set_wishwash_id_on_insert()` — trigger function that fills `wishwash_id`
  when a new profile row is inserted without one.
- `prevent_wishwash_id_change()` — trigger function that raises an exception
  if an UPDATE attempts to alter `wishwash_id`.

## Security
- No changes to existing RLS policies. The existing `profiles_update_own`
  policy already scopes updates to `auth.uid() = id`; the immutability trigger
  is a defense-in-depth layer that applies regardless of role.
- `wishwash_id` is public-facing and readable through the existing SELECT
  policy (which already allows authenticated users to view profiles).

## Important notes
1. The Supabase UUID (`profiles.id`) remains the internal primary key and is
   unchanged. `wishwash_id` is a separate, human-readable identifier.
2. The generation function excludes the characters O, I, L, 0, 1 to avoid
   visual confusion.
3. The backfill runs BEFORE the immutability trigger is created, so existing
   rows can be assigned their IDs. The migration is idempotent: it only
   assigns IDs to rows where `wishwash_id IS NULL`.
4. Once NOT NULL is enforced, the insert trigger guarantees every future
   profile gets an ID automatically — the frontend never needs to supply one.
*/

-- ============================================================
-- 1. Add the column (nullable initially for backfill)
-- ============================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wishwash_id text;

-- ============================================================
-- 2. Unique index for uniqueness enforcement
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS profiles_wishwash_id_unique
  ON profiles (wishwash_id);

-- ============================================================
-- 3. Generation function
--    Characters exclude O, I, L, 0, 1 to avoid confusion.
-- ============================================================
CREATE OR REPLACE FUNCTION generate_wishwash_id()
RETURNS text AS $$
DECLARE
  chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text;
  i int;
  attempts int := 0;
BEGIN
  LOOP
    result := 'WW-';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars) + 1)::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM profiles WHERE wishwash_id = result);
    attempts := attempts + 1;
    IF attempts > 100 THEN
      RAISE EXCEPTION 'Could not generate unique wishwash_id after 100 attempts';
    END IF;
  END LOOP;
  RETURN result;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 4. Auto-generate on insert
-- ============================================================
CREATE OR REPLACE FUNCTION set_wishwash_id_on_insert()
RETURNS trigger AS $$
BEGIN
  IF NEW.wishwash_id IS NULL THEN
    NEW.wishwash_id := generate_wishwash_id();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_set_wishwash_id ON profiles;
CREATE TRIGGER profiles_set_wishwash_id
  BEFORE INSERT ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION set_wishwash_id_on_insert();

-- ============================================================
-- 5. Backfill existing profiles (BEFORE immutability trigger)
-- ============================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM profiles WHERE wishwash_id IS NULL LOOP
    UPDATE profiles SET wishwash_id = generate_wishwash_id() WHERE id = r.id;
  END LOOP;
END;
$$;

-- ============================================================
-- 6. Enforce NOT NULL after backfill
-- ============================================================
ALTER TABLE profiles ALTER COLUMN wishwash_id SET NOT NULL;

-- ============================================================
-- 7. Immutability — block any update to wishwash_id
--    Created AFTER backfill so existing rows could be assigned IDs.
-- ============================================================
CREATE OR REPLACE FUNCTION prevent_wishwash_id_change()
RETURNS trigger AS $$
BEGIN
  IF NEW.wishwash_id IS DISTINCT FROM OLD.wishwash_id THEN
    RAISE EXCEPTION 'wishwash_id is immutable and cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_immutable_wishwash_id ON profiles;
CREATE TRIGGER profiles_immutable_wishwash_id
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_wishwash_id_change();
