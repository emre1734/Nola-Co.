import React from 'react';
import { useLocation } from '../../contexts/LocationContext';
import { useToast } from '../../contexts/ToastContext';
import { useTranslation } from '../../i18n/useTranslation';
import { GoogleMapView } from '../../components/map/GoogleMapView';
import type { ReverseGeocodeResult } from '../../lib/google-maps';

interface LocationMapScreenProps {
  onLocationSettled: () => void;
  onBack: () => void;
}

export function LocationMapScreen({ onLocationSettled, onBack }: LocationMapScreenProps) {
  const { setManualLocation, saveLocation } = useLocation();
  const { showToast } = useToast();
  const { t } = useTranslation();

  const handleConfirm = async (location: {
    lat: number;
    lng: number;
    address: ReverseGeocodeResult;
  }) => {
    setManualLocation({ latitude: location.lat, longitude: location.lng });
    const { error } = await saveLocation({ latitude: location.lat, longitude: location.lng });
    if (error) {
      showToast(t('onboarding.location.errSaveLocation') + error, 'error');
      return;
    }
    showToast(t('onboarding.location.successSaved'), 'success');
    onLocationSettled();
  };

  return (
    <GoogleMapView
      onConfirm={handleConfirm}
      onBack={onBack}
      title={t('onboarding.location.mapTitle')}
      confirmLabel={t('onboarding.location.mapConfirm')}
    />
  );
}
