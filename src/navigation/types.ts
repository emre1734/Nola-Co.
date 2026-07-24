export type RootStackParamList = {
  Splash: undefined;
  Auth: undefined;
  Onboarding: undefined;
  CustomerHome: undefined;
  ProviderDashboard: undefined;
};

export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  EmailVerification: { email: string };
};

export type OnboardingStackParamList = {
  RoleSelection: undefined;
  CustomerOnboarding: undefined;
  ProviderOnboarding: undefined;
};
