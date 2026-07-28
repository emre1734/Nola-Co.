import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Image,
} from 'react-native';
import { Button, EmptyState, Loading } from '../../components/ui';
import { LegalInfoScreen, AcceptanceCheckbox, type LegalSection } from '../../components/LegalInfo';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { colors, spacing, typography, radii } from '../../theme';
import { GoogleMapView } from '../../components/map/GoogleMapView';
import { DateTimePicker } from '../../components/DateTimePicker';
import type { ReverseGeocodeResult } from '../../lib/google-maps';
import { useTranslation } from '../../i18n/useTranslation';
import { WasherTrackingMap } from '../../components/WasherTrackingMap';

interface BookingScreenProps {
  onBack: () => void;
  onComplete: () => void;
}

interface Vehicle {
  id: string;
  brand: string;
  model: string;
  vehicle_type: string | null;
  color: string | null;
  plate: string;
  image_url: string | null;
}

interface Service {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  estimated_duration: number | null;
}

interface ExtraService {
  id: string;
  name: string;
  price: number;
}

const EXTRA_SERVICES: ExtraService[] = [
  { id: 'tire_shine', name: 'Tire Shine', price: 25 },
  { id: 'window_protection', name: 'Window Protection', price: 35 },
  { id: 'ceramic_spray', name: 'Ceramic Spray', price: 60 },
  { id: 'seat_cleaning', name: 'Seat Cleaning', price: 45 },
  { id: 'engine_cleaning', name: 'Engine Cleaning', price: 50 },
];

// Extras step is hidden for the MVP release. The implementation is kept
// intact so Extras can be re-enabled by adding 'Extras' back to STEPS.
const EXTRAS_ENABLED = false;
const STEPS = (EXTRAS_ENABLED
  ? ['Vehicle', 'Service', 'Extras', 'Location', 'DateTime', 'Review']
  : ['Vehicle', 'Service', 'Location', 'DateTime', 'Review']) as const;

