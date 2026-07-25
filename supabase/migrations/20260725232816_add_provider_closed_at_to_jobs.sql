/*
# Add provider_closed_at to jobs

1. Purpose
   Allows a Washer to acknowledge a customer-approved completed job and
   clear it from their active dashboard. The booking stays "accepted"
   (booking_status has no "completed" value) and the job stays
   "completed" — only a new timestamp marks the Washer's acknowledgement.

2. Changes
   - jobs.provider_closed_at (timestamptz, nullable). Set to now() when
     the Washer presses "Close Job". NULL means the completed job is still
     visible on the dashboard.

3. Data safety
   - Additive only. No existing columns are changed, renamed, or dropped.
   - No data is deleted or rewritten.
   - Existing jobs (completed or otherwise) get NULL and remain visible
     until the Washer explicitly closes them.

4. Security
   - RLS already enabled on jobs. No policy changes needed: writes go
     through the job-progress edge function (service role), and the new
     column is only ever set server-side.
*/

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS provider_closed_at timestamptz;
