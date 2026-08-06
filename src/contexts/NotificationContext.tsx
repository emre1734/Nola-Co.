import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { useTranslation } from '../i18n/useTranslation';

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

export interface NotificationClickEvent {
  screen: string | null;
  booking_id: string | null;
}

interface NotificationContextValue {
  permission: NotificationPermissionState;
  notificationsEnabled: boolean;
  showPermissionExplainer: boolean;
  requestPermission: () => Promise<void>;
  dismissPermissionExplainer: () => void;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  registerToken: () => Promise<void>;
  onNotificationClick: ((event: NotificationClickEvent) => void) | null;
  setNotificationClickHandler: (handler: ((event: NotificationClickEvent) => void) | null) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

const PERMISSION_EXPLAINER_KEY = 'wishwash:notification-explainer-dismissed';

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  const { session, profile, updateProfile } = useAuth();
  const { locale } = useTranslation();
  const [permission, setPermission] = useState<NotificationPermissionState>('default');
  const [showPermissionExplainer, setShowPermissionExplainer] = useState(false);
  const [onNotificationClick, setOnNotificationClick] = useState<((event: NotificationClickEvent) => void) | null>(null);
  const clickHandlerRef = useRef<((event: NotificationClickEvent) => void) | null>(null);

  // Sync permission state with the browser
  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPermission('unsupported');
      return;
    }
    setPermission(Notification.permission as NotificationPermissionState);
  }, []);

  // Listen for notification click messages from the service worker
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_CLICK') {
        const clickEvent: NotificationClickEvent = {
          screen: event.data.screen ?? null,
          booking_id: event.data.booking_id ?? null,
        };
        if (clickHandlerRef.current) {
          clickHandlerRef.current(clickEvent);
        }
      }
    };
    navigator.serviceWorker?.addEventListener('message', handler);
    return () => navigator.serviceWorker?.removeEventListener('message', handler);
  }, []);

  // Show the permission explainer after auth if not yet dismissed and permission is default
  useEffect(() => {
    if (!session || !profile) {
      setShowPermissionExplainer(false);
      return;
    }
    if (permission !== 'default') {
      setShowPermissionExplainer(false);
      return;
    }
    const dismissed = localStorage.getItem(PERMISSION_EXPLAINER_KEY);
    if (dismissed === 'true') {
      setShowPermissionExplainer(false);
      return;
    }
    // Only show after the user has a profile (not on first launch)
    if (profile.full_name) {
      setShowPermissionExplainer(true);
    }
  }, [session, profile, permission]);

  const requestPermission = useCallback(async () => {
    if (permission === 'unsupported') return;
    try {
      const result = await Notification.requestPermission();
      setPermission(result as NotificationPermissionState);
      if (result === 'granted') {
        // Register the push subscription
        await registerToken();
      }
    } catch (err) {
      console.error('Notification permission request failed:', err);
    }
    setShowPermissionExplainer(false);
    localStorage.setItem(PERMISSION_EXPLAINER_KEY, 'true');
  }, [permission]);

  const dismissPermissionExplainer = useCallback(() => {
    setShowPermissionExplainer(false);
    localStorage.setItem(PERMISSION_EXPLAINER_KEY, 'true');
  }, []);

  const registerToken = useCallback(async () => {
    if (!session || permission !== 'granted') return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

    try {
      // Get VAPID public key from edge function
      const { data: vapidData, error: vapidError } = await supabase.functions.invoke('push-notifications', {
        body: { action: 'get_vapid_public_key' },
      });
      if (vapidError || !vapidData?.public_key) return;

      const vapidPublicKey = vapidData.public_key;
      const convertedKey = urlBase64ToUint8Array(vapidPublicKey);

      // Subscribe to push notifications
      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();

      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: convertedKey,
        });
      }

      // Register the subscription with the backend
      await supabase.functions.invoke('push-notifications', {
        body: {
          action: 'register_token',
          subscription: {
            endpoint: subscription.endpoint,
            keys: {
              p256dh: subscription.getKey('p256dh'),
              auth: subscription.getKey('auth'),
            },
          },
        },
      });
    } catch (err) {
      console.error('Push subscription registration failed:', err);
    }
  }, [session, permission]);

  // Auto-register token when permission is granted and user is signed in.
  // Also sync the user's notification language to their current app locale.
  useEffect(() => {
    if (session && permission === 'granted' && profile?.notifications_enabled !== false) {
      registerToken();
      // Sync notification language with current app locale
      if (profile && profile.notification_language !== locale) {
        updateProfile({ notification_language: locale }).catch(() => {});
      }
    }
  }, [session, permission, profile?.notifications_enabled, profile?.notification_language, locale, registerToken, updateProfile]);

  const setNotificationsEnabled = useCallback(async (enabled: boolean) => {
    if (!session) return;
    await updateProfile({ notifications_enabled: enabled });
    if (enabled && permission === 'granted') {
      await registerToken();
    }
  }, [session, updateProfile, permission, registerToken]);

  const setNotificationClickHandler = useCallback((handler: ((event: NotificationClickEvent) => void) | null) => {
    clickHandlerRef.current = handler;
    setOnNotificationClick(() => handler);
  }, []);

  return (
    <NotificationContext.Provider
      value={{
        permission,
        notificationsEnabled: profile?.notifications_enabled !== false,
        showPermissionExplainer,
        requestPermission,
        dismissPermissionExplainer,
        setNotificationsEnabled,
        registerToken,
        onNotificationClick,
        setNotificationClickHandler,
      }}
    >
      {children}
    </NotificationContext.Provider>
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; ++i) {
    output[i] = raw.charCodeAt(i);
  }
  return output;
}

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  if (!ctx) throw new Error('useNotifications must be used within NotificationProvider');
  return ctx;
}
