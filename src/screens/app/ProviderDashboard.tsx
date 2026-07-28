import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Linking,
  Image,
  ActivityIndicator,
} from 'react-native';
import { Avatar, EmptyState, ErrorState, Loading } from '../../components/ui';
import { Modal } from '../../components/ui/Modal';
import { EquipmentAndPricing } from '../../components/EquipmentAndPricing';
import { AvailabilityCard } from '../../components/AvailabilityCard';
import { hasConflict, ACTIVE_STATUSES, type ActiveBooking } from '../../lib/booking-conflict';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, typography, radii } from '../../theme';
import {
  pickJobPhoto,
  validateJobPhoto,
  uploadJobPhoto,
} from '../../lib/job-photo';
import { useTranslation } from '../../i18n/useTranslation';

interface ProviderDashboardProps {
  onBack: () => void;
  onSignOut: () => void;
}

interface ProviderStats {
  completed_jobs: number | null;
  rating: number | null;
  total_reviews: number | null;
  status: string | null;
  equipment?: string[] | null;
  service_price?: number | null;
}

interface RecentJob {
  id: string;
  status: string;
  earning: number | null;
  completed_at: string | null;
  profiles?: { full_name: string | null } | null;
}

interface ExtraService {
  id: string;
  name: string;
  price: number;
}

interface BookingRequest {
  id: string;
  customer_id: string;
  customer_note: string | null;
  address: string | null;
  created_at: string | null;
  scheduled_at: string | null;
  estimated_price: number | null;
  latitude: number | null;
  longitude: number | null;
  booking_date: string | null;
  booking_time: string | null;
  extra_services: ExtraService[] | null;
  profiles?: { full_name: string | null } | null;
  vehicles?: { brand: string | null; model: string | null; plate: string | null; color: string | null } | null;
  services?: { name: string | null; base_price: number | null } | null;
}

