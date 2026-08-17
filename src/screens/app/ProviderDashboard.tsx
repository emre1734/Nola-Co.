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
import { getCurrentPosition } from '../../lib/native-gps';
import { useLocation } from '../../contexts/LocationContext';
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
  offer_id?: string | null;
  offer_expires_at?: string | null;
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

interface EdgeFnErrorBody {
  error?: string;
  current_status?: string;
  expected_status?: string;
}

async function parseEdgeFnError(error: unknown): Promise<EdgeFnErrorBody | null> {
  const ctx = (error as { context?: unknown }).context;
  if (ctx && typeof ctx === 'object' && 'json' in ctx && typeof (ctx as { json: unknown }).json === 'function') {
    try {
      return (await (ctx as Response).json()) as EdgeFnErrorBody;
    } catch {
      return null;
    }
  }
  return null;
}

function OfferCountdown({
  expiresAt,
  onExpire,
  labelTemplate,
  expiringLabel,
}: {
  expiresAt: string;
  onExpire: () => void;
  labelTemplate: string;
  expiringLabel: string;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => {
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(0, diff);
  });

  useEffect(() => {
    if (secondsLeft <= 0) {
      onExpire();
      return;
    }
    const timer = setInterval(() => {
      const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
      if (diff <= 0) {
        setSecondsLeft(0);
        onExpire();
      } else {
        setSecondsLeft(diff);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, onExpire]);

  const isUrgent = secondsLeft <= 10;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        background: isUrgent ? 'rgba(239,68,68,0.12)' : 'rgba(59,130,246,0.10)',
        color: isUrgent ? '#dc2626' : '#2563eb',
        marginBottom: 8,
        alignSelf: 'flex-start',
      }}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 12 16" />
      </svg>
      {isUrgent
        ? `${expiringLabel} · ${labelTemplate.replace('{{seconds}}', String(secondsLeft))}`
        : labelTemplate.replace('{{seconds}}', String(secondsLeft))}
    </div>
  );
}

