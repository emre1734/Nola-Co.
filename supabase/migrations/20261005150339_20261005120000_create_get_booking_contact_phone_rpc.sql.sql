/*
# Create get_booking_contact_phone SECURITY DEFINER RPC

## Purpose

Allows a customer and their assigned Wash Partner to retrieve each other's
phone number for making a phone call during an active accepted booking.
This is the sole secure contact-access mechanism — it does NOT relax any
existing RLS policies or column grants on profiles.

## What this migration does

Creates `public.get_booking_contact_phone(p_booking_id uuid)` — a SECURITY
DEFINER function that:

1. Looks up the booking by p_booking_id.
2. Requires bookings.status = 'accepted' AND bookings.provider_id IS NOT NULL.
3. Verifies the caller (auth.uid()) is EITHER:
   - the booking customer (bookings.customer_id = auth.uid())
   - OR the assigned provider (provider_profiles.profile_id = auth.uid()
     where provider_profiles.id = bookings.provider_id)
4. If the caller is the customer: returns the assigned provider's phone
   and full_name (resolved through provider_profiles → profiles).
5. If the caller is the assigned provider: returns the booking customer's
   phone and full_name.
6. Returns NULL if any condition fails (booking not found, not accepted,
   no provider, caller is neither participant, stale/reassigned provider).

## Security

- SECURITY DEFINER with fixed search_path = pg_catalog, public
- EXECUTE granted only to authenticated
- Does NOT modify profiles RLS policies or column grants
- Does NOT accept a target user ID or phone number as a parameter
- Contact identity is derived server-side from p_booking_id + auth.uid()
- An old/reassigned provider cannot retrieve customer contact info because
  the function checks the CURRENT bookings.provider_id at call time
- An unrelated authenticated user cannot retrieve contact info because
  the function verifies the caller is a participant of THIS booking

## What this migration does NOT do

- Does NOT modify any existing RLS policies
- Does NOT modify column-level grants on profiles
- Does NOT create any new tables
- Does NOT modify any Edge Functions
*/

CREATE OR REPLACE FUNCTION public.get_booking_contact_phone(
  p_booking_id uuid
)
RETURNS TABLE(phone text, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  SELECT
    b.customer_id::text AS _caller_check,
    NULL::text AS _placeholder
  FROM public.bookings b
  WHERE b.id = p_booking_id
    AND b.status = 'accepted'::booking_status
    AND b.provider_id IS NOT NULL
    AND (
      -- Caller is the customer of this booking
      b.customer_id = auth.uid()
      OR
      -- Caller is the assigned provider for this booking
      EXISTS (
        SELECT 1
        FROM public.provider_profiles pp
        WHERE pp.id = b.provider_id
          AND pp.profile_id = auth.uid()
      )
    )
  LIMIT 1;
$$;

-- The above SELECT is a guard — it only returns a row if the caller is
-- authorized. The actual contact data is returned by the query below,
-- which is only reached if the guard passes. We combine both into a
-- single function using a UNION ALL with the guard as a precondition.

CREATE OR REPLACE FUNCTION public.get_booking_contact_phone(
  p_booking_id uuid
)
RETURNS TABLE(phone text, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $$
  WITH authorized AS (
    SELECT
      b.id,
      b.customer_id,
      b.provider_id
    FROM public.bookings b
    WHERE b.id = p_booking_id
      AND b.status = 'accepted'::booking_status
      AND b.provider_id IS NOT NULL
      AND (
        b.customer_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.provider_profiles pp
          WHERE pp.id = b.provider_id
            AND pp.profile_id = auth.uid()
        )
      )
    LIMIT 1
  )
  -- Case A: caller is the customer → return the provider's phone
  SELECT
    p.phone,
    p.full_name
  FROM authorized a
  JOIN public.provider_profiles pp ON pp.id = a.provider_id
  JOIN public.profiles p ON p.id = pp.profile_id
  WHERE a.customer_id = auth.uid()

  UNION ALL

  -- Case B: caller is the assigned provider → return the customer's phone
  SELECT
    p.phone,
    p.full_name
  FROM authorized a
  JOIN public.profiles p ON p.id = a.customer_id
  WHERE EXISTS (
    SELECT 1
    FROM public.provider_profiles pp
    WHERE pp.id = a.provider_id
      AND pp.profile_id = auth.uid()
  )

  LIMIT 1;
$$;

-- Lock down EXECUTE: authenticated only
REVOKE ALL ON FUNCTION public.get_booking_contact_phone(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_booking_contact_phone(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_booking_contact_phone(uuid) TO authenticated;
