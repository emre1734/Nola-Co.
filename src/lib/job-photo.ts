import { Capacitor } from '@capacitor/core';
import { Camera } from '@capacitor/camera';
import { supabase } from '../lib/supabase';

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
const RESIZE_MAX_DIM = 1600;
const RESIZE_QUALITY = 0.82;

export async function pickJobPhoto(): Promise<File | null> {
  if (Capacitor.isNativePlatform()) {
    console.log('[job-photo] native camera invoked');
    try {
      const result = await Camera.takePhoto({
        quality: 100,
        saveToGallery: false,
      });
      console.log('[job-photo] takePhoto returned', { hasWebPath: !!result.webPath, type: result.type });
      if (!result.webPath) return null;
      const response = await fetch(result.webPath);
      const blob = await response.blob();
      console.log('[job-photo] blob fetched', { size: blob.size, type: blob.type });
      const mimeType = blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: mimeType });
      console.log('[job-photo] File created', { size: file.size, type: file.type });
      return file;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/cancel|dismiss|aborted/i.test(message)) return null;
      throw error;
    }
  }

  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
    };
    input.click();
  });
}

export function validateJobPhoto(file: File): string | null {
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
    return new File([blob], `before-${Date.now()}.${ext}`, { type: outType });
  } catch {
    return file;
  }
}

export interface JobPhotoUploadResult {
  url: string | null;
  path: string | null;
  error: string | null;
}

export async function uploadJobPhoto(
  userId: string,
  jobId: string,
  file: File,
  kind: 'before' | 'after' = 'before',
): Promise<JobPhotoUploadResult> {
  const resized = await resizeImage(file);
  const ext = (resized.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/${jobId}/${kind}-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('job-images')
    .upload(path, resized, { upsert: false, contentType: resized.type });

  if (uploadError) {
    console.error('[job-photo] storage upload failed:', {
      code: (uploadError as { code?: string }).code,
      message: uploadError.message,
      statusCode: (uploadError as { statusCode?: unknown }).statusCode,
      error: String(uploadError),
      details: (uploadError as { details?: unknown }).details,
      hint: (uploadError as { hint?: unknown }).hint,
    });
    return { url: null, path: null, error: uploadError.message };
  }

  const { data } = supabase.storage.from('job-images').getPublicUrl(path);
  return { url: data.publicUrl, path, error: null };
}
