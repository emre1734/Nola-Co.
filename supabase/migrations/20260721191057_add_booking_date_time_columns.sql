/*
# Add booking_date and booking_time to bookings

## Changes
1. Add `booking_date` (date, nullable) — the date the customer selected for the wash service.
2. Add `booking_time` (time, nullable) — the 30-minute-interval time slot the customer selected (e.g. 09:30).

## Notes
- Both columns are nullable so existing bookings created before this migration are not affected.
- No new tables are created — these columns reuse the existing `bookings` table.
- RLS policies already exist on `bookings` and do not need changes (the columns are covered by existing owner-scoped CRUD policies).
*/

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_date date;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_time time;