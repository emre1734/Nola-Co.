/**
 * Sprint 13.2 — Reservation Conflict Engine
 *
 * Centralized service duration estimates (in minutes) and overlap detection
 * for preventing a washer from receiving overlapping bookings.
 */

export const SERVICE_DURATIONS: Record<string, number> = {
  'Exterior Wash': 60,
  'Interior Wash': 60,
  'Interior + Exterior Wash': 120,
};

export function getServiceDuration(serviceName: string | null | undefined): number {
  if (!serviceName) return 60;
  return SERVICE_DURATIONS[serviceName] ?? 60;
}

export interface BookingSlot {
  booking_date: string | null;
  booking_time: string | null;
  service_name: string | null;
}

export interface ActiveBooking {
  id: string;
  booking_date: string | null;
  booking_time: string | null;
  service_name: string | null;
  status: string;
}

export const ACTIVE_STATUSES = [
  'accepted',
  'on_the_way',
  'arrived',
  'started',
  'pending_approval',
];

function parseSlotToMinutes(date: string | null, time: string | null): number | null {
  if (!date || !time) return null;
  const [h, m] = time.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  const d = new Date(`${date}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return d.getTime() / 60000 + h * 60 + m;
}

export function hasConflict(
  requested: BookingSlot,
  existing: ActiveBooking[]
): boolean {
  const reqStart = parseSlotToMinutes(requested.booking_date, requested.booking_time);
  if (reqStart === null) return false;

  const reqDuration = getServiceDuration(requested.service_name);
  const reqEnd = reqStart + reqDuration;

  for (const booking of existing) {
    if (!ACTIVE_STATUSES.includes(booking.status)) continue;

    const existStart = parseSlotToMinutes(booking.booking_date, booking.booking_time);
    if (existStart === null) continue;

    const existDuration = getServiceDuration(booking.service_name);
    const existEnd = existStart + existDuration;

    if (reqStart < existEnd && existStart < reqEnd) {
      return true;
    }
  }

  return false;
}
