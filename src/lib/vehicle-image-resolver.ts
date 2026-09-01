import { supabase } from '../lib/supabase';

const BUCKET_NAME = 'vehicle-images';
const PUBLIC_URL_PREFIX = `/storage/v1/object/public/${BUCKET_NAME}/`;
const SIGNED_URL_EXPIRES = 3600;

export function normalizeVehicleImagePath(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const trimmed = value.trim();

  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const idx = url.pathname.indexOf(PUBLIC_URL_PREFIX);
    if (idx === -1) return null;
    const path = decodeURIComponent(url.pathname.substring(idx + PUBLIC_URL_PREFIX.length));
    return path || null;
  } catch {
    return null;
  }
}

export async function createVehicleImageSignedUrl(
  storedValue: string | null | undefined,
  expiresIn: number = SIGNED_URL_EXPIRES,
): Promise<string | null> {
  const path = normalizeVehicleImagePath(storedValue);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
