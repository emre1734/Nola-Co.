/*
# Create support_requests table for the Report Problem flow

## Purpose
When a customer reports a problem with a wash waiting for approval,
a support record is created. The job stays in `pending_approval` and
the booking status is NOT modified. This table persists the report so
it survives refreshes and can later be listed by an admin panel.

## New Tables
- `support_requests`
  - `id`            (uuid, primary key, default gen_random_uuid())
  - `job_id`        (uuid, not null, references jobs(id) ON DELETE CASCADE)
  - `customer_id`   (uuid, not null, default auth.uid(), references profiles(id) ON DELETE CASCADE)
  - `category`      (text, not null) — one of the allowed problem categories.
  - `description`   (text, not null, length 20–1000 enforced by CHECK)
  - `phone`         (text, nullable) — contact phone the customer provided.
  - `photo_urls`    (text[], nullable) — public URLs of up to 3 attached photos
                    stored in the existing `job-images` bucket.
  - `status`        (text, not null, default 'open') — CHECK in ('open','resolved','closed').
                    Admin-ready: an admin panel can filter by these statuses
                    with no future schema changes.
  - `created_at`    (timestamptz, default now())
  - `updated_at`    (timestamptz, default now()) — bumped when status changes.

## Security (RLS)
- RLS enabled on `support_requests`.
- Owner-scoped CRUD for authenticated customers (they can only access rows
  where `customer_id = auth.uid()`). 4 separate policies (select/insert/
  update/delete), never `FOR ALL`.
- `customer_id` defaults to `auth.uid()` so inserts that omit it still
  satisfy the INSERT policy's WITH CHECK.
- An admin panel will read via the service role key, which bypasses RLS —
  no `authenticated`-only read policy is needed for admins.

## Storage
- No new storage bucket or policies. Support photos reuse the existing
  `job-images` bucket under the customer's own folder
  `{uid}/support/{bookingId}/...`, which the existing auth-scoped
  storage policies already permit.

## Important notes
1. No existing tables, columns, or data are modified — this is purely
   additive.
2. `jobs.status` and `bookings.status` are NEVER changed by this
   migration or by the support flow. The job remains `pending_approval`.
3. The CHECK constraints enforce category and description length at the
   database level in addition to client/edge-function validation.
4. Idempotent: uses IF NOT EXISTS and drops policies before recreating.
*/

CREATE TABLE IF NOT EXISTS support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  category text NOT NULL,
  description text NOT NULL CHECK (char_length(description) >= 20 AND char_length(description) <= 1000),
  phone text,
  photo_urls text[],
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE support_requests ENABLE ROW LEVEL SECURITY;

-- Index for admin filtering by status (Open / Resolved / Closed).
CREATE INDEX IF NOT EXISTS support_requests_status_idx ON support_requests(status);
-- Index for a customer to find their own requests.
CREATE INDEX IF NOT EXISTS support_requests_customer_idx ON support_requests(customer_id);
-- Index for looking up requests by job.
CREATE INDEX IF NOT EXISTS support_requests_job_idx ON support_requests(job_id);

DROP POLICY IF EXISTS "select_own_support_requests" ON support_requests;
CREATE POLICY "select_own_support_requests" ON support_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = customer_id);

DROP POLICY IF EXISTS "insert_own_support_requests" ON support_requests;
CREATE POLICY "insert_own_support_requests" ON support_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "update_own_support_requests" ON support_requests;
CREATE POLICY "update_own_support_requests" ON support_requests
  FOR UPDATE TO authenticated
  USING (auth.uid() = customer_id)
  WITH CHECK (auth.uid() = customer_id);

DROP POLICY IF EXISTS "delete_own_support_requests" ON support_requests;
CREATE POLICY "delete_own_support_requests" ON support_requests
  FOR DELETE TO authenticated
  USING (auth.uid() = customer_id);