function haversineKm(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function ProviderDashboard({ onBack, onSignOut }: ProviderDashboardProps) {
  const { profile, session, signOut } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [stats, setStats] = useState<ProviderStats | null>(null);
  const [newReservation, setNewReservation] = useState<BookingRequest | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [todayEarnings, setTodayEarnings] = useState(0);
  const [weekEarnings, setWeekEarnings] = useState(0);
  const [loadingData, setLoadingData] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [online, setOnline] = useState(false);
  const [showLogout, setShowLogout] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showProfilePanel, setShowProfilePanel] = useState(false);
  const [showWorkingHours, setShowWorkingHours] = useState(false);
  const [showEquipmentPricing, setShowEquipmentPricing] = useState(false);
  const [locationPreview, setLocationPreview] = useState<{ lat: number; lng: number } | null>(null);
  const [requests, setRequests] = useState<BookingRequest[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null);
  const [rejectedBookingIds, setRejectedBookingIds] = useState<Set<string>>(new Set());
  const [acceptedBooking, setAcceptedBooking] = useState<BookingRequest | null>(null);
  const [providerMissing, setProviderMissing] = useState(false);
  const [onMyWayUpdating, setOnMyWayUpdating] = useState(false);
  const [onMyWayDone, setOnMyWayDone] = useState(false);
  const [arrivedUpdating, setArrivedUpdating] = useState(false);
  const [arrivedDone, setArrivedDone] = useState(false);

  // Before-wash photo state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoUploaded, setPhotoUploaded] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  // Active job state (from get_state) — used for Start Wash + After Photo visibility
  const [activeJob, setActiveJob] = useState<{
    id: string;
    status: string;
    provider_id: string;
    before_photo_url: string | null;
    after_photo_url: string | null;
    provider_closed_at: string | null;
  } | null>(null);

  // The provider_profiles.id for the authenticated user — jobs.provider_id
  // references provider_profiles.id, NOT profiles.id.
  const [providerProfileId, setProviderProfileId] = useState<string | null>(null);

  // Start Wash state
  const [startWashUpdating, setStartWashUpdating] = useState(false);
  const [startWashDone, setStartWashDone] = useState(false);

  // After Photo state
  const [afterPhotoFile, setAfterPhotoFile] = useState<File | null>(null);
  const [afterPhotoPreview, setAfterPhotoPreview] = useState<string | null>(null);
  const [afterPhotoUploading, setAfterPhotoUploading] = useState(false);
  const [afterPhotoError, setAfterPhotoError] = useState<string | null>(null);
  const [afterPhotoUploaded, setAfterPhotoUploaded] = useState(false);
  const [afterUploadResult, setAfterUploadResult] = useState<string | null>(null);

  // Send for Customer Approval state
  const [sendApprovalUpdating, setSendApprovalUpdating] = useState(false);
  const [sendApprovalDone, setSendApprovalDone] = useState(false);

  // Customer Approved state — set when the job transitions to "completed"
  // after the customer approves. Driven by polling get_state.
  const [customerApproved, setCustomerApproved] = useState(false);

  // Closing a customer-approved completed job.
  const [closingJob, setClosingJob] = useState(false);

  // Live GPS broadcast while the washer is "on the way". We use a ref so the
  // effect that starts/stops the broadcast doesn't need to re-create on every
  // render — it only depends on whether we have an active booking.
  const locationWatchRef = useRef<ReturnType<typeof navigator.geolocation.watchPosition> | null>(null);
  const lastLocationSentRef = useRef(0);
  const lastLatRef = useRef<number | null>(null);
  const lastLngRef = useRef<number | null>(null);

  // Stable ref for the translation function so callbacks that need it don't
  // change identity every render (t is recreated each render by useTranslation).
  const tRef = useRef(t);
  tRef.current = t;

  // Stable ref for showToast so the GPS effect doesn't depend on it directly.
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  // Stale-request guard: only the latest fetch may write to state.
  const fetchSeqRef = useRef(0);

  const fetchRequests = useCallback(async () => {
    if (!profile) return;
    const seq = ++fetchSeqRef.current;
    setRequestsError(null);
    setRequestsLoading(true);
    const { data, error } = await supabase
      .from('bookings')
      .select(`
        id, customer_id, customer_note, address, created_at, scheduled_at,
        estimated_price, latitude, longitude, booking_date, booking_time, extra_services,
        profiles!bookings_customer_id_fkey(full_name),
        vehicles!bookings_vehicle_id_fkey(brand, model, plate, color),
        services!bookings_service_id_fkey(name, base_price)
      `)
      .eq('status', 'waiting')
      .is('provider_id', null)
      .order('created_at', { ascending: false })
      .limit(20);
    setRequestsLoading(false);
    if (seq !== fetchSeqRef.current) return;
    if (error) {
      console.error('[fetchRequests] failed:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
      });
      setRequestsError(tRef.current('provider.errLoadPending'));
      return;
    }
    const allRequests = (data as BookingRequest[]) ?? [];

    // Load this provider's persisted rejections so rejected bookings stay
    // hidden across refresh, logout/login, and app restart.
    let rejectedIds = new Set<string>();
    if (providerProfileId) {
      const { data: rejections, error: rejError } = await supabase
        .from('booking_rejections')
        .select('booking_id')
        .eq('provider_id', providerProfileId);
      if (!rejError && rejections) {
        rejectedIds = new Set(rejections.map(r => (r as { booking_id: string }).booking_id));
      }
    }
    if (seq !== fetchSeqRef.current) return;
    setRejectedBookingIds(rejectedIds);
    setRequests(allRequests.filter(r => !rejectedIds.has(r.id)));
  }, [profile, providerProfileId]);

  const fetchData = async (): Promise<string | null> => {
    if (!profile) return null;

    const { data: providerData } = await supabase
      .from('provider_profiles')
      .select('id, completed_jobs, rating, total_reviews, status, equipment, service_price')
      .eq('profile_id', profile.id)
      .maybeSingle();

    if (!providerData) {
      setProviderMissing(true);
      setLoadingData(false);
      return null;
    }
    setProviderMissing(false);
    setProviderProfileId((providerData as { id: string }).id);

    setStats(providerData as ProviderStats | null);
    setOnline(providerData?.status === 'available');

    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const { data: jobs } = await supabase
      .from('jobs')
      .select('id, status, earning, completed_at, profiles!jobs_customer_id_fkey(full_name)')
      .eq('provider_id', profile.id)
      .order('completed_at', { ascending: false })
      .limit(10);

    const allJobs = (jobs as RecentJob[]) ?? [];
    setRecentJobs(allJobs.slice(0, 5));

    const todayTotal = allJobs
      .filter(j => j.completed_at?.startsWith(today) && j.status === 'completed')
      .reduce((s, j) => s + (j.earning ?? 0), 0);

    const weekTotal = allJobs
      .filter(j => j.completed_at && j.completed_at >= weekAgo && j.status === 'completed')
      .reduce((s, j) => s + (j.earning ?? 0), 0);

    setTodayEarnings(todayTotal);
    setWeekEarnings(weekTotal);

    return (providerData as { id: string }).id;
  };

  // Restore an in-progress active booking on mount or refresh.
  // The booking stays "accepted" in the bookings table throughout the
  // entire job lifecycle (only the jobs table status advances), so we
  // can query for it and rebuild the active-job UI state.
  const fetchActiveBooking = useCallback(async (ppId: string) => {
    const { data: activeBooking, error: bookingQueryError } = await supabase
      .from('bookings')
      .select(`
        id, customer_id, customer_note, address, created_at, scheduled_at,
        estimated_price, latitude, longitude, booking_date, booking_time, extra_services,
        profiles!bookings_customer_id_fkey(full_name),
        vehicles!bookings_vehicle_id_fkey(brand, model, plate, color),
        services!bookings_service_id_fkey(name, base_price)
      `)
      .eq('status', 'accepted')
      .eq('provider_id', ppId)
      .order('accepted_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (bookingQueryError) {
      console.error('[fetchActiveBooking] query failed:', {
        code: bookingQueryError.code,
        message: bookingQueryError.message,
      });
      return;
    }

    if (!activeBooking) return;

    setAcceptedBooking(activeBooking as BookingRequest);

    try {
      const { data: jobState } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: (activeBooking as BookingRequest).id, action: 'get_state' },
      });
      if (!jobState) return;
      const job = jobState as {
        id?: string;
        status?: string;
        provider_id?: string;
        before_photo_url?: string | null;
        after_photo_url?: string | null;
        provider_closed_at?: string | null;
      } | null;
      // If the completed job was already closed by this provider, do not
      // rebuild the active-job card — it must stay cleared across refreshes.
      if (job?.id && job.status === 'completed' && job.provider_closed_at) {
        setAcceptedBooking(null);
        setActiveJob(null);
        return;
      }
      if (job?.id) {
        setActiveJob({
          id: job.id,
          status: job.status ?? '',
          provider_id: job.provider_id ?? '',
          before_photo_url: job.before_photo_url ?? null,
          after_photo_url: job.after_photo_url ?? null,
          provider_closed_at: job.provider_closed_at ?? null,
        });
        const st = job.status ?? '';
        if (['on_the_way', 'arrived', 'started', 'pending_approval', 'completed'].includes(st)) {
          setOnMyWayDone(true);
        }
        if (['arrived', 'started', 'pending_approval', 'completed'].includes(st)) {
          setArrivedDone(true);
        }
        if (['started', 'pending_approval', 'completed'].includes(st)) {
          setStartWashDone(true);
        }
        if (['pending_approval', 'completed'].includes(st)) {
          setSendApprovalDone(true);
        }
        if (st === 'completed') {
          setCustomerApproved(true);
        }
        if (job.before_photo_url) {
          setPhotoPreview(job.before_photo_url);
          setPhotoUploaded(true);
        }
        if (job.after_photo_url) {
          setAfterPhotoPreview(job.after_photo_url);
          setAfterPhotoUploaded(true);
        }
      }
    } catch {
      // non-fatal — UI shows the accepted booking without step state
    }
  }, []);

  useEffect(() => {
    (async () => {
      const ppId = await fetchData();
      if (ppId) await fetchActiveBooking(ppId);
      setLoadingData(false);
    })();
  }, [profile]);

  useEffect(() => {
    if (online) fetchRequests();
  }, [online, fetchRequests]);

  // Re-sync the active job whenever the page regains focus or becomes
  // visible. This covers: switching browser tabs, returning from
  // another screen (component stays mounted), the app coming to the
  // foreground on mobile, and pull-to-refresh. The database is the
  // source of truth — local state is only a cache.
  useEffect(() => {
    const resync = () => {
      if (providerProfileId) fetchActiveBooking(providerProfileId);
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') resync();
    };
    window.addEventListener('focus', resync);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.removeEventListener('focus', resync);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [providerProfileId, fetchActiveBooking]);

  // Realtime subscription: listen for booking changes while online.
  // Single source of truth: realtime events trigger a full DB refresh via
  // fetchRequests(). We do NOT also directly mutate local state from the
  // realtime payload — that was the root cause of the flicker (competing
  // state update paths racing each other).
  const fetchRequestsRef = useRef(fetchRequests);
  fetchRequestsRef.current = fetchRequests;

  useEffect(() => {
    if (!online) return;
    const channel = supabase
      .channel('bookings:waiting')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bookings',
          filter: 'status=eq.waiting',
        },
        (payload) => {
          const newBooking = payload.new as BookingRequest;
          setNewReservation(newBooking);
          fetchRequestsRef.current();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'bookings',
        },
        () => {
          // Any booking update may change eligibility (accepted elsewhere,
          // rejected, cancelled, etc.). Re-fetch authoritative data from the
          // database instead of manually mutating local state.
          fetchRequestsRef.current();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [online]);

  const onRefresh = async () => {
    setRefreshing(true);
    const ppId = await fetchData();
    if (online) await fetchRequests();
    if (ppId) await fetchActiveBooking(ppId);
    setRefreshing(false);
  };

  const toggleStatus = async () => {
    if (!profile) return;
    const newStatus = online ? 'offline' : 'available';
    const { error } = await supabase
      .from('provider_profiles')
      .update({ status: newStatus })
      .eq('profile_id', profile.id);
    if (error) {
      showToast(t('provider.errStatusUpdate'), 'error');
      return;
    }
    setOnline(!online);
  };

  const handleAccept = async (bookingId: string) => {
    if (!profile) return;
    setAcceptingId(bookingId);

    // Load the authenticated user's provider profile record.
    // bookings.provider_id references provider_profiles(id), NOT profiles.id.
    const { data: providerRecord, error: providerError } = await supabase
      .from('provider_profiles')
      .select('id')
      .eq('profile_id', profile.id)
      .maybeSingle();

    if (providerError) {
      console.error('[accept] provider_profiles lookup failed:', {
        code: providerError.code,
        message: providerError.message,
        details: providerError.details,
        hint: providerError.hint,
      });
      setAcceptingId(null);
      showToast(t('provider.errLoadProfile'), 'error');
      return;
    }

    if (!providerRecord) {
      setAcceptingId(null);
      showToast(t('provider.errNoProviderProfile'), 'error');
      setProviderMissing(true);
      return;
    }

    const providerProfileId = providerRecord.id;

    // Re-check the booking is still available before accepting
    const { data: check, error: checkError } = await supabase
      .from('bookings')
      .select('id, status, provider_id')
      .eq('id', bookingId)
      .maybeSingle();

    if (checkError || !check) {
      setAcceptingId(null);
      showToast(t('provider.errBookingGone'), 'error');
      fetchRequests();
      return;
    }

    if (check.status !== 'waiting' || check.provider_id != null) {
      setAcceptingId(null);
      showToast(t('provider.errAlreadyAccepted'), 'error');
      fetchRequests();
      return;
    }

    // Sprint 13.2: Check for reservation conflicts before accepting.
    // Query all active bookings assigned to this provider and check if the
    // requested booking's time slot overlaps with any of them.
    const reqBooking = requests.find(r => r.id === bookingId);
    if (reqBooking?.booking_date && reqBooking?.booking_time) {
      const { data: activeBookings } = await supabase
        .from('bookings')
        .select('id, booking_date, booking_time, status, services!bookings_service_id_fkey(name)')
        .eq('provider_id', providerProfileId)
        .in('status', ACTIVE_STATUSES);

      const activeSlots = (activeBookings ?? []).map((b: { id: string; booking_date: string | null; booking_time: string | null; status: string; services?: { name: string | null } | null }) => ({
        id: b.id,
        booking_date: b.booking_date,
        booking_time: b.booking_time,
        service_name: b.services?.name ?? null,
        status: b.status,
      }));

      if (hasConflict(
        { booking_date: reqBooking.booking_date, booking_time: reqBooking.booking_time, service_name: reqBooking.services?.name ?? null },
        activeSlots
      )) {
        setAcceptingId(null);
        showToast(t('provider.errConflict'), 'error');
        return;
      }
    }

    // Atomic update with status + provider_id guard — only updates if still pending and unassigned
    const { error: bookingError, count } = await supabase
      .from('bookings')
      .update({
        status: 'accepted',
        provider_id: providerProfileId,
        accepted_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('id', bookingId)
      .eq('status', 'waiting')
      .is('provider_id', null);

    if (bookingError) {
      console.error('[accept] bookings update failed:', {
        code: bookingError.code,
        message: bookingError.message,
        details: bookingError.details,
        hint: bookingError.hint,
        constraint: bookingError.constraint,
      });
      setAcceptingId(null);
      showToast(t('provider.errAcceptFailed'), 'error');
      return;
    }

    // count === 0 means no row matched the guard — another partner got there first
    if (count === 0) {
      setAcceptingId(null);
      showToast(t('provider.errAlreadyAccepted'), 'error');
      fetchRequests();
      return;
    }

    // Verify the update actually applied (provider_id matches us)
    const { data: verify } = await supabase
      .from('bookings')
      .select('provider_id')
      .eq('id', bookingId)
      .maybeSingle();

    if (verify?.provider_id !== providerProfileId) {
      setAcceptingId(null);
      showToast(t('provider.errAlreadyAccepted'), 'error');
      fetchRequests();
      return;
    }

    const acceptedReq = requests.find(r => r.id === bookingId) ?? null;
    setAcceptingId(null);
    setAcceptedBooking(acceptedReq);
    showToast(t('provider.successAccepted'), 'success');
    setRequests(prev => prev.filter(r => r.id !== bookingId));

    // Notify the customer that their booking was accepted. Fire-and-forget.
    if (acceptedReq?.customer_id) {
      supabase.functions.invoke('push-notifications', {
        body: {
          action: 'send_notification',
          target_user_id: acceptedReq.customer_id,
          notification_type: 'booking_accepted',
          screen: 'partnerSelection',
          booking_id: bookingId,
        },
      }).catch((err) => console.error('Push notification failed:', err));
    }
  };

  const handleViewLocation = () => {
    if (!acceptedBooking) return;
    const { latitude, longitude, address } = acceptedBooking;
    if (latitude != null && longitude != null) {
      const url = `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
      Linking.openURL(url).catch(() => showToast(t('provider.errOpenMap'), 'error'));
    } else if (address) {
      const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
      Linking.openURL(url).catch(() => showToast(t('provider.errOpenMap'), 'error'));
    } else {
      showToast(t('provider.errNoCoords'), 'info');
    }
  };

  const handleOnMyWay = async () => {
    if (!acceptedBooking || onMyWayUpdating || onMyWayDone) return;
    setOnMyWayUpdating(true);
    try {
      const { error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'on_my_way' },
      });
      if (error) {
        const err = error as { code?: string; message?: string; details?: unknown; hint?: unknown };
        console.error('[On My Way] Supabase update failed', {
          code: err.code,
          message: err.message,
          details: err.details,
          hint: err.hint,
        });
        showToast(t('provider.errStatusRetry'), 'error');
        return;
      }
      // Refresh the booking from the server
      const { data: refreshed, error: refreshError } = await supabase
        .from('bookings')
        .select('*, vehicles(*), profiles(*), services(*)')
        .eq('id', acceptedBooking.id)
        .maybeSingle();
      if (refreshError) {
        console.error('[On My Way] Refresh failed', {
          code: refreshError.code,
          message: refreshError.message,
          details: refreshError.details,
          hint: refreshError.hint,
        });
      } else if (refreshed) {
        if (refreshed.status === 'cancelled') {
          showToast(t('provider.errBookingCancelled'), 'error');
          setAcceptedBooking(null);
          return;
        }
        if (refreshed.status === 'expired') {
          showToast(t('provider.errBookingExpired'), 'error');
          setAcceptedBooking(null);
          return;
        }
        setAcceptedBooking(refreshed as BookingRequest);
      }
      setOnMyWayDone(true);
      showToast(t('provider.successOnMyWay'), 'success');
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown; hint?: unknown };
      console.error('[On My Way] Unexpected error', {
        code: e.code,
        message: e.message,
        details: e.details,
        hint: e.hint,
      });
      showToast(t('provider.errNetwork'), 'error');
    } finally {
      setOnMyWayUpdating(false);
    }
  };

  const handleArrived = async () => {
    if (!acceptedBooking || arrivedUpdating || arrivedDone || !onMyWayDone) return;
    setArrivedUpdating(true);
    try {
      const { error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'arrived' },
      });
      if (error) {
        const err = error as { code?: string; message?: string; details?: unknown; hint?: unknown };
        console.error('[Arrived] Supabase update failed', {
          code: err.code,
          message: err.message,
          details: err.details,
          hint: err.hint,
        });
        showToast(t('provider.errStatusRetry'), 'error');
        return;
      }
      const { data: refreshed, error: refreshError } = await supabase
        .from('bookings')
        .select('*, vehicles(*), profiles(*), services(*)')
        .eq('id', acceptedBooking.id)
        .maybeSingle();
      if (refreshError) {
        console.error('[Arrived] Refresh failed', {
          code: refreshError.code,
          message: refreshError.message,
          details: refreshError.details,
          hint: refreshError.hint,
        });
      } else if (refreshed) {
        if (refreshed.status === 'cancelled') {
          showToast(t('provider.errBookingCancelled'), 'error');
          setAcceptedBooking(null);
          return;
        }
        if (refreshed.status === 'expired') {
          showToast(t('provider.errBookingExpired'), 'error');
          setAcceptedBooking(null);
          return;
        }
        setAcceptedBooking(refreshed as BookingRequest);
      }
      setArrivedDone(true);
      showToast(t('provider.successArrived'), 'success');
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown; hint?: unknown };
      console.error('[Arrived] Unexpected error', {
        code: e.code,
        message: e.message,
        details: e.details,
        hint: e.hint,
      });
      showToast(t('provider.errNetwork'), 'error');
    } finally {
      setArrivedUpdating(false);
    }
  };

  // Live GPS broadcast: while the washer is "on the way", watch their GPS
  // position and write coordinates to provider_profiles so the customer's
  // tracking map can poll them. Starts when onMyWayDone becomes true, stops
  // when arrivedDone becomes true or the booking is cleared. Coordinates
  // are cleared on stop so no stale location remains.
  // Uses refs for showToast/t to avoid re-running on every render (t is
  // recreated each render by useTranslation, which would cause an infinite
  // effect loop).
  useEffect(() => {
    const stopWatcher = () => {
      if (locationWatchRef.current != null && navigator.geolocation) {
        try {
          navigator.geolocation.clearPosition(locationWatchRef.current);
        } catch {
          // clearWatch must never throw
        }
      }
      locationWatchRef.current = null;
      lastLatRef.current = null;
      lastLngRef.current = null;
      lastLocationSentRef.current = 0;
    };

    if (!onMyWayDone || arrivedDone || !acceptedBooking || !providerProfileId) {
      stopWatcher();
      // Clear stored coordinates so no stale location is visible after arrival.
      if (providerProfileId) {
        supabase
          .from('provider_profiles')
          .update({ current_latitude: null, current_longitude: null })
          .eq('id', providerProfileId)
          .then(() => {})
          .catch(() => {});
      }
      return;
    }

    // Guard against duplicate watchers — only one may exist at a time.
    if (locationWatchRef.current != null) return;

    // Guard against environments without geolocation support.
    if (!navigator.geolocation || !navigator.geolocation.watchPosition) return;

    try {
      locationWatchRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;

          // Ignore tiny GPS drift (< 10 meters) to avoid unnecessary writes.
          // 0.0001 degrees ≈ 11 meters at the equator.
          if (
            lastLatRef.current != null &&
            lastLngRef.current != null &&
            Math.abs(latitude - lastLatRef.current) < 0.0001 &&
            Math.abs(longitude - lastLngRef.current) < 0.0001
          ) {
            return;
          }

          // Throttle to max one write per 4 seconds to match the customer's
          // polling interval and avoid hammering the database.
          const now = Date.now();
          if (now - lastLocationSentRef.current < 4000) return;

          lastLatRef.current = latitude;
          lastLngRef.current = longitude;
          lastLocationSentRef.current = now;

          supabase
            .from('provider_profiles')
            .update({
              current_latitude: latitude,
              current_longitude: longitude,
            })
            .eq('id', providerProfileId)
            .then(() => {})
            .catch(() => {});
        },
        (err) => {
          // Permission denied (code 1) — surface once via toast, do not crash.
          if (err.code === 1) {
            try {
              showToastRef.current(tRef.current('provider.errGpsDenied'), 'error');
            } catch {
              // toast must never throw
            }
          }
          // Position unavailable or timeout — non-fatal. The browser will
          // retry automatically when a new position becomes available.
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
      );
    } catch {
      // watchPosition must never throw — if it does, fail silently.
      locationWatchRef.current = null;
    }

    return () => {
      stopWatcher();
    };
  }, [onMyWayDone, arrivedDone, acceptedBooking, providerProfileId]);

  // Fetch any existing before_photo_url for the active job so the step
  // stays completed across refreshes. Also captures full job state for
  // Start Wash visibility checks.
  const refreshJobPhoto = useCallback(async () => {
    if (!acceptedBooking || !profile) return;
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'get_state' },
      });
      if (error) {
        console.error('[before-photo] get_state failed:', {
          code: (error as { code?: string }).code,
          message: (error as { message?: string }).message,
        });
        return;
      }
      const job = data as {
        id?: string;
        status?: string;
        provider_id?: string;
        before_photo_url?: string | null;
        after_photo_url?: string | null;
      } | null;
      if (job?.id) {
        setActiveJob({
          id: job.id,
          status: job.status ?? '',
          provider_id: job.provider_id ?? '',
          before_photo_url: job.before_photo_url ?? null,
          after_photo_url: job.after_photo_url ?? null,
        });
      }
      const url = job?.before_photo_url ?? null;
      if (url) {
        setPhotoPreview(url);
        setPhotoUploaded(true);
      }
      // If job already advanced past arrived, reflect that.
      if (job?.status === 'started') {
        setStartWashDone(true);
      }
      const afterUrl = job?.after_photo_url ?? null;
      if (afterUrl) {
        setAfterPhotoPreview(afterUrl);
        setAfterPhotoUploaded(true);
      }
    } catch {
      // non-fatal; UI simply shows the upload step
    }
  }, [acceptedBooking, profile]);

  useEffect(() => {
    if (arrivedDone && acceptedBooking) {
      refreshJobPhoto();
    }
  }, [arrivedDone, acceptedBooking, refreshJobPhoto]);

  // Poll get_state while waiting for customer approval so the partner UI
  // flips to "Customer Approved" automatically once the customer approves.
  // Only polls while sendApprovalDone is true and the customer hasn't
  // approved yet. Stops once customerApproved is set.
  useEffect(() => {
    if (!acceptedBooking || !sendApprovalDone || customerApproved) return;
    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('job-progress', {
          body: { booking_id: acceptedBooking.id, action: 'get_state' },
        });
        if (error || !data) return;
        const job = data as { status?: string } | null;
        if (job?.status === 'completed') {
          setCustomerApproved(true);
          setActiveJob(prev => prev ? { ...prev, status: 'completed' } : prev);
          showToast(t('provider.successCustomerApproved'), 'success');
        }
      } catch {
        // non-fatal — next interval retries.
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [acceptedBooking, sendApprovalDone, customerApproved, showToast]);

  // handleCloseCompletedJob: Washer acknowledges a customer-approved
  // completed job and clears it from the dashboard. Persisted via the
  // job-progress edge function (sets jobs.provider_closed_at). The booking
  // stays "accepted" and the job stays "completed" — no data is deleted.
  const handleCloseCompletedJob = useCallback(async () => {
    if (!acceptedBooking || closingJob || !customerApproved) return;
    setClosingJob(true);
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'close_job' },
      });
      if (error || !data) {
        const err = error as { message?: string } | null;
        console.error('[close-job] failed:', err?.message);
        showToast(t('provider.errCloseJob'), 'error');
        return;
      }
      // Only clear local state after the DB write succeeds.
      setAcceptedBooking(null);
      setActiveJob(null);
      setCustomerApproved(false);
      setSendApprovalDone(false);
      showToast(t('provider.successJobClosed'), 'success');
      // Refresh pending booking requests so the dashboard returns to
      // its normal state.
      fetchRequests();
    } catch (err) {
      const e = err as { message?: string };
      console.error('[close-job] unexpected error:', e?.message);
      showToast(t('provider.errCloseJob'), 'error');
    } finally {
      setClosingJob(false);
    }
  }, [acceptedBooking, closingJob, customerApproved, showToast]);

  const handlePickPhoto = async () => {
    setPhotoError(null);
    try {
      const file = await pickJobPhoto();
      if (!file) return;
      const validationError = validateJobPhoto(file);
      if (validationError) {
        setPhotoError(validationError);
        showToast(validationError, 'error');
        return;
      }
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
      setPhotoUploaded(false);
    } catch {
      showToast(t('provider.errCamera'), 'error');
    }
  };

  const handleUploadPhoto = async () => {
    if (!photoFile || !acceptedBooking || !profile || photoUploading) return;
    setPhotoUploading(true);
    setPhotoError(null);
    try {
      // 1. Fetch the job ID via get_state (edge function validates ownership).
      const { data: stateData, error: stateError } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'get_state' },
      });
      if (stateError || !stateData) {
        const err = stateError as { code?: string; message?: string } | null;
        console.error('[before-photo] get_state failed:', {
          code: err?.code,
          message: err?.message,
        });
        setPhotoError(t('provider.errVerifyJob'));
        showToast(t('provider.errVerifyJob'), 'error');
        return;
      }
      const jobId = (stateData as { id?: string }).id;
      if (!jobId) {
        setPhotoError(t('provider.errJobNotFound'));
        showToast(t('provider.errJobNotFound'), 'error');
        return;
      }

      // 2. Upload to Storage using {userId}/{jobId}/before-{ts}.{ext}
      const { url, path, error: uploadErr } = await uploadJobPhoto(
        profile.id,
        jobId,
        photoFile,
      );
      if (uploadErr || !url) {
        console.error('[before-photo] storage upload failed:', { error: uploadErr, path });
        setPhotoError(uploadErr ?? t('provider.errUploadFailed'));
        showToast(t('provider.errUploadFailed'), 'error');
        return;
      }

      // 3. Save the URL via edge function (re-checks ownership + status).
      const { data: saveData, error: saveError } = await supabase.functions.invoke('job-progress', {
        body: {
          booking_id: acceptedBooking.id,
          action: 'save_before_photo',
          photo_url: url,
        },
      });
      if (saveError || !saveData) {
        const err = saveError as { code?: string; message?: string; details?: unknown; hint?: unknown } | null;
        console.error('[before-photo] save failed:', {
          code: err?.code,
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
        });
        const msg = err?.message?.includes('no longer assigned')
          ? t('provider.errBookingUnassigned')
          : err?.message?.includes('cancelled') || err?.message?.includes('expired')
            ? t('provider.errBookingInactive')
            : t('provider.errSavePhoto');
        setPhotoError(msg);
        showToast(msg, 'error');
        return;
      }

      // 4. Re-fetch the job to confirm before_photo_url is persisted and
      //    update activeJob so Start Wash visibility re-evaluates.
      const { data: confirmed, error: confirmError } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'get_state' },
      });
      if (confirmError || !confirmed) {
        console.error('[before-photo] confirm re-fetch failed:', confirmError);
        setPhotoError(t('provider.errPhotoUnconfirmed'));
        showToast(t('provider.errPhotoUnconfirmedShort'), 'error');
        return;
      }
      const confirmedJob = confirmed as {
        id?: string;
        status?: string;
        provider_id?: string;
        before_photo_url?: string | null;
      } | null;
      const confirmedUrl = confirmedJob?.before_photo_url ?? null;
      if (!confirmedUrl) {
        setPhotoError(t('provider.errConfirmPhoto'));
        showToast(t('provider.errConfirmPhoto'), 'error');
        return;
      }

      if (confirmedJob?.id) {
        setActiveJob({
          id: confirmedJob.id,
          status: confirmedJob.status ?? '',
          provider_id: confirmedJob.provider_id ?? '',
          before_photo_url: confirmedUrl,
          after_photo_url: confirmedJob?.after_photo_url ?? null,
        });
      }

      setPhotoUploaded(true);
      setPhotoPreview(confirmedUrl);
      showToast(t('provider.successBeforeSaved'), 'success');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      console.error('[before-photo] unexpected error:', {
        code: e.code,
        message: e.message,
      });
      setPhotoError(t('provider.errNetworkLong'));
      showToast(t('provider.errNetwork'), 'error');
    } finally {
      setPhotoUploading(false);
    }
  };

  const handleRetryPhoto = () => {
    setPhotoError(null);
    setPhotoUploaded(false);
    setPhotoFile(null);
    setPhotoPreview(null);
  };

  // Start Wash visibility: all three conditions must be true.
  const startWashChecks = (() => {
    const hasJob = !!activeJob;
    const hasPartner = !!providerProfileId;
    const partnerOwnsJob = hasJob && hasPartner && activeJob!.provider_id === providerProfileId;
    const statusIsArrived = hasJob && activeJob!.status === 'arrived';
    const beforePhotoExists = hasJob && !!activeJob!.before_photo_url && activeJob!.before_photo_url.trim() !== '';
    const result = hasJob && hasPartner && partnerOwnsJob && statusIsArrived && beforePhotoExists;

    return { result };
  })();
  const canStartWash = startWashChecks.result;

  // Sprint 13.3.2: Filter out pending bookings that conflict with the
  // active job's time slot. The conflict engine checks overlap based on
  // booking_date, booking_time, and service duration. Bookings without
  // a date/time always pass (no conflict detectable).
  const visibleRequests = useMemo(() => {
    if (!acceptedBooking) return requests;
    // Only apply conflict filtering when the job is in an active (non-terminal)
    // state. A completed job must not block new booking requests from appearing.
    const jobStatus = activeJob?.status ?? 'accepted';
    if (!ACTIVE_STATUSES.includes(jobStatus)) return requests;
    const activeSlots: ActiveBooking[] = [{
      id: acceptedBooking.id,
      booking_date: acceptedBooking.booking_date ?? null,
      booking_time: acceptedBooking.booking_time ?? null,
      service_name: acceptedBooking.services?.name ?? null,
      status: jobStatus,
    }];
    return requests.filter(req =>
      !hasConflict(
        {
          booking_date: req.booking_date ?? null,
          booking_time: req.booking_time ?? null,
          service_name: req.services?.name ?? null,
        },
        activeSlots,
      )
    );
  }, [requests, acceptedBooking, activeJob]);

  // After Photo visibility: only when the job is started, belongs to this
  // partner, and a before photo already exists.
  const canShowAfterPhoto = (() => {
    const hasJob = !!activeJob;
    const hasPartner = !!providerProfileId;
    const partnerOwnsJob = hasJob && hasPartner && activeJob!.provider_id === providerProfileId;
    const statusIsStarted = hasJob && activeJob!.status === 'started';
    const beforePhotoExists = hasJob && !!activeJob!.before_photo_url && activeJob!.before_photo_url.trim() !== '';
    return hasJob && hasPartner && partnerOwnsJob && statusIsStarted && beforePhotoExists;
  })();

  // Send for Customer Approval visibility: partner owns job, status is
  // "started", before_photo_url exists, AND after_photo_url exists.
  // Not shown once already sent.
  const canSendForApproval = (() => {
    const hasJob = !!activeJob;
    const hasPartner = !!providerProfileId;
    const partnerOwnsJob = hasJob && hasPartner && activeJob!.provider_id === providerProfileId;
    const statusIsStarted = hasJob && activeJob!.status === 'started';
    const beforePhotoExists = hasJob && !!activeJob!.before_photo_url && activeJob!.before_photo_url.trim() !== '';
    const afterPhotoExists = hasJob && !!activeJob!.after_photo_url && activeJob!.after_photo_url.trim() !== '';
    return hasJob && hasPartner && partnerOwnsJob && statusIsStarted && beforePhotoExists && afterPhotoExists;
  })();

  const handleSendForApproval = async () => {
    if (!acceptedBooking || sendApprovalUpdating || sendApprovalDone || !canSendForApproval) return;
    setSendApprovalUpdating(true);
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'send_for_approval' },
      });
      if (error || !data) {
        const err = error as { code?: string; message?: string; details?: unknown; hint?: unknown } | null;
        console.error('[send-for-approval] failed:', {
          code: err?.code,
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
        });
        const msg = err?.message?.includes('no longer assigned')
          ? t('provider.errBookingUnassigned')
          : err?.message?.includes('cancelled') || err?.message?.includes('expired')
            ? t('provider.errBookingInactive')
            : err?.message?.includes('expected started')
              ? t('provider.errJobNotStarted')
              : err?.message?.includes('After photo')
                ? t('provider.errAfterRequiredForApproval')
                : err?.message?.includes('Before photo')
                  ? t('provider.errBeforeRequiredForApproval')
                  : t('provider.errSendApprovalFailed');
        showToast(msg, 'error');
        return;
      }
      // Refresh active job to confirm the transition to pending_approval.
      await refreshJobPhoto();
      setSendApprovalDone(true);
      showToast(t('provider.successSentApproval'), 'success');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      console.error('[send-for-approval] unexpected error:', { code: e.code, message: e.message });
      showToast(t('provider.errNetwork'), 'error');
    } finally {
      setSendApprovalUpdating(false);
    }
  };

  const handlePickAfterPhoto = async () => {
    setAfterPhotoError(null);
    try {
      const file = await pickJobPhoto();
      if (!file) return;
      const validationError = validateJobPhoto(file);
      if (validationError) {
        setAfterPhotoError(validationError);
        showToast(validationError, 'error');
        return;
      }
      setAfterPhotoFile(file);
      setAfterPhotoPreview(URL.createObjectURL(file));
      setAfterPhotoUploaded(false);
    } catch {
      showToast(t('provider.errCamera'), 'error');
    }
  };

  const handleUploadAfterPhoto = async () => {
    if (!afterPhotoFile || !acceptedBooking || !profile || afterPhotoUploading) return;
    setAfterPhotoUploading(true);
    setAfterPhotoError(null);
    setAfterUploadResult(null);
    try {
      // 1. Fetch the job via get_state (edge function validates ownership).
      const { data: stateData, error: stateError } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'get_state' },
      });
      if (stateError || !stateData) {
        const err = stateError as { code?: string; message?: string } | null;
        console.error('[after-photo] get_state failed:', {
          code: err?.code,
          message: err?.message,
        });
        setAfterPhotoError(t('provider.errVerifyJob'));
        showToast(t('provider.errVerifyJob'), 'error');
        return;
      }
      const jobId = (stateData as { id?: string }).id;
      if (!jobId) {
        setAfterPhotoError(t('provider.errJobNotFound'));
        showToast(t('provider.errJobNotFound'), 'error');
        return;
      }

      // 2. Upload to Storage using {userId}/{jobId}/after-{ts}.{ext}
      const { url, path, error: uploadErr } = await uploadJobPhoto(
        profile.id,
        jobId,
        afterPhotoFile,
        'after',
      );
      if (uploadErr || !url) {
        console.error('[after-photo] storage upload failed:', { error: uploadErr, path });
        setAfterPhotoError(uploadErr ?? t('provider.errUploadFailed'));
        showToast(t('provider.errUploadFailed'), 'error');
        return;
      }

      // 3. Save the URL via edge function (re-checks ownership + status).
      const { data: saveData, error: saveError } = await supabase.functions.invoke('job-progress', {
        body: {
          booking_id: acceptedBooking.id,
          action: 'save_after_photo',
          photo_url: url,
        },
      });
      if (saveError || !saveData) {
        const err = saveError as { code?: string; message?: string; details?: unknown; hint?: unknown } | null;
        console.error('[after-photo] save failed:', {
          code: err?.code,
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
        });
        const msg = err?.message?.includes('no longer assigned')
          ? t('provider.errBookingUnassigned')
          : err?.message?.includes('cancelled') || err?.message?.includes('expired')
            ? t('provider.errBookingInactive')
            : err?.message?.includes('expected started')
              ? t('provider.errJobNotStarted')
              : err?.message?.includes('Before photo')
                ? t('provider.errBeforeRequiredForAfter')
                : t('provider.errSavePhoto');
        setAfterPhotoError(msg);
        showToast(msg, 'error');
        return;
      }
      setAfterUploadResult(JSON.stringify(saveData));

      // 4. Re-fetch the job to confirm after_photo_url is persisted.
      const { data: confirmed, error: confirmError } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'get_state' },
      });
      if (confirmError || !confirmed) {
        console.error('[after-photo] confirm re-fetch failed:', confirmError);
        setAfterPhotoError(t('provider.errPhotoUnconfirmed'));
        showToast(t('provider.errPhotoUnconfirmedShort'), 'error');
        return;
      }
      const confirmedJob = confirmed as {
        id?: string;
        status?: string;
        provider_id?: string;
        before_photo_url?: string | null;
        after_photo_url?: string | null;
      } | null;
      const confirmedUrl = confirmedJob?.after_photo_url ?? null;
      if (!confirmedUrl) {
        setAfterPhotoError(t('provider.errConfirmPhoto'));
        showToast(t('provider.errConfirmPhoto'), 'error');
        return;
      }

      if (confirmedJob?.id) {
        setActiveJob({
          id: confirmedJob.id,
          status: confirmedJob.status ?? '',
          provider_id: confirmedJob.provider_id ?? '',
          before_photo_url: confirmedJob.before_photo_url ?? null,
          after_photo_url: confirmedUrl,
        });
      }

      setAfterPhotoUploaded(true);
      setAfterPhotoPreview(confirmedUrl);
      showToast(t('provider.successAfterSaved'), 'success');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      console.error('[after-photo] unexpected error:', {
        code: e.code,
        message: e.message,
      });
      setAfterPhotoError(t('provider.errNetworkLong'));
      showToast(t('provider.errNetwork'), 'error');
    } finally {
      setAfterPhotoUploading(false);
    }
  };

  const handleRetryAfterPhoto = () => {
    setAfterPhotoError(null);
    setAfterPhotoUploaded(false);
    setAfterPhotoFile(null);
    setAfterPhotoPreview(null);
    setAfterUploadResult(null);
  };

  const handleStartWash = async () => {
    if (!acceptedBooking || startWashUpdating || startWashDone || !canStartWash) return;
    setStartWashUpdating(true);
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: acceptedBooking.id, action: 'start_wash' },
      });
      if (error || !data) {
        const err = error as { code?: string; message?: string; details?: unknown; hint?: unknown } | null;
        console.error('[start-wash] failed:', {
          code: err?.code,
          message: err?.message,
          details: err?.details,
          hint: err?.hint,
        });
        const msg = err?.message?.includes('no longer assigned')
          ? t('provider.errBookingUnassigned')
          : err?.message?.includes('cancelled') || err?.message?.includes('expired')
            ? t('provider.errBookingInactive')
            : err?.message?.includes('expected arrived')
              ? t('provider.errJobNotArrived')
              : err?.message?.includes('Before photo')
                ? t('provider.errBeforeRequiredForWash')
                : t('provider.errStartWashFailed');
        showToast(msg, 'error');
        return;
      }
      // Refresh active job to confirm the transition.
      await refreshJobPhoto();
      setStartWashDone(true);
      showToast(t('provider.successStartedWash'), 'success');
    } catch (err) {
      const e = err as { code?: string; message?: string };
      console.error('[start-wash] unexpected error:', { code: e.code, message: e.message });
      showToast(t('provider.errNetwork'), 'error');
    } finally {
      setStartWashUpdating(false);
    }
  };

  const handleReject = async (bookingId: string) => {
    if (!profile || !providerProfileId || rejectingId) return;
    setRejectingId(bookingId);
    try {
      const { error } = await supabase
        .from('booking_rejections')
        .insert({ booking_id: bookingId, provider_id: providerProfileId });
      if (error) {
        // 23505 = unique_violation — already rejected, treat as success.
        if (error.code !== '23505') {
          console.error('[reject] insert failed:', {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
          });
          showToast(t('provider.errRejectFailed'), 'error');
          setRejectingId(null);
          return;
        }
      }
      // Only remove the card after the DB write succeeds.
      setRejectedBookingIds(prev => new Set(prev).add(bookingId));
      setRequests(prev => prev.filter(r => r.id !== bookingId));
      showToast(t('provider.successRejected'), 'success');
    } catch (err) {
      const e = err as { message?: string };
      console.error('[reject] unexpected error:', e?.message);
      showToast(t('provider.errRejectFailed'), 'error');
    } finally {
      setRejectingId(null);
      setRejectConfirmId(null);
    }
  };

  const handleLogout = async () => {
    setShowLogout(false);
    await signOut();
    onSignOut();
  };

  const hasCoords = acceptedBooking?.latitude != null && acceptedBooking?.longitude != null;
  const canViewLocation = hasCoords || !!acceptedBooking?.address;

  if (loadingData) return <Loading fullScreen message={t('provider.loading')} />;

  if (providerMissing) {
    return (
      <View style={styles.container}>
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.backBtn} onPress={onBack}>
            <Text style={styles.backIcon}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.topTitle}>{t('provider.title')}</Text>
          <View style={styles.topBarSpacer} />
        </View>
        <ErrorState
          message={t('provider.errNoProfile')}
          onRetry={onBack}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('provider.title')}</Text>
        <Avatar
          uri={profile?.avatar_url}
          name={profile?.full_name}
          size={36}
          showBadge={online}
          badgeColor={colors.accent}
          onPress={() => setShowProfileMenu(true)}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <TouchableOpacity
          style={[styles.statusToggle, online ? styles.statusOnline : styles.statusOffline]}
          onPress={toggleStatus}
          activeOpacity={0.85}
        >
          <View style={[styles.statusDot, { backgroundColor: online ? colors.accent : colors.textMuted }]} />
          <Text style={styles.statusLabel}>
            {online ? t('provider.statusOnline') : t('provider.statusOffline')}
          </Text>
        </TouchableOpacity>

        <View style={styles.earningsRow}>
          <View style={[styles.earningCard, styles.earningCardPrimary]}>
            <Text style={styles.earningLabel}>{t('provider.today')}</Text>
            <Text style={styles.earningAmount}>₺{todayEarnings.toFixed(0)}</Text>
            <Text style={styles.earningMeta}>{t('provider.earnings')}</Text>
          </View>
          <View style={[styles.earningCard, styles.earningCardDark]}>
            <Text style={styles.earningLabel}>{t('provider.thisWeek')}</Text>
            <Text style={styles.earningAmount}>₺{weekEarnings.toFixed(0)}</Text>
            <Text style={styles.earningMeta}>{t('provider.earnings')}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats?.completed_jobs ?? 0}</Text>
            <Text style={styles.statLabel}>{t('provider.statCompleted')}</Text>
          </View>
          <View style={[styles.statCard, styles.statCardBorder]}>
            <Text style={styles.statValue}>
              {stats?.rating != null ? Number(stats.rating).toFixed(1) : '—'}
            </Text>
            <Text style={styles.statLabel}>{t('provider.statRating')}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats?.total_reviews ?? 0}</Text>
            <Text style={styles.statLabel}>{t('provider.statReviews')}</Text>
          </View>
        </View>

        {/* Accepted booking confirmation */}
        {acceptedBooking && (
          <View style={styles.acceptedCard}>
            <View style={styles.acceptedHeader}>
              <Text style={styles.acceptedIcon}>✅</Text>
              <Text style={styles.acceptedTitle}>{t('provider.acceptedTitle')}</Text>
            </View>
            <Text style={styles.acceptedSubtitle}>
              {acceptedBooking.vehicles?.brand ?? ''} {acceptedBooking.vehicles?.model ?? ''}
              {acceptedBooking.vehicles?.plate ? ` — ${acceptedBooking.vehicles.plate}` : ''}
            </Text>
            <Text style={styles.acceptedCustomer}>
              {t('provider.customerPrefix')}{acceptedBooking.profiles?.full_name ?? t('provider.unknown')}
            </Text>
            <TouchableOpacity
              style={[
                styles.viewLocationBtn,
                !canViewLocation && styles.viewLocationBtnDisabled,
              ]}
              onPress={handleViewLocation}
              disabled={!canViewLocation}
              activeOpacity={0.85}
            >
              <Text style={styles.viewLocationBtnText}>
              {hasCoords
                ? t('provider.viewLocation')
                : acceptedBooking.address
                  ? t('provider.viewAddress')
                  : t('provider.locationUnavailable')}
              </Text>
            </TouchableOpacity>
            {!onMyWayDone ? (
              <TouchableOpacity
                style={[styles.onMyWayBtn, onMyWayUpdating && styles.onMyWayBtnDisabled]}
                onPress={handleOnMyWay}
                disabled={onMyWayUpdating}
                activeOpacity={0.85}
              >
                <Text style={styles.onMyWayBtnText}>
                  {onMyWayUpdating ? t('provider.updating') : t('provider.onMyWay')}
                </Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.onMyWayDone}>
                <Text style={styles.onMyWayDoneText}>{t('provider.onMyWayDone')}</Text>
              </View>
            )}
            {onMyWayDone && !arrivedDone ? (
              <TouchableOpacity
                style={[styles.arrivedBtn, arrivedUpdating && styles.arrivedBtnDisabled]}
                onPress={handleArrived}
                disabled={arrivedUpdating}
                activeOpacity={0.85}
              >
                <Text style={styles.arrivedBtnText}>
                  {arrivedUpdating ? t('provider.updating') : t('provider.arrived')}
                </Text>
              </TouchableOpacity>
            ) : arrivedDone ? (
              <View style={styles.arrivedDone}>
                <Text style={styles.arrivedDoneText}>{t('provider.arrivedDone')}</Text>
              </View>
            ) : null}

            {arrivedDone && (
              <View style={styles.beforePhotoSection}>
                <View style={styles.beforePhotoHeader}>
                  <Text style={styles.beforePhotoTitle}>{t('provider.beforePhotoTitle')}</Text>
                  {photoUploaded && (
                    <View style={styles.beforePhotoBadge}>
                      <Text style={styles.beforePhotoBadgeText}>{t('provider.savedBadge')}</Text>
                    </View>
                  )}
                </View>

                {photoPreview && (
                  <View style={styles.photoPreviewWrap}>
                    <Image source={{ uri: photoPreview }} style={styles.photoPreview} resizeMode="cover" />
                  </View>
                )}

                {photoError && (
                  <View style={styles.photoErrorBox}>
                    <Text style={styles.photoErrorText}>{photoError}</Text>
                  </View>
                )}

                {!photoUploaded && !photoUploading && (
                  <TouchableOpacity
                    style={styles.photoPickBtn}
                    onPress={handlePickPhoto}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.photoPickBtnText}>
                      {photoFile ? t('provider.chooseAnother') : t('provider.takePhoto')}
                    </Text>
                  </TouchableOpacity>
                )}

                {!photoUploaded && photoFile && !photoUploading && (
                  <TouchableOpacity
                    style={styles.photoUploadBtn}
                    onPress={handleUploadPhoto}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.photoUploadBtnText}>{t('provider.uploadBefore')}</Text>
                  </TouchableOpacity>
                )}

                {photoUploading && (
                  <View style={styles.photoUploadingBox}>
                    <ActivityIndicator color={colors.primary} size="small" />
                    <Text style={styles.photoUploadingText}>{t('provider.uploading')}</Text>
                  </View>
                )}

                {photoError && !photoUploading && (
                  <TouchableOpacity
                    style={styles.photoRetryBtn}
                    onPress={handleRetryPhoto}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.photoRetryBtnText}>{t('provider.retry')}</Text>
                  </TouchableOpacity>
                )}

                {photoUploaded && (
                  <View style={styles.photoSuccessBox}>
                    <Text style={styles.photoSuccessText}>{t('provider.beforeSuccess')}</Text>
                  </View>
                )}
              </View>
            )}

            {canStartWash && !startWashDone && (
              <TouchableOpacity
                style={[styles.startWashBtn, startWashUpdating && styles.startWashBtnDisabled]}
                onPress={handleStartWash}
                disabled={startWashUpdating}
                activeOpacity={0.85}
              >
                <Text style={styles.startWashBtnText}>
                  {startWashUpdating ? t('provider.starting') : t('provider.startWash')}
                </Text>
              </TouchableOpacity>
            )}

            {startWashDone && (
              <View style={styles.startWashDone}>
                <Text style={styles.startWashDoneText}>{t('provider.washInProgress')}</Text>
              </View>
            )}

            {canShowAfterPhoto && (
              <View style={styles.beforePhotoSection}>
                <View style={styles.beforePhotoHeader}>
                  <Text style={styles.beforePhotoTitle}>{t('provider.afterPhotoTitle')}</Text>
                  {afterPhotoUploaded && (
                    <View style={styles.beforePhotoBadge}>
                      <Text style={styles.beforePhotoBadgeText}>{t('provider.savedBadge')}</Text>
                    </View>
                  )}
                </View>

                {afterPhotoPreview && (
                  <View style={styles.photoPreviewWrap}>
                    <Image source={{ uri: afterPhotoPreview }} style={styles.photoPreview} resizeMode="cover" />
                  </View>
                )}

                {afterPhotoError && (
                  <View style={styles.photoErrorBox}>
                    <Text style={styles.photoErrorText}>{afterPhotoError}</Text>
                  </View>
                )}

                {!afterPhotoUploaded && !afterPhotoUploading && (
                  <TouchableOpacity
                    style={styles.photoPickBtn}
                    onPress={handlePickAfterPhoto}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.photoPickBtnText}>
                      {afterPhotoFile ? t('provider.chooseAnother') : t('provider.takePhoto')}
                    </Text>
                  </TouchableOpacity>
                )}

                {!afterPhotoUploaded && afterPhotoFile && !afterPhotoUploading && (
                  <TouchableOpacity
                    style={styles.photoUploadBtn}
                    onPress={handleUploadAfterPhoto}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.photoUploadBtnText}>{t('provider.uploadAfter')}</Text>
                  </TouchableOpacity>
                )}

                {afterPhotoUploading && (
                  <View style={styles.photoUploadingBox}>
                    <ActivityIndicator color={colors.primary} size="small" />
                    <Text style={styles.photoUploadingText}>{t('provider.uploading')}</Text>
                  </View>
                )}

                {afterPhotoError && !afterPhotoUploading && (
                  <TouchableOpacity
                    style={styles.photoRetryBtn}
                    onPress={handleRetryAfterPhoto}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.photoRetryBtnText}>{t('provider.retry')}</Text>
                  </TouchableOpacity>
                )}

                {afterPhotoUploaded && (
                  <View style={styles.photoSuccessBox}>
                    <Text style={styles.photoSuccessText}>{t('provider.afterSuccess')}</Text>
                  </View>
                )}

                {/* DEBUG — temporary */}
                <View style={styles.debugPanel}>
                  <Text style={styles.debugTitle}>{t('provider.debugTitle')}</Text>
                  <Text style={styles.debugRow}>{t('provider.debugJobId')}{activeJob?.id ?? t('provider.debugNull')}</Text>
                  <Text style={styles.debugRow}>{t('provider.debugJobStatus')}{activeJob?.status ?? t('provider.debugNull')}</Text>
                  <Text style={styles.debugRow} numberOfLines={2}>
                    {t('provider.debugAfterUrl')}{activeJob?.after_photo_url ?? t('provider.debugNull')}
                  </Text>
                  <Text style={styles.debugRow} numberOfLines={2}>
                    {t('provider.debugUploadResult')}{afterUploadResult ?? '—'}
                  </Text>
                </View>
              </View>
            )}

            {canSendForApproval && !sendApprovalDone && (
              <View style={styles.beforePhotoSection}>
                <View style={styles.beforePhotoHeader}>
                  <Text style={styles.beforePhotoTitle}>{t('provider.approvalTitle')}</Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.startWashBtn,
                    sendApprovalUpdating && styles.startWashBtnDisabled,
                  ]}
                  onPress={handleSendForApproval}
                  disabled={sendApprovalUpdating}
                  activeOpacity={0.85}
                >
                  {sendApprovalUpdating ? (
                    <View style={styles.startWashBtnRow}>
                      <ActivityIndicator color="#fff" size="small" />
                      <Text style={styles.startWashBtnText}>{t('provider.sending')}</Text>
                    </View>
                  ) : (
                    <Text style={styles.startWashBtnText}>{t('provider.sendApproval')}</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {sendApprovalDone && !customerApproved && (
              <View style={styles.beforePhotoSection}>
                <View style={styles.startWashDone}>
                  <Text style={styles.startWashDoneText}>{t('provider.sentApproval')}</Text>
                </View>
                <View style={styles.waitingApprovalBox}>
                  <Text style={styles.waitingApprovalText}>{t('provider.waitingApproval')}</Text>
                </View>
              </View>
            )}

            {customerApproved && (
              <View style={styles.customerApprovedBox}>
                <View style={styles.customerApprovedHeader}>
                  <Text style={styles.customerApprovedIcon}>✅</Text>
                  <Text style={styles.customerApprovedTitle}>{t('provider.customerApprovedTitle')}</Text>
                </View>
                <Text style={styles.customerApprovedText}>
                  {t('provider.customerApprovedBody')}
                </Text>
                <TouchableOpacity
                  style={[styles.closeJobBtn, closingJob && styles.closeJobBtnDisabled]}
                  onPress={handleCloseCompletedJob}
                  disabled={closingJob}
                  activeOpacity={0.85}
                >
                  <Text style={styles.closeJobBtnText}>
                    {closingJob ? t('provider.closingJob') : t('provider.closeJob')}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {!sendApprovalDone && !customerApproved && (
              <TouchableOpacity
                style={styles.dismissBtn}
                onPress={() => setAcceptedBooking(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.dismissBtnText}>{t('provider.dismiss')}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* In-app notification banner for new reservations */}
        {online && newReservation && (
          <View style={styles.reservationBanner}>
            <View style={styles.bannerIconWrap}>
              <Text style={styles.bannerIcon}>🔔</Text>
            </View>
            <View style={styles.bannerBody}>
              <Text style={styles.bannerTitle}>{t('provider.newReservationBanner')}</Text>
              <Text style={styles.bannerText}>{t('provider.newReservationBody')}</Text>
              <TouchableOpacity
                style={styles.bannerBtn}
                onPress={() => setNewReservation(null)}
                activeOpacity={0.85}
              >
                <Text style={styles.bannerBtnText}>{t('provider.viewReservation')}</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.bannerClose}
              onPress={() => setNewReservation(null)}
              activeOpacity={0.7}
            >
              <Text style={styles.bannerCloseIcon}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {online && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>{t('provider.pendingTitle')}</Text>
            {requestsLoading ? (
              <Loading message={t('provider.fetching')} />
            ) : requestsError ? (
              <ErrorState message={requestsError} onRetry={fetchRequests} />
            ) : visibleRequests.length === 0 ? (
              <EmptyState
                icon="🔔"
                title={t('provider.pendingEmptyTitle')}
                subtitle={t('provider.pendingEmptySubtitle')}
              />
            ) : (
              <View style={styles.requestList}>
                {visibleRequests.map(req => (
                  <View key={req.id} style={styles.requestCard}>
                    {/* Customer + price header */}
                    <View style={styles.requestHeader}>
                      <View style={styles.requestCustomerWrap}>
                        <Text style={styles.requestCustomerName}>
                          {req.profiles?.full_name ?? t('provider.unknownCustomer')}
                        </Text>
                        <Text style={styles.requestVehicleText}>
                          {req.vehicles?.brand ?? t('provider.unknown')} {req.vehicles?.model ?? ''}
                        </Text>
                        {req.vehicles?.plate && (
                          <Text style={styles.requestPlate}>{req.vehicles.plate}</Text>
                        )}
                      </View>
                      <Text style={styles.requestPrice}>
                        ₺{Number(req.estimated_price ?? 0).toFixed(0)}
                      </Text>
                    </View>

                    {/* Service */}
                    <View style={styles.requestRow}>
                      <Text style={styles.requestIcon}>🧽</Text>
                      <Text style={styles.requestService}>
                        {req.services?.name ?? t('provider.washServiceFallback')}
                      </Text>
                    </View>

                    {/* Extras */}
                    {req.extra_services && req.extra_services.length > 0 && (
                      <View style={styles.requestRow}>
                        <Text style={styles.requestIcon}>➕</Text>
                        <View style={styles.requestExtras}>
                          {req.extra_services.map((extra, idx) => (
                            <Text key={idx} style={styles.requestExtraItem}>
                              {extra.name} (+₺{extra.price})
                            </Text>
                          ))}
                        </View>
                      </View>
                    )}

                    {/* Booking date & time */}
                    <View style={styles.requestRow}>
                      <Text style={styles.requestIcon}>📅</Text>
                      <Text style={styles.requestTime}>
                        {req.booking_date
                          ? `${req.booking_date}${req.booking_time ? ' · ' + req.booking_time : ''}`
                          : req.scheduled_at
                            ? new Date(req.scheduled_at).toLocaleString('tr-TR', {
                                weekday: 'short',
                                day: 'numeric',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : req.created_at
                              ? new Date(req.created_at).toLocaleString('tr-TR', {
                                  day: 'numeric',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : '—'}
                      </Text>
                    </View>

                    {/* Estimated distance */}
                    {profile?.latitude != null && profile?.longitude != null &&
                     req.latitude != null && req.longitude != null && (
                      <View style={styles.requestRow}>
                        <Text style={styles.requestIcon}>📏</Text>
                        <Text style={styles.requestDistance}>
                          {haversineKm(
                            profile.latitude!, profile.longitude!,
                            req.latitude!, req.longitude!,
                          ).toFixed(1)} {t('provider.kmAway')}
                        </Text>
                      </View>
                    )}

                    {/* Customer note */}
                    {req.customer_note && (
                      <View style={styles.requestRow}>
                        <Text style={styles.requestIcon}>📝</Text>
                        <Text style={styles.requestNote} numberOfLines={3}>
                          {req.customer_note}
                        </Text>
                      </View>
                    )}

                    {/* Address / location summary */}
                    <View style={styles.requestRow}>
                      <Text style={styles.requestIcon}>📍</Text>
                      <Text style={styles.requestAddress} numberOfLines={2}>
                        {req.address
                          ? req.address
                          : req.latitude != null && req.longitude != null
                            ? `${req.latitude.toFixed(4)}, ${req.longitude.toFixed(4)}`
                            : t('provider.noLocation')}
                      </Text>
                    </View>

                    {/* Accept button */}
                    <TouchableOpacity
                      style={[
                        styles.acceptBtn,
                        acceptingId === req.id && styles.acceptBtnDisabled,
                      ]}
                      onPress={() => handleAccept(req.id)}
                      disabled={acceptingId !== null}
                      activeOpacity={0.85}
                    >
                      {acceptingId === req.id ? (
                        <Text style={styles.acceptBtnText}>{t('provider.accepting')}</Text>
                      ) : (
                        <Text style={styles.acceptBtnText}>{t('provider.acceptBooking')}</Text>
                      )}
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.previewLocationBtn}
                      onPress={() => {
                        if (req.latitude != null && req.longitude != null) {
                          setLocationPreview({ lat: req.latitude, lng: req.longitude });
                        } else {
                          setLocationPreview(null);
                        }
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.previewLocationBtnText}>{t('provider.previewLocation')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.rejectBtn,
                        rejectingId === req.id && styles.rejectBtnDisabled,
                      ]}
                      onPress={() => setRejectConfirmId(req.id)}
                      disabled={rejectingId !== null}
                      activeOpacity={0.85}
                    >
                      {rejectingId === req.id ? (
                        <Text style={styles.rejectBtnText}>{t('provider.rejecting')}</Text>
                      ) : (
                        <Text style={styles.rejectBtnText}>{t('provider.rejectBooking')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('provider.recentTitle')}</Text>
          {recentJobs.length === 0 ? (
            <EmptyState
              icon="💼"
              title={t('provider.recentEmptyTitle')}
              subtitle={t('provider.recentEmptySubtitle')}
            />
          ) : (
            <View style={styles.jobList}>
              {recentJobs.map(job => (
                <View key={job.id} style={styles.jobRow}>
                  <View style={styles.jobAvatar}>
                    <Text style={styles.jobAvatarText}>👤</Text>
                  </View>
                  <View style={styles.jobInfo}>
                    <Text style={styles.jobCustomer}>
                      {(job.profiles as any)?.full_name ?? t('provider.customerFallback')}
                    </Text>
                    <Text style={styles.jobDate}>
                      {job.completed_at
                        ? new Date(job.completed_at).toLocaleDateString()
                        : t('provider.inProgress')}
                    </Text>
                  </View>
                  <View style={styles.jobRight}>
                    {job.status === 'completed' && job.earning != null && (
                      <Text style={styles.jobEarning}>+₺{job.earning}</Text>
                    )}
                    <View style={[styles.jobStatus, { backgroundColor: job.status === 'completed' ? colors.accent + '25' : colors.warning + '25' }]}>
                      <Text style={[styles.jobStatusText, { color: job.status === 'completed' ? colors.accent : colors.warning }]}>
                        {t('common.bookingStatus.' + job.status)}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={showLogout}
        onClose={() => setShowLogout(false)}
        title={t('provider.logoutTitle')}
        message={t('provider.logoutMessage')}
        confirmLabel={t('provider.logoutConfirm')}
        cancelLabel={t('provider.logoutCancel')}
        onConfirm={handleLogout}
        confirmVariant="danger"
      />

      <Modal
        visible={!!rejectConfirmId}
        onClose={() => setRejectConfirmId(null)}
        title={t('provider.rejectConfirmTitle')}
        message={t('provider.rejectConfirmMessage')}
        confirmLabel={t('provider.rejectConfirmConfirm')}
        cancelLabel={t('provider.rejectConfirmCancel')}
        onConfirm={() => rejectConfirmId && handleReject(rejectConfirmId)}
        confirmVariant="danger"
      />

      <Modal
        visible={showProfileMenu}
        onClose={() => setShowProfileMenu(false)}
        title={t('provider.menuTitle')}
      >
        <View>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => { setShowProfileMenu(false); setShowProfilePanel(true); }}
            activeOpacity={0.7}
          >
            <Text style={styles.menuItemIcon}>👤</Text>
            <View style={styles.menuItemBody}>
              <Text style={styles.menuItemLabel}>{t('provider.menuProfile')}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => { setShowProfileMenu(false); setShowWorkingHours(true); }}
            activeOpacity={0.7}
          >
            <Text style={styles.menuItemIcon}>🕒</Text>
            <Text style={styles.menuItemLabel}>{t('provider.menuWorkingHours')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => { setShowProfileMenu(false); setShowEquipmentPricing(true); }}
            activeOpacity={0.7}
          >
            <Text style={styles.menuItemIcon}>🧰</Text>
            <Text style={styles.menuItemLabel}>{t('provider.menuEquipment')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={() => { setShowProfileMenu(false); setShowEquipmentPricing(true); }}
            activeOpacity={0.7}
          >
            <Text style={styles.menuItemIcon}>💰</Text>
            <Text style={styles.menuItemLabel}>{t('provider.menuPricing')}</Text>
          </TouchableOpacity>

          <View style={styles.menuDivider} />

          <TouchableOpacity
            style={[styles.menuItem, styles.menuItemDanger]}
            onPress={() => { setShowProfileMenu(false); setShowLogout(true); }}
            activeOpacity={0.7}
          >
            <Text style={styles.menuItemIcon}>🚪</Text>
            <Text style={[styles.menuItemLabel, styles.menuItemLabelDanger]}>
              {t('provider.menuLogout')}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        visible={showProfilePanel}
        onClose={() => setShowProfilePanel(false)}
        title={t('provider.menuProfile')}
      >
        <View>
          <View style={styles.profileRow}>
            <Text style={styles.profileRowLabel}>{t('provider.profileFullName')}</Text>
            <Text style={styles.profileRowValue}>{profile?.full_name || session?.user?.email || '—'}</Text>
          </View>
          <View style={styles.profileRow}>
            <Text style={styles.profileRowLabel}>{t('provider.profileEmail')}</Text>
            <Text style={styles.profileRowValue}>{profile?.email || session?.user?.email || '—'}</Text>
          </View>
          <View style={styles.profileRow}>
            <Text style={styles.profileRowLabel}>{t('settings.wishwashIdLabel')}</Text>
            {profile?.wishwash_id ? (
              <View style={styles.profileIdRow}>
                <Text style={styles.profileIdValue}>{profile.wishwash_id}</Text>
                <TouchableOpacity
                  style={styles.profileIdCopyBtn}
                  onPress={async () => {
                    try {
                      await navigator.clipboard.writeText(profile.wishwash_id);
                      showToast(t('settings.wishwashIdCopied'), 'success');
                    } catch {
                      showToast(t('settings.wishwashIdCopyFailed'), 'error');
                    }
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.profileIdCopyBtnText}>{t('settings.wishwashIdCopy')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={styles.profileIdUnavailable}>{t('provider.profileIdUnavailable')}</Text>
            )}
          </View>
          <Text style={styles.profileIdHelper}>{t('provider.profileIdHelper')}</Text>
          <TouchableOpacity
            style={styles.locationPreviewCloseBtn}
            onPress={() => setShowProfilePanel(false)}
            activeOpacity={0.85}
          >
            <Text style={styles.locationPreviewCloseBtnText}>
              {t('provider.locationPreviewClose')}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        visible={showWorkingHours}
        onClose={() => setShowWorkingHours(false)}
        title={t('provider.menuWorkingHours')}
      >
        <View>
          {profile && providerProfileId && (
            <AvailabilityCard
              providerProfileId={providerProfileId}
              onUpdated={fetchData}
            />
          )}
          <TouchableOpacity
            style={styles.locationPreviewCloseBtn}
            onPress={() => setShowWorkingHours(false)}
            activeOpacity={0.85}
          >
            <Text style={styles.locationPreviewCloseBtnText}>
              {t('provider.locationPreviewClose')}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        visible={showEquipmentPricing}
        onClose={() => setShowEquipmentPricing(false)}
        title={t('provider.menuEquipment')}
      >
        <View>
          {profile && providerProfileId && (
            <EquipmentAndPricing
              providerProfileId={providerProfileId}
              profileId={profile.id}
              initialEquipment={stats?.equipment ?? []}
              initialPrice={stats?.service_price ?? 450}
              completedJobs={stats?.completed_jobs ?? 0}
              onUpdated={fetchData}
            />
          )}
          <TouchableOpacity
            style={styles.locationPreviewCloseBtn}
            onPress={() => setShowEquipmentPricing(false)}
            activeOpacity={0.85}
          >
            <Text style={styles.locationPreviewCloseBtnText}>
              {t('provider.locationPreviewClose')}
            </Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <Modal
        visible={locationPreview !== undefined}
        onClose={() => setLocationPreview(undefined)}
        title={t('provider.locationPreviewTitle')}
      >
        {locationPreview ? (
          <View>
            <Text style={styles.locationPreviewSubtitle}>
              {t('provider.locationPreviewSubtitle')}
            </Text>
            <View style={styles.locationPreviewMapWrap}>
              <iframe
                title="location-preview"
                style={styles.locationPreviewIframe as any}
                src={`https://www.google.com/maps?q=${locationPreview.lat.toFixed(2)},${locationPreview.lng.toFixed(2)}&z=13&output=embed`}
                loading="lazy"
              />
            </View>
            <TouchableOpacity
              style={styles.locationPreviewCloseBtn}
              onPress={() => setLocationPreview(undefined)}
              activeOpacity={0.85}
            >
              <Text style={styles.locationPreviewCloseBtnText}>
                {t('provider.locationPreviewClose')}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <Text style={styles.locationPreviewUnavailableText}>
              {t('provider.locationPreviewUnavailable')}
            </Text>
            <TouchableOpacity
              style={styles.locationPreviewCloseBtn}
              onPress={() => setLocationPreview(undefined)}
              activeOpacity={0.85}
            >
              <Text style={styles.locationPreviewCloseBtnText}>
                {t('provider.locationPreviewClose')}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backIcon: { color: colors.textPrimary, fontSize: 24, lineHeight: 30, fontWeight: '300' },
  topTitle: { ...typography.h4 },
  topBarSpacer: { width: 36 },
  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  statusToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
    borderWidth: 1,
  },
  statusOnline: {
    backgroundColor: colors.accent + '15',
    borderColor: colors.accent + '50',
  },
  statusOffline: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusLabel: { ...typography.body, fontWeight: '600' },
  earningsRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  earningCard: {
    flex: 1,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
  },
  earningCardPrimary: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary + '40',
  },
  earningCardDark: {
    backgroundColor: colors.surfaceAlt,
    borderColor: colors.border,
  },
  earningLabel: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: 4 },
  earningAmount: { ...typography.h1, color: colors.textPrimary },
  earningMeta: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  statsRow: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    marginBottom: spacing.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  statCard: { flex: 1, padding: spacing.md, alignItems: 'center' },
  statCardBorder: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.border,
  },
  statValue: { ...typography.h2, color: colors.textPrimary },
  statLabel: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  acceptedCard: {
    backgroundColor: colors.accent + '12',
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.accent + '50',
    marginBottom: spacing.lg,
  },
  acceptedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  acceptedIcon: { fontSize: 24 },
  acceptedTitle: { ...typography.h3, color: colors.accent },
  acceptedSubtitle: { ...typography.body, fontWeight: '600', marginBottom: 2 },
  acceptedCustomer: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.md },
  viewLocationBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  viewLocationBtnDisabled: { opacity: 0.5 },
  viewLocationBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  dismissBtn: {
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  dismissBtnText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  onMyWayBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  onMyWayBtnDisabled: { opacity: 0.5 },
  onMyWayBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  onMyWayDone: {
    backgroundColor: colors.success,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  onMyWayDoneText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  arrivedBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  arrivedBtnDisabled: { opacity: 0.5 },
  arrivedBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  arrivedDone: {
    backgroundColor: colors.success,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  arrivedDoneText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  beforePhotoSection: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  beforePhotoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  beforePhotoTitle: {
    ...typography.h4,
    fontSize: 15,
  },
  beforePhotoBadge: {
    backgroundColor: colors.success,
    borderRadius: radii.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  beforePhotoBadgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  photoPreviewWrap: {
    borderRadius: radii.md,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  photoPreview: {
    width: '100%',
    height: 200,
    borderRadius: radii.md,
  },
  photoErrorBox: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  photoErrorText: {
    color: colors.error,
    fontSize: 13,
    fontWeight: '500',
  },
  photoPickBtn: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: spacing.sm,
  },
  photoPickBtnText: {
    color: colors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  photoUploadBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  photoUploadBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  photoUploadingBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  photoUploadingText: {
    ...typography.body,
    fontSize: 14,
  },
  photoRetryBtn: {
    backgroundColor: 'transparent',
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.error,
    marginBottom: spacing.sm,
  },
  photoRetryBtnText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  photoSuccessBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderRadius: radii.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  photoSuccessText: {
    color: colors.success,
    fontSize: 13,
    fontWeight: '500',
  },
  debugPanel: {
    backgroundColor: '#f3f4f6',
    borderRadius: radii.md,
    padding: spacing.sm,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  debugTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  debugRow: {
    fontSize: 11,
    color: '#374151',
    lineHeight: 16,
  },
  startWashBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  startWashBtnDisabled: {
    opacity: 0.6,
  },
  startWashBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  startWashDone: {
    backgroundColor: colors.success,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  startWashDoneText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  waitingApprovalBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  waitingApprovalText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
    textAlign: 'center',
  },
  customerApprovedBox: {
    backgroundColor: colors.success + '15',
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1.5,
    borderColor: colors.success + '50',
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  customerApprovedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  customerApprovedIcon: { fontSize: 28 },
  customerApprovedTitle: { ...typography.h3, color: colors.success },
  customerApprovedText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  closeJobBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  closeJobBtnDisabled: { opacity: 0.6 },
  closeJobBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  section: { marginBottom: spacing.xl },
  sectionTitle: { ...typography.h4, marginBottom: spacing.md },
  requestList: { gap: spacing.md },
  requestCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  requestHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  requestCustomerWrap: { flex: 1 },
  requestCustomerName: { ...typography.body, fontWeight: '700', color: colors.textPrimary, marginBottom: 2 },
  requestVehicleText: { ...typography.bodySmall, fontWeight: '600', color: colors.textSecondary },
  requestPlate: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  requestPrice: {
    ...typography.h3,
    color: colors.accent,
    fontWeight: '800',
  },
  requestRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs + 2,
  },
  requestIcon: { fontSize: 14, marginTop: 2 },
  requestService: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  requestExtras: { flex: 1, gap: 2 },
  requestExtraItem: { ...typography.bodySmall, color: colors.textSecondary },
  requestNote: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  requestAddress: { ...typography.bodySmall, color: colors.textSecondary, flex: 1 },
  requestTime: { ...typography.bodySmall, color: colors.textMuted },
  requestDistance: { ...typography.bodySmall, color: colors.primary, fontWeight: '600' },

  // In-app notification banner
  reservationBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: colors.primary + '12',
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
    gap: spacing.sm,
  },
  bannerIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary + '20',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bannerIcon: { fontSize: 20 },
  bannerBody: { flex: 1 },
  bannerTitle: { ...typography.body, fontWeight: '700', color: colors.primary, marginBottom: 2 },
  bannerText: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.sm },
  bannerBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'flex-start',
  },
  bannerBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  bannerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  bannerCloseIcon: { fontSize: 16, color: colors.textMuted, fontWeight: '600' },
  acceptBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  acceptBtnDisabled: { opacity: 0.6 },
  acceptBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  previewLocationBtn: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  previewLocationBtnText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  rejectBtn: {
    backgroundColor: 'transparent',
    borderRadius: radii.lg,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.error + '60',
  },
  rejectBtnDisabled: { opacity: 0.5 },
  rejectBtnText: {
    color: colors.error,
    fontSize: 14,
    fontWeight: '600',
  },
  locationPreviewSubtitle: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  locationPreviewMapWrap: {
    width: '100%',
    height: 260,
    borderRadius: radii.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.borderLight,
    marginBottom: spacing.md,
  },
  locationPreviewIframe: {
    width: '100%',
    height: '100%',
    border: 0,
  },
  locationPreviewUnavailableText: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  locationPreviewCloseBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  locationPreviewCloseBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  profileRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  profileRowLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  profileRowValue: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: '500',
  },
  profileIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  profileIdValue: {
    ...typography.body,
    fontWeight: '700',
    color: colors.primary,
    fontFamily: 'monospace',
    fontSize: 16,
  },
  profileIdCopyBtn: {
    backgroundColor: colors.primary + '1A',
    borderRadius: radii.sm,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  profileIdCopyBtnText: {
    color: colors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  profileIdUnavailable: {
    ...typography.body,
    color: colors.textMuted,
    fontStyle: 'italic',
  },
  profileIdHelper: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
    lineHeight: 18,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    gap: spacing.md,
  },
  menuItemBody: { flex: 1 },
  menuItemIcon: { fontSize: 22 },
  menuItemLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  menuItemHint: { ...typography.caption, color: colors.textMuted, marginTop: 2 },
  menuItemDanger: { backgroundColor: colors.error + '0D' },
  menuItemLabelDanger: { color: colors.error },
  menuDivider: {
    height: 1,
    backgroundColor: colors.borderLight,
    marginVertical: spacing.xs,
  },
  jobList: { gap: spacing.sm },
  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  jobAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobAvatarText: { fontSize: 18 },
  jobInfo: { flex: 1 },
  jobCustomer: { ...typography.body, fontWeight: '600', marginBottom: 2 },
  jobDate: { ...typography.bodySmall },
  jobRight: { alignItems: 'flex-end', gap: 4 },
  jobEarning: { ...typography.body, fontWeight: '700', color: colors.accent },
  jobStatus: { borderRadius: radii.full, paddingVertical: 3, paddingHorizontal: 10 },
  jobStatusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
});
