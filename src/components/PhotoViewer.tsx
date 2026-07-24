import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Dimensions,
  NativeScrollEvent,
  NativeScrollEvent as RNNativeScrollEvent,
} from 'react-native';
import { colors, spacing, typography, radii } from '../theme';
import { useTranslation } from '../i18n/useTranslation';

const SCREEN_WIDTH = Dimensions.get('window').width;

interface PhotoViewerProps {
  visible: boolean;
  images: { uri: string; label: string }[];
  startIndex?: number;
  onClose: () => void;
}

export function PhotoViewer({ visible, images, startIndex = 0, onClose }: PhotoViewerProps) {
  const { t } = useTranslation();
  const [activeIndex, setActiveIndex] = useState(startIndex);

  useEffect(() => {
    if (visible) setActiveIndex(startIndex);
  }, [visible, startIndex]);

  if (!visible || images.length === 0) return null;

  const handleScroll = (event: { nativeEvent: NativeScrollEvent }) => {
    const x = event.nativeEvent.contentOffset.x;
    const idx = Math.round(x / SCREEN_WIDTH);
    if (idx !== activeIndex && idx >= 0 && idx < images.length) {
      setActiveIndex(idx);
    }
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{images[activeIndex]?.label ?? t('photoViewer.fallbackTitle')}</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.8}>
          <Text style={styles.closeIcon}>✕</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentOffset={{ x: startIndex * SCREEN_WIDTH, y: 0 }}
        style={styles.scroll}
      >
        {images.map((img, i) => (
          <View key={i} style={styles.page}>
            <Image source={{ uri: img.uri }} style={styles.fullImg} resizeMode="contain" />
          </View>
        ))}
      </ScrollView>

      {images.length > 1 && (
        <View style={styles.dots}>
          {images.map((_, i) => (
            <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
          ))}
        </View>
      )}
    </View>
  );
}

interface BeforeAfterCompareProps {
  beforeUrl: string | null;
  afterUrl: string | null;
  onPhotoPress: (images: { uri: string; label: string }[], index: number) => void;
}

export function BeforeAfterCompare({ beforeUrl, afterUrl, onPhotoPress }: BeforeAfterCompareProps) {
  const { t } = useTranslation();
  const [activeIdx, setActiveIdx] = useState(0);

  const photos: { uri: string; label: string }[] = [];
  if (beforeUrl) photos.push({ uri: beforeUrl, label: t('photoViewer.before') });
  if (afterUrl) photos.push({ uri: afterUrl, label: t('photoViewer.after') });

  const handleScroll = (event: { nativeEvent: NativeScrollEvent }) => {
    const x = event.nativeEvent.contentOffset.x;
    const idx = Math.round(x / (SCREEN_WIDTH - 32));
    if (idx !== activeIdx && idx >= 0 && idx < photos.length) setActiveIdx(idx);
  };

  return (
    <View style={styles.compareWrap}>
      <View style={styles.compareHeader}>
        <Text style={styles.compareTitle}>{t('photoViewer.compareTitle')}</Text>
        <Text style={styles.compareHint}>{t('photoViewer.swipeHint')}</Text>
      </View>

      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        style={styles.compareScroll}
        contentContainerStyle={styles.compareContent}
      >
        {photos.length > 0 ? (
          photos.map((p, i) => (
            <TouchableOpacity
              key={i}
              style={styles.comparePage}
              activeOpacity={0.9}
              onPress={() => onPhotoPress(photos, i)}
            >
              <View style={styles.compareFrame}>
                <Image source={{ uri: p.uri }} style={styles.compareImg} resizeMode="cover" />
                <View style={[styles.tag, i === 0 ? styles.tagBefore : styles.tagAfter]}>
                  <Text style={styles.tagText}>{p.label}</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.comparePage}>
            <View style={[styles.compareFrame, styles.noPhoto]}>
              <Text style={styles.noPhotoIcon}>🖼️</Text>
              <Text style={styles.noPhotoText}>{t('photoViewer.noPhotos')}</Text>
            </View>
          </View>
        )}
      </ScrollView>

      {photos.length > 1 && (
        <View style={styles.compareDots}>
          <View style={[styles.cDot, activeIdx === 0 && styles.cDotActive]} />
          <View style={[styles.cDot, activeIdx === 1 && styles.cDotActive]} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // PhotoViewer (fullscreen)
  overlay: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#000',
    zIndex: 9999,
    elevation: 9999,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl + 8,
    paddingBottom: spacing.md,
    backgroundColor: 'rgba(0,0,0,0.85)',
  },
  headerTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  closeBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeIcon: { color: '#fff', fontSize: 16, fontWeight: '700' },
  scroll: { flex: 1 },
  page: { width: SCREEN_WIDTH, flex: 1, alignItems: 'center', justifyContent: 'center' },
  fullImg: { width: SCREEN_WIDTH, height: '70%' },
  dots: { flexDirection: 'row', justifyContent: 'center', paddingBottom: spacing.xl, gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { backgroundColor: '#fff', width: 24, borderRadius: 4 },

  // BeforeAfterCompare
  compareWrap: { marginBottom: spacing.md },
  compareHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  compareTitle: { ...typography.h4, fontSize: 15 },
  compareHint: { ...typography.caption, color: colors.primary },
  compareScroll: {},
  compareContent: {},
  comparePage: { width: SCREEN_WIDTH - 32 },
  compareFrame: {
    width: '100%', height: 220, borderRadius: radii.lg,
    backgroundColor: colors.surface, overflow: 'hidden',
    borderWidth: 1, borderColor: colors.borderLight,
  },
  compareImg: { width: '100%', height: '100%' },
  tag: {
    position: 'absolute', top: 12, left: 12,
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: radii.full,
  },
  tagBefore: { backgroundColor: 'rgba(245, 158, 11, 0.9)' },
  tagAfter: { backgroundColor: 'rgba(16, 185, 129, 0.9)' },
  tagText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  noPhoto: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed' as const, borderColor: colors.borderLight },
  noPhotoIcon: { fontSize: 36, marginBottom: spacing.sm },
  noPhotoText: { ...typography.bodySmall, color: colors.textMuted },
  compareDots: { flexDirection: 'row', justifyContent: 'center', marginTop: spacing.sm, gap: 8 },
  cDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.borderLight },
  cDotActive: { backgroundColor: colors.primary, width: 22, borderRadius: 4 },
});
