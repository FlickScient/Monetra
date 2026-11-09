import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Monetra',
  slug: 'monetra-native',
  version: '1.0.1',
  orientation: 'portrait',
  scheme: 'monetra',
  userInterfaceStyle: 'automatic',
  // Keep the stable architecture path while investigating the device startup crash.
  newArchEnabled: false,
  icon: './assets/icon.png',
  plugins: ['expo-router', 'expo-secure-store', '@clerk/expo', ['expo-sqlite', { useSQLCipher: true }]],
  android: {
    package: 'com.flickscient.monetramobile',
    versionCode: 2,
    edgeToEdgeEnabled: true,
    adaptiveIcon: {
      foregroundImage: './assets/icon.png',
      backgroundColor: '#F5F6F2',
    },
  },
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_MONETRA_API_URL ?? 'https://monetra-4rax.vercel.app',
    clerkPublishableKey:
      process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ??
      'pk_test_bm90YWJsZS1oZXJvbi02MDYuY2xlcmsuYWNjb3VudHMuZGV2JA',
  },
};

export default config;
