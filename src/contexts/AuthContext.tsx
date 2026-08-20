import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase, Profile } from '../lib/supabase';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  initialized: boolean;
}

interface AuthContextValue extends AuthState {
  emailVerified: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null; emailNotVerified?: boolean }>;
  signUp: (email: string, password: string) => Promise<{ error: string | null; session: Session | null }>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>;
  resendVerification: (email: string) => Promise<{ error: string | null }>;
  refreshProfile: () => Promise<void>;
  updateProfile: (data: Partial<Profile>) => Promise<{ error: string | null }>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    session: null,
    profile: null,
    loading: false,
    initialized: false,
  });
  const [emailVerified, setEmailVerified] = useState(false);

  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error || !data) return null;
    return data as Profile;
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      (async () => {
        const profile = session ? await fetchProfile(session.user.id) : null;
        setEmailVerified(!!session?.user?.email_confirmed_at);
        setState({ session, profile, loading: false, initialized: true });
      })();
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      (async () => {
        const profile = session ? await fetchProfile(session.user.id) : null;
        setEmailVerified(!!session?.user?.email_confirmed_at);
        setState(prev => ({ ...prev, session, profile, loading: false }));
      })();
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = async (email: string, password: string) => {
    setState(prev => ({ ...prev, loading: true }));
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setEmailVerified(!!data.user?.email_confirmed_at);
    if (data.session) {
      const profile = await fetchProfile(data.session.user.id);
      setState(prev => ({ ...prev, session: data.session, profile, loading: false }));
    } else {
      setState(prev => ({ ...prev, loading: false }));
    }
    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string) => {
    setState(prev => ({ ...prev, loading: true }));
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    setState(prev => ({ ...prev, loading: false }));
    return { error: error?.message ?? null, session: data.session };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setState(prev => ({ ...prev, session: null, profile: null }));
  };

  const sendPasswordReset = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    return { error: error?.message ?? null };
  };

  const resendVerification = async (email: string) => {
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    return { error: error?.message ?? null };
  };

  const refreshProfile = async () => {
    if (!state.session) return;
    const profile = await fetchProfile(state.session.user.id);
    setState(prev => ({ ...prev, profile }));
  };

  const updateProfile = async (data: Partial<Profile>) => {
    if (!state.session) return { error: 'common.notAuthenticated' };
    const { error } = await supabase
      .from('profiles')
      .update({ ...data, updated_at: new Date().toISOString() })
      .eq('id', state.session.user.id);
    if (!error) await refreshProfile();
    return { error: error?.message ?? null };
  };

  return (
    <AuthContext.Provider value={{ ...state, emailVerified, signIn, signUp, signOut, sendPasswordReset, resendVerification, refreshProfile, updateProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
