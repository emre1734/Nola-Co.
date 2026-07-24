import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Image,
} from 'react-native';
import { Button, Input } from '../../components/ui';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { supabase } from '../../lib/supabase';
import { uploadVehicleImage, pickImageWeb } from '../../lib/vehicle';
import { colors, spacing, typography, radii } from '../../theme';
import { useTranslation } from '../../i18n/useTranslation';

export interface VehicleData {
  id?: string;
  brand: string;
  model: string;
  vehicle_type: string;
  color: string;
  plate: string;
  image_url: string | null;
}

interface VehicleFormProps {
  vehicle?: VehicleData | null;
  onSaved: () => void;
  onCancel: () => void;
}

const VEHICLE_TYPES = ['Sedan', 'SUV', 'Hatchback', 'Coupe', 'Truck', 'Van', 'Motorcycle', 'Other'];

export function VehicleForm({ vehicle, onSaved, onCancel }: VehicleFormProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { showToast } = useToast();

  const [brand, setBrand] = useState(vehicle?.brand ?? '');
  const [model, setModel] = useState(vehicle?.model ?? '');
  const [vehicleType, setVehicleType] = useState(vehicle?.vehicle_type ?? '');
  const [color, setColor] = useState(vehicle?.color ?? '');
  const [plate, setPlate] = useState(vehicle?.plate ?? '');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(vehicle?.image_url ?? null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pickVehicleImage = async () => {
    const file = await pickImageWeb();
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!brand.trim()) errs.brand = t('vehicles.form.errBrand');
    if (!model.trim()) errs.model = t('vehicles.form.errModel');
    if (!vehicleType) errs.vehicleType = t('vehicles.form.errType');
    if (!plate.trim()) errs.plate = t('vehicles.form.errPlate');
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length) return;
    if (!session) return;

    setLoading(true);

    let imageUrl = vehicle?.image_url ?? null;
    if (imageFile) {
      const { url, error } = await uploadVehicleImage(session.user.id, imageFile);
      if (error) {
        showToast(t('vehicles.form.errImageUpload') + error, 'error');
        setLoading(false);
        return;
      }
      imageUrl = url;
    }

    const payload = {
      profile_id: session.user.id,
      brand: brand.trim(),
      model: model.trim(),
      vehicle_type: vehicleType,
      color: color.trim() || null,
      plate: plate.trim(),
      image_url: imageUrl,
      updated_at: new Date().toISOString(),
    };

    let result;
    if (vehicle?.id) {
      result = await supabase.from('vehicles').update(payload).eq('id', vehicle.id);
    } else {
      result = await supabase.from('vehicles').insert(payload);
    }

    setLoading(false);

    if (result.error) {
      showToast(t('vehicles.form.errSave') + result.error.message, 'error');
      return;
    }

    showToast(vehicle?.id ? t('vehicles.form.successUpdated') : t('vehicles.form.successAdded'), 'success');
    onSaved();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.step}>
            {vehicle?.id ? t('vehicles.form.editStep') : t('vehicles.form.addStep')}
          </Text>
          <Text style={styles.title}>
            {vehicle?.id ? t('vehicles.form.editTitle') : t('vehicles.form.addTitle')}
          </Text>
        </View>

        {/* Image picker */}
        <TouchableOpacity style={styles.imageWrap} onPress={pickVehicleImage} activeOpacity={0.85}>
          {imagePreview ? (
            <Image source={{ uri: imagePreview }} style={styles.vehicleImage} />
          ) : (
            <View style={styles.imagePlaceholder}>
              <Text style={styles.imageIcon}>📷</Text>
              <Text style={styles.imageHint}>{t('vehicles.form.addPhoto')}</Text>
            </View>
          )}
          <View style={styles.imageBadge}>
            <Text style={styles.imageBadgeText}>+</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.form}>
          <Input
            label={t('vehicles.form.brandLabel')}
            placeholder={t('vehicles.form.brandPlaceholder')}
            value={brand}
            onChangeText={setBrand}
            error={errors.brand}
          />
          <Input
            label={t('vehicles.form.modelLabel')}
            placeholder={t('vehicles.form.modelPlaceholder')}
            value={model}
            onChangeText={setModel}
            error={errors.model}
          />

          {/* Vehicle type picker */}
          <View style={styles.typeSection}>
            <Text style={styles.typeLabel}>{t('vehicles.form.typeLabel')}</Text>
            {errors.vehicleType && <Text style={styles.typeError}>{errors.vehicleType}</Text>}
            <View style={styles.typeChipRow}>
              {VEHICLE_TYPES.map(vt => (
                <TouchableOpacity
                  key={vt}
                  style={[styles.typeChip, vehicleType === vt && styles.typeChipSelected]}
                  onPress={() => setVehicleType(vt)}
                >
                  <Text style={[styles.typeChipText, vehicleType === vt && styles.typeChipTextSelected]}>
                    {t(`vehicles.form.type${vt.charAt(0).toUpperCase() + vt.slice(1)}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <Input
            label={t('vehicles.form.colorLabel')}
            placeholder={t('vehicles.form.colorPlaceholder')}
            value={color}
            onChangeText={setColor}
          />
          <Input
            label={t('vehicles.form.plateLabel')}
            placeholder={t('vehicles.form.platePlaceholder')}
            value={plate}
            onChangeText={setPlate}
            autoCapitalize="characters"
            error={errors.plate}
          />

          <View style={styles.actions}>
            <Button
              label={t('vehicles.form.cancel')}
              onPress={onCancel}
              variant="secondary"
              style={styles.actionBtn}
            />
            <Button
              label={vehicle?.id ? t('vehicles.form.saveChanges') : t('vehicles.form.addVehicle')}
              onPress={handleSubmit}
              loading={loading}
              style={styles.actionBtn}
            />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: spacing.lg, alignItems: 'center' },
  header: { alignItems: 'center', marginBottom: spacing.xl, width: '100%' },
  step: {
    ...typography.caption,
    color: colors.primary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  title: { ...typography.h2, marginBottom: spacing.xs },

  imageWrap: { position: 'relative', marginBottom: spacing.xl },
  vehicleImage: { width: 140, height: 100, borderRadius: radii.lg },
  imagePlaceholder: {
    width: 140,
    height: 100,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 2,
    borderColor: colors.borderLight,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  imageIcon: { fontSize: 28 },
  imageHint: { ...typography.caption, color: colors.textMuted },
  imageBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
  imageBadgeText: { color: '#fff', fontWeight: '800', fontSize: 18, lineHeight: 20 },

  form: { width: '100%', maxWidth: 420 },

  typeSection: { marginBottom: spacing.md },
  typeLabel: { ...typography.label, marginBottom: 6, color: colors.textSecondary },
  typeError: { ...typography.bodySmall, color: colors.error, marginBottom: 6 },
  typeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderLight,
  },
  typeChipSelected: { backgroundColor: colors.primary + '20', borderColor: colors.primary },
  typeChipText: { ...typography.bodySmall, color: colors.textSecondary },
  typeChipTextSelected: { color: colors.textPrimary, fontWeight: '600' },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
});
