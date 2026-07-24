import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { AvailabilitySection } from './AvailabilitySection';
import { useToast } from '../contexts/ToastContext';
import { supabase } from '../lib/supabase';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

interface AvailabilityCardProps {
  providerProfileId: string;
  onUpdated?: () => void;
}

interface AvailabilityData {
  working_days: string[] | null;
  work_start_time: string | null;
  work_end_time: string | null;
}

export function AvailabilityCard({ providerProfileId, onUpdated }: AvailabilityCardProps) {
  const { showToast } = useToast();
  const { t } = useTranslation();
  const [workingDays, setWorkingDays] = useState<string[]>([]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('18:00');
  const [initialDays, setInitialDays] = useState<string[]>([]);
  const [initialStart, setInitialStart] = useState('09:00');
  const [initialEnd, setInitialEnd] = useState('18:00');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ days?: string; time?: string }>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from('provider_profiles')
        .select('working_days, work_start_time, work_end_time')
        .eq('id', providerProfileId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setLoading(false);
        return;
      }
      const av = data as AvailabilityData;
      const days = av.working_days ?? [];
      const start = av.work_start_time ?? '09:00';
      const end = av.work_end_time ?? '18:00';
      setWorkingDays(days);
      setStartTime(start);
      setEndTime(end);
      setInitialDays(days);
      setInitialStart(start);
      setInitialEnd(end);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [providerProfileId]);

  const daysDirty = JSON.stringify([...workingDays].sort()) !== JSON.stringify([...initialDays].sort());
  const startDirty = startTime !== initialStart;
  const endDirty = endTime !== initialEnd;
  const dirty = daysDirty || startDirty || endDirty;

  const validate = (): boolean => {
    const errs: { days?: string; time?: string } = {};
    if (workingDays.length === 0) errs.days = t('availability.errDaysRequired');
    if (endTime <= startTime) errs.time = t('availability.errEndBeforeStart');
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    const { error } = await supabase
      .from('provider_profiles')
      .update({
        working_days: workingDays,
        work_start_time: startTime,
        work_end_time: endTime,
      })
      .eq('id', providerProfileId);
    setSaving(false);
    if (error) {
      showToast(t('availability.errSave'), 'error');
      return;
    }
    setInitialDays([...workingDays]);
    setInitialStart(startTime);
    setInitialEnd(endTime);
    showToast(t('availability.successSaved'), 'success');
    onUpdated?.();
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t('availability.title')}</Text>
        <Text style={styles.cardSubtitle}>{t('availability.loading')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{t('availability.title')}</Text>
        <Text style={styles.cardSubtitle}>
          {workingDays.length} {t('availability.daysSelected')}
        </Text>
      </View>

      <AvailabilitySection
        workingDays={workingDays}
        startTime={startTime}
        endTime={endTime}
        onChange={(days, start, end) => {
          setWorkingDays(days);
          setStartTime(start);
          setEndTime(end);
          setErrors({});
        }}
        errors={errors}
      />

      <TouchableOpacity
        style={[styles.saveBtn, !dirty && styles.saveBtnIdle, saving && styles.saveBtnBusy]}
        onPress={handleSave}
        disabled={!dirty || saving}
        activeOpacity={0.85}
      >
        <Text style={styles.saveBtnText}>
          {saving ? t('availability.saving') : t('availability.save')}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  cardTitle: { ...typography.h4, fontSize: 16 },
  cardSubtitle: { ...typography.caption, color: colors.textMuted },
  saveBtn: {
    backgroundColor: colors.primary,
    borderRadius: radii.lg,
    paddingVertical: spacing.md - 2,
    alignItems: 'center',
    marginTop: spacing.md,
  },
  saveBtnIdle: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderLight, opacity: 0.6 },
  saveBtnBusy: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