export function ProviderDashboard({ onBack, onSignOut }: ProviderDashboardProps) {
  const { profile, session, signOut } = useAuth();
  const { showToast } = useToast();
  const { t } = useTranslation();
  const { requestLocation } = useLocation();
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
  const [multiJobError, setMultiJobError] = useState(false);
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

  // Active job state — a genuine jobs row in a blocking active status
  // (on_the_way, arrived, started, pending_approval). Terminal statuses are
  // NEVER restored here.
  const [activeJob, setActiveJob] = useState<{
    id: string;
    status: string;
    provider_id: string;
    booking_id: string;
    before_photo_url: string | null;
    after_photo_url: string | null;
    provider_closed_at: string | null;
  } | null>(null);

  // Booking details for the active job (fetched from the bookings table).
  // Only populated when activeJob is set. This keeps acceptedBooking
  // exclusively for newly accepted bookings that have no job row yet.
  const [activeJobBooking, setActiveJobBooking] = useState<BookingRequest | null>(null);

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

  // Ref mirror of acceptedBooking so the realtime UPDATE callback can check
  // whether a booking update belongs to the provider's own active booking
  // without depending on state (which would make the effect re-subscribe).
  const acceptedBookingRef = useRef<BookingRequest | null>(null);
  acceptedBookingRef.current = acceptedBooking;

  // Ref mirror of providerProfileId for account-switch detection in
  // fetchActiveBooking. If the provider changes mid-fetch, stale results
  // are discarded.
  const providerProfileIdRef = useRef<string | null>(null);
  providerProfileIdRef.current = providerProfileId;

  // Tracks the actual profile ID to detect real account switches vs.
  // token refreshes that create a new profile object reference with the
  // same ID. Prevents the [profile] effect from wiping photo state when
  // returning from the native camera.
  const profileIdRef = useRef<string | null | undefined>(null);

  // The booking to display in the active job card. When a genuine active
  // job exists, use its booking details (activeJobBooking). Otherwise fall
  // back to a newly accepted booking waiting for "On My Way".
  const displayBooking = activeJob ? activeJobBooking : acceptedBooking;

  // Generation counter: incremented when handleAccept succeeds. A stale
  // fetchActiveBooking that started before a new acceptance will see its
  // captured generation is outdated and must not overwrite acceptedBooking.
  const acceptGenRef = useRef(0);

  const fetchRequests = useCallback(async () => {
    if (!profile || !providerProfileId) return;
    const seq = ++fetchSeqRef.current;
    setRequestsError(null);
    setRequestsLoading(true);

    // Load only booking offers assigned to this provider that are pending
    // and not yet expired. Join through to bookings + customer profile.
    const { data, error } = await supabase
      .from('booking_offers')
      .select(`
        id,
        booking_id,
        status,
        expires_at,
        bookings!booking_offers_booking_id_fkey(
          id, customer_id, customer_note, address, created_at, scheduled_at,
          estimated_price, latitude, longitude, booking_date, booking_time, extra_services,
          profiles!bookings_customer_id_fkey(full_name),
          vehicles!bookings_vehicle_id_fkey(brand, model, plate, color),
          services!bookings_service_id_fkey(name, base_price)
        )
      `)
      .eq('provider_id', providerProfileId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('offered_at', { ascending: false })
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

    // Flatten the nested booking data into the BookingRequest shape
    // that the existing card UI expects.
    const offers = (data ?? []) as unknown as Array<{
      id: string;
      booking_id: string;
      status: string;
      expires_at: string;
      bookings: BookingRequest;
    }>;
    const allRequests = offers.map(o => ({
      ...o.bookings,
      id: o.booking_id,
      offer_id: o.id,
      offer_expires_at: o.expires_at,
    }));

    setRejectedBookingIds(new Set());
    setRequests(allRequests);
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

    const allJobs = (jobs as unknown as RecentJob[]) ?? [];
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

  // STATE PRIORITY (deterministic, single source of truth):
  //   1. activeJob        — a genuine jobs row in a blocking active status
  //   2. acceptedBooking  — a newly accepted booking with no job row yet
  //   3. requests         — pending booking_offers
  //   4. empty ready state
  //
  // Old terminal or abandoned reservations are never restored as active.
  // A pending offer never overwrites a genuine active job.
  // A stale active-job fetch never overwrites a newer accepted booking.
  //
  // Stale async protection: every invocation captures the current generation
  // counter and provider id. Before applying results we verify:
  //   - the generation hasn't changed (a newer accept happened)
  //   - the provider hasn't switched accounts
  //   - the result is still the latest request
  const fetchActiveBooking = useCallback(async (ppId: string) => {
    const gen = acceptGenRef.current;

    // ── Priority 1: genuine active job via get_state edge function ──
    // The jobs table is RLS-protected with no client-read policies, so we
    // cannot query it directly. Instead, find the provider's accepted
    // booking (bookings table IS readable via RLS) and call get_state to
    // retrieve the job row through the service-role edge function.
    const { data: acceptedBookings, error: acceptedErr } = await supabase
      .from('bookings')
      .select(`
        id, customer_id, customer_note, address, created_at, scheduled_at,
        estimated_price, latitude, longitude, booking_date, booking_time, extra_services,
        profiles!bookings_customer_id_fkey(full_name),
        vehicles!bookings_vehicle_id_fkey(brand, model, plate, color),
        services!bookings_service_id_fkey(name, base_price)
      `)
      .eq('provider_id', ppId)
      .eq('status', 'accepted')
      .order('accepted_at', { ascending: false });

    if (gen !== acceptGenRef.current || providerProfileIdRef.current !== ppId) return;

    if (acceptedErr) {
      console.error('[fetchActiveBooking] accepted booking query failed:', {
        code: acceptedErr.code,
        message: acceptedErr.message,
      });
      return;
    }

    // Call get_state for each accepted booking to find one with an active job.
    // get_state uses the service role (bypasses RLS) and returns the job row
    // if one exists for this booking, scoped to this provider.
    let activeJobData: {
      id: string;
      status: string;
      provider_id: string;
      before_photo_url: string | null;
      after_photo_url: string | null;
      provider_closed_at: string | null;
    } | null = null;
    let activeBookingId: string | null = null;

    for (const b of acceptedBookings ?? []) {
      try {
        const { data: stateData, error: stateError } = await supabase.functions.invoke('job-progress', {
          body: { booking_id: b.id, action: 'get_state' },
        });
        if (stateError || !stateData) continue;
        const job = stateData as {
          id?: string;
          status?: string;
          provider_id?: string;
          before_photo_url?: string | null;
          after_photo_url?: string | null;
          provider_closed_at?: string | null;
        } | null;
        if (job?.id && job.status) {
          const ACTIVE_JOB_STATUSES = ['on_the_way', 'arrived', 'started', 'pending_approval'];
          if (ACTIVE_JOB_STATUSES.includes(job.status)) {
            activeJobData = {
              id: job.id,
              status: job.status,
              provider_id: job.provider_id ?? '',
              before_photo_url: job.before_photo_url ?? null,
              after_photo_url: job.after_photo_url ?? null,
              provider_closed_at: job.provider_closed_at ?? null,
            };
            activeBookingId = b.id;
            break;
          }
        }
      } catch {
        // get_state returns 404 if no job exists for this booking — skip it.
      }
    }

    // Stale guard before applying results.
    if (gen !== acceptGenRef.current || providerProfileIdRef.current !== ppId) return;

    if (activeJobData && activeBookingId) {
      // Found a genuine active job. Fetch the full booking details.
      const bookingRow = (acceptedBookings ?? []).find(b => b.id === activeBookingId);
      if (!bookingRow) return;

      setActiveJob({
        id: activeJobData.id,
        status: activeJobData.status,
        provider_id: activeJobData.provider_id,
        booking_id: activeBookingId,
        before_photo_url: activeJobData.before_photo_url,
        after_photo_url: activeJobData.after_photo_url,
        provider_closed_at: activeJobData.provider_closed_at,
      });
      setActiveJobBooking(bookingRow as unknown as BookingRequest);
      setAcceptedBooking(null);

      // Restore workflow flags from the genuine job status.
      const st = activeJobData.status;
      setOnMyWayDone(['on_the_way', 'arrived', 'started', 'pending_approval'].includes(st));
      setArrivedDone(['arrived', 'started', 'pending_approval'].includes(st));
      setStartWashDone(['started', 'pending_approval'].includes(st));
      setSendApprovalDone(st === 'pending_approval');
      setCustomerApproved(false);
      if (activeJobData.before_photo_url) {
        setPhotoPreview(activeJobData.before_photo_url);
        setPhotoUploaded(true);
      }
      if (activeJobData.after_photo_url) {
        setAfterPhotoPreview(activeJobData.after_photo_url);
        setAfterPhotoUploaded(true);
      }
      return;
    }

    // ── No genuine active job: clear any stale activeJob ─────────────
    setActiveJob(null);
    setActiveJobBooking(null);

    // ── Priority 2: newly accepted booking waiting for On My Way ─────
    // All accepted bookings were checked via get_state and none had an
    // active job. The first one is a genuinely newly accepted booking
    // that hasn't progressed yet.
    const validBooking = (acceptedBookings && acceptedBookings.length > 0)
      ? acceptedBookings[0]
      : null;

    if (validBooking) {
      setAcceptedBooking(validBooking as unknown as BookingRequest);
      setOnMyWayDone(false);
      setArrivedDone(false);
      setStartWashDone(false);
      setSendApprovalDone(false);
      setCustomerApproved(false);
    } else {
      setAcceptedBooking(null);
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Guard: only clear and re-fetch if the actual profile ID changed.
      // Token refreshes (e.g. when the app returns from the native camera)
      // create a new profile object reference with the same ID — we must
      // NOT wipe photo state in that case.
      if (profileIdRef.current === profile?.id) return;
      profileIdRef.current = profile?.id;
      // Provider account switch: clear all previous provider state so
      // Emre and Vahit never share dashboard state.
      acceptGenRef.current++;
      setAcceptedBooking(null);
      setActiveJob(null);
      setActiveJobBooking(null);
      setRequests([]);
      setOnMyWayDone(false);
      setArrivedDone(false);
      setStartWashDone(false);
      setSendApprovalDone(false);
      setCustomerApproved(false);
      setPhotoFile(null);
      setPhotoPreview(null);
      setPhotoUploaded(false);
      setPhotoError(null);
      setAfterPhotoFile(null);
      setAfterPhotoPreview(null);
      setAfterPhotoUploaded(false);
      setAfterPhotoError(null);

      const ppId = await fetchData();
      if (ppId) await fetchActiveBooking(ppId);
      setLoadingData(false);
    })();
  }, [profile?.id]);

  // Acquire the physical device's current GPS location automatically when
  // the authenticated provider's dashboard initializes — before any "On My
  // Way" action. This populates the existing LocationContext state with a
  // fresh high-accuracy position so the app knows the phone's real location
  // from startup. Permission is checked/requested inside requestLocation
  // via the existing native-gps helper.
  useEffect(() => {
    if (!profile) return;
    requestLocation();
  }, [profile?.id, requestLocation]);

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
    if (!online || !providerProfileId) return;
    const channel = supabase
      .channel('booking_offers:provider')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'booking_offers',
          filter: `provider_id=eq.${providerProfileId}`,
        },
        () => {
          fetchRequestsRef.current();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'booking_offers',
          filter: `provider_id=eq.${providerProfileId}`,
        },
        () => {
          fetchRequestsRef.current();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'booking_offers',
          filter: `provider_id=eq.${providerProfileId}`,
        },
        () => {
          fetchRequestsRef.current();
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [online, providerProfileId]);

  // Poll every 10 seconds to remove expired offers from the list.
  // Realtime covers INSERT/UPDATE/DELETE, but expiry is time-based
  // and needs a periodic re-fetch to drop offers whose expires_at
  // has passed.
  useEffect(() => {
    if (!online || !providerProfileId) return;
    const interval = setInterval(() => {
      fetchRequestsRef.current();
    }, 10000);
    return () => clearInterval(interval);
  }, [online, providerProfileId]);

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

    const reqBooking = requests.find(r => r.id === bookingId);
    const offerId = reqBooking?.offer_id;

    if (!offerId) {
      console.error('[accept] no offer_id found for booking', bookingId);
      setAcceptingId(null);
      showToast(t('provider.errAcceptFailed'), 'error');
      fetchRequests();
      return;
    }

    // Single Active Job Rule: check before accepting
    if (providerProfileId) {
      const { data: activeJobs, error: activeJobsError } = await supabase
        .from('jobs')
        .select('id, status, booking_id')
        .eq('provider_id', providerProfileId)
        .in('status', ['on_the_way', 'arrived', 'started', 'pending_approval']);

      if (activeJobsError) {
        console.error('[accept] active-job check failed:', {
          code: activeJobsError.code,
          message: activeJobsError.message,
        });
        setAcceptingId(null);
        showToast(t('provider.errStatusRetry'), 'error');
        return;
      }

      if (activeJobs && activeJobs.length > 0) {
        setAcceptingId(null);
        showToast(t('provider.errActiveJob'), 'error');
        return;
      }
    }

    // Sprint 13.2: Check for reservation conflicts before accepting.
    if (reqBooking?.booking_date && reqBooking?.booking_time && providerProfileId) {
      const { data: activeBookings } = await supabase
        .from('bookings')
        .select('id, booking_date, booking_time, status, services!bookings_service_id_fkey(name)')
        .eq('provider_id', providerProfileId)
        .in('status', ACTIVE_STATUSES);

      const activeSlots = (activeBookings ?? []).map((b: { id: any; booking_date: any; booking_time: any; status: any; services: { name: any }[] }) => ({
        id: b.id,
        booking_date: b.booking_date,
        booking_time: b.booking_time,
        service_name: b.services?.[0]?.name ?? null,
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

    // Call the secure RPC — atomically accepts the offer, marks other
    // offers as accepted_elsewhere, and updates the booking. RLS
    // prevents direct client updates to booking_offers status.
    const { data: rpcResult, error: rpcError } = await supabase.rpc('accept_booking_offer', {
      p_offer_id: offerId,
    });

    if (rpcError) {
      console.error('[accept] RPC failed:', {
        code: rpcError.code,
        message: rpcError.message,
        details: rpcError.details,
        hint: rpcError.hint,
      });
      setAcceptingId(null);
      showToast(t('provider.errAcceptFailed'), 'error');
      return;
    }

    const result = rpcResult as { success: boolean; booking_id: string | null; error: string | null } | null;

    if (!result || !result.success) {
      setAcceptingId(null);
      const errMsg = result?.error ?? 'unknown';
      if (errMsg === 'booking_unavailable' || errMsg === 'offer_accepted_elsewhere') {
        showToast(t('provider.errAlreadyAccepted'), 'error');
      } else if (errMsg === 'offer_expired') {
        showToast(t('provider.errOfferExpired'), 'error');
      } else if (errMsg === 'offer_not_found') {
        showToast(t('provider.errBookingGone'), 'error');
      } else {
        showToast(t('provider.errAcceptFailed'), 'error');
      }
      fetchRequests();
      return;
    }

    const acceptedReq = requests.find(r => r.id === bookingId) ?? null;
    setAcceptingId(null);
    acceptGenRef.current++;
    setActiveJob(null);
    setActiveJobBooking(null);
    setOnMyWayDone(false);
    setArrivedDone(false);
    setStartWashDone(false);
    setSendApprovalDone(false);
    setCustomerApproved(false);
    setPhotoFile(null);
    setPhotoPreview(null);
    setPhotoUploaded(false);
    setPhotoError(null);
    setAfterPhotoFile(null);
    setAfterPhotoPreview(null);
    setAfterPhotoUploaded(false);
    setAfterPhotoError(null);
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
    if (!displayBooking) return;
    const { latitude, longitude, address } = displayBooking;
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
    if (!displayBooking || onMyWayUpdating || onMyWayDone) return;
    setOnMyWayUpdating(true);
    try {
      const { error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: displayBooking.id, action: 'on_my_way' },
      });
      if (error) {
        const err = error as { code?: string; message?: string; details?: unknown; hint?: unknown };
        console.error('[On My Way] Supabase update failed', {
          code: err.code,
          message: err.message,
          details: err.details,
          hint: err.hint,
        });
        const body = await parseEdgeFnError(error);
        const currentStatus = body?.current_status ?? '';
        if (currentStatus === 'completed' || currentStatus === 'cancelled') {
          showToast(t('provider.errJobAlreadyDone'), 'error');
          setAcceptedBooking(null);
          setActiveJob(null);
          setActiveJobBooking(null);
        } else if (body?.error) {
          showToast(t('provider.errJobStatusMismatch', { current: currentStatus, expected: body?.expected_status ?? '' }), 'error');
        } else {
          showToast(t('provider.errStatusRetry'), 'error');
        }
        return;
      }
      // Restore full state from the database. fetchActiveBooking atomically
      // sets activeJob, activeJobBooking, and all workflow flags from the
      // genuine job row. This ensures displayBooking resolves to
      // activeJobBooking (not null) so the card stays visible and the
      // Arrived button renders correctly.
      if (providerProfileId) {
        await fetchActiveBooking(providerProfileId);
      } else {
        setOnMyWayDone(true);
      }
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
    if (!displayBooking || arrivedUpdating || arrivedDone || !onMyWayDone) return;
    setArrivedUpdating(true);
    try {
      const { error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: displayBooking.id, action: 'arrived' },
      });
      if (error) {
        const err = error as { code?: string; message?: string; details?: unknown; hint?: unknown };
        console.error('[Arrived] Supabase update failed', {
          code: err.code,
          message: err.message,
          details: err.details,
          hint: err.hint,
        });
        const body = await parseEdgeFnError(error);
        const currentStatus = body?.current_status ?? '';
        if (currentStatus === 'completed' || currentStatus === 'cancelled') {
          showToast(t('provider.errJobAlreadyDone'), 'error');
          setAcceptedBooking(null);
          setActiveJob(null);
          setActiveJobBooking(null);
        } else if (body?.error) {
          showToast(t('provider.errJobStatusMismatch', { current: currentStatus, expected: body?.expected_status ?? '' }), 'error');
        } else {
          showToast(t('provider.errStatusRetry'), 'error');
        }
        return;
      }
      // Restore full state from the database. fetchActiveBooking atomically
      // sets activeJob, activeJobBooking, and all workflow flags
      // (onMyWayDone, arrivedDone, etc.) from the genuine job row. This
      // ensures displayBooking resolves to activeJobBooking (not null)
      // so the card stays visible and the before-photo workflow renders.
      if (providerProfileId) {
        await fetchActiveBooking(providerProfileId);
      } else {
        setArrivedDone(true);
      }
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

  // Live GPS broadcast: while the washer is "on the way", periodically get
  // their GPS position and upsert it into provider_live_locations so the
  // customer's tracking map can subscribe via Realtime. Starts when
  // onMyWayDone becomes true, stops when arrivedDone becomes true or the
  // booking is cleared.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    let stopped = false;

    let gpsInFlight = false;
    let lastGpsErrCode: number | null = null;
    let upsertToastShown = false;

    const stopBroadcast = () => {
      stopped = true;
      if (intervalId != null) clearInterval(intervalId);
      intervalId = null;
      lastLatRef.current = null;
      lastLngRef.current = null;
      lastLocationSentRef.current = 0;
    };

    if (!onMyWayDone || arrivedDone || !displayBooking || !providerProfileId) {
      stopBroadcast();
      return;
    }

    const sendLocation = (lat: number, lng: number) => {
      supabase
        .from('provider_live_locations')
        .upsert({
          booking_id: displayBooking.id,
          job_id: activeJob?.id ?? null,
          provider_id: providerProfileId,
          lat,
          lng,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'booking_id' })
        .then(() => { upsertToastShown = false; }, (e: unknown) => {
          console.error('[GPS] live location upsert failed', e);
          if (!upsertToastShown) {
            upsertToastShown = true;
            try {
              showToastRef.current('Canlı konum sunucuya gönderilemedi. İnternet bağlantınızı kontrol edin.', 'error');
            } catch {
              // toast must never throw
            }
          }
        });
    };

    const poll = () => {
      if (stopped || gpsInFlight) return;
      gpsInFlight = true;
      console.log('TRACKING_GPS_5S_UPDATE');
      getCurrentPosition(
        (pos) => {
          gpsInFlight = false;
          lastGpsErrCode = null;
          const { latitude, longitude } = pos.coords;
          lastLatRef.current = latitude;
          lastLngRef.current = longitude;
          console.log('TRACKING_LOCATION_PUBLISHED', { latitude, longitude });
          sendLocation(latitude, longitude);
        },
        (err) => {
          gpsInFlight = false;
          console.log('TRACKING_GPS_ERROR', { code: err.code, message: err.message });
          console.error('[GPS] error', { code: err.code, message: err.message });
          if (err.code === 1) {
            try {
              showToastRef.current(tRef.current('provider.errGpsDenied'), 'error');
            } catch {
              // toast must never throw
            }
          } else if (err.code === 3) {
            if (lastGpsErrCode !== 3) {
              lastGpsErrCode = 3;
              try {
                showToastRef.current('GPS konumu zamanında alınamadı. Konum tekrar deneniyor.', 'error');
              } catch {
                // toast must never throw
              }
            }
          } else if (err.code === 2) {
            if (lastGpsErrCode !== 2) {
              lastGpsErrCode = 2;
              try {
                showToastRef.current('GPS konumu şu anda alınamıyor. Konum servisinizin açık olduğundan emin olun.', 'error');
              } catch {
                // toast must never throw
              }
            }
          } else {
            lastGpsErrCode = null;
          }
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
      );
    };

    console.log('TRACKING_EXACT_LOCATION_STARTED', { bookingId: displayBooking.id });
    // Send immediately, then every 5 seconds.
    poll();
    intervalId = setInterval(poll, 5000);

    return () => {
      stopBroadcast();
    };
  }, [onMyWayDone, arrivedDone, displayBooking, providerProfileId, activeJob?.id]);

  // Fetch any existing before_photo_url for the active job so the step
  // stays completed across refreshes. Also captures full job state for
  // Start Wash visibility checks.
  const refreshJobPhoto = useCallback(async () => {
    if (!displayBooking || !profile) return;
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: displayBooking.id, action: 'get_state' },
      });
      if (error) {
        console.error('[before-photo] get_state failed;', {
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
          booking_id: displayBooking.id,
          before_photo_url: job.before_photo_url ?? null,
          after_photo_url: job.after_photo_url ?? null,
          provider_closed_at: null,
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
  }, [displayBooking, profile]);

  useEffect(() => {
    if (arrivedDone && displayBooking) {
      refreshJobPhoto();
    }
  }, [arrivedDone, displayBooking, refreshJobPhoto]);

  // Development-only: trace photoFile state changes to diagnose the
  // native camera → state bridge.
  useEffect(() => {
    console.log('[before-photo] photoFile state changed', {
      hasFile: !!photoFile,
      size: photoFile?.size,
      name: photoFile?.name,
      type: photoFile?.type,
    });
  }, [photoFile]);

  // Poll get_state while waiting for customer approval so the partner UI
  // flips to "Customer Approved" automatically once the customer approves.
  // Only polls while sendApprovalDone is true and the customer hasn't
  // approved yet. Stops once customerApproved is set.
  useEffect(() => {
    if (!displayBooking || !sendApprovalDone || customerApproved) return;
    const interval = setInterval(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('job-progress', {
          body: { booking_id: displayBooking.id, action: 'get_state' },
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
  }, [displayBooking, sendApprovalDone, customerApproved, showToast]);

  // handleCloseCompletedJob: Washer acknowledges a customer-approved
  // completed job and clears it from the dashboard. Persisted via the
  // job-progress edge function (sets jobs.provider_closed_at). The booking
  // stays "accepted" and the job stays "completed" — no data is deleted.
  const handleCloseCompletedJob = useCallback(async () => {
    if (!displayBooking || closingJob || !customerApproved) return;
    setClosingJob(true);
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: displayBooking.id, action: 'close_job' },
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
      setActiveJobBooking(null);
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
  }, [displayBooking, closingJob, customerApproved, showToast]);

  const handlePickPhoto = async () => {
    console.log('[before-photo] pick started');
    setPhotoError(null);
    try {
      const file = await pickJobPhoto();
      console.log('[before-photo] File received from pickJobPhoto', {
        size: file?.size,
        type: file?.type,
        name: file?.name,
      });
      if (!file) return;
      const validationError = validateJobPhoto(file);
      if (validationError) {
        console.error('[before-photo] validation failed:', validationError);
        setPhotoError(validationError);
        showToast(validationError, 'error');
        return;
      }
      console.log('[before-photo] validation passed, setting photoFile');
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
      setPhotoUploaded(false);
    } catch {
      console.error('[before-photo] pick error');
      showToast(t('provider.errCamera'), 'error');
    }
  };

  const handleUploadPhoto = async () => {
    if (!photoFile || !displayBooking || !profile || photoUploading) return;
    console.log('[before-photo] upload started', { size: photoFile.size, type: photoFile.type });
    setPhotoUploading(true);
    setPhotoError(null);
    try {
      // 1. Use the active job ID directly — this is the exact job displayed
      //    in the UI and restored from the database. Fall back to get_state
      //    only if activeJob.id is missing (defensive).
      let jobId = activeJob?.id;
      if (!jobId) {
        const { data: stateData, error: stateError } = await supabase.functions.invoke('job-progress', {
          body: { booking_id: displayBooking.id, action: 'get_state' },
        });
        if (stateError || !stateData) {
          const err = stateError as { code?: string; message?: string } | null;
          console.error('[before-photo] get_state fallback failed:', {
            code: err?.code,
            message: err?.message,
          });
          setPhotoError(t('provider.errVerifyJob'));
          showToast(t('provider.errVerifyJob'), 'error');
          return;
        }
        jobId = (stateData as { id?: string }).id;
      }
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
      console.log('[before-photo] storage upload succeeded', { url });

      // 3. Save the URL via edge function (re-checks ownership + status).
      const { data: saveData, error: saveError } = await supabase.functions.invoke('job-progress', {
        body: {
          booking_id: displayBooking.id,
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
      console.log('[before-photo] before_photo_url saved');

      // 4. Re-fetch the job to confirm before_photo_url is persisted and
      //    update activeJob so Start Wash visibility re-evaluates.
      const { data: confirmed, error: confirmError } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: displayBooking.id, action: 'get_state' },
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
        after_photo_url?: string | null;
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
          booking_id: displayBooking.id,
          before_photo_url: confirmedUrl,
          after_photo_url: confirmedJob?.after_photo_url ?? null,
          provider_closed_at: null,
        });
      }

      setPhotoUploaded(true);
      setPhotoPreview(confirmedUrl);
      console.log('[before-photo] workflow advanced', { confirmedUrl });
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
    if (!displayBooking) return requests;
    // Only apply conflict filtering when the job is in an active (non-terminal)
    // state. A completed job must not block new booking requests from appearing.
    const jobStatus = activeJob?.status ?? 'accepted';
    if (!ACTIVE_STATUSES.includes(jobStatus)) return requests;
    const activeSlots: ActiveBooking[] = [{
      id: displayBooking.id,
      booking_date: displayBooking.booking_date ?? null,
      booking_time: displayBooking.booking_time ?? null,
      service_name: displayBooking.services?.name ?? null,
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
  }, [requests, displayBooking, activeJob]);

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
    if (!displayBooking || sendApprovalUpdating || sendApprovalDone || !canSendForApproval) return;
    setSendApprovalUpdating(true);
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: displayBooking.id, action: 'send_for_approval' },
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
    if (!afterPhotoFile || !displayBooking || !profile || afterPhotoUploading) return;
    setAfterPhotoUploading(true);
    setAfterPhotoError(null);

    try {
      // 1. Use the active job ID directly — this is the exact job displayed
      //    in the UI and restored from the database. Fall back to get_state
      //    only if activeJob.id is missing (defensive).
      let jobId = activeJob?.id;
      if (!jobId) {
        const { data: stateData, error: stateError } = await supabase.functions.invoke('job-progress', {
          body: { booking_id: displayBooking.id, action: 'get_state' },
        });
        if (stateError || !stateData) {
          const err = stateError as { code?: string; message?: string } | null;
          console.error('[after-photo] get_state fallback failed:', {
            code: err?.code,
            message: err?.message,
          });
          setAfterPhotoError(t('provider.errVerifyJob'));
          showToast(t('provider.errVerifyJob'), 'error');
          return;
        }
        jobId = (stateData as { id?: string }).id;
      }
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
          booking_id: displayBooking.id,
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


      // 4. Re-fetch the job to confirm after_photo_url is persisted.
      const { data: confirmed, error: confirmError } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: displayBooking.id, action: 'get_state' },
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
          booking_id: displayBooking.id,
          before_photo_url: confirmedJob.before_photo_url ?? null,
          after_photo_url: confirmedUrl,
          provider_closed_at: null,
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

  };

  const handleStartWash = async () => {
    if (!displayBooking || startWashUpdating || startWashDone || !canStartWash) return;
    setStartWashUpdating(true);
    try {
      const { data, error } = await supabase.functions.invoke('job-progress', {
        body: { booking_id: displayBooking.id, action: 'start_wash' },
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
      // Update the booking_offer status to rejected. RLS allows
      // pending → rejected from the client (Sprint 1 policy).
      const { error } = await supabase
        .from('booking_offers')
        .update({ status: 'rejected', responded_at: new Date().toISOString() })
        .eq('booking_id', bookingId)
        .eq('provider_id', providerProfileId)
        .eq('status', 'pending');
      if (error) {
        console.error('[reject] offer update failed:', {
          code: error.code,
          message: error.message,
        });
        showToast(t('provider.errRejectFailed'), 'error');
        setRejectingId(null);
        return;
      }
      // Only remove the card after the DB write succeeds.
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

  const hasCoords = displayBooking?.latitude != null && displayBooking?.longitude != null;
  const canViewLocation = hasCoords || !!displayBooking?.address;

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

  if (multiJobError) {
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
          message={t('provider.errMultipleActiveJobs')}
          onRetry={onRefresh}
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
        {displayBooking && (
          <View style={styles.acceptedCard}>
            <View style={styles.acceptedHeader}>
              <Text style={styles.acceptedIcon}>✅</Text>
              <Text style={styles.acceptedTitle}>{t('provider.acceptedTitle')}</Text>
            </View>
            <Text style={styles.acceptedSubtitle}>
              {displayBooking.vehicles?.brand ?? ''} {displayBooking.vehicles?.model ?? ''}
              {displayBooking.vehicles?.plate ? ` — ${displayBooking.vehicles.plate}` : ''}
            </Text>
            <Text style={styles.acceptedCustomer}>
              {t('provider.customerPrefix')}{displayBooking.profiles?.full_name ?? t('provider.unknown')}
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
                : displayBooking.address
                  ? t('provider.viewAddress')
                  : t('provider.locationUnavailable')}
              </Text>
            </TouchableOpacity>
            {/* On My Way button: only for a newly accepted booking that has
                NOT yet progressed to a job row. When a genuine active job
                exists (restored from DB), the workflow flags already reflect
                the correct stage — never show On My Way for an arrived or
                started job. */}
            {!onMyWayDone && !activeJob ? (
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
                    <View style={styles.startWashBtn}>
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

            {!sendApprovalDone && !customerApproved && !activeJob && (
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

                    {/* Offer countdown timer */}
                    {req.offer_expires_at && (
                      <OfferCountdown
                        expiresAt={req.offer_expires_at}
                        onExpire={() => {
                          setRequests(prev => prev.filter(r => r.id !== req.id));
                        }}
                        labelTemplate={t('provider.offerCountdown')}
                        expiringLabel={t('provider.offerExpiring')}
                      />
                    )}

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
        visible={locationPreview !== null}
        onClose={() => setLocationPreview(null)}
        title={t('provider.locationPreviewTitle')}
      >
        {locationPreview && Number.isFinite(locationPreview.lat) && Number.isFinite(locationPreview.lng) ? (
          <View>
            <Text style={styles.locationPreviewSubtitle}>
              {t('provider.locationPreviewSubtitle')}
            </Text>
            <View style={styles.locationPreviewMapWrap}>
              <iframe
                title="location-preview"
                style={styles.locationPreviewIframe as any}
                src={`https://maps.google.com/maps?q=${encodeURIComponent(locationPreview.lat.toFixed(2))},${encodeURIComponent(locationPreview.lng.toFixed(2))}&z=13&output=embed`}
                loading="lazy"
              />
            </View>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${locationPreview.lat.toFixed(2)},${locationPreview.lng.toFixed(2)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', textAlign: 'center', padding: '10px 0', color: '#fff', backgroundColor: '#2563eb', borderRadius: 8, fontWeight: 700, fontSize: 15, marginBottom: 10, textDecoration: 'none' }}
            >
              {t('provider.locationPreviewOpenInMaps')}
            </a>
            <TouchableOpacity
              style={styles.locationPreviewCloseBtn}
              onPress={() => setLocationPreview(null)}
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
              onPress={() => setLocationPreview(null)}
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
    borderWidth: 0,
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
