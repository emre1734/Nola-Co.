import { supabase } from '../lib/supabase';

export async function uploadVehicleImage(userId: string, file: File): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${userId}/vehicle-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('vehicle-images')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return { url: null, error: uploadError.message };

  const { data } = supabase.storage.from('vehicle-images').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export { pickImageWeb } from './avatar';
