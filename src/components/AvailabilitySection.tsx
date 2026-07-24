import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

const TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 0; h < 24; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
})();

interface AvailabilitySectionProps {
  workingDays: string[];
  startTime: string;
  endTime: string;
  onChange: (days: string[], start: string, end: string) => void;
  errors?: { days?: string; time?: string };
}

export function AvailabilitySection({
  workingDays,
  startTime,
  endTime,
  onChange,
  errors,
}: AvailabilitySectionProps) {
  const { t } = useTranslation();
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);

  const toggleDay = (day: string) => {
    const next = workingDays.includes(day)
      ? workingDays.filter(d => d !== day)
      : [...workingDays, day];
    onChange(next, startTime, endTime);
  };

  return (
    <View style={styles.container}>
      {/* Working Days */}
      <Text style={styles.label}>{t('availability.workingDays')}</Text>
      {errors?.days && <Text style={styles.errorText}>{errors.days}</Text>}
      <View style={styles.dayRow}>
        {WEEKDAYS.map(day => {
          const selected = workingDays.includes(day);
          return (
            <TouchableOpacity
              key={day}
              style={[styles.dayChip, selected && styles.dayChipSelected]}
              onPress={() => toggleDay(day)}
              activeOpacity={0.7}
            >
              <Text style={[styles.dayChipText, selected && styles.dayChipTextSelected]}>
                {t(`common.days.${day}`)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Working Hours */}
      <Text style={[styles.label, { marginTop: spacing.md }]}>{t('availability.workingHours')}</Text>
      {errors?.time && <Text style={styles.errorText}>{errors.time}</Text>}
      <View style={styles.hoursRow}>
        <View style={styles.timeCol}>
          <Text style={styles.timeLabel}>{t('availability.startTime')}</Text>
          <TouchableOpacity
            style={styles.timePicker}
            onPress={() => { setStartOpen(!startOpen); setEndOpen(false); }}
            activeOpacity={0.7}
          >
            <Text style={styles.timeValue}>{startTime}</Text>
            <Text style={styles.timeArrow}>▾</Text>
          </TouchableOpacity>
          {startOpen && (
            <View style={styles.timeDropdown}>
              {TIME_SLOTS.map(slot => (
                <TouchableOpacity
                  key={slot}
                  style={[styles.timeOption, slot === startTime && styles.timeOptionSelected]}
                  onPress={() => { onChange(workingDays, slot, endTime); setStartOpen(false); }}
                >
                  <Text style={[styles.timeOptionText, slot === startTime && styles.timeOptionTextSelected]}>
                    {slot}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.timeArrowBig}>↓</Text>

        <View style={styles.timeCol}>
          <Text style={styles.timeLabel}>{t('availability.endTime')}</Text>
          <TouchableOpacity
            style={styles.timePicker}
            onPress={() => { setEndOpen(!endOpen); setStartOpen(false); }}
            activeOpacity={0.7}
          >
            <Text style={styles.timeValue}>{endTime}</Text>
            <Text style={styles.timeArrow}>▾</Text>
          </TouchableOpacity>
          {endOpen && (
            <View style={styles.timeDropdown}>
              {TIME_SLOTS.map(slot => (
                <TouchableOpacity
                  key={slot}
                  style={[styles.timeOption, slot === endTime && styles.timeOptionSelected]}
                  onPress={() => { onChange(workingDays, startTime, slot); setEndOpen(false); }}
                >
                  <Text style={[styles.timeOptionText, slot === endTime && styles.timeOptionTextSelected]}>
                    {slot}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.xs },
  label: { ...typography.label, marginBottom: spacing.xs },
  errorText: { ...typography.bodySmall, color: colors.error, marginBottom: spacing.xs },
  dayRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dayChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  dayChipSelected: {
    backgroundColor: colors.accent + '20',
    borderColor: colors.accent,
  },
  dayChipText: { ...typography.bodySmall, color: colors.textSecondary },
  dayChipTextSelected: { color: colors.textPrimary, fontWeight: '600' },
  hoursRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  timeCol: { flex: 1 },
  timeLabel: { ...typography.caption, color: colors.textMuted, marginBottom: 4 },
  timePicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  timeValue: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  timeArrow: { color: colors.textMuted, fontSize: 12 },
  timeArrowBig: { color: colors.textMuted, fontSize: 20, marginTop: 28 },
  timeDropdown: {
    marginTop: 4,
    maxHeight: 200,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderLight,
    overflow: 'hidden',
  },
  timeOption: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  timeOptionSelected: { backgroundColor: colors.primary + '15' },
  timeOptionText: { ...typography.body, color: colors.textPrimary },
  timeOptionTextSelected: { color: colors.primary, fontWeight: '700' },
});
