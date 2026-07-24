import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

interface DateTimePickerProps {
  selectedDate: string | null;
  selectedTime: string | null;
  onDateChange: (date: string | null) => void;
  onTimeChange: (time: string | null) => void;
}

const TIME_SLOTS: string[] = (() => {
  const slots: string[] = [];
  for (let h = 9; h <= 20; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    if (h < 20) slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
})();

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function DateTimePicker({ selectedDate, selectedTime, onDateChange, onTimeChange }: DateTimePickerProps) {
  const { t } = useTranslation();
  const today = useMemo(() => new Date(), []);
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [viewYear, setViewYear] = useState(today.getFullYear());

  const calendarDays = useMemo(() => {
    const firstDay = new Date(viewYear, viewMonth, 1);
    const lastDay = new Date(viewYear, viewMonth + 1, 0);
    const startOffset = firstDay.getDay();
    const totalDays = lastDay.getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) cells.push(new Date(viewYear, viewMonth, d));
    return cells;
  }, [viewYear, viewMonth]);

  const selDate = selectedDate ? parseDate(selectedDate) : null;

  const canGoPrev = useMemo(() => {
    return viewYear > today.getFullYear() || (viewYear === today.getFullYear() && viewMonth > today.getMonth());
  }, [viewYear, viewMonth, today]);

  const goPrevMonth = () => {
    if (!canGoPrev) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear(y => y - 1);
    } else {
      setViewMonth(m => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear(y => y + 1);
    } else {
      setViewMonth(m => m + 1);
    }
  };

  const handleDayPress = (d: Date) => {
    if (isSameDay(d, today) || d > today) {
      onDateChange(toDateStr(d));
    }
  };

  const monthLabel = `${t(`booking.months.${viewMonth}`)} ${viewYear}`;

  return (
    <View style={styles.container}>
      {/* Calendar */}
      <View style={styles.calendarCard}>
        <View style={styles.calHeader}>
          <TouchableOpacity onPress={goPrevMonth} disabled={!canGoPrev} style={[styles.navBtn, !canGoPrev && styles.navBtnDisabled]}>
            <Text style={styles.navIcon}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity onPress={goNextMonth} style={styles.navBtn}>
            <Text style={styles.navIcon}>›</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.weekdayRow}>
          {WEEKDAY_KEYS.map(wk => (
            <Text key={wk} style={styles.weekdayText}>{t(`booking.weekdays.${wk}`)}</Text>
          ))}
        </View>

        <View style={styles.daysGrid}>
          {calendarDays.map((d, i) => {
            if (!d) return <View key={`empty-${i}`} style={styles.dayCell} />;
            const isPast = d < today && !isSameDay(d, today);
            const isSelected = selDate && isSameDay(d, selDate);
            const isToday = isSameDay(d, today);
            return (
              <TouchableOpacity
                key={`day-${i}`}
                style={[
                  styles.dayCell,
                  styles.dayBtn,
                  isSelected && styles.dayBtnSelected,
                  isToday && !isSelected && styles.dayBtnToday,
                ]}
                onPress={() => handleDayPress(d)}
                disabled={isPast}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.dayText,
                    isPast && styles.dayTextPast,
                    isSelected && styles.dayTextSelected,
                  ]}
                >
                  {d.getDate()}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Time slots */}
      <Text style={styles.timeSectionTitle}>{t('booking.selectTime')}</Text>
      <View style={styles.timeGrid}>
        {TIME_SLOTS.map(slot => {
          const isSelected = selectedTime === slot;
          return (
            <TouchableOpacity
              key={slot}
              style={[styles.timeChip, isSelected && styles.timeChipSelected]}
              onPress={() => onTimeChange(slot)}
              activeOpacity={0.7}
            >
              <Text style={[styles.timeChipText, isSelected && styles.timeChipTextSelected]}>{slot}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  calendarCard: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  calHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBtnDisabled: { opacity: 0.3 },
  navIcon: { fontSize: 22, color: colors.textPrimary, fontWeight: '300' },
  monthLabel: { ...typography.h4, textTransform: 'capitalize' },

  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: spacing.xs,
  },
  weekdayText: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
    width: 40,
    textAlign: 'center',
  },

  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
  },
  dayCell: {
    width: 40,
    height: 40,
    marginVertical: 2,
  },
  dayBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: colors.surface,
  },
  dayBtnSelected: {
    backgroundColor: colors.primary,
  },
  dayBtnToday: {
    borderWidth: 1.5,
    borderColor: colors.primary,
  },
  dayText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  dayTextPast: {
    color: colors.textMuted,
    opacity: 0.4,
  },
  dayTextSelected: {
    color: '#fff',
    fontWeight: '700',
  },

  timeSectionTitle: { ...typography.h3, marginBottom: spacing.sm },
  timeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  timeChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  timeChipSelected: {
    backgroundColor: colors.primary + '15',
    borderColor: colors.primary,
  },
  timeChipText: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  timeChipTextSelected: {
    color: colors.primary,
    fontWeight: '700',
  },
});
