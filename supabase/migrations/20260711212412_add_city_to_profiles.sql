/*
# Add city column to profiles

## Changes
- Adds `city` text column to `profiles` table to support the Complete Profile onboarding step.

## Security
- No RLS policy changes needed; existing policies cover the new column.
*/

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS city text;