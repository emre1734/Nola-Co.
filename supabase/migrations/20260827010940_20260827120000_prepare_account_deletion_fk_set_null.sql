/*
# Account Deletion Schema Preparation — FK CASCADE → SET NULL

## Purpose
This migration prepares the database so that a FUTURE account-deletion flow
can genuinely delete auth.users rows while preserving the OTHER party's
completed booking/job history.

Today, several foreign keys on `bookings` and `jobs` use ON DELETE CASCADE.
If a user's auth.users row is deleted, the cascade chain destroys every
booking, job, review, and transaction associated with that user — including
records that the OTHER party (customer or provider) legitimately needs for
their service history.

This migration changes the minimum set of foreign keys from CASCADE to
SET NULL so that completed historical records survive user deletion.

## What This Migration Does

### A. Make 4 columns nullable (DROP NOT NULL)
1. `bookings.customer_id` — so it can be SET NULL when the customer's profile is deleted
2. `bookings.vehicle_id` — so it can be SET NULL when the customer's vehicle is deleted
3. `jobs.customer_id` — so it can be SET NULL when the customer's profile is deleted
4. `jobs.provider_id` — so it can be SET NULL when the provider's profile is deleted

Note: `bookings.address_id` is already nullable — no change needed.

### B. Change 5 foreign keys from ON DELETE CASCADE to ON DELETE SET NULL
1. `bookings_customer_id_fkey` — bookings.customer_id → profiles(id)
2. `bookings_address_id_fkey` — bookings.address_id → addresses(id)
3. `bookings_vehicle_id_fkey` — bookings.vehicle_id → vehicles(id)
4. `jobs_customer_id_fkey` — jobs.customer_id → profiles(id)
5. `jobs_provider_id_fkey` — jobs.provider_id → provider_profiles(id)

All other FK properties (referenced table/column, ON UPDATE NO ACTION,
NOT DEFERRABLE) are preserved.

## What This Migration Does NOT Do
- Does NOT add any new columns (no snapshot columns, no deletion_requested_at)
- Does NOT create any RPC or Edge Function
- Does NOT modify any RLS policies
- Does NOT modify any existing data rows
- Does NOT change any active workflow code
- Does NOT implement account deletion

## Safety
- No rows are updated, deleted, or inserted.
- Existing UUID values in customer_id, provider_id, vehicle_id, address_id
  remain completely unchanged.
- This is schema preparation only — the actual deletion flow comes later.

## Important Notes
1. After this migration, deleting a profile row will SET NULL the
   customer_id/provider_id on retained bookings/jobs instead of
   cascade-deleting them.
2. Active workflows are NOT affected because account deletion will be
   BLOCKED for all active lifecycle states (accepted, on_the_way, arrived,
   started, pending_approval).
3. The non-deleted party can still access their completed job history
   through their own ownership-scoped RLS policies.
4. `bookings.provider_id` FK was already ON DELETE SET NULL — unchanged.
5. `jobs.booking_id` FK remains ON DELETE CASCADE — unchanged. This is safe
   because bookings survive (all paths into bookings are now SET NULL).
*/

-- ============================================================
-- A. Make 4 columns nullable
-- ============================================================

ALTER TABLE public.bookings ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN vehicle_id DROP NOT NULL;
ALTER TABLE public.jobs ALTER COLUMN customer_id DROP NOT NULL;
ALTER TABLE public.jobs ALTER COLUMN provider_id DROP NOT NULL;

-- ============================================================
-- B. Change 5 FK constraints from CASCADE to SET NULL
-- ============================================================

-- 1. bookings.customer_id → profiles(id)
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_customer_id_fkey,
  ADD CONSTRAINT bookings_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.profiles(id)
    ON DELETE SET NULL ON UPDATE NO ACTION NOT DEFERRABLE;

-- 2. bookings.address_id → addresses(id)
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_address_id_fkey,
  ADD CONSTRAINT bookings_address_id_fkey
    FOREIGN KEY (address_id) REFERENCES public.addresses(id)
    ON DELETE SET NULL ON UPDATE NO ACTION NOT DEFERRABLE;

-- 3. bookings.vehicle_id → vehicles(id)
ALTER TABLE public.bookings
  DROP CONSTRAINT bookings_vehicle_id_fkey,
  ADD CONSTRAINT bookings_vehicle_id_fkey
    FOREIGN KEY (vehicle_id) REFERENCES public.vehicles(id)
    ON DELETE SET NULL ON UPDATE NO ACTION NOT DEFERRABLE;

-- 4. jobs.customer_id → profiles(id)
ALTER TABLE public.jobs
  DROP CONSTRAINT jobs_customer_id_fkey,
  ADD CONSTRAINT jobs_customer_id_fkey
    FOREIGN KEY (customer_id) REFERENCES public.profiles(id)
    ON DELETE SET NULL ON UPDATE NO ACTION NOT DEFERRABLE;

-- 5. jobs.provider_id → provider_profiles(id)
ALTER TABLE public.jobs
  DROP CONSTRAINT jobs_provider_id_fkey,
  ADD CONSTRAINT jobs_provider_id_fkey
    FOREIGN KEY (provider_id) REFERENCES public.provider_profiles(id)
    ON DELETE SET NULL ON UPDATE NO ACTION NOT DEFERRABLE;
