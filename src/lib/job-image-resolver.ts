import { supabase } from '../lib/supabase';

const BUCKET_NAME = 'job-images';
const PUBLIC_URL_PREFIX = `/storage/v1/object/public/${BUCKET_NAME}/`;
const SIGNED_URL_EXPIRES = 3600;

export function normalizeJobImagePath(value: string | null | undefined): string | null {
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

export async function createJobImageSignedUrl(
  storedValue: string | null | undefined,
  expiresIn: number = SIGNED_URL_EXPIRES,
): Promise<string | null> {
  const path = normalizeJobImagePath(storedValue);
  if (!path) return null;

  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

export async function resolveJobImages<
  T extends { id: string; before_photo_url: string | null; after_photo_url: string | null },
>(jobs: T[]): Promise<Map<string, { before: string | null; after: string | null }>> {
  const map = new Map<string, { before: string | null; after: string | null }>();
  await Promise.all(
    jobs.map(async (job) => {
      const [before, after] = await Promise.all([
        createJobImageSignedUrl(job.before_photo_url),
        createJobImageSignedUrl(job.after_photo_url),
      ]);
      map.set(job.id, { before, after });
    }),
  );
  return map;
}