export function BookingScreen({ onBack, onComplete }: BookingScreenProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { showToast } = useToast();

  const [step, setStep] = useState(0);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);
  const [bookingLocation, setBookingLocation] = useState<{
    lat: number;
    lng: number;
    address: ReverseGeocodeResult;
  } | null>(null);
  const [bookingDate, setBookingDate] = useState<string | null>(null);
  const [bookingTime, setBookingTime] = useState<string | null>(null);

  // Booking-flow acceptance — kept in component state only, so it resets
  // when the booking flow is closed. Not persisted anywhere.
  const [acceptedServiceInfo, setAcceptedServiceInfo] = useState(false);
  const [acceptedPrecautions, setAcceptedPrecautions] = useState(false);
  const [legalView, setLegalView] = useState<'serviceInfo' | 'precautions' | null>(null);

  // Tracking card: shown when the customer has an active booking whose job
  // status is exactly 'on_the_way'. This is a shortcut to the existing
  // WasherTrackingMap — it does NOT participate in the booking wizard.
  const [trackingBookingId, setTrackingBookingId] = useState<string | null>(null);
  const [showTrackingMap, setShowTrackingMap] = useState(false);

  const SERVICE_INFO_SECTIONS: LegalSection[] = [
    {
      heading: t('booking.legal.includedTitle'),
      body: t('booking.legal.includedBody'),
    },
    {
      heading: t('booking.legal.howItWorksTitle'),
      body: t('booking.legal.howItWorksBody'),
    },
    {
      heading: t('booking.legal.pricingTitle'),
      body: t('booking.legal.pricingBody'),
    },
    {
      heading: t('booking.legal.approvalTitle'),
      body: t('booking.legal.approvalBody'),
    },
    {
      heading: t('booking.legal.cancellationsTitle'),
      body: t('booking.legal.cancellationsBody'),
    },
  ];

  const PRECAUTIONS_SECTIONS: LegalSection[] = [
    {
      heading: t('booking.legal.removeValuablesTitle'),
      body: t('booking.legal.removeValuablesBody'),
    },
    {
      heading: t('booking.legal.secureVehicleTitle'),
      body: t('booking.legal.secureVehicleBody'),
    },
    {
      heading: t('booking.legal.noteDamageTitle'),
      body: t('booking.legal.noteDamageBody'),
    },
    {
      heading: t('booking.legal.provideAccessTitle'),
      body: t('booking.legal.provideAccessBody'),
    },
    {
      heading: t('booking.legal.beReachableTitle'),
      body: t('booking.legal.beReachableBody'),
    },
  ];

  const fetchData = useCallback(async () => {
    const [{ data: vData, error: vErr }, { data: sData, error: sErr }] = await Promise.all([
      supabase.from('vehicles').select('id, brand, model, vehicle_type, color, plate, image_url').order('created_at', { ascending: false }),
      supabase.from('services').select('id, name, description, base_price, estimated_duration').eq('is_active', true).order('base_price', { ascending: true }),
    ]);

    if (vErr || sErr) {
      showToast(t('booking.errLoadData'), 'error');
      return;
    }
    setVehicles((vData as Vehicle[]) ?? []);
    setServices((sData as Service[]) ?? []);
  }, [showToast]);

  // Check whether the customer has an active booking with job status
  // 'on_the_way'. Uses the service-role-free RLS-protected query — the
  // customer can only see their own bookings.
  const fetchTrackingBooking = useCallback(async () => {
    if (!session) return;
    const { data, error } = await supabase
      .from('bookings')
      .select('id')
      .eq('customer_id', session.user.id)
      .eq('status', 'accepted')
      .not('provider_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error || !data || data.length === 0) {
      setTrackingBookingId(null);
      return;
    }
    const bookingIds = data.map(b => b.id);
    const { data: jobs, error: jobErr } = await supabase
      .from('jobs')
      .select('id, booking_id, status')
      .in('booking_id', bookingIds)
      .eq('status', 'on_the_way')
      .order('created_at', { ascending: false })
      .limit(1);
    if (jobErr || !jobs || jobs.length === 0) {
      setTrackingBookingId(null);
      return;
    }
    setTrackingBookingId(jobs[0].booking_id);
  }, [session]);

  // Realtime: listen for job status changes to auto-close the tracking
  // modal and hide the card when the washer arrives or the job ends.
  useEffect(() => {
    if (!trackingBookingId) return;
    const channel = supabase
      .channel(`booking-tracking:${trackingBookingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'jobs',
          filter: `booking_id=eq.${trackingBookingId}`,
        },
        (payload) => {
          const updated = payload.new as { status: string };
          if (updated.status !== 'on_the_way') {
            setShowTrackingMap(false);
            setTrackingBookingId(null);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [trackingBookingId]);

  useEffect(() => {
    fetchData().finally(() => setLoading(false));
    fetchTrackingBooking();
  }, [fetchData, fetchTrackingBooking]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), fetchTrackingBooking()]);
    setRefreshing(false);
  };

  const toggleExtra = (id: string) => {
    setSelectedExtras(prev => (prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]));
  };

  const extrasTotal = useMemo(
    () => EXTRA_SERVICES.filter(e => selectedExtras.includes(e.id)).reduce((sum, e) => sum + e.price, 0),
    [selectedExtras],
  );

  const grandTotal = (selectedService?.base_price ?? 0) + extrasTotal;

  const canProceed = useMemo(() => {
    const current = STEPS[step];
    if (current === 'Vehicle') return !!selectedVehicle;
    if (current === 'Service') return !!selectedService;
    if (current === 'Location') return !!bookingLocation;
    if (current === 'DateTime') return !!bookingDate && !!bookingTime;
    return true;
  }, [step, selectedVehicle, selectedService, bookingLocation, bookingDate, bookingTime]);

  const handleNext = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
  };

  const handleBack = () => {
    if (step === 0) {
      onBack();
    } else {
      setStep(step - 1);
    }
  };

  const handleSubmit = async () => {
    if (!session || !selectedVehicle || !selectedService) return;
    if (!bookingDate || !bookingTime) {
      showToast(t('booking.errNoDate'), 'error');
      return;
    }
    if (!acceptedServiceInfo || !acceptedPrecautions) {
      showToast(t('booking.errAcceptBoxes'), 'error');
      return;
    }
    setSubmitting(true);

    const extrasData = EXTRA_SERVICES.filter(e => selectedExtras.includes(e.id));

    const { data: insertData, error } = await supabase.from('bookings').insert({
      customer_id: session.user.id,
      vehicle_id: selectedVehicle.id,
      service_id: selectedService.id,
      status: 'waiting',
      estimated_price: grandTotal,
      extra_services: extrasData.length > 0 ? extrasData : null,
      latitude: bookingLocation?.lat ?? null,
      longitude: bookingLocation?.lng ?? null,
      address: bookingLocation?.address.fullAddress ?? null,
      booking_date: bookingDate,
      booking_time: bookingTime,
    }).select('id').maybeSingle();

    setSubmitting(false);

    if (error || !insertData) {
      showToast(t('booking.errCreateBooking') + (error?.message ?? ''), 'error');
      return;
    }

    // Broadcast the new booking to nearby eligible partners via push
    // notification. Fire-and-forget — notification failure must never
    // block booking creation.
    supabase.functions.invoke('push-notifications', {
      body: { action: 'broadcast_new_booking', booking_id: insertData.id },
    }).catch((err) => console.error('Push broadcast failed:', err));

    showToast(t('booking.successCreated'), 'success');
    onComplete();
  };

  if (loading) return <Loading fullScreen message={t('booking.loading')} />;

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={handleBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('booking.title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Step indicator */}
      <View style={styles.stepBar}>
        {STEPS.map((s, i) => (
          <React.Fragment key={s}>
            <View style={[styles.stepDot, i <= step && styles.stepDotActive]}>
              <Text style={[styles.stepDotText, i <= step && styles.stepDotTextActive]}>{i + 1}</Text>
            </View>
            {i < STEPS.length - 1 && <View style={[styles.stepLine, i < step && styles.stepLineActive]} />}
          </React.Fragment>
        ))}
      </View>
      <View style={styles.stepLabels}>
        {STEPS.map((s, i) => (
          <Text key={s} style={[styles.stepLabel, i === step && styles.stepLabelActive]}>
            {t(`booking.step${s.charAt(0).toUpperCase() + s.slice(1)}`)}
          </Text>
        ))}
      </View>

      {/* Tracking card — shown only when the customer has an active booking
          with job status 'on_the_way'. Sits between the step indicator and
          the booking wizard content. Does NOT participate in the wizard. */}
      {trackingBookingId && (
        <View style={styles.trackingCardWrap}>
          <View style={styles.trackingCard}>
            <View style={styles.trackingCardHeader}>
              <View style={styles.trackingIconWrap}>
                <Text style={styles.trackingIcon}>🚗</Text>
              </View>
              <View style={styles.trackingCardInfo}>
                <Text style={styles.trackingCardTitle}>{t('booking.trackingCardTitle')}</Text>
                <Text style={styles.trackingCardDesc}>{t('booking.trackingCardDesc')}</Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.trackingBtn}
              onPress={() => setShowTrackingMap(true)}
              activeOpacity={0.85}
            >
              <Text style={styles.trackingBtnText}>{t('booking.trackingCardBtn')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Step: Select Location — map renders outside ScrollView for proper touch */}
      {STEPS[step] === 'Location' && !bookingLocation && (
        <View style={styles.mapStepFull}>
          <GoogleMapView
            onConfirm={(loc) => setBookingLocation(loc)}
            showConfirmButton={true}
            showSearch={true}
            title={t('booking.mapTitle')}
          />
        </View>
      )}

      {/* For all other steps (and Location with confirmed location), use ScrollView */}
      {!(STEPS[step] === 'Location' && !bookingLocation) && (
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Step: Select Vehicle */}
        {STEPS[step] === 'Vehicle' && (
          <View>
            <Text style={styles.sectionTitle}>{t('booking.selectVehicle')}</Text>
            {vehicles.length === 0 ? (
              <EmptyState
                icon="🚗"
                title={t('booking.noVehicles')}
                subtitle={t('booking.noVehiclesSubtitle')}
                actionLabel={t('booking.goBack')}
                onAction={onBack}
              />
            ) : (
              <View style={styles.cardList}>
                {vehicles.map(v => (
                  <TouchableOpacity
                    key={v.id}
                    style={[styles.selectCard, selectedVehicle?.id === v.id && styles.selectCardActive]}
                    onPress={() => setSelectedVehicle(v)}
                    activeOpacity={0.85}
                  >
                    <View style={styles.vehicleImageWrap}>
                      {v.image_url ? (
                        <Image source={{ uri: v.image_url }} style={styles.vehicleImage} />
                      ) : (
                        <View style={styles.vehicleImagePlaceholder}>
                          <Text style={styles.vehicleImageEmoji}>🚗</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.vehicleInfo}>
                      <Text style={styles.vehicleName}>
                        {v.brand} {v.model}
                      </Text>
                      <Text style={styles.vehiclePlate}>{v.plate}</Text>
                    </View>
                    <View style={[styles.radio, selectedVehicle?.id === v.id && styles.radioActive]}>
                      {selectedVehicle?.id === v.id && <View style={styles.radioDot} />}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Step: Select Service */}
        {STEPS[step] === 'Service' && (
          <View>
            <Text style={styles.sectionTitle}>{t('booking.chooseService')}</Text>
            <View style={styles.cardList}>
              {services.map(svc => (
                <TouchableOpacity
                  key={svc.id}
                  style={[styles.serviceCard, selectedService?.id === svc.id && styles.serviceCardActive]}
                  onPress={() => setSelectedService(svc)}
                  activeOpacity={0.85}
                >
                  <View style={styles.serviceHeader}>
                    <Text style={styles.serviceName}>{svc.name}</Text>
                    <Text style={styles.servicePrice}>₺{Number(svc.base_price)}</Text>
                  </View>
                  {svc.description && <Text style={styles.serviceDesc}>{svc.description}</Text>}
                  <View style={styles.serviceMeta}>
                    <Text style={styles.serviceDuration}>{t('booking.durationPrefix')}{svc.estimated_duration ?? 60} {t('booking.minSuffix')}</Text>
                    <View style={[styles.radio, selectedService?.id === svc.id && styles.radioActive]}>
                      {selectedService?.id === svc.id && <View style={styles.radioDot} />}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Step: Select Extras — hidden in MVP (EXTRAS_ENABLED=false) */}
        {STEPS[step] === 'Extras' && (
          <View>
            <Text style={styles.sectionTitle}>{t('booking.addExtras')}</Text>
            <Text style={styles.sectionSubtitle}>{t('booking.extrasSubtitle')}</Text>
            <View style={styles.cardList}>
              {EXTRA_SERVICES.map(extra => {
                const isSelected = selectedExtras.includes(extra.id);
                return (
                  <TouchableOpacity
                    key={extra.id}
                    style={[styles.extraCard, isSelected && styles.extraCardActive]}
                    onPress={() => toggleExtra(extra.id)}
                    activeOpacity={0.85}
                  >
                    <View style={[styles.checkbox, isSelected && styles.checkboxActive]}>
                      {isSelected && <Text style={styles.checkmark}>✓</Text>}
                    </View>
                    <View style={styles.extraInfo}>
                      <Text style={styles.extraName}>{t(`booking.extra${extra.id.charAt(0).toUpperCase() + extra.id.slice(1)}`)}</Text>
                      <Text style={styles.extraPrice}>+₺{extra.price}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Step: Select Location — confirmed location card (map renders above ScrollView) */}
        {STEPS[step] === 'Location' && bookingLocation && (
          <View style={styles.locationStepWrap}>
            <Text style={styles.sectionTitle}>{t('booking.whereCome')}</Text>
            <Text style={styles.sectionSubtitle}>{t('booking.whereSubtitle')}</Text>
            <View style={styles.confirmedLocationCard}>
              <View style={styles.locationCardHeader}>
                <Text style={styles.locationIcon}>📍</Text>
                <View style={styles.locationCardBody}>
                  {bookingLocation.address.street && (
                    <Text style={styles.locationCardStreet}>{bookingLocation.address.street}</Text>
                  )}
                  {bookingLocation.address.district && (
                    <Text style={styles.locationCardLine}>{bookingLocation.address.district}</Text>
                  )}
                  {bookingLocation.address.city && (
                    <Text style={styles.locationCardLine}>{bookingLocation.address.city}</Text>
                  )}
                  <Text style={styles.locationCardCoords}>
                    {bookingLocation.lat.toFixed(6)}, {bookingLocation.lng.toFixed(6)}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setBookingLocation(null)}
                  style={styles.changeLocationBtn}
                >
                  <Text style={styles.changeLocationText}>{t('booking.change')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}

        {/* Step: Date & Time Selection */}
        {STEPS[step] === 'DateTime' && (
          <View>
            <Text style={styles.sectionTitle}>{t('booking.dateTimeTitle')}</Text>
            <Text style={styles.sectionSubtitle}>{t('booking.dateTimeSubtitle')}</Text>
            <DateTimePicker
              selectedDate={bookingDate}
              selectedTime={bookingTime}
              onDateChange={setBookingDate}
              onTimeChange={setBookingTime}
            />
          </View>
        )}

        {/* Step: Review Summary */}
        {STEPS[step] === 'Review' && (
          <View>
            <Text style={styles.sectionTitle}>{t('booking.summaryTitle')}</Text>

            {/* Vehicle */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{t('booking.summaryVehicle')}</Text>
              {selectedVehicle ? (
                <View style={styles.summaryRow}>
                  {selectedVehicle.image_url ? (
                    <Image source={{ uri: selectedVehicle.image_url }} style={styles.summaryVehicleImg} />
                  ) : (
                    <View style={styles.summaryVehiclePlaceholder}>
                      <Text style={styles.vehicleImageEmoji}>🚗</Text>
                    </View>
                  )}
                  <View>
                    <Text style={styles.summaryValue}>
                      {selectedVehicle.brand} {selectedVehicle.model}
                    </Text>
                    <Text style={styles.summarySub}>{selectedVehicle.plate}</Text>
                  </View>
                </View>
              ) : (
                <Text style={styles.summaryValue}>{t('booking.noVehicle')}</Text>
              )}
            </View>

            {/* Service */}
            <View style={styles.summaryCard}>
              <Text style={styles.summaryLabel}>{t('booking.summaryService')}</Text>
              {selectedService ? (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryValue}>{selectedService.name}</Text>
                  <Text style={styles.summaryPrice}>₺{Number(selectedService.base_price)}</Text>
                </View>
              ) : (
                <Text style={styles.summaryValue}>{t('booking.noService')}</Text>
              )}
            </View>

            {/* Extras */}
            {selectedExtras.length > 0 && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{t('booking.summaryExtras')}</Text>
                {EXTRA_SERVICES.filter(e => selectedExtras.includes(e.id)).map(e => (
                  <View key={e.id} style={styles.summaryRow}>
                    <Text style={styles.summaryValue}>{t(`booking.extra${e.id.charAt(0).toUpperCase() + e.id.slice(1)}`)}</Text>
                    <Text style={styles.summaryPrice}>+₺{e.price}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Location */}
            {bookingLocation && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{t('booking.summaryLocation')}</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryValue} numberOfLines={2}>
                    {bookingLocation.address.street ||
                      bookingLocation.address.district ||
                      bookingLocation.address.city ||
                      bookingLocation.address.fullAddress}
                  </Text>
                </View>
                <Text style={styles.summarySub}>
                  {bookingLocation.lat.toFixed(6)}, {bookingLocation.lng.toFixed(6)}
                </Text>
              </View>
            )}

            {/* Booking Date */}
            {bookingDate && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{t('booking.summaryDate')}</Text>
                <Text style={styles.summaryValue}>{bookingDate}</Text>
              </View>
            )}

            {/* Booking Time */}
            {bookingTime && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>{t('booking.summaryTime')}</Text>
                <Text style={styles.summaryValue}>{bookingTime}</Text>
              </View>
            )}

            {/* Total */}
            <View style={styles.totalCard}>
              <Text style={styles.totalLabel}>{t('booking.summaryTotal')}</Text>
              <Text style={styles.totalValue}>₺{grandTotal.toFixed(2)}</Text>
            </View>

            {/* Legal & Trust acceptance — required before confirming */}
            <View style={styles.legalBlock}>
              <Text style={styles.legalTitle}>{t('booking.beforeConfirm')}</Text>
              <AcceptanceCheckbox
                checked={acceptedServiceInfo}
                onToggle={() => setAcceptedServiceInfo(v => !v)}
                labelPrefix={t('booking.acceptServiceInfo')}
                linkText={t('booking.acceptServiceInfoLink')}
                onOpen={() => setLegalView('serviceInfo')}
              />
              <AcceptanceCheckbox
                checked={acceptedPrecautions}
                onToggle={() => setAcceptedPrecautions(v => !v)}
                labelPrefix={t('booking.acceptPrecautions')}
                linkText={t('booking.acceptPrecautionsLink')}
                onOpen={() => setLegalView('precautions')}
              />
            </View>
          </View>
        )}
      </ScrollView>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        {step < STEPS.length - 1 ? (
          <Button
            label={t('booking.continue')}
            onPress={handleNext}
            disabled={!canProceed}
            size="lg"
          />
        ) : (
          <Button
            label={t('booking.createBooking')}
            onPress={handleSubmit}
            loading={submitting}
            disabled={!acceptedServiceInfo || !acceptedPrecautions}
            size="lg"
          />
        )}
      </View>

      {legalView === 'serviceInfo' && (
        <LegalInfoScreen
          title={t('booking.legal.serviceInfoTitle')}
          eyebrow={t('booking.legal.legalEyebrow')}
          sections={SERVICE_INFO_SECTIONS}
          onClose={() => setLegalView(null)}
        />
      )}
      {legalView === 'precautions' && (
        <LegalInfoScreen
          title={t('booking.legal.precautionsTitle')}
          eyebrow={t('booking.legal.legalEyebrow')}
          sections={PRECAUTIONS_SECTIONS}
          onClose={() => setLegalView(null)}
        />
      )}

      {showTrackingMap && trackingBookingId && (
        <WasherTrackingMap
          bookingId={trackingBookingId}
          onClose={() => setShowTrackingMap(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
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

  stepBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  stepDot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: colors.primary + '20', borderColor: colors.primary },
  stepDotText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  stepDotTextActive: { color: colors.primary },
  stepLine: { flex: 1, height: 2, backgroundColor: colors.borderLight, marginHorizontal: spacing.xs },
  stepLineActive: { backgroundColor: colors.primary },

  stepLabels: { flexDirection: 'row', justifyContent: 'center', gap: spacing.md, marginBottom: spacing.sm },
  stepLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1 },
  stepLabelActive: { color: colors.primary },

  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  sectionTitle: { ...typography.h3, marginBottom: spacing.sm },
  sectionSubtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },

  cardList: { gap: spacing.md },

  // Vehicle card
  selectCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: spacing.md,
  },
  selectCardActive: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
  vehicleImageWrap: { width: 56, height: 56, borderRadius: radii.md, overflow: 'hidden', flexShrink: 0 },
  vehicleImage: { width: 56, height: 56, resizeMode: 'cover' },
  vehicleImagePlaceholder: {
    width: 56,
    height: 56,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vehicleImageEmoji: { fontSize: 24 },
  vehicleInfo: { flex: 1 },
  vehicleName: { ...typography.h4, marginBottom: 2 },
  vehiclePlate: { ...typography.bodySmall, color: colors.textMuted, fontWeight: '600', letterSpacing: 1 },

  // Service card
  serviceCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  serviceCardActive: { borderColor: colors.primary, backgroundColor: colors.primary + '10' },
  serviceHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  serviceName: { ...typography.h4 },
  servicePrice: { ...typography.h4, color: colors.primary },
  serviceDesc: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: spacing.sm },
  serviceMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  serviceDuration: { ...typography.caption, color: colors.textMuted },

  // Radio
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioActive: { borderColor: colors.primary },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },

  // Extra card
  extraCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    gap: spacing.md,
  },
  extraCardActive: { borderColor: colors.accent, backgroundColor: colors.accent + '10' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.borderLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: '#fff', fontWeight: '800', fontSize: 14 },
  extraInfo: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  extraName: { ...typography.body, fontWeight: '600' },
  extraPrice: { ...typography.body, color: colors.accent, fontWeight: '700' },

  // Summary
  summaryCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  summaryLabel: { ...typography.caption, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  summaryValue: { ...typography.body, fontWeight: '600' },
  summarySub: { ...typography.bodySmall, color: colors.textMuted },
  summaryPrice: { ...typography.body, fontWeight: '700', color: colors.primary },
  summaryVehicleImg: { width: 40, height: 40, borderRadius: radii.sm, resizeMode: 'cover' },
  summaryVehiclePlaceholder: {
    width: 40,
    height: 40,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },

  totalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.primary + '15',
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.primary + '40',
    marginTop: spacing.sm,
  },
  totalLabel: { ...typography.h4, color: colors.textPrimary },
  totalValue: { ...typography.h2, color: colors.primary },

  footer: { padding: spacing.lg, paddingBottom: spacing.xl, borderTopWidth: 1, borderTopColor: colors.border },

  locationStepWrap: { flex: 1, padding: spacing.lg },
  mapStepFull: { flex: 1 },
  confirmedLocationCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary + '30',
  },
  locationCardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  locationIcon: { fontSize: 24 },
  locationCardBody: { flex: 1 },
  locationCardStreet: { ...typography.body, fontWeight: '600', marginBottom: 2 },
  locationCardLine: { ...typography.bodySmall, color: colors.textSecondary, marginBottom: 2 },
  locationCardCoords: { ...typography.caption, color: colors.textMuted, marginTop: 4 },
  changeLocationBtn: {
    backgroundColor: colors.primary + '18',
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
  },
  changeLocationText: { ...typography.caption, color: colors.primary, fontWeight: '700' },

  legalBlock: { marginTop: spacing.lg, gap: spacing.sm },
  legalTitle: {
    ...typography.caption, color: colors.textMuted, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs,
  },

  // Tracking card
  trackingCardWrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  trackingCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.primary + '40',
  },
  trackingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  trackingIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  trackingIcon: { fontSize: 22 },
  trackingCardInfo: { flex: 1 },
  trackingCardTitle: {
    ...typography.h4,
    marginBottom: 2,
  },
  trackingCardDesc: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  trackingBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: 12,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  trackingBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
});
