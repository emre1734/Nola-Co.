import React, { useCallback, useEffect, useState } from 'react';
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
import { Modal } from '../../components/ui/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { createVehicleImageSignedUrl } from '../../lib/vehicle-image-resolver';
import { colors, spacing, typography, radii } from '../../theme';
import { VehicleForm, VehicleData } from './VehicleForm';
import { useTranslation } from '../../i18n/useTranslation';

interface MyVehiclesScreenProps {
  onBack: () => void;
  onSignOut: () => void;
}

interface Vehicle extends VehicleData {
  id: string;
}

export function MyVehiclesScreen({ onBack, onSignOut }: MyVehiclesScreenProps) {
  const { t } = useTranslation();
  const { profile, signOut } = useAuth();
  const { showToast } = useToast();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Vehicle | null>(null);
  const [showLogout, setShowLogout] = useState(false);

  const fetchVehicles = useCallback(async () => {
    const { data, error } = await supabase
      .from('vehicles')
      .select('id, brand, model, vehicle_type, color, plate, image_url')
      .order('created_at', { ascending: false });

    if (error) {
      showToast(t('vehicles.errLoad'), 'error');
      return;
    }
    const vehicles = (data as Vehicle[]) ?? [];
    for (const v of vehicles) {
      if (v.image_url) {
        v.image_url = await createVehicleImageSignedUrl(v.image_url);
      }
    }
    setVehicles(vehicles);
  }, [showToast]);

  useEffect(() => {
    fetchVehicles().finally(() => setLoading(false));
  }, [fetchVehicles]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchVehicles();
    setRefreshing(false);
  };

  const handleAdd = () => {
    setEditingVehicle(null);
    setShowForm(true);
  };

  const handleEdit = (v: Vehicle) => {
    setEditingVehicle(v);
    setShowForm(true);
  };

  const handleFormSaved = async () => {
    setShowForm(false);
    setEditingVehicle(null);
    await fetchVehicles();
  };

  const handleFormCancel = () => {
    setShowForm(false);
    setEditingVehicle(null);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { error } = await supabase.from('vehicles').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    if (error) {
      showToast(t('vehicles.errDelete'), 'error');
      return;
    }
    showToast(t('vehicles.successRemoved'), 'success');
    await fetchVehicles();
  };

  const handleLogout = async () => {
    setShowLogout(false);
    await signOut();
    onSignOut();
  };

  if (showForm) {
    return (
      <VehicleForm
        vehicle={editingVehicle}
        onSaved={handleFormSaved}
        onCancel={handleFormCancel}
      />
    );
  }

  if (loading) return <Loading fullScreen message={t('vehicles.loading')} />;

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={onBack}>
          <Text style={styles.backIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>{t('vehicles.title')}</Text>
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>
            {profile?.full_name?.charAt(0)?.toUpperCase() ?? '?'}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {vehicles.length === 0 ? (
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="🚗"
              title={t('vehicles.emptyTitle')}
              subtitle={t('vehicles.emptySubtitle')}
              actionLabel={t('vehicles.addVehicle')}
              onAction={handleAdd}
            />
          </View>
        ) : (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.vehicleCount}>
                {vehicles.length} {vehicles.length === 1 ? t('vehicles.countSingular') : t('vehicles.countPlural')}
              </Text>
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                <Text style={styles.addBtnText}>{t('vehicles.addBtn')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.cardList}>
              {vehicles.map(v => (
                <View key={v.id} style={styles.vehicleCard}>
                  {/* Vehicle image */}
                  <View style={styles.cardImageWrap}>
                    {v.image_url ? (
                      <Image source={{ uri: v.image_url }} style={styles.cardImage} />
                    ) : (
                      <View style={styles.cardImagePlaceholder}>
                        <Text style={styles.cardImageEmoji}>🚗</Text>
                      </View>
                    )}
                  </View>

                  {/* Vehicle info */}
                  <View style={styles.cardBody}>
                    <Text style={styles.cardTitle}>
                      {v.brand} {v.model}
                    </Text>
                    <View style={styles.cardTags}>
                      {v.vehicle_type && (
                        <View style={styles.tag}>
                          <Text style={styles.tagText}>{v.vehicle_type}</Text>
                        </View>
                      )}
                      {v.color && (
                        <View style={styles.tag}>
                          <Text style={styles.tagText}>{v.color}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.cardPlate}>{v.plate}</Text>
                  </View>

                  {/* Actions */}
                  <View style={styles.cardActions}>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => handleEdit(v)}>
                      <Text style={styles.iconBtnText}>✏️</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.iconBtn} onPress={() => setDeleteTarget(v)}>
                      <Text style={styles.iconBtnText}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Delete confirmation */}
      <Modal
        visible={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title={t('vehicles.removeTitle')}
        message={t('vehicles.removeMessage', { name: `${deleteTarget?.brand} ${deleteTarget?.model} (${deleteTarget?.plate})` })}
        confirmLabel={t('vehicles.remove')}
        cancelLabel={t('vehicles.cancel')}
        onConfirm={confirmDelete}
        confirmVariant="danger"
      />

      {/* Logout */}
      <Modal
        visible={showLogout}
        onClose={() => setShowLogout(false)}
        title={t('vehicles.logoutTitle')}
        message={t('vehicles.logoutMessage')}
        confirmLabel={t('vehicles.logoutConfirm')}
        cancelLabel={t('vehicles.logoutCancel')}
        onConfirm={handleLogout}
        confirmVariant="danger"
      />
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
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary + '30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.primary, fontWeight: '700', fontSize: 16 },

  scrollContent: { padding: spacing.lg, paddingBottom: spacing.xxl },
  emptyWrap: { flex: 1, minHeight: 400 },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  vehicleCount: { ...typography.body, color: colors.textSecondary, fontWeight: '600' },
  addBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.full,
    backgroundColor: colors.primary + '20',
    borderWidth: 1,
    borderColor: colors.primary,
  },
  addBtnText: { color: colors.primary, fontWeight: '700', fontSize: 13 },

  cardList: { gap: spacing.md },
  vehicleCard: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.xl,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardImageWrap: { width: 96, height: '100%' },
  cardImage: { width: 96, height: '100%', resizeMode: 'cover' },
  cardImagePlaceholder: {
    width: 96,
    height: '100%',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardImageEmoji: { fontSize: 32 },

  cardBody: { flex: 1, padding: spacing.md, gap: 6 },
  cardTitle: { ...typography.h4, marginBottom: 2 },
  cardTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: {
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: radii.full,
    backgroundColor: colors.primary + '18',
  },
  tagText: { fontSize: 11, fontWeight: '600', color: colors.primary },
  cardPlate: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '600',
    letterSpacing: 1,
  },

  cardActions: {
    flexDirection: 'column',
    justifyContent: 'center',
    gap: 12,
    paddingRight: spacing.md,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  iconBtnText: { fontSize: 16 },
});
