import { supabase } from '../lib/supabase';

export async function uploadVehicleImage(userId: string, file: File): Promise<{ path: string | null; error: string | null }> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${userId}/vehicle-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('vehicle-images')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return { path: null, error: uploadError.message };

  return { path, error: null };
}

export { pickImageWeb } from './avatar';
