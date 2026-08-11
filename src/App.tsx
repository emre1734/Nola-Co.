import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { LocationProvider } from './contexts/LocationContext';
import { NotificationProvider, useNotifications } from './contexts/NotificationContext';
import { ToastContainer } from './components/ui';
import { NotificationPermissionExplainer } from './components/NotificationPermissionExplainer';

import { SplashScreen } from './screens/SplashScreen';
import { LoginScreen } from './screens/auth/LoginScreen';
import { RegisterScreen } from './screens/auth/RegisterScreen';
import { ForgotPasswordScreen } from './screens/auth/ForgotPasswordScreen';
import { RoleSelectionScreen } from './screens/onboarding/RoleSelectionScreen';
import { CompleteProfileScreen } from './screens/onboarding/CompleteProfileScreen';
import { ProviderOnboardingScreen } from './screens/onboarding/ProviderOnboardingScreen';
import { LocationPermissionScreen } from './screens/onboarding/LocationPermissionScreen';
import { LocationMapScreen } from './screens/onboarding/LocationMapScreen';
import { HomeScreen } from './screens/app/HomeScreen';
import { CustomerHome } from './screens/app/CustomerHome';
import { ProviderDashboard } from './screens/app/ProviderDashboard';
import { MyVehiclesScreen } from './screens/app/MyVehiclesScreen';
import { BookingScreen } from './screens/app/BookingScreen';
import { PartnerSelectionScreen } from './screens/app/PartnerSelectionScreen';
import { ApprovalCenterScreen } from './screens/app/ApprovalCenterScreen';
import { BookingHistoryScreen } from './screens/app/BookingHistoryScreen';
import { SettingsScreen } from './screens/app/SettingsScreen';
import { colors } from './theme';

type Screen =
  | 'splash'
  | 'login'
  | 'register'
  | 'forgotPassword'
  | 'roleSelection'
  | 'completeProfile'
  | 'providerOnboarding'
  | 'locationPermission'
  | 'locationMap'
  | 'home'
  | 'customerHome'
  | 'providerDashboard'
  | 'myVehicles'
  | 'booking'
  | 'partnerSelection'
  | 'approvalCenter'
  | 'bookingHistory'
  | 'settings';

