/*
# Create booking_offers table — Dispatch Engine Sprint 1

## Purpose
Creates the offer-tracking table for the WishWash Dispatch Engine.
This table records which Washer received which booking offer, in which
wave, and the current response state. It supports future wave-based
dispatch without altering the current booking or acceptance flow.

## Important
- This migration does NOT modify any existing table, policy, or function.
- No frontend or edge-function changes are made in this sprint.
- The table is created with RLS enabled and restrictive policies so
  that no current application behaviour changes.
- No screen depends on booking_offers yet.

## New Table: booking_offers

Columns:
1. id            uuid, primary key, default gen_random_uuid()
2. booking_id    uuid, not null — references bookings(id) ON DELETE CASCADE
3. provider_id   uuid, not null — references provider_profiles(id) ON DELETE CASCADE
   (provider_profiles.id is the identifier used by booking assignment
   and ProviderDashboard acceptance logic; bookings.provider_id references
   provider_profiles.id, NOT profiles.id)
4. wave          integer, not null, default 1
5. status        text, not null, default 'pending'
   CHECK constraint limits to:
   pending, accepted, rejected, expired, accepted_elsewhere, cancelled
6. offered_at    timestamptz, not null, default now()
7. expires_at    timestamptz, nullable
8. responded_at  timestamptz, nullable
9. created_at    timestamptz, not null, default now()
10. updated_at   timestamptz, not null, default now()

Constraints:
- Primary key on id
- UNIQUE (booking_id, provider_id) — prevents duplicate offers
- CHECK (status IN allowed values)
- Foreign keys:
  booking_id  → bookings(id) ON DELETE CASCADE
  provider_id → provider_profiles(id) ON DELETE CASCADE

Indexes:
1. idx_booking_offers_provider_status_expires (provider_id, status, expires_at)
2. idx_booking_offers_booking_status (booking_id, status)
3. idx_booking_offers_booking_wave (booking_id, wave)

Trigger:
- trg_booking_offers_updated → update_updated_at() (reuses existing function)

## Security (RLS)
- RLS enabled.
- WASHER SELECT: authenticated user may read only offers where the
  provider_profiles row owned by auth.uid() matches booking_offers.provider_id.
- WASHER UPDATE: authenticated user may update only their own offer,
  and only from 'pending' → 'rejected'. No other status transition is
  allowed from the client.
- No INSERT policy (offers created by server-side dispatch logic only).
- No DELETE policy (client cannot delete offers).
- No customer SELECT policy (customers do not read this table directly).

## Privacy
- No customer location data stored in this table.
- No washer location data stored in this table.
- No historical GPS data stored in this table.
- booking_offers only records offer assignment and response state.
*/

-- ============================================================
-- 1. Create table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.booking_offers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id   uuid        NOT NULL,
  provider_id  uuid        NOT NULL,
  wave         integer     NOT NULL DEFAULT 1,
  status       text        NOT NULL DEFAULT 'pending'
               CHECK (status IN (
                 'pending',
                 'accepted',
                 'rejected',
                 'expired',
                 'accepted_elsewhere',
                 'cancelled'
               )),
  offered_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz,
  responded_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. Foreign keys
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_offers_booking_id_fkey'
      AND conrelid = 'public.booking_offers'::regclass
  ) THEN
    ALTER TABLE public.booking_offers
      ADD CONSTRAINT booking_offers_booking_id_fkey
      FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_offers_provider_id_fkey'
      AND conrelid = 'public.booking_offers'::regclass
  ) THEN
    ALTER TABLE public.booking_offers
      ADD CONSTRAINT booking_offers_provider_id_fkey
      FOREIGN KEY (provider_id) REFERENCES public.provider_profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================
-- 3. Unique constraint — one offer per booking+provider
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'booking_offers_booking_provider_unique'
      AND conrelid = 'public.booking_offers'::regclass
  ) THEN
    ALTER TABLE public.booking_offers
      ADD CONSTRAINT booking_offers_booking_provider_unique
      UNIQUE (booking_id, provider_id);
  END IF;
END $$;

-- ============================================================
-- 4. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_booking_offers_provider_status_expires
  ON public.booking_offers (provider_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_booking_offers_booking_status
  ON public.booking_offers (booking_id, status);

CREATE INDEX IF NOT EXISTS idx_booking_offers_booking_wave
  ON public.booking_offers (booking_id, wave);

-- ============================================================
-- 5. updated_at trigger (reuses existing update_updated_at function)
-- ============================================================
DROP TRIGGER IF EXISTS trg_booking_offers_updated ON public.booking_offers;
CREATE TRIGGER trg_booking_offers_updated
  BEFORE UPDATE ON public.booking_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================================
-- 6. Enable RLS
-- ============================================================
ALTER TABLE public.booking_offers ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 7. RLS Policies
-- ============================================================

-- WASHER SELECT: read only own offers
DROP POLICY IF EXISTS "select_own_booking_offers" ON public.booking_offers;
CREATE POLICY "select_own_booking_offers"
  ON public.booking_offers FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles
      WHERE provider_profiles.id = booking_offers.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
  );

-- WASHER UPDATE: update only own offer, only pending → rejected
DROP POLICY IF EXISTS "update_own_booking_offers" ON public.booking_offers;
CREATE POLICY "update_own_booking_offers"
  ON public.booking_offers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.provider_profiles
      WHERE provider_profiles.id = booking_offers.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.provider_profiles
      WHERE provider_profiles.id = booking_offers.provider_id
        AND provider_profiles.profile_id = auth.uid()
    )
    AND status = 'rejected'
  );

-- No INSERT policy — offers are created by server-side dispatch logic only.
-- No DELETE policy — client cannot delete offers.
-- No customer SELECT policy — customers do not access this table directly.