import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type UserRole = 'customer' | 'provider' | 'admin';
export type ProviderStatus = 'offline' | 'available' | 'busy' | 'suspended';
export type BookingStatus = 'waiting' | 'accepted' | 'rejected' | 'cancelled' | 'expired';
export type JobStatus = 'on_the_way' | 'arrived' | 'started' | 'completed' | 'cancelled';
export type PaymentStatus = 'pending' | 'paid' | 'refunded';
export type NotificationType = 'booking' | 'job' | 'payment' | 'system';

export interface Profile {
  id: string;
  wishwash_id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  avatar_url: string | null;
  role: UserRole;
  is_active: boolean | null;
  latitude: number | null;
  longitude: number | null;
  notifications_enabled: boolean | null;
  notification_language: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ProviderProfile {
  id: string;
  profile_id: string;
  status: ProviderStatus | null;
  rating: number | null;
  total_reviews: number | null;
  completed_jobs: number | null;
  cancelled_jobs: number | null;
  service_radius: number | null;
  current_latitude: number | null;
  current_longitude: number | null;
  bio: string | null;
  is_verified: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}
