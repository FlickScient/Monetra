import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'Monetra',
  slug: 'monetra-native',
  version: '1.0.0',
  orientation: 'portrait',
  scheme: 'monetra',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  plugins: ['expo-router', 'expo-secure-store', '@clerk/expo', 'expo-sqlite'],
  android: {
    package: 'com.flickscient.monetra.native',
    versionCode: 1,
    edgeToEdgeEnabled: true,
  },
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_MONETRA_API_URL ?? 'https://monetra-4rax.vercel.app',
  },
};

export default config;