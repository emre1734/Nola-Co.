/*
# Add Location Columns to Bookings Table

## Changes
- Adds `latitude` (double precision), `longitude` (double precision), and `address` (text) columns to the `bookings` table.
- These columns store the GPS coordinates and reverse-geocoded address of the service location selected by the customer during the booking flow.
- All three columns are nullable — existing bookings are not affected.

## Tables Modified
1. `bookings` — new columns:
   - `latitude` (double precision, nullable) — service location latitude
   - `longitude` (double precision, nullable) — service location longitude
   - `address` (text, nullable) — full reverse-geocoded address string

## Security
- No RLS policy changes needed. The existing booking policies already cover INSERT/UPDATE by the customer.
- The new columns are accessible through the existing `bookings_insert_own` / `bookings_update_own` policies.

## Important Notes
1. The existing `address_id` FK column remains for backward compatibility.
2. The new `latitude`/`longitude` columns enable future nearby-washer matching and route calculations.
3. The `address` text column stores the formatted address string from Google Maps reverse geocoding.
4. All columns are nullable so existing bookings are not broken.
*/

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'latitude'
  ) THEN
    ALTER TABLE bookings ADD COLUMN latitude double precision;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'longitude'
  ) THEN
    ALTER TABLE bookings ADD COLUMN longitude double precision;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'address'
  ) THEN
    ALTER TABLE bookings ADD COLUMN address text;
  END IF;
END $$;

-- Index for future spatial queries on bookings
CREATE INDEX IF NOT EXISTS idx_bookings_location ON bookings (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
