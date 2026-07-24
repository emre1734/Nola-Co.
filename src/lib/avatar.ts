import { supabase } from '../lib/supabase';

export async function uploadAvatar(userId: string, file: File): Promise<{ url: string | null; error: string | null }> {
  const ext = file.name.split('.').pop() ?? 'jpg';
  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(path, file, { upsert: true, contentType: file.type });

  if (uploadError) return { url: null, error: uploadError.message };

  const { data } = supabase.storage.from('avatars').getPublicUrl(path);
  return { url: data.publicUrl, error: null };
}

export function pickImageWeb(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      resolve(file);
    };
    input.click();
  });
}
