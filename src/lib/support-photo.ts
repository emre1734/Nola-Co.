import { supabase } from '../lib/supabase';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const RESIZE_MAX_DIM = 1600;
const RESIZE_QUALITY = 0.82;

export const SUPPORT_PHOTO_MAX = 3;

export async function pickSupportPhoto(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.click();
  });
}

export function validateSupportPhoto(file: File): string | null {
  if (!file) return 'No file selected.';
  const type = file.type || '';
  if (!ACCEPTED_TYPES.includes(type)) {
    return 'Unsupported file format. Please choose a JPG, PNG, or WebP image.';
  }
  if (file.size > MAX_FILE_BYTES) {
    return 'Image is too large. Please choose a file under 10 MB.';
  }
  if (file.size === 0) {
    return 'The selected file is empty.';
  }
  return null;
}

async function resizeImage(file: File): Promise<File> {
  if (file.type !== 'image/jpeg' && file.type !== 'image/png' && file.type !== 'image/webp') {
    return file;
  }
  try {
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('read-failed'));
      reader.readAsDataURL(file);
    });
    const img: HTMLImageElement = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('decode-failed'));
      image.src = dataUrl;
    });
    let { width, height } = img;
    if (width <= RESIZE_MAX_DIM && height <= RESIZE_MAX_DIM) {
      return file;
    }
    const scale = RESIZE_MAX_DIM / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, width, height);
    const blob: Blob | null = await new Promise(resolve =>
      canvas.toBlob(resolve, 'image/jpeg', RESIZE_QUALITY),
    );
    if (!blob) return file;
    const outType = blob.type || 'image/jpeg';
    const ext = outType === 'image/png' ? 'png' : outType === 'image/webp' ? 'webp' : 'jpg';
    return new File([blob], `support-${Date.now()}.${ext}`, { type: outType });
  } catch {
    return file;
  }
}

export interface SupportPhotoUploadResult {
  url: string | null;
  path: string | null;
  error: string | null;
}

// Uploads to the existing `job-images` bucket under the customer's own
// folder: {uid}/support/{bookingId}/photo-<timestamp>.<ext>. The existing
// auth-scoped storage policies already permit writes to {uid}/... .
export async function uploadSupportPhoto(
  userId: string,
  bookingId: string,
  file: File,
): Promise<SupportPhotoUploadResult> {
  const resized = await resizeImage(file);
  const ext = (resized.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/support/${bookingId}/photo-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('job-images')
    .upload(path, resized, { upsert: false, contentType: resized.type });

  if (uploadError) {
    console.error('[support-photo] storage upload failed:', {
      code: uploadError.code,
      message: uploadError.message,
      statusCode: (uploadError as { statusCode?: unknown }).statusCode,
      error: String(uploadError),
    });
    return { url: null, path: null, error: uploadError.message };
  }

  const { data } = supabase.storage.from('job-images').getPublicUrl(path);
  return { url: data.publicUrl, path, error: null };
}
