/*
# Create cancel_booking RPC

## Purpose
Atomic server-side customer booking cancellation. Serializes against
provider_on_my_way using the same SELECT ... FOR UPDATE booking row lock,
so Cancel vs On My Way can never both succeed.

## Product Rule
A customer MAY cancel when:
  1. bookings.status = 'waiting', OR
  2. bookings.status = 'accepted' AND no jobs row exists for the booking.

A customer MUST NOT cancel once travel has started (any jobs row exists).

## New Functions
- public.cancel_booking(p_booking_id uuid) RETURNS jsonb
  - SECURITY DEFINER, search_path = pg_catalog, public
  - Resolves customer identity from auth.uid()
  - Locks the booking row with SELECT FOR UPDATE
  - Validates booking.customer_id = auth.uid()
  - Validates cancellability per the product rule above
  - On success: sets bookings.status = 'cancelled', preserves all other columns
  - Cancels pending/accepted booking_offers in the same transaction
  - Returns structured jsonb: { success, error, booking_id }

## Security
- SECURITY DEFINER so it can read/update bookings and booking_offers
  regardless of RLS.
- REVOKE EXECUTE from PUBLIC and anon; GRANT only to authenticated.
- No RLS policies changed. No schema/enum changes.

## Race Safety
- SELECT ... FOR UPDATE on the booking row is the serialization point.
- provider_on_my_way also uses SELECT ... FOR UPDATE on the same row.
- Exactly one of Cancel / On My Way wins the lock; the other sees the
  committed state and rejects.
*/

CREATE OR REPLACE FUNCTION public.cancel_booking(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_auth_uid uuid := auth.uid();
BEGIN
  -- 1. Require an authenticated user.
  IF v_auth_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'not_authorized',
      'booking_id', null
    );
  END IF;

  -- 2. Lock the booking row for the duration of this transaction.
  --    This is the same serialization point used by provider_on_my_way.
  SELECT id, status, customer_id, provider_id
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  -- 3. Booking not found.
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'booking_not_found',
      'booking_id', null
    );
  END IF;

  -- 4. Verify the caller owns this booking.
  IF v_booking.customer_id IS DISTINCT FROM v_auth_uid THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'not_authorized',
      'booking_id', null
    );
  END IF;

  -- 5. Cancellability check.
  IF v_booking.status = 'waiting' THEN
    -- Case A: waiting bookings are always cancellable.
    NULL;
  ELSIF v_booking.status = 'accepted' THEN
    -- Case B: accepted only if no jobs row exists yet.
    IF EXISTS (
      SELECT 1 FROM public.jobs j WHERE j.booking_id = p_booking_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'not_cancellable',
        'booking_id', p_booking_id::text
      );
    END IF;
  ELSE
    -- Case C: any other status (cancelled, expired, completed, rejected, etc.)
    RETURN jsonb_build_object(
      'success', false,
      'error', 'not_cancellable',
      'booking_id', p_booking_id::text
    );
  END IF;

  -- 6. Cancel the booking. Preserve provider_id and all other columns.
  UPDATE public.bookings
  SET status = 'cancelled',
      updated_at = now()
  WHERE id = p_booking_id;

  -- 7. Cancel open offers (pending or accepted) in the same transaction.
  --    Do not touch already-terminal offers (expired, rejected,
  --    accepted_elsewhere, cancelled).
  UPDATE public.booking_offers
  SET status = 'cancelled',
      responded_at = now(),
      updated_at = now()
  WHERE booking_id = p_booking_id
    AND status IN ('pending', 'accepted');

  -- 8. Success.
  RETURN jsonb_build_object(
    'success', true,
    'error', null,
    'booking_id', p_booking_id::text
  );
END;
$function$;

-- Execution permissions: only authenticated users may call this RPC.
REVOKE EXECUTE ON FUNCTION public.cancel_booking(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_booking(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_booking(uuid) TO authenticated;