function AppNavigator() {
  const { refreshProfile, profile } = useAuth();
  const { showPermissionExplainer, requestPermission, dismissPermissionExplainer, setNotificationClickHandler } = useNotifications();
  const [screen, setScreen] = useState<Screen>('splash');
  const [selectedRole, setSelectedRole] = useState<'customer' | 'provider'>('customer');

  // Handle notification click navigation — maps a notification screen
  // name to the existing app screen.
  useEffect(() => {
    setNotificationClickHandler((event) => {
      if (event.screen === 'providerDashboard') setScreen('providerDashboard');
      else if (event.screen === 'bookingHistory') setScreen('bookingHistory');
      else if (event.screen === 'approvalCenter') setScreen('approvalCenter');
      else if (event.screen === 'partnerSelection') setScreen('partnerSelection');
      else if (event.screen === 'home') setScreen('home');
    });
  }, [setNotificationClickHandler]);

  // Handle notification click from URL params (when app is opened from a
  // notification tap and no client was running).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const notifScreen = params.get('screen');
    if (notifScreen && profile) {
      if (notifScreen === 'providerDashboard') setScreen('providerDashboard');
      else if (notifScreen === 'bookingHistory') setScreen('bookingHistory');
      else if (notifScreen === 'approvalCenter') setScreen('approvalCenter');
      else if (notifScreen === 'partnerSelection') setScreen('partnerSelection');
    }
  }, [profile]);

  const handleSplashReady = (dest: 'auth' | 'onboarding' | 'home') => {
    if (dest === 'auth') setScreen('login');
    else if (dest === 'onboarding') setScreen('roleSelection');
    else if (profile && (profile.latitude == null || profile.longitude == null)) {
      setScreen('locationPermission');
    } else {
      setScreen('home');
    }
  };

  return (
    <div style={styles.shell}>
      {screen === 'splash' && (
        <SplashScreen onReady={handleSplashReady} />
      )}

      {screen === 'login' && (
        <LoginScreen
          onNavigate={s => setScreen(s === 'register' ? 'register' : 'forgotPassword')}
          onSuccess={async () => {
            await refreshProfile();
            setScreen('splash');
          }}
        />
      )}

      {screen === 'register' && (
        <RegisterScreen
          onNavigate={() => setScreen('login')}
          onSuccess={() => setScreen('roleSelection')}
        />
      )}

      {screen === 'forgotPassword' && (
        <ForgotPasswordScreen onBack={() => setScreen('login')} />
      )}

      {/* Role selection — shown after registration or when profile is incomplete */}
      {screen === 'roleSelection' && (
        <RoleSelectionScreen
          onSelect={role => {
            setSelectedRole(role);
            setScreen('completeProfile');
          }}
        />
      )}

      {/* Complete profile — avatar, full name, phone, city */}
      {screen === 'completeProfile' && (
        <CompleteProfileScreen
          role={selectedRole}
          onComplete={() => setScreen('locationPermission')}
        />
      )}

      {/* Location permission — first launch, asks for GPS */}
      {screen === 'locationPermission' && (
        <LocationPermissionScreen
          onLocationSettled={() => setScreen('home')}
          onManualSelect={() => setScreen('locationMap')}
        />
      )}

      {/* Manual location selection — map fallback */}
      {screen === 'locationMap' && (
        <LocationMapScreen
          onLocationSettled={() => setScreen('home')}
          onBack={() => setScreen('locationPermission')}
        />
      )}

      {/* Provider profile setup — triggered on demand from HomeScreen */}
      {screen === 'providerOnboarding' && (
        <ProviderOnboardingScreen onComplete={() => setScreen('providerDashboard')} />
      )}

      {screen === 'home' && (
        <HomeScreen
          onNavigate={dest => setScreen(dest)}
          onSignOut={() => setScreen('login')}
          onUpdateLocation={() => setScreen('locationPermission')}
        />
      )}

      {screen === 'customerHome' && (
        <CustomerHome
          onBack={() => setScreen('home')}
          onSignOut={() => setScreen('login')}
        />
      )}

      {screen === 'providerDashboard' && (
        <ProviderDashboard
          onBack={() => setScreen('home')}
          onSignOut={() => setScreen('login')}
        />
      )}

      {screen === 'myVehicles' && (
        <MyVehiclesScreen
          onBack={() => setScreen('home')}
          onSignOut={() => setScreen('login')}
        />
      )}

      {screen === 'booking' && (
        <BookingScreen
          onBack={() => setScreen('home')}
          onComplete={() => setScreen('partnerSelection')}
        />
      )}

      {screen === 'partnerSelection' && (
        <PartnerSelectionScreen
          onBack={() => setScreen('home')}
          onComplete={() => setScreen('home')}
        />
      )}

      {screen === 'approvalCenter' && (
        <ApprovalCenterScreen
          onBack={() => setScreen('home')}
          onSignOut={() => setScreen('login')}
        />
      )}

      {screen === 'bookingHistory' && (
        <BookingHistoryScreen
          onBack={() => setScreen('home')}
        />
      )}

      {screen === 'settings' && (
        <SettingsScreen
          onBack={() => setScreen('home')}
          onSignOut={() => setScreen('login')}
        />
      )}

      <ToastContainer />

      {showPermissionExplainer && (
        <NotificationPermissionExplainer
          onEnable={requestPermission}
          onDismiss={dismissPermissionExplainer}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <LocationProvider>
          <NotificationProvider>
            <AppNavigator />
          </NotificationProvider>
        </LocationProvider>
      </AuthProvider>
    </ToastProvider>
  );
}

const styles = {
  shell: {
    flex: 1,
    backgroundColor: colors.bg,
  },
};
